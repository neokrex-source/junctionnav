// Screenshots of the pages map-check.ts wrote (served from the repo root on port 4173).
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] ?? 'map-check';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const mode of ['day', 'night']) {
    const page = await browser.newPage({ viewport: { width: 420, height: 760 }, deviceScaleFactor: 2 });
    page.on('console', (m) => m.type() === 'error' && console.log(mode, 'console:', m.text().slice(0, 200)));
    await page.goto(`http://localhost:4173/${out}/page-${mode}.html`);
    await page.waitForFunction(() => window.done, null, { timeout: 60000 }).catch(() => console.log(mode, 'did not go idle'));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/map-${mode}.png` });
    await page.close();
  }
  await browser.close();
})();
