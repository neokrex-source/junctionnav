/**
 * Browser check of the speed alerts and the three themes, on the demo drive (its road has speed
 * limits, a speed camera on E35 and an average speed check on E1, and nothing is fetched).
 *
 *  - The limit shows beside the speed and follows the road (80, 110, 90).
 *  - Near the limit: amber, one tone, "Approaching the speed limit of 110".
 *  - Over it: red, "Slow down. The speed limit is 90".
 *  - The speed camera: on the map, a chip with distance and limit, "Speed camera in 500 metres".
 *  - The average speed check: its chip, the start and the end announced.
 *  - Settings: tone only, the sign only, off; camera warnings off.
 *  - JunctionNav, Fighter jet and Casual by day and night: the page's colours, the map's, the
 *    jet's speed tape with its limit band and the casual dial. Screenshots of each.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-speed
 *   npx vite preview --outDir dist-speed --port 4183 &
 *   node scripts/dev/speed-check.cjs http://localhost:4183/ <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4183/';
const OUT = process.argv[3] ?? 'speed-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};

/** Opens the demo drive with these settings; speech and the alert sounds are recorded, not played. */
async function open(browser, settings) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1 });
  await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204, body: '' })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => {
    window.__spoken = [];
    window.speechSynthesis.speak = (u) => window.__spoken.push(u.text);
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify(s));
  }, { services: 'open', trafficNews: false, look: 2, appearance: 'day', ...settings });
  await page.goto(BASE + '?demo');
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await guest.click();
  await page.waitForFunction(() => window.__app?.sim && window.__app.speedData.info.limits.length > 1, null, { timeout: 30_000 });
  await page.evaluate(() => {
    const a = window.__app;
    window.__tones = [];
    a.voice.alert = (k) => window.__tones.push(k);
  });
  return { ctx, page, errors };
}

/** Puts the simulated car at a place on the demo road at a steady speed (km/h). */
const drive = (page, where, kmh, off = 0) =>
  page.evaluate(
    ([where, kmh, off]) => {
      const a = window.__app;
      const i = a.speedData.info;
      const s = where === 'e1' ? i.limits.find((l) => l.kmh === 110).s0 : where === 'check' ? i.checks[0].s0 : where === 'camera' ? i.cameras[0].s : 0;
      a.sim.speedAt = () => kmh / 3.6;
      a.sim.jumpTo(s + off);
    },
    [where, kmh, off],
  );
/** Waits until something matching was said (the words follow their tone by half a second). */
const said = (page, start, ms = 15_000) => page.waitForFunction((start) => window.__spoken.some((t) => t.startsWith(start)), start, { timeout: ms }).then(() => sleep(150), () => {});
const state = (page) =>
  page.evaluate(() => {
    const a = window.__app;
    const p = a.engine.progress;
    const el = a.el.speed;
    const chip = a.el.camChip;
    return {
      limit: p.speedo.limit?.kmh ?? null,
      speeding: p.speedo.speeding,
      meter: el.dataset.state,
      sign: el.querySelector('.spd-sign').hidden ? null : el.querySelector('.spd-sign').textContent,
      number: el.querySelector('.spd-num b').textContent,
      chip: chip.hidden ? null : chip.textContent,
      chipState: chip.dataset.state,
      // Nothing of the chip's line is cut off (its limit sign is the last thing in it).
      chipFits: chip.hidden || (() => {
        const line = chip.querySelector('.cam-line');
        return line.scrollWidth <= line.clientWidth + 1;
      })(),
      spoken: window.__spoken.slice(),
      tones: window.__tones.slice(),
      camerasOnMap: a.map.map.getSource('cameras')?._data?.features?.length ?? a.map.map.getSource('cameras')?.serialize?.().data?.features?.length ?? null,
    };
  });

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  /* ---------------------------------------------------------------- the alerts */
  {
    const { ctx, page, errors } = await open(browser, {});
    let st = await state(page);
    check('the limit shows beside the speed from the start (80 on Jalan Demo)', st.limit === 80 && st.sign === '80', st);
    check('the speed camera is on the map', st.camerasOnMap === 1, st.camerasOnMap);

    // On E1 (110) at 100 km/h: nothing to say.
    await drive(page, 'e1', 100, 10);
    await sleep(1500);
    st = await state(page);
    check('on the expressway the limit is 110, and 100 km/h is fine', st.limit === 110 && st.sign === '110' && st.meter === 'ok' && !st.tones.includes('near'), st);
    // 107 km/h: near.
    await drive(page, 'e1', 107, 20);
    await said(page, 'Approaching the speed limit');
    st = await state(page);
    check('near the limit: amber, one tone, "Approaching the speed limit of 110"', st.meter === 'near' && st.tones.filter((t) => t === 'near').length === 1 && st.spoken.includes('Approaching the speed limit of 110.'), st);
    await page.screenshot({ path: join(OUT, 'alert-near.png') });

    // Into the average speed check.
    await drive(page, 'check', 104, 30);
    await said(page, 'Average speed check');
    st = await state(page);
    check('the average speed check is announced and shown', st.spoken.some((t) => /^Average speed check for 800 metres\. Speed limit 110\.$/.test(t)) && /Average speed check/.test(st.chip ?? ''), st);
    await page.waitForFunction(() => /Average speed\d+/.test(window.__app.el.camChip.textContent), null, { timeout: 15_000 }).catch(() => {});
    st = await state(page);
    check('with the average so far, and all of it in view', /^Average speed10[3-5]\d+ m110$/.test(st.chip ?? '') && st.chipFits, st);
    await page.screenshot({ path: join(OUT, 'alert-check.png') });

    // Towards the camera on E35 (90) at 101 km/h: the camera, then "slow down".
    await drive(page, 'camera', 101, -520);
    await said(page, 'Slow down');
    st = await state(page);
    check('the speed camera is announced with its distance and limit', st.spoken.some((t) => /^Speed camera in \d+ metres\. Speed limit 90\./.test(t)) && st.tones.includes('camera'), st.spoken);
    check('and shown over the arrival time', /Speed camera/.test(st.chip ?? '') && /\d+ m/.test(st.chip ?? '') && /90/.test(st.chip ?? ''), st.chip);
    check('over the limit: red, three beeps, "Slow down. The speed limit is 90"', st.meter === 'over' && st.sign === '90' && st.tones.includes('over') && st.spoken.includes('Slow down. The speed limit is 90.'), st);
    check('the average speed check ended', st.spoken.includes('End of the average speed check.'), st.spoken);
    await page.screenshot({ path: join(OUT, 'alert-camera-over.png') });
    const overCount = st.spoken.filter((t) => t.startsWith('Slow down')).length;
    await sleep(4000);
    st = await state(page);
    check('the warning is not repeated at once', st.spoken.filter((t) => t.startsWith('Slow down')).length === overCount, st.spoken);
    // Slowing down clears it.
    await page.evaluate(() => (window.__app.sim.speedAt = () => 80 / 3.6));
    await sleep(1500);
    st = await state(page);
    check('slowing down clears it', st.meter === 'ok', st);
    check('no page errors', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  /* ---------------------------------------------------------------- settings */
  for (const [mode, want] of [
    ['tone', { tones: true, words: false, sign: true }],
    ['sign', { tones: false, words: false, sign: true }],
    ['off', { tones: false, words: false, sign: false }],
  ]) {
    const { ctx, page } = await open(browser, { speedAlerts: mode, speedCams: false });
    await drive(page, 'e1', 118, 20);
    await sleep(3000);
    const st = await state(page);
    const tones = st.tones.includes('over');
    const words = st.spoken.some((t) => t.startsWith('Slow down'));
    check(`Settings "${mode}": ${want.tones ? 'the tone' : 'no tone'}, ${want.words ? 'the words' : 'no words'}, ${want.sign ? 'the sign' : 'no sign'}`, tones === want.tones && words === want.words && (st.sign === '110') === want.sign && (mode === 'off' ? st.meter === 'ok' : st.meter === 'over'), st);
    if (mode === 'off') {
      await drive(page, 'camera', 80, -400);
      await sleep(1500);
      const c = await state(page);
      check('camera warnings off: no chip, no icon on the map', c.chip === null && c.camerasOnMap === 0 && !c.spoken.some((t) => /camera/i.test(t)), c);
    }
    await ctx.close();
  }
  {
    // Bahasa Melayu and miles.
    const { ctx, page } = await open(browser, { lang: 'ms', units: 'imperial' });
    await drive(page, 'camera', 101, -520);
    await said(page, 'Sila perlahankan');
    const st = await state(page);
    check('in Bahasa Melayu, and in miles per hour', st.spoken.some((t) => /^Kamera had laju dalam .*\. Had laju 56\./.test(t)) && st.sign === '56' && st.spoken.includes('Sila perlahankan. Had laju 56.'), st);
    await ctx.close();
  }

  /* ---------------------------------------------------------------- the three themes */
  const looks = {};
  for (const theme of ['junction', 'jet', 'casual'])
    for (const appearance of ['day', 'night']) {
      const { ctx, page, errors } = await open(browser, { theme, appearance });
      await drive(page, 'camera', 97, -520);
      await sleep(3500);
      const look = await page.evaluate(() => {
        const a = window.__app;
        const cs = getComputedStyle(document.documentElement);
        const body = getComputedStyle(document.body);
        const m = a.map.map;
        const el = a.el.speed;
        return {
          skin: document.documentElement.dataset.skin,
          theme: document.documentElement.dataset.theme,
          bg: cs.getPropertyValue('--bg').trim(),
          accent: cs.getPropertyValue('--route').trim(),
          font: body.fontFamily.split(',')[0].replace(/"/g, ''),
          land: m.getPaintProperty(m.getStyle().layers[0].id, 'background-color'),
          route: JSON.stringify(m.getPaintProperty('route-line', 'line-gradient')),
          bar: document.querySelector('meta[name="theme-color"]').content,
          tape: !!el.querySelector('.spd-tape'),
          pole: !!el.querySelector('.tp-pole'),
          lim: el.querySelector('.tp-lim')?.textContent ?? null,
          dial: !!el.querySelector('.spd-dial'),
          signShown: !!el.querySelector('.spd-sign') && getComputedStyle(el.querySelector('.spd-sign')).display !== 'none',
          size: [Math.round(el.getBoundingClientRect().width), Math.round(el.getBoundingClientRect().height)],
          chipFits: (() => {
            const line = a.el.camChip.querySelector('.cam-line');
            return !!line && line.scrollWidth <= line.clientWidth + 1;
          })(),
          overlap: (() => {
            const r = el.getBoundingClientRect();
            const hit = (o) => o && !o.hidden && o.getBoundingClientRect().width && !(o.getBoundingClientRect().right <= r.left || o.getBoundingClientRect().left >= r.right || o.getBoundingClientRect().bottom <= r.top || o.getBoundingClientRect().top >= r.bottom);
            return ['.recenter', '.scale-bar', '.cam-chip', '.eta'].filter((q) => hit(document.querySelector(q)));
          })(),
        };
      });
      looks[`${theme}-${appearance}`] = look;
      await page.screenshot({ path: join(OUT, `theme-${theme}-${appearance}.png`) });
      check(`${theme} ${appearance}: no page errors`, errors.length === 0, errors.slice(0, 2));
      await ctx.close();
    }
  const all = Object.values(looks);
  check('each look and time of day has its own page colours and its own map', new Set(all.map((l) => l.bg)).size === 6 && new Set(all.map((l) => l.land)).size === 6, all.map((l) => [l.bg, l.land]));
  check('the page says which look it is', ['junction', 'jet', 'casual'].every((t) => looks[`${t}-day`].skin === t && looks[`${t}-day`].theme === 'light' && looks[`${t}-night`].theme === 'dark'), all.map((l) => [l.skin, l.theme]));
  check('each look has its own typeface', looks['junction-day'].font === 'Saira' && looks['jet-day'].font === 'B612' && looks['casual-day'].font === 'Nunito', all.map((l) => l.font));
  check('the route colour differs between looks', new Set(['junction', 'jet', 'casual'].map((t) => looks[`${t}-night`].route)).size === 3);
  check('Fighter jet: a speed tape with the limit band and LIM 90, no road sign', looks['jet-day'].tape && looks['jet-night'].pole && looks['jet-night'].lim === 'LIM 90' && !looks['jet-night'].signShown && looks['jet-night'].size[1] >= 140, looks['jet-night']);
  check('Casual: a dial with the limit as a road sign', looks['casual-day'].dial && looks['casual-night'].dial && looks['casual-day'].signShown && !looks['casual-day'].tape, looks['casual-day']);
  check('JunctionNav: the speed bubble with the limit as a road sign', !looks['junction-day'].tape && !looks['junction-day'].dial && looks['junction-day'].signShown, looks['junction-day']);
  check('the speed instrument does not cover the map controls or the cards in any look', all.every((l) => l.overlap.length === 0), Object.fromEntries(Object.entries(looks).map(([k, l]) => [k, l.overlap])));
  check('the speed camera chip shows in full in every look', all.every((l) => l.chipFits), Object.fromEntries(Object.entries(looks).map(([k, l]) => [k, l.chipFits])));
  check('the browser bar takes each look’s colour', new Set(all.map((l) => l.bar)).size === 6, all.map((l) => l.bar));

  /* ---------------------------------------------------------------- choosing a theme in Settings */
  {
    const { ctx, page } = await open(browser, {});
    void page.evaluate(() => window.__app.editSettings()).catch(() => {});
    await page.waitForSelector('#set-tab-map');
    await page.click('#set-tab-map');
    const cards = await page.$$eval('.theme-card .tc-name', (e) => e.map((x) => x.textContent));
    check('Settings offers JunctionNav, Fighter jet and Casual', JSON.stringify(cards) === JSON.stringify(['JunctionNav', 'Fighter jet', 'Casual']), cards);
    await page.click('#theme-jet');
    await sleep(300);
    const preview = await page.evaluate(() => document.documentElement.dataset.skin);
    await page.screenshot({ path: join(OUT, 'settings-theme.png') });
    await page.click('button[value="cancel"]');
    await sleep(300);
    const back = await page.evaluate(() => [document.documentElement.dataset.skin, window.__app.settings.theme]);
    check('picking one shows it at once, and Cancel puts the old one back', preview === 'jet' && back[0] === 'junction' && back[1] === 'junction', { preview, back });
    void page.evaluate(() => window.__app.editSettings()).catch(() => {});
    await page.waitForSelector('#set-tab-map');
    await page.click('#set-tab-map');
    await page.click('#theme-casual');
    await page.click('button[value="save"]');
    await page.waitForFunction(() => window.__app.map.map.isStyleLoaded() && !document.querySelector('dialog.settings'), null, { timeout: 15_000 }).catch(() => {});
    await sleep(800);
    const saved = await page.evaluate(() => {
      const a = window.__app;
      const m = a.map.map;
      return { skin: document.documentElement.dataset.skin, theme: a.settings.theme, stored: JSON.parse(localStorage.getItem('junctionnav.settings.v1')).theme, land: m.getPaintProperty(m.getStyle().layers[0].id, 'background-color'), dial: !!a.el.speed.querySelector('.spd-dial') };
    });
    check('Save changes the page, the map and the speed instrument, and is remembered', saved.skin === 'casual' && saved.theme === 'casual' && saved.stored === 'casual' && saved.land === looks['casual-day'].land && saved.dial, saved);
    await page.click('#set-tab-drive').catch(() => {});
    await ctx.close();
  }

  await browser.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, looks }, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
