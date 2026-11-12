#!/usr/bin/env node
/**
 * Makes every bitmap of the JunctionNav mark from the SVGs scripts/brand/mark.mjs writes:
 * the web icons, the Android launcher icons (legacy, round, adaptive foreground and its themed
 * one-colour layer) and the Android launch screens. Needs Playwright's Chromium.
 *
 *   node scripts/brand/mark.mjs && node scripts/brand/icons.cjs
 */
const { chromium } = require('playwright');
const { readFileSync, mkdirSync } = require('node:fs');
const { join, dirname } = require('node:path');

const ROOT = join(__dirname, '..', '..');
const read = (p) => readFileSync(join(ROOT, p), 'utf8');
const RES = 'android/app/src/main/res';
const DENSITY = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };

(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage({ deviceScaleFactor: 1 });
  /** Draws `html` at w by h with a transparent page and saves it as a PNG. */
  const shot = async (html, w, h, out) => {
    await page.setViewportSize({ width: w, height: h });
    await page.setContent(`<!doctype html><html><head><style>html,body{margin:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}svg{display:block}</style></head><body>${html}</body></html>`);
    await page.waitForTimeout(50);
    mkdirSync(dirname(join(ROOT, out)), { recursive: true });
    await page.screenshot({ path: join(ROOT, out), omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } });
    console.log('wrote', out, `${w}x${h}`);
  };
  const sized = (svg, w, h = w) => svg.replace('<svg ', `<svg width="${w}" height="${h}" `);

  const icon = read('public/icon.svg');
  const maskable = read('public/icon-maskable.svg');
  const full = read('scripts/brand/full.svg');
  const fg = read('scripts/brand/fg.svg');
  const fgMono = read('scripts/brand/fg-mono.svg');
  const mark = read('scripts/brand/mark-fade.svg');

  // Web.
  await shot(sized(icon, 192), 192, 192, 'public/icon-192.png');
  await shot(sized(icon, 512), 512, 512, 'public/icon-512.png');
  await shot(sized(maskable, 512), 512, 512, 'public/icon-maskable-512.png');
  await shot(sized(full, 180), 180, 180, 'public/apple-touch-icon.png');

  // Android launcher icons.
  for (const [d, k] of Object.entries(DENSITY)) {
    const s = Math.round(48 * k);
    await shot(sized(icon, s), s, s, `${RES}/mipmap-${d}/ic_launcher.png`);
    await shot(`<div style="width:${s}px;height:${s}px;border-radius:50%;overflow:hidden">${sized(full, s)}</div>`, s, s, `${RES}/mipmap-${d}/ic_launcher_round.png`);
    const f = Math.round(108 * k);
    await shot(sized(fg, f), f, f, `${RES}/mipmap-${d}/ic_launcher_foreground.png`);
    await shot(sized(fgMono, f), f, f, `${RES}/mipmap-${d}/ic_launcher_monochrome.png`);
  }

  // Android launch screens: the mark on the plum glow, as the web app's own splash has it.
  const splash = (w, h) => {
    const m = Math.round(Math.min(w, h) * 0.42);
    return `<div style="width:${w}px;height:${h}px;display:grid;place-items:center;background:radial-gradient(120% 80% at 50% 38%, #3b1b74 0%, #1c0d36 55%, #0b0910 100%)">${sized(mark, m)}</div>`;
  };
  const SPLASH = {
    'drawable/splash.png': [480, 320],
    'drawable-port-mdpi/splash.png': [320, 480],
    'drawable-port-hdpi/splash.png': [480, 800],
    'drawable-port-xhdpi/splash.png': [720, 1280],
    'drawable-port-xxhdpi/splash.png': [960, 1600],
    'drawable-port-xxxhdpi/splash.png': [1280, 1920],
    'drawable-land-mdpi/splash.png': [480, 320],
    'drawable-land-hdpi/splash.png': [800, 480],
    'drawable-land-xhdpi/splash.png': [1280, 720],
    'drawable-land-xxhdpi/splash.png': [1600, 960],
    'drawable-land-xxxhdpi/splash.png': [1920, 1280],
  };
  for (const [p, [w, h]] of Object.entries(SPLASH)) await shot(splash(w, h), w, h, `${RES}/${p}`);

  await browser.close();
})();
