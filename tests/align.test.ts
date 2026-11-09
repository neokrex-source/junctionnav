import { describe, expect, it } from 'vitest';
import { bearing, haversine, LocalFrame, Polyline, type LngLat, type XY } from '../src/geo/geo';
import { alignLine, alignRoute, positionMap, type RoadSeg, type RoadSet } from '../src/routing/align';
import { RouteAligner } from '../src/routing/aligner';
import type { RoadTiles } from '../src/map/roadTiles';
import type { Route, Step } from '../src/routing/types';

const F = new LocalFrame([101.6869, 3.139]);
const ll = (p: XY): LngLat => F.toLngLat(p[0], p[1]);
const xy = (p: LngLat): XY => F.toXY(p);

interface Road {
  pts: XY[];
  cls?: string;
  oneway?: -1 | 0 | 1;
  tunnel?: boolean;
  ramp?: boolean;
}

/** Roads given in metres east/north of central KL. `missing` areas answer "not loaded". */
class FakeRoads implements RoadSet {
  segs: RoadSeg[] = [];
  lines = new Map<number, RoadSeg[]>();
  constructor(
    roads: Road[],
    private missing: (p: XY) => boolean = () => false,
  ) {
    roads.forEach((r, id) => {
      const list: RoadSeg[] = [];
      let m = 0;
      for (let i = 0; i + 1 < r.pts.length; i++) {
        const a = ll(r.pts[i]);
        const b = ll(r.pts[i + 1]);
        const len = haversine(a, b);
        const seg: RoadSeg = { line: id + 1, i, a, b, m, len, brg: bearing(a, b), cls: r.cls ?? 'primary', ramp: !!r.ramp, oneway: r.oneway ?? 0, tunnel: !!r.tunnel };
        list.push(seg);
        this.segs.push(seg);
        m += len;
      }
      this.lines.set(id + 1, list);
    });
  }
  near(p: LngLat, r: number): RoadSeg[] | null {
    const q = xy(p);
    if (this.missing(q)) return null;
    return this.segs.filter((s) => {
      const a = xy(s.a);
      const b = xy(s.b);
      return Math.min(a[0], b[0]) - r <= q[0] && q[0] <= Math.max(a[0], b[0]) + r && Math.min(a[1], b[1]) - r <= q[1] && q[1] <= Math.max(a[1], b[1]) + r;
    });
  }
  line(id: number) {
    return this.lines.get(id);
  }
}

/** Distance from a point to a polyline in metres. */
function distTo(p: LngLat, line: XY[]): number {
  return new Polyline(line.map(ll)).project(p).dist;
}

/** Points along a polyline every `step` metres (a router's line). */
function dense(pts: XY[], step = 10): XY[] {
  const out: XY[] = [];
  for (let i = 0; i + 1 < pts.length; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let j = 0; j < n; j++) out.push([ax + ((bx - ax) * j) / n, ay + ((by - ay) * j) / n]);
  }
  out.push(pts[pts.length - 1]);
  return out;
}

const shift = (pts: XY[], dx: number, dy: number): XY[] => pts.map(([x, y]) => [x + dx, y + dy]);

describe('lining a route up with the map', () => {
  it('moves a route running beside its road onto it', async () => {
    const road: XY[] = [
      [0, 0],
      [1000, 0],
    ];
    const roads = new FakeRoads([{ pts: road }]);
    const route = shift(dense(road), 0, 7).map(ll);
    const res = (await alignLine(route, roads))!;
    expect(res.matched).toBeGreaterThan(0.99);
    for (const p of res.coords) expect(distTo(p, road)).toBeLessThan(0.3);
    expect(res.maxMove).toBeGreaterThan(6.5);
    // A straight road needs few points.
    expect(res.coords.length).toBeLessThanOrEqual(route.length);
  });

  it('keeps to its own side of a dual carriageway', async () => {
    // Eastbound on the south carriageway (driving on the left), westbound on the north one, 14 m apart.
    const east: XY[] = [
      [0, 0],
      [800, 0],
    ];
    const west: XY[] = [
      [800, 14],
      [0, 14],
    ];
    const roads = new FakeRoads([
      { pts: east, oneway: 1, cls: 'motorway' },
      { pts: west, oneway: 1, cls: 'motorway' },
    ]);
    // Drawn 9 m north of its carriageway: nearer the other one, which goes the other way.
    const res = (await alignLine(shift(dense(east), 0, 9).map(ll), roads))!;
    for (const p of res.coords) expect(distTo(p, east)).toBeLessThan(0.3);
  });

  it('does not hop to a road alongside for a few steps', async () => {
    const main: XY[] = [
      [0, 0],
      [1200, 0],
    ];
    // A service road 9 m north for 120 m in the middle.
    const side: XY[] = [
      [500, 9],
      [620, 9],
    ];
    const roads = new FakeRoads([{ pts: main, cls: 'trunk' }, { pts: side, cls: 'service' }]);
    // The router's line wanders up to 5.5 m north there: nearer the service road for a bit.
    const route = dense(main, 8).map(([x, y]): XY => [x, y + (x > 480 && x < 640 ? 5.5 : 1)]);
    const res = (await alignLine(route.map(ll), roads))!;
    for (const p of res.coords) expect(distTo(p, main)).toBeLessThan(0.3);
  });

  it('leaves the main road where the map has the ramp leaving it', async () => {
    const main: XY[] = [
      [0, 0],
      [800, 0],
    ];
    // The ramp leaves at x = 300 and curves away south.
    const ramp: XY[] = [[300, 0]];
    for (let k = 1; k <= 20; k++) ramp.push([300 + k * 12, -0.12 * (k * 12) ** 1.35 * 0.35]);
    const roads = new FakeRoads([
      { pts: main, oneway: 1, cls: 'motorway' },
      { pts: ramp, oneway: 1, cls: 'motorway', ramp: true },
    ]);
    // The router splits 35 m early and runs 3 m off the map's lines.
    const routeXY: XY[] = [];
    for (const p of dense(main.map(([x]): XY => [Math.min(x, 265), 0]), 10)) routeXY.push([p[0], p[1] + 3]);
    // Its ramp comes back onto the map's ramp over the next 120 m.
    for (const p of dense(ramp, 10).slice(1)) {
      const f = Math.max(0, 1 - (p[0] - 300) / 120);
      routeXY.push([p[0] - 35 * f, p[1] + 3 * f - 2]);
    }
    const res = (await alignLine(routeXY.map(ll), roads))!;
    // Through the split point, on the main road before it and on the ramp after it.
    const split = ll([300, 0]);
    expect(Math.min(...res.coords.map((p) => haversine(p, split)))).toBeLessThan(0.6);
    for (const p of res.coords) {
      const [x] = xy(p);
      if (x < 299) expect(distTo(p, main)).toBeLessThan(0.3);
      else if (x > 302) expect(distTo(p, ramp)).toBeLessThan(0.3);
    }
  });

  it('turns at the crossing the map has', async () => {
    const a: XY[] = [
      [0, 0],
      [400, 0],
    ];
    const b: XY[] = [
      [400, 0],
      [400, 400],
    ];
    const roads = new FakeRoads([{ pts: a }, { pts: b }]);
    // The router turns 6 m early, cutting the corner, and runs 4 m off.
    const route: XY[] = [...dense([[0, 4], [394, 4]]), ...dense([[396, 10], [396, 400]]).slice(0)];
    const res = (await alignLine(route.map(ll), roads))!;
    const corner = ll([400, 0]);
    expect(Math.min(...res.coords.map((p) => haversine(p, corner)))).toBeLessThan(0.6);
    for (const p of res.coords) expect(Math.min(distTo(p, a), distTo(p, b))).toBeLessThan(0.3);
  });

  it('leaves a road the map does not have where the router drew it', async () => {
    const road: XY[] = [
      [0, 0],
      [300, 0],
    ];
    const road2: XY[] = [
      [700, 0],
      [1000, 0],
    ];
    const roads = new FakeRoads([{ pts: road }, { pts: road2 }]);
    // A new road from 300 to 700 m, not on the map yet (runs 40 m north of where a road would be).
    const route: XY[] = [...dense([[0, 3], [300, 3]]), ...dense([[340, 40], [660, 40]]), ...dense([[700, 3], [1000, 3]])];
    const res = (await alignLine(route.map(ll), roads))!;
    const mid = res.coords.filter((p) => xy(p)[0] > 360 && xy(p)[0] < 640);
    expect(mid.length).toBeGreaterThan(0);
    for (const p of mid) expect(Math.abs(xy(p)[1] - 40)).toBeLessThan(0.01);
    expect(res.matched).toBeLessThan(0.8);
  });

  it('keeps stretches whose roads are not loaded and says so', async () => {
    const road: XY[] = [
      [0, 0],
      [1000, 0],
    ];
    const roads = new FakeRoads([{ pts: road }], ([x]) => x > 600);
    const res = (await alignLine(shift(dense(road), 0, 5).map(ll), roads))!;
    expect(res.unknown).toBeGreaterThan(0.3);
    for (const p of res.coords) {
      const [x, y] = xy(p);
      if (x < 590) expect(Math.abs(y)).toBeLessThan(0.3);
      if (x > 610) expect(Math.abs(y - 5)).toBeLessThan(0.01);
    }
  });

  it('prefers the tunnel where the router says tunnel', async () => {
    const surface: XY[] = [
      [0, 3],
      [600, 3],
    ];
    const tunnel: XY[] = [
      [0, -3],
      [600, -3],
    ];
    const roads = new FakeRoads([{ pts: surface }, { pts: tunnel, tunnel: true }]);
    const route = dense([[0, 1.5], [600, 1.5]]).map(ll);
    const res = (await alignLine(route, roads, { kindAt: () => ({ motorway: false, tunnel: true, ferry: false }) }))!;
    for (const p of res.coords) expect(distTo(p, tunnel)).toBeLessThan(0.3);
  });

  it('maps positions along the old line to the new one', () => {
    const map = positionMap([0, 10, NaN, 20, 30], [0, 12, 14, 24, 33], 30, 33);
    expect(map(0)).toBe(0);
    expect(map(5)).toBeCloseTo(6);
    expect(map(15)).toBeCloseTo(18);
    expect(map(30)).toBe(33);
    expect(map(40)).toBe(33);
  });
});

describe('a route lined up with the map', () => {
  function route(pts: XY[]): Route {
    const geometry = pts.map(ll);
    const line = new Polyline(geometry);
    const step = (s: number, type: Step['type']): Step => ({
      index: 0,
      type,
      location: line.pointAt(s),
      bearingBefore: 90,
      bearingAfter: 90,
      name: 'Jalan Test',
      drivingSide: 'left',
      distance: 0,
      duration: 0,
      intersections: [{ location: line.pointAt(s), bearings: [270, 90], entry: [false, true], classes: [] }],
      s,
    });
    const steps = [step(0, 'depart'), step(500, 'turn'), step(line.length, 'arrive')].map((st, i) => ({ ...st, index: i }));
    return {
      id: 't1',
      geometry,
      line,
      distance: line.length,
      duration: 100,
      steps,
      summary: 'Jalan Test',
      hasToll: false,
      hasMotorway: false,
      hasFerry: false,
      tollDistance: 0,
      motorwayDistance: 0,
      ferryDistance: 0,
      legs: [{ distance: line.length, duration: 100, endS: line.length }],
      label: 'fastest',
      avoidApplied: [],
      provider: 'TomTom',
      tollGates: [{ s: 800, at: line.pointAt(800) }],
    };
  }

  it('moves the maneuvers, legs and toll gates with it', async () => {
    const road: XY[] = [
      [0, 0],
      [1000, 0],
    ];
    const r = route(shift(dense(road), 0, 6));
    const a = (await alignRoute(r, new FakeRoads([{ pts: road }])))!;
    expect(a.aligned).toBe('full');
    expect(a.id).toBe(r.id);
    expect(a.legs[0].endS).toBeCloseTo(a.line.length, 6);
    expect(a.steps[2].s).toBeCloseTo(a.line.length, 6);
    // The turn is still 500 m along, now on the road.
    expect(a.steps[1].s).toBeCloseTo(500, 0);
    expect(distTo(a.steps[1].location, road)).toBeLessThan(0.3);
    expect(a.tollGates![0].s).toBeCloseTo(800, 0);
    expect(distTo(a.tollGates![0].at, road)).toBeLessThan(0.3);
    // Unchanged otherwise.
    expect(r.geometry[0][1]).not.toBe(a.geometry[0][1]);
    expect(a.summary).toBe('Jalan Test');
  });

  it('comes back partial when roads are missing, null when there are none', async () => {
    const road: XY[] = [
      [0, 0],
      [1000, 0],
    ];
    const r = route(shift(dense(road), 0, 6));
    const half = await alignRoute(r, new FakeRoads([{ pts: road }], ([x]) => x > 500));
    expect(half?.aligned).toBe('partial');
    expect(await alignRoute(r, new FakeRoads([{ pts: road }], () => true))).toBeNull();
  });
});

describe('the aligner', () => {
  const road: XY[] = [
    [0, 0],
    [1000, 0],
  ];
  function plain(): Route {
    const geometry = shift(dense(road), 0, 6).map(ll);
    const line = new Polyline(geometry);
    const st = (s: number, type: Step['type'], index: number): Step => ({
      index,
      type,
      location: line.pointAt(s),
      bearingBefore: 90,
      bearingAfter: 90,
      name: '',
      drivingSide: 'left',
      distance: 0,
      duration: 0,
      intersections: [{ location: line.pointAt(s), bearings: [], entry: [], classes: [] }],
      s,
    });
    return {
      id: 't9',
      geometry,
      line,
      distance: line.length,
      duration: 90,
      steps: [st(0, 'depart', 0), st(line.length, 'arrive', 1)],
      summary: '',
      hasToll: false,
      hasMotorway: false,
      hasFerry: false,
      tollDistance: 0,
      motorwayDistance: 0,
      ferryDistance: 0,
      legs: [{ distance: line.length, duration: 90, endS: line.length }],
      label: 'fastest',
      avoidApplied: [],
      provider: 'TomTom',
    };
  }

  /** Roads that come in when asked a second time (the far tile was late). */
  function lateRoads() {
    let late = true;
    let asked = 0;
    const roads = new FakeRoads([{ pts: road }], ([x]) => late && x > 600);
    const tiles = {
      keysFor: () => ['14/1/1'],
      // The first wait runs out before the far tile; the second one gets it.
      load: async () => {
        if (++asked < 2) return false;
        late = false;
        return true;
      },
      near: (p: LngLat, r: number) => roads.near(p, r),
      line: (id: number) => roads.line(id),
    };
    return tiles as unknown as RoadTiles;
  }

  it('lines routes up and remembers which still wait for road tiles', async () => {
    const al = new RouteAligner(lateRoads());
    const raw = plain();
    const [first] = await al.align([raw]);
    expect(first).not.toBe(raw);
    expect(first.aligned).toBe('partial');
    expect(al.pending(first)).toBe(true);
    // The rest, once the tiles are in: from the router's own route, all of it on the road.
    const full = await al.complete(first);
    expect(full?.aligned).toBe('full');
    for (const p of full!.geometry) expect(distTo(p, road)).toBeLessThan(0.3);
    // Asked again: the same answer, not a second piece of work.
    expect(await al.complete(first)).toBe(full);
    expect(al.pending(full!)).toBe(false);
  });

  it('hands routes back unchanged when no roads come', async () => {
    const tiles = { keysFor: () => [], load: async () => false, near: () => null, line: () => undefined } as unknown as RoadTiles;
    const raw = plain();
    const [r] = await new RouteAligner(tiles).align([raw]);
    expect(r).toBe(raw);
  });

  it('gives up when the request is called off', async () => {
    const tiles = { keysFor: () => ['k'], load: (_k: string[], _b: number, signal?: AbortSignal) => new Promise((_, no) => signal?.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError')))), near: () => null, line: () => undefined } as unknown as RoadTiles;
    const ctrl = new AbortController();
    const p = new RouteAligner(tiles).align([plain()], ctrl.signal);
    ctrl.abort();
    await expect(p).rejects.toThrow(/Abort/);
  });
});
