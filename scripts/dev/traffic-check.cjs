/**
 * Browser check of live traffic with TomTom, the router, the map tiles and the news feed all
 * answered by the check itself (no network needed): the traffic sheet while browsing, traffic on
 * the route cards, the traffic chip, spoken warning, arrival time with traffic and the faster
 * route offer while driving, the traffic list, an incident popup, and switching routes.
 *
 *   VITE_TRAFFIC_NEWS_URL=https://news.test/news.json npx vite build --outDir dist-traffic
 *   npx vite preview --outDir dist-traffic --port 4180 &
 *   node scripts/dev/traffic-check.cjs http://localhost:4180/ <shots dir>
 */
const { chromium } = require('playwright');
const { deflateSync } = require('node:zlib');
const { mkdirSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const BASE = process.argv[2] ?? 'http://localhost:4180/';
const OUT = process.argv[3] ?? 'traffic-shots';
mkdirSync(OUT, { recursive: true });

/* ------------------------------------------------------------------ a small world around KL */
const O = [101.6869, 3.139];
const P = (x, y) => [O[0] + x / (111320 * Math.cos((O[1] * Math.PI) / 180)), O[1] + y / 111320];
function line(pts) {
  const out = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 40));
    for (let k = 0; k < n; k++) out.push(P(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
  }
  out.push(P(...pts[pts.length - 1]));
  return out;
}
const MAIN = [[0, 0], [0, 6000], [4000, 6000]];
// Longer, so the router puts it second; TomTom finds it faster with today's traffic.
const ALT = [[0, 0], [0, 1000], [3000, 2500], [6000, 5000], [4000, 6000]];
const len = (pts) => pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);

function osrmRoute(pts, name, ref) {
  const coords = line(pts);
  const L = len(pts);
  const turnAt = pts[pts.length - 2];
  const firstLeg = len(pts.slice(0, -1));
  const step = (type, loc, d, modifier, nm = name, rf = ref) => ({
    maneuver: { type, modifier, location: loc, bearing_before: 0, bearing_after: 90 },
    name: nm,
    ref: rf,
    distance: d,
    duration: d / 16,
    geometry: { type: 'LineString', coordinates: [] },
    intersections: [{ location: loc, bearings: [0, 90, 180], entry: [true, true, false], out: 0 }],
    driving_side: 'left',
    mode: 'driving',
  });
  return {
    distance: L,
    duration: L / 16,
    weight: L / 16,
    geometry: { type: 'LineString', coordinates: coords },
    legs: [
      {
        distance: L,
        duration: L / 16,
        summary: name,
        steps: [step('depart', coords[0], firstLeg), step('turn', P(...turnAt), L - firstLeg, 'right', 'Jalan Tun Razak', undefined), step('arrive', coords[coords.length - 1], 0)],
      },
    ],
  };
}
const ROUTES = { code: 'Ok', routes: [osrmRoute(MAIN, 'Lebuhraya Duta-Ulu Kelang', 'E33'), osrmRoute(ALT, 'Jalan Ampang', undefined)], waypoints: [] };

const along = (pts, a, b) => {
  const all = line(pts);
  return all.slice(Math.round(a / 40), Math.round(b / 40) + 1);
};
const INCIDENTS = {
  incidents: [
    { type: 'Feature', geometry: { type: 'LineString', coordinates: along(MAIN, 2400, 3300) }, properties: { id: 'jam-1', iconCategory: 'jam', magnitudeOfDelay: 'moderate', events: [{ description: 'Stationary traffic' }], from: 'Jalan Duta', to: 'Sentul', lengthInMeters: 900, delayInSeconds: 480, roadNumbers: ['E33'] } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: along(MAIN, 4600, 4700) }, properties: { id: 'acc-1', iconCategory: 'accident', magnitudeOfDelay: 'major', events: [{ description: 'Accident' }, { description: 'Left lane closed' }], from: 'Sentul', to: 'Setapak', lengthInMeters: 100, delayInSeconds: 300 } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: line([[-1500, 2000], [-1500, 2800]]) }, properties: { id: 'cl-1', iconCategory: 'roadClosed', magnitudeOfDelay: 'undefined', events: [{ description: 'Closed' }], from: 'Jalan Raja Laut', to: 'Jalan Kuching', lengthInMeters: 800, delayInSeconds: 0 } },
    { type: 'Feature', geometry: { type: 'LineString', coordinates: line([[1800, 1200], [2400, 1200]]) }, properties: { id: 'rw-1', iconCategory: 'roadWorks', magnitudeOfDelay: 'minor', events: [{ description: 'Roadworks' }], lengthInMeters: 600, delayInSeconds: 90 } },
  ],
};
const now = Date.now();
const NEWS = {
  updated: new Date(now - 6 * 60_000).toISOString(),
  items: [
    { title: 'Lorry breaks down on DUKE, 3km crawl towards Sentul', link: 'https://news.test/a', source: 'The Star', published: new Date(now - 25 * 60_000).toISOString(), roads: ['DUKE'], kind: 'jam' },
    { title: 'Kemalangan di Lebuhraya Persekutuan, dua lorong ditutup', link: 'https://news.test/b', source: 'Berita Harian', published: new Date(now - 70 * 60_000).toISOString(), roads: ['FEDERAL'], kind: 'accident' },
    { title: 'Flash floods hit Jalan Klang Lama after heavy rain', link: 'https://news.test/c', source: 'Malay Mail', published: new Date(now - 140 * 60_000).toISOString(), roads: ['JALAN-KLANG-LAMA'], kind: 'flood' },
  ],
};

/* ------------------------------------------------------------------ a congestion tile */
function crc32(buf) {
  let c = ~0;
  for (const b of buf) {
    c ^= b;
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function png(w, h, px) {
  const chunk = (type, data) => {
    const t = Buffer.from(type);
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(Buffer.concat([t, data])));
    return Buffer.concat([len, t, data, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) px(x, y).forEach((v, i) => (raw[y * (w * 4 + 1) + 1 + x * 4 + i] = v));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
// A red and an orange stroke across the tile, like congested roads.
const FLOW = png(256, 256, (x, y) => (Math.abs(x - y) < 3 ? [220, 38, 38, 230] : Math.abs(x + y - 300) < 3 ? [249, 115, 22, 230] : [0, 0, 0, 0]));

/* ------------------------------------------------------------------ the check */
const results = [];
const check = (name, ok, detail) => {
  results.push({ name, ok: !!ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail !== undefined && !ok ? `  ${JSON.stringify(detail)}` : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  const ctx = await browser.newContext({ viewport: { width: 412, height: 860 }, geolocation: { latitude: O[1], longitude: O[0] }, permissions: ['geolocation'] });
  const calls = { incidents: 0, legacy: 0, route: 0, flow: 0, news: 0 };
  await ctx.route('**/*', async (r) => {
    const u = r.request().url();
    if (u.includes('api.tomtom.com')) {
      if (u.includes('/incidents/details')) {
        calls.incidents++;
        return r.fulfill({ json: INCIDENTS, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      if (u.includes('/incidentDetails')) {
        calls.legacy++;
        return r.fulfill({ json: INCIDENTS, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      if (u.includes('/calculateRoute/')) {
        calls.route++;
        const body = JSON.parse(r.request().postData() || '{}');
        const pts = body.supportingPoints ?? [];
        const mid = pts[Math.floor(pts.length / 2)];
        const onAlt = mid && mid.longitude > P(800, 0)[0];
        return r.fulfill({ json: { routes: [{ summary: onAlt ? { travelTimeInSeconds: 1100, trafficDelayInSeconds: 60 } : { travelTimeInSeconds: 2000, trafficDelayInSeconds: 780 } }] }, headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      if (u.includes('/flow/')) {
        calls.flow++;
        return r.fulfill({ body: FLOW, contentType: 'image/png', headers: { 'Access-Control-Allow-Origin': '*' } });
      }
      return r.fulfill({ status: 404, body: '{}' });
    }
    if (u.startsWith('https://news.test/news.json')) {
      calls.news++;
      return r.fulfill({ json: NEWS, headers: { 'Access-Control-Allow-Origin': '*' } });
    }
    if (u.includes('/route/v1/driving/')) return r.fulfill({ json: ROUTES, headers: { 'Access-Control-Allow-Origin': '*' } });
    if (u.includes('tiles.openfreemap.org')) {
      const layers = ['transportation', 'transportation_name', 'building', 'place', 'water', 'water_name', 'waterway', 'landuse', 'landcover', 'park', 'aeroway', 'aerodrome_label', 'boundary', 'poi', 'housenumber', 'mountain_peak'];
      if (u.endsWith('/planet')) return r.fulfill({ json: { tilejson: '3.0.0', tiles: ['https://tiles.openfreemap.org/planet/x/{z}/{x}/{y}.pbf'], minzoom: 0, maxzoom: 14, vector_layers: layers.map((id) => ({ id, fields: {} })) } });
      return r.fulfill({ status: 200, body: Buffer.alloc(0), contentType: 'application/x-protobuf' });
    }
    if (u.startsWith(BASE)) return r.continue();
    return r.abort();
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
  await page.addInitScript(() => {
    if (sessionStorage.getItem('seeded')) return;
    sessionStorage.setItem('seeded', '1');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ tomtomKey: 'TEST-KEY', voice: true, look: 2 }));
    // Capture what the app says.
    window.__said = [];
    const orig = window.speechSynthesis?.speak?.bind(window.speechSynthesis);
    if (window.speechSynthesis) window.speechSynthesis.speak = (u) => (window.__said.push(u.text), orig?.(u));
  });
  const shot = (n) => page.screenshot({ path: join(OUT, `${n}.png`) });
  await page.goto(BASE);
  if (await page.locator('#auth-tab-signup').waitFor({ state: 'visible', timeout: 10_000 }).then(() => true, () => false)) {
    await page.click('#auth-tab-signup');
    await page.fill('#auth-name', 'Anuar');
    await page.fill('#auth-email', 'traffic@example.com');
    await page.fill('#auth-password', 'Junction2026');
    await page.click('.auth-submit');
    await page.waitForSelector('.auth', { state: 'hidden', timeout: 30_000 });
  }
  await page.waitForFunction(() => window.__app?.map?.map?.isStyleLoaded?.(), null, { timeout: 30_000 });

  // ---- browsing: traffic sheet with incidents around and the news
  await page.evaluate(([c]) => window.__app.map.map.jumpTo({ center: c, zoom: 13 }), [P(1000, 3000)]);
  await page.click('#btn-traffic');
  await page.waitForFunction(() => document.querySelectorAll('.traffic-list .tl-row').length >= 3, null, { timeout: 15_000 }).catch(() => {});
  await page.waitForFunction(() => document.querySelectorAll('.traffic-list .tl-news').length >= 3, null, { timeout: 10_000 }).catch(() => {});
  await sleep(1500);
  const browse = await page.evaluate(() => ({
    rows: [...document.querySelectorAll('.traffic-list .tl-row strong')].map((e) => e.textContent),
    news: document.querySelectorAll('.traffic-list .tl-news').length,
    layers: ['traffic-flow', 'traffic-lines', 'traffic-closed', 'traffic-route', 'traffic-icons'].filter((id) => window.__app.map.map.getLayer(id)),
    icons: window.__app.map.map.querySourceFeatures('traffic-pts').length,
    attribution: document.querySelector('.maplibregl-ctrl-attrib')?.textContent ?? '',
    tileErrors: window.__app.map.tileErrors,
    fellBack: window.__app.map.styleFailed,
  }));
  await shot('1-browse-traffic');
  check('traffic sheet lists the incidents in view', browse.rows.length >= 3, browse.rows);
  check('traffic sheet lists the news', browse.news === 3, browse.news);
  check('traffic layers on the map', browse.layers.length === 5, browse.layers);
  check('congestion tiles asked for', calls.flow > 0, calls);
  check('TomTom credited on the map', /TomTom/.test(browse.attribution), browse.attribution);
  check('traffic does not upset the map watchdog', !browse.fellBack, browse);

  // ---- planning: traffic on the route cards
  await page.evaluate(([a, b]) => {
    const app = window.__app;
    app.setView('browse');
    app.trip.origin = { name: 'Start', sub: '', lngLat: a };
    app.openDirections({ name: 'Setapak', sub: 'Test destination', lngLat: b });
  }, [P(0, 0), P(4000, 6000)]);
  await page.waitForFunction(() => document.querySelectorAll('.route-opt .r-traffic').length >= 2, null, { timeout: 20_000 }).catch(() => {});
  const cards = await page.evaluate(() => [...document.querySelectorAll('.route-opt')].map((b) => ({ time: b.querySelector('.r-time')?.textContent, traffic: b.querySelector('.r-traffic')?.textContent })));
  await shot('2-route-cards');
  check('route cards show traffic', cards.length === 2 && cards.every((c) => c.traffic), cards);
  check('slow route shows its delay', /\+13 min/.test(cards[0]?.traffic ?? ''), cards[0]);

  // ---- driving: chip, warning, arrival with traffic, faster route
  await page.evaluate(() => {
    const app = window.__app;
    app.selectRoute(0);
    app.startNav(true);
  });
  await page.waitForFunction(() => window.__app.sim, null, { timeout: 10_000 });
  await page.waitForFunction(() => window.__app.traffic.onRoute.length >= 2 && window.__app.traffic.eta, null, { timeout: 20_000 }).catch(() => {});
  // Hold the car on the part both routes share; the alternatives' times are asked a minute
  // after the start, so ask now.
  const ask = () =>
    page.evaluate(() => {
      const app = window.__app;
      app.sim.paused = true;
      app.traffic.altsAt = -Infinity;
      app.traffic.tick(app.engine.progress.s);
    });
  await ask();
  await page.waitForSelector('.faster:not([hidden])', { timeout: 20_000 }).catch(() => {});
  await sleep(800);
  const nav = await page.evaluate(() => ({
    chip: document.querySelector('.traffic-chip:not([hidden])')?.textContent ?? null,
    etaSub: document.querySelector('.eta-sub')?.textContent,
    faster: document.querySelector('.faster:not([hidden]) .fa-text')?.textContent ?? null,
    onRoute: window.__app.traffic.onRoute.map((i) => [i.id, Math.round(i.s), Math.round(i.endS)]),
    routeNews: window.__app.traffic.routeNews.map((n) => n.title),
    edge: window.__app.map.map.querySourceFeatures('traffic-route').length,
  }));
  await shot('3-driving');
  check('incidents placed on the route', nav.onRoute.length === 2 && Math.abs(nav.onRoute[0][1] - 2400) < 80, nav.onRoute);
  check('traffic chip shows the next incident', /Slow traffic/.test(nav.chip ?? ''), nav.chip);
  check('arrival time includes traffic', /\+\d+ min traffic/.test(nav.etaSub ?? ''), nav.etaSub);
  check('news on the route flagged', nav.routeNews.length === 1, nav.routeNews);
  check('faster route offered', /Via Jalan Ampang: 15 min faster/.test(nav.faster ?? ''), nav.faster);
  // Popups stay slim: about 5% of the screen.
  const fasterBox = await page.evaluate(() => {
    const r = document.querySelector('.faster:not([hidden])')?.getBoundingClientRect();
    return r && { h: r.height, share: (r.width * r.height) / (innerWidth * innerHeight), vh: innerHeight };
  });
  check('faster route bar is slim (at most 5% of the screen)', fasterBox && fasterBox.share <= 0.05 && fasterBox.h <= Math.max(36, fasterBox.vh * 0.05) + 1, fasterBox);
  const see = await page.evaluate(() => ['route-line', 'route-casing', 'route-glow'].map((id) => window.__app.map.map.getPaintProperty(id, 'line-opacity')));
  check('route line is see-through with live traffic on', see[0] === 0.5 && see[1] < 0.5, see);
  check('incident edge drawn along the route', nav.edge > 0, nav.edge);

  // Spoken warning: drive up to 1.2 km before the jam.
  await page.evaluate(() => {
    const app = window.__app;
    app.sim.paused = false;
    app.sim.jumpTo(1100);
  });
  await page.waitForFunction(() => (window.__said ?? []).some((t) => /Slow traffic ahead/.test(t)), null, { timeout: 15_000 }).catch(() => {});
  const said = await page.evaluate(() => window.__said ?? []);
  check('spoken warning before the jam', said.some((t) => /Slow traffic ahead, in .*minutes' delay/.test(t)), said.slice(-4));
  check('faster route announced', said.some((t) => /faster route is available/.test(t)), said.slice(-6));
  await page.evaluate(() => (window.__app.sim.paused = true));

  // ---- within 500 m: the chip opens into a card with the details
  const drive = async (s) => {
    await page.evaluate((s) => {
      const app = window.__app;
      app.sim.paused = false;
      app.sim.jumpTo(s);
    }, s);
    await page.waitForFunction((s) => Math.abs((window.__app.engine.progress?.s ?? 0) - s) < 60, s, { timeout: 10_000 }).catch(() => {});
    await page.evaluate(() => (window.__app.sim.paused = true));
    await sleep(700);
  };
  const cardNow = () =>
    page.evaluate(() => {
      const c = document.querySelector('.traffic-card');
      return {
        shown: !!c && !c.hidden,
        title: c?.querySelector('.tcard-title')?.textContent ?? null,
        dist: c?.querySelector('.tcard-dist')?.textContent ?? null,
        box: c && !c.hidden ? (({ width, height }) => ({ h: height, share: (width * height) / (innerWidth * innerHeight), vh: innerHeight }))(c.getBoundingClientRect()) : null,
        facts: c?.querySelector('.tcard-facts')?.textContent ?? null,
        icon: !!c?.querySelector('img.tcard-icon')?.getAttribute('src')?.startsWith('data:image/png'),
        chip: document.querySelector('.traffic-chip:not([hidden])')?.textContent ?? null,
      };
    });
  await drive(1700);
  const far = await cardNow();
  check('no card 700 m before the jam (the chip instead)', !far.shown && /Slow traffic/.test(far.chip ?? ''), far);
  await drive(2000);
  const card = await cardNow();
  await shot('3b-traffic-card');
  check('card pops up within 500 m of the jam', card.shown && card.title === 'Slow traffic' && /\d+ m ahead/.test(card.dist ?? '') && card.icon && !card.chip, card);
  check('card shows the delay', card.facts === '+8 min', card.facts);
  check('card is slim (at most 5% of the screen)', card.box && card.box.share <= 0.05 && card.box.h <= Math.max(36, card.box.vh * 0.05) + 1, card.box);
  await drive(2700);
  const inside = await cardNow();
  check('card counts down inside the jam', inside.shown && /^\d+ m left$/.test(inside.dist ?? ''), inside);
  await page.click('.tcard-close');
  await sleep(400);
  const closed = await cardNow();
  check('closing the card brings the chip back', !closed.shown && /Slow traffic · here/.test(closed.chip ?? ''), closed);
  const fab = await page.evaluate(() => !!document.querySelector('#btn-traffic svg path[fill-rule="evenodd"]'));
  check('traffic button has the car traffic jam icon', fab);

  // ---- the traffic list while driving
  await page.click('.eta-text');
  await sleep(600);
  const list = await page.evaluate(() => ({
    heads: [...document.querySelectorAll('.traffic-list h3')].map((e) => e.textContent),
    rows: [...document.querySelectorAll('.traffic-list .tl-row strong')].map((e) => e.textContent),
    eta: document.querySelector('.tl-eta')?.textContent ?? null,
  }));
  await shot('4-traffic-list');
  check('traffic list: route incidents, news on the route, other news', list.heads.length === 3 && list.rows.length === 2, list);
  check('traffic list shows arrival with traffic', /Arrival with traffic/.test(list.eta ?? ''), list.eta);
  await page.click('.sheet-head button');

  // ---- an incident popup on the map
  await page.evaluate(([c]) => {
    const m = window.__app.map;
    m.isFollowing && (m.following = false);
    m.map.jumpTo({ center: c, zoom: 15, bearing: 0, pitch: 0 });
  }, [P(-1500, 2000)]);
  await sleep(1200);
  const pt = await page.evaluate(([c]) => window.__app.map.map.project(c), [P(-1500, 2000)]);
  await page.mouse.click(pt.x, pt.y);
  await page.waitForSelector('.traffic-pop', { timeout: 5000 }).catch(() => {});
  const pop = await page.evaluate(() => document.querySelector('.traffic-pop .tp')?.textContent ?? null);
  await shot('5-incident-popup');
  check('tapping an incident shows what it is', /Road closed/.test(pop ?? ''), pop);

  // ---- taking the faster route
  // A new drive on the same route (the car is held near the start, where both routes run together).
  await page.evaluate(() => window.__app.endNav());
  await page.waitForFunction(() => window.__app.routes.length === 2 && !window.__app.routesLoading, null, { timeout: 20_000 });
  await page.evaluate(() => {
    const app = window.__app;
    app.selectRoute(0);
    app.startNav(true);
    app.sim.paused = true;
  });
  await page.waitForFunction(() => window.__app.engine.progress, null, { timeout: 10_000 }).catch(() => {});
  await ask();
  await page.waitForSelector('.faster:not([hidden])', { timeout: 20_000 }).catch(() => {});
  const before = await page.evaluate(() => window.__app.engine.route.summary);
  await page.click('.faster .btn-primary', { timeout: 8000 }).catch((e) => console.log('click failed:', String(e).slice(0, 600)));
  await sleep(800);
  const after = await page.evaluate(() => ({ summary: window.__app.engine.route.summary, toast: document.querySelector('.toast.is-on')?.textContent ?? '', faster: !document.querySelector('.faster').hidden }));
  await shot('6-switched');
  check('switching takes the faster route', after.summary !== before && /faster route/.test(after.toast), { before, after });

  // ---- night
  await page.evaluate(() => {
    const app = window.__app;
    app.settings = { ...app.settings, appearance: 'night' };
    app.applyDayNight();
  });
  await sleep(2500);
  await shot('7-night');
  check('no page errors', !errors.filter((e) => !/Failed to load resource|ERR_FAILED|net::/.test(e)).length, errors.slice(0, 8));
  console.log('calls', calls);
  writeFileSync(join(OUT, 'results.json'), JSON.stringify({ results, calls, errors }, null, 1));
  await browser.close();
  process.exit(results.every((r) => r.ok) ? 0 : 1);
})().catch((e) => {
  console.error(e);
  process.exit(2);
});
