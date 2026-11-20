/**
 * How wide the map draws each tier of road ([zoom, px, ...], exponential 1.5 between stops; the
 * same in the JunctionNav look on OpenStreetMap and on TomTom's tiles), and which tier the road
 * under the car is, so the route can be drawn as a share of the road it is on.
 */
import type { LngLat } from '../geo/geo';
import type { RoadSeg } from '../routing/align';

export type RoadTier = 'minor' | 'major' | 'highway';

export const ROAD_WIDTHS: Record<RoadTier, readonly number[]> = {
  minor: [12, 0.5, 14, 2, 18, 14],
  major: [8, 0.6, 12, 2.2, 14, 4, 18, 20],
  highway: [5, 0.8, 10, 2.4, 14, 5.5, 18, 26],
};

/** Road widths of a map style: per tier [zoom, px, ...], and the exponential base between stops. */
export interface RoadWidthSpec {
  base: number;
  tiers: Record<RoadTier, readonly number[]>;
}

export const MAP_ROADS: RoadWidthSpec = { base: 1.5, tiers: ROAD_WIDTHS };

/** The offline demo network's map (src/map/styles.ts demoStyle): a factor per tier times one curve. */
export const DEMO_ROAD_CURVE = [12, 0.6, 16, 3.4, 19, 14] as const;
export const DEMO_ROAD_FACTOR: Record<RoadTier, number> = { highway: 3.2, major: 2.6, minor: 1.8 };
export const DEMO_ROADS: RoadWidthSpec = {
  base: 1.6,
  tiers: {
    highway: DEMO_ROAD_CURVE.map((v, i) => (i % 2 ? v * DEMO_ROAD_FACTOR.highway : v)),
    major: DEMO_ROAD_CURVE.map((v, i) => (i % 2 ? v * DEMO_ROAD_FACTOR.major : v)),
    minor: DEMO_ROAD_CURVE.map((v, i) => (i % 2 ? v * DEMO_ROAD_FACTOR.minor : v)),
  },
};

/** The road's width in screen pixels at a zoom, as the map's exponential interpolation gives it. */
export function roadWidthAt(tier: RoadTier, zoom: number, spec: RoadWidthSpec = MAP_ROADS): number {
  const w = spec.tiers[tier];
  const b = spec.base;
  if (zoom <= w[0]) return w[1];
  for (let i = 2; i < w.length; i += 2) {
    if (zoom <= w[i]) {
      const z0 = w[i - 2];
      const z1 = w[i];
      const t = (b ** (zoom - z0) - 1) / (b ** (z1 - z0) - 1);
      return w[i - 1] + (w[i + 1] - w[i - 1]) * t;
    }
  }
  return w[w.length - 1];
}

/** An OpenMapTiles road class (TomTom's categories are put into these) as a tier. */
export function tierOfClass(cls: string): RoadTier {
  if (cls === 'motorway' || cls === 'trunk') return 'highway';
  if (cls === 'primary' || cls === 'secondary' || cls === 'tertiary') return 'major';
  return 'minor';
}

/**
 * The tier of the road the car is on: of the map's road pieces nearby, the closest one running
 * the car's way (either direction), or null when there are none.
 */
export function tierAt(segs: RoadSeg[] | null, p: LngLat, heading: number): RoadTier | null {
  if (!segs?.length) return null;
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110_540;
  let best: RoadSeg | null = null;
  let bestScore = Infinity;
  for (const s of segs) {
    const ax = (s.a[0] - p[0]) * kx;
    const ay = (s.a[1] - p[1]) * ky;
    const bx = (s.b[0] - p[0]) * kx;
    const by = (s.b[1] - p[1]) * ky;
    const dx = bx - ax;
    const dy = by - ay;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
    const dist = Math.hypot(ax + dx * t, ay + dy * t);
    let turn = Math.abs(((s.brg - heading + 540) % 360) - 180);
    turn = Math.min(turn, 180 - turn);
    const score = dist + turn * 0.4;
    if (score < bestScore) {
      bestScore = score;
      best = s;
    }
  }
  return best ? tierOfClass(best.cls) : null;
}
