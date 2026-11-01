import { describe, expect, it } from 'vitest';
import { buildDemo, DEMO_ORIGIN } from '../src/demo/network';
import { haversine, LocalFrame } from '../src/geo/geo';
import { tunnelsFromRoute } from '../src/nav/tunnels';
import { OfflineGraph } from '../src/offline/graph';
import { PlaceIndex } from '../src/offline/places';
import { kindsOf } from '../src/offline/providers';
import { junctionData, roadWays, tunnelWays } from '../src/offline/queries';
import { parseTripLink, resolveTrip } from '../src/trip/tripLink';
import { OfflineRouter } from '../src/offline/router';
import { normalizeOsrm, type OsrmResponse } from '../src/routing/osrm';
import { CATEGORIES } from '../src/search/categories';
import { detectJunctions } from '../src/junction/detect';
import { buildScene } from '../src/junction/scene';
import { demoPack, gridPack } from './offlineFixture';

const demo = buildDemo();
const frame = new LocalFrame(DEMO_ORIGIN);
const graph = () => new OfflineGraph(demoPack().graph);
const routeOf = (json: OsrmResponse) => normalizeOsrm(json, 'Offline')[0];

describe('offline road graph', () => {
  it('builds from OSM roads with the pack scripts', () => {
    const G = graph();
    expect(G.h.nS).toBeGreaterThan(20);
    expect(G.h.drivingSide).toBe('left');
    expect(G.h.nJunc).toBe(1);
    const j = G.junctionAt(G.jV[0]);
    expect(j).toEqual({ ref: '114', name: 'Sungai Buloh' });
  });

  it('snaps to the carriageway going the right way', () => {
    const G = graph();
    // 9 m from the southbound carriageway (x = 14) but heading north: the northbound one (x = 0) wins.
    const p = frame.toLngLat(9, -1000);
    const north = G.snap(p, 0)!;
    const south = G.snap(p, 180)!;
    expect(frame.toXY(north.point)[0]).toBeCloseTo(0, 0);
    expect(frame.toXY(south.point)[0]).toBeCloseTo(14, 0);
    expect(G.snap(p)!.dist).toBeLessThan(6);
  });
});

describe('offline routing', () => {
  const reference = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
  const json = () => new OfflineRouter(graph()).route({ coords: [demo.start, demo.end], bearings: [0, null] });

  it('finds the same route as the reference with the same maneuvers', () => {
    const r = routeOf(json());
    expect(Math.abs(r.distance - reference.distance)).toBeLessThan(reference.distance * 0.01);
    const kinds = (steps: typeof r.steps) => steps.map((s) => `${s.type}/${s.modifier ?? ''}`);
    expect(kinds(r.steps)).toEqual(kinds(reference.steps));
    r.steps.forEach((s, i) => expect(Math.abs(s.s - reference.steps[i].s)).toBeLessThan(15));
  });

  it('reads exits, destinations and lanes from OSM tags', () => {
    const r = routeOf(json());
    const off = r.steps.find((s) => s.type === 'off ramp')!;
    expect(off.exits).toBe('114');
    expect(off.destinations).toBe('B27: Sungai Buloh, Kuala Selangor');
    const onRamp = r.steps.find((s) => s.type === 'on ramp')!;
    expect(onRamp.destinations).toBe('E1: Kuala Lumpur, Ipoh');
    const fork = r.steps.find((s) => s.type === 'fork')!;
    const lanes = fork.intersections[0].lanes!;
    expect(lanes.map((l) => l.valid)).toEqual([false, true, true]);
    const jct = r.steps.filter((s) => s.type === 'fork')[1];
    expect(jct.intersections[0].lanes!.map((l) => l.valid)).toEqual([false, false, true, true]);
    expect(r.steps.at(-1)!.type).toBe('arrive');
  });

  it('marks the tunnel and the toll road in the intersections', () => {
    const r = routeOf(json());
    // The Bukit Demo tunnel, then the short underpass on the exit 114 ramp.
    const spans = tunnelsFromRoute(r);
    expect(spans).toHaveLength(2);
    expect(spans[0].length).toBeGreaterThan(470);
    expect(spans[0].length).toBeLessThan(530);
    expect(spans[1].length).toBeLessThan(120);
    expect(r.steps.some((s) => s.intersections.some((i) => i.classes?.includes('toll')))).toBe(true);
    expect(r.steps.some((s) => s.intersections.some((i) => i.classes?.includes('motorway')))).toBe(true);
  });

  it('routes through a stop as two legs', () => {
    const via = frame.toLngLat(300, 2800);
    const r = routeOf(new OfflineRouter(graph()).route({ coords: [demo.start, via, demo.end], bearings: [0, null, null] }));
    expect(r.steps.filter((s) => s.type === 'arrive')).toHaveLength(2);
    expect(Math.abs(r.distance - reference.distance)).toBeLessThan(80);
  });

  it('keeps long routes on main roads without making them worse', () => {
    const G = new OfflineGraph(gridPack());
    const router = new OfflineRouter(G);
    const a: [number, number] = [100.003, 2.003];
    const z: [number, number] = [100.33, 2.33];
    const fast = router.route({ coords: [a, z] });
    expect(fast.code).toBe('Ok');
    // The same search over every road, for comparison.
    const full = (router as unknown as { search: (...x: unknown[]) => unknown[] | null }).search;
    const sa = G.snap(a)!;
    const sz = G.snap(z)!;
    const trav = full.call(router, sa, [0, 1], sz, [0, 1], undefined, false) as { time: number }[];
    const fullTime = trav.reduce((t, x) => t + x.time, 0);
    expect(fast.routes![0].duration).toBeLessThanOrEqual(fullTime * 1.03);
  });

  it('explains when a point is outside the offline area', () => {
    const res = new OfflineRouter(graph()).route({ coords: [demo.start, [101.7, 3.15]] });
    expect(res.code).toBe('NoSegment');
    expect(res.message).toMatch(/destination/);
  });
});

describe('offline junction and tunnel data', () => {
  it('returns roads and exit numbers near a junction like Overpass would', () => {
    const G = graph();
    const j4 = frame.toLngLat(590, 4500);
    const data = junctionData(G, [j4], 300);
    expect(data.ways.length).toBeGreaterThan(3);
    expect(data.ways.some((w) => w.tags.highway === 'motorway_link')).toBe(true);
    expect(data.ways.every((w) => w.nodes.length === w.geometry.length)).toBe(true);
    expect(data.nodes.find((n) => n.tags?.ref === '114')).toBeTruthy();
    // Ways meet at shared node ids so the junction view can join them.
    const ends = new Map<number, number>();
    for (const w of data.ways) for (const id of [w.nodes[0], w.nodes.at(-1)!]) ends.set(id, (ends.get(id) ?? 0) + 1);
    expect([...ends.values()].some((n) => n >= 3)).toBe(true);
  });

  it('finds the tunnel along a route path', () => {
    const r = routeOf(new OfflineRouter(graph()).route({ coords: [demo.start, demo.end], bearings: [0, null] }));
    const ways = tunnelWays(graph(), r.geometry.slice(0, 200));
    expect(ways.length).toBeGreaterThan(0);
    expect(ways.every((w) => w.tags.tunnel === 'yes')).toBe(true);
    expect(ways[0].tags['tunnel:name']).toBe('Terowong Bukit Demo');
  });
});

describe('offline junction views', () => {
  it('builds every junction view from offline road data, with flyover and underpass heights', () => {
    const G = graph();
    const r = routeOf(new OfflineRouter(G).route({ coords: [demo.start, demo.end], bearings: [0, null] }));
    const js = detectJunctions(r);
    expect(js.map((j) => j.kind)).toEqual(['fork', 'entry', 'merge', 'fork', 'exit']);
    const scenes = js.map((j) => buildScene(r, j, junctionData(G, [j.location], 450)));
    expect(scenes.every((sc) => sc.source === 'osm')).toBe(true);
    expect(scenes[0].profile.kind).toBe('flyover');
    expect(scenes[0].profile.peak.h).toBeCloseTo(6.8, 0);
    expect(scenes[4].profile.kind).toBe('tunnel');
    expect(scenes[4].exitRef).toBe('114');
  });
});

describe('offline trip links', () => {
  it('finds road points by ref or name without Overpass', () => {
    const G = graph();
    const e35 = roadWays(G, ['E35'], frame.toLngLat(400, 3800), 2000);
    expect(e35.length).toBeGreaterThan(0);
    expect(e35.every((w) => (w.tags.ref ?? '').includes('E35'))).toBe(true);
    const byName = roadWays(G, ['Lebuhraya Demo'], frame.toLngLat(300, 2500), 1500);
    expect(byName.some((w) => w.tags.name === 'Lebuhraya Demo')).toBe(true);
    // Ramps are never picked as road points.
    expect(roadWays(G, ['E1'], frame.toLngLat(300, 2500), 3000).every((w) => !w.tags.highway.endsWith('_link'))).toBe(true);
  });

  it('plans a test drive from a link on the offline maps', async () => {
    const G = graph();
    const P = new PlaceIndex(demoPack().places);
    const pts = await resolveTrip(parseTripLink('?from=road:E35~1.2&to=Restoran Sungai Buloh&sim=2')!, {
      geocode: async (q, near) => {
        const hit = P.search(q, near, 1)[0];
        return hit ? { lngLat: hit.lngLat, label: hit.name } : null;
      },
      roads: async (names, center, radius) => roadWays(G, names, center, radius),
      here: async () => null,
      near: null,
    });
    expect(pts[0].bearing).not.toBeNull();
    const r = new OfflineRouter(G).route({ coords: pts.map((p) => p.lngLat), bearings: [pts[0].bearing, null] });
    expect(r.code).toBe('Ok');
    const route = routeOf(r);
    expect(route.steps.some((s) => s.type === 'off ramp' && s.exits === '114')).toBe(true);
  });
});

describe('offline place search', () => {
  const places = () => new PlaceIndex(demoPack().places);

  it('finds places, businesses and streets by name', () => {
    const P = places();
    const hits = P.search('sungai buloh', null, 10).map((h) => h.name);
    expect(hits).toContain('Restoran Sungai Buloh');
    expect(hits).toContain('Jalan Sungai Buloh');
    expect(P.search('R&R demo timur', null)[0].name).toBe('R&R Demo Timur');
    expect(P.search('kedai', demo.end, 2)[0].name).toBe('Kedai Serbaneka Sungai Buloh');
  });

  it('answers category searches along a route', () => {
    const P = places();
    const fuel = CATEGORIES.find((c) => c.filter.includes('fuel'))!;
    const food = CATEGORIES.find((c) => c.filter.includes('restaurant'))!;
    expect(kindsOf(food.filter)).toEqual(['amenity=restaurant', 'amenity=fast_food', 'amenity=cafe', 'amenity=food_court']);
    const near = P.byKind(kindsOf(fuel.filter), [frame.toLngLat(500, 3800)], 500);
    expect(near[0].name).toBe('Stesen Minyak R&R Demo');
    const foods = P.byKind(kindsOf(food.filter), [demo.end], 300).map((p) => p.name);
    expect(foods).toEqual(['Restoran Sungai Buloh']);
  });

  it('names a dropped pin from the nearest entry', () => {
    const hit = places().nearest(frame.toLngLat(262, 5230))!;
    expect(hit.name).toBe('Parkir Sungai Buloh');
    expect(haversine(hit.lngLat, frame.toLngLat(262, 5232))).toBeLessThan(2);
  });
});
