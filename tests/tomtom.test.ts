import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LocalFrame, type LngLat } from '../src/geo/geo';
import { detectJunctions } from '../src/junction/detect';
import { tunnelsFromRoute } from '../src/nav/tunnels';
import { describeStep } from '../src/routing/instructions';
import type { RouteResult, Router } from '../src/routing/types';
import { CATEGORIES, CategorySearch, type RawPoi } from '../src/search/categories';
import { FallbackRouter, FallbackSearch } from '../src/tomtom/fallback';
import { TomTomGate } from '../src/tomtom/gate';
import { resetFamilies, TomTomError } from '../src/tomtom/http';
import { lanesOf, maneuverOf, modifierFromAngle, normalizeTomTom, routeUrl, TomTomRouter, type TtInstruction, type TtRoute } from '../src/tomtom/routing';
import { resultToPlace, TomTomPlaceSearch, TomTomPoiProvider } from '../src/tomtom/search';

const f = new LocalFrame([101.69, 3.14]);
const P = (x: number, y: number): LngLat => f.toLngLat(x, y);
const tt = (p: LngLat) => ({ latitude: p[1], longitude: p[0] });

/** Points every ~25 m along local (x, y) corners, with the index where each corner lands. */
function path(corners: [number, number][]) {
  const pts: LngLat[] = [];
  const at: number[] = [0];
  for (let i = 0; i < corners.length - 1; i++) {
    const [ax, ay] = corners[i];
    const [bx, by] = corners[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 25));
    for (let k = 0; k < n; k++) pts.push(P(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
    at.push(pts.length);
  }
  pts.push(P(...corners[corners.length - 1]));
  return { pts, at };
}

/**
 * A drive north on Jalan Ampang, keeping left at a fork onto the E1 toward Kuala Lumpur (lanes
 * given), through a tunnel on the tolled motorway, out at exit 234 on the left, right at the end
 * of the ramp, and arriving.
 */
function sampleRoute(): { route: TtRoute; at: number[] } {
  const { pts, at } = path([
    [0, 0],
    [0, 2000],
    [-400, 3500],
    [-400, 6000],
    [-700, 6600],
    [-700, 6900],
    [-200, 6900],
  ]);
  const ins = (i: Partial<TtInstruction>, k: number, t: number, off: number): TtInstruction => ({ point: tt(pts[at[k]] ?? pts[pts.length - 1]), pointIndex: Math.min(at[k], pts.length - 1), routeOffsetInMeters: off, travelTimeInSeconds: t, drivingSide: 'LEFT', ...i });
  const route: TtRoute = {
    summary: { lengthInMeters: 8300, travelTimeInSeconds: 600, trafficDelayInSeconds: 120, noTrafficTravelTimeInSeconds: 480 },
    legs: [{ summary: { lengthInMeters: 8300, travelTimeInSeconds: 600 }, points: pts.map(tt) }],
    sections: [
      { startPointIndex: at[1], endPointIndex: at[3], sectionType: 'MOTORWAY' },
      { startPointIndex: at[1], endPointIndex: at[3], sectionType: 'TOLL' },
      { startPointIndex: at[2] + 20, endPointIndex: at[2] + 40, sectionType: 'TUNNEL' },
      { startPointIndex: at[1] - 2, endPointIndex: at[1], sectionType: 'LANES', lanes: [{ directions: ['SLIGHT_LEFT'], follow: 'SLIGHT_LEFT' }, { directions: ['STRAIGHT', 'SLIGHT_LEFT'], follow: 'SLIGHT_LEFT' }, { directions: ['STRAIGHT'] }] },
      { startPointIndex: 10, endPointIndex: 30, sectionType: 'TRAFFIC', delayInSeconds: 120 },
    ],
    guidance: {
      instructions: [
        ins({ instructionType: 'LOCATION_DEPARTURE', maneuver: 'DEPART', street: 'Jalan Ampang' }, 0, 0, 0),
        ins({ instructionType: 'TURN', maneuver: 'KEEP_LEFT', junctionType: 'BIFURCATION', turnAngleInDecimalDegrees: -20, street: 'Lebuhraya Utara-Selatan', roadNumbers: ['E1'], signpostText: 'Kuala Lumpur/Ipoh' }, 1, 150, 2000),
        ins({ instructionType: 'TURN', maneuver: 'MOTORWAY_EXIT_LEFT', exitNumber: '234', street: 'Jalan Duta', signpostText: 'Jalan Duta' }, 3, 420, 6100),
        ins({ instructionType: 'TURN', maneuver: 'TURN_RIGHT', turnAngleInDecimalDegrees: 90, street: 'Jalan Kuching', junctionType: 'REGULAR' }, 5, 560, 7700),
        { ...ins({ instructionType: 'LOCATION_ARRIVAL', maneuver: 'ARRIVE_LEFT' }, 6, 600, 8300), point: tt(pts[pts.length - 1]), pointIndex: pts.length - 1 },
      ],
    },
  };
  return { route, at };
}

describe('TomTom maneuvers', () => {
  it('reads each maneuver code as the app knows it', () => {
    const m = (maneuver: string, extra: Partial<TtInstruction> = {}) => maneuverOf({ maneuver, ...extra });
    expect(m('DEPART')).toEqual({ type: 'depart' });
    expect(m('ARRIVE_RIGHT')).toEqual({ type: 'arrive', modifier: 'right' });
    expect(m('KEEP_LEFT')).toEqual({ type: 'fork', modifier: 'slight left' });
    expect(m('BEAR_RIGHT')).toEqual({ type: 'turn', modifier: 'slight right' });
    expect(m('SHARP_LEFT')).toEqual({ type: 'turn', modifier: 'sharp left' });
    expect(m('TRY_MAKE_UTURN')).toEqual({ type: 'turn', modifier: 'uturn' });
    expect(m('MOTORWAY_EXIT_RIGHT')).toEqual({ type: 'off ramp', modifier: 'slight right' });
    expect(m('EXIT_MOTORWAY_LEFT')).toEqual({ type: 'off ramp', modifier: 'slight left' });
    // An exit with no side given: by the turn angle, else on the driving side (left in Malaysia).
    expect(m('TAKE_EXIT', { drivingSide: 'LEFT' })).toEqual({ type: 'off ramp', modifier: 'slight left' });
    expect(m('TAKE_EXIT', { turnAngleInDecimalDegrees: 30, drivingSide: 'LEFT' })).toEqual({ type: 'off ramp', modifier: 'slight right' });
    expect(m('ENTER_MOTORWAY', { turnAngleInDecimalDegrees: -30 })).toEqual({ type: 'on ramp', modifier: 'slight left' });
    expect(m('ROUNDABOUT_RIGHT', { roundaboutExitNumber: 3 })).toEqual({ type: 'roundabout', modifier: 'right' });
    expect(m('ROUNDABOUT_CROSS')).toEqual({ type: 'roundabout', modifier: 'straight' });
    expect(m('MERGE_LEFT_LANE')).toEqual({ type: 'merge', modifier: 'slight left' });
    expect(m('FOLLOW')).toEqual({ type: 'new name', modifier: 'straight' });
    // "Keep straight on" is a split when there is a fork or a sign.
    expect(m('STRAIGHT', { signpostText: 'Ipoh' })).toEqual({ type: 'fork', modifier: 'straight' });
    expect(m('STRAIGHT')).toEqual({ type: 'continue', modifier: 'straight' });
    expect(m('TOLLGATE')).toBeNull();
    // A code from a later version: by its angle.
    expect(m('SOMETHING_NEW', { turnAngleInDecimalDegrees: -95 })).toEqual({ type: 'turn', modifier: 'left' });
    expect(modifierFromAngle(-180)).toBe('uturn');
    expect(modifierFromAngle(150)).toBe('sharp right');
    expect(modifierFromAngle(5)).toBe('straight');
  });

  it('marks the lanes to follow as the ones to use', () => {
    const lanes = lanesOf({ startPointIndex: 0, endPointIndex: 1, sectionType: 'LANES', lanes: [{ directions: ['LEFT'] }, { directions: ['STRAIGHT', 'RIGHT'], follow: 'RIGHT' }, { directions: ['RIGHT'], follow: 'RIGHT' }] }, 'right');
    expect(lanes).toEqual([
      { indications: ['left'], valid: false },
      { indications: ['straight', 'right'], valid: true },
      { indications: ['right'], valid: true },
    ]);
    // Without "follow": the lanes pointing the way of the maneuver.
    expect(lanesOf({ startPointIndex: 0, endPointIndex: 1, sectionType: 'LANES', lanes: [{ directions: ['SLIGHT_LEFT'] }, { directions: ['STRAIGHT'] }] }, 'slight left')?.map((l) => l.valid)).toEqual([true, false]);
  });
});

describe('TomTom route', () => {
  const { route: raw, at } = sampleRoute();
  const route = normalizeTomTom({ routes: [raw] })[0];

  it('keeps the geometry, times and traffic', () => {
    expect(route.provider).toBe('TomTom');
    expect(route.trafficAware).toBe(true);
    expect(route.trafficDelay).toBe(120);
    expect(route.duration).toBe(600);
    expect(route.geometry.length).toBe(raw.legs[0].points.length);
    expect(route.legs).toHaveLength(1);
    expect(route.legs[0].endS).toBe(route.line.length);
  });

  it('turns instructions into steps along the line', () => {
    expect(route.steps.map((s) => [s.type, s.modifier])).toEqual([
      ['depart', undefined],
      ['fork', 'slight left'],
      ['off ramp', 'slight left'],
      ['turn', 'right'],
      ['arrive', 'left'],
    ]);
    const [, fork, exit, turn, arrive] = route.steps;
    expect(fork.s).toBeCloseTo(route.line.cum[at[1]], 0);
    expect(exit.s).toBeCloseTo(route.line.cum[at[3]], 0);
    expect(arrive.s).toBe(route.line.length);
    expect(fork.ref).toBe('E1');
    expect(fork.destinations).toBe('E1: Kuala Lumpur, Ipoh');
    expect(exit.exits).toBe('234');
    expect(turn.name).toBe('Jalan Kuching');
    expect(fork.drivingSide).toBe('left');
    // Durations from TomTom's times at each instruction.
    expect(fork.duration).toBe(270);
    expect(route.steps.reduce((a, s) => a + s.duration, 0)).toBeCloseTo(600, 0);
    // Bearings from the line: north before the fork, north-west after.
    expect(fork.bearingBefore).toBeCloseTo(0, -1);
    expect(fork.bearingAfter).toBeGreaterThan(280);
    expect(fork.bearingAfter).toBeLessThan(350);
  });

  it('puts lane guidance and road classes where the rest of the app looks', () => {
    const fork = route.steps[1];
    expect(fork.intersections[0].lanes?.map((l) => l.valid)).toEqual([true, true, false]);
    expect(fork.intersections[0].classes).toEqual(expect.arrayContaining(['motorway', 'toll']));
    expect(route.hasToll).toBe(true);
    expect(route.hasMotorway).toBe(true);
    expect(route.tollDistance).toBeCloseTo(route.line.cum[at[3]] - route.line.cum[at[1]], 0);
    // The tunnel inside the fork's stretch, as OSRM would mark it.
    const tunnels = tunnelsFromRoute(route);
    expect(tunnels).toHaveLength(1);
    expect(tunnels[0].fromS).toBeCloseTo(route.line.cum[at[2] + 20], 0);
    expect(tunnels[0].toS).toBeCloseTo(route.line.cum[at[2] + 40], 0);
    expect(tunnels[0].highway).toBe('motorway');
  });

  it('gets junction views and instructions like an OSRM route', () => {
    const js = detectJunctions(route);
    expect(js.map((j) => j.kind)).toEqual(['fork', 'exit']);
    expect(js[0].highway).toBe(true);
    expect(describeStep(route.steps[1], 'en').action).toBe('Keep left toward Kuala Lumpur / Ipoh');
    expect(describeStep(route.steps[2], 'en').action).toMatch(/exit 234/i);
    expect(route.summary).toMatch(/E1/);
  });

  it('marks stops between legs', () => {
    const a = path([
      [0, 0],
      [0, 1000],
    ]);
    const b = path([
      [0, 1000],
      [800, 1000],
    ]);
    const n1 = a.pts.length;
    const two: TtRoute = {
      summary: { lengthInMeters: 1800, travelTimeInSeconds: 200 },
      legs: [
        { summary: { lengthInMeters: 1000, travelTimeInSeconds: 110 }, points: a.pts.map(tt) },
        { summary: { lengthInMeters: 800, travelTimeInSeconds: 90 }, points: b.pts.map(tt) },
      ],
      guidance: {
        instructions: [
          { point: tt(a.pts[0]), pointIndex: 0, routeOffsetInMeters: 0, travelTimeInSeconds: 0, maneuver: 'DEPART' },
          { point: tt(a.pts[n1 - 1]), pointIndex: n1 - 1, routeOffsetInMeters: 1000, travelTimeInSeconds: 110, maneuver: 'WAYPOINT_REACHED', instructionType: 'LOCATION_WAYPOINT' },
          { point: tt(b.pts[1]), pointIndex: n1 + 1, routeOffsetInMeters: 1025, travelTimeInSeconds: 114, maneuver: 'TURN_RIGHT', turnAngleInDecimalDegrees: 90 },
          { point: tt(b.pts[b.pts.length - 1]), pointIndex: n1 + b.pts.length - 1, routeOffsetInMeters: 1800, travelTimeInSeconds: 200, maneuver: 'ARRIVE' },
        ],
      },
    };
    const r = normalizeTomTom({ routes: [two] })[0];
    expect(r.steps.map((s) => s.type)).toEqual(['depart', 'arrive', 'turn', 'arrive']);
    expect(r.steps[1].waypoint).toBe(1);
    expect(r.steps[3].waypoint).toBeUndefined();
    expect(r.legs.map((l) => Math.round(l.endS))).toEqual([Math.round(r.line.cum[n1 - 1]), Math.round(r.line.length)]);
  });

  it('asks for traffic, lanes, sections, alternatives and what to avoid', () => {
    const req = { origin: P(0, 0), destination: P(0, 5000), bearing: 365.4, avoid: { tolls: true } };
    const u = new URL(routeUrl('classic', 'K', req, { avoid: ['tolls'], alternatives: 2, lang: 'en-GB' }));
    expect(u.pathname).toMatch(/^\/routing\/1\/calculateRoute\/3\.1\d+,101\.69\d*:3\.18\d+,101\.69\d*\/json$/);
    expect(u.searchParams.get('traffic')).toBe('true');
    expect(u.searchParams.get('instructionsType')).toBe('coded');
    expect(u.searchParams.getAll('sectionType')).toEqual(['lanes', 'motorway', 'toll', 'tunnel', 'ferry', 'traffic', 'speedLimit']);
    // Without the speed limits, for a TomTom service that does not have them.
    expect(new URL(routeUrl('classic', 'K', req, { avoid: [], alternatives: 0, lang: 'en-GB', limits: false })).searchParams.getAll('sectionType')).not.toContain('speedLimit');
    expect(u.searchParams.get('maxAlternatives')).toBe('2');
    expect(u.searchParams.get('vehicleHeading')).toBe('5');
    expect(u.searchParams.getAll('avoid')).toEqual(['tollRoads']);
    const o = new URL(routeUrl('orbis', 'K', { ...req, via: [P(0, 2000)] }, { avoid: [], alternatives: 2, lang: 'en-GB' }));
    expect(o.pathname).toMatch(/^\/maps\/orbis\/routing\/calculateRoute\//);
    expect(o.searchParams.get('apiVersion')).toBe('2');
    expect(o.searchParams.get('traffic')).toBe('live');
    // Alternatives only between two points.
    expect(o.searchParams.get('maxAlternatives')).toBeNull();
  });
});

describe('TomTom router', () => {
  beforeEach(() => resetFamilies());
  afterEach(() => vi.unstubAllGlobals());

  it('tries the other TomTom family when one refuses the key, and remembers it', async () => {
    const urls: string[] = [];
    const { route } = sampleRoute();
    // A different way round, with no toll sections.
    const other = path([
      [0, 0],
      [600, 2000],
      [600, 6900],
      [-200, 6900],
    ]).pts;
    const tollFree: TtRoute = {
      ...route,
      sections: [],
      summary: { ...route.summary, travelTimeInSeconds: 720 },
      legs: [{ summary: { lengthInMeters: 9300, travelTimeInSeconds: 720 }, points: other.map(tt) }],
      guidance: { instructions: [route.guidance!.instructions![0], { ...route.guidance!.instructions![4], point: tt(other[other.length - 1]), pointIndex: other.length - 1 }] },
    };
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('/routing/1/')) return new Response('{"error":{"description":"Not authorized"}}', { status: 403 });
        const avoidsTolls = new URL(url).searchParams.getAll('avoid').includes('tollRoads');
        return new Response(JSON.stringify({ routes: [avoidsTolls ? tollFree : route] }), { status: 200 });
      }),
    );
    const r = await new TomTomRouter(() => 'K').route({ origin: P(0, 0), destination: P(-200, 6900), alternatives: true, offerTollFree: true });
    expect(r.routes.map((x) => x.label)).toEqual(['fastest', 'tollFree']);
    expect(r.routes[1].avoidApplied).toContain('tolls');
    expect(urls.filter((u) => u.includes('/maps/orbis/')).length).toBe(2);
    urls.length = 0;
    await new TomTomRouter(() => 'K').route({ origin: P(0, 0), destination: P(-200, 6900) });
    expect(urls.every((u) => u.includes('/maps/orbis/'))).toBe(true);
  });

  it('keeps TomTom’s speed limits on the route, stretch by stretch', () => {
    const { route, at } = sampleRoute();
    route.sections!.push(
      { startPointIndex: 0, endPointIndex: at[1], sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 60 },
      { startPointIndex: at[1], endPointIndex: at[3], sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 110 },
      { startPointIndex: at[3], endPointIndex: at[3] + 4, sectionType: 'SPEED_LIMIT', maxSpeedLimitInKmh: 0 },
    );
    const r = normalizeTomTom({ routes: [route] })[0];
    expect(r.speedLimits?.map((x) => x.kmh)).toEqual([60, 110]);
    expect(r.speedLimits![0].s0).toBe(0);
    expect(r.speedLimits![0].s1).toBeCloseTo(r.speedLimits![1].s0, 3);
    expect(r.speedLimits![1].s1).toBeCloseTo(r.steps[2].s, 0);
    // A route without them has none.
    expect(normalizeTomTom({ routes: [sampleRoute().route] })[0].speedLimits).toBeUndefined();
  });

  it('asks again without speed limits when the request with them is refused, and remembers', async () => {
    const urls: string[] = [];
    const { route } = sampleRoute();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (new URL(url).searchParams.getAll('sectionType').includes('speedLimit')) return new Response('{"error":{"description":"Invalid sectionType"}}', { status: 400 });
        return new Response(JSON.stringify({ routes: [route] }), { status: 200 });
      }),
    );
    const router = new TomTomRouter(() => 'K');
    const r = await router.route({ origin: P(0, 0), destination: P(-200, 6900) });
    expect(r.routes).toHaveLength(1);
    expect(urls).toHaveLength(2);
    urls.length = 0;
    await router.route({ origin: P(0, 0), destination: P(-200, 6900) });
    expect(urls).toHaveLength(1);
    expect(urls[0]).not.toContain('speedLimit');
  });

  it('says what TomTom said when it cannot route', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{"error":{"description":"Engine error while executing route request: NO_ROUTE_FOUND"},"detailedError":{"code":"NO_ROUTE_FOUND"}}', { status: 400 })));
    await expect(new TomTomRouter(() => 'K').route({ origin: P(0, 0), destination: P(0, 100) })).rejects.toMatchObject({ status: 400, code: 'NO_ROUTE_FOUND' });
  });
});

describe('TomTom first, the usual services when it cannot', () => {
  const okResult = (provider: string): RouteResult => ({ routes: [{ provider } as never], warnings: [] });
  const router = (name: string, impl: () => Promise<RouteResult>): Router => ({ name, route: vi.fn(impl) });

  it('falls back, rests TomTom after a refusal, and comes back after a reset', async () => {
    let now = 0;
    const gate = new TomTomGate(() => 'K', () => true, () => now);
    const tom = router('TomTom', async () => {
      throw new TomTomError('refused', 403);
    });
    const osrm = router('OSRM', async () => okResult('OSRM'));
    const fb = new FallbackRouter(tom, () => osrm, gate);
    const r1 = await fb.route({ origin: [0, 0], destination: [1, 1] });
    expect(r1.routes[0].provider).toBe('OSRM');
    expect(r1.note).toMatch(/key refused/);
    expect(gate.status).toBe('refused');
    // Resting: OSRM straight away, TomTom not asked.
    await fb.route({ origin: [0, 0], destination: [1, 1] });
    expect(tom.route).toHaveBeenCalledTimes(1);
    expect(fb.name).toBe('OSRM');
    // Twenty minutes later TomTom is asked again.
    now += 21 * 60_000;
    expect(gate.usable).toBe(true);
    gate.reset();
    expect(gate.status).toBe('ready');
  });

  it('does not rest TomTom for a request it could not plan', async () => {
    const gate = new TomTomGate(() => 'K', () => true);
    const fb = new FallbackRouter(
      router('TomTom', async () => {
        throw new TomTomError('no route', 400, 'NO_ROUTE_FOUND');
      }),
      () => router('OSRM', async () => okResult('OSRM')),
      gate,
    );
    const r = await fb.route({ origin: [0, 0], destination: [1, 1] });
    expect(r.note).toMatch(/no route/);
    expect(gate.usable).toBe(true);
  });

  it('uses the usual services without a key or when OpenStreetMap only is chosen', async () => {
    const tom = router('TomTom', async () => okResult('TomTom'));
    const osrm = router('OSRM', async () => okResult('OSRM'));
    expect((await new FallbackRouter(tom, () => osrm, new TomTomGate(() => ' ', () => true)).route({ origin: [0, 0], destination: [1, 1] })).routes[0].provider).toBe('OSRM');
    expect((await new FallbackRouter(tom, () => osrm, new TomTomGate(() => 'K', () => false)).route({ origin: [0, 0], destination: [1, 1] })).routes[0].provider).toBe('OSRM');
    expect(tom.route).not.toHaveBeenCalled();
    expect(new TomTomGate(() => '', () => true).status).toBe('nokey');
  });

  it('falls back for place search too', async () => {
    const gate = new TomTomGate(() => 'K', () => true);
    const fb = new FallbackSearch(
      { search: async () => Promise.reject(new TomTomError('busy', 429)), reverse: async () => null },
      () => ({ search: async () => [{ name: 'From Photon', sub: '', lngLat: [0, 0] as LngLat }], reverse: async () => null }),
      gate,
    );
    expect((await fb.search('klcc', null, 'en'))[0].name).toBe('From Photon');
    expect(gate.status).toBe('busy');
  });
});

describe('TomTom search', () => {
  beforeEach(() => resetFamilies());
  afterEach(() => vi.unstubAllGlobals());

  it('turns results into places, heading for the main entrance', () => {
    expect(
      resultToPlace({
        type: 'POI',
        poi: { name: 'Petronas Twin Towers', categories: ['important tourist attraction'] },
        address: { streetName: 'Jalan Ampang', municipality: 'Kuala Lumpur', countrySubdivisionName: 'Kuala Lumpur', freeformAddress: 'Jalan Ampang, 50088 Kuala Lumpur' },
        position: { lat: 3.1579, lon: 101.7116 },
        entryPoints: [{ type: 'main', position: { lat: 3.1572, lon: 101.7121 } }],
      }),
    ).toEqual({ name: 'Petronas Twin Towers', sub: 'Important tourist attraction · Jalan Ampang, Kuala Lumpur', lngLat: [101.7121, 3.1572] });
    expect(resultToPlace({ type: 'Street', address: { streetName: 'Jalan Tun Razak', municipality: 'Kuala Lumpur', country: 'Malaysia' }, position: { lat: 3.16, lon: 101.72 } })).toEqual({
      name: 'Jalan Tun Razak',
      sub: 'Kuala Lumpur, Malaysia',
      lngLat: [101.72, 3.16],
    });
    expect(resultToPlace({ type: 'POI' })).toBeNull();
  });

  it('searches near the user, and reads addresses for a point', async () => {
    const urls: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        urls.push(url);
        if (url.includes('reverseGeocode')) return new Response(JSON.stringify({ addresses: [{ address: { streetName: 'Jalan Raja Chulan', municipality: 'Kuala Lumpur' } }] }));
        return new Response(JSON.stringify({ results: [{ type: 'POI', poi: { name: 'Suria KLCC' }, position: { lat: 3.158, lon: 101.712 } }] }));
      }),
    );
    const s = new TomTomPlaceSearch(() => 'K');
    const found = await s.search('suria', [101.7, 3.15], 'ms');
    expect(found[0].name).toBe('Suria KLCC');
    const u = new URL(urls[0]);
    expect(u.pathname).toBe('/search/2/search/suria.json');
    expect(u.searchParams.get('typeahead')).toBe('true');
    expect(u.searchParams.get('lat')).toBe('3.15000');
    expect(u.searchParams.get('language')).toBe('ms-MY');
    expect((await s.reverse([101.705, 3.149]))?.name).toBe('Jalan Raja Chulan');
    // Coordinates are answered without asking.
    expect((await s.search('3.1390, 101.6869', null, 'en'))[0].sub).toBe('Coordinates');
  });

  it('finds category places nearby and along the route', async () => {
    const calls: { url: string; body?: string }[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string, init?: RequestInit) => {
        calls.push({ url, body: init?.body as string | undefined });
        return new Response(
          JSON.stringify({
            results: [{ id: 'p1', type: 'POI', poi: { name: 'Petronas Jalan Duta', brands: [{ name: 'Petronas' }] }, address: { streetName: 'Jalan Duta' }, position: { lat: 3.17, lon: 101.67 }, detourTime: 90 }],
          }),
        );
      }),
    );
    const pois = new TomTomPoiProvider(() => 'K');
    const fuel = CATEGORIES.find((c) => c.id === 'fuel')!;
    const store = CATEGORIES.find((c) => c.id === 'store')!;
    const near = await pois.query(fuel, [[101.67, 3.17]], 2500);
    expect(near[0]).toMatchObject({ id: 'tomtom/p1', tags: { name: 'Petronas Jalan Duta', brand: 'Petronas', 'addr:street': 'Jalan Duta' } });
    expect(new URL(calls[0].url).pathname).toBe('/search/2/nearbySearch/.json');
    expect(new URL(calls[0].url).searchParams.get('categorySet')).toBe('7311');
    await pois.query(store, [[101.67, 3.17]], 2500);
    expect(new URL(calls[1].url).pathname).toBe('/search/2/categorySearch/convenience%20store.json');
    const along = await pois.query(fuel, [P(0, 0), P(0, 3000)], 400);
    expect(new URL(calls[2].url).pathname).toBe('/search/2/searchAlongRoute/petrol%20station.json');
    expect(JSON.parse(calls[2].body!).route.points).toHaveLength(2);
    expect(along[0].tags._detour).toBe('90');
  });

  it('keeps along-route results TomTom chose for a short detour', async () => {
    const { route: raw } = sampleRoute();
    const route = normalizeTomTom({ routes: [raw] })[0];
    const off = route.line.pointAt(3000);
    // 1.2 km off the route: too far for a plain radius, fine for a 90 s detour.
    const p: LngLat = [off[0] + 1200 / 111320, off[1]];
    const raws: RawPoi[] = [
      { id: 'a', lngLat: p, tags: { name: 'Shell', _detour: '90' } },
      { id: 'b', lngLat: p, tags: { name: 'Far station' } },
    ];
    const search = new CategorySearch({ query: async () => raws });
    const list = await search.alongRoute(CATEGORIES[0], route, 0, 'en', 'metric');
    expect(list.map((x) => x.name)).toEqual(['Shell']);
  });
});

describe('the other branch of a TomTom split', () => {
  it('lies on the side the route does not take', async () => {
    const { normalizeTomTom } = await import('../src/tomtom/routing');
    const { destination } = await import('../src/geo/geo');
    for (const [maneuver, angle, bend] of [
      ['KEEP_LEFT', -20, -12],
      ['KEEP_RIGHT', 20, 12],
      ['MOTORWAY_EXIT_LEFT', -25, -15],
    ] as const) {
      // North 400 m, then bending off by `bend` degrees for 400 m.
      const pts: [number, number][] = [[101.7, 3.1]];
      for (let i = 1; i <= 40; i++) pts.push(destination(pts[i - 1], i <= 20 ? 0 : bend, 20));
      const tt = (p: [number, number]) => ({ latitude: p[1], longitude: p[0] });
      const r = normalizeTomTom({
        routes: [
          {
            summary: { lengthInMeters: 800, travelTimeInSeconds: 60 },
            legs: [{ summary: { lengthInMeters: 800, travelTimeInSeconds: 60 }, points: pts.map(tt) }],
            guidance: {
              instructions: [
                { point: tt(pts[0]), pointIndex: 0, maneuver: 'DEPART', routeOffsetInMeters: 0, travelTimeInSeconds: 0 },
                { point: tt(pts[20]), pointIndex: 20, maneuver, turnAngleInDecimalDegrees: angle, junctionType: 'BIFURCATION', routeOffsetInMeters: 400, travelTimeInSeconds: 30, drivingSide: 'LEFT' },
                { point: tt(pts[40]), pointIndex: 40, maneuver: 'ARRIVE', routeOffsetInMeters: 800, travelTimeInSeconds: 60 },
              ],
            },
          },
        ],
      })[0];
      const st = r.steps[1];
      const ix = st.intersections[0];
      expect(ix.bearings.length, maneuver).toBe(3);
      const other = ix.bearings[2];
      const d = ((other - st.bearingBefore + 540) % 360) - 180;
      // Keep left: the other road keeps right (or straight on, for an exit), and the other way round.
      if (maneuver === 'KEEP_LEFT') expect(d, maneuver).toBeGreaterThan(5);
      if (maneuver === 'KEEP_RIGHT') expect(d, maneuver).toBeLessThan(-5);
      if (maneuver === 'MOTORWAY_EXIT_LEFT') expect(Math.abs(d), maneuver).toBeLessThan(3);
    }
  });
});
