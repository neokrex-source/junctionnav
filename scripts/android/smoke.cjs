#!/usr/bin/env node
// Installs the Android app on a running emulator, drives its WebView with Playwright and writes
// screenshots plus report.json to <out dir>. Fails when something the app needs is missing in
// the Android WebView: offline map storage, Android's voice, keeping the screen on, WebGL.
// Usage (needs adb and an emulator): node scripts/android/smoke.cjs <app-debug.apk> <out dir> [version]
const { _android } = require('playwright');
const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const [apk, out, version = ''] = process.argv.slice(2);
const PKG = 'io.github.neokrexsource.junctionnav';
const KL = [101.6869, 3.1478];
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const adb = (...args) => execFileSync('adb', args, { encoding: 'utf8' }).trim();

const report = { version, checks: {}, info: {}, problems: [] };
const save = () => fs.writeFileSync(path.join(out, 'report.json'), JSON.stringify(report, null, 2));

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const check = (name, ok, detail) => {
    report.checks[name] = { ok: !!ok, ...(detail !== undefined ? { detail } : {}) };
    console.log(`${ok ? 'ok  ' : 'FAIL'} ${name}${detail !== undefined ? `: ${typeof detail === 'string' ? detail : JSON.stringify(detail)}` : ''}`);
  };
  const [device] = await _android.devices();
  if (!device) throw new Error('No Android device or emulator found');
  report.info.device = `${device.model()} (${device.serial()})`;
  const shot = async (name) => device.screenshot({ path: path.join(out, `${name}.png`) });
  // The emulator runs slowly, and its own apps (launcher, Messages) sometimes stop answering; the
  // "isn't responding" dialog then takes the back key meant for JunctionNav. Ask Android not to
  // show those, and before each back press tap "Wait" on any that still appears.
  for (const cmd of ['settings put global hide_error_dialogs 1', 'settings put secure anr_show_background 0', 'pm disable-user --user 0 com.google.android.apps.messaging']) {
    await device.shell(cmd).catch(() => {});
  }
  const pressBack = async () => {
    for (let i = 0; i < 3; i++) {
      const focus = (await device.shell('dumpsys window | grep -m1 mCurrentFocus')).toString();
      if (!/Not Responding|isn't responding|Application Error/i.test(focus)) break;
      report.problems.push(`system dialog in the way: ${focus.trim().slice(0, 160)}`);
      const wait = await device.wait({ text: 'Wait' }, { timeout: 2000 }).then(() => true, () => false);
      if (wait) await device.tap({ text: 'Wait' }).catch(() => {});
      else await device.shell('am broadcast -a android.intent.action.CLOSE_SYSTEM_DIALOGS').catch(() => {});
      await sleep(800);
    }
    await device.shell('input keyevent KEYCODE_BACK');
  };

  await device.installApk(fs.readFileSync(apk));
  // As if the user tapped "Allow" on the location prompt, and a GPS fix in Kuala Lumpur.
  await device.shell(`pm grant ${PKG} android.permission.ACCESS_FINE_LOCATION`);
  await device.shell(`pm grant ${PKG} android.permission.ACCESS_COARSE_LOCATION`);
  try {
    adb('emu', 'geo', 'fix', String(KL[0]), String(KL[1]));
  } catch (e) {
    report.problems.push(`geo fix: ${e.message}`);
  }
  report.info.webviewPackage = (await device.shell('dumpsys webviewupdate | grep -m1 "Current WebView package"')).toString().trim();
  await device.shell(`am start -W -n ${PKG}/.MainActivity`);
  await sleep(1500);
  await shot('0-launch');

  const webview = await device.webView({ pkg: PKG }, { timeout: 90_000 });
  const page = await webview.page();
  page.on('pageerror', (e) => report.problems.push(`page error: ${e.message}`));
  page.on('console', (m) => {
    const t = m.text();
    if (m.type() === 'error' || /^\[(map|offline|sw|voice|terrain)\]/.test(t)) report.problems.push(`console ${m.type()}: ${t.slice(0, 300)}`);
  });
  await page.waitForSelector('.auth:not([hidden])', { timeout: 60_000 });
  await sleep(800);
  await shot('1-sign-in');

  // What the app relies on, inside this WebView.
  const env = await page.evaluate(async () => {
    const cap = window.Capacitor;
    const r = {
      ua: navigator.userAgent,
      platform: cap?.getPlatform?.(),
      native: cap?.isNativePlatform?.() ?? false,
      plugins: ['TextToSpeech', 'KeepAwake', 'App', 'SystemBars'].map((p) => [p, !!cap?.isPluginAvailable?.(p)]),
      webgl2: !!document.createElement('canvas').getContext('webgl2'),
      speechSynthesisInWebView: 'speechSynthesis' in window,
      online: navigator.onLine,
    };
    // Offline maps storage: write and read back a small file the way the pack download does.
    try {
      const root = await navigator.storage.getDirectory();
      const fh = await root.getFileHandle('smoke.txt', { create: true });
      const w = await fh.createWritable({ keepExistingData: false });
      await w.write('junction');
      await w.close();
      r.opfs = (await (await fh.getFile()).text()) === 'junction';
      await root.removeEntry('smoke.txt');
    } catch (e) {
      r.opfs = false;
      r.opfsError = String(e);
    }
    r.gunzip = typeof DecompressionStream === 'function';
    return r;
  });
  report.info.userAgent = env.ua;
  check('runs as the Android app', env.native && env.platform === 'android', env.platform);
  for (const [p, ok] of env.plugins) check(`plugin ${p}`, ok);
  check('WebGL 2 (map and 3D views)', env.webgl2);
  check('offline map storage (write and read a file)', env.opfs, env.opfsError);
  check('decompression for the offline pack', env.gunzip);

  // Sign up with a local account, as a first-time user would.
  await page.click('#auth-tab-signup');
  await page.fill('#auth-name', 'Anuar');
  await page.fill('#auth-email', 'android@example.com');
  await page.fill('#auth-password', 'Junction2026');
  await page.click('.auth-submit');
  await page.waitForSelector('.auth', { state: 'hidden', timeout: 30_000 });
  await page.waitForFunction(() => window.__app, null, { timeout: 30_000 });
  // The first map tiles: on the emulator's network they can take twenty seconds or so.
  await page.waitForFunction(() => window.__app.map.tilesOk > 0 || window.__app.map.styleFailed, null, { timeout: 40_000 }).catch(() => {});
  await sleep(1500);
  await shot('2-map');
  // The online map: which style is up, whether its tiles arrive, and a direct look at the tile server.
  const map = await page.evaluate(async () => {
    const m = window.__app.map;
    const st = m.currentStyle;
    const r = {
      style: typeof st === 'string' ? st : Object.keys(st?.sources ?? {}).join(','),
      tilesOk: m.tilesOk,
      tileErrors: m.tileErrors,
      lastError: m.lastError ? String(m.lastError).slice(0, 300) : null,
      fellBack: m.styleFailed,
      canvas: [m.map.getCanvas().width, m.map.getCanvas().height],
    };
    for (const u of ['https://tiles.openfreemap.org/planet', 'https://tiles.openfreemap.org/fonts/Noto%20Sans%20Regular/0-255.pbf']) {
      try {
        const res = await fetch(u, { cache: 'no-store' });
        r[u.split('/').slice(3, 5).join('/')] = `${res.status} ${res.headers.get('content-type')}`;
      } catch (e) {
        r[u.split('/').slice(3, 5).join('/')] = String(e);
      }
    }
    return r;
  });
  report.info.map = map;
  check('online map tiles load (no fallback)', map.tilesOk > 0 && !map.fellBack, map);
  if (!(map.tilesOk > 0 && !map.fellBack)) {
    // Back to the usual map with the fallback switched off, watching every tile's state, to tell
    // a slow start from tiles that never finish.
    report.info.mapRetry = await page.evaluate(async () => {
      const a = window.__app;
      const m = a.map;
      const fails = [];
      m.fail = (r) => fails.push(String(r));
      const errors = [];
      m.map.on('error', (e) => errors.push(String(e?.error?.message ?? e).slice(0, 200)));
      a.refreshMapSource(true);
      const states = () => {
        const out = {};
        for (const [id, tm] of Object.entries(m.map.style?.tileManagers ?? {})) {
          const tiles = tm._inViewTiles?.getAllTiles?.() ?? [];
          if (tiles.length) out[id] = tiles.reduce((acc, t) => ((acc[t.state] = (acc[t.state] || 0) + 1), acc), {});
        }
        return out;
      };
      const t0 = performance.now();
      const samples = [];
      let first = null;
      while (performance.now() - t0 < 90_000) {
        await new Promise((r) => setTimeout(r, 3000));
        const t = Math.round((performance.now() - t0) / 1000);
        samples.push(`${t}s ok=${m.tilesOk} ${JSON.stringify(states())}`);
        if (m.tilesOk > 0 && first == null) first = t;
        if (m.tilesOk > 8) break;
      }
      const res = performance
        .getEntriesByType('resource')
        .filter((e) => /openfreemap/.test(e.name))
        .slice(-12)
        .map((e) => `${e.name.split('/').slice(3).join('/').slice(0, 80)} ${Math.round(e.duration)}ms`);
      return { firstTileAfter: first, samples, fails, errors: errors.slice(0, 8), resources: res, style: typeof m.currentStyle === 'string' ? m.currentStyle : Object.keys(m.currentStyle.sources).join(',') };
    });
    console.log('map retry', JSON.stringify(report.info.mapRetry));
    await shot('2b-map-retry');
  }

  // Settings, scrolled to the offline maps, then the Android back button closes it.
  await page.click('button[aria-label="Settings"]');
  await page.click('dialog.settings [role="tab"][data-tab="downloads"]');
  await page.waitForSelector('dialog.settings .off');
  await page.$eval('dialog.settings .off', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(2500);
  await shot('3-settings-offline');
  await pressBack();
  await sleep(1200);
  const closed = await page.evaluate(() => !document.querySelector('dialog[open]'));
  check('back button closes Settings', closed);

  const app = await page.evaluate(async () => {
    const a = window.__app;
    const cap = window.Capacitor;
    // Native plugin calls the way Capacitor's own proxies make them, with a time limit.
    const call = (plugin, method, options = {}) =>
      Promise.race([
        cap.Plugins?.[plugin]?.[method] ? cap.Plugins[plugin][method](options) : cap.nativePromise(plugin, method, options),
        new Promise((_, no) => setTimeout(() => no(new Error(`${plugin}.${method} did not answer`)), 15_000)),
      ]);
    const T = { getSupportedLanguages: () => call('TextToSpeech', 'getSupportedLanguages'), speak: (o) => call('TextToSpeech', 'speak', o) };
    const K = { keepAwake: () => call('KeepAwake', 'keepAwake'), isKeptAwake: () => call('KeepAwake', 'isKeptAwake'), allowSleep: () => call('KeepAwake', 'allowSleep') };
    const r = { packUrl: a.offline.manifestUrl, packSupported: a.offline.supported };
    try {
      const res = await fetch(a.offline.manifestUrl, { cache: 'no-store' });
      const m = res.ok ? await res.json() : null;
      r.pack = m ? { name: m.name, files: m.files.map((f) => f.name) } : `HTTP ${res.status}`;
    } catch (e) {
      r.pack = String(e);
    }
    try {
      r.ttsLanguages = (await T.getSupportedLanguages()).languages.length;
      await T.speak({ text: 'Keep right toward Kuala Lumpur', lang: 'en-GB' });
      r.ttsSpoke = true;
    } catch (e) {
      r.ttsError = String(e?.message ?? e);
    }
    try {
      await K.keepAwake();
      r.keptAwake = (await K.isKeptAwake()).isKeptAwake;
      await K.allowSleep();
    } catch (e) {
      r.keepAwakeError = String(e?.message ?? e);
    }
    // Traffic news (no key): the feed the Traffic news workflow publishes.
    try {
      await a.traffic.refreshNews(true);
      r.trafficNews = { url: a.traffic.o?.newsUrl?.() ?? null, items: a.traffic.news.length, updated: a.traffic.newsUpdated };
    } catch (e) {
      r.trafficNews = String(e);
    }
    r.trafficButton = !!document.querySelector('#btn-traffic');
    r.position = await new Promise((res) =>
      navigator.geolocation.getCurrentPosition(
        (p) => res([p.coords.longitude, p.coords.latitude]),
        (e) => res(`error ${e.code}: ${e.message}`),
        { enableHighAccuracy: true, timeout: 20_000 },
      ),
    );
    return r;
  });
  report.info.app = app;
  check('offline maps can be downloaded from the site', app.packSupported && typeof app.pack === 'object', app.pack);
  check('keeps the screen on', app.keptAwake === true, app.keepAwakeError);
  // The emulator image may have no voice installed; the plugin answering is what the app needs.
  check("Android's voice answers", app.ttsSpoke || /not available|no engine|language/i.test(app.ttsError ?? ''), app.ttsSpoke ? `${app.ttsLanguages} languages` : app.ttsError);
  check('GPS position reaches the app', Array.isArray(app.position), app.position);
  // The feed may be empty in a quiet hour; that it answers is what counts.
  check('traffic news feed answers', app.trafficButton && typeof app.trafficNews === 'object' && !!app.trafficNews.updated, app.trafficNews);

  // Places around you: the real data from the site, into the app's own storage and its worker.
  try {
    const t0 = Date.now();
    const pl = await page.evaluate(async () => {
      const svc = window.__app.placesSvc;
      const st = await svc.update(false, true);
      const hits = await svc.client.search('mcdonald', [101.6869, 3.139], 3).catch(() => []);
      return { count: st?.count ?? 0, cells: st?.cells, mb: st ? +(st.bytes / 1048576).toFixed(1) : 0, area: st?.area, status: svc.status, search: hits.map((h) => h.name) };
    });
    report.info.places = { ...pl, seconds: Math.round((Date.now() - t0) / 1000) };
    check('places around you download from the site', pl.count > 1000 && pl.search.length > 0, report.info.places);
  } catch (e) {
    check('places around you download from the site', false, String(e?.message ?? e).slice(0, 300));
  }

  // Search: a Google Maps share link, followed by the app itself (a web page cannot), and a rough
  // address placed by the places around you. Real share links of places in Kuala Lumpur; one is enough.
  try {
    const sr = await page.evaluate(async () => {
      const links = ['https://maps.app.goo.gl/jp5v5NVdPH9gjGpD9', 'https://maps.app.goo.gl/9JuMioce8MazLrfE6', 'https://maps.app.goo.gl/rt3kgFSsZXm5NvnD9'];
      const links_out = [];
      for (const l of links) {
        try {
          const r = await window.__app.smart.search(`Look at this place ${l}`, null, 'en');
          links_out.push({ l, name: r[0]?.name, sub: r[0]?.sub, at: r[0]?.lngLat, kind: r[0]?.kind });
        } catch (e) {
          links_out.push({ l, error: String(e?.message ?? e) });
        }
      }
      const area = await window.__app.placesSvc.client.area('Jalan Bukit Bintang', '55100', 'Kuala Lumpur').catch((e) => String(e));
      return { links: links_out, area };
    });
    report.info.search = sr;
    const nearKL = (p) => Array.isArray(p) && Math.abs(p[0] - 101.69) < 0.4 && Math.abs(p[1] - 3.14) < 0.4;
    check('a Google Maps share link opens in search', sr.links.some((x) => x.kind === 'coords' && nearKL(x.at)), sr.links);
    check('a rough address finds its street from the places around you', Array.isArray(sr.area) && sr.area.some((a) => a.by === 'street' && nearKL([a.lon, a.lat])), sr.area);
  } catch (e) {
    check('a Google Maps share link opens in search', false, String(e?.message ?? e).slice(0, 300));
  }

  // The demo drive: guidance, the radar pulse and the 3D junction view, as installed.
  await page.evaluate(() => window.__app.startDemo(true));
  await page.waitForFunction(() => window.__app.sim, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const a = window.__app;
    a.sim.paused = true;
    a.sim.jumpTo(a.engine.junctions[0].s - 220); // inside the 300 m where the junction view shows
  });
  await sleep(6000);
  const jv = await page.evaluate(() => {
    const el = document.querySelector('.jv');
    return el && !el.hidden ? Math.round(el.getBoundingClientRect().height) : 0;
  });
  check('3D junction view shows on the demo drive', jv > 100, `${jv} px high`);
  await shot('4-junction-view');
  // Back while navigating sends the app to the background instead of closing it.
  report.info.beforeBack = await page.evaluate(() => ({
    view: window.__app.view,
    dialogs: [...document.querySelectorAll('dialog[open]')].map((d) => d.className || d.getAttribute('aria-label')),
    sheetOpen: !document.querySelector('.sheet')?.hidden,
    preview: !!window.__app.preview?.isOpen,
  }));
  await page.evaluate(() => {
    window.__hidden = false;
    document.addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && (window.__hidden = true));
  });
  await pressBack();
  // The emulator draws the map and the 3D view in software, so give the app up to 10 s.
  let top = '';
  let wentHidden = null;
  const t0 = Date.now();
  for (let i = 0; i < 20; i++) {
    await sleep(500);
    top = (await device.shell('dumpsys activity activities')).toString().match(/topResumedActivity=.*|mResumedActivity.*/)?.[0] ?? '';
    wentHidden = await page.evaluate(() => window.__hidden).catch(() => null);
    if (wentHidden === true || (top && !top.includes(PKG))) break;
  }
  report.info.backToBackgroundMs = Date.now() - t0;
  await shot('5-after-back-in-nav');
  check('back while navigating keeps the app running in the background', wentHidden === true || (top && !top.includes(PKG)), { top: top.slice(0, 140), wentHidden, before: report.info.beforeBack });
  // And it is still running: bring it back.
  await device.shell(`am start -n ${PKG}/.MainActivity`);
  await sleep(1500);
  const still = await page.evaluate(() => window.__app.view).catch((e) => String(e));
  check('still navigating when brought back', still === 'nav', still);

  // Website mode: the app downloads the latest website build, runs it in place of the built-in
  // copy with the same account and Android features, then goes back to the built-in copy.
  try {
    await page.evaluate(() => window.__app.endNav());
    await sleep(1500);
    await page.evaluate(() => {
      void window.__app.setAppMode('web');
    });
    await page.waitForFunction(() => window.__appCopy === 'web' && !!window.__app, null, { timeout: 180_000, polling: 1000 });
    await sleep(5000);
    const web = await page.evaluate(() => ({
      copy: window.__appCopy,
      mode: JSON.parse(localStorage.getItem('junctionnav.settings.v1') || '{}').appMode,
      downloaded: JSON.parse(localStorage.getItem('junctionnav.webApp') || 'null'),
      signedIn: !document.querySelector('.auth:not([hidden])'),
      plugins: ['TextToSpeech', 'KeepAwake', 'App', 'Filesystem'].filter((p) => !window.Capacitor.isPluginAvailable(p)),
      packUrl: window.__app.offline.manifestUrl,
    }));
    report.info.websiteMode = web;
    check('website mode runs the latest website build in the app', web.copy === 'web' && web.mode === 'web' && !!web.downloaded, web.downloaded);
    check('website mode keeps the account, the Android features and the offline maps address', web.signedIn && web.plugins.length === 0 && /offline\/manifest\.json$/.test(web.packUrl), web);
    await page.click('button[aria-label="Settings"]');
    await page.click('dialog.settings [role="tab"][data-tab="app"]');
    await page.waitForSelector('dialog.settings #appMode');
    await page.$eval('dialog.settings #appMode', (el) => el.scrollIntoView({ block: 'center' }));
    await sleep(1200);
    await shot('6-settings-website-mode');
    await pressBack();
    await sleep(1000);
    await page.evaluate(() => {
      void window.__app.setAppMode('built-in');
    });
    await page.waitForFunction(() => window.__appCopy === 'built-in' && !!window.__app, null, { timeout: 60_000, polling: 1000 });
    await sleep(2000);
    const builtIn = await page.evaluate(() => ({ copy: window.__appCopy, signedIn: !document.querySelector('.auth:not([hidden])') }));
    check('switches back to the built-in version', builtIn.copy === 'built-in' && builtIn.signedIn, builtIn);
  } catch (e) {
    check('website mode', false, String(e?.message ?? e).slice(0, 400));
  }

  const failed = Object.entries(report.checks).filter(([, c]) => !c.ok).map(([n]) => n);
  report.failed = failed;
  save();
  console.log(`::notice title=Android check::${failed.length ? `failed: ${failed.join(', ')}` : 'all checks passed'} (${report.info.userAgent?.match(/Chrome\/[\d.]+/)?.[0] ?? 'WebView'})`);
  await device.close();
  process.exit(failed.length ? 1 : 0);
})().catch((e) => {
  console.error(e);
  try {
    report.error = String(e?.stack ?? e);
    save();
  } catch {
    /* nothing */
  }
  process.exit(1);
});
