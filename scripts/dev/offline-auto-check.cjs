/**
 * Browser check of the offline map for where you are: with a GPS fix in Kuala Lumpur the app offers
 * the Peninsular Malaysia download on a card with its size (the browser always asks), downloads it
 * on Download, and then plans routes there on the phone with TomTom out of reach and no routing
 * server answering. Once it is on the device the card stays away; "Not now" keeps it away too.
 * Settings → Downloads has both switches.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-alert
 *   npx vite preview --outDir dist-alert --port 4184 &
 *   node scripts/dev/offline-auto-check.cjs http://localhost:4184/ <shots dir>
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');

const BASE = process.argv[2] ?? 'http://localhost:4184/';
const OUT = process.argv[3] ?? 'offline-auto-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};

/* ---------------------------------------------------------------- the packs */
const DEMO = join(OUT, 'demo-pack');
execFileSync('npx', ['vitest', 'run', 'tests/demoPack.dump.test.ts'], { env: { ...process.env, DEMO_PACK_OUT: DEMO }, stdio: 'pipe' });
const demo = JSON.parse(readFileSync(join(DEMO, 'demo.json'), 'utf8'));

/** A valid PMTiles archive with no tiles (the map draws nothing from it, which is fine here). */
function pmtiles(bbox) {
  const h = Buffer.alloc(127);
  h.write('PMTiles', 0, 'ascii');
  h.writeUInt8(3, 7);
  const root = Buffer.from([0]);
  const meta = Buffer.from(JSON.stringify({ vector_layers: [] }));
  const u64 = (v, at) => h.writeBigUInt64LE(BigInt(v), at);
  u64(127, 8);
  u64(root.length, 16);
  u64(127 + root.length, 24);
  u64(meta.length, 32);
  u64(127 + root.length + meta.length, 40);
  u64(0, 48);
  u64(127 + root.length + meta.length, 56);
  u64(0, 64);
  h.writeUInt8(1, 96);
  h.writeUInt8(1, 97);
  h.writeUInt8(1, 98);
  h.writeUInt8(1, 99);
  h.writeUInt8(0, 100);
  h.writeUInt8(15, 101);
  h.writeInt32LE(Math.round(bbox[0] * 1e7), 102);
  h.writeInt32LE(Math.round(bbox[1] * 1e7), 106);
  h.writeInt32LE(Math.round(bbox[2] * 1e7), 110);
  h.writeInt32LE(Math.round(bbox[3] * 1e7), 114);
  // Padding so the file comes in two parts.
  return Buffer.concat([h, root, meta, Buffer.alloc(1800)]);
}
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAIAAACQkWg2AAAAFklEQVR4nGN4VqFBEmIY1TCqYfhqAAAUGoYQFRF6QAAAAABJRU5ErkJggg==', 'base64');
function assets() {
  const files = { 'sprites/light.json': Buffer.from('{}'), 'sprites/light.png': PNG, 'sprites/dark.json': Buffer.from('{}'), 'sprites/dark.png': PNG };
  const index = {};
  let off = 0;
  for (const [k, b] of Object.entries(files)) {
    index[k] = [off, b.length];
    off += b.length;
  }
  return { bin: Buffer.concat(Object.values(files)), json: Buffer.from(JSON.stringify(index)) };
}

/** Pack files served by the check, and the catalog entry for them. */
const served = new Map();
function pack(id, name, group, bbox, web) {
  const version = '20261102T0100';
  const a = assets();
  const files = [
    ['tiles.pmtiles', pmtiles(bbox), false],
    ['graph.bin', readFileSync(join(DEMO, 'graph.bin')), true],
    ['places.bin', readFileSync(join(DEMO, 'places.bin')), true],
    ['assets.bin', a.bin, true],
    ['assets.json', a.json, false],
  ];
  const manifest = { id, name: name.en, version, built: '2026-11-02T01:00:00Z', bbox, drivingSide: 'left', attribution: '© OpenStreetMap contributors', files: [] };
  for (const [fname, data, gz] of files) {
    const body = gz ? gzipSync(data) : data;
    const PART = 1024;
    const parts = [];
    for (let i = 0, k = 0; i < body.length; i += PART, k++) {
      const path = `${version}.${fname}${gz ? '.gz' : ''}.${String(k).padStart(3, '0')}`;
      const url = web ? `${id}/${path}` : `https://github.com/neokrex-source/junctionnav/releases/download/maps-${id}/${path}`;
      served.set(`${id}/${path}`, body.subarray(i, i + PART));
      parts.push({ path: url, size: Math.min(PART, body.length - i) });
    }
    manifest.files.push({ name: fname, size: data.length, ...(gz ? { gzip: true } : {}), parts });
  }
  return { id, name, group, countries: [], bbox, web, manifest };
}
const CATALOG = {
  v: 1,
  built: '2026-11-02T02:00:00Z',
  packs: [
    pack('peninsular-my', { en: 'Peninsular Malaysia and Singapore', ms: 'Semenanjung Malaysia dan Singapura' }, 'sea', [99.45, 1.15, 104.65, 6.85], true),
    pack('my-borneo', { en: 'Sabah, Sarawak and Brunei', ms: 'Sabah, Sarawak dan Brunei' }, 'sea', [109.5, 0.8, 119.4, 7.45], true),
  ],
};


const KL = { latitude: 3.14, longitude: 101.69 };

async function open(browser) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1, geolocation: KL, permissions: ['geolocation'] });
  const asked = [];
  await ctx.route('**/*', (r) => {
    const url = r.request().url();
    if (url === `${BASE}offline/catalog.json`) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG) });
    if (url.startsWith(`${BASE}offline/`)) {
      const body = served.get(url.slice(`${BASE}offline/`.length));
      return body ? r.fulfill({ status: 200, contentType: 'application/octet-stream', body }) : r.fulfill({ status: 404, body: '' });
    }
    if (url.startsWith(BASE)) return r.continue();
    // No routing server, no TomTom: anything else goes unanswered.
    if (/route\/v1|routing\.|tomtom/.test(url)) asked.push(url);
    return r.fulfill({ status: 503, body: '' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    if (!localStorage.getItem('junctionnav.settings.v1')) localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ services: 'open', trafficNews: false, look: 2, appearance: 'day', voice: false }));
  });
  const start = async () => {
    await page.goto(BASE);
    const guest = page.getByText('Continue without an account');
    if (await guest.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await guest.click();
    await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });
  };
  await start();
  return { ctx, page, errors, asked, start };
}

const cardShown = (page, ms) => page.waitForSelector('.offline-ask:not([hidden])', { timeout: ms }).then(() => true, () => false);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  /* ---------------------------------------------------------------- the offer, then Download */
  const a = await open(browser);
  const shown = await cardShown(a.page, 15_000);
  const text = shown ? await a.page.textContent('.offline-ask') : '';
  check('with a fix in Kuala Lumpur the app offers the offline map for Peninsular Malaysia', shown && /Offline map for Peninsular Malaysia/.test(text), text);
  check('the offer gives the size and says what it is for', /Download \(\d/.test(text) && /TomTom/.test(text) && /no signal/.test(text), text);
  check('the browser offers "Not now" (no Wi-Fi wait)', /Not now/.test(text), text);
  await a.page.screenshot({ path: join(OUT, '01-offer.png') });
  if (shown) await a.page.click('#offline-ask-go');
  await a.page.waitForFunction(() => window.__app.offline.installed.some((p) => p.id === 'peninsular-my'), null, { timeout: 30_000 }).catch(() => {});
  const inst = await a.page.evaluate(() => ({ installed: window.__app.offline.installed.map((p) => p.id), hidden: document.querySelector('.offline-ask')?.hidden }));
  check('Download gets it onto the device and the card goes away', inst.installed.includes('peninsular-my') && inst.hidden, inst);
  await a.page.screenshot({ path: join(OUT, '02-downloading.png') });

  /* ---------------------------------------------------------------- routes on the phone */
  await a.page.waitForFunction(() => window.__app.offlineClient.loaded, null, { timeout: 15_000 }).catch(() => {});
  const r = await a.page.evaluate(async (d) => {
    const end = [d.bounds[1][0] - 0.002, d.bounds[1][1] - 0.002];
    try {
      const res = await window.__app.router.route({ origin: d.start, destination: end });
      return { provider: res.routes[0]?.provider, km: res.routes[0]?.distance / 1000, name: window.__app.router.name };
    } catch (e) {
      return { error: String(e) };
    }
  }, demo);
  check('with TomTom out of reach and no routing server answering, the route is planned on the phone', r.provider === 'Offline' && r.km > 0.3, r);
  check('no routing server was asked for it', a.asked.length === 0, a.asked);

  /* ---------------------------------------------------------------- not again once it is there */
  await a.page.evaluate(() => sessionStorage.removeItem('seeded'));
  await a.start();
  check('once it is on the device the app does not offer it again', !(await cardShown(a.page, 6000)));

  /* ---------------------------------------------------------------- Settings */
  void a.page.evaluate(() => window.__app.editSettings()).catch(() => {});
  await a.page.waitForSelector('#set-tab-downloads');
  await a.page.click('#set-tab-downloads');
  await a.page.waitForSelector('#offlineRoutes', { timeout: 10_000 }).catch(() => {});
  const sw = await a.page.evaluate(() => ({ routes: document.querySelector('#offlineRoutes')?.checked, auto: document.querySelector('#offlineAuto')?.checked, text: document.querySelector('#offlineRoutes')?.closest('.grp')?.textContent }));
  check('Settings → Downloads has both switches, on by default', sw.routes === true && sw.auto === true && /When TomTom is out of reach/.test(sw.text ?? ''), sw);
  await a.page.screenshot({ path: join(OUT, '03-settings.png') });
  check('no page errors (download)', a.errors.length === 0, a.errors);
  await a.ctx.close();

  /* ---------------------------------------------------------------- Not now */
  const b = await open(browser);
  if (await cardShown(b.page, 15_000)) await b.page.click('#offline-ask-later');
  const said = await b.page.evaluate(() => ({ hidden: document.querySelector('.offline-ask')?.hidden, kept: localStorage.getItem('junctionnav.offline.auto'), jobs: [...window.__app.offline.jobs.keys()] }));
  check('"Not now" closes the card and downloads nothing', said.hidden && /"answer":"no"/.test(said.kept ?? '') && said.jobs.length === 0, said);
  await b.page.evaluate(() => sessionStorage.removeItem('seeded'));
  await b.start();
  check('after "Not now" the app does not ask again at the next start', !(await cardShown(b.page, 6000)));
  check('no page errors (not now)', b.errors.length === 0, b.errors);
  await b.ctx.close();

  await browser.close();
  writeFileSync(join(OUT, 'report.json'), JSON.stringify(results, null, 2));
  const failed = results.filter((x) => !x.ok).length;
  console.log(failed ? `${failed} of ${results.length} failed` : `all ${results.length} passed`);
  process.exit(failed ? 1 : 0);
})();
