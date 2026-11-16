/**
 * Browser check of the voice's manner, the check before a long drive, arrival at the
 * destination and Google's natural voices, on the demo drive (Google's answers are the check's own).
 *
 *  - Settings → Drive: Speaking style, Call me, Voices from, Google voice, the pre-trip toggle;
 *    Test voice with Google's voice says which voice spoke.
 *  - The polite assistant greets ("Good morning, sir. Heading to ...") and addresses the driver.
 *  - A drive of more than 30 minutes: the reminder to check the Touch n Go balance, fuel and the
 *    car, and the "Before you go" card, which goes once the car is moving.
 *  - Arrival: a heads-up near the destination, "We have arrived, sir." at the end, guidance ends.
 *  - Google's voice: prompts are fetched from Google and played; the next turn is fetched ahead;
 *    with the API turned off, a notice and the phone's voice.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-alert
 *   npx vite preview --outDir dist-alert --port 4184 &
 *   node scripts/dev/voice-style-check.cjs http://localhost:4184/ <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4184/';
const OUT = process.argv[3] ?? 'voice-style-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};

/** A fifth of a second of silence as WAV (what the check's Google answers with). */
function silence() {
  const rate = 8000;
  const n = rate / 5;
  const b = Buffer.alloc(44 + n * 2);
  b.write('RIFF', 0);
  b.writeUInt32LE(36 + n * 2, 4);
  b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write('data', 36);
  b.writeUInt32LE(n * 2, 40);
  return b.toString('base64');
}
const AUDIO = silence();
const GOOGLE_VOICES = [
  { name: 'en-GB-Standard-B', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
  { name: 'en-GB-Chirp3-HD-Charon', languageCodes: ['en-GB'], ssmlGender: 'MALE' },
  { name: 'en-GB-Chirp3-HD-Kore', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
  { name: 'en-GB-Neural2-A', languageCodes: ['en-GB'], ssmlGender: 'FEMALE' },
];

/**
 * Opens the app with these settings; the browser's speech is recorded, not played. Google's
 * Text-to-Speech answers with the check's voices and silence (or refuses, with google.off).
 */
async function open(browser, settings, { demo = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1 });
  const google = { off: false, synth: [], lists: 0 };
  await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204, body: '' })));
  await ctx.route('https://texttospeech.googleapis.com/**', async (r) => {
    const url = r.request().url();
    const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*', 'Content-Type': 'application/json' };
    if (r.request().method() === 'OPTIONS') return r.fulfill({ status: 204, headers: cors, body: '' });
    if (google.off)
      return r.fulfill({ status: 403, headers: cors, body: JSON.stringify({ error: { code: 403, status: 'PERMISSION_DENIED', message: 'Cloud Text-to-Speech API has not been used in project 1 before or it is disabled.', details: [{ reason: 'SERVICE_DISABLED' }] } }) });
    if (url.includes('/voices')) {
      google.lists++;
      return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ voices: GOOGLE_VOICES }) });
    }
    const body = JSON.parse(r.request().postData() ?? '{}');
    google.synth.push({ text: body.input?.text, voice: body.voice?.name, key: new URL(url).searchParams.get('key') });
    await sleep(150);
    return r.fulfill({ status: 200, headers: cors, body: JSON.stringify({ audioContent: AUDIO }) });
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => {
    window.__spoken = [];
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push(u.text);
      setTimeout(() => u.onend?.(), window.__speakDelay ?? 50);
    };
    window.speechSynthesis.cancel = () => (window.__cancels = (window.__cancels ?? 0) + 1);
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify(s));
  }, { services: 'open', trafficNews: false, look: 2, appearance: 'day', ...settings });
  await page.goto(BASE + (demo ? '?demo' : ''));
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await guest.click();
  if (demo) await page.waitForFunction(() => window.__app?.sim && window.__app.engine.route, null, { timeout: 30_000 });
  else await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });
  return { ctx, page, errors, google };
}

const spoken = (page) => page.evaluate(() => window.__spoken.filter((t) => t));
const waitSaid = (page, re, ms = 20_000) =>
  page.waitForFunction((src) => window.__spoken.some((t) => new RegExp(src).test(t)), re.source, { timeout: ms }).then(() => true, () => false);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--autoplay-policy=no-user-gesture-required'] });

  /* ---------------------------------------------------------------- settings */
  {
    const { ctx, page, errors, google } = await open(browser, { googleKey: 'test-key' }, { demo: false });
    await page.click('.searchbar .mini');
    await page.waitForSelector('dialog.settings[open]');
    await page.locator('.set-tab', { hasText: 'Drive' }).click();
    const ui = await page.evaluate(() => {
      const d = document.querySelector('dialog.settings');
      const opts = (id) => [...(d.querySelector(`#${id}`)?.options ?? [])].map((o) => o.textContent);
      return {
        style: opts('voiceStyle'),
        styleValue: d.querySelector('#voiceStyle')?.value,
        address: opts('addressAs'),
        addressValue: d.querySelector('#addressAs')?.value,
        engine: opts('voiceEngine'),
        engineValue: d.querySelector('#voiceEngine')?.value,
        pretrip: d.querySelector('#pretripCheck')?.checked,
        pretripLabel: d.querySelector('#pretripCheck')?.parentElement.textContent,
      };
    });
    check('Speaking style: polite assistant (default) or short and plain', ui.styleValue === 'butler' && ui.style.length === 2 && /butler/i.test(ui.style[0]), ui);
    check('Call me: sir (default), ma’am, my first name, nothing', ui.addressValue === 'sir' && ui.address.length === 4 && /Ma.am/.test(ui.address[1]), ui.address);
    check('Voices from: the phone (default) or Google natural voices', ui.engineValue === 'phone' && ui.engine.length === 2 && /Google/.test(ui.engine[1]), ui.engine);
    check('the pre-trip reminder is on by default', ui.pretrip === true && /Touch n Go/.test(ui.pretripLabel), ui);
    const elevUi = await page.evaluate(() => ({ elevation: document.querySelector('#jvElevation')?.checked, hills: document.querySelector('#jvHills')?.checked, label: document.querySelector('#jvElevation')?.closest('.grp')?.querySelector('label')?.textContent }));
    check('Settings → Drive → Elevation: the height strip and the hills, both on by default', elevUi.elevation === true && elevUi.hills === true && elevUi.label === 'Elevation', elevUi);
    await page.evaluate(() => document.querySelector('#jvElevation')?.closest('.grp')?.scrollIntoView({ block: 'center' }));
    await page.screenshot({ path: join(OUT, '02-elevation.png'), fullPage: false });

    await page.selectOption('#voiceEngine', 'google');
    await page.waitForFunction(() => document.querySelector('#cloudVoice').options.length > 1, null, { timeout: 8000 }).catch(() => {});
    await page.selectOption('#voiceGender', 'male');
    await sleep(200);
    const cloudUi = await page.evaluate(() => ({
      phoneHidden: document.querySelector('#voiceId').closest('.voice-rows').hidden,
      cloudHidden: document.querySelector('#cloudVoice').closest('.voice-rows').hidden,
      voices: [...document.querySelector('#cloudVoice').options].map((o) => o.textContent),
    }));
    check('Google voices list Google’s voices for the language and gender, the most natural first', !cloudUi.cloudHidden && cloudUi.phoneHidden && /Charon \(Chirp 3 HD/.test(cloudUi.voices[1] ?? '') && !cloudUi.voices.some((v) => /Kore/.test(v)), cloudUi);
    await page.locator('dialog.settings button', { hasText: 'Test voice' }).click();
    await page.waitForFunction(() => /Google voice:/.test(document.querySelector('.voice-pick .hint[role="status"]')?.textContent ?? ''), null, { timeout: 8000 }).catch(() => {});
    const note = await page.evaluate(() => document.querySelector('.voice-pick .hint[role="status"]')?.textContent ?? '');
    check('Test voice speaks with Google’s voice and says which one', /Google voice: Charon/.test(note) && google.synth.some((x) => /^Good (morning|afternoon|evening), sir\. In 300 metres, keep left/.test(x.text) && x.voice === 'en-GB-Chirp3-HD-Charon' && x.key === 'test-key'), { note, synth: google.synth });
    await page.selectOption('#voiceStyle', 'plain');
    const plain = await page.evaluate(() => document.querySelector('#addressAs').disabled);
    check('Call me is not used in the plain style', plain === true);
    await page.screenshot({ path: join(OUT, '01-settings.png'), fullPage: false });
    check('no page errors in Settings', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  /* ---------------------------------------------------------------- the polite assistant on the demo drive */
  {
    const { ctx, page, errors } = await open(browser, {});
    const hello = await waitSaid(page, /^Good (morning|afternoon|evening), sir\./, 15_000);
    check('greets the driver: "Good morning, sir. Heading to …"', hello, await spoken(page));

    // A drive of more than 30 minutes: the check before setting off, and the card.
    await page.evaluate(() => {
      const a = window.__app;
      const real = a.tripInfo.bind(a);
      a.tripInfo = (r) => ({ ...real(r), duration: 75 * 60, tolls: true });
      window.__spoken = [];
      a.sim.speedAt = () => 0;
      a.sayStart(a.engine.route, true);
    });
    const pre = await waitSaid(page, /^Before we set off on a longer drive, sir, a quick check: your Touch n Go balance, that you have enough fuel, and the car itself: tyres, lights and wipers\.$/, 8000);
    await page.waitForFunction(() => window.__spoken.length >= 3, null, { timeout: 8000 }).catch(() => {});
    const order = await spoken(page);
    check('over 30 minutes: reminds to check the Touch n Go balance, fuel and the car', pre, order);
    check('in order: the greeting with the trip time, the check, then the first instruction', /^Good .+1 hour 15 minutes/.test(order[0] ?? '') && /^Before we set off/.test(order[1] ?? '') && order.length >= 3, order);
    const card = await page.evaluate(() => ({ hidden: window.__app.el.pretrip.hidden, text: window.__app.el.pretrip.innerText.replace(/\s+/g, ' ') }));
    check('the "Before you go" card lists the Touch n Go balance, fuel, tyres, lights and wipers', !card.hidden && /Before you go/.test(card.text) && /Touch n Go/.test(card.text) && /fuel/i.test(card.text) && /wipers/.test(card.text), card);
    await page.screenshot({ path: join(OUT, '02-pretrip.png') });
    await page.evaluate(() => (window.__app.sim.speedAt = () => 60 / 3.6));
    await page.waitForFunction(() => window.__app.el.pretrip.hidden, null, { timeout: 20_000 }).catch(() => {});
    check('the card goes once the car is on its way', await page.evaluate(() => window.__app.el.pretrip.hidden));
    // The height strip on the junction view, on and off.
    const elev = await page.evaluate(() => {
      const a = window.__app;
      for (const c of a.engine.junctions) {
        a.settings.jvElevation = true;
        a.showJunction(c, true);
        const strip = document.querySelector('.jv-profile');
        if (!strip || strip.hidden) continue;
        a.settings.jvElevation = false;
        a.showJunction(c, true);
        const off = document.querySelector('.jv-profile')?.hidden;
        const vert = document.querySelector('.jv-vert');
        a.settings.jvElevation = true;
        return { found: c.id, off: !!off, vert: !!vert };
      }
      return { found: null };
    });
    check('the height strip shows on the junction view, and goes with Elevation off', !!elev.found && elev.off && !elev.vert, elev);
    const flat = await page.evaluate(() => {
      const a = window.__app;
      const c = a.engine.junctions[0];
      a.settings.jvHills = false;
      const sc = a.sceneFor(a.engine.route, c);
      a.settings.jvHills = true;
      return { terrain: !!sc.terrain };
    });
    check('with hills off the 3D view gets no ground heights', flat.terrain === false, flat);

    // Heard to the end before navigation starts: the drive waits, other prompts wait.
    await page.evaluate(() => {
      const a = window.__app;
      const real = a.tripInfo.bind(a);
      a.tripInfo = (r) => ({ ...real(r), duration: 75 * 60, tolls: true, pay: 'tng' });
      a.sim.speedAt = () => 60 / 3.6;
      window.__speakDelay = 1200;
      window.__spoken = [];
      a.sayStart(a.engine.route, true);
    });
    await sleep(300);
    const during = await page.evaluate(() => {
      const a = window.__app;
      a.say('A prompt that must wait.');
      return { paused: a.sim.paused, predrive: a.predrive > 0, start: !!document.querySelector('#pretrip-start'), wait: document.querySelector('.pretrip-wait')?.textContent ?? '', said: window.__spoken.slice() };
    });
    await page.screenshot({ path: join(OUT, '03-predrive.png'), fullPage: false });
    check('while the check is said, the drive waits (simulator held) and the card offers Start now', during.paused && during.predrive && during.start && /Guidance starts after this check/.test(during.wait), during);
    await page.waitForFunction(() => !window.__app.predrive, null, { timeout: 10_000 }).catch(() => {});
    const afterCheck = await page.evaluate(() => ({ paused: window.__app.sim.paused, said: window.__spoken.slice(), start: !!document.querySelector('#pretrip-start') }));
    check('when it has been said to the end, navigation starts with the first instruction', !afterCheck.paused && !afterCheck.start && /^Good .+/.test(afterCheck.said[0] ?? '') && /^Before we set off/.test(afterCheck.said[1] ?? '') && /^(In |Keep|Take|Turn|Continue|Head)/.test(afterCheck.said[2] ?? ''), afterCheck);
    check('other prompts wait until it is over (nothing cuts in)', !afterCheck.said.includes('A prompt that must wait.'), afterCheck.said);
    // Start now: at once.
    await page.evaluate(() => {
      const a = window.__app;
      a.sim.speedAt = () => 0;
      window.__speakDelay = 4000;
      window.__spoken = [];
      window.__cancels = 0;
      a.sayStart(a.engine.route, true);
    });
    await sleep(300);
    await page.click('#pretrip-start');
    await sleep(300);
    const now = await page.evaluate(() => ({ predrive: window.__app.predrive, paused: window.__app.sim.paused, cancels: window.__cancels, said: window.__spoken.slice() }));
    check('Start now ends the check at once (the voice stops) and guidance starts', !now.predrive && !now.paused && now.cancels > 0 && /^(In |Keep|Take|Turn|Continue|Head)/.test(now.said.at(-1) ?? ''), now);
    await page.evaluate(() => (window.__speakDelay = 50));

    const shortTrip = await page.evaluate(() => {
      const a = window.__app;
      a.tripInfo = (r) => ({ dest: 'Demo', duration: 20 * 60, arrival: '9:00 am', tolls: true, pay: 'tng' });
      window.__spoken = [];
      a.sayStart(a.engine.route, true);
      return { said: window.__spoken.slice(), card: a.el.pretrip.hidden };
    });
    await sleep(500);
    const shortSaid = await spoken(page);
    check('a 20-minute drive: no check before setting off', !shortSaid.some((t) => /Before we set off/.test(t)) && shortTrip.card, shortSaid);

    // Arrival: the heads-up as the car nears, "We have arrived, sir." at the destination, then guidance ends.
    await page.evaluate(() => {
      const a = window.__app;
      window.__spoken = [];
      a.sim.speedAt = () => 40 / 3.6;
      a.sim.factor = 2;
      const r = a.engine.route;
      const last = r.steps[r.steps.length - 2];
      a.sim.jumpTo(Math.max(0, last.s - 250));
    });
    const near = await waitSaid(page, /^Your destination is .+ ahead.*sir\.$/, 40_000);
    const nearAt = await page.evaluate(() => window.__app.engine.progress.remaining);
    const arrived = await waitSaid(page, /^We have arrived, sir\./, 40_000);
    const arrivedAt = await page.evaluate(() => window.__app.engine.progress?.remaining ?? 0);
    const said = await spoken(page);
    check('a heads-up before the destination: "Your destination is … ahead, sir."', near, said);
    check('"We have arrived, sir." at the destination itself, not 300 m before', arrived && arrivedAt <= 40 && nearAt > arrivedAt, { arrivedAt, nearAt, said });
    await page.waitForFunction(() => window.__app.view !== 'nav', null, { timeout: 15_000 }).catch(() => {});
    check('guidance ends after arriving', await page.evaluate(() => window.__app.view !== 'nav'));
    check('no page errors on the drive', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  /* ---------------------------------------------------------------- Google's natural voices */
  {
    const { ctx, page, errors, google } = await open(browser, { voiceEngine: 'google', googleKey: 'test-key', voiceGender: 'male' });
    await page.mouse.click(206, 300);
    await page.waitForFunction(() => true, null);
    await sleep(6000);
    const phone = await spoken(page);
    const texts = google.synth.map((x) => x.text);
    check('with Google’s voice, the greeting and first instruction come from Google', texts.some((t) => /^Good (morning|afternoon|evening), sir\./.test(t)) && google.synth.every((x) => x.voice === 'en-GB-Chirp3-HD-Charon'), google.synth);
    check('and the phone’s voice stays quiet', !phone.some((t) => /^Good (morning|afternoon|evening)/.test(t)), phone);
    const nextNow = await page.evaluate(() => {
      const a = window.__app;
      const p = a.engine.progress;
      return a.promptText({ kind: 'maneuver', step: p.next, distance: null, key: 'x' }).replace(/\s+\/\s+/g, ' and ');
    });
    check('the next turn’s "now" prompt is fetched ahead of time', texts.includes(nextNow), { nextNow, texts });
    await page.evaluate(() => window.__app.say('Speed camera just ahead, sir. Please slow down to 90.'));
    await sleep(1500);
    await page.evaluate(() => window.__app.say('Speed camera just ahead, sir. Please slow down to 90.'));
    await sleep(1500);
    const asked = google.synth.filter((x) => x.text === 'Speed camera just ahead, sir. Please slow down to 90.').length;
    check('a prompt heard before plays from the phone without asking Google again', asked === 1, asked);

    // The API turned off: a notice, and the phone's voice.
    google.off = true;
    await page.evaluate(() => {
      window.__spoken = [];
      window.__app.say('Check the phone voice takes over.');
    });
    const fallback = await waitSaid(page, /^Check the phone voice takes over\.$/, 8000);
    const toast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map((t) => t.textContent).join(' | '));
    check('Google’s voice refused: the phone’s voice says it', fallback, await spoken(page));
    check('and a notice says what to turn on', /Cloud Text-to-Speech API/.test(toast), toast);
    await page.evaluate(() => window.__app.say('And the next one too.'));
    check('after that, the phone speaks at once', await waitSaid(page, /^And the next one too\.$/, 2000));
    check('no page errors with Google’s voice', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results }, null, 2));
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} passed`);
  await browser.close();
  process.exit(failed ? 1 : 0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
