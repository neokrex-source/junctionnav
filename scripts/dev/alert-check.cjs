/**
 * Browser check of staying alert on long drives, the speed guide's highway and other-road
 * switches, and the toll voice reminder, on the demo drive (nothing is fetched).
 *
 *  - Settings → Drive: Stay alert (break reminder, talk, topics, tiredness), the speed guide
 *    switches, the toll voice reminder; "Say one now" speaks a joke, fact or riddle.
 *  - At the focus limit: a tone, "You have been driving for 2 hours. Time for a break", the
 *    break chip with the driving time and Find R&R (which lists rest areas along the route).
 *  - Then the talk: the first one says why the app is chatting; a riddle's answer follows.
 *  - The tiredness warning: the wake-up tone, the warning, the chip turns red.
 *  - The simulator's tired driver drifts across the lane.
 *  - A gap of 15 minutes is a break: the chip goes and the clock starts again.
 *  - The speed guide off on highways: no sign or warnings on E1, still on Jalan Demo.
 *  - The toll plaza: "Plaza Tol Demo in ..." on the way to it.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-alert
 *   npx vite preview --outDir dist-alert --port 4184 &
 *   node scripts/dev/alert-check.cjs http://localhost:4184/ <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4184/';
const OUT = process.argv[3] ?? 'alert-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};
const MIN = 60_000;

/** Opens the demo drive with these settings; speech and the alert sounds are recorded, not played. */
async function open(browser, settings, { demo = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1 });
  await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204, body: '' })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => {
    window.__spoken = [];
    window.speechSynthesis.speak = (u) => window.__spoken.push(u.text);
    window.speechSynthesis.cancel = () => {};
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify(s));
  }, { services: 'open', trafficNews: false, look: 2, appearance: 'day', ...settings });
  await page.goto(BASE + (demo ? '?demo' : ''));
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await guest.click();
  if (demo) await page.waitForFunction(() => window.__app?.sim && window.__app.speedData.info.limits.length > 1, null, { timeout: 30_000 });
  else await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });
  await page.evaluate(() => {
    const a = window.__app;
    window.__tones = [];
    a.voice.alert = (k) => window.__tones.push(k);
  });
  return { ctx, page, errors };
}

const spoken = (page) => page.evaluate(() => window.__spoken.filter((t) => t));
const waitSaid = (page, re, ms = 20_000) =>
  page.waitForFunction((src) => window.__spoken.some((t) => new RegExp(src).test(t)), re.source, { timeout: ms }).then(() => true, () => false);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });

  /* ---------------------------------------------------------------- settings */
  {
    const { ctx, page, errors } = await open(browser, {}, { demo: false });
    await page.click('.searchbar .mini');
    await page.waitForSelector('dialog.settings[open]');
    await page.locator('.set-tab', { hasText: 'Drive' }).click();
    const ui = await page.evaluate(() => {
      const d = document.querySelector('dialog.settings');
      const opts = (id) => [...d.querySelector(`#${id}`).options].map((o) => o.textContent);
      return {
        focus: opts('focusLimit'),
        focusValue: d.querySelector('#focusLimit').value,
        talk: opts('talkMode'),
        topics: [...d.querySelectorAll('.talk-topics input')].map((b) => [b.value, b.checked]),
        drowsy: d.querySelector('#drowsyDetect').checked,
        speedHighway: d.querySelector('#speedHighway').checked,
        speedTown: d.querySelector('#speedTown').checked,
        toll: opts('tollVoice'),
        tollValue: d.querySelector('#tollVoice').value,
        text: d.innerText,
      };
    });
    check('Settings has Stay alert: a break reminder after 2 hours by default', ui.focusValue === '120' && ui.focus.includes('After 2 hours (recommended)') && ui.focus.includes('Off'), ui.focus);
    check('talk to keep me awake, with eight topics all on', ui.talk.length === 3 && ui.topics.length === 8 && ui.topics.every(([, on]) => on), ui.topics);
    check('the tiredness check is on', ui.drowsy && /signs of tiredness/.test(ui.text));
    check('the speed guide can be switched for highways and other roads', ui.speedHighway && ui.speedTown && /Speed limit guide on highways/.test(ui.text) && /Speed limit guide on other roads/.test(ui.text));
    check('the toll voice reminder: 2 km and 600 m by default', ui.tollValue === 'full' && ui.toll.length === 3, ui.toll);
    await page.locator('#focusLimit').scrollIntoViewIfNeeded();
    await page.screenshot({ path: join(OUT, '01-settings-stay-alert.png') });
    await page.click('text=Say one now');
    await sleep(300);
    let said = await spoken(page);
    check('"Say one now" speaks a joke, fact or riddle', said.length >= 1 && said[0].length > 20, said);
    // In Malay.
    await page.locator('.set-tab', { hasText: 'App' }).click();
    await page.selectOption('#lang', 'ms');
    await page.locator('.set-tab', { hasText: 'Drive' }).click();
    const n0 = (await spoken(page)).length;
    await page.click('text=Say one now');
    await sleep(300);
    said = await spoken(page);
    const ms = said[n0] ?? '';
    check('and in Malay with the app in Malay', /^(Ini satu lawak|Masa untuk lawak|Satu jenaka pendek|Teka-teki|Ini satu teka-teki|Kuiz pendek|Fakta|Tahukah anda|Di seluruh dunia|Dari dunia haiwan|Petua ringkas|Tip berguna)/.test(ms), ms);
    // Only riddles chosen: the answer follows.
    for (const b of await page.$$('.talk-topics input')) if ((await b.getAttribute('value')) !== 'riddles') await b.uncheck();
    await page.locator('.set-tab', { hasText: 'App' }).click();
    await page.selectOption('#lang', 'en');
    await page.locator('.set-tab', { hasText: 'Drive' }).click();
    const before = (await spoken(page)).length;
    await page.click('text=Say one now');
    await sleep(300);
    said = (await spoken(page)).slice(before);
    check('a riddle is said with its answer after it', said.length === 2 && /\?$/.test(said[0]) && /^The answer: /.test(said[1]), said);
    check('no page errors in Settings', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  /* ---------------------------------------------------------------- the break, the talk, tiredness */
  {
    const { ctx, page, errors } = await open(browser, { focusLimit: 120, talkMode: 'tired', talkTopics: ['riddles', 'jokes'], simSpeed: 8 });
    // The demo road is short and busy with turns: let every moment count as quiet for this check.
    await page.evaluate(() => {
      const w = window.__app.alertWatch;
      const orig = w.update.bind(w);
      w.update = (x) => orig({ ...x, quiet: true });
      window.__app.sim.factor = 8;
      w.driven = 119.5 * 60_000;
    });
    // (Between midnight and 6 am the limit comes a quarter sooner, so it may already be past.)
    const limitSaid = await waitSaid(page, /^You have been driving for (2 hours|1 hour 55 minutes)\. Time for a break of at least 15 minutes\./);
    const after = await page.evaluate(() => ({ tones: window.__tones.slice(), chip: window.__app.el.alertChip.hidden ? null : window.__app.el.alertChip.innerText.replace(/\s+/g, ' '), state: window.__app.el.alertChip.dataset.state }));
    check('at the focus limit: a tone and "You have been driving for 2 hours. Time for a break"', limitSaid && after.tones.includes('camera'), { tones: after.tones, spoken: await spoken(page) });
    check('the break chip shows the driving time and Find R&R', /Time for a break/.test(after.chip ?? '') && /Driving (2 hours|1 hour 55 minutes)/.test(after.chip ?? '') && /Find R&R/.test(after.chip ?? '') && after.state === 'due', after.chip);
    await page.screenshot({ path: join(OUT, '02-break-chip.png') });
    // The talk starts a few minutes (of the sped-up drive) later.
    await page.evaluate(() => (window.__app.alertWatch.nextTalk = 1));
    const talked = await waitSaid(page, /^I will chat a little to help you stay awake\./, 30_000);
    const talk = (await spoken(page)).find((t) => t.startsWith('I will chat'));
    check('the first chat says why, then a joke or riddle', talked && /stay awake\. (Here is a joke\.|Joke time\.|A quick one for you\.|This one might make you smile\.|Riddle time\. Have a think\.|Here is a riddle\.|Quick quiz\.|Try this one\.) .{10,}/.test(talk ?? ''), talk);
    if (/\?$/.test(talk ?? '')) {
      const answered = await waitSaid(page, /^The answer: /, 40_000);
      check('a riddle’s answer follows a few seconds later', answered, await spoken(page));
    }
    // Guidance cuts in over the talk.
    const cut = await page.evaluate(() => {
      const a = window.__app;
      let urgent = null;
      const orig = a.voice.speak.bind(a.voice);
      a.voice.speak = (t, l, u) => {
        urgent = u;
        a.voice.speak = orig;
      };
      a.talkUntil = Date.now() + 5000;
      a.say('In 500 metres, keep left.', false);
      return urgent;
    });
    check('guidance cuts in over a joke instead of waiting for it', cut === true, cut);
    // Find R&R lists the rest areas along the route.
    await page.click('.alert-find');
    await page.waitForFunction(() => window.__app.navOverlay === 'search', null, { timeout: 5000 }).catch(() => {});
    const find = await page.evaluate(() => ({ overlay: window.__app.navOverlay, title: window.__app.resultsTitle }));
    check('Find R&R opens the rest areas along the route', find.overlay === 'search' && /Rest|R&R/i.test(find.title), find);
    await page.evaluate(() => {
      window.__app.navOverlay = null;
      window.__app.renderSheet();
    });

    // The tiredness warning.
    await page.evaluate(() => window.__app.sayAlertEvent({ kind: 'drowsy', driven: 125 * 60_000, signs: ['wander', 'speed'] }, window.__app.engine.progress.s));
    await waitSaid(page, /^Stay alert\. Your car seems to be wandering in the lane\./, 8000);
    await page.evaluate(() => (window.__app.alertWatch.drowsyAt = window.__app.alertClock));
    await sleep(800);
    const drowsy = await page.evaluate(() => ({ tones: window.__tones.slice(), state: window.__app.el.alertChip.dataset.state, chip: window.__app.el.alertChip.innerText.replace(/\s+/g, ' ') }));
    check('signs of tiredness: the wake-up tone and "Stay alert. Your car seems to be wandering in the lane"', drowsy.tones.includes('wake'), drowsy.tones);
    check('the chip turns red: Signs of tiredness', drowsy.state === 'drowsy' && /Signs of tiredness/.test(drowsy.chip), drowsy);
    await page.screenshot({ path: join(OUT, '03-tired-chip.png') });

    // The simulator's tired driver drifts across the lane.
    const offsets = await page.evaluate(async () => {
      const a = window.__app;
      a.sim.tired = 1;
      a.sim.factor = 1;
      const out = [];
      for (let i = 0; i < 24; i++) {
        await new Promise((r) => setTimeout(r, 500));
        out.push(a.engine.progress?.offset ?? 0);
      }
      a.sim.tired = 0;
      return out;
    });
    const spread = Math.max(...offsets) - Math.min(...offsets);
    check('the simulator’s tired driver drifts across the lane', spread > 1.5, offsets.map((o) => o.toFixed(2)));

    // A 15-minute gap is a break.
    await page.evaluate(() => {
      const a = window.__app;
      a.alertLastFix -= 16 * 60_000;
    });
    await page.waitForFunction(() => window.__app.alertWatch.driven < 60_000, null, { timeout: 5000 }).catch(() => {});
    const rest = await page.evaluate(() => ({ driven: window.__app.alertWatch.driven, chip: window.__app.el.alertChip.hidden, toast: document.querySelector('.toast')?.textContent ?? '' }));
    check('a 15-minute stop is a break: the clock starts again and the chip goes', rest.driven < 60_000 && rest.chip && /Break taken/.test(rest.toast), rest);
    check('no page errors on the drive', errors.length === 0, errors.slice(0, 3));
    await ctx.close();
  }

  /* ---------------------------------------------------------------- the speed guide by road and the toll reminder */
  {
    const { ctx, page, errors } = await open(browser, { speedHighway: false, speedTown: true });
    const at = (where, kmh) =>
      page.evaluate(
        ([where, kmh]) => {
          const a = window.__app;
          const i = a.speedData.info;
          const s = where === 'e1' ? i.limits.find((l) => l.kmh === 110).s0 + 20 : 30;
          a.sim.speedAt = () => kmh / 3.6;
          a.sim.jumpTo(s);
        },
        [where, kmh],
      );
    await sleep(1500);
    const town = await page.evaluate(() => window.__app.engine.progress.speedo.limit?.kmh ?? null);
    // The toll plaza on the demo expressway ramp: the reminder on the way.
    await page.waitForFunction(() => window.__app.engine.tolls.length > 0, null, { timeout: 15_000 }).catch(() => {});
    const plaza = await page.evaluate(() => window.__app.engine.tolls[0]?.s ?? null);
    await page.evaluate((s) => {
      const a = window.__app;
      a.sim.speedAt = () => 90 / 3.6;
      a.sim.jumpTo(Math.max(0, s - 1900));
    }, plaza);
    const toll = await waitSaid(page, /^(Plaza Tol Demo in|Toll plaza in|Toll plaza ahead)/, 40_000);
    check('the toll reminder is spoken on the way to the plaza', plaza != null && toll, (await spoken(page)).filter((t) => /[Tt]oll|Plaza/.test(t)));
    await page.evaluate(() => {
      window.__mark = window.__spoken.length;
      window.__tones = [];
    });
    await at('e1', 125);
    await sleep(3500);
    const hw = await page.evaluate(() => ({ limit: window.__app.engine.progress.speedo.limit, sign: window.__app.el.speed.querySelector('.spd-sign').hidden, tones: window.__tones.slice(), spoken: window.__spoken.slice(window.__mark).filter((t) => /speed limit/i.test(t)) }));
    check('speed guide off on highways: still on Jalan Demo (80)', town === 80, town);
    check('and no sign or warning on E1, even at 125 km/h', hw.limit === null && hw.sign && !hw.tones.includes('over') && hw.spoken.length === 0, hw);

    check('no page errors', errors.length === 0, errors.slice(0, 3));
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
