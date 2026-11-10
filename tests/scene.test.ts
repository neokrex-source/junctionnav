import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { detectJunctions } from '../src/junction/detect';
import { buildScene } from '../src/junction/scene';
import { haversine } from '../src/geo/geo';
import { normalizeOsrm } from '../src/routing/osrm';
import { demoTerrain } from '../src/demo/providers';
import { groundAt } from '../src/junction/scene';

const demo = buildDemo();
const route = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
const js = detectJunctions(route);

describe('demo junction scenes', () => {
  it('detects the five decision points', () => {
    expect(js.map((j) => j.kind)).toEqual(['fork', 'entry', 'merge', 'fork', 'exit']);
  });

  it('builds the flyover split from OSM with the route climbing', () => {
    const sc = buildScene(route, js[0], demo.osm);
    const taken = sc.roads.find((r) => r.role === 'taken')!;
    expect(sc.source).toBe('osm');
    expect(Math.max(...taken.h)).toBeGreaterThan(5);
    expect(sc.vertical).toBe('up');
  });

  it('keeps the other roads at the split as map lines, for the navigation map', () => {
    for (const [j, role] of [[js[0], 'branch'], [js[4], 'branch'], [js[2], 'incoming']] as const) {
      const sc = buildScene(route, j, demo.osm);
      expect(sc.forks?.length, j.kind).toBeGreaterThan(0);
      for (const f of sc.forks!) {
        expect(f.role).toBe(role);
        expect(f.pts.length).toBeGreaterThan(5);
        // From the split outwards (into it for a merge), as long lines in longitude and latitude.
        const near = role === 'branch' ? f.pts[0] : f.pts[f.pts.length - 1];
        expect(haversine(near, sc.origin)).toBeLessThan(30);
        expect(haversine(f.pts[0], f.pts[f.pts.length - 1])).toBeGreaterThan(120);
      }
    }
    // Without OSM detail (schematic view) there is nothing real to draw on the map.
    expect(buildScene(route, js[0], null).forks).toBeUndefined();
  });

  it('builds the exit with the ramp dropping into a tunnel', () => {
    const sc = buildScene(route, js[4], demo.osm);
    const taken = sc.roads.find((r) => r.role === 'taken')!;
    expect(sc.source).toBe('osm');
    expect(Math.min(...taken.h)).toBeLessThan(-5);
    expect(sc.vertical).toBe('down');
    expect(sc.exitRef).toBe('114');
    expect(sc.junctionName).toBe('Sungai Buloh');
    const signs = [...sc.signs].sort((a, b) => a.order - b.order);
    expect(signs[0].taken).toBe(true); // left exit in left-hand traffic
    expect(signs[0].places).toContain('Sungai Buloh');
  });

  it('lines lane groups up with the router lanes at a fork', () => {
    const sc = buildScene(route, js[3], demo.osm);
    const taken = sc.signs.find((s) => s.taken)!;
    const other = sc.signs.find((s) => !s.taken)!;
    expect(taken.laneCount).toBe(2);
    expect(other.laneCount).toBe(2);
    expect(taken.lateral).toBeGreaterThan(other.lateral);
  });

  it('falls back to a schematic scene without OSM data', () => {
    for (const j of js) {
      const sc = buildScene(route, j, null);
      expect(sc.source).toBe('schematic');
      expect(sc.roads.length).toBeGreaterThanOrEqual(2);
      expect(sc.signs.some((s) => s.taken)).toBe(true);
    }
  });
});

describe('junction heights', () => {
  it('describes the climb onto the flyover with its height and grade', () => {
    const sc = buildScene(route, js[0], demo.osm);
    expect(sc.profile.kind).toBe('flyover');
    expect(sc.profile.peak.h).toBeCloseTo(6.8, 0);
    expect(sc.profile.peak.s).toBeGreaterThan(150);
    expect(sc.profile.grade).toBeLessThanOrEqual(5);
    // The road not taken stays on the ground.
    expect(Math.max(...sc.profile.other!.h.map(Math.abs))).toBeLessThan(0.5);
    // Without terrain the ground is flat at street level.
    expect(sc.ground.level).toBeCloseTo(0, 5);
  });

  it('sees exit 114 drop under the road the expressway bridges', () => {
    const sc = buildScene(route, js[4], demo.osm);
    expect(sc.profile.kind).toBe('tunnel');
    expect(sc.profile.peak.h).toBeLessThan(-6);
    expect(Math.max(...sc.profile.other!.h)).toBeGreaterThan(5);
    const signs = sc.signs.filter((s) => s.vertical);
    expect(signs.find((s) => s.taken)?.vertical).toBe('down');
  });

  it('puts roads, ground and the profile on the terrain', async () => {
    const terrain = await demoTerrain().fetch(js[3].location, 950);
    const sc = buildScene(route, js[3], demo.osm, { terrain });
    expect(sc.ground.grid).toBeTruthy();
    // The E1 branch (not taken) climbs the ridge west of the JCT; ours stays low; no structures.
    expect(Math.max(...sc.profile.other!.h)).toBeGreaterThan(5);
    expect(sc.profile.structure.every((v) => Math.abs(v) < 0.5)).toBe(true);
    expect(sc.vertical).toBeNull();
    // Roads sit on the ground there.
    const taken = sc.roads.find((r) => r.role === 'taken')!;
    const i = Math.floor(taken.pts.length / 2);
    expect(Math.abs(taken.h[i] - groundAt(sc.ground, taken.pts[i][0], taken.pts[i][1]))).toBeLessThan(1.5);
  });

  it('follows the terrain in a schematic view without road data', async () => {
    const terrain = await demoTerrain().fetch(js[3].location, 950);
    const sc = buildScene(route, js[3], null, { terrain });
    expect(sc.source).toBe('schematic');
    expect(sc.ground.grid).toBeTruthy();
    const approach = sc.roads.find((r) => r.role === 'approach')!;
    expect(approach.h[approach.h.length - 1]).toBeCloseTo(0, 5);
  });
});

describe('junction views on a route from another map (TomTom)', () => {
  /** The demo route with its maneuver points moved along it, as another router might place them. */
  function shifted(by: number) {
    const r = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
    for (const st of r.steps) if (st.type !== 'depart' && st.type !== 'arrive') st.s = Math.max(0, Math.min(r.line.length, st.s + by));
    return r;
  }
  const side = (sc: ReturnType<typeof buildScene>) => {
    const t = sc.signs.find((x) => x.taken)!;
    const o = sc.signs.filter((x) => !x.taken);
    return o.every((x) => t.lateral < x.lateral) ? 'left' : o.every((x) => t.lateral > x.lateral) ? 'right' : 'middle';
  };

  for (const by of [-30, 25]) {
    it(`finds the split from the road data with the maneuver ${Math.abs(by)} m ${by < 0 ? 'early' : 'late'}`, () => {
      const r = shifted(by);
      for (const [i, j] of detectJunctions(r).entries()) {
        if (j.kind === 'merge' || j.kind === 'entry') continue;
        const want = r.steps[j.stepIndex].modifier?.includes('left') ? 'left' : 'right';
        const sc = buildScene(r, j, demo.osm);
        expect(sc.source, `junction ${i}`).toBe('osm');
        // Centred on the split: moved back by about what the maneuver point was moved.
        expect(Math.abs((sc.shift ?? 0) + by), `junction ${i} moved ${sc.shift}`).toBeLessThan(8);
        expect(side(sc), `junction ${i}`).toBe(want);
      }
    });
  }

  it('a sketch without road data puts the route on its maneuver’s side', () => {
    for (const j of js) {
      if (j.kind === 'merge' || j.kind === 'entry') continue;
      const step = route.steps[j.stepIndex];
      const want = step.modifier?.includes('left') ? 'left' : 'right';
      const sc = buildScene(route, j, null);
      if (sc.signs.length < 2) continue;
      expect(side(sc), `${j.kind} ${step.modifier}`).toBe(want);
    }
  });
});
