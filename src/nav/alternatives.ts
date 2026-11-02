/**
 * Alternative routes kept ready during a drive, so a wrong turn can switch to one at once,
 * without waiting for the router (or a connection). The app refreshes them from the car's
 * position every couple of minutes (see App.refreshAlternatives in main.ts).
 */
import { angleDiff, type LngLat } from '../geo/geo';
import type { Route } from '../routing/types';

/** How many alternatives are kept. */
export const MAX_ALTERNATIVES = 3;

export interface AltMatch {
  route: Route;
  /** Where the car is along it. */
  s: number;
  /** Distance from the car to its line (m). */
  dist: number;
}

/**
 * The alternative the car is driving on, if any: within `threshold` metres of its line, heading
 * along it (not against it), and not already at its very end. The closest one wins.
 */
export function matchAlternative(alts: Route[], p: LngLat, heading: number | null, threshold: number): AltMatch | null {
  let best: AltMatch | null = null;
  for (const route of alts) {
    const proj = route.line.project(p);
    if (proj.dist > threshold) continue;
    if (route.line.length - proj.s < 150) continue;
    if (heading != null && Math.abs(angleDiff(route.line.bearingAt(proj.s), heading)) > 60) continue;
    if (!best || proj.dist < best.dist) best = { route, s: proj.s, dist: proj.dist };
  }
  return best;
}

/** Share of route `b` (sampled every few hundred metres) that runs along route `a`, from 0 to 1. */
export function overlap(a: Route, b: Route): number {
  const n = Math.max(8, Math.min(40, Math.round(b.line.length / 250)));
  let on = 0;
  for (let i = 1; i < n; i++) if (a.line.project(b.line.pointAt((b.line.length * i) / n)).dist < 30) on++;
  return on / (n - 1);
}

/**
 * Up to MAX_ALTERNATIVES candidates that really differ from the route being driven and from each
 * other: at most 85% of each runs along another. Candidates may start anywhere along the route
 * (they are refreshed from the car's position), so this compares shapes, not total lengths.
 */
export function distinctAlternatives(current: Route, candidates: Route[], n = MAX_ALTERNATIVES): Route[] {
  const out: Route[] = [];
  for (const r of candidates) {
    if (r === current || overlap(current, r) > 0.85 || out.some((o) => overlap(o, r) > 0.85)) continue;
    out.push(r);
    if (out.length >= n) break;
  }
  return out;
}
