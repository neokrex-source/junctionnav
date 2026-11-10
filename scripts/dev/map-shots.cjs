// Screenshots of the pages map-check.ts wrote (served from the repo root on port 4173).
const { chromium } = require('playwright');
(async () => {
  const out = process.argv[2] ?? 'map-check';
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const { existsSync } = require('node:fs');
  for (const mode of ['day', 'night', 'tt-day', 'tt-night']) {
    if (!existsSync(`${out}/page-${mode}.html`)) continue;
    const page = await browser.newPage({ viewport: { width: 420, height: 760 }, deviceScaleFactor: 2 });
    // The TomTom key goes in the address only (never into the pushed files or the console).
    page.on('console', (m) => m.type() === 'error' && console.log(mode, 'console:', m.text().slice(0, 200).replace(process.env.TT_KEY || '\u0000', '…')));
    await page.goto(`http://localhost:4173/${out}/page-${mode}.html${mode.startsWith('tt') ? `?k=${encodeURIComponent(process.env.TT_KEY ?? '')}` : ''}`);
    await page.waitForFunction(() => window.done, null, { timeout: 60000 }).catch(() => console.log(mode, 'did not go idle'));
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `${out}/map-${mode}.png` });
    await page.close();
  }
  await browser.close();
})();
