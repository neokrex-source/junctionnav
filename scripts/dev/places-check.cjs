/**
 * Browser check of the places around you: the real builder (scripts/places/build-places.mjs) turns
 * sample Overture and OpenStreetMap places around Kuala Lumpur into cells, the check serves them
 * as the website would, and the app downloads them by itself, shows them on the map (hiding the
 * base map's own points of interest), opens a place's card with its details, finds them in
 * search and the category buttons, skips unchanged cells on the next update, and shows all of it
 * in Settings. Search also takes coordinates, plus codes, Google Maps links and rough addresses
 * (falling back to the area, and to where the places around you say a street or postcode is), and
 * Settings is in tabs.
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
  const calls = { manifest: 0, cells: [], photon: 0, photonQ: [], overpass: 0 };
  const TAMAN = at(300, -900);
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
      const q = new URL(u).searchParams.get('q') ?? '';
      calls.photonQ.push(q);
      // An address the service does not know, and the area it is in.
      if (/Tiada/.test(q)) return r.fulfill({ json: { features: [] }, headers: cors });
      if (/^Taman Ujian/.test(q)) return r.fulfill({ json: { features: [{ geometry: { coordinates: TAMAN }, properties: { name: 'Taman Ujian (Photon)', city: 'Kuala Lumpur' } }] }, headers: cors });
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

  // ---- search by coordinates, plus codes, Google Maps links and rough addresses
  const rows = () =>
    page.evaluate(() =>
      [...document.querySelectorAll('.suggest:not([hidden]) li')].map((li) => {
        const tag = li.querySelector('.s-tag')?.textContent ?? '';
        return { note: li.classList.contains('s-note-row'), tag, name: (li.querySelector('.s-name')?.textContent ?? '').slice(tag.length), sub: li.querySelector('.s-sub')?.textContent ?? '' };
      }),
    );
  const ask = async (q) => {
    await page.evaluate(() => document.querySelectorAll('.suggest').forEach((l) => (l.innerHTML = '')));
    await page.fill('#q', q);
    await page.waitForFunction(() => document.querySelectorAll('.suggest:not([hidden]) li').length > 0, null, { timeout: 10_000 }).catch(() => {});
    await sleep(120);
    return rows();
  };
  const coordsIn = (text) => (text.match(/(-?\d+\.\d{5}), (-?\d+\.\d{5})/) ?? []).slice(1).map(Number);
  const near = (text, [lon, lat], tol = 0.0002) => {
    const [a, b] = coordsIn(text);
    return Math.abs(a - lat) < tol && Math.abs(b - lon) < tol;
  };
  let r = await ask('3.139, 101.6869');
  check('coordinates typed into search', r[0]?.name === '3.13900, 101.68690' && /^Coordinates · 3°08'20\.4"N 101°41'12\.8"E/.test(r[0].sub), r);
  await shot('3a-search-coordinates');
  await page.click('.suggest:not([hidden]) li >> nth=0');
  await page.waitForFunction(() => /near/.test(document.querySelector('.sheet .place-sub')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  const picked = await page.evaluate(() => ({ title: document.querySelector('.sheet .sheet-head h2')?.textContent, sub: document.querySelector('.sheet .place-sub')?.textContent, at: window.__app.place?.lngLat }));
  await shot('3b-coordinates-picked');
  check('picking them opens the point, with what is there', picked.title === '3.13900, 101.68690' && Math.abs(picked.at[0] - 101.6869) < 1e-6 && /^Coordinates · near [^·]+( · [\d.,]+ k?m)?$/.test(picked.sub ?? ''), picked);
  await page.evaluate(() => window.__app.closePlace());
  r = await ask(`3°08'20.4"N 101°41'12.8"E`);
  check('degrees, minutes and seconds as Google Maps writes them', near(r[0]?.name ?? '', KL, 0.0001), r);
  r = await ask('N 3.139 E 101.6869');
  check('with the hemisphere letters in front', r[0]?.name === '3.13900, 101.68690', r);
  r = await ask('Suria KLCC https://www.google.com/maps/place/Suria+KLCC/@3.1579,101.7095,17z/data=!3m1!4b1!4m6!3m5!1s0x0:0x0!8m2!3d3.1578!4d101.7123!16s');
  check("a Google Maps link to a place: the place's own position", r[0]?.name === 'Suria KLCC' && /^From the Google Maps link · 3\.15780, 101\.71230/.test(r[0].sub), r);
  r = await ask('https://www.google.com/maps/@3.1528,101.7037,16z');
  check('a link to a map view', near(r[0]?.name ?? '', [101.7037, 3.1528], 0.00001), r);
  r = await ask('https://maps.app.goo.gl/AbCdEfGh123');
  await shot('3c-search-short-link');
  check('a short link on the website: a note on what to do instead', r.length === 1 && r[0].note && /Android app/.test(r[0].name), r);
  r = await ask('6PM35P56+4W');
  check('a full plus code', r[0]?.name === '6PM35P56+4W' && near(r[0].sub, [101.7123, 3.1578]), r);
  r = await ask('5P56+4W Kuala Lumpur');
  check('a short plus code with its town', r[0]?.name === '5P56+4W Kuala Lumpur' && near(r[0].sub, [101.7123, 3.1578]), r);
  const photonBefore = calls.photonQ.length;
  r = await ask('No 12, Jln Tiada, Tmn Ujian, 50450 KL');
  await shot('3d-search-rough-address');
  const asked = calls.photonQ.slice(photonBefore);
  check('an address the services do not know: the area it is in, marked approximate', r.some((x) => x.tag === 'Approx.' && x.name === 'Taman Ujian (Photon)' && /^Approximate \(Taman Ujian, 50450 Kuala Lumpur\)/.test(x.sub)) && asked[0] === '12, Jalan Tiada, Taman Ujian, 50450 Kuala Lumpur', { r, asked });
  check('and where the places around you say its postcode is', r.some((x) => x.tag === 'Approx.' && x.name === 'Postcode 50450 Kuala Lumpur' && /middle of \d+ places with this postcode/.test(x.sub)), r);
  r = await ask('99 Jalan Ujian, 50450 Kuala Lumpur');
  check('a street the places around you know: its middle', r.some((x) => x.tag === 'Approx.' && x.name === 'Jalan Ujian, Kuala Lumpur' && /middle of 1\d\d places on this street/.test(x.sub)), r);
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

  // ---- Settings, in tabs
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector('dialog.settings[open] [role="tab"]');
  const tabs = await page.$$eval('dialog.settings [role="tab"]', (els) => els.map((e) => e.dataset.tab));
  const seen = [];
  for (const t of tabs) {
    await page.click(`dialog.settings [role="tab"][data-tab="${t}"]`);
    await sleep(150);
    seen.push(
      await page.evaluate((t) => {
        const dlg = document.querySelector('dialog.settings');
        const shown = [...dlg.querySelectorAll('[role="tabpanel"]')].filter((p) => !p.hidden);
        const box = dlg.getBoundingClientRect();
        const menu = dlg.querySelector('menu').getBoundingClientRect();
        return { t, shown: shown.map((p) => p.id), selected: dlg.querySelector('[aria-selected="true"]')?.dataset.tab, fits: box.bottom <= innerHeight + 1 && menu.bottom <= box.bottom + 1, items: shown[0]?.children.length };
      }, t),
    );
    await shot(`5-settings-${t}`);
  }
  check('Settings is in tabs, one section at a time, Save always in reach', tabs.join() === 'map,drive,traffic,downloads,app' && seen.every((x) => x.shown.length === 1 && x.shown[0] === `set-panel-${x.t}` && x.selected === x.t && x.fits && x.items > 0), seen);
  await page.focus('dialog.settings [role="tab"][data-tab="map"]');
  await page.keyboard.press('ArrowRight');
  await page.keyboard.press('ArrowRight');
  const keyed = await page.evaluate(() => `${document.activeElement?.dataset?.tab}|${document.querySelector('dialog.settings [aria-selected="true"]')?.dataset.tab}`);
  check('arrow keys move between the tabs', keyed === 'traffic|traffic', keyed);
  await page.click('dialog.settings button[value="cancel"]');
  await sleep(300);
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector('dialog.settings[open] [role="tab"]');
  const reopened = await page.evaluate(() => document.querySelector('dialog.settings [aria-selected="true"]')?.dataset.tab);
  check('Settings opens on the tab you were on', reopened === 'traffic', reopened);
  await page.click('dialog.settings [role="tab"][data-tab="downloads"]');
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
  // Update now: a newer build where one cell changed brings just that cell.
  const id = Object.keys(manifest.cells)[0];
  const cellPath = join(work, 'places', 'cells', `${id}.json`);
  const changed = JSON.parse(readFileSync(cellPath, 'utf8'));
  changed.p.push(['Restoran Baru Dibuka', 0, Math.round(KL[0] * 1e5) + 50, Math.round(KL[1] * 1e5) + 50, 40]);
  const text = JSON.stringify(changed);
  writeFileSync(cellPath, text);
  manifest.cells[id] = { n: changed.p.length, b: Buffer.byteLength(text), h: 'abcdef123456' };
  manifest.count += 1;
  writeFileSync(join(work, 'places', 'manifest.json'), JSON.stringify(manifest));
  const before2 = calls.cells.length;
  await page.click('.places-grp .off-actions .btn >> text=Update now');
  await page.waitForFunction(() => window.__app.placesSvc.status.kind === 'idle' && window.__app.placesSvc.state?.count > 0, null, { timeout: 15_000 }).catch(() => {});
  await sleep(300);
  const after = await page.evaluate(() => ({ count: window.__app.placesSvc.state?.count, status: document.querySelector('.places-grp .pl-status')?.textContent ?? '' }));
  check('Update now brings just the changed cell', calls.cells.length - before2 === 1 && calls.cells[calls.cells.length - 1].endsWith('h=abcdef123456') && after.count === manifest.count, { got: calls.cells.slice(before2), after });
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
