import { describe, expect, it } from 'vitest';
import { DEMO_ROADS, MAP_ROADS, roadWidthAt, tierAt, tierOfClass } from '../src/map/roadWidths';
import { CLOSE_SPAN, puckScale, roadShare, ROUTE_ON_ROAD, SCALE_PX, zoomForSpan } from '../src/map/mapView';
import type { RoadSeg } from '../src/routing/align';

const seg = (cls: string, a: [number, number], b: [number, number], brg: number): RoadSeg => ({ line: 1, i: 0, a, b, m: 0, len: 50, brg, cls }) as RoadSeg;

describe('the route in a close-up', () => {
  const z = zoomForSpan(CLOSE_SPAN, 3.1, SCALE_PX * 0.98);

  it('covers 80% of the road it is on, as wide as the map draws that road', () => {
    expect(ROUTE_ON_ROAD).toBe(0.8);
    for (const tier of ['highway', 'major', 'minor'] as const) {
      const road = roadWidthAt(tier, z);
      // The expression the route's outer line gets, evaluated as MapLibre would.
      const e = roadShare(tier, ROUTE_ON_ROAD) as unknown as [string, [string, number], [string], ...number[]];
      expect(e[1]).toEqual(['exponential', 1.5]);
      const stops = e.slice(3) as number[];
      expect(stops).toEqual(MAP_ROADS.tiers[tier].map((v, i) => (i % 2 ? Math.round(v * 0.8 * 100) / 100 : v)));
      expect(road * ROUTE_ON_ROAD).toBeGreaterThan(road * 0.79);
    }
    // At 20 m: an expressway is drawn 26 px wide, a main road 20 px, a minor road 14 px.
    expect(roadWidthAt('highway', z)).toBe(26);
    expect(roadWidthAt('major', z)).toBe(20);
    expect(roadWidthAt('minor', z)).toBe(14);
  });

  it('follows the demo map’s own road widths there', () => {
    const e = roadShare('major', 1, DEMO_ROADS) as unknown as unknown[];
    expect(e[1]).toEqual(['exponential', 1.6]);
    expect(roadWidthAt('major', 19, DEMO_ROADS)).toBeCloseTo(14 * 2.6);
  });

  it('interpolates as the map does between stops', () => {
    expect(roadWidthAt('major', 14)).toBe(4);
    expect(roadWidthAt('major', 16)).toBeCloseTo(4 + 16 * (1.5 ** 2 - 1) / (1.5 ** 4 - 1));
    expect(roadWidthAt('minor', 10)).toBe(0.5);
  });
});

describe('the road under the car', () => {
  it('road classes as tiers', () => {
    expect(tierOfClass('motorway')).toBe('highway');
    expect(tierOfClass('trunk')).toBe('highway');
    expect(tierOfClass('secondary')).toBe('major');
    expect(tierOfClass('minor')).toBe('minor');
    expect(tierOfClass('service')).toBe('minor');
  });

  it('the closest road running the car’s way, not a flyover crossing it', () => {
    const p: [number, number] = [101.5, 3.1];
    const along = seg('primary', [101.4995, 3.1001], [101.5005, 3.1001], 90);
    const across = seg('motorway', [101.5, 3.0995], [101.5, 3.1005], 0);
    expect(tierAt([along, across], p, 90)).toBe('major');
    expect(tierAt([along, across], p, 270)).toBe('major');
    expect(tierAt([along, across], p, 0)).toBe('highway');
    expect(tierAt([], p, 0)).toBeNull();
    expect(tierAt(null, p, 0)).toBeNull();
  });
});

describe('the car icon', () => {
  it('is as usual at the normal scales and a little bigger in close', () => {
    expect(puckScale(14)).toBe(1);
    expect(puckScale(zoomForSpan(200, 3.1, SCALE_PX))).toBe(1);
    const close = puckScale(zoomForSpan(CLOSE_SPAN, 3.1, SCALE_PX));
    expect(close).toBeGreaterThan(1.35);
    expect(close).toBeLessThanOrEqual(1.55);
    expect(puckScale(22)).toBe(1.55);
  });
});
