import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalFrame, type LngLat } from '../src/geo/geo';
import { normalizeOsrm, type OsrmResponse } from '../src/routing/osrm';
import type { Route } from '../src/routing/types';
import { parseNews } from '../src/traffic/news';
import { boxAhead, incidentsOnRoute, newsForRoute, pointsAhead, routeTimeFrom, trafficRemaining } from '../src/traffic/onRoute';
import { roadName, roadsInText, roadsOfSteps } from '../src/traffic/roads';
import { fasterAlternative, TrafficService, type AltEta } from '../src/traffic/service';
import { bboxArea, kindOf, normalizeIncident, TomTomTraffic } from '../src/traffic/tomtom';
import type { Incident, NewsItem } from '../src/traffic/types';

const f = new LocalFrame([101.69, 3.14]);
const P = (x: number, y: number): LngLat => f.toLngLat(x, y);

/** A route through local points (metres east, north), as the router would return it. */
function route(pts: [number, number][], name = '', ref?: string): Route {
  const coords: LngLat[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 50));
    for (let k = 0; k < n; k++) coords.push(P(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
  }
  coords.push(P(...pts[pts.length - 1]));
  const len = pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const step = (type: string, loc: LngLat, d: number) => ({
    maneuver: { type, location: loc, bearing_before: 0, bearing_after: 0 },
    name,
    ref,
    distance: d,
    duration: d / 20,
    geometry: { type: 'LineString', coordinates: coords },
    intersections: [{ location: loc, bearings: [0], entry: [true], out: 0 }],
    driving_side: 'left',
    mode: 'driving',
  });
  const json = {
    code: 'Ok',
    routes: [
      {
        distance: len,
        duration: len / 20,
        geometry: { type: 'LineString', coordinates: coords },
        legs: [{ distance: len, duration: len / 20, steps: [step('depart', coords[0], len), step('arrive', coords[coords.length - 1], 0)] }],
      },
    ],
  } as unknown as OsrmResponse;
  return normalizeOsrm(json, 'Test')[0];
}

const inc = (id: string, pts: LngLat[], extra: Partial<Incident> = {}): Incident => ({
  id,
  kind: 'jam',
  magnitude: 'moderate',
  delay: 300,
  length: 500,
  description: 'Stationary traffic',
  roads: [],
  geometry: pts,
  ...extra,
});

describe('roads in text', () => {
  it('finds expressways by name, abbreviation and route number', () => {
    expect(roadsInText('Kesesakan di Lebuhraya Duta – Ulu Kelang arah Ampang')).toEqual(['DUKE']);
    expect(roadsInText('Accident on the NKVE near Jalan Duta toll')).toEqual(expect.arrayContaining(['NKVE', 'JALAN-DUTA']));
    expect(roadsInText('Jam on E33 after the crash')).toEqual(['DUKE']);
    expect(roadsInText('PLUS: lorry overturns at KM 290')).toContain('PLUS');
    expect(roadsInText('federal highway closed for the parade')).toEqual(['FEDERAL']);
  });

  it('does not match words that only look like a road', () => {
    expect(roadsInText('The duke of Edinburgh smart plus mex')).toEqual([]);
    expect(roadsInText('E330 is not a road here')).toEqual([]);
    expect(roadsInText('Jalan Dutamas')).toEqual([]);
  });

  it('reads a route from its road names and numbers', () => {
    expect(roadsOfSteps([{ name: 'Lebuhraya Damansara-Puchong', ref: 'E11' }, { name: 'Jalan Tun Razak' }, { name: '', ref: 'E1;E2' }]).sort()).toEqual(
      ['JALAN-TUN-RAZAK', 'LDP', 'NKVE', 'PLUS'].sort(),
    );
    expect(roadName('DUKE')).toBe('DUKE');
    expect(roadName('KARAK')).toBe('Karak Highway');
  });
});

describe('TomTom incidents', () => {
  it('reads the current service', () => {
    const i = normalizeIncident({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: [[101.6, 3.1], [101.61, 3.11]] },
      properties: { id: 'a1', iconCategory: 'accident', magnitudeOfDelay: 'major', events: [{ description: 'Accident' }, { description: 'Lane closed' }], from: 'Jalan A', to: 'Jalan B', lengthInMeters: 820, delayInSeconds: 610, roadNumbers: ['E33'] },
    });
    expect(i).toMatchObject({ id: 'a1', kind: 'accident', magnitude: 'major', delay: 610, length: 820, description: 'Accident, Lane closed', roads: ['E33'] });
    expect(i?.geometry).toHaveLength(2);
  });

  it('reads the older service', () => {
    const i = normalizeIncident({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [101.6, 3.1] },
      properties: { id: 'b2', iconCategory: 8, magnitudeOfDelay: 4, events: [{ description: 'Closed' }], length: 300, delay: 0 },
    });
    expect(i).toMatchObject({ kind: 'closure', magnitude: 'undefined', delay: 0, length: 300 });
    expect(i?.geometry).toEqual([[101.6, 3.1]]);
    expect(kindOf(11)).toBe('flooding');
    expect(kindOf('roadWorks')).toBe('roadworks');
    expect(normalizeIncident({ properties: { id: 'x' } })).toBeNull();
  });

  it('measures boxes', () => {
    expect(bboxArea([101, 3, 102, 4])).toBeGreaterThan(12_000);
    expect(bboxArea([101, 3, 101.5, 3.5])).toBeLessThan(4_000);
  });
});

describe('incidents on the route', () => {
  const r = route([[0, 0], [0, 5000]]);

  it('places incidents along the route in the direction of travel', () => {
    const list = incidentsOnRoute(r, [
      inc('ahead', [P(5, 2000), P(5, 2500), P(4, 2900)]),
      inc('other side', [P(-25, 3500), P(-25, 3000)]),
      inc('far', [P(400, 1000), P(400, 1500)]),
      inc('point', [P(3, 4200)], { length: 0 }),
    ]);
    expect(list.map((i) => i.id)).toEqual(['ahead', 'point']);
    expect(list[0].s).toBeCloseTo(2000, -1);
    expect(list[0].endS).toBeCloseTo(2900, -1);
    expect(list[1].endS - list[1].s).toBeGreaterThan(0);
  });

  it('skips what is behind the car', () => {
    expect(incidentsOnRoute(r, [inc('behind', [P(0, 500), P(0, 900)])], 2000)).toEqual([]);
  });

  it('asks about the road ahead in a box TomTom accepts', () => {
    const long = route([[0, 0], [0, 150_000], [150_000, 150_000]]);
    const { bbox, toS } = boxAhead(long, 0, 300_000);
    expect(bboxArea(bbox)).toBeLessThanOrEqual(8000);
    expect(toS).toBeGreaterThan(30_000);
    const near = boxAhead(r, 1000);
    expect(near.toS).toBeCloseTo(5000, 0);
  });

  it('describes the rest of the route in points', () => {
    const pts = pointsAhead(r, 1000, 10, 100);
    expect(pts.length).toBeLessThanOrEqual(11);
    expect(pts[0]).toEqual(r.line.pointAt(1000));
    expect(pts[pts.length - 1]).toEqual(r.line.pointAt(r.line.length));
  });

  it('counts the time down as the car drives', () => {
    const t0 = routeTimeFrom(r, 0);
    expect(t0).toBeCloseTo(250, 0);
    expect(routeTimeFrom(r, 2500)).toBeCloseTo(125, 0);
    const eta = { travelTime: 400, delay: 100, fromS: 0, at: 0, base: t0 };
    expect(trafficRemaining(eta, t0 / 2)).toEqual({ time: 200, delay: 50 });
  });
});

describe('traffic news', () => {
  const now = Date.parse('2026-11-06T08:00:00Z');
  const item = (title: string, roads: string[], hoursAgo: number): NewsItem => ({
    title,
    link: 'https://example.com/a',
    source: 'Example',
    published: new Date(now - hoursAgo * 3600_000).toISOString(),
    roads,
    kind: 'jam',
  });

  it('keeps only well-formed items from the feed', () => {
    const feed = parseNews({
      updated: '2026-11-06T07:40:00Z',
      items: [
        { title: 'Jam on DUKE', link: 'https://news.example/1', source: 'X', published: '2026-11-06T07:00:00Z', roads: ['DUKE'], kind: 'jam' },
        { title: 'Bad link', link: 'javascript:alert(1)', published: '2026-11-06T07:00:00Z' },
        { title: '', link: 'https://news.example/2', published: '2026-11-06T07:00:00Z' },
        { title: 'Odd kind', link: 'https://news.example/3', published: '2026-11-06T07:00:00Z', kind: 'party', roads: [1, 'LDP'] },
      ],
    });
    expect(feed.items.map((i) => i.title)).toEqual(['Jam on DUKE', 'Odd kind']);
    expect(feed.items[1]).toMatchObject({ kind: 'other', roads: ['LDP'], source: 'news.example' });
    expect(parseNews(null).items).toEqual([]);
  });

  it('picks the news about the roads on the route, newest first', () => {
    const list = newsForRoute([item('old', ['DUKE'], 8), item('a', ['DUKE'], 2), item('b', ['LDP'], 1), item('c', ['MEX', 'DUKE'], 0.5)], ['DUKE'], now);
    expect(list.map((i) => i.title)).toEqual(['c', 'a']);
  });
});

describe('faster alternatives', () => {
  const main = route([[0, 0], [0, 10_000]]);
  const alt = route([[0, 0], [0, 1000], [3000, 6000], [0, 10_000]]);
  const a = (travelTime: number, mainTime: number, at = 0): AltEta => ({ route: alt, s: 0, travelTime, delay: 0, mainTime, at });

  it('suggests one only when it clearly saves time and the car can still take it', () => {
    const here = main.line.pointAt(300);
    expect(fasterAlternative([a(1500, 2000)], here, 1000)?.save).toBe(500);
    expect(fasterAlternative([a(1900, 2000)], here, 1000)).toBeNull(); // 100 s only
    expect(fasterAlternative([a(3000, 3330)], here, 1000)).toBeNull(); // 330 s but under 10%
    expect(fasterAlternative([a(1500, 2000, 0)], here, 10 * 60_000)).toBeNull(); // stale
    expect(fasterAlternative([a(1500, 2000)], main.line.pointAt(5000), 1000)).toBeNull(); // past the split
    expect(fasterAlternative([a(1500, 2000)], here, 1000)?.s).toBeCloseTo(300, -1);
  });
});

describe('traffic service', () => {
  afterEach(() => vi.unstubAllGlobals());
  const r = route([[0, 0], [0, 20_000]]);

  function fakeFetch() {
    const calls: string[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push(`${init?.method ?? 'GET'} ${url}`);
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
      if (url.includes('/incidents/details')) return json({ error: 'not for this key' }, 403);
      if (url.includes('/incidentDetails'))
        return json({
          incidents: [
            { type: 'Feature', geometry: { type: 'LineString', coordinates: [P(2, 6000), P(2, 6800)] }, properties: { id: 'j1', iconCategory: 6, magnitudeOfDelay: 2, events: [{ description: 'Queuing traffic' }], length: 800, delay: 240 } },
          ],
        });
      if (url.includes('/calculateRoute/')) return json({ routes: [{ summary: { travelTimeInSeconds: 1500, trafficDelayInSeconds: 240 } }] });
      if (url.includes('news.json')) return json({ updated: '2026-11-06T07:40:00Z', items: [{ title: 'Jam on DUKE', link: 'https://n.example/1', source: 'N', published: new Date().toISOString(), roads: ['DUKE'], kind: 'jam' }] });
      return json({}, 404);
    });
    vi.stubGlobal('fetch', fn);
    return calls;
  }

  it('asks for incidents, the travel time and the news, then waits', async () => {
    const calls = fakeFetch();
    let now = 1_000_000;
    const svc = new TrafficService({ key: () => 'k', newsUrl: () => 'https://raw.example/news.json', newsOn: () => true, incidentsOn: () => true, now: () => now, online: () => true });
    let changes = 0;
    svc.onChange = () => changes++;
    svc.setRoute(r);
    svc.tick(100);
    await vi.waitFor(() => expect(svc.eta).not.toBeNull());
    await vi.waitFor(() => expect(svc.onRoute).toHaveLength(1));
    await vi.waitFor(() => expect(svc.news).toHaveLength(1));
    expect(svc.onRoute[0]).toMatchObject({ id: 'j1', kind: 'jam', magnitude: 'moderate' });
    expect(svc.eta).toMatchObject({ travelTime: 1500, delay: 240, fromS: 100 });
    // The current service refused the key, so the older one answered (and is used from now on).
    expect(calls.filter((c) => c.includes('/incidents/details'))).toHaveLength(1);
    expect(calls.some((c) => c.startsWith('POST') && c.includes('traffic=true'))).toBe(true);
    expect(changes).toBeGreaterThan(2);

    const n = calls.length;
    now += 60_000;
    svc.tick(1000);
    await new Promise((res) => setTimeout(res, 10));
    expect(calls.length).toBe(n);
    now += INC_WAIT;
    svc.tick(3000);
    await vi.waitFor(() => expect(calls.length).toBeGreaterThan(n));
    expect(calls.slice(n).some((c) => c.includes('/incidentDetails'))).toBe(true);
    expect(calls.slice(n).some((c) => c.includes('/incidents/details'))).toBe(false);
    // Past the jam: it drops off the list.
    svc.tick(7000);
    expect(svc.onRoute).toHaveLength(0);
  });

  it('does nothing with TomTom without a key', async () => {
    const calls = fakeFetch();
    const svc = new TrafficService({ key: () => ' ', newsUrl: () => '', newsOn: () => false, incidentsOn: () => true, online: () => true });
    svc.setRoute(r);
    svc.tick(0);
    await new Promise((res) => setTimeout(res, 10));
    expect(calls).toEqual([]);
    expect(svc.live).toBe(false);
  });

  it('says when the key is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 403 })));
    const t = new TomTomTraffic(() => 'bad');
    await expect(t.incidents([101, 3, 101.1, 3.1])).rejects.toThrow(/refused/);
  });
});

const INC_WAIT = 4 * 60_000;
