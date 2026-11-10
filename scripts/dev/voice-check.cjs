/**
 * Browser check of the male voice option: the browser's speech is given a few voices by the
 * check (as Chrome and Edge have them), and what Settings offers, Test voice and the prompts say
 * with are checked.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-ttmap
 *   npx vite preview --outDir dist-ttmap --port 4182 &
 *   node scripts/dev/voice-check.cjs http://localhost:4182/ <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4182/';
const OUT = process.argv[3] ?? 'voice-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 } });
  await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204, body: '', headers: { 'Access-Control-Allow-Origin': '*' } })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript(() => {
    const voices = [
      { name: 'Google UK English Female', lang: 'en-GB', voiceURI: 'Google UK English Female', localService: false, default: true },
      { name: 'Google UK English Male', lang: 'en-GB', voiceURI: 'Google UK English Male', localService: false, default: false },
      { name: 'Google US English', lang: 'en-US', voiceURI: 'Google US English', localService: false, default: false },
      { name: 'Microsoft Yasmin Online (Natural) - Malay (Malaysia)', lang: 'ms-MY', voiceURI: 'Microsoft Yasmin Online (Natural) - Malay (Malaysia)', localService: false, default: false },
      { name: 'Microsoft Osman Online (Natural) - Malay (Malaysia)', lang: 'ms-MY', voiceURI: 'Microsoft Osman Online (Natural) - Malay (Malaysia)', localService: false, default: false },
      { name: 'Kyoko', lang: 'ja-JP', voiceURI: 'com.apple.voice.compact.ja-JP.Kyoko', localService: true, default: false },
    ];
    window.__spoken = [];
    // Utterances that take the check's own voices.
    window.SpeechSynthesisUtterance = class {
      constructor(text) {
        Object.assign(this, { text, lang: '', voice: null, pitch: 1, rate: 1, volume: 1 });
      }
    };
    const synth = window.speechSynthesis;
    synth.getVoices = () => voices;
    synth.speak = (u) => window.__spoken.push({ text: u.text, voice: u.voice?.name ?? null, pitch: u.pitch, lang: u.lang });
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ services: 'open', trafficNews: false, look: 2 }));
  });
  await page.goto(BASE);
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 8000 }).then(() => true, () => false)) await guest.click();
  await page.waitForFunction(() => window.__app?.map, null, { timeout: 30_000 });

  // Prompts speak with a woman's voice by default.
  await page.evaluate(() => window.__app.say('Default voice'));
  let spoken = await page.evaluate(() => window.__spoken.at(-1));
  check('by default the prompts use a female voice', spoken?.voice === 'Google UK English Female' && spoken.pitch === 1, spoken);

  // Settings → Drive: the voice choice.
  void page.evaluate(() => window.__app.editSettings());
  await page.waitForSelector('#set-tab-drive');
  await page.click('#set-tab-drive');
  await page.waitForSelector('#voiceGender');
  await sleep(300);
  const opts = await page.$$eval('#voiceId option', (o) => o.map((x) => x.textContent));
  check('Settings lists the English voices, marked male or female', opts.some((t) => /Male.*\(male/.test(t)) && opts.some((t) => /Female.*\(female/.test(t)) && !opts.some((t) => /Malay/.test(t)), opts);
  await page.selectOption('#voiceGender', 'male');
  await page.click('text=Test voice');
  spoken = await page.evaluate(() => window.__spoken.at(-1));
  check('Test voice says the sample with the male voice', spoken?.voice === 'Google UK English Male' && /Kuala Lumpur/.test(spoken.text), spoken);
  await page.screenshot({ path: join(OUT, 'voice-settings.png') });

  // Bahasa Melayu: Osman is the man's voice.
  await page.click('#set-tab-app');
  await page.selectOption('#lang', 'ms');
  await page.click('#set-tab-drive');
  const msOpts = await page.$$eval('#voiceId option', (o) => o.map((x) => x.textContent));
  await page.click('text=Test voice');
  spoken = await page.evaluate(() => window.__spoken.at(-1));
  check('in Bahasa Melayu the male voice is Osman', msOpts.some((t) => /Osman/.test(t)) && spoken?.voice?.includes('Osman') && /Dalam 300 meter/.test(spoken.text), { msOpts, spoken });

  // Japanese: no man's voice in this browser: says so, and the usual voice speaks lower.
  await page.click('#set-tab-app');
  await page.selectOption('#lang', 'ja');
  await page.click('#set-tab-drive');
  const note = await page.$eval('.voice-pick .hint', (e) => e.textContent);
  await page.click('text=Test voice');
  spoken = await page.evaluate(() => window.__spoken.at(-1));
  check('no male Japanese voice: Settings says so and the usual voice speaks lower', /No male voice/.test(note) && spoken?.pitch < 1, { note, spoken });

  // Back to English, a male voice, saved.
  await page.click('#set-tab-app');
  await page.selectOption('#lang', 'en');
  await page.click('#set-tab-drive');
  await page.selectOption('#voiceGender', 'male');
  await page.click('button[value="save"]');
  await sleep(300);
  const saved = await page.evaluate(() => ({ g: window.__app.settings.voiceGender, id: window.__app.settings.voiceId }));
  await page.evaluate(() => window.__app.say('Turn left'));
  spoken = await page.evaluate(() => window.__spoken.at(-1));
  check('saved: the prompts speak with the male voice', saved.g === 'male' && spoken?.voice === 'Google UK English Male', { saved, spoken });
  // Kept after reopening.
  await page.reload();
  if (await guest.waitFor({ state: 'visible', timeout: 3000 }).then(() => true, () => false)) await guest.click();
  await page.waitForFunction(() => window.__app?.map, null, { timeout: 30_000 });
  await page.evaluate(() => window.__app.say('Again'));
  spoken = await page.evaluate(() => window.__spoken.at(-1));
  check('and still after reopening the app', spoken?.voice === 'Google UK English Male', spoken);
  check('no page errors', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  writeFileSync(join(OUT, 'results.json'), JSON.stringify(results, null, 1));
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  process.exit(failed.length ? 1 : 0);
})();
