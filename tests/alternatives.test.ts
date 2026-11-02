import { describe, expect, it } from 'vitest';
import { LocalFrame, type LngLat } from '../src/geo/geo';
import { distinctAlternatives, matchAlternative, overlap } from '../src/nav/alternatives';
import { normalizeOsrm, type OsrmResponse } from '../src/routing/osrm';
import type { Route } from '../src/routing/types';

const f = new LocalFrame([101.69, 3.14]);
/** A route through local points (metres east, north), as the router would return it. */
function route(pts: [number, number][]): Route {
  const coords: LngLat[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, ay] = pts[i];
    const [bx, by] = pts[i + 1];
    const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 50));
    for (let k = 0; k < n; k++) coords.push(f.toLngLat(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
  }
  coords.push(f.toLngLat(...pts[pts.length - 1]));
  const len = pts.slice(1).reduce((a, p, i) => a + Math.hypot(p[0] - pts[i][0], p[1] - pts[i][1]), 0);
  const step = (type: string, loc: LngLat, d: number) => ({
    maneuver: { type, location: loc, bearing_before: 0, bearing_after: 0 },
    name: '',
    distance: d,
    duration: d / 15,
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
        duration: len / 15,
        geometry: { type: 'LineString', coordinates: coords },
        legs: [{ distance: len, duration: len / 15, steps: [step('depart', coords[0], len), step('arrive', coords[coords.length - 1], 0)] }],
      },
    ],
  } as unknown as OsrmResponse;
  return normalizeOsrm(json, 'Test')[0];
}

// The planned route goes north 3 km. Two alternatives leave it 1 km in: one bears east, one west;
// a third is the planned route again from further along (as a refresh from the car returns it).
const main = route([[0, 0], [0, 3000]]);
const east = route([[0, 0], [0, 1000], [800, 1800], [800, 3200]]);
const west = route([[0, 0], [0, 1000], [-800, 1800], [-800, 3200]]);
const again = route([[0, 1200], [0, 3000]]);

describe('alternative routes kept ready', () => {
  it('keeps only routes that really differ from the one driven, and from each other', () => {
    expect(overlap(main, again)).toBe(1);
    expect(overlap(main, east)).toBeLessThan(0.6);
    expect(distinctAlternatives(main, [again, east, east, west])).toEqual([east, west]);
    expect(distinctAlternatives(main, [east, west, route([[0, 0], [0, 1000], [1600, 2600]])], 2)).toHaveLength(2);
  });

  it('finds the alternative the car turned onto, heading along it', () => {
    // On the east branch, 300 m after it leaves the planned route, driving north-east.
    const p = f.toLngLat(212, 1212);
    const m = matchAlternative([west, east], p, 45, 40);
    expect(m?.route).toBe(east);
    expect(m!.s).toBeGreaterThan(1250);
    expect(m!.s).toBeLessThan(1350);
    // Driving the wrong way along it, or off every alternative: no switch (the router decides).
    expect(matchAlternative([west, east], p, 225, 40)).toBeNull();
    expect(matchAlternative([west, east], f.toLngLat(400, 600), 0, 40)).toBeNull();
    // At the very end of an alternative there is nothing left to switch to.
    expect(matchAlternative([east], f.toLngLat(800, 3150), 0, 40)).toBeNull();
  });
});
