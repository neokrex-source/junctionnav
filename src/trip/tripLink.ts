/**
 * Trip links: a URL that plans a trip and (optionally) starts the simulator, e.g.
 *
 *   ?from=road:E2~3&via=Plaza Tol Sungai Besi@0&via=road:E19|SUKE&to=KLCC&sim
 *
 * Places can be "lat,lng", "lat,lng@heading", "here", free text (geocoded), or "road:REF"
 * for a point on a named road between its neighbours, on the carriageway heading the right
 * way. On the origin, "road:REF~3" means about 3 km before the next place. A stop written
 * "name@auto" is passed in the direction from the previous place (right carriageway).
 * Coordinates can carry a name for the trip editor: "3.0393,101.7056@0 (Plaza Tol Sungai Besi)".
 */
import { angleDiff, bearing, haversine, type LngLat } from '../geo/geo';
import { parseOverpass, type OsmWay } from '../junction/osmdata';
import type { Avoid } from '../routing/types';

type BearingSpec = number | 'auto';

export type PlaceRef =
  | { kind: 'coord'; lngLat: LngLat; bearing?: BearingSpec; label?: string }
  | { kind: 'text'; q: string; bearing?: BearingSpec }
  | { kind: 'road'; names: string[]; km?: number }
  | { kind: 'here' };

export interface TripLinkSpec {
  from: PlaceRef;
  via: PlaceRef[];
  to: PlaceRef;
  /** Start the simulator at this speed factor (1 when given without a number). */
  sim: number | null;
  avoid: Partial<Avoid>;
}

export interface ResolvedPoint {
  lngLat: LngLat;
  /** Direction to travel through the point, for snapping to the right carriageway. */
  bearing: number | null;
  label: string;
}

function parseBearing(s: string): { rest: string; bearing?: BearingSpec } {
  const auto = /^(.*?)@\s*auto\s*$/i.exec(s);
  if (auto) return { rest: auto[1].trim(), bearing: 'auto' };
  const m = /^(.*?)@\s*(-?\d+(?:\.\d+)?)\s*$/.exec(s);
  if (!m) return { rest: s };
  return { rest: m[1].trim(), bearing: ((Number(m[2]) % 360) + 360) % 360 };
}

export function parsePlaceRef(raw: string): PlaceRef | null {
  const s = raw.trim();
  if (!s) return null;
  if (/^(here|me|current|my location)$/i.test(s)) return { kind: 'here' };
  const road = /^road:\s*(.+?)(?:~\s*(\d+(?:\.\d+)?))?\s*$/i.exec(s);
  if (road) {
    const names = road[1].split('|').map((n) => n.trim()).filter(Boolean);
    return names.length ? { kind: 'road', names, km: road[2] ? Number(road[2]) : undefined } : null;
  }
  // A name in brackets after coordinates ("3.04,101.71@0 (Toll plaza)"); text keeps its brackets.
  const named = /^(.*?)\s*\(([^()]+)\)\s*$/.exec(s);
  const coord = (str: string, label?: string): PlaceRef | null => {
    const { rest, bearing: b } = parseBearing(str);
    const c = /^(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)$/.exec(rest);
    if (!c) return null;
    const lat = Number(c[1]);
    const lng = Number(c[2]);
    if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
    return label ? { kind: 'coord', lngLat: [lng, lat], bearing: b, label } : { kind: 'coord', lngLat: [lng, lat], bearing: b };
  };
  const hit = (named && coord(named[1], named[2].trim())) || coord(s);
  if (hit) return hit;
  const { rest, bearing: b } = parseBearing(s);
  return { kind: 'text', q: rest, bearing: b };
}

export function parseTripLink(search: string): TripLinkSpec | null {
  const p = new URLSearchParams(search);
  const toRaw = p.get('to');
  if (!toRaw) return null;
  const to = parsePlaceRef(toRaw);
  if (!to || to.kind === 'road') return null;
  const from = parsePlaceRef(p.get('from') ?? 'here') ?? { kind: 'here' };
  const via = p
    .getAll('via')
    .flatMap((v) => v.split(/\s*;\s*/))
    .map(parsePlaceRef)
    .filter((x): x is PlaceRef => !!x);
  const simRaw = p.get('sim') ?? p.get('simulate');
  const sim = simRaw == null ? null : Math.max(1, Math.min(8, Number(simRaw) || 1));
  const avoidRaw = (p.get('avoid') ?? '').toLowerCase();
  const avoid: Partial<Avoid> = {};
  if (/toll/.test(avoidRaw)) avoid.tolls = true;
  if (/highway|motorway/.test(avoidRaw)) avoid.motorways = true;
  if (/ferr/.test(avoidRaw)) avoid.ferries = true;
  return { from, via, to, sim, avoid };
}

/* ------------------------------------------------------------------ roads */

const REF_LIKE = /^[A-Z]{1,4}\s?\d{1,4}[A-Z]?$/i;

/** Regex-escape for a pattern inside an Overpass QL string (where backslashes escape too). */
function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\\\$&').replace(/"/g, '\\"');
}

/** Overpass query for mainline ways of a road by ref (E19) or name (SUKE). */
export function buildRoadQuery(names: string[], center: LngLat, radius: number): string {
  const around = `around:${Math.round(radius)},${center[1].toFixed(5)},${center[0].toFixed(5)}`;
  const hw = '["highway"~"^(motorway|trunk|primary|secondary)$"]';
  const parts = names.map((n) =>
    REF_LIKE.test(n)
      ? `way(${around})${hw}["ref"~"(^|;)\\\\s*${escapeRe(n.replace(/\s/g, ''))}\\\\s*(;|$)",i];`
      : `way(${around})${hw}["name"~"${escapeRe(n)}",i];way(${around})${hw}["name:en"~"${escapeRe(n)}",i];way(${around})${hw}["alt_name"~"${escapeRe(n)}",i];`,
  );
  return `[out:json][timeout:25];(${parts.join('')});out body geom;`;
}

interface Candidate {
  p: LngLat;
  dir: number;
}

/** Points every ~80 m along the ways, with the direction of travel (both for two-way roads). */
function candidates(ways: OsmWay[]): Candidate[] {
  const out: Candidate[] = [];
  for (const w of ways) {
    const pts = w.geometry.map((g) => [g.lon, g.lat] as LngLat);
    if (pts.length < 2) continue;
    const t = w.tags;
    const oneway = t.oneway === 'yes' || t.oneway === '1' || t.highway === 'motorway' || t.junction === 'roundabout';
    const reverse = t.oneway === '-1';
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i];
      const b = pts[i + 1];
      const len = haversine(a, b);
      const brg = bearing(a, b);
      for (let d = 80 - acc; d < len; d += 80) {
        const f = d / len;
        const p: LngLat = [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
        if (reverse) out.push({ p, dir: (brg + 180) % 360 });
        else {
          out.push({ p, dir: brg });
          if (!oneway) out.push({ p, dir: (brg + 180) % 360 });
        }
      }
      acc = (acc + len) % 80;
    }
  }
  return out;
}

/**
 * Picks a point on the road. Between two places it is the point with the least detour among
 * those where the road runs from the previous place toward the next one. On the origin it is
 * about `km` before the next place, heading toward it; on the destination, `km` after the
 * previous place.
 */
export function pickRoadPoint(
  ways: OsmWay[],
  prev: LngLat | null,
  next: LngLat | null,
  km = 3,
  /** Directions set on the neighbouring places, when they have one: the road point lines up behind (or after) them. */
  dirs: { prev?: number | null; next?: number | null } = {},
): { lngLat: LngLat; bearing: number } | null {
  const cands = candidates(ways);
  if (!cands.length || (!prev && !next)) return null;
  const target = km * 1000;
  let best: Candidate | null = null;
  let bestScore = Infinity;
  for (const c of cands) {
    let score: number;
    if (prev && next) {
      const toNext = Math.abs(angleDiff(c.dir, bearing(c.p, next)));
      const fromPrev = Math.abs(angleDiff(bearing(prev, c.p), c.dir));
      if (toNext > 75 || fromPrev > 75) continue;
      // A point on top of a neighbour would not steer the route anywhere.
      if (haversine(prev, c.p) < 400 || haversine(c.p, next) < 400) continue;
      // Least detour; a road that heads straight on wins ties.
      score = haversine(prev, c.p) + haversine(c.p, next) - haversine(prev, next) + (toNext + fromPrev) * 5;
    } else if (next) {
      const a = Math.abs(angleDiff(c.dir, bearing(c.p, next)));
      if (a > 50) continue;
      score = Math.abs(haversine(c.p, next) - target) + a * 15;
      if (dirs.next != null) {
        // The next place is passed heading this way, so start behind it on that carriageway.
        if (Math.abs(angleDiff(bearing(c.p, next), dirs.next)) > 60) continue;
        score += Math.abs(angleDiff(c.dir, dirs.next)) * 5;
      }
    } else {
      const a = Math.abs(angleDiff(bearing(prev!, c.p), c.dir));
      if (a > 50) continue;
      score = Math.abs(haversine(prev!, c.p) - target) + a * 15;
      if (dirs.prev != null) {
        if (Math.abs(angleDiff(bearing(prev!, c.p), dirs.prev)) > 60) continue;
        score += Math.abs(angleDiff(c.dir, dirs.prev)) * 5;
      }
    }
    if (score < bestScore) {
      bestScore = score;
      best = c;
    }
  }
  return best ? { lngLat: best.p, bearing: Math.round(best.dir) } : null;
}

/* ------------------------------------------------------------------ resolving */

export interface TripDeps {
  geocode(q: string, near: LngLat | null): Promise<{ lngLat: LngLat; label: string } | null>;
  /** Main-road ways matching a ref or name within `radius` of `center` (Overpass or the offline maps). */
  roads(names: string[], center: LngLat, radius: number): Promise<OsmWay[]>;
  here(): Promise<LngLat | null>;
  near: LngLat | null;
}

export class TripLinkError extends Error {}

function labelOf(r: PlaceRef): string {
  switch (r.kind) {
    case 'coord':
      return r.label ?? `${r.lngLat[1].toFixed(5)}, ${r.lngLat[0].toFixed(5)}`;
    case 'text':
      return r.q;
    case 'road':
      return r.names.join(' / ');
    case 'here':
      return 'My location';
  }
}

/** Resolves every place: fixed ones first, then road points from their resolved neighbours. */
export async function resolveTrip(spec: TripLinkSpec, deps: TripDeps): Promise<ResolvedPoint[]> {
  const refs = [spec.from, ...spec.via, spec.to];
  const out: (ResolvedPoint | null)[] = refs.map(() => null);
  let near = deps.near;
  for (let i = 0; i < refs.length; i++) {
    const r = refs[i];
    if (r.kind === 'coord') out[i] = { lngLat: r.lngLat, bearing: typeof r.bearing === 'number' ? r.bearing : null, label: labelOf(r) };
    else if (r.kind === 'here') {
      const p = await deps.here();
      if (!p) throw new TripLinkError('Your location is not available for the trip start.');
      out[i] = { lngLat: p, bearing: null, label: 'My location' };
    } else if (r.kind === 'text') {
      const g = await deps.geocode(r.q, near);
      if (!g) throw new TripLinkError(`Could not find "${r.q}".`);
      out[i] = { lngLat: g.lngLat, bearing: typeof r.bearing === 'number' ? r.bearing : null, label: g.label };
    }
    if (out[i]) near = out[i]!.lngLat;
  }
  for (let pass = 0; pass < refs.length && out.some((x) => !x); pass++) {
    for (let i = 0; i < refs.length; i++) {
      const r = refs[i];
      if (out[i] || r.kind !== 'road') continue;
      const prev = i > 0 ? out[i - 1]?.lngLat ?? null : null;
      const next = i < refs.length - 1 ? out[i + 1]?.lngLat ?? null : null;
      // A road point between two places needs both; at either end of the trip, one neighbour.
      if ((i > 0 && !prev) || (i < refs.length - 1 && !next)) continue;
      const km = r.km ?? 3;
      const center: LngLat = prev && next ? [(prev[0] + next[0]) / 2, (prev[1] + next[1]) / 2] : (prev ?? next)!;
      const radius = prev && next ? Math.min(25_000, haversine(prev, next) * 0.75 + 2000) : km * 1000 + 2500;
      const ways = await deps.roads(r.names, center, radius);
      const pick = pickRoadPoint(ways, prev, next, km, { prev: i > 0 ? out[i - 1]?.bearing : null, next: i < refs.length - 1 ? out[i + 1]?.bearing : null });
      if (!pick) throw new TripLinkError(`No stretch of ${labelOf(r)} found that leads the right way.`);
      out[i] = { lngLat: pick.lngLat, bearing: pick.bearing, label: labelOf(r) };
    }
  }
  if (out.some((x) => !x)) throw new TripLinkError('Two road points next to each other need a fixed place between them.');
  const pts = out as ResolvedPoint[];
  // "@auto": pass the stop in the direction we arrive from.
  refs.forEach((r, i) => {
    if ((r.kind === 'text' || r.kind === 'coord') && r.bearing === 'auto' && i > 0 && haversine(pts[i - 1].lngLat, pts[i].lngLat) > 200) {
      pts[i].bearing = Math.round(bearing(pts[i - 1].lngLat, pts[i].lngLat));
    }
  });
  return pts;
}

/** Overpass runner over a list of endpoints, tried in order. */
export async function runOverpass(endpoints: string[], query: string, signal?: AbortSignal): Promise<OsmWay[]> {
  let lastErr: unknown;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: 'data=' + encodeURIComponent(query),
        signal,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return parseOverpass(await res.json()).ways;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Overpass unavailable');
}
