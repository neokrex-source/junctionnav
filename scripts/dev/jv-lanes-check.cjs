/**
 * Browser check of the 3D junction view's lanes, day and night, on the demo drive: the lanes that
 * lead the route's way are in the route's colour with a bright edge line, every other lane at the
 * split (the rest of the approach, the other ways) is bright blue in contrast, and the other
 * carriageway is left out. Colours are read from screenshots of the view at the fork and at exit 114.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-alert
 *   npx vite preview --outDir dist-alert --port 4184 &
 *   node scripts/dev/jv-lanes-check.cjs http://localhost:4184/ <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4184/';
const OUT = process.argv[3] ?? 'jv-lanes-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};

const COLOURS = {
  day: { lanes: '#9a3412', edge: '#fff7ed', others: '#7486e0' },
  night: { lanes: '#c2410c', edge: '#fdba74', others: '#8090e0' },
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const appearance of ['night', 'day']) {
    const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 2 });
    await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204, body: '' })));
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    await page.addInitScript((s) => {
      window.speechSynthesis.speak = (u) => setTimeout(() => u.onend?.(), 10);
      if (sessionStorage.getItem('seeded')) return;
      sessionStorage.setItem('seeded', '1');
      localStorage.setItem('junctionnav.settings.v1', JSON.stringify(s));
    }, { services: 'open', trafficNews: false, look: 2, appearance, pretripCheck: false, jvMode: 'illustration', voice: false });
    await page.goto(BASE + '?demo');
    const guest = page.getByText('Continue without an account');
    if (await guest.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await guest.click();
    await page.waitForFunction(() => window.__app?.sim && window.__app.engine.route, null, { timeout: 30_000 });

    // With one lane to be in (the exit) the arrow fills it: its edge lines show either side.
    for (const [i, what, several] of [[3, 'the fork (2 of 4 lanes)', true], [4, 'exit 114 (1 of 3 lanes)', false]]) {
      await page.evaluate((i) => {
        const a = window.__app;
        const c = a.engine.junctions[i];
        a.sim.paused = false;
        a.sim.jumpTo(Math.max(0, c.s - 200));
      }, i);
      await page.waitForFunction((i) => window.__app.panel.visible && window.__app.activeJ === window.__app.engine.junctions[i].id, i, { timeout: 15_000 }).catch(() => {});
      await sleep(1500);
      await page.evaluate(() => (window.__app.sim.paused = true));
      await sleep(900);
      const box = await page.evaluate(() => {
        const r = window.__app.panel.el.querySelector('.jv-canvas')?.getBoundingClientRect();
        return r ? { x: r.x, y: r.y, width: r.width, height: r.height } : null;
      });
      const file = join(OUT, `${appearance}-${i}.png`);
      const png = await page.screenshot({ path: file, clip: box ?? undefined });
      // Count the pixels near each colour (in the page, from the screenshot).
      const counts = await page.evaluate(
        async ({ b64, colours }) => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const c = document.createElement('canvas');
          c.width = img.width;
          c.height = img.height;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0);
          const d = g.getImageData(0, 0, c.width, c.height).data;
          const rgb = (h) => [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16));
          const want = Object.fromEntries(Object.entries(colours).map(([k, v]) => [k, rgb(v)]));
          const out = Object.fromEntries(Object.keys(colours).map((k) => [k, 0]));
          for (let p = 0; p < d.length; p += 4) {
            for (const [k, [r, gg, bb]] of Object.entries(want)) {
              if (Math.abs(d[p] - r) + Math.abs(d[p + 1] - gg) + Math.abs(d[p + 2] - bb) < 24) out[k]++;
            }
          }
          return { ...out, total: d.length / 4 };
        },
        { b64: png.toString('base64'), colours: COLOURS[appearance] },
      );
      check(`${appearance}, ${what}: the lanes to be in are ${several ? 'orange, ' : ''}edged in a bright line`, (!several || counts.lanes > 150) && counts.edge > 150, counts);
      check(`${appearance}, ${what}: every other lane bright blue, in contrast`, counts.others > 2500, counts);
      const opp = await page.evaluate(() => (window.__app.panel.current?.roads ?? []).filter((r) => r.opposite).length);
      if (i === 3) check(`${appearance}, ${what}: the other carriageway (traffic the other way) is left out`, opp >= 1, opp);
    }
    check(`${appearance}: no page errors`, errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }
  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
