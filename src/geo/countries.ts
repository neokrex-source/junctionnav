/**
 * Which country of Asia a point is in, from simplified outlines (Natural Earth 1:50m, made by
 * scripts/dev/make-asia-countries.mjs; good to a few kilometres, which is enough for what the
 * app uses it for: the toll payment card to have ready and the like).
 */
import type { LngLat } from './geo';
import OUTLINES from './asiaCountries.json';

interface Outline {
  /** ISO 3166-1 alpha-2. */
  c: string;
  /** Box: west, south, east, north. */
  b: [number, number, number, number];
  /** Outer rings, each as flat [lon, lat, lon, lat, ...]. */
  r: number[][];
}

const LIST = OUTLINES as Outline[];

function inRing(ring: number[], x: number, y: number): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i];
    const yi = ring[i + 1];
    const xj = ring[j];
    const yj = ring[j + 1];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Squared distance (in degrees, longitude scaled by latitude) from a point to a ring's edges. */
function ringDist2(ring: number[], x: number, y: number, k: number): number {
  let best = Infinity;
  for (let i = 0; i + 3 < ring.length; i += 2) {
    const ax = ring[i] * k;
    const ay = ring[i + 1];
    const bx = ring[i + 2] * k;
    const by = ring[i + 3];
    const px = x * k;
    const dx = bx - ax;
    const dy = by - ay;
    const t = dx || dy ? Math.max(0, Math.min(1, ((px - ax) * dx + (y - ay) * dy) / (dx * dx + dy * dy))) : 0;
    const ex = ax + t * dx - px;
    const ey = ay + t * dy - y;
    best = Math.min(best, ex * ex + ey * ey);
  }
  return best;
}

/** How far off a simplified coast a point may be and still count (degrees, about 11 km). */
const COAST = 0.1;

/**
 * The country at a point (ISO alpha-2), or null outside the countries the app knows. A point just
 * off the simplified outline (a coastal road, a bridge, a harbour) counts for the nearest country.
 */
export function countryAt(p: LngLat): string | null {
  const [x, y] = p;
  // Smallest boxes first, so Hong Kong wins over China.
  for (const o of LIST) {
    if (x < o.b[0] || x > o.b[2] || y < o.b[1] || y > o.b[3]) continue;
    if (o.r.some((ring) => inRing(ring, x, y))) return o.c;
  }
  const k = Math.cos((y * Math.PI) / 180);
  let best: string | null = null;
  let bestD = COAST * COAST;
  for (const o of LIST) {
    if (x < o.b[0] - COAST || x > o.b[2] + COAST || y < o.b[1] - COAST || y > o.b[3] + COAST) continue;
    for (const ring of o.r) {
      const d = ringDist2(ring, x, y, k);
      if (d < bestD) {
        bestD = d;
        best = o.c;
      }
    }
  }
  return best;
}

/** The countries the app knows. */
export const KNOWN_COUNTRIES: string[] = LIST.map((o) => o.c);
