/**
 * Browser check of the map from TomTom first: TomTom's map is answered by the check with tiles in
 * TomTom's layout made from saved OpenFreeMap tiles (scripts/dev/tt-tiles.cjs), so the style, the
 * switching between TomTom's two map services, the fallback to OpenStreetMap and the lining up of
 * routes with whichever map is shown can be checked without a key.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-ttmap
 *   npx vite preview --outDir dist-ttmap --port 4182 &
 *   node scripts/dev/tomtom-map-check.cjs http://localhost:4182/ <route-align report dir (routes.json, tiles/)> <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync, readFileSync, existsSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { ttTile } = require('./tt-tiles.cjs');

const BASE = process.argv[2] ?? 'http://localhost:4182/';
const DATA = process.argv[3] ?? 'route-align';
const OUT = process.argv[4] ?? 'ttmap-shots';
mkdirSync(OUT, { recursive: true });
const TILES = join(DATA, 'tiles');
const TRIP = 'KL Sentral to Bukit Bintang';
const truth = JSON.parse(readFileSync(join(DATA, 'routes.json'), 'utf8'))[TRIP].osrm;
const A = truth[0];
const B = truth[truth.length - 1];
const VIEW = [101.6955, 3.1405];
const cors = { 'Access-Control-Allow-Origin': '*' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};

/** TomTom's route answer: the OSRM line (so it lies on the roads both maps have). */
function ttRoute() {
  const pts = truth.map(([lon, lat]) => ({ latitude: lat, longitude: lon }));
  const L = 4900;
  return {
    formatVersion: '0.0.12',
    routes: [
      {
        summary: { lengthInMeters: L, travelTimeInSeconds: 600, trafficDelayInSeconds: 0, noTrafficTravelTimeInSeconds: 600 },
        legs: [{ summary: { lengthInMeters: L, travelTimeInSeconds: 600 }, points: pts }],
        sections: [],
        guidance: {
          instructions: [
            { point: pts[0], pointIndex: 0, routeOffsetInMeters: 0, travelTimeInSeconds: 0, maneuver: 'DEPART', instructionType: 'LOCATION_DEPARTURE', street: 'Jalan Test', drivingSide: 'LEFT' },
            { point: pts[pts.length - 1], pointIndex: pts.length - 1, routeOffsetInMeters: L, travelTimeInSeconds: 600, maneuver: 'ARRIVE', instructionType: 'LOCATION_ARRIVAL', drivingSide: 'LEFT' },
          ],
        },
      },
    ],
  };
}

function osrmAnswer() {
  const step = (type, loc) => ({ maneuver: { type, location: loc, bearing_before: 0, bearing_after: 0 }, name: 'OSM Road', distance: 2450, duration: 300, intersections: [{ location: loc, bearings: [0], entry: [true], out: 0 }], driving_side: 'left', mode: 'driving' });
  return { code: 'Ok', routes: [{ distance: 4900, duration: 600, geometry: { type: 'LineString', coordinates: truth }, legs: [{ distance: 4900, duration: 600, summary: 'OSM Road', steps: [step('depart', A), step('arrive', B)] }] }] };
}

/**
 * A page with the app. `mode`: map 'ok' | 'refuse' (403) | 'orbis' (classic 403, Orbis answers)
 * | 'bad' (tiles in another layout); route 'ok' | 'refuse'.
 */
async function open(browser, mode, settings = {}, keepCtx = null) {
  const ctx = keepCtx ?? (await browser.newContext({ viewport: { width: 412, height: 860 }, geolocation: { latitude: VIEW[1], longitude: VIEW[0] }, permissions: ['geolocation'] }));
  const seen = { classic: 0, orbis: 0, ofm: 0, ttZ15: 0, route: 0, osrm: 0 };
  if (!keepCtx) {
    ctx.__mode = mode;
    ctx.__seen = seen;
    await ctx.route('**/*', async (r) => {
      const u = r.request().url();
      const m = ctx.__mode;
      const s = ctx.__seen;
      const tile = u.match(/\/(\d+)\/(\d+)\/(\d+)\.pbf/);
      if (u.includes('api.tomtom.com/map/2/tile/basic/') || u.includes('api.tomtom.com/maps/orbis/display/vector/tile/')) {
        const orbis = u.includes('/orbis/');
        s[orbis ? 'orbis' : 'classic']++;
        if (m.map === 'refuse' || (m.map === 'orbis' && !orbis)) return r.fulfill({ status: 403, body: '<error/>', headers: cors });
        const [, z, x, y] = tile.map(Number);
        if (z === 15) s.ttZ15++;
        if (m.map === 'bad') return r.fulfill({ status: 200, body: readFileSync(join(TILES, readTileName())), headers: cors, contentType: 'application/x-protobuf' });
        const b = ttTile(TILES, z, x, y);
        return r.fulfill({ status: 200, body: b ?? Buffer.alloc(0), headers: cors, contentType: 'application/x-protobuf' });
      }
      if (u.includes('api.tomtom.com')) {
        if (u.includes('/calculateRoute/') && r.request().method() === 'GET') {
          s.route++;
          if (m.route === 'refuse') return r.fulfill({ status: 403, body: '{"error":{"description":"Developer Inactive"}}', headers: cors });
          return r.fulfill({ json: ttRoute(), headers: cors });
        }
        if (u.includes('incidents')) return r.fulfill({ json: { incidents: [] }, headers: cors });
        return r.fulfill({ status: 204, body: '', headers: cors });
      }
      if (u.includes('tiles.openfreemap.org')) {
        if (u.endsWith('/planet')) {
          const layers = ['transportation', 'transportation_name', 'building', 'place', 'water', 'water_name', 'waterway', 'landuse', 'landcover', 'park', 'aeroway', 'boundary', 'poi'];
          return r.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, vector_layers: layers.map((id) => ({ id, fields: {} })) }, headers: cors });
        }
        if (tile && tile[1] === '14' && existsSync(join(TILES, `${tile[2]}-${tile[3]}.pbf`))) {
          s.ofm++;
          return r.fulfill({ status: 200, body: readFileSync(join(TILES, `${tile[2]}-${tile[3]}.pbf`)), headers: cors, contentType: 'application/x-protobuf' });
        }
        return r.fulfill({ status: 200, body: Buffer.alloc(0), headers: cors, contentType: 'application/x-protobuf' });
      }
      if (u.includes('/route/v1/driving/')) {
        s.osrm++;
        return r.fulfill({ json: osrmAnswer(), headers: cors });
      }
      if (u.includes('overpass')) return r.fulfill({ json: { elements: [] }, headers: cors });
      if (u.startsWith(BASE)) return r.continue();
      return r.abort();
    });
  } else {
    keepCtx.__mode = mode;
    Object.assign(keepCtx.__seen, seen);
  }
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((st) => {
    const toasts = (window.__toasts = []);
    document.addEventListener('DOMContentLoaded', () =>
      new MutationObserver(() => document.querySelectorAll('.toast').forEach((t) => toasts.includes(t.textContent) || toasts.push(t.textContent))).observe(document.body, { childList: true, subtree: true, characterData: true }),
    );
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ tomtomKey: 'TEST-KEY', services: 'tomtom', trafficNews: false, trafficMap: false, look: 2, ...st }));
  }, settings);
  await page.goto(BASE);
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) await guest.click();
  await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });
  return { ctx, page, errors, seen: ctx.__seen };
}

/** Any z14 OpenFreeMap tile: the "wrong layout" answer. */
function readTileName() {
  return require('node:fs').readdirSync(TILES).find((f) => f.endsWith('.pbf'));
}

const sources = (page) => page.evaluate(() => Object.keys(window.__app.map.map.getStyle().sources));
const tileUrl = (page) => page.evaluate(() => window.__app.map.map.getStyle().sources.tomtom?.tiles?.[0] ?? null);

async function lookAt(page, center, zoom) {
  await page.evaluate(([c, z]) => window.__app.map.map.jumpTo({ center: c, zoom: z, pitch: 0, bearing: 0 }), [center, zoom]);
  await page.waitForFunction(() => window.__app.map.map.loaded() && window.__app.map.map.areTilesLoaded(), null, { timeout: 20_000 }).catch(() => {});
  await sleep(900);
}

async function plan(page) {
  await page.evaluate(
    ([a, b]) => {
      const app = window.__app;
      app.setView('browse');
      app.trip.origin = { name: 'KL Sentral', sub: '', lngLat: a };
      app.openDirections({ name: 'Bukit Bintang', sub: 'Test destination', lngLat: b });
    },
    [A, B],
  );
  await page.waitForFunction(() => window.__app.routes.length > 0 && !window.__app.routesLoading, null, { timeout: 20_000 }).catch(() => {});
  return page.evaluate(() => {
    const r = window.__app.routes[0];
    return r && { provider: r.provider, aligned: r.aligned ?? null };
  });
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  // ---------------------------------------------------------------- 1: the map from TomTom
  {
    const { ctx, page, errors, seen } = await open(browser, { map: 'ok', route: 'ok' }, { appearance: 'day' });
    await page.waitForFunction(() => !!window.__app.map.map.getStyle().sources.tomtom, null, { timeout: 15_000 }).catch(() => {});
    const src = await sources(page);
    check('the map comes from TomTom (TomTom first, key works)', src.includes('tomtom') && !src.includes('openmaptiles'), src);
    check('the classic map service answered first', seen.classic > 0 && /\/map\/2\/tile\/basic\//.test((await tileUrl(page)) ?? ''), { seen });
    await lookAt(page, VIEW, 16);
    const drawn = await page.evaluate(() => {
      const m = window.__app.map.map;
      const f = m.queryRenderedFeatures().filter((x) => x.source === 'tomtom');
      const by = {};
      for (const x of f) by[x.layer.id] = (by[x.layer.id] ?? 0) + 1;
      return by;
    });
    const roads = Object.keys(drawn).filter((k) => k.startsWith('road-none-')).length;
    // (Road names need the fonts, which this check does not serve.)
    check('roads in three tiers, bridges, buildings, water and land use are drawn from TomTom tiles', roads >= 3 && drawn.building > 0 && drawn['road-bridge-major'] > 0 && drawn.water > 0 && drawn['landuse-urban'] > 0, drawn);
    check('points of interest show with the app’s icons', (drawn.poi ?? 0) > 0, drawn.poi);
    await page.screenshot({ path: join(OUT, '1-tomtom-day.png') });
    await lookAt(page, VIEW, 13.5);
    await page.screenshot({ path: join(OUT, '1-tomtom-day-z13.png') });
    // Pin directions read the roads on the TomTom map.
    await lookAt(page, VIEW, 17);
    const dirs = await page.evaluate(() => {
      const m = window.__app.map;
      const c = m.map.getCanvas();
      const out = [];
      for (let i = 0; i < 9 && !out.length; i++) {
        const pt = { x: c.clientWidth / 2 + (i % 3) * 40 - 40, y: c.clientHeight / 2 + Math.floor(i / 3) * 40 - 40 };
        out.push(...m.roadDirections(pt, 30));
      }
      return out;
    });
    check('a pin finds the road directions on the TomTom map', dirs.length >= 1, dirs);

    // TomTom's route on TomTom's map: no lining up needed.
    const r = await plan(page);
    check('a TomTom route on the TomTom map is left as TomTom drew it', r && r.provider === 'TomTom' && r.aligned === null, r);
    check('no page errors', errors.length === 0, errors.slice(0, 3));
    await page.close();

    // Opened again: straight onto the TomTom map (no OpenStreetMap first).
    const again = await ctx.newPage();
    const firstStyle = [];
    await again.addInitScript(() => {
      const wait = setInterval(() => {
        const m = window.__app?.map?.map;
        if (m?.getStyle?.()) {
          window.__firstSources = Object.keys(m.getStyle().sources);
          clearInterval(wait);
        }
      }, 5);
    });
    await again.goto(BASE);
    const guest = again.getByText('Continue without an account');
    if (await guest.waitFor({ state: 'visible', timeout: 5000 }).then(() => true, () => false)) await guest.click();
    await again.waitForFunction(() => window.__firstSources, null, { timeout: 30_000 }).catch(() => {});
    firstStyle.push(...((await again.evaluate(() => window.__firstSources)) ?? []));
    check('next time the app opens straight on the TomTom map', firstStyle.includes('tomtom'), firstStyle);

    // Night.
    await again.evaluate(() => {
      const app = window.__app;
      app.settings = { ...app.settings, appearance: 'night' };
      app.applyDayNight();
    });
    await again.waitForFunction(() => window.__app.map.map.isStyleLoaded(), null, { timeout: 15_000 }).catch(() => {});
    await lookAt(again, VIEW, 16);
    const nightSrc = await sources(again);
    check('night: still TomTom, in the night colours', nightSrc.includes('tomtom') && /night/.test(await again.evaluate(() => window.__app.map.map.getStyle().name)), nightSrc);
    await again.screenshot({ path: join(OUT, '1-tomtom-night.png') });
    await ctx.close();
  }

  // ---------------------------------------------------------------- 2: classic refused, Orbis answers
  {
    const { ctx, page, errors, seen } = await open(browser, { map: 'orbis', route: 'ok' });
    await page.waitForFunction(() => !!window.__app.map.map.getStyle().sources.tomtom, null, { timeout: 15_000 }).catch(() => {});
    check('a key set up for Orbis only gets the Orbis map', /\/maps\/orbis\/display\/vector\/tile\//.test((await tileUrl(page)) ?? '') && seen.orbis > 0, { url: await tileUrl(page), seen });
    check('no page errors (Orbis)', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ---------------------------------------------------------------- 3: OpenStreetMap routes on the TomTom map
  {
    const { ctx, page, errors, seen } = await open(browser, { map: 'ok', route: 'refuse' });
    await page.waitForFunction(() => !!window.__app.map.map.getStyle().sources.tomtom, null, { timeout: 15_000 }).catch(() => {});
    const r = await plan(page);
    check('when TomTom cannot route, the OSRM route is lined up with the TomTom map', r && r.provider !== 'TomTom' && r.aligned === 'full' && seen.ttZ15 > 0, { r, seen });
    check('no page errors (OSRM on TomTom)', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ---------------------------------------------------------------- 4: TomTom map refused
  {
    const { ctx, page, errors } = await open(browser, { map: 'refuse', route: 'ok' });
    await sleep(2500);
    const src = await sources(page);
    check('a refused key: the map comes from OpenStreetMap', src.includes('openmaptiles') && !src.includes('tomtom'), src);
    const r = await plan(page);
    check('and TomTom routes are lined up with the OpenStreetMap map', r && r.provider === 'TomTom' && r.aligned === 'full', r);
    await lookAt(page, VIEW, 16);
    await page.screenshot({ path: join(OUT, '4-refused-osm.png') });
    check('no page errors (refused)', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ---------------------------------------------------------------- 5: refused while drawing
  {
    const { ctx, page, errors } = await open(browser, { map: 'ok', route: 'ok' });
    await page.waitForFunction(() => !!window.__app.map.map.getStyle().sources.tomtom, null, { timeout: 15_000 }).catch(() => {});
    ctx.__mode = { map: 'refuse', route: 'ok' };
    await lookAt(page, [101.712, 3.157], 15);
    await page.waitForFunction(() => !window.__app.map.map.getStyle().sources.tomtom, null, { timeout: 15_000 }).catch(() => {});
    const src = await sources(page);
    const toasts = await page.evaluate(() => window.__toasts);
    check('tiles refused while drawing: over to the OpenStreetMap map, with a note', src.includes('openmaptiles') && toasts.some((t) => /OpenStreetMap/.test(t)), { src, toasts });
    check('no page errors (refused while drawing)', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ---------------------------------------------------------------- 6: tiles in another layout
  {
    const { ctx, page, errors } = await open(browser, { map: 'bad', route: 'ok' });
    await sleep(2500);
    const src = await sources(page);
    check('tiles not in the expected layout: the OpenStreetMap map', src.includes('openmaptiles') && !src.includes('tomtom'), src);
    check('no page errors (layout)', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  // ---------------------------------------------------------------- 7: OpenStreetMap only
  {
    const { ctx, page, errors, seen } = await open(browser, { map: 'ok', route: 'ok' }, { services: 'open' });
    await sleep(2000);
    const src = await sources(page);
    check('OpenStreetMap only: the map is OpenStreetMap and TomTom is not asked', src.includes('openmaptiles') && seen.classic + seen.orbis === 0, { src, seen });
    check('no page errors (OpenStreetMap only)', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  await browser.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
