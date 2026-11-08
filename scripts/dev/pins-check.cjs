/**
 * Browser check of your pins: the pin button and its crosshair (tap the map to place it), the
 * direction of travel (along the road under it both ways, any, or turned by hand on the ring), the
 * pin on the map with its ground arrow and its card, dragging it, a long-press, the pins in the
 * search list, choosing a directions point on the map with a heading (the router is asked to
 * arrive that way, and the route sheet says so), removing pins, the Settings section, and the
 * developer credit on the splash and in Settings.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-traffic
 *   npx vite preview --outDir dist-traffic --port 4180 &
 *   node scripts/dev/pins-check.cjs http://localhost:4180/ <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4180/';
const OUT = process.argv[3] ?? 'pins-shots';
mkdirSync(OUT, { recursive: true });

const KL = [101.6869, 3.139];
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** A straight OSRM route between the first and last point of the request. */
function osrmRoute(url) {
  const coords = decodeURIComponent(new URL(url).pathname.split('/').pop()).split(';').map((c) => c.split(',').map(Number));
  const a = coords[0];
  const b = coords[coords.length - 1];
  const d = Math.hypot((b[0] - a[0]) * 111150, (b[1] - a[1]) * 110574);
  const step = (type, at, dist, bb, ba) => ({ distance: dist, duration: dist / 10, name: 'Jalan Ujian', mode: 'driving', driving_side: 'left', maneuver: { type, location: at, bearing_before: bb, bearing_after: ba }, intersections: [{ location: at, bearings: [ba], entry: [true], out: 0 }] });
  return { code: 'Ok', routes: [{ distance: d, duration: d / 10, geometry: { type: 'LineString', coordinates: [a, b] }, legs: [{ steps: [step('depart', a, d, 0, 90), step('arrive', b, 0, 90, 0)], summary: 'Jalan Ujian', distance: d, duration: d / 10 }] }], waypoints: [] };
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, geolocation: { latitude: KL[1], longitude: KL[0] }, permissions: ['geolocation'] });
  const calls = { osrm: [], reverse: 0 };
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await ctx.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.includes('photon.komoot.io')) {
      if (u.includes('/reverse')) calls.reverse++;
      const q = new URL(u);
      const lon = Number(q.searchParams.get('lon') ?? KL[0]);
      const lat = Number(q.searchParams.get('lat') ?? KL[1]);
      return r.fulfill({ json: { features: [{ geometry: { coordinates: [lon, lat] }, properties: { name: 'Jalan Ujian', city: 'Kuala Lumpur' } }] }, headers: cors });
    }
    if (u.includes('/route/v1/driving/')) {
      calls.osrm.push(u);
      return r.fulfill({ json: osrmRoute(u), headers: cors });
    }
    if (u.includes('tiles.openfreemap.org')) {
      const layers = ['transportation', 'transportation_name', 'building', 'place', 'water', 'water_name', 'waterway', 'landuse', 'landcover', 'park', 'aeroway', 'aerodrome_label', 'boundary', 'poi', 'housenumber', 'mountain_peak'];
      if (u.endsWith('/planet')) return r.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, vector_layers: layers.map((id) => ({ id, fields: {} })) } });
      return r.fulfill({ status: 200, body: Buffer.alloc(0), contentType: 'application/x-protobuf' });
    }
    if (u.startsWith('https://places.test/')) return r.fulfill({ status: 404, body: '', headers: cors });
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
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ services: 'open', trafficNews: false, trafficMap: false, look: 2, appearance: 'day', placesOnMap: false }));
  });
  const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
  const html = await (await ctx.request.get(BASE)).text();
  check('the splash credits the developer', /Developed by <b>Dr\. Mohd Anuaruddin Ahmadon<\/b><br \/>Universiti Teknologi PETRONAS/.test(html) && /<meta name="author" content="Dr\. Mohd Anuaruddin Ahmadon, Universiti Teknologi PETRONAS"/.test(html));
  await page.goto(BASE);
  if (await page.locator('#auth-tab-signup').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
    const credit = await page.locator('.auth-credit').textContent().catch(() => '');
    check('the sign-in screen credits the developer', /Developed by Dr\. Mohd Anuaruddin AhmadonUniversiti Teknologi PETRONAS/.test(credit ?? ''), credit);
    await page.click('#auth-tab-signup');
    await page.fill('#auth-name', 'Pin Tester');
    await page.fill('#auth-email', 'pins@example.com');
    await page.fill('#auth-password', 'Junction2026');
    await page.click('.auth-submit');
    await page.waitForSelector('.auth', { state: 'hidden', timeout: 30_000 });
  }
  await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });
  // The check's map tiles are empty, so the map would say it cannot load; that note is not tested here.
  await page.addStyleTag({ content: '.map-notice { display: none !important; }' });
  // A road through the middle of Kuala Lumpur, east to west, for the crosshair to find.
  await page.evaluate(([lon, lat]) => {
    const m = window.__app.map.map;
    m.addSource('test-roads', { type: 'geojson', data: { type: 'FeatureCollection', features: [{ type: 'Feature', properties: { name: 'Jalan Ujian' }, geometry: { type: 'LineString', coordinates: [[lon - 0.01, lat], [lon + 0.01, lat]] } }] } });
    m.addLayer({ id: 'test-road-primary', type: 'line', source: 'test-roads', paint: { 'line-width': 9, 'line-color': '#b8b0c8' } });
    m.jumpTo({ center: [lon, lat], zoom: 17, bearing: 0, pitch: 0 });
  }, KL);
  await sleep(800);
  const stored = () => page.evaluate(() => {
    const key = Object.keys(localStorage).find((k) => k.startsWith('junctionnav.pins.v1'));
    return key ? JSON.parse(localStorage.getItem(key)) : [];
  });
  const screenOf = (lngLat) => page.evaluate((p) => {
    const pt = window.__app.map.map.project(p);
    const box = document.getElementById('map').getBoundingClientRect();
    return { x: box.left + pt.x, y: box.top + pt.y };
  }, lngLat);
  const chips = () => page.$$eval('.pin-headings .pill', (els) => els.map((e) => ({ text: e.textContent.trim(), on: e.getAttribute('aria-pressed') === 'true', road: e.classList.contains('is-road') })));

  // ---- the pin button: the crosshair and the sheet
  await page.click('#btn-pin');
  await page.waitForSelector('.pin-cross:not([hidden])', { timeout: 5000 }).catch(() => {});
  const mode = await page.evaluate(() => ({
    cross: !document.querySelector('.pin-cross').hidden,
    title: document.querySelector('.sheet .sheet-head h2')?.textContent,
    confirm: document.querySelector('#pin-confirm')?.textContent,
    topbar: document.querySelector('.topbar').hidden,
    fabs: document.querySelector('.fabs').hidden,
  }));
  check('the pin button opens the crosshair with its sheet', mode.cross && mode.title === 'Drop a pin' && mode.confirm === 'Place pin' && mode.topbar && mode.fabs, mode);

  // ---- tap the road: it comes under the crosshair, with its two directions
  const road = await screenOf(KL);
  await page.mouse.click(road.x, road.y);
  await page.waitForFunction(() => document.querySelectorAll('.pin-headings .is-road').length === 2, null, { timeout: 6000 }).catch(() => {});
  await page.waitForFunction(() => /Jalan Ujian/.test(document.querySelector('.pin-addr')?.textContent ?? ''), null, { timeout: 6000 }).catch(() => {});
  let c = await chips();
  const addr = await page.textContent('.pin-addr');
  await shot('1-pin-mode');
  check('a tap brings the spot under the crosshair, with the road both ways', c.map((x) => x.text).join('|') === 'Any direction|E · Jalan Ujian|W · Jalan Ujian|Turn by hand' && c[0].on, c);
  check('and what is there', /^Jalan Ujian · 3\.139\d\d, 101\.686\d\d$/.test(addr ?? ''), addr);

  // ---- along the road, east
  await page.click('.pin-headings .is-road >> nth=0');
  await sleep(200);
  let ui = await page.evaluate(() => ({ readout: document.querySelector('.pin-readout').textContent, ring: document.querySelector('.pin-cross').classList.contains('has-heading'), rot: document.querySelector('.pin-cross').style.getPropertyValue('--pin-rot'), now: document.querySelector('.pc-ring').getAttribute('aria-valuenow') }));
  check('picking a road direction sets the heading and shows the ring', /^Heading east \(90°\)/.test(ui.readout) && ui.ring && parseFloat(ui.rot) === 90 && ui.now === '90', ui);

  // ---- turned by hand on the ring: press at the lower right, drag round to the bottom
  const cross = await page.evaluate(() => {
    const r = document.querySelector('.pc-ring').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(cross.x + 42.4, cross.y + 42.4);
  await page.mouse.down();
  await page.mouse.move(cross.x + 20, cross.y + 56, { steps: 4 });
  await page.mouse.move(cross.x, cross.y + 60, { steps: 4 });
  await page.mouse.up();
  await sleep(200);
  ui = await page.evaluate(() => ({ readout: document.querySelector('.pin-readout').textContent, center: window.__app.map.map.getCenter().toArray() }));
  c = await chips();
  await shot('2-turned-by-hand');
  check('dragging the ring turns the heading (south), the map stays put', /^Heading south \(180°\)/.test(ui.readout) && c.find((x) => x.text === 'Turn by hand')?.on, { ui, c });
  // Arrow keys on the ring.
  await page.focus('.pc-ring');
  await page.keyboard.press('ArrowRight');
  check('arrow keys turn it too', /^Heading south \(185°\)/.test(await page.textContent('.pin-readout')));

  // ---- back to east, and place it
  await page.click('.pin-headings .is-road >> nth=0');
  await page.click('#pin-confirm');
  await page.waitForSelector('.pin-heading-row', { timeout: 5000 }).catch(() => {});
  await sleep(500);
  let pins = await stored();
  const card = await page.evaluate(() => ({ title: document.querySelector('.sheet .sheet-head h2')?.textContent, heading: document.querySelector('.pin-heading-row')?.textContent, markers: document.querySelectorAll('.user-pin').length, arrows: document.querySelectorAll('.pin-heading:not(.is-dest)').length, cross: document.querySelector('.pin-cross').hidden }));
  await shot('3-pin-card');
  check('Place pin keeps it on the map with its direction', pins.length === 1 && pins[0].heading === 90 && Math.abs(pins[0].lngLat[1] - KL[1]) < 0.0002 && card.markers === 1 && card.arrows === 1 && card.cross, { pins, card });
  check('its card shows what is there and the direction of travel', card.title === 'Jalan Ujian' && /Direction of travel.*east \(90°\)/.test(card.heading ?? ''), card);

  // ---- drag it along the road
  const pinEl = await page.evaluate(() => {
    const r = document.querySelector('.user-pin').getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  });
  await page.mouse.move(pinEl.x, pinEl.y);
  await page.mouse.down();
  await page.mouse.move(pinEl.x + 40, pinEl.y, { steps: 5 });
  await page.mouse.move(pinEl.x + 80, pinEl.y, { steps: 5 });
  await page.mouse.up();
  await sleep(900);
  const before = pins[0].lngLat;
  pins = await stored();
  check('dragging a pin moves it (and keeps its direction)', pins[0].lngLat[0] > before[0] + 0.0004 && pins[0].heading === 90 && pins[0].name === 'Jalan Ujian', { before, after: pins[0] });

  // ---- a long-press (right-click here) drops another
  await page.evaluate(() => window.__app.closePlace());
  await sleep(300);
  // A spot on the open map, left of the middle.
  const spot = { x: 110, y: 380 };
  const under = await page.evaluate(({ x, y }) => document.elementFromPoint(x, y)?.className, spot);
  check('the long-press spot is open map', under === 'maplibregl-canvas', under);
  await page.mouse.click(spot.x, spot.y, { button: 'right' });
  await page.waitForFunction(() => document.querySelectorAll('.user-pin').length === 2, null, { timeout: 5000 }).catch(() => {});
  await sleep(500);
  pins = await stored();
  const second = await page.evaluate(() => document.querySelector('.pin-heading-row')?.textContent ?? '');
  check('a long-press drops a pin too, any direction', pins.length === 2 && pins.some((p) => p.heading === null) && /Any direction/.test(second), { n: pins.length, second });

  // ---- pins in the search list
  await page.evaluate(() => window.__app.closePlace());
  await page.click('#q');
  await sleep(300);
  const sugg = await page.$$eval('.suggest:not([hidden]) li', (els) => els.map((e) => e.textContent));
  check('your pins are in the search list', sugg.filter((t) => /^PinJalan Ujian/.test(t)).length === 2, sugg);
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.activeElement?.blur());

  // ---- directions: choose the destination on the map, arriving westbound
  const east = pins.find((p) => p.heading === 90);
  await page.evaluate((id) => window.__app.openPin(id), east.id);
  await page.click('.sheet .btn-primary');
  await page.waitForSelector('.dir-field .dir-heading', { timeout: 5000 }).catch(() => {});
  const fieldHeading = await page.getAttribute('.dir-field .dir-heading', 'aria-label').catch(() => null);
  check("a pin's direction comes along into the directions", fieldHeading === 'Heading east (90°)', fieldHeading);
  await page.waitForFunction(() => window.__app.routes?.length > 0, null, { timeout: 8000 }).catch(() => {});
  const firstReq = calls.osrm[calls.osrm.length - 1] ?? '';
  check('the router is asked to arrive heading that way', /bearings=[^&]*%3B90%2C60(&|$)|bearings=[^&]*;90,60(&|$)/.test(firstReq), firstReq);
  // Choose on map for the destination, westbound this time.
  const rows = await page.$$('.dir-field');
  await (await rows[rows.length - 1].$('.dir-onmap')).click();
  await page.waitForSelector('#pin-confirm', { timeout: 5000 }).catch(() => {});
  const mode2 = await page.evaluate(() => ({ title: document.querySelector('.sheet .sheet-head h2')?.textContent, confirm: document.querySelector('#pin-confirm')?.textContent, readout: document.querySelector('.pin-readout').textContent }));
  check('Choose on map opens the crosshair for that field, with its direction', mode2.title === 'Choose on map' && mode2.confirm === 'Set as destination' && /east \(90°\)/.test(mode2.readout), mode2);
  const road2 = await screenOf([KL[0] + 0.0004, KL[1]]);
  await page.mouse.click(road2.x, road2.y);
  await page.waitForFunction(() => document.querySelectorAll('.pin-headings .is-road').length === 2, null, { timeout: 6000 }).catch(() => {});
  c = await chips();
  if (!c.some((x) => x.text === 'W · Jalan Ujian')) {
    await shot('debug-choose');
    console.log('chips', c, road2, await page.evaluate(() => ({ cross: document.querySelector('.pin-cross').getBoundingClientRect().toJSON(), sheet: document.querySelector('.sheet').getBoundingClientRect().toJSON() })));
  }
  await page.click('.pin-headings .is-road >> text=W · Jalan Ujian', { timeout: 5000 });
  await page.click('#pin-confirm');
  await page.waitForFunction((n) => window.__app.routes?.length > 0 && window.__app.trip.destination?.bearing === 270, null, { timeout: 8000 }).catch(() => {});
  await sleep(600);
  const req = calls.osrm[calls.osrm.length - 1] ?? '';
  const dirs = await page.evaluate(() => ({ dest: window.__app.trip.destination, line: document.querySelector('.routes-heading')?.textContent, arrow: !!document.querySelector('.pin-heading.is-dest'), view: window.__app.view }));
  await shot('4-directions-heading');
  check('the chosen point and its direction fill the destination', dirs.view === 'directions' && dirs.dest?.bearing === 270 && dirs.dest?.name === 'Jalan Ujian', dirs);
  check('the route is asked to arrive westbound, the sheet and map say so', /bearings=[^&]*(%3B|;)270(%2C|,)60(&|$)/.test(req) && dirs.line === 'Arriving heading west (270°)' && dirs.arrow, { req, dirs });

  // ---- remove a pin from its card
  await page.evaluate(() => window.__app.closeDirections());
  await page.evaluate((id) => window.__app.openPin(id), east.id);
  await page.click('.pill >> text=Remove pin');
  await sleep(400);
  pins = await stored();
  check('Remove pin takes it off the map', pins.length === 1 && (await page.$$('.user-pin')).length === 1, pins.length);

  // ---- Settings: the pins, and the credit
  await page.click('button[aria-label="Settings"]');
  await page.click('dialog.settings [role="tab"][data-tab="map"]');
  const pinsGrp = await page.textContent('dialog.settings .pins-grp');
  check('Settings shows the pins', /1 pin on the map\./.test(pinsGrp ?? ''), pinsGrp);
  await page.click('dialog.settings .pins-grp button');
  await page.click('dialog.settings .pins-grp button');
  await sleep(300);
  pins = await stored();
  check('Remove all pins (tapped twice)', pins.length === 0 && (await page.$$('.user-pin')).length === 0, pins.length);
  await page.click('dialog.settings [role="tab"][data-tab="app"]');
  await page.$eval('dialog.settings .about', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(300);
  const about = await page.textContent('dialog.settings .about');
  await shot('5-settings-about');
  check('Settings credits the developer', /Developed by Dr\. Mohd Anuaruddin AhmadonUniversiti Teknologi PETRONAS/.test(about ?? ''), about);
  await page.click('dialog.settings button[value="cancel"]');

  check('no page errors', !errors.filter((e) => !/Failed to load resource|ERR_|net::|404/.test(e)).length, errors.slice(0, 6));
  console.log('calls', { osrm: calls.osrm.length, reverse: calls.reverse });
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 1));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
