/**
 * Browser check of lining TomTom routes up with the map's roads. TomTom is answered by the check
 * with a route drawn apart from the real roads (from route-align's report: an OSRM route moved up
 * to ~9 m to either side, the way another map would have it), and the map's road tiles are the
 * real OpenFreeMap tiles saved by that report.
 *
 *   A. All tiles at once: the route comes back on the map's roads, guidance positions with it.
 *   B. One tile late: the route comes back lined up as far as the tiles go, and the rest follows
 *      while the routes are on offer.
 *   C. One tile late and the drive started at once: the drive goes over to the fully lined-up
 *      route quietly (no prompt said again).
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-align
 *   npx vite preview --outDir dist-align --port 4181 &
 *   node scripts/dev/align-check.cjs http://localhost:4181/ <report dir with routes.json and tiles/> <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync, readFileSync, existsSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4181/';
const DATA = process.argv[3] ?? 'route-align';
const OUT = process.argv[4] ?? 'align-shots';
mkdirSync(OUT, { recursive: true });
const TRIP = 'KL Sentral to Bukit Bintang';
const routes = JSON.parse(readFileSync(join(DATA, 'routes.json'), 'utf8'))[TRIP];
const truth = routes.osrm;
const apart = routes.apart;

const R = 6371008.8;
const rad = (d) => (d * Math.PI) / 180;
const metres = (a, b) => {
  const kx = R * rad(1) * Math.cos(rad((a[1] + b[1]) / 2));
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * R * rad(1));
};
const bearing = (a, b) => (Math.atan2((b[0] - a[0]) * Math.cos(rad(a[1])), b[1] - a[1]) * 180) / Math.PI;
function distTo(p, line) {
  let best = Infinity;
  const kx = R * rad(1) * Math.cos(rad(p[1]));
  const ky = R * rad(1);
  for (let i = 0; i + 1 < line.length; i++) {
    const ax = (line[i][0] - p[0]) * kx;
    const ay = (line[i][1] - p[1]) * ky;
    const bx = (line[i + 1][0] - p[0]) * kx;
    const by = (line[i + 1][1] - p[1]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(ax + dx * t, ay + dy * t));
  }
  return best;
}
const tile = (p) => {
  const n = 2 ** 14;
  return `${Math.floor(((p[0] + 180) / 360) * n)}-${Math.floor(((1 - Math.log(Math.tan(rad(p[1])) + 1 / Math.cos(rad(p[1]))) / Math.PI) / 2) * n)}`;
};

/** TomTom's answer: the drawn-apart line, turns at its two sharpest corners. */
function ttAnswer() {
  const pts = apart.map(([lon, lat]) => ({ latitude: +lat.toFixed(6), longitude: +lon.toFixed(6) }));
  const cum = [0];
  for (let i = 1; i < apart.length; i++) cum.push(cum[i - 1] + metres(apart[i - 1], apart[i]));
  const L = cum[cum.length - 1];
  const turns = [];
  for (let i = 2; i + 2 < apart.length; i++) {
    let a = bearing(apart[i], apart[i + 2]) - bearing(apart[i - 2], apart[i]);
    a = ((a + 540) % 360) - 180;
    turns.push({ i, a });
  }
  const sharp = turns.sort((x, y) => Math.abs(y.a) - Math.abs(x.a)).filter((t, k, all) => all.slice(0, k).every((u) => Math.abs(u.i - t.i) > 10)).slice(0, 2).sort((x, y) => x.i - y.i);
  const ins = (i, extra) => ({ point: pts[i], pointIndex: i, routeOffsetInMeters: Math.round(cum[i]), travelTimeInSeconds: Math.round(cum[i] / 8), drivingSide: 'LEFT', ...extra });
  const T = Math.round(L / 8);
  return {
    formatVersion: '0.0.12',
    routes: [
      {
        summary: { lengthInMeters: Math.round(L), travelTimeInSeconds: T, trafficDelayInSeconds: 0, noTrafficTravelTimeInSeconds: T },
        legs: [{ summary: { lengthInMeters: Math.round(L), travelTimeInSeconds: T }, points: pts }],
        sections: [],
        guidance: {
          instructions: [
            ins(0, { instructionType: 'LOCATION_DEPARTURE', maneuver: 'DEPART', street: 'Jalan Sultan Abdul Samad' }),
            ...sharp.map((t) => ins(t.i, { instructionType: 'TURN', maneuver: t.a < 0 ? 'TURN_LEFT' : 'TURN_RIGHT', turnAngleInDecimalDegrees: Math.round(t.a), street: 'Jalan Test', junctionType: 'REGULAR' })),
            ins(pts.length - 1, { instructionType: 'LOCATION_ARRIVAL', maneuver: 'ARRIVE' }),
          ],
        },
      },
    ],
  };
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cors = { 'Access-Control-Allow-Origin': '*' };
const keys = [...new Set(apart.map(tile))];
const lateTile = keys[keys.length - 1];
const glyphs = Buffer.alloc(0);

async function open(browser, late) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, geolocation: { latitude: apart[0][1], longitude: apart[0][0] }, permissions: ['geolocation'] });
  const seen = { tiles: 0, route: 0 };
  await ctx.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.includes('api.tomtom.com')) {
      if (u.includes('/calculateRoute/') && r.request().method() === 'GET') {
        seen.route++;
        return r.fulfill({ json: ttAnswer(), headers: cors });
      }
      if (u.includes('/calculateRoute/')) return r.fulfill({ json: { routes: [{ summary: { travelTimeInSeconds: 600, trafficDelayInSeconds: 0 } }] }, headers: cors });
      if (u.includes('incidents')) return r.fulfill({ json: { incidents: [] }, headers: cors });
      if (u.includes('reverseGeocode')) return r.fulfill({ json: { addresses: [{ address: { streetName: 'Jalan Test', municipality: 'Kuala Lumpur' } }] }, headers: cors });
      return r.fulfill({ status: 204, body: '', headers: cors });
    }
    if (u.includes('tiles.openfreemap.org')) {
      if (u.endsWith('/planet')) {
        const layers = ['transportation', 'transportation_name', 'building', 'place', 'water', 'water_name', 'waterway', 'landuse', 'landcover', 'park', 'aeroway', 'aerodrome_label', 'boundary', 'poi', 'housenumber', 'mountain_peak'];
        return r.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, vector_layers: layers.map((id) => ({ id, fields: {} })) }, headers: cors });
      }
      const m = u.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf$/);
      if (m && m[1] === '14' && existsSync(join(DATA, 'tiles', `${m[2]}-${m[3]}.pbf`))) {
        seen.tiles++;
        if (late && `${m[2]}-${m[3]}` === lateTile) await sleep(4500);
        return r.fulfill({ status: 200, body: readFileSync(join(DATA, 'tiles', `${m[2]}-${m[3]}.pbf`)), contentType: 'application/x-protobuf', headers: cors });
      }
      return r.fulfill({ status: 200, body: glyphs, contentType: 'application/x-protobuf', headers: cors });
    }
    if (u.includes('overpass')) return r.fulfill({ json: { elements: [] }, headers: cors });
    if (u.includes('/route/v1/driving/')) return r.fulfill({ status: 503, body: '', headers: cors });
    if (u.startsWith(BASE)) return r.continue();
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    window.__said = [];
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => window.__said.push(u.text);
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ tomtomKey: 'TEST-KEY', services: 'tomtom', trafficNews: false, trafficIncidents: false, look: 2 }));
  });
  await page.goto(BASE);
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) await guest.click();
  await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });
  return { ctx, page, errors, seen };
}

async function plan(page) {
  await page.evaluate(
    ([a, b]) => {
      const app = window.__app;
      app.setView('browse');
      app.trip.origin = { name: 'KL Sentral', sub: '', lngLat: a };
      app.openDirections({ name: 'Bukit Bintang', sub: 'Test destination', lngLat: b });
    },
    [apart[0], apart[apart.length - 1]],
  );
  await page.waitForFunction(() => window.__app.routes.length > 0 && !window.__app.routesLoading, null, { timeout: 20_000 }).catch(() => {});
}

const routeInfo = (page) =>
  page.evaluate(() => {
    const r = window.__app.view === 'nav' ? window.__app.engine.route : window.__app.routes[0];
    return r && { aligned: r.aligned ?? null, geometry: r.geometry, provider: r.provider, steps: r.steps.map((s) => ({ s: s.s, loc: s.location, type: s.type })), len: r.line.length, legEnd: r.legs[r.legs.length - 1].endS };
  });

/** Metres from points along a line to the true roads (the OSRM route). */
function offTruth(line) {
  const d = [];
  for (let i = 0; i < line.length; i++) d.push(distTo(line[i], truth));
  d.sort((a, b) => a - b);
  return { p50: d[Math.floor(d.length * 0.5)], p95: d[Math.floor(d.length * 0.95)], max: d[d.length - 1] };
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  // ---------------------------------------------------------------- A: all tiles at once
  {
    const { ctx, page, errors } = await open(browser, false);
    await plan(page);
    const r = await routeInfo(page);
    const raw = offTruth(apart);
    const got = r ? offTruth(r.geometry) : null;
    console.log('drawn apart:', JSON.stringify(raw), 'lined up:', JSON.stringify(got));
    check('A: the TomTom route comes back lined up all the way', r && r.provider === 'TomTom' && r.aligned === 'full', r && { aligned: r.aligned, provider: r.provider });
    check('A: it sits on the roads (95% within 1 m, was up to 9 m off)', got && got.p95 < 1 && raw.p95 > 5, { raw, got });
    const stepOff = r ? Math.max(...r.steps.map((s) => distTo(s.loc, r.geometry))) : Infinity;
    check('A: the turns sit on the new line, the end where it ends', r && stepOff < 0.5 && Math.abs(r.legEnd - r.len) < 0.01 && r.steps.length === 4, { stepOff, steps: r?.steps.length });
    // Where the drawn line was furthest off: the map with the app's own route on it.
    let worst = 0;
    let at = apart[0];
    for (const p of apart) {
      const d = distTo(p, truth);
      if (d > worst) {
        worst = d;
        at = p;
      }
    }
    await page.evaluate((c) => window.__app.map.map.jumpTo({ center: c, zoom: 17.6 }), at);
    await page.waitForFunction(() => window.__app.map.map.loaded(), null, { timeout: 10_000 }).catch(() => {});
    await sleep(1200);
    await page.screenshot({ path: join(OUT, 'A-routes-close.png') });

    await page.evaluate(() => {
      const app = window.__app;
      app.selectRoute(0);
      app.startNav(true);
      app.sim.paused = false;
    });
    await sleep(3500);
    const nav = await page.evaluate(() => {
      const p = window.__app.engine.progress;
      return p && { onRoute: p.onRoute, s: p.s, snapped: p.snapped };
    });
    const r2 = await routeInfo(page);
    check('A: guidance runs on the lined-up route', nav && nav.onRoute && nav.s > 0 && r2.aligned === 'full' && distTo(nav.snapped, r2.geometry) < 0.5, nav);
    await page.screenshot({ path: join(OUT, 'A-drive.png') });
    check('A: no page errors', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ---------------------------------------------------------------- B: one tile late, still planning
  {
    const { ctx, page, errors } = await open(browser, true);
    const t0 = Date.now();
    await plan(page);
    const first = await routeInfo(page);
    const waited = Date.now() - t0;
    check('B: routes come back without waiting for the late tile', first && waited < 4500, { waited });
    check('B: lined up as far as the tiles go', first && first.aligned === 'partial', first && first.aligned);
    await page.waitForFunction(() => window.__app.routes[0]?.aligned === 'full', null, { timeout: 15_000 }).catch(() => {});
    const later = await routeInfo(page);
    const got = later ? offTruth(later.geometry) : null;
    check('B: the rest follows while the routes are on offer', later && later.aligned === 'full' && got.p95 < 1, { aligned: later?.aligned, got });
    check('B: no page errors', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ---------------------------------------------------------------- C: one tile late, driving already
  {
    const { ctx, page, errors } = await open(browser, true);
    await plan(page);
    const first = await routeInfo(page);
    await page.evaluate(() => {
      const app = window.__app;
      app.startNav(true);
      app.sim.paused = false;
    });
    await page.evaluate(() => (window.__startRoute = window.__app.engine.route));
    await page.waitForFunction(() => window.__app.engine.route?.aligned === 'full', null, { timeout: 15_000 }).catch(() => {});
    await sleep(1500);
    const after = await page.evaluate(() => {
      const app = window.__app;
      const p = app.engine.progress;
      return { aligned: app.engine.route?.aligned, swapped: app.engine.route !== window.__startRoute, view: app.view, said: [...window.__said], onRoute: p?.onRoute, s: p?.s, shown: app.routes[0] === app.engine.route };
    });
    check('C: the drive started on the partly lined-up route', first && first.aligned === 'partial', first && first.aligned);
    check('C: and went over to the fully lined-up one', after.aligned === 'full' && after.view === 'nav' && after.onRoute && after.shown, after);
    const firstSaid = after.said.find((x) => /turn/i.test(x));
    check('C: quietly (the first instruction is not said again)', after.swapped && firstSaid && after.said.filter((x) => x === firstSaid).length === 1, { swapped: after.swapped, said: after.said });
    await page.screenshot({ path: join(OUT, 'C-drive.png') });
    check('C: no page errors', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  await browser.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
