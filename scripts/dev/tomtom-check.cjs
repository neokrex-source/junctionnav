/**
 * Browser check of "TomTom first" with TomTom, OSRM, Photon and Overpass all answered by the check
 * itself: place search, route options with traffic and a toll-free choice, guidance on a TomTom
 * route (junction views, lanes), the category buttons, and falling back to the OpenStreetMap
 * services when TomTom refuses the key, then OpenStreetMap only from Settings.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-traffic
 *   npx vite preview --outDir dist-traffic --port 4180 &
 *   node scripts/dev/tomtom-check.cjs http://localhost:4180/ <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4180/';
const OUT = process.argv[3] ?? 'tomtom-shots';
mkdirSync(OUT, { recursive: true });

const O = [101.6869, 3.139];
const P = (x, y) => [O[0] + x / (111320 * Math.cos((O[1] * Math.PI) / 180)), O[1] + y / 111320];
const tt = (p) => ({ latitude: +p[1].toFixed(6), longitude: +p[0].toFixed(6) });

function path(corners) {
  const pts = [];
  const at = [0];
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 25));
    for (let k = 0; k < n; k++) pts.push(P(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
    at.push(pts.length);
  }
  pts.push(P(...corners[corners.length - 1]));
  return { pts, at };
}
const len = (c) => c.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - c[i][0], p[1] - c[i][1]), 0);

/** A TomTom route over the corners, with an instruction at each inner corner. */
function ttRoute(corners, opts) {
  const { pts, at } = path(corners);
  const L = len(corners);
  const T = opts.time;
  let off = 0;
  const offs = [0];
  for (let i = 1; i < corners.length; i++) offs.push((off += Math.hypot(corners[i][0] - corners[i - 1][0], corners[i][1] - corners[i - 1][1])));
  const ins = opts.instructions.map((x, k) => ({
    point: tt(pts[Math.min(at[k], pts.length - 1)]),
    pointIndex: Math.min(at[k], pts.length - 1),
    routeOffsetInMeters: Math.round(offs[k]),
    travelTimeInSeconds: Math.round((offs[k] / L) * T),
    drivingSide: 'LEFT',
    ...x,
  }));
  return {
    summary: { lengthInMeters: Math.round(L), travelTimeInSeconds: T, trafficDelayInSeconds: opts.delay, noTrafficTravelTimeInSeconds: T - opts.delay },
    legs: [{ summary: { lengthInMeters: Math.round(L), travelTimeInSeconds: T }, points: pts.map(tt) }],
    sections: opts.sections(at),
    guidance: { instructions: ins },
  };
}

const MAIN_C = [[0, 0], [0, 2000], [-400, 3500], [-400, 6000], [-700, 6600], [-700, 6900], [-200, 6900]];
const MAIN = ttRoute(MAIN_C, {
  time: 780,
  delay: 180,
  sections: (at) => [
    { startPointIndex: at[1], endPointIndex: at[3], sectionType: 'MOTORWAY' },
    { startPointIndex: at[1], endPointIndex: at[3], sectionType: 'TOLL' },
    { startPointIndex: at[1] - 2, endPointIndex: at[1], sectionType: 'LANES', lanes: [{ directions: ['SLIGHT_LEFT'], follow: 'SLIGHT_LEFT' }, { directions: ['STRAIGHT', 'SLIGHT_LEFT'], follow: 'SLIGHT_LEFT' }, { directions: ['STRAIGHT'] }] },
  ],
  instructions: [
    { instructionType: 'LOCATION_DEPARTURE', maneuver: 'DEPART', street: 'Jalan Ampang' },
    { instructionType: 'TURN', maneuver: 'KEEP_LEFT', junctionType: 'BIFURCATION', turnAngleInDecimalDegrees: -20, street: 'Lebuhraya Utara-Selatan', roadNumbers: ['E1'], signpostText: 'Kuala Lumpur' },
    { instructionType: 'DIRECTION_INFO', maneuver: 'FOLLOW', street: 'Lebuhraya Utara-Selatan', roadNumbers: ['E1'] },
    { instructionType: 'TURN', maneuver: 'MOTORWAY_EXIT_LEFT', exitNumber: '234', street: 'Jalan Duta', signpostText: 'Jalan Duta' },
    { instructionType: 'TURN', maneuver: 'TURN_RIGHT', turnAngleInDecimalDegrees: 90, street: 'Jalan Kuching', junctionType: 'REGULAR' },
    { instructionType: 'TURN', maneuver: 'TURN_RIGHT', turnAngleInDecimalDegrees: 90, street: 'Jalan Ipoh', junctionType: 'REGULAR' },
    { instructionType: 'LOCATION_ARRIVAL', maneuver: 'ARRIVE_LEFT' },
  ],
});
const ALT = ttRoute([[0, 0], [0, 1000], [700, 3000], [700, 6900], [-200, 6900]], {
  time: 900,
  delay: 60,
  sections: (at) => [{ startPointIndex: at[2], endPointIndex: at[3], sectionType: 'TOLL' }],
  instructions: [
    { instructionType: 'LOCATION_DEPARTURE', maneuver: 'DEPART', street: 'Jalan Ampang' },
    { instructionType: 'TURN', maneuver: 'KEEP_RIGHT', junctionType: 'BIFURCATION', turnAngleInDecimalDegrees: 25, street: 'Jalan Tun Razak' },
    { instructionType: 'TURN', maneuver: 'BEAR_LEFT', turnAngleInDecimalDegrees: -30, street: 'Jalan Pahang' },
    { instructionType: 'TURN', maneuver: 'TURN_LEFT', turnAngleInDecimalDegrees: -90, street: 'Jalan Ipoh' },
    { instructionType: 'LOCATION_ARRIVAL', maneuver: 'ARRIVE' },
  ],
});
const FREE = ttRoute([[0, 0], [-900, 1500], [-900, 6900], [-200, 6900]], {
  time: 1080,
  delay: 240,
  sections: () => [],
  instructions: [
    { instructionType: 'LOCATION_DEPARTURE', maneuver: 'DEPART', street: 'Jalan Ampang' },
    { instructionType: 'TURN', maneuver: 'TURN_LEFT', turnAngleInDecimalDegrees: -60, street: 'Jalan Raja Laut' },
    { instructionType: 'TURN', maneuver: 'TURN_RIGHT', turnAngleInDecimalDegrees: 90, street: 'Jalan Ipoh' },
    { instructionType: 'LOCATION_ARRIVAL', maneuver: 'ARRIVE' },
  ],
});

/** OSRM's answer for the fallback: one plain route. */
function osrm() {
  const { pts } = path(MAIN_C);
  const step = (type, loc, d, modifier, name) => ({ maneuver: { type, modifier, location: loc, bearing_before: 0, bearing_after: 0 }, name, distance: d, duration: d / 12, intersections: [{ location: loc, bearings: [0], entry: [true], out: 0 }], driving_side: 'left', mode: 'driving' });
  const L = len(MAIN_C);
  return { code: 'Ok', routes: [{ distance: L, duration: L / 12, geometry: { type: 'LineString', coordinates: pts }, legs: [{ distance: L, duration: L / 12, summary: 'OSM Road', steps: [step('depart', pts[0], L, undefined, 'OSM Road'), step('arrive', pts[pts.length - 1], 0, 'left', '')] }] }] };
}

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, geolocation: { latitude: O[1], longitude: O[0] }, permissions: ['geolocation'] });
  const calls = { route: [], search: [], nearby: 0, osrm: 0, photon: 0, overpass: 0, refuse: false };
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await ctx.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.includes('api.tomtom.com')) {
      const url = new URL(u);
      if (u.includes('/calculateRoute/')) {
        // Route planning (GET) apart from the traffic feature's travel times (POST along a route).
        if (r.request().method() === 'POST') calls.travel = (calls.travel ?? 0) + 1;
        else calls.route.push(u);
        if (calls.refuse) return r.fulfill({ status: 403, body: '{"error":{"description":"Developer Inactive"}}', headers: cors });
        if (r.request().method() === 'POST') return r.fulfill({ json: { routes: [{ summary: { travelTimeInSeconds: 780, trafficDelayInSeconds: 180 } }] }, headers: cors });
        const avoidTolls = url.searchParams.getAll('avoid').includes('tollRoads');
        const alts = Number(url.searchParams.get('maxAlternatives') ?? 0);
        return r.fulfill({ json: { formatVersion: '0.0.12', routes: avoidTolls ? [FREE] : alts ? [MAIN, ALT] : [MAIN] }, headers: cors });
      }
      if (url.pathname.startsWith('/search/2/search/')) {
        calls.search.push(u);
        if (calls.refuse) return r.fulfill({ status: 403, body: '{}', headers: cors });
        return r.fulfill({ json: { results: [{ type: 'POI', poi: { name: 'Suria KLCC (TomTom)', categories: ['shopping center'] }, address: { streetName: 'Jalan Ampang', municipality: 'Kuala Lumpur' }, position: { lat: 3.158, lon: 101.712 } }] }, headers: cors });
      }
      if (url.pathname.startsWith('/search/2/nearbySearch')) {
        calls.nearby++;
        return r.fulfill({ json: { results: [{ id: 'f1', type: 'POI', poi: { name: 'Petronas Jalan Ampang (TomTom)', brands: [{ name: 'Petronas' }] }, address: { streetName: 'Jalan Ampang' }, position: { lat: O[1] + 0.003, lon: O[0] + 0.002 } }] }, headers: cors });
      }
      if (url.pathname.startsWith('/search/2/reverseGeocode')) return r.fulfill({ json: { addresses: [{ address: { streetName: 'Jalan Ampang', municipality: 'Kuala Lumpur' } }] }, headers: cors });
      if (u.includes('incidents')) return r.fulfill({ json: { incidents: [] }, headers: cors });
      return r.fulfill({ status: 204, body: '', headers: cors });
    }
    if (u.includes('/route/v1/driving/')) {
      calls.osrm++;
      return r.fulfill({ json: osrm(), headers: cors });
    }
    if (u.includes('photon.komoot.io')) {
      calls.photon++;
      return r.fulfill({ json: { features: [{ geometry: { coordinates: [101.712, 3.158] }, properties: { name: 'Suria KLCC (Photon)', city: 'Kuala Lumpur' } }] }, headers: cors });
    }
    if (u.includes('overpass')) {
      calls.overpass++;
      return r.fulfill({ json: { elements: [] }, headers: cors });
    }
    if (u.includes('tiles.openfreemap.org')) {
      const layers = ['transportation', 'transportation_name', 'building', 'place', 'water', 'water_name', 'waterway', 'landuse', 'landcover', 'park', 'aeroway', 'aerodrome_label', 'boundary', 'poi', 'housenumber', 'mountain_peak'];
      if (u.endsWith('/planet')) return r.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, vector_layers: layers.map((id) => ({ id, fields: {} })) } });
      return r.fulfill({ status: 200, body: Buffer.alloc(0), contentType: 'application/x-protobuf' });
    }
    if (u.startsWith(BASE)) return r.continue();
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ tomtomKey: 'TEST-KEY', services: 'tomtom', trafficNews: false, look: 2 }));
  });
  const shot = (n) => page.screenshot({ path: join(OUT, `${n}.png`) });
  await page.goto(BASE);
  if (await page.locator('#auth-tab-signup').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
    await page.click('#auth-tab-signup');
    await page.fill('#auth-name', 'Anuar');
    await page.fill('#auth-email', 'tomtom@example.com');
    await page.fill('#auth-password', 'Junction2026');
    await page.click('.auth-submit');
    await page.waitForSelector('.auth', { state: 'hidden', timeout: 30_000 });
  }
  await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });

  // ---- place search from TomTom
  await page.fill('#q', 'suria');
  await page.waitForFunction(() => [...document.querySelectorAll('.suggest button .s-name')].some((e) => /Suria/.test(e.textContent)), null, { timeout: 10_000 }).catch(() => {});
  const sugg = await page.evaluate(() => [...document.querySelectorAll('.suggest button .s-name')].map((e) => e.textContent));
  await shot('1-search');
  check('place search comes from TomTom', sugg.includes('Suria KLCC (TomTom)') && calls.photon === 0, { sugg, photon: calls.photon });
  await page.fill('#q', '');
  await page.keyboard.press('Escape');

  // ---- category button nearby from TomTom
  await page.click('.chips .cat-chip >> nth=0');
  await page.waitForFunction(() => window.__app.results?.length > 0, null, { timeout: 10_000 }).catch(() => {});
  const cat = await page.evaluate(() => window.__app.results.map((r) => r.name));
  await shot('2-petrol-nearby');
  check('petrol nearby comes from TomTom', cat.includes('Petronas Jalan Ampang (TomTom)') && calls.nearby > 0 && calls.overpass === 0, { cat, overpass: calls.overpass });
  await page.evaluate(() => window.__app.closePlace?.());

  // ---- routes from TomTom, with traffic and a toll-free choice
  const plan = async () => {
    await page.evaluate(([a, b]) => {
      const app = window.__app;
      app.setView('browse');
      app.trip.origin = { name: 'Start', sub: '', lngLat: a };
      app.openDirections({ name: 'Jalan Ipoh', sub: 'Test destination', lngLat: b });
    }, [P(0, 0), P(-200, 6900)]);
    await page.waitForFunction(() => window.__app.routes.length > 0 && !window.__app.routesLoading, null, { timeout: 20_000 }).catch(() => {});
    await sleep(500);
    return page.evaluate(() => ({
      providers: window.__app.routes.map((r) => r.provider),
      labels: [...document.querySelectorAll('.route-opt .r-label')].map((e) => e.textContent),
      traffic: [...document.querySelectorAll('.route-opt .r-traffic')].map((e) => e.textContent),
      times: [...document.querySelectorAll('.route-opt .r-time')].map((e) => e.textContent),
      src: document.querySelector('.routes-src')?.textContent ?? null,
    }));
  };
  const t1 = await plan();
  await shot('3-routes-tomtom');
  check('routes come from TomTom', t1.providers.every((p) => p === 'TomTom') && t1.providers.length === 3, t1);
  check('route options: fastest, alternative and toll-free', JSON.stringify(t1.labels) === JSON.stringify(['Fastest', 'Alternative', 'Toll-free']), t1.labels);
  check("route times and traffic come from TomTom's own answer", t1.times[0] === '13 min' && t1.traffic[0] === '+3 min traffic', t1);
  check('the routes say who planned them', /Routes by TomTom, with live traffic/.test(t1.src ?? ''), t1.src);
  const firstUrl = new URL(calls.route[0]);
  check('TomTom asked for traffic, lanes and alternatives', firstUrl.searchParams.get('traffic') === 'true' && firstUrl.searchParams.getAll('sectionType').includes('lanes') && calls.route.some((u) => new URL(u).searchParams.get('maxAlternatives') === '2'), calls.route.slice(0, 2));
  check('no extra travel-time requests for TomTom routes', !calls.travel, calls.travel);

  // ---- guidance on the TomTom route
  await page.evaluate(() => {
    const app = window.__app;
    app.selectRoute(0);
    app.startNav(true);
    app.sim.paused = true;
  });
  await page.waitForFunction(() => window.__app.engine.progress, null, { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => {
    const app = window.__app;
    app.sim.paused = false;
    app.sim.jumpTo(1850);
  });
  await page.waitForFunction(() => (window.__app.engine.progress?.s ?? 0) > 1800, null, { timeout: 10_000 }).catch(() => {});
  await page.evaluate(() => (window.__app.sim.paused = true));
  await sleep(1500);
  const nav = await page.evaluate(() => {
    const app = window.__app;
    const p = app.engine.progress;
    return {
      junctions: app.engine.junctions.map((j) => j.kind),
      banner: document.querySelector('.banner')?.textContent ?? '',
      lane: p?.lane ? { from: p.lane.target.from, to: p.lane.target.to, count: p.lane.target.count, known: p.lane.target.known } : null,
      jv: !!document.querySelector('.jv:not([hidden])'),
      etaSub: document.querySelector('.eta-sub')?.textContent,
    };
  });
  await shot('4-guidance-tomtom');
  check('junction views on the TomTom route (fork and exit)', JSON.stringify(nav.junctions) === JSON.stringify(['fork', 'exit']), nav.junctions);
  check('banner reads the TomTom instruction', /Kuala Lumpur/.test(nav.banner) && /Keep left/i.test(nav.banner), nav.banner);
  check("lane advice from TomTom's lanes", nav.lane && nav.lane.known && nav.lane.count === 3 && nav.lane.from === 0 && nav.lane.to === 1, nav.lane);
  check('arrival shows the traffic TomTom counted', /\+\d+ min traffic/.test(nav.etaSub ?? ''), nav.etaSub);
  await page.evaluate(() => window.__app.endNav());
  await page.waitForFunction(() => window.__app.view === 'directions', null, { timeout: 10_000 }).catch(() => {});
  await sleep(800);

  // ---- TomTom refuses the key: OpenStreetMap services take over
  calls.refuse = true;
  const osrmBefore = calls.osrm;
  const t2 = await plan();
  await shot('5-routes-fallback');
  check('when TomTom refuses, OSRM plans the routes', t2.providers[0] === 'OSRM' && calls.osrm > osrmBefore, t2);
  check('and the routes say why', /TomTom could not plan this \(key refused/.test(t2.src ?? ''), t2.src);
  const askedBefore = calls.route.length;
  const travelBefore = calls.travel ?? 0;
  const t3 = await plan();
  check('TomTom rests after refusing (routing and traffic not asked again straight away)', calls.route.length === askedBefore && (calls.travel ?? 0) === travelBefore && t3.providers[0] === 'OSRM' && /for now/.test(t3.src ?? ''), {
    asked: calls.route.length - askedBefore,
    travel: (calls.travel ?? 0) - travelBefore,
    src: t3.src,
  });
  await page.evaluate(() => window.__app.closeDirections?.());
  await page.fill('#q', 'suria');
  await page.waitForFunction(() => [...document.querySelectorAll('.suggest button .s-name')].some((e) => /Suria/.test(e.textContent)), null, { timeout: 10_000 }).catch(() => {});
  const sugg2 = await page.evaluate(() => [...document.querySelectorAll('.suggest button .s-name')].map((e) => e.textContent));
  check('search falls back to Photon while TomTom rests', sugg2.includes('Suria KLCC (Photon)'), sugg2);
  await page.fill('#q', '');

  // ---- OpenStreetMap services only
  calls.refuse = false;
  await page.evaluate(() => {
    const app = window.__app;
    app.settings = { ...app.settings, services: 'open' };
    app.ttGate.reset();
  });
  const asked2 = calls.route.length;
  const t4 = await plan();
  check('OpenStreetMap only: OSRM routes, TomTom not asked', t4.providers[0] === 'OSRM' && calls.route.length === asked2 && !t4.src, { t4, asked: calls.route.length - asked2 });
  // And back to TomTom first.
  await page.evaluate(() => {
    const app = window.__app;
    app.settings = { ...app.settings, services: 'tomtom' };
    app.ttGate.reset();
  });
  const t5 = await plan();
  check('back to TomTom first', t5.providers[0] === 'TomTom', t5);

  check('no page errors', !errors.filter((e) => !/Failed to load resource|ERR_|net::|403|503/.test(e)).length, errors.slice(0, 6));
  console.log('calls', { route: calls.route.length, search: calls.search.length, nearby: calls.nearby, osrm: calls.osrm, photon: calls.photon, overpass: calls.overpass });
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 1));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
