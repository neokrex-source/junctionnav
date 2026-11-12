import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { DemoRouter, DemoSpeedProvider } from '../src/demo/providers';
import { haversine, type LngLat } from '../src/geo/geo';
import { NavEngine, type Prompt } from '../src/nav/engine';
import { Simulator } from '../src/nav/sources';
import {
  buildRoadsAheadQuery,
  cameraAhead,
  checkAt,
  limitAt,
  lowerLimitAhead,
  matchCameras,
  matchLimits,
  mergeLimits,
  nationalLimit,
  nationalLimits,
  OverpassRoadsAhead,
  parseMaxspeed,
  parseSpeedAnswer,
  routerLimits,
  SpeedLoader,
  type CameraPoint,
  type LimitSpan,
  type LimitWay,
  type SpeedInfo,
} from '../src/nav/speed';
import { SpeedWatch, type SpeedPrompt } from '../src/nav/speedWatch';
import { speedSpeech, speedWords } from '../src/routing/instructions';
import { normalizeOsrm, type OsrmResponse, type OsrmStep } from '../src/routing/osrm';
import type { Route } from '../src/routing/types';

/* ------------------------------------------------------------------ a straight test road */

const O: LngLat = [101.6, 3.1];
const M_PER_DEG = haversine(O, [O[0] + 0.01, O[1]]) * 100; // one degree of longitude at 3.1° N
/** A point `m` metres east and `off` metres north of the start. */
const at = (m: number, off = 0): LngLat => [O[0] + m / M_PER_DEG, O[1] + off / 110_574];

interface StepSpec {
  m: number;
  type: string;
  modifier?: string;
  classes?: string[];
}

/** An eastbound road `length` metres long with maneuvers at the given distances, driven at `speed`. */
function road(length: number, specs: StepSpec[] = [], speed = 25, classes?: string[]): Route {
  const coords: LngLat[] = [];
  for (let m = 0; m <= length; m += 50) coords.push(at(m));
  if (length % 50) coords.push(at(length));
  const all: StepSpec[] = [{ m: 0, type: 'depart', classes }, ...specs, { m: length, type: 'arrive' }];
  const steps: OsrmStep[] = all.map((sp, i) => {
    const dist = (all[i + 1]?.m ?? length) - sp.m;
    return {
      distance: dist,
      duration: dist / speed,
      name: `Jalan ${i}`,
      mode: 'driving',
      driving_side: 'left',
      maneuver: { type: sp.type, modifier: sp.modifier, location: at(sp.m), bearing_before: 90, bearing_after: 90 },
      intersections: [{ location: at(sp.m), bearings: [270, 90], entry: [false, true], in: 0, out: 1, classes: sp.classes ?? classes }],
    } as OsrmStep;
  });
  const json: OsrmResponse = {
    code: 'Ok',
    routes: [{ distance: length, duration: length / speed, geometry: { type: 'LineString', coordinates: coords }, legs: [{ steps, summary: '', distance: length, duration: length / speed }] }],
  } as OsrmResponse;
  return normalizeOsrm(json, 'Test')[0];
}

const way = (id: string, coords: LngLat[], tags: Record<string, string>): LimitWay => ({ id, coords, tags: { highway: 'primary', ...tags } });
/** Spans with their ends to the nearest 50 m (the route is sampled every 20 m against the roads). */
const spans = (list: LimitSpan[]) => list.map((x) => [Math.round(x.s0 / 50) * 50, Math.round(x.s1 / 50) * 50, Math.round(x.kmh), x.src]);

/* ------------------------------------------------------------------ reading the map */

describe('speed limits as the map writes them', () => {
  it('reads numbers, miles per hour and zones, and leaves the rest', () => {
    expect(parseMaxspeed('110')).toBe(110);
    expect(parseMaxspeed('60 mph')).toBeCloseTo(96.56, 1);
    expect(parseMaxspeed('90;70')).toBe(90);
    expect(parseMaxspeed('MY:urban')).toBe(60);
    expect(parseMaxspeed('MY:motorway')).toBe(110);
    for (const v of ['none', 'signals', 'walk', 'variable', '', undefined, '0', '400']) expect(parseMaxspeed(v)).toBeNull();
  });

  it('knows the national expressway limit: 110 in Malaysia, 100 in Japan', () => {
    expect(nationalLimit([101.7, 3.1])).toBe(110); // Kuala Lumpur
    expect(nationalLimit([116.07, 5.98])).toBe(110); // Kota Kinabalu
    expect(nationalLimit([139.7, 35.68])).toBe(100); // Tokyo
    expect(nationalLimit([103.82, 1.35])).toBeNull(); // Singapore signs its own
    expect(nationalLimit([100.5, 13.75])).toBeNull(); // Bangkok
  });
});

describe('limits on the road the route runs along', () => {
  const r = road(3000);

  it('takes the limit of the road under the route, stretch by stretch', () => {
    const ways = [way('a', [at(0), at(1000)], { maxspeed: '60' }), way('b', [at(1000), at(3000)], { maxspeed: '90' })];
    expect(spans(matchLimits(r, ways, [0, 3000]))).toEqual([
      [0, 1000, 60, 'osm'],
      [1000, 3000, 90, 'osm'],
    ]);
  });

  it('leaves out crossing roads, roads beside the route and the other carriageway', () => {
    const ways = [
      way('main', [at(0), at(3000)], { maxspeed: '90' }),
      way('cross', [at(1500, -200), at(1500, 200)], { maxspeed: '30' }),
      way('frontage', [at(0, 20), at(3000, 20)], { maxspeed: '50' }),
      // The other carriageway, 8 m to the side and one-way the other way, with another limit.
      way('other', [at(3000, 8), at(0, 8)], { maxspeed: '70', oneway: 'yes' }),
    ];
    expect(spans(matchLimits(r, ways, [0, 3000]))).toEqual([[0, 3000, 90, 'osm']]);
  });

  it('reads direction limits the way the route drives the road', () => {
    // Drawn east to west: the route drives it backward.
    const ways = [way('a', [at(3000), at(0)], { 'maxspeed:forward': '80', 'maxspeed:backward': '60' })];
    expect(spans(matchLimits(r, ways, [0, 3000]))).toEqual([[0, 3000, 60, 'osm']]);
    // A one-way road against the route is not the route's road.
    expect(matchLimits(r, [way('b', [at(3000), at(0)], { maxspeed: '80', oneway: 'yes' })], [0, 3000])).toEqual([]);
  });

  it('does not take a side road brushed at a junction for a change of limit', () => {
    const ways = [
      way('a', [at(0), at(1490)], { maxspeed: '90' }),
      // 20 m of slip road at the junction, then the main road again.
      way('slip', [at(1490), at(1510)], { maxspeed: '40' }),
      way('b', [at(1510), at(3000)], { maxspeed: '90' }),
    ];
    expect(spans(matchLimits(r, ways, [0, 3000]))).toEqual([[0, 3000, 90, 'osm']]);
  });

  it('does not take a toll lane’s or a car park’s walking pace for the road’s limit', () => {
    // 10 km/h mapped on a stretch of expressway (a toll booth lane), 20 on a primary road.
    const ways = [
      way('a', [at(0), at(1000)], { highway: 'motorway', maxspeed: '110' }),
      way('booth', [at(1000), at(1200)], { highway: 'motorway', maxspeed: '10' }),
      way('b', [at(1200), at(2000)], { highway: 'primary', maxspeed: '20' }),
      // On a side street 20 is a real limit; 5 is a gate.
      way('c', [at(2000), at(2600)], { highway: 'residential', maxspeed: '20' }),
      way('d', [at(2600), at(3000)], { highway: 'service', maxspeed: '5' }),
    ];
    expect(spans(matchLimits(r, ways, [0, 3000]))).toEqual([
      [0, 1000, 110, 'osm'],
      [2000, 2600, 20, 'osm'],
    ]);
  });

  it('leaves a gap where no road with a limit is known', () => {
    const got = matchLimits(r, [way('a', [at(0), at(800)], { maxspeed: '60' }), way('b', [at(2000), at(3000)], { maxspeed: '90' })], [0, 3000]).map((x) => ({ ...x }));
    expect(spans(got)).toEqual([
      [0, 800, 60, 'osm'],
      [2000, 3000, 90, 'osm'],
    ]);
    expect(limitAt(got, 400)?.kmh).toBe(60);
    expect(limitAt(got, 1500)).toBeNull();
    expect(limitAt(got, 2500)?.kmh).toBe(90);
  });
});

describe('the national limit on expressways', () => {
  it('is 110 on a Malaysian expressway, not on its ramps and not on other roads', () => {
    const r = road(
      6000,
      [
        { m: 1000, type: 'on ramp', modifier: 'slight left', classes: ['motorway'] },
        { m: 1400, type: 'merge', modifier: 'slight right', classes: ['motorway'] },
        { m: 4000, type: 'off ramp', modifier: 'slight left', classes: ['motorway'] },
        { m: 4500, type: 'turn', modifier: 'left', classes: [] },
      ],
      27,
      [],
    );
    expect(spans(nationalLimits(r))).toEqual([[1400, 4000, 110, 'national']]);
  });

  it('gives way to what the router and the map know', () => {
    const national: LimitSpan[] = [{ s0: 0, s1: 5000, kmh: 110, src: 'national' }];
    const osm: LimitSpan[] = [{ s0: 1000, s1: 2000, kmh: 90, src: 'osm' }];
    const router: LimitSpan[] = [{ s0: 1500, s1: 3000, kmh: 80, src: 'router' }];
    expect(spans(mergeLimits(router, osm, national))).toEqual([
      [0, 1000, 110, 'national'],
      [1000, 1500, 90, 'osm'],
      [1500, 3000, 80, 'router'],
      [3000, 5000, 110, 'national'],
    ]);
  });

  it('finds a lower limit coming up', () => {
    const list: LimitSpan[] = [
      { s0: 0, s1: 1000, kmh: 110, src: 'osm' },
      { s0: 1000, s1: 2000, kmh: 90, src: 'osm' },
      { s0: 2000, s1: 3000, kmh: 110, src: 'osm' },
    ];
    expect(lowerLimitAhead(list, 700, 500)).toEqual({ kmh: 90, dist: 300 });
    expect(lowerLimitAhead(list, 300, 500)).toBeNull();
    // A higher limit ahead is nothing to slow down for.
    expect(lowerLimitAhead(list, 1800, 500)).toBeNull();
  });

  it('takes the router’s own limits from the route', () => {
    const r = road(2000);
    r.speedLimits = [
      { s0: 0, s1: 900, kmh: 60 },
      { s0: 900, s1: 2000, kmh: 110 },
    ];
    expect(spans(routerLimits(r))).toEqual([
      [0, 900, 60, 'router'],
      [900, 2000, 110, 'router'],
    ]);
  });
});

/* ------------------------------------------------------------------ cameras */

describe('speed cameras on the route’s own carriageway', () => {
  const r = road(5000);
  const cam = (id: string, p: LngLat, tags: Record<string, string> = {}, road?: CameraPoint['road']): CameraPoint => ({ id, at: p, tags: { highway: 'speed_camera', ...tags }, ...(road ? { road } : {}) });
  const east = { coords: [at(0), at(5000)], oneway: 1 as const };
  const west = { coords: [at(5000, 14), at(0, 14)], oneway: 1 as const };

  it('counts a camera on the route’s road, with its limit', () => {
    const got = matchCameras(r, { cameras: [cam('a', at(2000), { maxspeed: '110' }, east)], checks: [] }, [0, 5000]);
    expect(got.cameras).toHaveLength(1);
    expect(Math.round(got.cameras[0].s)).toBe(2000);
    expect(got.cameras[0].limit).toBe(110);
  });

  it('leaves out one on the other carriageway, on a crossing road or far from the route', () => {
    const cross = { coords: [at(3000, -200), at(3000, 200)], oneway: 0 as const };
    const got = matchCameras(
      r,
      {
        cameras: [
          cam('other', at(1000, 14), {}, west), // on the opposite carriageway
          cam('cross', at(3000, 6), {}, cross), // on a road that crosses the route
          cam('far', at(4000, 60)), // beside another road
        ],
        checks: [],
      },
      [0, 5000],
    );
    expect(got.cameras).toEqual([]);
  });

  it('follows the direction a camera is set for on a two-way road', () => {
    const twoWay = { coords: [at(0), at(5000)], oneway: 0 as const };
    const fwd = matchCameras(r, { cameras: [cam('f', at(1500), { direction: 'forward' }, twoWay), cam('b', at(2500), { direction: 'backward' }, twoWay)], checks: [] }, [0, 5000]);
    expect(fwd.cameras.map((c) => Math.round(c.s))).toEqual([1500]);
  });

  it('takes a pole on the kerb side or in the median, not one across the other carriageway', () => {
    // Driving east on the left of the road: the kerb is to the north (left), oncoming traffic to the south.
    const pos = (off: number) => matchCameras(r, { cameras: [cam('x', at(2000, off))], checks: [] }, [0, 5000]).cameras.length;
    expect(pos(20)).toBe(1); // on the kerb side, 20 m out
    expect(pos(-8)).toBe(1); // in the median
    expect(pos(-20)).toBe(0); // on the far shoulder of the other carriageway
    expect(pos(30)).toBe(0); // too far to be this road's
  });

  it('counts a camera right beside the road, and folds two at one spot into one', () => {
    const got = matchCameras(r, { cameras: [cam('side', at(2000, -12)), cam('pole', at(2030, 10), { maxspeed: '90' })], checks: [] }, [0, 5000]);
    expect(got.cameras).toHaveLength(1);
    expect(got.cameras[0].limit).toBe(90);
  });

  it('reads enforcement relations: a fixed camera in the route’s direction, and an average speed check', () => {
    const got = matchCameras(
      r,
      {
        cameras: [],
        checks: [
          // Checked stretch starts before the camera along the route: this direction.
          { id: '1', tags: { type: 'enforcement', enforcement: 'maxspeed', maxspeed: '90' }, devices: [at(1500, 8)], from: [at(1400)], to: [] },
          // Starts after it along the route: the other direction.
          { id: '2', tags: { type: 'enforcement', enforcement: 'maxspeed', maxspeed: '90' }, devices: [at(2500, 8)], from: [at(2600)], to: [] },
          { id: '3', tags: { type: 'enforcement', enforcement: 'average_speed', maxspeed: '110' }, devices: [], from: [at(3000)], to: [at(4500)] },
          // A check running the other way.
          { id: '4', tags: { type: 'enforcement', enforcement: 'average_speed' }, devices: [], from: [at(4000)], to: [at(3200)] },
        ],
      },
      [0, 5000],
    );
    expect(got.cameras.map((c) => [Math.round(c.s), c.limit])).toEqual([[1500, 90]]);
    expect(got.checks.map((c) => [Math.round(c.s0), Math.round(c.s1), c.limit])).toEqual([[3000, 4500, 110]]);
  });

  it('finds the next camera and the check around a position', () => {
    const cams = [
      { id: 'a', s: 1000, at: at(1000), limit: 90 },
      { id: 'b', s: 3000, at: at(3000), limit: null },
    ];
    expect(cameraAhead(cams, 400, 800)?.cam.id).toBe('a');
    expect(cameraAhead(cams, 100, 800)).toBeNull();
    expect(cameraAhead(cams, 1005, 800)?.cam.id).toBe('a');
    expect(cameraAhead(cams, 1020, 800)).toBeNull();
    const checks = [{ id: 'c', s0: 2000, s1: 4000, limit: 110 }];
    expect(checkAt(checks, 1500, 1000)).toMatchObject({ inside: false, dist: 500 });
    expect(checkAt(checks, 2500, 1000)).toMatchObject({ inside: true, dist: 1500 });
    expect(checkAt(checks, 4100, 1000)).toBeNull();
  });
});

/* ------------------------------------------------------------------ Overpass */

describe('the Overpass lookup', () => {
  afterEach(() => vi.unstubAllGlobals());

  const answer: Parameters<typeof parseSpeedAnswer>[0] = {
    elements: [
      { type: 'node', id: 9, lat: 3.1, lon: 101.62, tags: { barrier: 'toll_booth', name: 'Plaza Tol Ujian' } },
      { type: 'way', id: 1, tags: { highway: 'motorway', maxspeed: '110', oneway: 'yes' }, geometry: [{ lat: 3.1, lon: 101.6 }, { lat: 3.1, lon: 101.61 }, null, { lat: 3.1, lon: 101.63 }, { lat: 3.1, lon: 101.64 }] },
      { type: 'node', id: 5, lat: 3.1, lon: 101.605, tags: { highway: 'speed_camera', maxspeed: '110' } },
      { type: 'way', id: 2, tags: { highway: 'motorway', oneway: 'yes' }, nodes: [4, 5, 6], geometry: [{ lat: 3.1, lon: 101.6 }, { lat: 3.1, lon: 101.605 }, { lat: 3.1, lon: 101.61 }] },
      { type: 'relation', id: 7, tags: { type: 'enforcement', enforcement: 'average_speed', maxspeed: '110' }, members: [{ type: 'node', ref: 20, role: 'from' }, { type: 'node', ref: 21, role: 'to' }, { type: 'node', ref: 22, role: 'device' }] },
      { type: 'node', id: 20, lat: 3.1, lon: 101.61 },
      { type: 'node', id: 21, lat: 3.1, lon: 101.63 },
      { type: 'node', id: 22, lat: 3.1, lon: 101.63 },
    ],
  };

  it('asks for toll booths, roads with limits, cameras with their roads and enforcement relations', () => {
    const q = buildRoadsAheadQuery([at(0), at(1000)]);
    expect(q).toContain('"barrier"="toll_booth"');
    expect(q).toMatch(/way\(around:15,[\d.,]+\)\["highway"\]\[~"\^maxspeed/);
    expect(q).toContain('"highway"="speed_camera"');
    expect(q).toContain('way(bn.cam)');
    expect(q).toContain('"type"="enforcement"');
  });

  it('reads the answer: roads (cut where the answer was clipped), cameras on their roads, checks', () => {
    const d = parseSpeedAnswer(answer);
    expect(d.ways.map((w) => [w.id, w.coords.length])).toEqual([
      ['w1', 2],
      ['w1-1', 2],
    ]);
    expect(d.cameras).toHaveLength(1);
    expect(d.cameras[0].road?.oneway).toBe(1);
    expect(d.cameras[0].tags.maxspeed).toBe('110');
    expect(d.checks).toHaveLength(1);
    expect(d.checks[0].from).toHaveLength(1);
    expect(d.checks[0].to).toHaveLength(1);
    expect(d.checks[0].devices).toHaveLength(1);
  });

  it('answers the toll lookup and the speed lookup for a stretch with one request', async () => {
    const fetched = vi.fn(async () => new Response(JSON.stringify(answer), { status: 200 }));
    vi.stubGlobal('fetch', fetched);
    const ahead = new OverpassRoadsAhead(() => ['https://overpass.test/api']);
    const path = [at(0), at(4000)];
    const [tolls, speed] = await Promise.all([ahead.tolls.fetch(path), ahead.speed.fetch(path)]);
    expect(fetched).toHaveBeenCalledTimes(1);
    expect(tolls.map((t) => t.name)).toEqual(['Plaza Tol Ujian']);
    expect(speed.cameras).toHaveLength(1);
    // Another stretch is another request; one asker giving up does not cancel the other's.
    const ctrl = new AbortController();
    const p = ahead.tolls.fetch([at(4000), at(8000)], ctrl.signal);
    const q = ahead.speed.fetch([at(4000), at(8000)]);
    ctrl.abort();
    await expect(p).rejects.toMatchObject({ name: 'AbortError' });
    expect((await q).ways.length).toBe(2);
    expect(fetched).toHaveBeenCalledTimes(2);
  });

  it('tries the next server when one fails', async () => {
    const fetched = vi.fn(async (url: string) => (url.includes('first') ? new Response('busy', { status: 429 }) : new Response(JSON.stringify(answer), { status: 200 })));
    vi.stubGlobal('fetch', fetched);
    const ahead = new OverpassRoadsAhead(() => ['https://first.test/api', 'https://second.test/api']);
    expect((await ahead.speed.fetch([at(0), at(100)])).cameras).toHaveLength(1);
    expect(fetched).toHaveBeenCalledTimes(2);
  });
});

/* ------------------------------------------------------------------ along the drive */

describe('speed data along the drive', () => {
  it('loads the stretch ahead and the next one, once each', async () => {
    const r = road(45_000, [], 27, ['motorway']);
    const asked: number[] = [];
    let info: SpeedInfo | null = null;
    const loader = new SpeedLoader(
      {
        fetch: async (path) => {
          asked.push(Math.round((path[0][0] - O[0]) * M_PER_DEG));
          return { ways: [way('w', [path[0], path[path.length - 1]], { maxspeed: '90' })], cameras: [], checks: [] };
        },
      },
      (i) => (info = i),
    );
    loader.setRoute(r);
    // Before anything is loaded: the national limit on the expressway.
    expect(spans(info!.limits)).toEqual([[0, 45_000, 110, 'national']]);
    loader.ensure(100);
    loader.ensure(5000);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(asked).toEqual([0, 19_950]);
    expect(limitAt(info!.limits, 10_000)).toMatchObject({ kmh: 90, src: 'osm' });
    expect(limitAt(info!.limits, 41_000)).toMatchObject({ kmh: 110, src: 'national' });
    loader.ensure(21_000);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(asked).toEqual([0, 19_950, 39_950]);
    expect(limitAt(info!.limits, 41_000)).toMatchObject({ kmh: 90, src: 'osm' });
  });

  it('gives the demo drive its limits, a camera and an average speed check', async () => {
    const demo = buildDemo();
    const route = (await new DemoRouter().route({ origin: demo.start, destination: demo.end })).routes[0];
    let info: SpeedInfo | null = null;
    const loader = new SpeedLoader(new DemoSpeedProvider(), (i) => (info = i));
    loader.setRoute(route);
    loader.ensure(0);
    await new Promise((ok) => setTimeout(ok, 0));
    expect(info!.limits.map((l) => l.kmh)).toEqual([80, 60, 110, 90, 60]);
    expect(info!.cameras).toHaveLength(1);
    expect(info!.cameras[0].limit).toBe(90);
    expect(limitAt(info!.limits, info!.cameras[0].s)?.kmh).toBe(90);
    expect(info!.checks).toHaveLength(1);
    expect(limitAt(info!.limits, info!.checks[0].s0 + 10)?.kmh).toBe(110);
  });
});

/* ------------------------------------------------------------------ the warnings */

describe('speed warnings', () => {
  const LIMITS: LimitSpan[] = [
    { s0: 0, s1: 10_000, kmh: 110, src: 'osm' },
    { s0: 10_000, s1: 20_000, kmh: 90, src: 'osm' },
  ];

  /** Runs the watch over a list of [seconds, km/h] steps from position `s`, returning what was said and when. */
  function run(w: SpeedWatch, steps: [number, number][], s = 1000, fast = true) {
    const said: { t: number; p: SpeedPrompt; state: string }[] = [];
    let t = 0;
    for (const [secs, kmh] of steps) {
      for (let k = 0; k < secs * 2; k++) {
        const st = w.update(s, kmh / 3.6, t * 1000, fast);
        for (const p of w.prompts(st, s, t * 1000, fast)) said.push({ t, p, state: st.speeding });
        s += (kmh / 3.6) * 0.5;
        t += 0.5;
      }
    }
    return said;
  }
  const watch = (extra: Partial<SpeedInfo> = {}) => {
    const w = new SpeedWatch();
    w.info = { limits: LIMITS, cameras: [], checks: [], ...extra };
    return w;
  };

  it('says once that the limit is near, and again only after the speed has been well below it', () => {
    const said = run(watch(), [
      [10, 95],
      [20, 106],
      [5, 100],
      [20, 106],
      [30, 95],
      [10, 107],
    ]);
    expect(said.map((x) => [x.p.kind, x.p.limit, x.t])).toEqual([
      ['speedNear', 110, 10],
      ['speedNear', 110, 85],
    ]);
  });

  it('warns over the limit after a moment, again every 30 seconds, four times at most', () => {
    const said = run(watch(), [
      [5, 100],
      [150, 116],
    ]);
    expect(said.map((x) => x.p.kind)).toEqual(['speedOver', 'speedOver', 'speedOver', 'speedOver']);
    expect(said.map((x) => x.t)).toEqual([6.5, 36.5, 66.5, 96.5]);
    // Straight past the limit: no "approaching" first.
    expect(said.every((x) => x.p.limit === 110)).toBe(true);
  });

  it('does not count a blip over the limit', () => {
    const said = run(watch(), [
      [5, 100],
      [1, 112],
      [20, 100],
    ]);
    expect(said.map((x) => x.p.kind)).toEqual([]);
  });

  it('starts over on a new limit', () => {
    // 105 km/h: fine in the 110 stretch, over the limit once the 90 stretch begins.
    const said = run(watch(), [[60, 105]], 9000);
    const over = said.filter((x) => x.p.kind === 'speedOver');
    expect(said[0].p).toMatchObject({ kind: 'speedNear', limit: 110 });
    expect(over[0].p.limit).toBe(90);
  });

  it('announces a speed camera 800 m ahead on fast roads, 300 m in town, with its limit', () => {
    const cameras = [{ id: 'c', s: 3000, at: at(3000), limit: 110 }];
    const fast = run(watch({ cameras }), [[60, 100]]);
    const cam = fast.find((x) => x.p.kind === 'camera')!;
    expect(cam.p.limit).toBe(110);
    expect(cam.p.dist).toBeGreaterThan(780);
    expect(cam.p.dist).toBeLessThanOrEqual(800);
    expect(cam.p.over).toBe(false);
    expect(fast.filter((x) => x.p.kind === 'camera')).toHaveLength(1);
    const town = run(watch({ cameras }), [[200, 45]], 1000, false);
    expect(town.find((x) => x.p.kind === 'camera')!.p.dist).toBeLessThanOrEqual(300);
  });

  it('says "slow down" with the camera when over the limit, and once more close to it if still over', () => {
    const cameras = [{ id: 'c', s: 3000, at: at(3000), limit: 110 }];
    // Over the limit all the way in.
    const all = run(watch({ cameras }), [[70, 118]]);
    const kinds = all.map((x) => x.p.kind);
    expect(all.find((x) => x.p.kind === 'camera')!.p.over).toBe(true);
    expect(kinds.filter((k) => k === 'cameraOver')).toHaveLength(0);
    // Under it at the announcement, over it by the time the camera is 300 m ahead.
    const late = run(watch({ cameras }), [
      [43, 100],
      [20, 118],
    ]);
    expect(late.find((x) => x.p.kind === 'camera')!.p.over).toBe(false);
    const again = late.find((x) => x.p.kind === 'cameraOver')!;
    expect(again.p.dist).toBeLessThanOrEqual(300);
    // The camera's own warning stands for the plain over-speed one at that moment.
    expect(late.filter((x) => x.t === again.t).map((x) => x.p.kind)).toEqual(['cameraOver']);
  });

  it('follows an average speed check from start to end, with the average so far', () => {
    const w = watch({ checks: [{ id: 'k', s0: 2000, s1: 5000, limit: 110 }] });
    const said = run(w, [[150, 100]]);
    expect(said.map((x) => x.p.kind)).toEqual(['checkStart', 'checkEnd']);
    expect(said[0].p).toMatchObject({ limit: 110, dist: 3000 });
    const mid = new SpeedWatch();
    mid.info = { limits: LIMITS, cameras: [], checks: [{ id: 'k', s0: 2000, s1: 5000, limit: 110 }] };
    let st = mid.update(2000, 30, 0, true);
    expect(st.check).toMatchObject({ inside: true, average: null });
    st = mid.update(2300, 30, 10_000, true);
    expect(st.check!.average).toBeCloseTo(108, 0);
    // Half a minute at a standstill in the check brings the average down.
    st = mid.update(2300, 0, 40_000, true);
    expect(st.check!.average).toBeCloseTo((300 / 40) * 3.6, 0);
    // A simulated drive at eight times the speed still shows the speed driven, not eight times it.
    const sim = new SpeedWatch();
    sim.info = mid.info;
    let t = 0;
    for (let s = 2000; s <= 3000; s += 25) st = sim.update(s, 25, (t += 125), true);
    expect(st.check!.average).toBeCloseTo(90, 0);
  });

  it('shows without sounding when set to the sign only, and knows no limit when off', () => {
    const sign = watch();
    sign.mode = 'sign';
    expect(run(sign, [[20, 118]])).toEqual([]);
    expect(sign.update(1000, 33, 99_000, true)).toMatchObject({ limit: { kmh: 110 }, speeding: 'over' });
    const off = watch({ cameras: [{ id: 'c', s: 1500, at: at(1500), limit: 110 }] });
    off.mode = 'off';
    const st = off.update(1000, 33, 0, true);
    expect(st.limit).toBeNull();
    expect(st.speeding).toBe('ok');
    // Camera warnings are their own setting.
    expect(st.camera?.cam.id).toBe('c');
    off.cameras = false;
    expect(off.update(1000, 33, 500, true).camera).toBeNull();
  });

  it('uses the margin from Settings', () => {
    const w = watch();
    w.margin = 10;
    expect(w.update(1000, 101 / 3.6, 0, true).speeding).toBe('near');
    w.margin = 3;
    expect(new SpeedWatch().update(0, 10, 0, true).speeding).toBe('ok');
    const w3 = watch();
    w3.margin = 3;
    expect(w3.update(1000, 105 / 3.6, 0, true).speeding).toBe('ok');
    expect(w3.update(1000, 108 / 3.6, 500, true).speeding).toBe('near');
  });
});

describe('speed warnings in the drive', () => {
  it('come from the engine as prompts, and the limit rides on the progress', async () => {
    const r = road(6000, [], 30, ['motorway']);
    const eng = new NavEngine();
    eng.setRoute(r, []);
    eng.setSpeedInfo({ limits: [{ s0: 0, s1: 6000, kmh: 110, src: 'national' }], cameras: [{ id: 'cam:x', s: 3000, at: at(3000), limit: null }], checks: [] });
    const said: Prompt[] = [];
    let time = 1_000_000;
    let lastLimit: number | null = null;
    for (let s = 0; s <= 5000; s += 15) {
      const speed = s < 1000 ? 27 : 32; // 97 km/h, then 115
      const p = eng.update({ lngLat: r.line.pointAt(s), accuracy: 5, heading: 90, speed, time });
      time += (15 / speed) * 1000;
      if (!p) continue;
      lastLimit = p.speedo.limit?.kmh ?? null;
      said.push(...eng.prompts(p).filter((x) => x.kind === 'speed'));
    }
    expect(lastLimit).toBe(110);
    expect(said.map((x) => x.speed!.kind).slice(0, 2)).toEqual(['speedOver', 'speedOver']);
    const cam = said.find((x) => x.speed!.kind === 'camera')!;
    // The camera has no limit of its own: the road's is said.
    expect(cam.speed).toMatchObject({ limit: 110, over: true });
    expect(speedSpeech(cam.speed!, 'en', 'metric')).toMatch(/^Speed camera in \d+ metres\. Speed limit 110\. Slow down\.$/);
  });

  it('keep the settings across a new route', () => {
    const eng = new NavEngine();
    eng.speed.mode = 'tone';
    eng.speed.margin = 10;
    eng.speed.cameras = false;
    eng.setRoute(road(1000), []);
    expect(eng.speed).toMatchObject({ mode: 'tone', margin: 10, cameras: false });
    expect(eng.speed.info.limits).toEqual([]);
  });
});

describe('what the warnings say', () => {
  const p = (kind: SpeedPrompt['kind'], extra: Partial<SpeedPrompt> = {}): SpeedPrompt => ({ kind, key: 'k', limit: 110, ...extra });

  it('in English, Malay and Japanese', () => {
    expect(speedSpeech(p('speedNear'), 'en', 'metric')).toBe('Approaching the speed limit of 110.');
    expect(speedSpeech(p('speedOver'), 'en', 'metric')).toBe('Slow down. The speed limit is 110.');
    expect(speedSpeech(p('camera', { dist: 800 }), 'en', 'metric')).toBe('Speed camera in 800 metres. Speed limit 110.');
    expect(speedSpeech(p('cameraOver', { dist: 250 }), 'en', 'metric')).toBe('Speed camera ahead. Slow down.');
    expect(speedSpeech(p('checkStart', { dist: 12_000 }), 'en', 'metric')).toBe('Average speed check for 12 kilometres. Speed limit 110.');
    expect(speedSpeech(p('checkEnd', { limit: null }), 'en', 'metric')).toBe('End of the average speed check.');
    expect(speedSpeech(p('speedNear'), 'ms', 'metric')).toBe('Hampir mencapai had laju 110.');
    expect(speedSpeech(p('speedOver'), 'ms', 'metric')).toBe('Sila perlahankan. Had laju 110.');
    expect(speedSpeech(p('camera', { dist: 800, over: true }), 'ms', 'metric')).toBe('Kamera had laju dalam 800 meter. Had laju 110. Sila perlahankan.');
    expect(speedSpeech(p('speedOver'), 'ja', 'metric')).toBe('速度超過です。制限速度は110キロです。');
    expect(speedSpeech(p('camera', { dist: 800 }), 'ja', 'metric')).toMatch(/先、速度取締機があります。制限速度は110キロです。$/);
  });

  it('in miles per hour when the units are miles, and without a limit when none is known', () => {
    expect(speedSpeech(p('speedOver'), 'en', 'imperial')).toBe('Slow down. The speed limit is 68.');
    expect(speedSpeech(p('camera', { dist: 800, limit: null }), 'en', 'metric')).toBe('Speed camera in 800 metres.');
    expect(speedWords('ms').camera).toBe('Kamera had laju');
    expect(speedWords('en').average).toBe('Average speed');
    expect(speedWords('ja').limit).toBe('制限速度');
  });
});

describe('the simulator’s speeding driver', () => {
  it('drives below, near and over the limit in turn, and at the router’s speed without a limit', () => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal('window', globalThis);
      const r = road(12_000, [], 25);
      const sim = new Simulator(r, 1);
      const fixes: { s: number; kmh: number }[] = [];
      let now = 0;
      vi.spyOn(performance, 'now').mockImplementation(() => now);
      sim.start((f) => fixes.push({ s: sim.s, kmh: (f.speed ?? 0) * 3.6 }));
      const step = () => {
        now += 400;
        vi.advanceTimersByTime(100);
      };
      for (let i = 0; i < 60; i++) step();
      // No limit known: the router's speed (25 m/s).
      expect(fixes[fixes.length - 1].kmh).toBeCloseTo(90, 0);
      sim.limitAt = () => 110;
      sim.speeding = true;
      fixes.length = 0;
      for (let i = 0; i < 700 && sim.s < 11_000; i++) step();
      const max = Math.max(...fixes.map((f) => f.kmh));
      const min = Math.min(...fixes.slice(40).map((f) => f.kmh));
      expect(max).toBeGreaterThan(114);
      expect(max).toBeLessThan(119);
      expect(min).toBeLessThan(100);
      // No jumps: it speeds up and slows down gradually.
      for (let i = 1; i < fixes.length; i++) expect(Math.abs(fixes[i].kmh - fixes[i - 1].kmh)).toBeLessThan(8);
      sim.stop();
    } finally {
      vi.useRealTimers();
      vi.restoreAllMocks();
      vi.unstubAllGlobals();
    }
  });
});
