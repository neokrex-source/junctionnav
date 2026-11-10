/**
 * The route through a junction, laid on OpenStreetMap's roads there.
 *
 * The junction view is built from OpenStreetMap's roads (fetched for each junction), while the
 * route may come from TomTom, whose map is not OpenStreetMap's: its line can run a few metres to
 * the side, and its maneuver point can sit tens of metres before or after the split as
 * OpenStreetMap has it. Built on that line, the view could miss the split and fall back to a
 * sketch, or put the route on the wrong branch. So the stretch of route around the junction is
 * first moved onto the fetched roads with the same model that lines routes up with the map
 * (src/routing/align.ts), and the view works on that line.
 */
import { Polyline, type LngLat } from '../geo/geo';
import { alignLineSync, metres, routeKinds, type RoadSeg, type RoadSet } from '../routing/align';
import type { Route } from '../routing/types';
import type { OsmData } from './osmdata';

/** OpenStreetMap highway values as the classes the model knows (links count as their road). */
const CLASS: Record<string, string> = {
  motorway: 'motorway',
  motorway_link: 'motorway',
  trunk: 'trunk',
  trunk_link: 'trunk',
  primary: 'primary',
  primary_link: 'primary',
  secondary: 'secondary',
  secondary_link: 'secondary',
  tertiary: 'tertiary',
  tertiary_link: 'tertiary',
  residential: 'minor',
  unclassified: 'minor',
  living_street: 'minor',
  road: 'minor',
  service: 'service',
};

function oneway(t: Record<string, string>): -1 | 0 | 1 {
  const o = t.oneway;
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no') return 0;
  if (t.highway === 'motorway' || t.highway === 'motorway_link' || t.junction === 'roundabout' || t.junction === 'circular') return 1;
  return 0;
}

const CELL = 0.0005;

/** The fetched roads as road pieces for the model. */
export function osmRoadSet(osm: OsmData): RoadSet {
  const lines = new Map<number, RoadSeg[]>();
  const grid = new Map<string, RoadSeg[]>();
  let id = 1;
  for (const way of osm.ways) {
    const cls = CLASS[way.tags.highway ?? ''];
    if (!cls) continue;
    const ow = oneway(way.tags);
    const ramp = /_link$/.test(way.tags.highway ?? '');
    const tunnel = (!!way.tags.tunnel && way.tags.tunnel !== 'no') || way.tags.covered === 'yes';
    const list: RoadSeg[] = [];
    let m = 0;
    for (let i = 0; i + 1 < way.geometry.length; i++) {
      const a: LngLat = [way.geometry[i].lon, way.geometry[i].lat];
      const b: LngLat = [way.geometry[i + 1].lon, way.geometry[i + 1].lat];
      const len = metres(a, b);
      if (len < 0.05) continue;
      const kx = Math.cos((a[1] * Math.PI) / 180);
      const brg = ((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
      const seg: RoadSeg = { line: id, i: list.length, a, b, m, len, brg, cls, ramp, oneway: ow, tunnel };
      list.push(seg);
      m += len;
      for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
          const k = `${x},${y}`;
          const cell = grid.get(k);
          if (cell) cell.push(seg);
          else grid.set(k, [seg]);
        }
    }
    if (list.length) lines.set(id, list);
    id++;
  }
  return {
    near(p, r) {
      const d = r / 111_195 / CELL;
      const cx = p[0] / CELL;
      const cy = p[1] / CELL;
      const kx = 1 / Math.max(0.2, Math.cos((p[1] * Math.PI) / 180));
      const out = new Set<RoadSeg>();
      for (let x = Math.floor(cx - d * kx); x <= Math.floor(cx + d * kx); x++) for (let y = Math.floor(cy - d); y <= Math.floor(cy + d); y++) for (const s of grid.get(`${x},${y}`) ?? []) out.add(s);
      return [...out];
    },
    line: (l) => lines.get(l),
  };
}

/** The route around a junction on the fetched roads, and the way between its positions and the route's. */
export interface LocalSnap {
  line: Polyline;
  /** Route position to position on `line`. */
  toLocal: (s: number) => number;
  /** Position on `line` to route position. */
  toRoute: (s: number) => number;
}

/** A rising piecewise linear map from pairs (NaN pairs skipped). */
function pairsMap(from: number[], to: number[]): (x: number) => number {
  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < from.length; i++) {
    if (!Number.isFinite(from[i]) || !Number.isFinite(to[i])) continue;
    if (xs.length && (from[i] < xs[xs.length - 1] || to[i] < ys[ys.length - 1])) continue;
    xs.push(from[i]);
    ys.push(to[i]);
  }
  return (x: number) => {
    if (!xs.length) return x;
    if (x <= xs[0]) return ys[0] + (x - xs[0]);
    if (x >= xs[xs.length - 1]) return ys[ys.length - 1] + (x - xs[xs.length - 1]);
    let lo = 0;
    let hi = xs.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= x) lo = mid;
      else hi = mid;
    }
    const span = xs[hi] - xs[lo];
    return span > 0 ? ys[lo] + ((ys[hi] - ys[lo]) * (x - xs[lo])) / span : ys[lo];
  };
}

/**
 * The route from `before` metres before position s to `after` metres past it, on the fetched
 * roads; null when most of it could not be put on them (the roads were not fetched there).
 */
export function snapAround(route: Route, s: number, osm: OsmData, before = 520, after = 480): LocalSnap | null {
  const lo = Math.max(0, s - before);
  const hi = Math.min(route.line.length, s + after);
  if (hi - lo < 20) return null;
  const coords = route.line.slice(lo, hi);
  const kinds = routeKinds(route);
  const res = alignLineSync(coords, osmRoadSet(osm), { kindAt: (x) => kinds(lo + x) });
  if (!res || res.matched < 0.6) return null;
  const line = new Polyline(res.coords);
  const oldS = res.oldS.map((x) => x + lo);
  return { line, toLocal: pairsMap(oldS, Array.from(line.cum)), toRoute: pairsMap(Array.from(line.cum), oldS) };
}
