/**
 * Browser check of the places around you: the real builder (scripts/places/build-places.mjs) turns
 * sample Overture and OpenStreetMap places around Kuala Lumpur into cells, the check serves them
 * as the website would, and the app downloads them by itself, shows them on the map (hiding the
 * base map's own points of interest), opens a place's card with its details, finds them in
 * search and the category buttons, skips unchanged cells on the next update, and shows all of it
 * in Settings.
 *
 *   VITE_AUTH_REQUIRED=false VITE_PLACES_URL=https://places.test/places/ npx vite build --outDir dist-traffic
 *   npx vite preview --outDir dist-traffic --port 4180 &
 *   node scripts/dev/places-check.cjs http://localhost:4180/ <shots dir>
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { mkdirSync, mkdtempSync, readFileSync, writeFileSync } = require('node:fs');
const { tmpdir } = require('node:os');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4180/';
const OUT = process.argv[3] ?? 'places-shots';
mkdirSync(OUT, { recursive: true });

const KL = [101.6869, 3.139];
const at = (dx, dy) => [KL[0] + dx / 111150, KL[1] + dy / 110574];

// ---- sample data through the real builder
const work = mkdtempSync(join(tmpdir(), 'jn-places-check-'));
const ov = [];
const kinds = [
  ['malaysian_restaurant', 'Restoran'],
  ['coffee_shop', 'Kopi'],
  ['convenience_store', 'Mart'],
  ['pharmacy', 'Farmasi'],
  ['clothing_store', 'Butik'],
];
let n = 0;
for (let i = -6; i <= 6; i++) {
  for (let j = -6; j <= 6; j++) {
    const [cat, word] = kinds[(n++) % kinds.length];
    ov.push({ type: 'Feature', geometry: { type: 'Point', coordinates: at(i * 140, j * 140) }, properties: { names: { primary: `${word} Ujian ${n}` }, categories: { primary: cat }, confidence: 0.8, addresses: [{ freeform: `${n} Jalan Ujian`, locality: 'Kuala Lumpur', postcode: '50450', country: 'MY' }] } });
  }
}
// The places the check looks for.
const KOPI = at(60, 40);
ov.push({ type: 'Feature', geometry: { type: 'Point', coordinates: KOPI }, properties: { names: { primary: 'Kopi Kenangan Ampang Park' }, categories: { primary: 'coffee_shop' }, confidence: 0.95, phones: ['+60 3-2181 0000'], websites: ['https://kopikenangan.com.my'], brand: { names: { primary: 'Kopi Kenangan' } }, addresses: [{ freeform: 'Lot G-12, Ampang Park', locality: 'Kuala Lumpur', postcode: '50450', country: 'MY' }] } });
const osm = [
  { type: 'Feature', geometry: { type: 'Point', coordinates: KOPI }, properties: { name: 'Kopi Kenangan', amenity: 'cafe', opening_hours: 'Mo-Su 08:00-22:00' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: at(-420, 610) }, properties: { amenity: 'fuel', brand: 'Petronas', name: 'Petronas Jalan Tun Razak' } },
  { type: 'Feature', geometry: { type: 'Point', coordinates: at(0, 0) }, properties: { name: 'Kuala Lumpur', place: 'city' } },
];
writeFileSync(join(work, 'overture.geojsonseq'), ov.map((f) => JSON.stringify(f)).join('\n') + '\n');
writeFileSync(join(work, 'osm.geojsonseq'), osm.map((f) => JSON.stringify(f)).join('\n') + '\n');
execFileSync(process.execPath, ['scripts/places/build-places.mjs', '--overture', join(work, 'overture.geojsonseq'), '--osm', join(work, 'osm.geojsonseq'), '--out', join(work, 'places'), '--overture-release', 'test', '--osm-date', 'test'], { stdio: 'inherit' });
const manifest = JSON.parse(readFileSync(join(work, 'places', 'manifest.json'), 'utf8'));

const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, geolocation: { latitude: KL[1], longitude: KL[0] }, permissions: ['geolocation'] });
  const calls = { manifest: 0, cells: [], photon: 0, overpass: 0 };
  const cors = { 'Access-Control-Allow-Origin': '*' };
  await ctx.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.startsWith('https://places.test/places/')) {
      const url = new URL(u);
      const path = url.pathname.replace('/places/', '');
      if (path === 'manifest.json') calls.manifest++;
      else calls.cells.push(path + url.search);
      try {
        return r.fulfill({ body: readFileSync(join(work, 'places', path)), contentType: 'application/json', headers: cors });
      } catch {
        return r.fulfill({ status: 404, body: '', headers: cors });
      }
    }
    if (u.includes('photon.komoot.io')) {
      calls.photon++;
      return r.fulfill({ json: { features: [{ geometry: { coordinates: [101.7037, 3.1528] }, properties: { name: 'Menara Kuala Lumpur (Photon)', city: 'Kuala Lumpur' } }] }, headers: cors });
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
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ services: 'open', trafficNews: false, trafficMap: false, look: 2 }));
  });
  const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
  await page.goto(BASE);
  if (await page.locator('#auth-tab-signup').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
    await page.click('#auth-tab-signup');
    await page.fill('#auth-name', 'Anuar');
    await page.fill('#auth-email', 'places@example.com');
    await page.fill('#auth-password', 'Junction2026');
    await page.click('.auth-submit');
    await page.waitForSelector('.auth', { state: 'hidden', timeout: 30_000 });
  }
  await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });

  // ---- the first update comes by itself
  await page.waitForFunction(() => (window.__app.placesSvc.state?.count ?? 0) > 0, null, { timeout: 40_000 }).catch(() => {});
  const st = await page.evaluate(() => window.__app.placesSvc.state);
  check('places download by themselves on first start', st && st.count === manifest.count && calls.manifest === 1, { st, manifest: calls.manifest, cells: calls.cells });
  check('the area is named after its town', st?.area === 'Kuala Lumpur' && st?.radiusKm === 100, st?.area);
  check('only the cells within reach are downloaded', calls.cells.length === Object.keys(manifest.cells).length && calls.cells.every((c) => /^cells\/\d+_\d+\.json\?h=[0-9a-f]{12}$/.test(c)), calls.cells);

  // ---- on the map
  await page.evaluate(([lon, lat]) => window.__app.map.map.jumpTo({ center: [lon, lat], zoom: 16.5 }), KOPI);
  await page.waitForFunction(() => window.__app.map.map.queryRenderedFeatures({ layers: ['places'] }).length > 10, null, { timeout: 15_000 }).catch(() => {});
  await sleep(600);
  const onMap = await page.evaluate(() => {
    const m = window.__app.map.map;
    const f = m.queryRenderedFeatures({ layers: ['places'] });
    return { n: f.length, groups: [...new Set(f.map((x) => x.properties.g))].sort(), poi: m.getLayer('poi') ? m.getLayoutProperty('poi', 'visibility') : 'no layer', attribution: document.querySelector('.maplibregl-ctrl-attrib')?.textContent ?? '' };
  });
  await shot('1-places-map');
  check('places on the map with their kinds', onMap.n > 10 && ['cafe', 'food', 'grocery', 'health'].every((g) => onMap.groups.includes(g)), onMap);
  check("the base map's own points of interest step aside where the places cover", onMap.poi === 'none', onMap.poi);
  check('the map credits Overture Maps', /Overture Maps/.test(onMap.attribution), onMap.attribution);

  // ---- tap a place: its card with the details
  const pt = await page.evaluate(([lon, lat]) => {
    const p = window.__app.map.map.project([lon, lat]);
    return { x: p.x, y: p.y };
  }, KOPI);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.sheet:not([hidden]) .place-details', { timeout: 8000 }).catch(() => {});
  const card = await page.evaluate(() => ({
    title: document.querySelector('.sheet .sheet-head h2')?.textContent,
    sub: document.querySelector('.sheet .place-sub')?.textContent,
    details: document.querySelector('.sheet .place-details')?.textContent ?? '',
    icon: !!document.querySelector('.sheet .place-kind svg'),
    tel: document.querySelector('.sheet .place-details a[href^="tel:"]')?.getAttribute('href'),
  }));
  await shot('2-place-card');
  check('tapping a place opens its card', card.title === 'Kopi Kenangan' && /Cafe/.test(card.sub ?? '') && card.icon, card);
  check('with opening hours, address, phone and website from both sources', /Mo-Su 08:00-22:00/.test(card.details) && /Ampang Park/.test(card.details) && card.tel === 'tel:+60321810000' && /kopikenangan\.com\.my/.test(card.details) && /Overture Maps and OpenStreetMap/.test(card.details), card);
  await page.evaluate(() => window.__app.closePlace());

  // ---- search
  await page.fill('#q', 'kopi kenangan');
  await page.waitForFunction(() => [...document.querySelectorAll('.suggest button .s-name')].length > 1, null, { timeout: 10_000 }).catch(() => {});
  const sugg = await page.evaluate(() => [...document.querySelectorAll('.suggest button .s-name')].map((e) => e.textContent));
  await shot('3-search');
  check('search finds the places around you along with the online results', sugg[0] === 'Kopi Kenangan' && sugg.includes('Menara Kuala Lumpur (Photon)'), sugg);
  await page.fill('#q', '');
  await page.keyboard.press('Escape');

  // ---- category buttons
  await page.click('.chips .cat-chip >> nth=0');
  await page.waitForFunction(() => window.__app.results?.length > 0, null, { timeout: 10_000 }).catch(() => {});
  const fuel = await page.evaluate(() => window.__app.results.map((r) => r.name));
  check('petrol nearby includes the places around you', fuel.includes('Petronas Jalan Tun Razak'), { fuel, overpass: calls.overpass });
  await page.evaluate(() => window.__app.closePlace());

  // ---- the next update: unchanged cells are not downloaded again
  const before = calls.cells.length;
  await page.evaluate(() => window.__app.placesSvc.update(false, true));
  check('an update downloads only what changed (nothing here)', calls.cells.length === before && calls.manifest === 2, { cells: calls.cells.length - before, manifest: calls.manifest });

  // ---- Settings
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector('dialog.settings .places-grp');
  await page.$eval('dialog.settings .places-grp', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(500);
  const panel = await page.evaluate(() => ({
    status: document.querySelector('.places-grp .pl-status')?.textContent ?? '',
    every: document.querySelector('#placesUpdate')?.value,
    radius: document.querySelector('#placesRadius')?.value,
    wifi: document.querySelector('#placesWifiOnly')?.checked,
  }));
  await shot('4-settings-places');
  check('Settings shows the places on the device and the schedule', new RegExp(`${manifest.count} places within 100 km of Kuala Lumpur`).test(panel.status.replace(/,/g, '')) && panel.every === 'monthly' && panel.radius === '100' && panel.wifi === true, panel);
  // Update now: everything again, with progress.
  const before2 = calls.cells.length;
  await page.click('.places-grp .off-actions .btn >> text=Update now');
  await page.waitForFunction(() => window.__app.placesSvc.status.kind === 'idle', null, { timeout: 15_000 }).catch(() => {});
  check('Update now downloads the places again', calls.cells.length - before2 === Object.keys(manifest.cells).length, calls.cells.length - before2);
  // Places off the map, from Settings.
  await page.uncheck('#placesOnMap');
  await page.click('dialog.settings button[value="save"]');
  await sleep(800);
  const off = await page.evaluate(() => {
    const m = window.__app.map.map;
    return { n: m.queryRenderedFeatures({ layers: ['places'] }).length, poi: m.getLayer('poi') ? m.getLayoutProperty('poi', 'visibility') : 'no layer', saved: JSON.parse(localStorage.getItem('junctionnav.settings.v1')).placesOnMap };
  });
  check('places can be taken off the map (the base map points come back)', off.n === 0 && off.poi === 'visible' && off.saved === false, off);

  // ---- remove
  await page.evaluate(() => window.__app.placesSvc.clear());
  const gone = await page.evaluate(() => ({ state: window.__app.placesSvc.state, available: window.__app.placesSvc.available }));
  check('places can be removed', !gone.state && !gone.available, gone);

  check('no page errors', !errors.filter((e) => !/Failed to load resource|ERR_|net::|404/.test(e)).length, errors.slice(0, 6));
  console.log('calls', { manifest: calls.manifest, cells: calls.cells.length, photon: calls.photon, overpass: calls.overpass });
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, errors }, null, 1));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
