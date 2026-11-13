/**
 * Browser check of signing in with Google and Apple, your places and shared places, and Google
 * Maps places in search, against a fake Supabase project (auth and the shared_places table, with
 * its row rules) and a fake Google Places UI Kit.
 *
 * With the shared places service (a Supabase project) and a Google key:
 *   VITE_SUPABASE_URL=https://sb.test VITE_SUPABASE_ANON_KEY=anon VITE_GOOGLE_MAPS_KEY=gk-test npx vite build --outDir dist-mp
 *   npx vite preview --outDir dist-mp --port 4181 &
 *   node scripts/dev/myplaces-check.cjs http://localhost:4181/ <shots dir>
 *
 * Without them (as the site is today: accounts and places in the browser):
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-mp-local
 *   npx vite preview --outDir dist-mp-local --port 4182 &
 *   node scripts/dev/myplaces-check.cjs http://localhost:4182/ <shots dir> local
 */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { randomUUID } = require('node:crypto');

const BASE = process.argv[2] ?? 'http://localhost:4181/';
const OUT = process.argv[3] ?? 'myplaces-shots';
const LOCAL = process.argv[4] === 'local';
mkdirSync(OUT, { recursive: true });

const KL = [101.6869, 3.139];
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS' };

/* ------------------------------------------------------------------ fake Supabase */

const USERS = {
  'tok-google': { id: 'u-aina', email: 'aina@gmail.com', user_metadata: { full_name: 'Aina Rahman' } },
};
const db = { places: new Map(), reports: [], calls: [] };
const COLS = ['id', 'owner', 'owner_name', 'name', 'category', 'note', 'phone', 'website', 'lon', 'lat', 'heading', 'visibility', 'hidden', 'updated_at'];
const pick = (row) => Object.fromEntries(COLS.map((c) => [c, row[c] ?? null]));
// Someone else's public place near the middle of Kuala Lumpur, and a private one nobody else may see.
db.places.set('5c0b8f2e-6a7d-4f1e-9a43-0d1b2c3e4f50', { id: '5c0b8f2e-6a7d-4f1e-9a43-0d1b2c3e4f50', owner: 'u-ali', owner_name: 'Ali', name: 'Bengkel Ah Seng', category: 'car', note: 'Behind the Shell, open till 7 pm', phone: '', website: '', lon: KL[0] + 0.002, lat: KL[1] + 0.001, heading: null, visibility: 'public', hidden: false, reports: 0, updated_at: '2026-11-01T00:00:00Z' });
db.places.set('6c0b8f2e-6a7d-4f1e-9a43-0d1b2c3e4f51', { id: '6c0b8f2e-6a7d-4f1e-9a43-0d1b2c3e4f51', owner: 'u-ali', owner_name: '', name: 'Rumah Ali', category: 'other', note: '', phone: '', website: '', lon: KL[0] + 0.001, lat: KL[1] - 0.001, heading: null, visibility: 'private', hidden: false, reports: 0, updated_at: '2026-11-01T00:00:00Z' });

function userOf(req) {
  const t = (req.headers()['authorization'] ?? '').replace(/^Bearer /, '');
  return USERS[t]?.id ?? null;
}

function rest(req) {
  const u = new URL(req.url());
  const method = req.method();
  const me = userOf(req);
  db.calls.push(`${method} ${u.pathname.split('/').pop()}${u.search ? '?' + decodeURIComponent(u.search.slice(1)) : ''}`);
  if (method === 'OPTIONS') return { status: 204, body: '' };
  if (u.pathname.endsWith('/shared_place_reports')) {
    if (!me) return { status: 401, json: { message: 'not signed in' } };
    const b = JSON.parse(req.postData() || '{}');
    const p = db.places.get(b.place_id);
    if (!p || p.visibility !== 'public' || p.owner === me) return { status: 403, json: { message: 'new row violates row-level security policy' } };
    if (db.reports.some((r) => r.place_id === b.place_id && r.reporter === me)) return { status: 409, json: { message: 'duplicate key' } };
    db.reports.push({ ...b, reporter: me });
    return { status: 201, body: '' };
  }
  const visible = (p) => (p.visibility === 'public' && !p.hidden) || (me && p.owner === me);
  const q = u.searchParams;
  const match = (p) => {
    for (const [k, v] of q) {
      if (['select', 'order', 'limit'].includes(k)) continue;
      const [op, ...rest] = v.split('.');
      const val = rest.join('.');
      const have = p[k];
      if (op === 'eq' && String(have) !== val) return false;
      if (op === 'gte' && !(Number(have) >= Number(val))) return false;
      if (op === 'lte' && !(Number(have) <= Number(val))) return false;
      if (op === 'ilike' && !String(have).toLowerCase().includes(val.replace(/\*/g, '').toLowerCase())) return false;
    }
    return true;
  };
  if (method === 'GET') return { status: 200, json: [...db.places.values()].filter(visible).filter(match).map(pick) };
  if (!me) return { status: 401, json: { message: 'JWT required' } };
  if (method === 'POST') {
    const b = JSON.parse(req.postData() || '{}');
    if ('owner' in b || 'hidden' in b) return { status: 403, json: { message: 'permission denied for column' } };
    const row = { ...b, id: b.id || randomUUID(), owner: me, hidden: false, reports: 0, updated_at: new Date().toISOString() };
    db.places.set(row.id, row);
    return { status: 201, json: [pick(row)] };
  }
  const targets = [...db.places.values()].filter((p) => p.owner === me).filter(match);
  if (method === 'PATCH') {
    const b = JSON.parse(req.postData() || '{}');
    for (const p of targets) Object.assign(p, b, { updated_at: new Date().toISOString() });
    return { status: 200, json: targets.map(pick) };
  }
  if (method === 'DELETE') {
    for (const p of targets) db.places.delete(p.id);
    return { status: 204, body: '' };
  }
  return { status: 405, body: '' };
}

/* ------------------------------------------------------------------ fake Google Places UI Kit */

const GOOGLE_JS = `(() => {
  const src = document.currentScript.src;
  window.__googleSrc = src;
  const cb = new URL(src).searchParams.get('callback');
  const PLACES = [{ id: 'gp-1', name: 'Kopitiam Lama (Google)', lat: 3.1402, lng: 101.6881 }, { id: 'gp-2', name: 'Kopitiam Baru (Google)', lat: 3.15, lng: 101.7 }];
  const loc = (p) => ({ lat: () => p.lat, lng: () => p.lng });
  class Search extends HTMLElement {
    connectedCallback() {
      setTimeout(() => {
        const req = this.querySelector('gmp-place-text-search-request');
        window.__gq = { text: req && req.textQuery, bias: req && req.locationBias, max: req && req.maxResultCount };
        this.places = PLACES.map((p) => ({ id: p.id, location: loc(p) }));
        for (const p of PLACES) {
          const b = document.createElement('button');
          b.className = 'fake-gp';
          b.type = 'button';
          b.textContent = p.name;
          b.onclick = () => { const e = new Event('gmp-select'); e.place = { id: p.id, location: loc(p) }; this.dispatchEvent(e); };
          this.append(b);
        }
        this.append(Object.assign(document.createElement('div'), { className: 'fake-attr', textContent: 'Google Maps' }));
        this.dispatchEvent(new Event('gmp-load'));
      }, 60);
    }
  }
  class Details extends HTMLElement {
    connectedCallback() {
      setTimeout(() => {
        const id = this.querySelector('gmp-place-details-place-request').getAttribute('place');
        const p = PLACES.find((x) => x.id === id);
        this.place = { id, location: loc(p) };
        this.append(Object.assign(document.createElement('div'), { className: 'fake-gd', textContent: p.name + ' · 4.5 stars · Open' }));
        this.dispatchEvent(new Event('gmp-load'));
      }, 60);
    }
  }
  customElements.define('gmp-place-search', Search);
  customElements.define('gmp-place-details-compact', Details);
  for (const n of ['gmp-place-all-content', 'gmp-place-text-search-request', 'gmp-place-details-place-request']) customElements.define(n, class extends HTMLElement {});
  window.google = { maps: { importLibrary: async (name) => { window.__googleLib = name; return {}; } } };
  setTimeout(() => window[cb](), 0);
})();`;

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, geolocation: { latitude: KL[1], longitude: KL[0] }, permissions: ['geolocation'] });
  const seen = { authorize: [], google: 0 };
  await ctx.route('**/*', async (r) => {
    const req = r.request();
    const u = req.url();
    if (u.startsWith('https://sb.test/auth/v1/')) {
      const url = new URL(u);
      const path = url.pathname.replace('/auth/v1/', '');
      if (path === 'settings') return r.fulfill({ json: { external: { google: true, apple: true, email: true, github: false } }, headers: cors });
      if (path === 'authorize') {
        const provider = url.searchParams.get('provider');
        const back = url.searchParams.get('redirect_to');
        seen.authorize.push({ provider, back });
        // Apple: the person cancels. Google: signed in.
        const to = provider === 'apple' ? `${back}?error=access_denied&error_description=User+cancelled+the+sign+in` : `${back}#access_token=tok-google&expires_in=3600&provider_token=x&refresh_token=rt-google&token_type=bearer`;
        return r.fulfill({ status: 302, headers: { Location: to } });
      }
      if (path === 'user') {
        const id = USERS[(req.headers()['authorization'] ?? '').replace(/^Bearer /, '')];
        return r.fulfill(id ? { json: id, headers: cors } : { status: 401, json: { msg: 'bad jwt' }, headers: cors });
      }
      if (path === 'logout') return r.fulfill({ status: 204, body: '', headers: cors });
      if (path.startsWith('token')) return r.fulfill({ json: { access_token: 'tok-google', refresh_token: 'rt-google', expires_in: 3600, user: USERS['tok-google'] }, headers: cors });
      return r.fulfill({ status: 404, json: {}, headers: cors });
    }
    if (u.startsWith('https://sb.test/rest/v1/')) {
      const res = rest(req);
      return r.fulfill(res.json !== undefined ? { status: res.status, json: res.json, headers: cors } : { status: res.status, body: res.body ?? '', headers: cors });
    }
    if (u.startsWith('https://maps.googleapis.com/maps/api/js')) {
      seen.google++;
      return r.fulfill({ body: GOOGLE_JS, contentType: 'text/javascript' });
    }
    if (u.includes('photon.komoot.io')) {
      const q = new URL(u);
      if (u.includes('/reverse')) {
        const lon = Number(q.searchParams.get('lon') ?? KL[0]);
        const lat = Number(q.searchParams.get('lat') ?? KL[1]);
        return r.fulfill({ json: { features: [{ geometry: { coordinates: [lon, lat] }, properties: { name: 'Jalan Ujian', city: 'Kuala Lumpur' } }] }, headers: cors });
      }
      // The online search knows a "Kopitiam Lama" about 120 m from where the place is registered.
      return r.fulfill({
        json: {
          features: [
            { geometry: { coordinates: [KL[0] + 0.001, KL[1] + 0.0005] }, properties: { name: 'Kopitiam Lama', street: 'Jalan Lama', city: 'Kuala Lumpur' } },
            { geometry: { coordinates: [KL[0] + 0.01, KL[1]] }, properties: { name: 'Kedai Kopi Lain', city: 'Kuala Lumpur' } },
          ],
        },
        headers: cors,
      });
    }
    if (u.includes('/route/v1/driving/')) {
      const coords = decodeURIComponent(new URL(u).pathname.split('/').pop()).split(';').map((c) => c.split(',').map(Number));
      const a = coords[0];
      const b = coords[coords.length - 1];
      const d = Math.hypot((b[0] - a[0]) * 111150, (b[1] - a[1]) * 110574);
      const step = (type, at, dist) => ({ distance: dist, duration: dist / 10, name: 'Jalan Ujian', mode: 'driving', driving_side: 'left', maneuver: { type, location: at, bearing_before: 0, bearing_after: 90 }, intersections: [{ location: at, bearings: [90], entry: [true], out: 0 }] });
      return r.fulfill({ json: { code: 'Ok', routes: [{ distance: d, duration: d / 10, geometry: { type: 'LineString', coordinates: [a, b] }, legs: [{ steps: [step('depart', a, d), step('arrive', b, 0)], summary: 'Jalan Ujian', distance: d, duration: d / 10 }] }], waypoints: [] }, headers: cors });
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
  page.on('console', (m) => m.type() === 'error' && !/Failed to load resource|net::ERR_FAILED/.test(m.text()) && errors.push(m.text()));
  await ctx.addInitScript(() => {
    if (!sessionStorage.getItem('seeded')) {
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ services: 'open', trafficNews: false, trafficMap: false, look: 2, appearance: 'day', placesOnMap: false }));
    }
    window.__copied = [];
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async (t) => void window.__copied.push(t) } });
    Object.defineProperty(navigator, 'share', { configurable: true, value: undefined });
  });
  const shot = (name) => page.screenshot({ path: join(OUT, `${name}.png`) });
  const sheetText = () => page.evaluate(() => document.querySelector('.sheet')?.innerText ?? '');
  const pillByText = (re) => page.locator('.sheet .pill', { hasText: re }).first();
  const mapReady = () => page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });

  await page.goto(BASE);

  if (!LOCAL) {
    // ---- the sign-in screen: Google and Apple, as the project has them
    await page.waitForSelector('.auth-social:not([hidden]) .auth-social-btn', { timeout: 15_000 });
    const buttons = await page.$$eval('.auth-social-btn', (els) => els.map((e) => e.textContent));
    check('the sign-in screen offers Google and Apple', buttons.join('|') === 'Continue with Google|Continue with Apple', buttons);
    await shot('01-signin-social');
    // Apple: cancelled on Apple's page, back with an error.
    await page.click('.auth-social-btn.is-apple');
    await page.waitForSelector('.auth-error:not([hidden])', { timeout: 15_000 });
    const err = await page.textContent('.auth-error');
    check('cancelling at Apple comes back to the sign-in screen saying so', /cancelled/i.test(err ?? ''), err);
    check('the error is taken off the address', !/error=/.test(page.url()), page.url());
    check('Apple was asked to come back to this page', seen.authorize[0]?.provider === 'apple' && seen.authorize[0]?.back === new URL(BASE).origin + new URL(BASE).pathname, seen.authorize[0]);
    // Google: signed in.
    await page.click('.auth-social-btn.is-google');
    await page.waitForFunction(() => window.__app?.user, null, { timeout: 20_000 }).catch(() => {});
    await mapReady();
    const who = await page.evaluate(() => window.__app.user);
    check('signing in with Google signs in with the Google account', who?.id === 'u-aina' && who?.name === 'Aina Rahman', who);
    check('the tokens are taken off the address', !page.url().includes('access_token'), page.url());
    const kept = await page.evaluate(() => !!localStorage.getItem('junctionnav.supabase.session.v1'));
    check('"Keep me signed in" keeps the Google session', kept);
  } else {
    if (await page.locator('#auth-tab-signup').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
      check('no Google or Apple buttons without a Supabase project', (await page.$$('.auth-social-btn')).length === 0);
      await page.click('#auth-tab-signup');
      await page.fill('#auth-name', 'Places Tester');
      await page.fill('#auth-email', 'places@example.com');
      await page.fill('#auth-password', 'Junction2026');
      await page.click('.auth-submit');
      await page.waitForSelector('.auth', { state: 'hidden', timeout: 30_000 });
    }
    await mapReady();
  }
  await page.addStyleTag({ content: '.map-notice { display: none !important; }' });
  await page.evaluate(([lon, lat]) => window.__app.map.map.jumpTo({ center: [lon, lat], zoom: 16.5, bearing: 0, pitch: 0 }), KL);
  await sleep(900);

  // ---- a pin, then "Add to my places"
  await page.click('#btn-pin');
  await page.waitForSelector('#pin-confirm');
  await page.click('#pin-confirm');
  await page.waitForFunction(() => document.querySelector('.sheet .pill') && /Add to my places/.test(document.querySelector('.sheet').innerText), null, { timeout: 8000 });
  const pinCard = await sheetText();
  check('a place card offers Add to my places and Google Maps', /Add to my places/.test(pinCard) && /Google Maps/.test(pinCard), pinCard);
  const gHref = await page.getAttribute('.sheet a.pill', 'href');
  check('the Google Maps button opens the spot in Google Maps', /^https:\/\/www\.google\.com\/maps\/search\/\?api=1&query=3\.1\d+%2C101\.6\d+$/.test(gHref ?? ''), gHref);
  await pillByText(/Add to my places/).click();
  await page.waitForSelector('.pf');
  const form0 = await page.evaluate(() => ({
    title: document.querySelector('.sheet .sheet-head h2')?.textContent,
    name: document.querySelector('.pf input[type=text]').value,
    pub: (() => {
      const r = document.querySelector('.pf input[value=public]');
      return { disabled: r.disabled, hint: r.closest('label').innerText };
    })(),
  }));
  check('the form opens for a new place, named after nothing yet for a bare pin', form0.title === 'Add a place' && form0.name === '', form0);
  if (LOCAL) check('Public is not offered without the shared places service, and says why', form0.pub.disabled && /not set up/.test(form0.pub.hint), form0.pub);
  else check('Public can be chosen when signed in to the shared places service', !form0.pub.disabled && /Everyone using JunctionNav/.test(form0.pub.hint), form0.pub);
  // An empty name is refused.
  await page.click('.pf button[type=submit]');
  check('a place needs a name', await page.isVisible('.pf-error'), await page.textContent('.pf-error'));
  await page.fill('.pf input[type=text]', 'Kopitiam Lama');
  await page.selectOption('.pf select', 'food');
  await page.fill('.pf textarea', 'The real entrance is on Jalan Lama, not the highway side.\nParking at the back.');
  await page.fill('.pf input[type=tel]', '+60 3-2222 3333');
  if (!LOCAL) await page.check('.pf input[value=public]');
  await shot('02-form');
  // Move the pin and come back: what was typed is kept.
  await page.click('.pf-where .pill');
  await page.waitForSelector('#pin-confirm');
  const moveTitle = await page.evaluate(() => [document.querySelector('.sheet .sheet-head h2')?.textContent, document.querySelector('#pin-confirm')?.textContent]);
  check('Move pin uses the crosshair, with Use this spot', moveTitle[0] === 'Move pin' && /Use this spot/.test(moveTitle[1] ?? ''), moveTitle);
  // Turn it to arrive heading east along the road.
  const turn = page.locator('.pin-headings .pill', { hasText: /Turn by hand/i });
  if (await turn.count()) await turn.click();
  await page.keyboard.press('ArrowRight');
  await page.click('#pin-confirm');
  await page.waitForSelector('.pf');
  const form1 = await page.evaluate(() => ({
    name: document.querySelector('.pf input[type=text]').value,
    note: document.querySelector('.pf textarea').value,
    pub: document.querySelector('.pf input[value=public]').checked,
    where: document.querySelector('.pf-where-text').innerText,
  }));
  check('coming back from the crosshair keeps what was typed', form1.name === 'Kopitiam Lama' && /Parking at the back/.test(form1.note) && form1.pub === !LOCAL, form1);
  check('the form shows the direction of travel there', /Arrive heading/.test(form1.where), form1.where);
  await page.click('.pf button[type=submit]');
  await page.waitForFunction(() => /Your place/.test(document.querySelector('.sheet')?.innerText ?? ''), null, { timeout: 8000 });
  await sleep(600);
  const card = await sheetText();
  check('the saved place opens as your place, with its note', /Kopitiam Lama/.test(card) && /Your place · (Public|Private)/.test(card) && /Parking at the back/.test(card), card);
  check('the card offers Edit, Share and Google Maps', /Edit/.test(card) && /Share/.test(card) && /Google Maps/.test(card), card);
  const pinsLeft = await page.evaluate(() => window.__app.pins.pins.length);
  check('the pin it came from is replaced by the place', pinsLeft === 0, pinsLeft);
  await shot('03-card');
  const local = await page.evaluate(() => window.__app.myPlaces.list().map((p) => ({ name: p.name, vis: p.visibility, synced: p.synced, heading: p.heading, owner: p.owner })));
  check('the place is kept with the account', local.length === 1 && local[0].name === 'Kopitiam Lama' && local[0].heading != null, local);
  if (!LOCAL) {
    await page.waitForFunction(() => window.__app.myPlaces.pending === 0, null, { timeout: 8000 }).catch(() => {});
    const row = [...db.places.values()].find((p) => p.name === 'Kopitiam Lama');
    check('the place is on the shared service as a public place by its owner', row && row.owner === 'u-aina' && row.visibility === 'public' && row.owner_name === 'Aina' && row.category === 'food' && row.heading != null, row);
  }

  // ---- on the map
  const marks = await page.evaluate(() => {
    const src = window.__app.map.map.getSource('community');
    return src ? src._data?.features?.map((f) => ({ n: f.properties.n, own: f.properties.own })) ?? src.serialize().data.features.map((f) => ({ n: f.properties.n, own: f.properties.own })) : null;
  });
  check('your place is on the map', Array.isArray(marks) && marks.some((m) => m.n === 'Kopitiam Lama' && m.own), marks);

  // ---- search: yours first, the same place from the online search left out
  await page.click('.sheet .sheet-head button');
  await page.fill('#q', 'kopitiam');
  await page.waitForSelector('.suggest:not([hidden]) li button', { timeout: 8000 });
  await sleep(500);
  const list = await page.$$eval('.searchcard .suggest li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('search lists your place first', /^Kopitiam Lama Food and drink · Your place/.test(list[0] ?? ''), list);
  check('the online search’s place of the same name nearby is left out', list.filter((t) => /^Kopitiam Lama/.test(t)).length === 1 && list.some((t) => /Kedai Kopi Lain/.test(t)), list);
  if (!LOCAL) {
    check('Search Google Maps is offered under the results', /Search Google Maps for “kopitiam”/.test(list[list.length - 1] ?? ''), list);
    await shot('04-search');
    await page.click('.s-google');
    await page.waitForSelector('.gpanel[open] .fake-gp', { timeout: 10_000 });
    const gq = await page.evaluate(() => ({ q: window.__gq, src: window.__googleSrc, lib: window.__googleLib }));
    check('Google’s own search list is shown for what was typed, near you', gq.q?.text === 'kopitiam' && Math.abs(gq.q?.bias?.lat - KL[1]) < 0.05 && gq.lib === 'places', gq);
    check('Google’s script is loaded with the key, async, in the app’s language', /key=gk-test/.test(gq.src) && /loading=async/.test(gq.src) && /language=en/.test(gq.src), gq.src);
    await shot('05-google-list');
    await page.click('.fake-gp >> nth=0');
    await page.waitForSelector('.gpanel .fake-gd', { timeout: 8000 });
    const open = await page.getAttribute('.gp-actions a', 'href');
    check('Google’s place card, with Open in Google Maps by its id', /query_place_id=gp-1/.test(open ?? ''), open);
    await shot('06-google-card');
    await page.click('.gp-actions .btn-primary');
    await page.waitForFunction(() => window.__app.view === 'directions' && window.__app.trip.destination, null, { timeout: 8000 });
    await sleep(800);
    const dest = await page.evaluate(() => window.__app.trip.destination);
    check('Directions plans the route to Google’s spot, named by the app’s own search', Math.abs(dest.lngLat[0] - 101.6881) < 1e-6 && dest.name === 'Jalan Ujian' && !/Google/.test(dest.name), dest);
    check('the Google panel is gone', !(await page.$('.gpanel')));
    await page.evaluate(() => window.__app.closeDirections?.() ?? null);
    await page.evaluate(() => window.__app.closePlace());
  } else {
    check('no Google Maps search without a key', !list.some((t) => /Search Google Maps/.test(t)), list);
    await page.evaluate(() => window.__app.closePlace());
  }

  // ---- the place in the saved list (search box, empty)
  await page.fill('#q', '');
  await page.evaluate(() => document.activeElement?.blur());
  await page.focus('#q');
  await sleep(300);
  const saved = await page.$$eval('.searchcard .suggest li', (els) => els.map((e) => e.innerText.replace(/\s+/g, ' ').trim()));
  check('your places are in the list under an empty search box', saved.some((t) => /^Mine ?Kopitiam Lama/.test(t)), saved);
  await page.keyboard.press('Escape');

  // ---- edit
  const id = await page.evaluate(() => window.__app.myPlaces.list()[0].id);
  await page.evaluate((pid) => window.__app.pickRegistered(pid, true), id);
  await page.waitForSelector('.sheet .pill');
  await pillByText(/^Edit$/).click();
  await page.waitForSelector('.pf');
  check('Edit opens the form with the place', (await page.inputValue('.pf input[type=text]')) === 'Kopitiam Lama' && (await page.textContent('.sheet .sheet-head h2')) === 'Edit place');
  await page.fill('.pf input[type=text]', 'Kopitiam Lama SS2');
  await page.click('.pf button[type=submit]');
  await page.waitForFunction(() => /Kopitiam Lama SS2/.test(document.querySelector('.sheet')?.innerText ?? ''), null, { timeout: 8000 });
  if (!LOCAL) {
    await page.waitForFunction(() => window.__app.myPlaces.pending === 0, null, { timeout: 8000 }).catch(() => {});
    check('the change reaches the shared service', [...db.places.values()].some((p) => p.name === 'Kopitiam Lama SS2') && db.calls.some((c) => c.startsWith('PATCH')), db.calls.slice(-4));
  }

  // ---- share
  await pillByText(/^Share$/).click();
  await sleep(300);
  const copied = await page.evaluate(() => window.__copied.slice(-1)[0]);
  if (!LOCAL) check('a public place is shared by its id', new RegExp(`\\?sp=${id}$`).test(copied ?? ''), copied);
  else check('a private place is shared with its details in the link', /\?place=3\.1\d+%2C101\.6\d+&name=Kopitiam\+Lama\+SS2&kind=food&hd=\d+&note=/.test(copied ?? ''), copied);

  // ---- reload: still there
  await page.reload();
  await mapReady();
  await page.waitForFunction(() => window.__app.myPlaces.list().length === 1, null, { timeout: 10_000 }).catch(() => {});
  check('your place is still there after a reload', (await page.evaluate(() => window.__app.myPlaces.list().map((p) => p.name))).join() === 'Kopitiam Lama SS2');

  if (!LOCAL) {
    // ---- someone else's public place: on the map, its card, a report
    await page.evaluate(([lon, lat]) => window.__app.map.map.jumpTo({ center: [lon + 0.0004, lat], zoom: 16 }), KL);
    await page.waitForFunction(() => window.__app.publicPlaces.get('5c0b8f2e-6a7d-4f1e-9a43-0d1b2c3e4f50'), null, { timeout: 10_000 }).catch(() => {});
    await sleep(400);
    const all = await page.evaluate(() => window.__app.map.map.getSource('community').serialize().data.features.map((f) => [f.properties.n, f.properties.own]));
    check('everyone’s public places around are on the map, others’ private ones are not', all.some(([n, own]) => n === 'Bengkel Ah Seng' && !own) && !all.some(([n]) => n === 'Rumah Ali'), all);
    // Tap it on the map.
    const at = await page.evaluate(() => {
      const p = window.__app.publicPlaces.get('5c0b8f2e-6a7d-4f1e-9a43-0d1b2c3e4f50');
      const pt = window.__app.map.map.project(p.lngLat);
      const box = document.getElementById('map').getBoundingClientRect();
      return { x: box.left + pt.x, y: box.top + pt.y };
    });
    await page.mouse.click(at.x, at.y);
    await page.waitForFunction(() => /Bengkel Ah Seng/.test(document.querySelector('.sheet')?.innerText ?? ''), null, { timeout: 6000 }).catch(() => {});
    const other = await sheetText();
    check('tapping someone’s public place opens its card: who added it, its note', /Bengkel Ah Seng/.test(other) && /Added by Ali/.test(other) && /Behind the Shell/.test(other), other);
    check('their place can be saved to yours, shared and reported, not edited', /Save to my places/.test(other) && /Share/.test(other) && /Report/.test(other) && !/\bEdit\b/.test(other), other);
    await shot('07-public-card');
    await pillByText(/^Report$/).click();
    await page.waitForSelector('.report-box');
    await page.locator('.report-box .pill', { hasText: 'Closed or gone' }).click();
    await page.waitForFunction(() => /Thanks/.test(document.querySelector('.toast')?.innerText ?? document.body.innerText), null, { timeout: 6000 }).catch(() => {});
    check('a report reaches the service with the reason', db.reports.some((r) => r.place_id === '5c0b8f2e-6a7d-4f1e-9a43-0d1b2c3e4f50' && r.reason === 'Closed or gone' && r.reporter === 'u-aina'), db.reports);

    // ---- a link to a public place, opened fresh
    const p2 = await ctx.newPage();
    p2.on('pageerror', (e) => errors.push(String(e)));
    await p2.goto(`${BASE}?sp=5c0b8f2e-6a7d-4f1e-9a43-0d1b2c3e4f50`);
    await p2.waitForFunction(() => /Bengkel Ah Seng/.test(document.querySelector('.sheet')?.innerText ?? ''), null, { timeout: 20_000 }).catch(() => {});
    check('a shared link opens the public place', /Added by Ali/.test(await p2.evaluate(() => document.querySelector('.sheet')?.innerText ?? '')));
    check('the link is taken off the address once open', !/sp=/.test(p2.url()), p2.url());
    await p2.close();
  }

  // ---- a link with a private place in it: Shared with you, Save to my places
  const p3 = await ctx.newPage();
  p3.on('pageerror', (e) => errors.push(String(e)));
  await p3.goto(`${BASE}?place=3.1402,101.6905&name=Gerai%20Pak%20Mat&kind=food&hd=180&note=Only%20mornings`);
  await p3.waitForFunction(() => /Gerai Pak Mat/.test(document.querySelector('.sheet')?.innerText ?? ''), null, { timeout: 20_000 }).catch(() => {});
  const linkCard = await p3.evaluate(() => document.querySelector('.sheet')?.innerText ?? '');
  check('a place link opens the place: Shared with you, its note, Save to my places', /Shared with you/.test(linkCard) && /Only mornings/.test(linkCard) && /Save to my places/.test(linkCard), linkCard);
  await p3.locator('.sheet .pill', { hasText: 'Save to my places' }).click();
  await p3.waitForSelector('.pf');
  const pre = await p3.evaluate(() => ({ name: document.querySelector('.pf input[type=text]').value, kind: document.querySelector('.pf select').value, note: document.querySelector('.pf textarea').value, where: document.querySelector('.pf-where-text').innerText, priv: document.querySelector('.pf input[value=private]').checked }));
  check('saving it fills the form from the link, private', pre.name === 'Gerai Pak Mat' && pre.kind === 'food' && pre.note === 'Only mornings' && /south/i.test(pre.where) && pre.priv, pre);
  await p3.click('.pf button[type=submit]');
  await p3.waitForFunction(() => window.__app.myPlaces.list().length === 2, null, { timeout: 8000 }).catch(() => {});
  check('it is now one of your places', (await p3.evaluate(() => window.__app.myPlaces.list().map((p) => p.name).sort().join())) === 'Gerai Pak Mat,Kopitiam Lama SS2');
  if (!LOCAL) {
    await p3.waitForFunction(() => window.__app.myPlaces.pending === 0, null, { timeout: 8000 }).catch(() => {});
    const row = [...db.places.values()].find((p) => p.name === 'Gerai Pak Mat');
    check('a private place is kept on the service for your other devices, without your name on it', row && row.visibility === 'private' && row.owner_name === '' && row.owner === 'u-aina', row);
  }
  await p3.close();

  // ---- Settings: My places and the Google key
  await page.reload();
  await mapReady();
  await page.click('.searchbar .mini');
  await page.waitForSelector('dialog.settings[open]');
  const mapTab = page.locator('.set-tab', { hasText: 'Map' });
  if (await mapTab.count()) await mapTab.click();
  const settingsText = await page.evaluate(() => document.querySelector('dialog.settings').innerText);
  check('Settings shows your places and where they are kept', /My places/.test(settingsText) && /2 places/.test(settingsText) && (LOCAL ? /Kept in this browser/.test(settingsText) : /every device/.test(settingsText)), settingsText.match(/My places[^\n]*\n[^\n]*/)?.[0]);
  check('Settings has the Google Maps places key', /Google Maps places/.test(settingsText) && !!(await page.$('#googleKey')));
  await page.locator('#googleKey').scrollIntoViewIfNeeded();
  await shot('08-settings');
  await page.keyboard.press('Escape');

  // ---- delete (two taps)
  await page.evaluate(() => {
    const p = window.__app.myPlaces.list().find((x) => x.name === 'Kopitiam Lama SS2');
    window.__app.pickRegistered(p.id, true);
  });
  await page.waitForSelector('.sheet .pill');
  await pillByText(/^Edit$/).click();
  await page.waitForSelector('.pf-delete');
  await page.click('.pf-delete');
  const armed = await page.textContent('.pf-delete');
  check('Delete asks for a second tap', /Tap again/.test(armed ?? ''), armed);
  await page.click('.pf-delete');
  await sleep(500);
  check('the place is deleted', (await page.evaluate(() => window.__app.myPlaces.list().map((p) => p.name).join())) === 'Gerai Pak Mat');
  if (!LOCAL) {
    await page.waitForFunction(() => window.__app.myPlaces.pending === 0, null, { timeout: 8000 }).catch(() => {});
    check('and deleted on the service', ![...db.places.values()].some((p) => p.name === 'Kopitiam Lama SS2'));
  }

  // ---- night
  await page.evaluate(() => {
    const p = window.__app.myPlaces.list()[0];
    window.__app.pickRegistered(p.id, true);
  });
  await page.waitForSelector('.sheet .pill');
  await pillByText(/^Edit$/).click();
  await page.waitForSelector('.pf');
  await page.evaluate(() => {
    window.__app.settings = { ...window.__app.settings, appearance: 'night' };
    window.__app.checkDayNight?.();
  });
  await sleep(600);
  await shot('09-form-night');

  check('no errors on the page', errors.length === 0, errors.slice(0, 5));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, calls: db.calls }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
