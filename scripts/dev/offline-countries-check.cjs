/**
 * Browser check of offline maps by country: Settings → Downloads lists the countries and regions
 * of Asia by part of the continent, two packs download one after the other (from the check's own
 * catalog: small packs made of the demo network), both are used at once (routing in the pack
 * where the trip is, all tiles as one map), packs on GitHub's release servers say they download
 * in the Android app, the list can be searched, and a pack can be deleted.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-alert
 *   npx vite preview --outDir dist-alert --port 4184 &
 *   node scripts/dev/offline-countries-check.cjs http://localhost:4184/ <shots dir>
 */
const { chromium } = require('playwright');
const { execFileSync } = require('node:child_process');
const { mkdirSync, readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');
const { gzipSync } = require('node:zlib');

const BASE = process.argv[2] ?? 'http://localhost:4184/';
const OUT = process.argv[3] ?? 'offline-countries-shots';
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
    pack('th', { en: 'Thailand', ms: 'Thailand' }, 'sea', [97.3, 5.6, 105.7, 20.5], false),
    pack('jp-kanto', { en: 'Japan: Kanto (Tokyo)', ms: 'Jepun: Kanto (Tokyo)', ja: '関東' }, 'east', [138.4, 34.8, 141.0, 37.2], false),
  ],
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1 });
  const fetched = [];
  await ctx.route('**/*', (r) => {
    const url = r.request().url();
    if (url === `${BASE}offline/catalog.json`) return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG) });
    if (url.startsWith(`${BASE}offline/`)) {
      const key = url.slice(`${BASE}offline/`.length);
      const body = served.get(key);
      fetched.push(key);
      return body ? r.fulfill({ status: 200, contentType: 'application/octet-stream', body }) : r.fulfill({ status: 404, body: '' });
    }
    if (url.startsWith(BASE)) return r.continue();
    if (/github\.com/.test(url)) fetched.push(url);
    return r.fulfill({ status: 204, body: '' });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('dialog', (d) => d.accept());
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ services: 'open', trafficNews: false, look: 2, appearance: 'day', voice: false }));
  });
  await page.goto(BASE);
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await guest.click();
  await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });
  await page.evaluate(() => window.__app.map.map.jumpTo({ center: [101.69, 3.14], zoom: 11 }));

  const openDownloads = async () => {
    void page.evaluate(() => window.__app.editSettings()).catch(() => {});
    await page.waitForSelector('#set-tab-downloads');
    await page.click('#set-tab-downloads');
    await page.waitForSelector('.off-row', { timeout: 15_000 });
  };
  await openDownloads();
  const list = await page.evaluate(() =>
    [...document.querySelectorAll('.off-group')].map((g) => ({
      group: g.querySelector('summary span')?.textContent,
      open: g.open,
      rows: [...g.querySelectorAll('.off-row')].map((r) => ({ id: r.dataset.pack, name: r.querySelector('.off-row-name')?.textContent, state: r.dataset.state, text: r.textContent })),
    })),
  );
  const sea = list.find((g) => g.group === 'Southeast Asia');
  const east = list.find((g) => g.group === 'East Asia');
  check('Offline maps lists the countries by part of Asia (Southeast Asia open where the map is)', sea?.open && east && !east.open && sea.rows.length === 3, list);
  const th = sea?.rows.find((r) => r.id === 'th');
  check('a pack on GitHub’s release servers says it downloads in the Android app', /In the Android app/.test(th?.text ?? ''), th);
  check('each country shows its size', sea?.rows.every((r) => /to download/.test(r.text)), sea?.rows.map((r) => r.text));
  await page.screenshot({ path: join(OUT, '01-list.png') });

  /* ---------------------------------------------------------------- two downloads, one after the other */
  await page.click('.off-row[data-pack="peninsular-my"] .btn-primary');
  await page.click('.off-row[data-pack="my-borneo"] .btn-primary');
  const waiting = await page.evaluate(() => ({ second: document.querySelector('.off-row[data-pack="my-borneo"]')?.dataset.state, first: document.querySelector('.off-row[data-pack="peninsular-my"]')?.dataset.state }));
  // (A fast machine may finish the first, small test pack before the second click: then it starts.)
  check('a second download waits for the first', waiting.second === 'queued' || waiting.second === 'installed' || (waiting.second === 'downloading' && waiting.first === 'installed'), waiting);
  await page.waitForFunction(() => ['peninsular-my', 'my-borneo'].every((id) => document.querySelector(`.off-row[data-pack="${id}"]`)?.dataset.state === 'installed'), null, { timeout: 30_000 }).catch(() => {});
  const after = await page.evaluate(() => ({
    states: [...document.querySelectorAll('.off-row')].map((r) => [r.dataset.pack, r.dataset.state]),
    status: document.querySelector('#offFilter')?.parentElement?.querySelector('.off-status')?.textContent ?? '',
    installed: window.__app.offline.installed.map((p) => p.id),
  }));
  check('both are on the device', JSON.stringify(after.installed.sort()) === JSON.stringify(['my-borneo', 'peninsular-my']), after);
  check('Settings says which are on the device and how much room they take', /On this device: .*Peninsular Malaysia and Singapore.*Sabah, Sarawak and Brunei/.test(after.status) || /On this device: .*Sabah, Sarawak and Brunei.*Peninsular Malaysia and Singapore/.test(after.status), after.status);
  check('nothing came from GitHub’s release servers in the browser', !fetched.some((u) => /github\.com/.test(u)), fetched.filter((u) => /github/.test(u)));
  await page.screenshot({ path: join(OUT, '02-installed.png') });

  // Search the list.
  await page.fill('#offFilter', 'kanto');
  await sleep(150);
  const found = await page.evaluate(() => [...document.querySelectorAll('.off-group')].map((g) => [g.querySelector('summary span')?.textContent, g.open, [...g.querySelectorAll('.off-row')].map((r) => r.dataset.pack)]));
  check('the list can be searched (kanto: Japan, opened)', JSON.stringify(found) === JSON.stringify([['East Asia', true, ['jp-kanto']]]), found);
  await page.fill('#offFilter', '');

  /* ---------------------------------------------------------------- using them */
  await page.waitForFunction(() => window.__app.offlineClient.loaded && window.__app.offlineMapReady, null, { timeout: 15_000 }).catch(() => {});
  const use = await page.evaluate(async (d) => {
    const a = window.__app;
    const c = a.offlineClient;
    const start = d.start;
    const end = [d.bounds[1][0] - 0.002, d.bounds[1][1] - 0.002];
    let route = null;
    try {
      const r = await c.route({ coords: [start, end], bearings: [null, null], avoid: {} });
      route = r.code;
    } catch (e) {
      route = String(e);
    }
    return {
      ready: a.offlineMapReady,
      covers: c.covers([start]),
      bangkok: c.covers([[100.5, 13.75]]),
      both: c.covers([start, [116.07, 5.98]]),
      route,
    };
  }, demo);
  check('routing offline answers from the pack the trip is in', use.route === 'Ok' && use.covers, use);
  check('a trip from Peninsular Malaysia to Sabah is beyond one pack', use.both === false && use.bangkok === false, use);
  const tiles = await page.evaluate(() => {
    const a = window.__app;
    const st = a.map.fallback();
    return { url: st.sources.protomaps.tiles?.[0], maxzoom: st.sources.protomaps.maxzoom };
  });
  check('the offline map draws every pack as one (offline-tiles://)', tiles.url === 'offline-tiles://{z}/{x}/{y}' && tiles.maxzoom === 15, tiles);

  /* ---------------------------------------------------------------- delete one */
  await page.click('.off-row[data-pack="my-borneo"] .off-delete');
  await page.waitForFunction(() => document.querySelector('.off-row[data-pack="my-borneo"]')?.dataset.state === 'available', null, { timeout: 10_000 }).catch(() => {});
  const del = await page.evaluate(() => ({ installed: window.__app.offline.installed.map((p) => p.id), status: document.querySelector('#offFilter')?.parentElement?.querySelector('.off-status')?.textContent ?? '' }));
  check('Delete removes one pack and keeps the other', JSON.stringify(del.installed) === JSON.stringify(['peninsular-my']) && /deleted/.test(del.status), del);

  // Kept after a reload.
  await page.reload();
  const g2 = page.getByText('Continue without an account');
  if (await g2.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await g2.click();
  await page.waitForFunction(() => window.__app?.offline?.installed?.length >= 1, null, { timeout: 20_000 }).catch(() => {});
  const kept = await page.evaluate(() => window.__app.offline.installed.map((p) => p.id));
  check('the pack is still there after a reload', JSON.stringify(kept) === JSON.stringify(['peninsular-my']), kept);

  check('no page errors', errors.length === 0, errors.slice(0, 3));
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
