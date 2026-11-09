/**
 * How well route lines sit on the roads the map draws (run on GitHub Actions, which can reach the
 * services). Asks TomTom (both API families, when a key is set) and OSRM for real routes in
 * Malaysia, loads the OpenFreeMap z14 road lines along them, and measures every 5 m how far the
 * route is from the nearest road going its way. Writes report.md, report.json and page files for
 * pictures of the worst stretches (route-align-shots.cjs takes them).
 *
 *   TT_KEY=... node scripts/dev/route-align.mjs <out dir>
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';

const OUT = process.argv[2] ?? 'route-align';
mkdirSync(OUT, { recursive: true });
const KEY = (process.env.TT_KEY ?? '').trim();
/** Routes to compare against (a saved set, so a fix can be measured on the same lines). */
const FROM_FILE = process.env.ROUTES_FILE;

const TRIPS = [
  ['KLCC to KLIA', [101.7119, 3.1578], [101.7099, 2.7456]],
  ['Mid Valley to Sunway', [101.6772, 3.1181], [101.607, 3.0731]],
  ['Bangsar South to Wangsa Maju', [101.6656, 3.111], [101.7316, 3.205]],
  ['KL Sentral to Bukit Bintang', [101.6865, 3.134], [101.71, 3.1466]],
  ['Putrajaya to Cyberjaya', [101.6939, 2.9264], [101.655, 2.9213]],
  ['UTP to Ipoh', [100.9786, 4.385], [101.0829, 4.5975]],
  ['Ampang to Cheras', [101.7576, 3.1593], [101.736, 3.09]],
  ['Damansara to Kepong', [101.6195, 3.1365], [101.638, 3.214]],
  ['Shah Alam to Klang', [101.5183, 3.0733], [101.4455, 3.0449]],
  ['Jalan Duta to Sungai Buloh', [101.67, 3.172], [101.565, 3.205]],
];

/* ------------------------------------------------------------------ helpers */

async function getJson(url, tries = 3) {
  for (let i = 0; ; i++) {
    try {
      const r = await fetch(url);
      const text = await r.text();
      if (!r.ok) throw new Error(`${r.status} ${text.slice(0, 200)}`);
      return JSON.parse(text);
    } catch (e) {
      if (i + 1 >= tries) throw e;
      await new Promise((ok) => setTimeout(ok, 1500 * (i + 1)));
    }
  }
}

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
function haversine(a, b) {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
}

/** Local metres around a point (good to a few cm over tens of km near the equator). */
function projector(lat0, lng0) {
  const kx = 111320 * Math.cos(rad(lat0));
  const ky = 110574;
  return { fwd: (p) => [(p[0] - lng0) * kx, (p[1] - lat0) * ky], back: (q) => [lng0 + q[0] / kx, lat0 + q[1] / ky] };
}

/** Points every `step` metres along a line, with the direction of travel there. */
function resample(pts, step) {
  const out = [];
  let carry = 0;
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-6) continue;
    const dir = Math.atan2(bx - ax, by - ay);
    let t = carry;
    while (t <= len) {
      out.push({ p: [ax + ((bx - ax) * t) / len, ay + ((by - ay) * t) / len], dir });
      t += step;
    }
    carry = t - len;
  }
  return out;
}

const angDiff = (a, b) => {
  let d = Math.abs(a - b) % (2 * Math.PI);
  return d > Math.PI ? 2 * Math.PI - d : d;
};

/* ------------------------------------------------------------------ routes */

async function osrm(a, b) {
  const url = `https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson&steps=false`;
  const j = await getJson(url);
  return j.routes[0].geometry.coordinates;
}

async function tomtom(family, a, b) {
  const locs = `${a[1]},${a[0]}:${b[1]},${b[0]}`;
  const q = new URLSearchParams({ key: KEY, travelMode: 'car', routeType: 'fastest', instructionsType: 'coded' });
  if (family === 'orbis') {
    q.set('apiVersion', '2');
    q.set('traffic', 'live');
  } else q.set('traffic', 'true');
  const path = family === 'orbis' ? '/maps/orbis/routing/calculateRoute' : '/routing/1/calculateRoute';
  const j = await getJson(`https://api.tomtom.com${path}/${locs}/json?${q}`, 2);
  const pts = [];
  for (const leg of j.routes[0].legs) for (const p of leg.points) pts.push([p.longitude, p.latitude]);
  return pts;
}

/* ------------------------------------------------------------------ map roads */

let tileTemplate = null;
const tileCache = new Map();
const ROAD_CLASSES = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'busway']);

function tileOf(p, z) {
  const n = 2 ** z;
  const x = Math.floor(((p[0] + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(rad(p[1])) + 1 / Math.cos(rad(p[1]))) / Math.PI) / 2) * n);
  return [x, y];
}

async function roadsOfTile(x, y) {
  const k = `${x}/${y}`;
  if (tileCache.has(k)) return tileCache.get(k);
  if (!tileTemplate) {
    const tj = await getJson('https://tiles.openfreemap.org/planet');
    tileTemplate = tj.tiles[0];
  }
  const url = tileTemplate.replace('{z}', '14').replace('{x}', String(x)).replace('{y}', String(y));
  const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
  const t = new VectorTile(new Pbf(buf));
  const l = t.layers.transportation;
  const roads = [];
  for (let i = 0; l && i < l.length; i++) {
    const f = l.feature(i);
    const props = f.properties;
    if (!ROAD_CLASSES.has(String(props.class))) continue;
    const g = f.toGeoJSON(x, y, 14).geometry;
    const lines = g.type === 'LineString' ? [g.coordinates] : g.type === 'MultiLineString' ? g.coordinates : [];
    for (const c of lines) roads.push({ c, cls: String(props.class), ramp: props.ramp === 1, oneway: Number(props.oneway ?? 0), brunnel: props.brunnel ?? '' });
  }
  tileCache.set(k, roads);
  return roads;
}

/** The road lines around a route, projected, in a 25 m grid. */
async function roadIndex(route, proj) {
  const tiles = new Set();
  const pts = resample(route.map(proj.fwd), 100).map((s) => proj.back(s.p));
  for (const p of pts) {
    for (const [dx, dy] of [[0, 0], [60, 0], [-60, 0], [0, 60], [0, -60]]) {
      const q = proj.back([proj.fwd(p)[0] + dx, proj.fwd(p)[1] + dy]);
      tiles.add(tileOf(q, 14).join('/'));
    }
  }
  const segs = [];
  const seen = new Set();
  for (const k of tiles) {
    const [x, y] = k.split('/').map(Number);
    for (const r of await roadsOfTile(x, y)) {
      // The same road comes in each tile it crosses (clipped with a buffer): keep both, nearest wins.
      for (let i = 0; i + 1 < r.c.length; i++) {
        const a = proj.fwd(r.c[i]);
        const b = proj.fwd(r.c[i + 1]);
        const key = `${a[0].toFixed(1)},${a[1].toFixed(1)},${b[0].toFixed(1)},${b[1].toFixed(1)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        segs.push({ a, b, dir: Math.atan2(b[0] - a[0], b[1] - a[1]), cls: r.cls, ramp: r.ramp, oneway: r.oneway, brunnel: r.brunnel });
      }
    }
  }
  const CELL = 25;
  const grid = new Map();
  segs.forEach((s, i) => {
    const x0 = Math.floor(Math.min(s.a[0], s.b[0]) / CELL);
    const x1 = Math.floor(Math.max(s.a[0], s.b[0]) / CELL);
    const y0 = Math.floor(Math.min(s.a[1], s.b[1]) / CELL);
    const y1 = Math.floor(Math.max(s.a[1], s.b[1]) / CELL);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(i);
      }
  });
  return { segs, grid, CELL, tiles: tiles.size };
}

/** Distance to the nearest road going this way (a one-way road only in its own direction). */
function nearestRoad(idx, p, dir, maxD = 40) {
  const { segs, grid, CELL } = idx;
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  const r = Math.ceil(maxD / CELL);
  let best = { d: Infinity, s: null };
  const checked = new Set();
  for (let x = cx - r; x <= cx + r; x++)
    for (let y = cy - r; y <= cy + r; y++) {
      for (const i of grid.get(`${x},${y}`) ?? []) {
        if (checked.has(i)) continue;
        checked.add(i);
        const s = segs[i];
        const dd = angDiff(s.dir, dir);
        const along = s.oneway === 1 ? dd : s.oneway === -1 ? angDiff(s.dir + Math.PI, dir) : Math.min(dd, Math.PI - dd);
        if (along > rad(40)) continue;
        const vx = s.b[0] - s.a[0];
        const vy = s.b[1] - s.a[1];
        const L2 = vx * vx + vy * vy;
        const t = L2 > 0 ? Math.max(0, Math.min(1, ((p[0] - s.a[0]) * vx + (p[1] - s.a[1]) * vy) / L2)) : 0;
        const d = Math.hypot(p[0] - (s.a[0] + vx * t), p[1] - (s.a[1] + vy * t));
        if (d < best.d) best = { d, s };
      }
    }
  return best;
}

/* ------------------------------------------------------------------ measuring */

function measure(route, idx, proj) {
  const samples = resample(route.map(proj.fwd), 5);
  const ds = samples.map((s) => nearestRoad(idx, s.p, s.dir));
  const d = ds.map((x) => Math.min(x.d, 40));
  const sorted = [...d].sort((a, b) => a - b);
  const q = (f) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
  const frac = (m) => d.filter((x) => x > m).length / d.length;
  // Stretches more than 6 m off for at least 25 m.
  const bad = [];
  let i = 0;
  while (i < d.length) {
    if (d[i] <= 6) {
      i++;
      continue;
    }
    let j = i;
    while (j < d.length && d[j] > 6) j++;
    const len = (j - i) * 5;
    if (len >= 25) {
      const part = d.slice(i, j);
      const mid = samples[Math.floor((i + j) / 2)].p;
      const cls = ds[Math.floor((i + j) / 2)].s?.cls ?? 'none';
      bad.push({ fromM: i * 5, len, max: Math.max(...part), mean: part.reduce((a, b) => a + b, 0) / part.length, at: proj.back(mid), nearest: cls });
    }
    i = j;
  }
  bad.sort((a, b) => b.len * b.mean - a.len * a.mean);
  return {
    lengthKm: (samples.length * 5) / 1000,
    median: q(0.5),
    p90: q(0.9),
    p99: q(0.99),
    over3: frac(3),
    over6: frac(6),
    over10: frac(10),
    noRoad: d.filter((x) => x >= 40).length / d.length,
    bad,
  };
}

/* ------------------------------------------------------------------ run */

const providers = ['osrm', ...(KEY ? ['tomtom-classic', 'tomtom-orbis'] : [])];
console.log(KEY ? 'TomTom key set: comparing TomTom classic, TomTom Orbis and OSRM.' : 'No TomTom key: OSRM only.');

/** Saved routes from an earlier run, or new ones. */
const saved = FROM_FILE && existsSync(FROM_FILE) ? JSON.parse(readFileSync(FROM_FILE, 'utf8')) : {};
const routes = {};
for (const [name, a, b] of TRIPS) {
  routes[name] = {};
  for (const p of providers) {
    try {
      routes[name][p] = saved[name]?.[p] ?? (p === 'osrm' ? await osrm(a, b) : await tomtom(p.split('-')[1], a, b));
    } catch (e) {
      console.log(`${name} ${p}: ${e.message}`);
    }
  }
}
writeFileSync(join(OUT, 'routes.json'), JSON.stringify(routes));

const report = {};
const lines = ['# Route lines against the map roads', '', `Metres from each route point to the nearest road the map draws going that way (every 5 m). ${KEY ? '' : 'No TomTom key, so OSRM only.'}`, ''];
lines.push('| Trip | Router | km | median | 90% | 99% | >3 m | >6 m | >10 m | no road |', '|---|---|---|---|---|---|---|---|---|---|');
const shots = [];
for (const [name] of TRIPS) {
  report[name] = {};
  for (const p of providers) {
    const r = routes[name][p];
    if (!r) continue;
    const proj = projector(r[0][1], r[0][0]);
    const idx = await roadIndex(r, proj);
    const m = measure(r, idx, proj);
    report[name][p] = m;
    const pc = (x) => `${(x * 100).toFixed(1)}%`;
    lines.push(`| ${name} | ${p} | ${m.lengthKm.toFixed(1)} | ${m.median.toFixed(1)} | ${m.p90.toFixed(1)} | ${m.p99.toFixed(1)} | ${pc(m.over3)} | ${pc(m.over6)} | ${pc(m.over10)} | ${pc(m.noRoad)} |`);
    for (const b of m.bad.slice(0, 3)) shots.push({ trip: name, provider: p, ...b });
  }
}
lines.push('', '## Worst stretches (more than 6 m off for 25 m or more)', '');
for (const [name] of TRIPS)
  for (const p of providers) {
    const m = report[name][p];
    if (!m) continue;
    for (const b of m.bad.slice(0, 6))
      lines.push(`- ${name}, ${p}: ${b.len} m at ${b.fromM} m, mean ${b.mean.toFixed(1)} m, max ${b.max.toFixed(1)} m, near ${b.nearest}, at ${b.at[1].toFixed(5)},${b.at[0].toFixed(5)}`);
  }
writeFileSync(join(OUT, 'report.md'), lines.join('\n') + '\n');
writeFileSync(join(OUT, 'report.json'), JSON.stringify(report, null, 1));
console.log(lines.join('\n'));

// Pages for the pictures: the map style plus every router's line at the stretch.
shots.sort((a, b) => b.len * b.mean - a.len * a.mean);
const picked = shots.slice(0, 14);
writeFileSync(join(OUT, 'shots.json'), JSON.stringify(picked.map((s, i) => ({ i, ...s }))));
const COLORS = { osrm: '#16a34a', 'tomtom-classic': '#dc2626', 'tomtom-orbis': '#2563eb', aligned: '#a21caf' };
writeFileSync(join(OUT, 'colors.json'), JSON.stringify(COLORS));
