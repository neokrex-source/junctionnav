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
  await sleep(8000);
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

  // Settings, scrolled to the offline maps, then the Android back button closes it.
  await page.click('button[aria-label="Settings"]');
  await page.waitForSelector('dialog.settings .off');
  await page.$eval('dialog.settings .off', (el) => el.scrollIntoView({ block: 'center' }));
  await sleep(2500);
  await shot('3-settings-offline');
  await device.shell('input keyevent KEYCODE_BACK');
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

  // The demo drive: guidance, the radar pulse and the 3D junction view, as installed.
  await page.evaluate(() => window.__app.startDemo(true));
  await page.waitForFunction(() => window.__app.sim, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const a = window.__app;
    a.sim.paused = true;
    a.sim.jumpTo(a.engine.junctions[0].s - 420);
  });
  await sleep(6000);
  const jv = await page.evaluate(() => {
    const el = document.querySelector('.jv');
    return el && !el.hidden ? Math.round(el.getBoundingClientRect().height) : 0;
  });
  check('3D junction view shows on the demo drive', jv > 100, `${jv} px high`);
  await shot('4-junction-view');
  // Back while navigating sends the app to the background instead of closing it.
  await device.shell('input keyevent KEYCODE_BACK');
  await sleep(1500);
  const top = (await device.shell('dumpsys activity activities | grep -m1 -E "topResumedActivity|mResumedActivity"')).toString();
  check('back while navigating keeps the app running in the background', !top.includes(PKG), top.trim().slice(0, 160));

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
