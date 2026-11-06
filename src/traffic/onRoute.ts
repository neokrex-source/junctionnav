/**
 * Traffic against the route being driven: which incidents lie on it and where, the box of road
 * ahead to ask about, the points that describe the rest of the route for a travel time with
 * traffic, and which news items name its roads.
 */
import { angleDiff, type LngLat } from '../geo/geo';
import type { Route } from '../routing/types';
import { roadsOfSteps } from './roads';
import type { Bbox } from './tomtom';
import { bboxArea } from './tomtom';
import type { Incident, NewsItem, RouteIncident, TrafficEta } from './types';

/**
 * Incidents on the route: most of the incident's points lie within `maxDist` metres of the route
 * line, in the same direction of travel (TomTom gives a stretch in the direction of the traffic
 * it affects), from `fromS` on. Sorted by where they start.
 */
export function incidentsOnRoute(route: Route, incidents: Incident[], fromS = 0, maxDist = 35): RouteIncident[] {
  const line = route.line;
  const out: RouteIncident[] = [];
  for (const inc of incidents) {
    const pts = inc.geometry.length > 12 ? inc.geometry.filter((_, i, a) => i % Math.ceil(a.length / 12) === 0 || i === a.length - 1) : inc.geometry;
    const projs = pts.map((p) => line.project(p, Math.max(0, fromS - 200)));
    const near = projs.filter((pr) => pr.dist <= maxDist);
    if (near.length < Math.max(1, Math.ceil(projs.length * 0.6))) continue;
    // Direction: along the route, not the other carriageway.
    if (pts.length >= 2) {
      const first = projs[0];
      const last = projs[projs.length - 1];
      if (last.s < first.s - 5) continue;
      const brg = bearingOf(pts[0], pts[pts.length - 1]);
      if (Math.abs(angleDiff(line.bearingAt((first.s + last.s) / 2), brg)) > 70 && Math.abs(last.s - first.s) > 30) continue;
    }
    const ss = near.map((pr) => pr.s);
    const s = Math.min(...ss);
    const endS = Math.max(...ss, s + Math.max(30, Math.min(inc.length, 50)));
    if (endS < fromS) continue;
    out.push({ ...inc, s, endS });
  }
  return out.sort((a, b) => a.s - b.s);
}

function bearingOf(a: LngLat, b: LngLat): number {
  const r = Math.PI / 180;
  const y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return ((Math.atan2(y, x) / r) + 360) % 360;
}

/**
 * The box around the next `ahead` metres of route from `s`, with a margin, shortened until it
 * fits in TomTom's 10,000 km² limit (with room to spare).
 */
export function boxAhead(route: Route, s: number, ahead = 30_000, margin = 0.01): { bbox: Bbox; toS: number } {
  let len = Math.min(ahead, route.line.length - s);
  for (;;) {
    const pts = route.line.slice(Math.max(0, s - 300), s + len);
    let w = Infinity;
    let so = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const [x, y] of pts) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      so = Math.min(so, y);
      n = Math.max(n, y);
    }
    const bbox: Bbox = [w - margin, so - margin, e + margin, n + margin];
    if (bboxArea(bbox) <= 8000 || len <= 2000) return { bbox, toS: s + len };
    len *= 0.6;
  }
}

/** Points along the route from `s` to the end, about every `step` metres and at most `max`, for a travel time with traffic. */
export function pointsAhead(route: Route, s: number, max = 150, minStep = 150): LngLat[] {
  const L = route.line.length;
  const rest = Math.max(0, L - s);
  const step = Math.max(minStep, rest / (max - 1));
  const out: LngLat[] = [];
  for (let d = s; d < L; d += step) out.push(route.line.pointAt(d));
  out.push(route.line.pointAt(L));
  return out;
}

/** The roads (HIGHWAYS keys) a route uses. */
export function routeRoads(route: Route): string[] {
  return roadsOfSteps(route.steps);
}

/** News items that name a road on the route, newest first, within the last `maxAgeH` hours. */
export function newsForRoute(items: NewsItem[], roads: string[], now = Date.now(), maxAgeH = 6): NewsItem[] {
  const set = new Set(roads);
  return items
    .filter((it) => now - Date.parse(it.published) <= maxAgeH * 3600_000 && it.roads.some((r) => set.has(r)))
    .sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
}

/** Recent news, newest first. */
export function recentNews(items: NewsItem[], now = Date.now(), maxAgeH = 12): NewsItem[] {
  return items.filter((it) => now - Date.parse(it.published) <= maxAgeH * 3600_000).sort((a, b) => Date.parse(b.published) - Date.parse(a.published));
}

/** The route's own driving time (no traffic) from `s` to the end, seconds, as the guidance counts it. */
export function routeTimeFrom(route: Route, s: number): number {
  const steps = route.steps;
  let t = 0;
  for (let i = 0; i < steps.length; i++) {
    const a = steps[i].s;
    const b = i + 1 < steps.length ? steps[i + 1].s : route.line.length;
    if (b <= s) continue;
    const len = Math.max(1, b - a);
    t += a >= s ? steps[i].duration : (steps[i].duration * (b - s)) / len;
  }
  return t;
}

/**
 * A travel time with traffic carried forward to where the car is now: the same ratio to the
 * route's own time as when TomTom answered (so it counts down as the car drives).
 */
export function trafficRemaining(eta: TrafficEta, baseNow: number): { time: number; delay: number } {
  const k = eta.base > 0 ? Math.max(0, Math.min(1.5, baseNow / eta.base)) : 1;
  return { time: eta.travelTime * k, delay: eta.delay * k };
}

/**
 * Time lost to the incidents on the route between `s` and `toS`, seconds: each incident's delay,
 * or the share still ahead of one the car is already in. Incidents that overlap (an accident and
 * the queue behind it are often reported apart) count once, with the larger delay. Closures report
 * no delay; they need a new route, not a later arrival.
 */
export function incidentDelayAhead(list: RouteIncident[], s: number, toS = Infinity): number {
  const parts = list
    .filter((i) => i.endS > s && i.s < toS && i.delay > 0)
    .map((i) => {
      const len = Math.max(1, i.endS - i.s);
      const share = Math.max(0, Math.min(1, (Math.min(toS, i.endS) - Math.max(s, i.s)) / len));
      return { a: i.s, b: i.endS, d: i.delay * share };
    })
    .sort((x, y) => x.a - y.a);
  let total = 0;
  let end = -Infinity;
  let best = 0;
  for (const p of parts) {
    if (p.a < end) {
      best = Math.max(best, p.d);
      end = Math.max(end, p.b);
    } else {
      total += best;
      best = p.d;
      end = p.b;
    }
  }
  return total + best;
}
