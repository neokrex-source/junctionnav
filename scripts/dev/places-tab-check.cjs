/**
 * Browser check of the Places tab: Discover (attractions, foods, resorts, theme parks, shopping
 * malls from OpenStreetMap, Wikivoyage, Wikipedia and Wikidata, with photos and source links)
 * and Saved (groups: save to, new group, note and link, show on map, move, rename, delete).
 * Every outside source answers with the check's own data.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-alert
 *   npx vite preview --outDir dist-alert --port 4184 &
 *   node scripts/dev/places-tab-check.cjs http://localhost:4184/ <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4184/';
const OUT = process.argv[3] ?? 'places-tab-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGN4VqFBEmIY1TCqYfhqAAAUGoYQFRF6QAAAAABJRU5ErkJggg==', 'base64');
const KL = [101.7, 3.153];

const GUIDE = `
==See==
* {{see | name=[[Petronas Twin Towers]] | url=https://www.petronastwintowers.com.my | lat=3.1579 | long=101.7116 | hours=Tu-Su 09:00-21:00 | price={{MYR|98}} | wikidata=Q83063 | content=The tallest twin towers in the world, joined by a '''skybridge''' on the 41st floor. }}
* {{see | name=Masjid Jamek | lat=3.1488 | long=101.6957 | content=One of the oldest mosques in Kuala Lumpur, where the two rivers meet. }}
==Eat==
* {{eat | name=Yut Kee | lat=3.1551 | long=101.6971 | url=www.yutkee.com.my | content=Hainanese kopitiam famous for its roti babi and chicken chop. }}
* {{eat | name=Jalan Alor Night Market | lat=3.1456 | long=101.7090 | content=A street of hawker stalls, busiest at night. }}
==Buy==
* {{buy | name=Pavilion KL | lat=3.1490 | long=101.7133 | content=Big shopping mall on Bukit Bintang. }}
`;

/** Every outside request answers from here. */
async function route(ctx, state) {
  await ctx.route('**/*', async (r) => {
    const url = r.request().url();
    if (url.startsWith(BASE)) return r.continue();
    const host = new URL(url).hostname;
    // The browser asks first whether the Wikimedia sources take the app's name header.
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Api-User-Agent, Accept, Content-Type', 'Access-Control-Allow-Methods': 'GET, POST' }, body: '' });
    const json = (body, status = 200) => r.fulfill({ status, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
    if (/Special:FilePath|upload\.wikimedia\.org|example\.org\/img/.test(url)) {
      state.images++;
      return r.fulfill({ status: 200, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' }, body: PNG });
    }
    if (/overpass/.test(host)) {
      const q = decodeURIComponent((r.request().postData() ?? '').replace(/^data=/, ''));
      state.overpass.push(q);
      if (/restaurant\|cafe/.test(q))
        return json({
          elements: [
            { type: 'node', id: 7, lat: 3.15512, lon: 101.69708, tags: { amenity: 'restaurant', name: 'Restoran Yut Kee', cuisine: 'hainanese', instagram: 'yutkee', 'contact:tiktok': '@yutkee', opening_hours: 'Tu-Su 07:30-16:30', 'addr:city': 'Kuala Lumpur' } },
            { type: 'node', id: 8, lat: 3.151, lon: 101.702, tags: { amenity: 'cafe', name: 'Kopi Corner', website: 'https://kopicorner.example', image: 'https://example.org/img/kopi.jpg' } },
            { type: 'node', id: 9, lat: 3.152, lon: 101.701, tags: { amenity: 'fast_food', name: 'Burger Chain', brand: 'Burger Chain', website: 'https://b.example' } },
          ],
        });
      if (/tourism/.test(q) && /museum/.test(q))
        return json({
          elements: [
            { type: 'way', id: 1, center: { lat: 3.15785, lon: 101.71165 }, tags: { building: 'yes', height: '452', name: 'Petronas Twin Towers', wikidata: 'Q83063', wikipedia: 'en:Petronas Towers' } },
            { type: 'node', id: 2, lat: 3.1428, lon: 101.6886, tags: { tourism: 'museum', name: 'Muzium Negara', 'name:en': 'National Museum', wikidata: 'Q1967339' } },
          ],
        });
      if (/"shop"/.test(q)) return json({ elements: [{ type: 'way', id: 3, center: { lat: 3.149, lon: 101.7134 }, tags: { shop: 'mall', name: 'Pavilion Kuala Lumpur', website: 'https://www.pavilion-kl.com' } }] });
      return json({ elements: [] });
    }
    if (/wikivoyage\.org$/.test(host)) {
      state.wikivoyage++;
      state.named = state.named && r.request().headers()['api-user-agent']?.startsWith('JunctionNav/');
      if (/geosearch/.test(url)) return json({ query: { geosearch: [{ title: 'Kuala Lumpur/City Centre', dist: 600 }] } });
      return json({ parse: { title: 'Kuala Lumpur/City Centre', wikitext: GUIDE } });
    }
    if (/wikipedia\.org$/.test(host)) {
      state.wikipedia++;
      if (state.wikipediaDown) return r.fulfill({ status: 503, body: 'down' });
      return json({
        query: {
          pages: [
            { title: 'Petronas Towers', coordinates: [{ lat: 3.158, lon: 101.7115, type: 'landmark' }], description: 'Twin skyscrapers in Kuala Lumpur, Malaysia', extract: 'The Petronas Towers are twin skyscrapers.', thumbnail: { source: 'https://upload.wikimedia.org/thumb/petronas.jpg' }, pageimage: 'Petronas_Towers_at_night.jpg', pageprops: { wikibase_item: 'Q83063' } },
            { title: 'Bukit Bintang', coordinates: [{ lat: 3.146, lon: 101.711 }], description: 'Shopping and entertainment district of Kuala Lumpur' },
            { title: 'KL Tower', coordinates: [{ lat: 3.1528, lon: 101.7039, type: 'landmark' }], description: 'Telecommunications tower in Kuala Lumpur', pageprops: { wikibase_item: 'Q732437' } },
          ],
        },
      });
    }
    if (host === 'query.wikidata.org') {
      state.wikidata++;
      return json({ results: { bindings: [{ item: { value: 'http://www.wikidata.org/entity/Q1967339' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Muzium%20Negara.jpg' } }, { item: { value: 'http://www.wikidata.org/entity/Q732437' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/KL%20Tower.jpg' } }] } });
    }
    if (/commons\.wikimedia\.org\/w\/api\.php/.test(url)) {
      state.credits++;
      return json({ query: { pages: [{ imageinfo: [{ descriptionurl: 'https://commons.wikimedia.org/wiki/File:Petronas_Towers_at_night.jpg', extmetadata: { Artist: { value: '<a href="//x">Jane Doe</a>' }, LicenseShortName: { value: 'CC BY-SA 4.0' } } }] }] } });
    }
    return r.fulfill({ status: 204, body: '' });
  });
}

async function open(browser, state, { reloadKeep = false } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1 });
  await route(ctx, state);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ services: 'open', trafficNews: false, look: 2, appearance: 'day', voice: false }));
  });
  await page.goto(BASE);
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await guest.click();
  await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });
  await page.evaluate((c) => window.__app.map.map.jumpTo({ center: c, zoom: 13 }), KL);
  return { ctx, page, errors };
}

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const state = { named: true, overpass: [], wikivoyage: 0, wikipedia: 0, wikidata: 0, credits: 0, images: 0, wikipediaDown: false };
  const { ctx, page, errors } = await open(browser, state);

  /* ---------------------------------------------------------------- the tab */
  const chip = await page.evaluate(() => document.querySelector('.chips .cat-chip')?.id);
  check('a Places chip leads the chips under the search bar', chip === 'btn-places', chip);
  await page.click('#btn-places');
  await page.waitForSelector('.lib-tabs');
  const tabs = await page.evaluate(() => [...document.querySelectorAll('.lib-tab')].map((t) => [t.textContent, t.getAttribute('aria-selected')]));
  check('the tab has Discover (open) and Saved', JSON.stringify(tabs) === JSON.stringify([['Discover', 'true'], ['Saved', 'false']]), tabs);
  const cats = await page.$$eval('.disc-cat', (b) => b.map((x) => x.textContent));
  check('Discover offers Attractions, Foods, Resorts, Theme parks and Shopping malls', JSON.stringify(cats) === JSON.stringify(['Attractions', 'Foods', 'Resorts', 'Theme parks', 'Shopping malls']), cats);

  /* ---------------------------------------------------------------- Foods */
  await page.click('.disc-cat[data-cat="food"]');
  await page.waitForSelector('.disc-card', { timeout: 15_000 }).catch(() => {});
  const foods = await page.evaluate(() =>
    [...document.querySelectorAll('.disc-card')].map((c) => ({
      name: c.querySelector('.dc-name')?.textContent,
      photo: c.querySelector('.dc-photo img')?.getAttribute('src') ?? null,
      badges: [...c.querySelectorAll('.dc-badge')].map((b) => b.textContent),
      about: c.querySelector('.dc-about')?.textContent ?? '',
    })),
  );
  const yk = foods.find((f) => /Yut Kee/.test(f.name));
  check('Foods are fetched when tapped: OpenStreetMap asked for eateries around the map centre', state.overpass.some((q) => /restaurant\|cafe/.test(q) && /around:5000,3\.15300,101\.70000/.test(q)), state.overpass.slice(-1));
  check('the same eatery from OpenStreetMap and Wikivoyage is one card, a traveller pick, with its Instagram and TikTok', yk && foods.filter((f) => /Yut Kee/.test(f.name)).length === 1 && yk.badges.includes('Traveller pick') && yk.badges.includes('Instagram') && yk.badges.includes('TikTok') && /roti babi/.test(yk.about), foods);
  check('a photo where the source has one', foods.some((f) => f.name === 'Kopi Corner' && f.photo === 'https://example.org/img/kopi.jpg'), foods);
  check('chain fast food is left out; the night market from Wikivoyage is in', !foods.some((f) => f.name === 'Burger Chain') && foods.some((f) => f.name === 'Jalan Alor Night Market'), foods.map((f) => f.name));
  const markers = await page.evaluate(() => ({ n: document.querySelectorAll('.photo-pin').length, photos: document.querySelectorAll('.photo-pin.has-photo img').length }));
  check('the places are on the map, with their photos', markers.n === foods.length && markers.photos >= 1, markers);
  await sleep(1200);
  const seen = await page.evaluate(() => {
    const sheet = document.querySelector('.sheet').getBoundingClientRect();
    const tb = document.querySelector('.topbar').getBoundingClientRect();
    return [...document.querySelectorAll('.photo-pin')].map((e) => {
      const r = e.getBoundingClientRect();
      const cs = getComputedStyle(e);
      return { top: Math.round(r.top), bottom: Math.round(r.bottom), left: Math.round(r.left), sheetTop: Math.round(sheet.top), tbBottom: Math.round(tb.bottom), op: cs.opacity };
    });
  });
  check('the markers are in view between the search bar and the list', seen.length && seen.every((m) => m.top >= m.tbBottom - 4 && m.bottom <= m.sheetTop + 5 && m.left >= 0 && m.left <= 412 && m.op === '1'), seen);
  const meta = await page.evaluate(() => document.querySelector('.disc-meta')?.textContent ?? '');
  check('it says where it looked and when', /Around the map centre, within 5 km/.test(meta) && /Updated just now/.test(meta), meta);
  await page.screenshot({ path: join(OUT, '01-foods.png') });

  /* ---------------------------------------------------------------- Attractions and the place page */
  await page.click('.disc-cat[data-cat="attractions"]');
  await page.waitForFunction(() => document.querySelector('.disc-cat[data-cat="attractions"]')?.getAttribute('aria-pressed') === 'true' && document.querySelector('.disc-card'), null, { timeout: 15_000 }).catch(() => {});
  await sleep(300);
  const sights = await page.evaluate(() => [...document.querySelectorAll('.disc-card')].map((c) => ({ name: c.querySelector('.dc-name')?.textContent, photo: c.querySelector('.dc-photo img')?.getAttribute('src') ?? null })));
  check('Attractions: the towers once (OpenStreetMap, Wikivoyage and Wikipedia together), the district left out', sights.filter((s) => /Petronas/.test(s.name)).length === 1 && !sights.some((s) => s.name === 'Bukit Bintang'), sights);
  check('photos from Wikidata for places with an item and no photo', sights.some((s) => s.name === 'National Museum' && /Special:FilePath\/Muzium_Negara\.jpg/.test(s.photo ?? '')) && state.wikidata > 0, sights);
  check('landmarks from Wikipedia too (KL Tower)', sights.some((s) => s.name === 'KL Tower'), sights);
  await page.locator('.disc-card', { hasText: 'Petronas' }).first().click();
  await page.waitForSelector('.place-photo img');
  await page.waitForFunction(() => /Jane Doe/.test(document.querySelector('.place-photo figcaption')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
  const pg = await page.evaluate(() => ({
    title: document.querySelector('.sheet-head h2')?.textContent,
    photo: document.querySelector('.place-photo img')?.getAttribute('src'),
    credit: document.querySelector('.place-photo figcaption')?.textContent,
    about: document.querySelector('.place-about')?.textContent,
    sources: [...document.querySelectorAll('.src-link')].map((a) => [a.querySelector('.sl-kind')?.textContent, a.getAttribute('href')]),
    lookup: [...document.querySelectorAll('.lu-link')].map((a) => [a.textContent, a.getAttribute('href')]),
    hours: document.querySelector('.place-details')?.textContent ?? '',
  }));
  check('the place page shows the photo with its credit from Commons', !!pg.photo && /Photo: Jane Doe, CC BY-SA 4\.0/.test(pg.credit ?? ''), pg);
  check('the words about it, and where they are from', /tallest twin towers/.test(pg.about ?? '') && /From Wikivoyage/.test(pg.about ?? ''), pg.about);
  const kinds = pg.sources.map((s) => s[0]);
  check('the source links: OpenStreetMap, Wikipedia, Wikidata, Wikivoyage and the website', ['OpenStreetMap', 'Wikipedia', 'Wikidata', 'Wikivoyage', 'Website'].every((k) => kinds.includes(k)) && pg.sources.some((s) => s[1] === 'https://www.openstreetmap.org/way/1') && pg.sources.some((s) => s[1] === 'https://en.wikivoyage.org/wiki/Kuala_Lumpur/City_Centre'), pg.sources);
  check('Look it up on TikTok, Instagram, Facebook and Google Maps', JSON.stringify(pg.lookup.map((l) => l[0])) === JSON.stringify(['TikTok', 'Instagram', 'Facebook', 'Google Maps']) && /tiktok\.com\/search\?q=Petronas/.test(pg.lookup[0][1]), pg.lookup);
  check('its opening hours and details', /Tu-Su 09:00-21:00/.test(pg.hours), pg.hours);
  await page.screenshot({ path: join(OUT, '02-place.png') });

  /* ---------------------------------------------------------------- Save to */
  await page.click('#place-save');
  await page.waitForSelector('.save-panel');
  const opts = await page.$$eval('.save-opt', (b) => b.map((x) => [x.querySelector('.so-name').textContent, x.getAttribute('aria-pressed')]));
  check('Save to lists Favourites and Want to go', JSON.stringify(opts) === JSON.stringify([['Favourites', 'false'], ['Want to go', 'false']]), opts);
  await page.click('.save-opt[data-group="want"]');
  await page.fill('#save-new-group', 'Penang trip');
  await page.press('#save-new-group', 'Enter');
  await sleep(200);
  const after = await page.$$eval('.save-opt', (b) => b.map((x) => [x.querySelector('.so-name').textContent, x.getAttribute('aria-pressed')]));
  check('saved to Want to go and to a new group made there', JSON.stringify(after) === JSON.stringify([['Favourites', 'false'], ['Want to go', 'true'], ['Penang trip', 'true']]), after);
  await page.fill('#save-memo', 'Go up the skybridge at sunset');
  await page.fill('#save-link', 'https://www.tiktok.com/@someone/video/123');
  await page.click('#save-notes');
  await sleep(200);
  const memo = await page.evaluate(() => ({ text: document.querySelector('.place-memo')?.textContent ?? '', href: document.querySelector('.place-memo a')?.getAttribute('href') }));
  check('your note and link show on the place page', /skybridge at sunset/.test(memo.text) && memo.href === 'https://www.tiktok.com/@someone/video/123', memo);
  await page.screenshot({ path: join(OUT, '03-save.png') });

  // Back to the list, with the markers.
  await page.click('.sheet-head .mini');
  await page.waitForSelector('.disc-card');
  check('back goes to Discover, the places still on the map', (await page.evaluate(() => document.querySelectorAll('.photo-pin').length)) > 0);
  const before = state.overpass.length;
  await page.click('.disc-refresh');
  await page.waitForFunction((n) => true, before);
  await sleep(1200);
  check('Refresh asks the sources again', state.overpass.length > before, { before, after: state.overpass.length });

  // A source that cannot be reached: the rest, and a note.
  state.wikipediaDown = true;
  await page.evaluate((c) => window.__app.map.map.jumpTo({ center: [c[0] + 0.05, c[1]], zoom: 13 }), KL);
  await page.click('.disc-cat[data-cat="malls"]');
  await page.waitForSelector('.disc-card', { timeout: 15_000 }).catch(() => {});
  await sleep(300);
  const malls = await page.evaluate(() => ({ cards: [...document.querySelectorAll('.disc-card .dc-name')].map((n) => n.textContent), note: document.querySelector('.disc-note')?.textContent ?? '' }));
  check('Wikipedia down: malls from the other sources, and a note saying so', malls.cards.some((n) => /Pavilion/.test(n)) && /Wikipedia could not be reached/.test(malls.note), malls);
  state.wikipediaDown = false;

  /* ---------------------------------------------------------------- Saved */
  await page.click('#lib-tab-saved');
  await page.waitForSelector('.lib-groups');
  const groups = await page.evaluate(() => [...document.querySelectorAll('.lib-groups .lib-row')].map((r) => [r.querySelector('.lr-name')?.textContent, r.querySelector('.lr-note')?.textContent]));
  check('Saved lists the groups with how many places each has', JSON.stringify(groups) === JSON.stringify([['Favourites', '0 places'], ['Want to go', '1 place'], ['Penang trip', '1 place']]), groups);
  await page.screenshot({ path: join(OUT, '04-saved.png') });
  await page.click('.lib-row[data-group] >> text=Penang trip');
  await page.waitForSelector('.lib-group-head');
  const item = await page.evaluate(() => ({ name: document.querySelector('.lib-rows .lr-name')?.textContent, sub: document.querySelector('.lib-rows .lr-sub')?.textContent, photo: !!document.querySelector('.lib-rows .lr-photo img') }));
  check('a group lists its places with their photo and your note', /Petronas/.test(item.name ?? '') && /skybridge/.test(item.sub ?? '') && item.photo, item);
  await page.click('.lib-acts .pill >> text=Show on map');
  await sleep(400);
  check('Show on map puts the group on the map', (await page.evaluate(() => document.querySelectorAll('.photo-pin').length)) === 1);
  await page.selectOption('.lr-move', 'fav');
  await sleep(200);
  const moved = await page.evaluate(() => ({ left: document.querySelectorAll('.lib-rows .lib-row').length, fav: window.__app.places.items('fav').map((p) => p.name) }));
  check('Move to puts it in another group (here Favourites)', moved.left === 0 && moved.fav.some((n) => /Petronas/.test(n)), moved);
  await page.click('.lib-acts .pill >> text=Rename');
  await page.fill('#lib-rename', 'Penang 2027');
  await page.press('#lib-rename', 'Enter');
  await sleep(150);
  check('Rename', (await page.evaluate(() => document.querySelector('.lib-group-head h3')?.textContent)) === 'Penang 2027');
  await page.click('.lib-del');
  const confirm = await page.evaluate(() => document.querySelector('.disc-note')?.textContent ?? '');
  await page.click('.lib-del');
  await sleep(150);
  const left = await page.evaluate(() => [...document.querySelectorAll('.lib-groups .lr-name')].map((n) => n.textContent));
  check('Delete group asks once, then deletes it', /Tap again to delete/.test(confirm) && JSON.stringify(left) === JSON.stringify(['Favourites', 'Want to go']), { confirm, left });
  await page.click('.lib-add');
  await page.fill('#lib-new-group', 'Weekend');
  await page.press('#lib-new-group', 'Enter');
  await sleep(150);
  check('New group from the Saved tab', (await page.evaluate(() => [...document.querySelectorAll('.lib-groups .lr-name')].map((n) => n.textContent))).includes('Weekend'));

  // Kept after a reload.
  await page.reload();
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await guest.click();
  await page.waitForFunction(() => window.__app?.places, null, { timeout: 20_000 });
  const kept = await page.evaluate(() => ({ groups: window.__app.places.groups.map((g) => g.name || g.builtIn), want: window.__app.places.items('want').map((p) => [p.name, p.memo, !!p.discover?.photo]) }));
  check('groups, places, notes and photos are kept after a reload', JSON.stringify(kept.groups) === JSON.stringify(['want', 'Weekend']) && kept.want[0]?.[1] === 'Go up the skybridge at sunset' && kept.want[0]?.[2], kept);

  // Malay.
  await page.evaluate(() => {
    window.__app.settings.lang = 'ms';
    window.__app.applyLang();
    window.__app.openLibrary('discover');
  });
  const ms = await page.evaluate(() => ({ chip: document.querySelector('#btn-places')?.textContent, cats: [...document.querySelectorAll('.disc-cat')].map((b) => b.textContent) }));
  check('in Malay: Tempat, Tarikan, Makanan, Resort, Taman tema, Pusat beli-belah', ms.chip === 'Tempat' && JSON.stringify(ms.cats) === JSON.stringify(['Tarikan', 'Makanan', 'Resort', 'Taman tema', 'Pusat beli-belah']), ms);

  check('the app names itself to the Wikimedia APIs (Api-User-Agent)', state.named && state.wikivoyage > 0);
  check('no page errors', errors.length === 0, errors.slice(0, 3));
  await ctx.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
