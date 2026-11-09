/**
 * How well route lines sit on the roads the map draws, and how well lining them up works (run on
 * GitHub Actions, which can reach the services).
 *
 * - OSRM routes (planned on OpenStreetMap, like the map) are the reference.
 * - "drawn apart": each OSRM route redrawn the way another map would have it (simplified, and
 *   wandering up to about 9 m to either side), then lined up again with src/routing/align.ts on
 *   the OpenFreeMap road tiles the map draws. It should land back on the OSRM route.
 * - TomTom routes (with a key): as TomTom draws them and lined up.
 *
 * For each line: metres to the nearest map road going its way every 5 m, and for the lined-up
 * lines the metres to the reference route. Writes report.md, routes.json and shots.json for
 * route-align-shots.cjs.
 *
 *   TT_KEY=... npx vite-node scripts/dev/route-align.ts <out dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { destination, LocalFrame, Polyline, type LngLat } from '../../src/geo/geo';
import { OFM_TILES } from '../../src/map/techStyle';
import { RoadTiles } from '../../src/map/roadTiles';
import { alignLine, type RoadSet } from '../../src/routing/align';

const OUT = process.argv[2] ?? 'route-align';
mkdirSync(OUT, { recursive: true });
const KEY = (process.env.TT_KEY ?? '').trim();

const TRIPS: [string, LngLat, LngLat][] = [
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

async function getJson(url: string, tries = 3): Promise<any> {
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

async function osrm(a: LngLat, b: LngLat): Promise<LngLat[]> {
  const j = await getJson(`https://router.project-osrm.org/route/v1/driving/${a[0]},${a[1]};${b[0]},${b[1]}?overview=full&geometries=geojson&steps=false`);
  return j.routes[0].geometry.coordinates;
}

async function tomtom(family: 'classic' | 'orbis', a: LngLat, b: LngLat): Promise<LngLat[]> {
  const q = new URLSearchParams({ key: KEY, travelMode: 'car', routeType: 'fastest', instructionsType: 'coded' });
  if (family === 'orbis') {
    q.set('apiVersion', '2');
    q.set('traffic', 'live');
  } else q.set('traffic', 'true');
  const path = family === 'orbis' ? '/maps/orbis/routing/calculateRoute' : '/routing/1/calculateRoute';
  const j = await getJson(`https://api.tomtom.com${path}/${a[1]},${a[0]}:${b[1]},${b[0]}/json?${q}`, 2);
  return j.routes[0].legs.flatMap((l: { points: { latitude: number; longitude: number }[] }) => l.points.map((p) => [p.longitude, p.latitude] as LngLat));
}

/* ------------------------------------------------------------------ "another map's" line */

function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

/** Douglas-Peucker in local metres. */
function simplify(pts: LngLat[], tol: number): LngLat[] {
  const f = new LocalFrame(pts[0]);
  const xy = pts.map((p) => f.toXY(p));
  const keep = new Array(pts.length).fill(false);
  keep[0] = keep[pts.length - 1] = true;
  const stack: [number, number][] = [[0, pts.length - 1]];
  while (stack.length) {
    const [i, j] = stack.pop()!;
    let far = -1;
    let fd = tol;
    const [ax, ay] = xy[i];
    const [bx, by] = xy[j];
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    for (let k = i + 1; k < j; k++) {
      const t = L2 > 0 ? Math.max(0, Math.min(1, ((xy[k][0] - ax) * dx + (xy[k][1] - ay) * dy) / L2)) : 0;
      const d = Math.hypot(xy[k][0] - ax - dx * t, xy[k][1] - ay - dy * t);
      if (d > fd) {
        fd = d;
        far = k;
      }
    }
    if (far > 0) {
      keep[far] = true;
      stack.push([i, far], [far, j]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** The route as another map might draw it: simplified 2.5 m, then up to ~9 m to either side. */
function drawnApart(route: LngLat[], seed: number): LngLat[] {
  const r = rng(seed);
  const [p1, p2, p3] = [r() * 6.3, r() * 6.3, r() * 6.3];
  const line = new Polyline(simplify(route, 2.5));
  const out: LngLat[] = [];
  for (let s = 0; s <= line.length; s += Math.min(25, Math.max(1, line.length - s))) {
    const off = 4 * Math.sin((2 * Math.PI * s) / 700 + p1) + 3 * Math.sin((2 * Math.PI * s) / 230 + p2) + 1.5 * Math.sin(p3);
    const p = line.pointAt(s);
    out.push(destination(p, line.bearingAt(s, 10) + 90, off));
    if (s >= line.length) break;
  }
  // The router's own corners stay corners.
  return out;
}

/* ------------------------------------------------------------------ measuring */

const step = (pts: LngLat[], d: number) => {
  const line = new Polyline(pts);
  const out: { p: LngLat; brg: number }[] = [];
  for (let s = 0; s <= line.length; s += d) out.push({ p: line.pointAt(s), brg: line.bearingAt(Math.max(0, s - 3), 6) });
  return out;
};

/** Metres to the nearest map road going this way (one-way roads in their direction only). */
function toRoad(roads: RoadSet, p: LngLat, brg: number): number {
  const segs = roads.near(p, 40);
  if (!segs) return NaN;
  let best = 40;
  for (const s of segs) {
    const f = new LocalFrame(p);
    const a = f.toXY(s.a);
    const b = f.toXY(s.b);
    const along = Math.abs(((s.brg - brg + 540) % 360) - 180);
    const ok = s.oneway === 1 ? along <= 40 : s.oneway === -1 ? 180 - along <= 40 : along <= 40 || 180 - along <= 40;
    if (!ok) continue;
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, -(a[0] * dx + a[1] * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(a[0] + dx * t, a[1] + dy * t));
  }
  return best;
}

interface Stats {
  median: number;
  p95: number;
  p99: number;
  max: number;
  over3: number;
  over6: number;
  bad: { at: LngLat; len: number; mean: number }[];
}

function stats(d: number[], at: LngLat[]): Stats {
  const ok = d.filter((x) => Number.isFinite(x));
  const sorted = [...ok].sort((a, b) => a - b);
  const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))] ?? NaN;
  const bad: Stats['bad'] = [];
  for (let i = 0; i < d.length; ) {
    if (!(d[i] > 3)) {
      i++;
      continue;
    }
    let j = i;
    while (j < d.length && d[j] > 3) j++;
    if ((j - i) * 5 >= 20) bad.push({ at: at[(i + j) >> 1], len: (j - i) * 5, mean: d.slice(i, j).reduce((a, b) => a + b, 0) / (j - i) });
    i = j;
  }
  bad.sort((a, b) => b.len * b.mean - a.len * a.mean);
  return { median: q(0.5), p95: q(0.95), p99: q(0.99), max: sorted[sorted.length - 1] ?? NaN, over3: ok.filter((x) => x > 3).length / ok.length, over6: ok.filter((x) => x > 6).length / ok.length, bad };
}

/* ------------------------------------------------------------------ run */

let bytes = 0;
let tilesFetched = 0;
const roads = new RoadTiles({
  tileJson: OFM_TILES,
  maxTiles: 2000,
  fetch: async (input, init) => {
    const r = await fetch(input, init);
    if (String(input).endsWith('.pbf')) {
      const buf = await r.arrayBuffer();
      bytes += buf.byteLength;
      tilesFetched++;
      // Kept with the report, so the lining up can be replayed offline (scripts/dev/route-align-replay.ts).
      const m = String(input).match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      if (m && r.ok) {
        mkdirSync(join(OUT, 'tiles'), { recursive: true });
        writeFileSync(join(OUT, 'tiles', `${m[2]}-${m[3]}.pbf`), new Uint8Array(buf));
      }
      return new Response(buf, { status: r.status });
    }
    return r;
  },
});

const lines: string[] = ['# Route lines against the map roads', ''];
lines.push(KEY ? 'With TomTom routes.' : 'No TomTom key here: OSRM routes, and OSRM routes drawn apart to stand for another map.', '');
lines.push('Metres to the nearest map road going the same way (every 5 m), and for lined-up lines also to the OSRM route.', '');
lines.push('| Trip | Line | km | to road: median | 95% | 99% | >3 m | to OSRM: median | 99% | max | >3 m | ms |', '|---|---|---|---|---|---|---|---|---|---|---|---|');
const routesOut: Record<string, Record<string, LngLat[]>> = {};
const shots: { trip: string; line: string; at: LngLat; len: number; mean: number }[] = [];
const pc = (x: number) => `${(x * 100).toFixed(1)}%`;
const f1 = (x: number) => (Number.isFinite(x) ? x.toFixed(1) : '-');
let seed = 7;

for (const [name, a, b] of TRIPS) {
  const set: Record<string, LngLat[]> = {};
  try {
    set.osrm = await osrm(a, b);
  } catch (e) {
    console.log(name, 'OSRM:', (e as Error).message);
    continue;
  }
  set.apart = drawnApart(set.osrm, seed++);
  if (KEY) {
    for (const fam of ['classic', 'orbis'] as const) {
      try {
        set[`tomtom-${fam}`] = await tomtom(fam, a, b);
      } catch (e) {
        console.log(name, fam, (e as Error).message);
      }
    }
  }
  // Road tiles for everything drawn on this trip.
  const keys = [...new Set(Object.values(set).flatMap((l) => roads.keysFor(l)))];
  await roads.load(keys);
  for (const k of Object.keys(set)) {
    if (k === 'osrm') continue;
    const t0 = performance.now();
    const res = await alignLine(set[k], roads);
    const ms = performance.now() - t0;
    if (res) set[`${k}-aligned`] = res.coords;
    console.log(name, k, res ? `matched ${pc(res.matched)}, unknown ${pc(res.unknown)}, max move ${res.maxMove.toFixed(1)} m, ${res.coords.length} points from ${set[k].length}, ${ms.toFixed(0)} ms` : 'not aligned');
    (set as Record<string, unknown>)[`${k}-ms`] = ms;
  }
  const ref = new Polyline(set.osrm);
  for (const k of Object.keys(set)) {
    if (k.endsWith('-ms')) continue;
    const pts = step(set[k], 5);
    const road = stats(
      pts.map((x) => toRoad(roads, x.p, x.brg)),
      pts.map((x) => x.p),
    );
    const toRef = k === 'osrm' || k.startsWith('tomtom') ? null : stats(pts.map((x) => ref.project(x.p).dist), pts.map((x) => x.p));
    const ms = (set as Record<string, unknown>)[`${k.replace(/-aligned$/, '')}-ms`] as number | undefined;
    lines.push(
      `| ${name} | ${k} | ${(new Polyline(set[k]).length / 1000).toFixed(1)} | ${f1(road.median)} | ${f1(road.p95)} | ${f1(road.p99)} | ${pc(road.over3)} | ${toRef ? f1(toRef.median) : ''} | ${toRef ? f1(toRef.p99) : ''} | ${toRef ? f1(toRef.max) : ''} | ${toRef ? pc(toRef.over3) : ''} | ${k.endsWith('aligned') && ms != null ? ms.toFixed(0) : ''} |`,
    );
    const worst = k.endsWith('aligned') && toRef ? toRef.bad : road.bad;
    for (const w of worst.slice(0, k.endsWith('aligned') ? 3 : 1)) shots.push({ trip: name, line: k, ...w });
  }
  for (const k of Object.keys(set)) if (k.endsWith('-ms')) delete (set as Record<string, unknown>)[k];
  routesOut[name] = set;
}
lines.push('', `Road tiles fetched: ${tilesFetched}, ${(bytes / 1e6).toFixed(1)} MB.`, '');
lines.push('## Worst stretches', '');
for (const s of shots) lines.push(`- ${s.trip}, ${s.line}: ${s.len} m more than 3 m off (mean ${s.mean.toFixed(1)} m) at ${s.at[1].toFixed(5)},${s.at[0].toFixed(5)}`);
writeFileSync(join(OUT, 'report.md'), lines.join('\n') + '\n');
writeFileSync(join(OUT, 'routes.json'), JSON.stringify(routesOut));
// Pictures: the lined-up lines' worst places first.
shots.sort((a, b) => Number(b.line.endsWith('aligned')) - Number(a.line.endsWith('aligned')) || b.len * b.mean - a.len * a.mean);
writeFileSync(join(OUT, 'shots.json'), JSON.stringify(shots.slice(0, 12).map((s, i) => ({ i, trip: s.trip, provider: s.line, at: s.at, len: s.len, mean: s.mean }))));
writeFileSync(
  join(OUT, 'colors.json'),
  JSON.stringify({ osrm: '#16a34a', apart: '#dc2626', 'apart-aligned': '#a21caf', 'tomtom-classic': '#f97316', 'tomtom-classic-aligned': '#2563eb', 'tomtom-orbis': '#eab308', 'tomtom-orbis-aligned': '#0891b2' }),
);
console.log(lines.join('\n'));
