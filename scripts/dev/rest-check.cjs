/**
 * Browser check of rest stops, the close-up route width and the car icon's size, on the demo drive
 * (positions are the check's own; what is at the stop comes from a stand-in for OpenStreetMap).
 *
 *  - Pulling in to a petrol station and standing there: a rest stop after a few seconds, said once,
 *    with a card naming the place. No turn is repeated and no new route is asked for while the car
 *    stands, however the GPS wanders.
 *  - Driving off: "Welcome back, sir." with the next instruction, once. Leaving the route at speed
 *    still gets a new route.
 *  - Resume now ends a rest stop at once (and asks for the way back from off the route); its ×
 *    only puts the card away.
 *  - The toll, camera, break, traffic and tunnel alerts each have a × that closes them until the
 *    next one of their kind (signs of tiredness still show after a closed break reminder).
 *  - A new route starting with the same turn as one a moment ago is not said again.
 *  - In the close-up at a junction the route covers 80% of the road it is on, and the car icon is
 *    a little bigger than at the usual scale.
 *
 *   VITE_AUTH_REQUIRED=false npx vite build --outDir dist-alert
 *   npx vite preview --outDir dist-alert --port 4184 &
 *   node scripts/dev/rest-check.cjs http://localhost:4184/ <shots dir>
 */
const { chromium } = require('playwright');
const { mkdirSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4184/';
const OUT = process.argv[3] ?? 'rest-shots';
mkdirSync(OUT, { recursive: true });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${!ok && detail !== undefined ? `  ${JSON.stringify(detail)}` : ''}`);
};

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, deviceScaleFactor: 1 });
  await ctx.route('**/*', (r) => (r.request().url().startsWith(BASE) ? r.continue() : r.fulfill({ status: 204, body: '' })));
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.addInitScript((s) => {
    window.__spoken = [];
    window.speechSynthesis.speak = (u) => {
      window.__spoken.push(u.text);
      setTimeout(() => u.onend?.(), 30);
    };
    window.speechSynthesis.cancel = () => {};
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify(s));
  }, { services: 'open', trafficNews: false, look: 2, appearance: 'day', pretripCheck: false });
  await page.goto(BASE + '?demo');
  const guest = page.getByText('Continue without an account');
  if (await guest.waitFor({ state: 'visible', timeout: 6000 }).then(() => true, () => false)) await guest.click();
  await page.waitForFunction(() => window.__app?.sim && window.__app.engine.route && window.__app.engine.progress, null, { timeout: 30_000 });
  await sleep(2500);

  // The check drives: the simulator holds still, positions come from here (one a second, on a
  // clock of the check's own), and the app acts as on a real drive (rerouting counted, not done).
  await page.evaluate(() => {
    const a = window.__app;
    a.sim.paused = true;
    window.__sim = a.sim;
    window.__s0 = a.engine.progress.s + 40;
    window.__t = Date.now();
    window.__reroutes = 0;
    a.reroute = () => {
      window.__reroutes++;
    };
    a.switchToAlternative = () => false;
    a.sim = null;
    a.demo = false;
    a.restFinder.src.overpass = async () => ({ elements: [{ tags: { amenity: 'fuel', name: 'Petronas Test', brand: 'Petronas' } }] });
    window.__at = (s, off) => {
      const L = a.engine.route.line;
      const p = L.pointAt(s);
      const b = ((L.bearingAt(s, 15) + 90) * Math.PI) / 180;
      return [p[0] + (off * Math.sin(b)) / (111320 * Math.cos((p[1] * Math.PI) / 180)), p[1] + (off * Math.cos(b)) / 110540];
    };
    window.__feed = async (list) => {
      for (const [s, off, speed, acc = 8] of list) {
        window.__t += 1000;
        a.onFix({ lngLat: window.__at(s, off), accuracy: acc, heading: speed > 1 ? a.engine.route.line.bearingAt(s, 15) : null, speed, time: window.__t });
        await new Promise((r) => setTimeout(r, 25));
      }
    };
    window.__spoken = [];
  });
  const s0 = await page.evaluate(() => window.__s0);
  const state = () =>
    page.evaluate(() => {
      const card = document.querySelector('.rest-card');
      return {
        resting: !!window.__app.rest.resting,
        card: card && !card.hidden ? card.textContent : null,
        said: window.__spoken.filter(Boolean),
        reroutes: window.__reroutes,
      };
    });

  /* ---------------------------------------------------------------- pulling in and standing */
  await page.evaluate((s) => window.__feed([[s, 12, 7], [s + 5, 22, 5], [s + 8, 32, 3], [s + 9, 40, 1.2], ...Array.from({ length: 12 }, () => [s + 9, 40, 0])]), s0);
  let st = await state();
  check('standing at a petrol station: a rest stop, with a card naming it', st.resting && /Rest stop/.test(st.card ?? '') && /Petrol station/.test(st.card ?? '') && /Petronas Test/.test(st.card ?? '') && /Resume now/.test(st.card ?? ''), st);
  check('said once: "Filling up, sir? Take your time. I’ll carry on when we set off again."', st.said.length === 1 && st.said[0] === 'Filling up, sir? Take your time. I’ll carry on when we set off again.', st.said);
  check('no new route asked for while pulling in and standing', st.reroutes === 0, st.reroutes);
  await page.screenshot({ path: join(OUT, '01-rest-card.png') });
  await page.click('#rest-close');
  st = await state();
  check('the rest card’s × puts it away; the rest stop goes on (nothing said, no new route)', st.card === null && st.resting && st.said.length === 1, st);

  // A long stop: GPS wanders under the canopy (and jumps once), the speed flickers.
  await page.evaluate(
    (s) =>
      window.__feed([
        ...Array.from({ length: 50 }, (_, i) => [s + 9 + ((i * 7) % 11) - 5, 40 + ((i * 13) % 31) - 15, (i % 5) * 0.25, 12]),
        [s + 60, 70, 0, 25],
        ...Array.from({ length: 20 }, () => [s + 9, 40, 0]),
      ]),
    s0,
  );
  st = await state();
  check('a long stop with GPS wandering: still resting, nothing more said, still no new route', st.resting && st.said.length === 1 && st.reroutes === 0, st);
  const held = await page.evaluate(() => {
    const before = window.__spoken.length;
    window.__app.say('In 300 metres, turn left onto Jalan Test');
    return window.__spoken.length - before;
  });
  check('anything about the road waits while the car stands', held === 0, held);

  /* ---------------------------------------------------------------- driving off */
  await page.evaluate(() => (window.__spoken = []));
  await page.evaluate((s) => window.__feed([[s + 15, 28, 6], [s + 25, 14, 8], [s + 37, 4, 10], [s + 50, 0, 11], [s + 62, 0, 12]]), s0);
  st = await state();
  check('driving off: the card goes and the rest stop ends', !st.resting && st.card === null, st);
  check('"Welcome back, sir." with the next instruction, once', st.said.length === 1 && /^Welcome back, sir\. (In |Keep|Take|Turn|Continue|Exit|At )/.test(st.said[0]), st.said);
  await page.evaluate((s) => window.__feed(Array.from({ length: 6 }, (_, i) => [s + 75 + i * 15, 70, 15])), s0);
  st = await state();
  check('leaving the route at speed still gets a new route', st.reroutes >= 1, st.reroutes);

  /* ---------------------------------------------------------------- resume now */
  await page.evaluate((s) => window.__feed([[s + 180, 0, 12], [s + 192, 0, 10], [s + 200, 20, 4], [s + 202, 40, 1], ...Array.from({ length: 12 }, () => [s + 202, 40, 0])]), s0);
  st = await state();
  const rerouted = st.reroutes;
  check('a second stop: resting again', st.resting, st);
  await page.click('#rest-resume');
  await sleep(200);
  st = await state();
  check('Resume now ends it at once and asks for the way back from off the route', !st.resting && st.card === null && st.reroutes === rerouted + 1, st);
  await page.evaluate((s) => window.__feed(Array.from({ length: 40 }, () => [s + 202, 40, 0])), s0);
  st = await state();
  check('and no new rest stop starts there for a while', !st.resting && st.card === null, st);

  /* ---------------------------------------------------------------- the same turn, again */
  const twice = await page.evaluate((s) => {
    const a = window.__app;
    a.sim = window.__sim;
    a.demo = true;
    window.__spoken = [];
    a.applyRoute(a.engine.route, s + 300);
    a.applyRoute(a.engine.route, s + 300);
    return window.__spoken.filter(Boolean);
  }, s0);
  // After Resume now off the route, the way back starts with the welcome instead of "New route ready".
  check('the way back after Resume now starts "Welcome back, sir." with its first turn', /^Welcome back, sir\. (In |Keep|Take|Turn|Continue|Exit|At )/.test(twice[0] ?? ''), twice);
  check('a new route starting with the same turn as one a moment ago is said once', twice.length === 1, twice);

  /* ---------------------------------------------------------------- closing alerts on the map */
  const closing = await page.evaluate(async () => {
    const a = window.__app;
    const p = a.engine.progress;
    const tick = () => new Promise((r) => setTimeout(r, 30));
    const shown = (el) => !el.hidden;
    const out = {};
    // The toll plaza: closed until the next plaza.
    const plaza = (id) => ({ ...p, toll: { plaza: { id, s: p.s + 900, at: [101.6, 3.1], name: 'Plaza Tol Demo' }, dist: 900 } });
    a.paintTollChip(plaza('t1'));
    out.tollShown = shown(a.el.tollChip) && !!a.el.tollChip.querySelector('.chip-close');
    a.el.tollChip.querySelector('.chip-close').click();
    await tick();
    a.paintTollChip({ ...plaza('t1'), toll: { ...plaza('t1').toll, dist: 600 } });
    out.tollStaysClosed = !shown(a.el.tollChip);
    a.paintTollChip(plaza('t2'));
    out.tollNextShows = shown(a.el.tollChip);
    // The speed camera: closed until the next camera.
    const cam = (id) => ({ ...p, speedo: { ...p.speedo, check: null, camera: { cam: { id, at: [101.6, 3.1], limit: 80 }, dist: 400 } } });
    a.paintCamChip(cam('c1'));
    out.camShown = shown(a.el.camChip);
    a.el.camChip.querySelector('.chip-close').click();
    await tick();
    a.paintCamChip({ ...cam('c1'), speedo: { ...cam('c1').speedo, camera: { ...cam('c1').speedo.camera, dist: 200 } } });
    out.camStaysClosed = !shown(a.el.camChip);
    a.paintCamChip(cam('c2'));
    out.camNextShows = shown(a.el.camChip);
    // Time for a break: closed until the break is taken; tiredness still comes up.
    const realState = a.alertWatch.state.bind(a.alertWatch);
    a.alertWatch.state = () => ({ driven: 7_300_000, limit: 7_200_000, due: true, drowsy: false });
    a.paintAlertChip();
    out.breakShown = shown(a.el.alertChip);
    a.el.alertChip.querySelector('.chip-close').click();
    await tick();
    a.paintAlertChip();
    out.breakStaysClosed = !shown(a.el.alertChip);
    a.alertWatch.state = () => ({ driven: 7_400_000, limit: 7_200_000, due: true, drowsy: true });
    a.paintAlertChip();
    out.tiredShows = shown(a.el.alertChip);
    a.alertWatch.state = realState;
    a.paintAlertChip();
    // Traffic ahead: closed until the next incident (and the chip itself still opens the list).
    const realTraffic = a.traffic;
    const inc = (id) => ({ id, kind: 'jam', s: p.s + 1500, endS: p.s + 2200, delay: 240, description: '', from: '', to: '' });
    a.traffic = { live: true, onRoute: [inc('i1')], routeNews: [] };
    a.paintTrafficChip(p);
    out.trafficShown = shown(a.el.trafficChip) && !!a.el.trafficChip.querySelector('.tc-open') && !!a.el.trafficChip.querySelector('.chip-close');
    a.el.trafficChip.querySelector('.chip-close').click();
    await tick();
    out.trafficListNotOpened = a.navOverlay !== 'traffic';
    a.paintTrafficChip(p);
    out.trafficStaysClosed = !shown(a.el.trafficChip);
    a.traffic = { live: true, onRoute: [inc('i2')], routeNews: [] };
    a.paintTrafficChip(p);
    out.trafficNextShows = shown(a.el.trafficChip);
    a.traffic = realTraffic;
    a.paintTrafficChip(p);
    // The tunnel card: closed for this tunnel.
    const span = { id: 'tn1', fromS: p.s + 300, toS: p.s + 1000, length: 700, entrance: [101.6, 3.1], name: 'Terowong Demo', names: {}, highway: 'motorway', source: 'osm' };
    const opts = { lang: 'en', units: 'metric', theme: a.themeFor(a.engine.route), dr: false };
    a.tunnelCard.update({ span, phase: 'ahead', dist: 300, toExit: 1000, progress: 0 }, opts);
    out.tunnelShown = shown(a.tunnelCard.el) && !!a.tunnelCard.el.querySelector('.tcard-x');
    a.tunnelCard.el.querySelector('.tcard-x').click();
    a.tunnelCard.update({ span, phase: 'ahead', dist: 200, toExit: 900, progress: 0 }, opts);
    out.tunnelStaysClosed = !shown(a.tunnelCard.el);
    a.tunnelCard.hide();
    return out;
  });
  check('the toll plaza chip has a ×: closed until the next plaza', closing.tollShown && closing.tollStaysClosed && closing.tollNextShows, closing);
  check('the speed camera chip has a ×: closed until the next camera', closing.camShown && closing.camStaysClosed && closing.camNextShows, closing);
  check('the break chip has a ×: closed until the break, but signs of tiredness still show', closing.breakShown && closing.breakStaysClosed && closing.tiredShows, closing);
  check('the traffic chip has a × (not opening the list): closed until the next incident', closing.trafficShown && closing.trafficListNotOpened && closing.trafficStaysClosed && closing.trafficNextShows, closing);
  check('the tunnel card has a ×: closed for that tunnel', closing.tunnelShown && closing.tunnelStaysClosed, closing);

  /* ---------------------------------------------------------------- the close-up */
  const normal = await page.evaluate(() => ({ k: Number(document.querySelector('.puck')?.style.getPropertyValue('--puck-k')), thin: window.__app.map.isThin, zoom: window.__app.map.map.getZoom() }));
  await page.evaluate(() => {
    const a = window.__app;
    a.sim.speedAt = () => 50 / 3.6;
    a.sim.paused = false;
  });
  await page.locator('.sim button', { hasText: 'Next junction' }).click();
  const thin = await page.waitForFunction(() => window.__app.map.isThin && window.__app.map.map.getZoom() > 18.3, null, { timeout: 25_000 }).then(() => true, () => false);
  await sleep(600);
  await page.evaluate(() => (window.__app.sim.paused = true));
  await sleep(1300);
  const close = await page.evaluate(() => {
    const a = window.__app;
    const m = a.map.map;
    return {
      tier: a.map.roadTier,
      casing: m.getPaintProperty('route-casing', 'line-width'),
      line: m.getPaintProperty('route-line', 'line-width'),
      zoom: m.getZoom(),
      k: Number(document.querySelector('.puck')?.style.getPropertyValue('--puck-k')),
    };
  });
  await page.screenshot({ path: join(OUT, '02-close-up.png') });
  // The demo map draws its roads by a curve times a factor per kind of road.
  const factor = { highway: 3.2, major: 2.6, minor: 1.8 }[close.tier];
  const want = [12, 0.6, 16, 3.4, 19, 14].map((v, i) => (i % 2 ? Math.round(v * factor * 0.8 * 100) / 100 : v));
  const stops = Array.isArray(close.casing) ? close.casing.slice(3) : [];
  check('the close-up comes at the junction (20 m)', thin, close);
  check('there the route covers 80% of the road it is on (as the map draws that road)', JSON.stringify(stops) === JSON.stringify(want) && JSON.stringify(close.casing?.[1]) === '["exponential",1.6]', { close, want });
  check('the route’s middle line is most of that, inside its outline', Array.isArray(close.line) && Math.abs(close.line[close.line.length - 1] - want[want.length - 1] * 0.74) < 0.05, close.line);
  check('the car icon is as usual at the usual scale and a little bigger in close', normal.k >= 1 && normal.k < 1.12 && close.k > 1.35 && close.k <= 1.55, { normal, close: close.k });
  check('no page errors', errors.length === 0, errors.slice(0, 3));

  await browser.close();
  const passed = results.filter((r) => r.ok).length;
  console.log(`\n${passed}/${results.length} passed`);
  process.exit(passed === results.length ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
