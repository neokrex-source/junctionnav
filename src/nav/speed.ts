/**
 * Speed limits and speed cameras along the route.
 *
 * Limits come from, in order of trust:
 *  - the router's own (TomTom's speedLimit sections, kept on the route as `speedLimits`);
 *  - OpenStreetMap's maxspeed on the roads the route runs along (one Overpass query per 20 km
 *    ahead, shared with the toll lookup, or the offline maps), matched by position and direction;
 *  - the national limit on expressways where neither knows: 110 km/h in Malaysia, 100 in Japan
 *    (ramps excluded: they are signed lower and the national limit would be wrong there).
 *
 * Cameras are OpenStreetMap's speed cameras (highway=speed_camera) and enforcement relations:
 * fixed cameras, and average speed checks (from one point to another). A camera counts only when
 * it is on the route's own carriageway: on the road the route runs along, in the route's
 * direction, or right beside it.
 */
import { angleDiff, bearing, LocalFrame, type LngLat } from '../geo/geo';
import { routeKinds } from '../routing/align';
import type { Route } from '../routing/types';
import { chunkPath, parseTollAnswer, regionAt, type TollPoint, type TollProvider } from './tolls';

export type LimitSource = 'router' | 'osm' | 'national';

/** A stretch of route with one speed limit (km/h), by position along the route (metres). */
export interface LimitSpan {
  s0: number;
  s1: number;
  kmh: number;
  src: LimitSource;
}

/** A speed camera on the route. */
export interface SpeedCamera {
  id: string;
  s: number;
  at: LngLat;
  /** The limit it checks (km/h), when the map says. */
  limit: number | null;
}

/** An average speed check: the average from s0 to s1 is what counts. */
export interface SpeedCheck {
  id: string;
  s0: number;
  s1: number;
  limit: number | null;
}

/* ------------------------------------------------------------------ raw map data */

/** A road with a speed limit, from Overpass or the offline maps. */
export interface LimitWay {
  id: string;
  coords: LngLat[];
  tags: Record<string, string>;
}

/** A speed camera point, with the road it stands on when that is known. */
export interface CameraPoint {
  id: string;
  at: LngLat;
  tags: Record<string, string>;
  road?: { coords: LngLat[]; oneway: -1 | 0 | 1 };
}

/** An enforcement relation: where its cameras are, and where the checked stretch starts and ends. */
export interface Enforcement {
  id: string;
  tags: Record<string, string>;
  devices: LngLat[];
  from: LngLat[];
  to: LngLat[];
}

export interface SpeedData {
  ways: LimitWay[];
  cameras: CameraPoint[];
  checks: Enforcement[];
}

export interface SpeedProvider {
  fetch(path: LngLat[], signal?: AbortSignal): Promise<SpeedData>;
}

/* ------------------------------------------------------------------ reading the tags */

/** Speed limits written as a zone instead of a number. */
const ZONES: Record<string, number> = {
  'MY:urban': 60,
  'MY:rural': 90,
  'MY:motorway': 110,
  'MY:expressway': 110,
  'JP:motorway': 100,
  'JP:expressway': 100,
};

/** A maxspeed value in km/h ("110", "60 mph", "MY:urban"); null for "none", "signals", "walk" and the like. */
export function parseMaxspeed(v: string | undefined): number | null {
  if (!v) return null;
  const first = v.split(';')[0].trim();
  const m = /^(\d+(?:\.\d+)?)\s*(mph|knots)?$/i.exec(first);
  if (m) {
    const n = Number(m[1]);
    if (!(n >= 5 && n <= 200)) return null;
    const unit = m[2]?.toLowerCase();
    return unit === 'mph' ? n * 1.609344 : unit ? null : n;
  }
  return ZONES[first] ?? null;
}

export function onewayOf(t: Record<string, string>): -1 | 0 | 1 {
  const o = t.oneway;
  if (o === 'yes' || o === 'true' || o === '1') return 1;
  if (o === '-1' || o === 'reverse') return -1;
  if (o === 'no') return 0;
  if (t.highway === 'motorway' || t.highway === 'motorway_link' || t.junction === 'roundabout' || t.junction === 'circular') return 1;
  return 0;
}

/** The limit for driving along a road with (forward) or against (backward) the order of its points. */
function wayLimit(t: Record<string, string>, forward: boolean): number | null {
  return parseMaxspeed(t[forward ? 'maxspeed:forward' : 'maxspeed:backward']) ?? parseMaxspeed(t.maxspeed);
}

/* ------------------------------------------------------------------ limits on the route */

/** How often the route is sampled against the roads (metres). */
export const LIMIT_STEP = 20;
/** A road further than this from the route line is another road. */
const LIMIT_NEAR = 12;
/** And one turned more than this from the route's direction is a crossing road. */
const LIMIT_ALONG = 35;
const CELL = 0.0003;

interface Seg {
  a: LngLat;
  b: LngLat;
  brg: number;
  fwd: number | null;
  bwd: number | null;
  oneway: -1 | 0 | 1;
}

/**
 * Limits below this are not the road's speed limit: walking-pace figures are mapped on toll
 * booth lanes, car parks and gates, and anything under 30 on a main road is one of those too.
 */
function floorFor(t: Record<string, string>): number {
  return /^(motorway|trunk|primary)(_link)?$/.test(t.highway ?? '') ? 30 : 15;
}

function segIndex(ways: LimitWay[]): Map<string, Seg[]> {
  const grid = new Map<string, Seg[]>();
  for (const w of ways) {
    const floor = floorFor(w.tags);
    const real = (v: number | null) => (v != null && v >= floor ? v : null);
    const fwd = real(wayLimit(w.tags, true));
    const bwd = real(wayLimit(w.tags, false));
    if (fwd == null && bwd == null) continue;
    const oneway = onewayOf(w.tags);
    for (let i = 0; i + 1 < w.coords.length; i++) {
      const a = w.coords[i];
      const b = w.coords[i + 1];
      if (a[0] === b[0] && a[1] === b[1]) continue;
      const seg: Seg = { a, b, brg: bearing(a, b), fwd, bwd, oneway };
      for (let x = Math.floor(Math.min(a[0], b[0]) / CELL); x <= Math.floor(Math.max(a[0], b[0]) / CELL); x++)
        for (let y = Math.floor(Math.min(a[1], b[1]) / CELL); y <= Math.floor(Math.max(a[1], b[1]) / CELL); y++) {
          const k = `${x},${y}`;
          const cell = grid.get(k);
          if (cell) cell.push(seg);
          else grid.set(k, [seg]);
        }
    }
  }
  return grid;
}

function segDist(p: LngLat, seg: Seg): number {
  const f = new LocalFrame(p);
  const [ax, ay] = f.toXY(seg.a);
  const [bx, by] = f.toXY(seg.b);
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + dx * t, ay + dy * t);
}

/** The limit of the road the route runs along at a point, if a road with a limit is there. */
function limitHere(grid: Map<string, Seg[]>, p: LngLat, brg: number): number | null {
  const cx = Math.floor(p[0] / CELL);
  const cy = Math.floor(p[1] / CELL);
  let best: number | null = null;
  let bestD = LIMIT_NEAR;
  const seen = new Set<Seg>();
  for (let x = cx - 1; x <= cx + 1; x++)
    for (let y = cy - 1; y <= cy + 1; y++)
      for (const seg of grid.get(`${x},${y}`) ?? []) {
        if (seen.has(seg)) continue;
        seen.add(seg);
        const turn = Math.abs(angleDiff(brg, seg.brg));
        const forward = turn <= LIMIT_ALONG;
        const backward = turn >= 180 - LIMIT_ALONG;
        if (!forward && !backward) continue;
        if ((forward && seg.oneway === -1) || (backward && seg.oneway === 1)) continue;
        const d = segDist(p, seg);
        if (d >= bestD) continue;
        bestD = d;
        best = forward ? seg.fwd : seg.bwd;
      }
  return best;
}

/** Spans from one value per sample (null: not known), with short blips between equal neighbours folded in. */
function runs(values: (number | null)[], starts: number[], step: number, src: LimitSource): LimitSpan[] {
  const out: LimitSpan[] = [];
  values.forEach((kmh, i) => {
    if (kmh == null) return;
    const s0 = starts[i];
    const last = out[out.length - 1];
    if (last && last.kmh === kmh && last.s1 >= s0 - 0.5) last.s1 = s0 + step;
    else out.push({ s0, s1: s0 + step, kmh, src });
  });
  // A sample or two on another value between two stretches of the same limit is a side road
  // brushed at a junction, not a change of limit.
  for (let i = 1; i + 1 < out.length; i++) {
    const [a, b, c] = [out[i - 1], out[i], out[i + 1]];
    if (b.s1 - b.s0 <= step * 2 && a.kmh === c.kmh && b.s0 - a.s1 < 0.5 && c.s0 - b.s1 < 0.5) {
      a.s1 = c.s1;
      out.splice(i, 2);
      i--;
    }
  }
  return out;
}

/** OpenStreetMap's limits on the roads the route runs along between s0 and s1. */
export function matchLimits(route: Route, ways: LimitWay[], [s0, s1]: [number, number], step = LIMIT_STEP): LimitSpan[] {
  const grid = segIndex(ways);
  if (!grid.size) return [];
  const line = route.line;
  const values: (number | null)[] = [];
  const starts: number[] = [];
  for (let s = Math.max(0, s0); s < Math.min(line.length, s1); s += step) {
    const mid = Math.min(line.length, s + step / 2);
    values.push(limitHere(grid, line.pointAt(mid), line.bearingAt(mid, 15)));
    starts.push(s);
  }
  return runs(values, starts, step, 'osm').map((x) => ({ ...x, s1: Math.min(x.s1, s1, line.length) }));
}

/** The router's own limits (TomTom). */
export function routerLimits(route: Route): LimitSpan[] {
  return (route.speedLimits ?? []).filter((x) => x.s1 > x.s0 && x.kmh > 0).map((x) => ({ s0: x.s0, s1: x.s1, kmh: x.kmh, src: 'router' as const }));
}

/** The national limit on expressways (km/h), where the country has one this app knows. */
export function nationalLimit(p: LngLat): number | null {
  const r = regionAt(p);
  return r === 'MY' ? 110 : r === 'JP' ? 100 : null;
}

/**
 * The national expressway limit on the route's expressway stretches, leaving out ramps (from an
 * entrance or exit to the next maneuver), where it is signed lower.
 */
export function nationalLimits(route: Route, step = 25): LimitSpan[] {
  const kinds = routeKinds(route);
  const ramps: [number, number][] = [];
  route.steps.forEach((st, i) => {
    if (st.type === 'on ramp' || st.type === 'off ramp') ramps.push([st.s, route.steps[i + 1]?.s ?? route.line.length]);
  });
  const values: (number | null)[] = [];
  const starts: number[] = [];
  const line = route.line;
  for (let s = 0; s < line.length; s += step) {
    const mid = Math.min(line.length, s + step / 2);
    const onRamp = ramps.some(([a, b]) => mid >= a && mid <= b);
    values.push(!onRamp && kinds(mid).motorway ? nationalLimit(line.pointAt(mid)) : null);
    starts.push(s);
  }
  return runs(values, starts, step, 'national').map((x) => ({ ...x, s1: Math.min(x.s1, line.length) }));
}

/** One list from several, the first that knows a stretch deciding it. */
export function mergeLimits(...sets: LimitSpan[][]): LimitSpan[] {
  const cuts = [...new Set(sets.flatMap((set) => set.flatMap((x) => [x.s0, x.s1])))].sort((a, b) => a - b);
  const out: LimitSpan[] = [];
  for (let i = 0; i + 1 < cuts.length; i++) {
    const a = cuts[i];
    const b = cuts[i + 1];
    if (b - a < 0.01) continue;
    const mid = (a + b) / 2;
    let hit: LimitSpan | undefined;
    for (const set of sets) {
      hit = set.find((x) => mid >= x.s0 && mid < x.s1);
      if (hit) break;
    }
    if (!hit) continue;
    const last = out[out.length - 1];
    if (last && last.kmh === hit.kmh && last.src === hit.src && Math.abs(last.s1 - a) < 0.01) last.s1 = b;
    else out.push({ s0: a, s1: b, kmh: hit.kmh, src: hit.src });
  }
  return out;
}

/** The limit at s. */
export function limitAt(spans: LimitSpan[], s: number): LimitSpan | null {
  let lo = 0;
  let hi = spans.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const x = spans[mid];
    if (s < x.s0) hi = mid - 1;
    else if (s >= x.s1) lo = mid + 1;
    else return x;
  }
  return null;
}

/** The next change to a lower limit within `reach` metres ahead (to slow down for). */
export function lowerLimitAhead(spans: LimitSpan[], s: number, reach: number): { kmh: number; dist: number } | null {
  const now = limitAt(spans, s)?.kmh ?? null;
  if (now == null) return null;
  for (const x of spans) {
    if (x.s0 <= s) continue;
    if (x.s0 - s > reach) break;
    if (x.kmh < now - 0.5) return { kmh: x.kmh, dist: x.s0 - s };
  }
  return null;
}

/* ------------------------------------------------------------------ cameras on the route */

/** A camera on the road the route runs along may sit this far from the route line... */
const CAM_ON_ROAD = 15;
/** ...and one beside the road (no road known) this far. */
const CAM_BESIDE = 22;
/** Cameras this close along the route are one (both sides of the road, or mapped twice). */
const SAME_CAMERA = 60;

function nearestSegBearing(coords: LngLat[], p: LngLat): number | null {
  let best: number | null = null;
  let bestD = Infinity;
  for (let i = 0; i + 1 < coords.length; i++) {
    const seg = { a: coords[i], b: coords[i + 1] } as Seg;
    if (seg.a[0] === seg.b[0] && seg.a[1] === seg.b[1]) continue;
    const d = segDist(p, seg);
    if (d < bestD) {
      bestD = d;
      best = bearing(seg.a, seg.b);
    }
  }
  return best;
}

/** Does the camera point check traffic going the route's way at s? */
function facesRoute(cam: CameraPoint, routeBrg: number): boolean {
  const dir = cam.tags.direction;
  if (!cam.road) return true;
  const roadBrg = nearestSegBearing(cam.road.coords, cam.at);
  if (roadBrg == null) return true;
  const turn = Math.abs(angleDiff(routeBrg, roadBrg));
  const forward = turn <= 45;
  const backward = turn >= 135;
  // On a road crossing the route: that road's camera.
  if (!forward && !backward) return false;
  // On the other carriageway, or set for the other direction.
  if ((backward && cam.road.oneway === 1) || (forward && cam.road.oneway === -1)) return false;
  if ((dir === 'forward' && backward) || (dir === 'backward' && forward)) return false;
  return true;
}

/** Cameras and average speed checks between s0 and s1 on the route's own carriageway. */
export function matchCameras(route: Route, data: Pick<SpeedData, 'cameras' | 'checks'>, [s0, s1]: [number, number]): { cameras: SpeedCamera[]; checks: SpeedCheck[] } {
  const line = route.line;
  const cams: SpeedCamera[] = [];
  const place = (at: LngLat, maxD: number) => {
    const pr = line.project(at, Math.max(0, s0 - 200), s1 + 200);
    return pr.dist <= maxD && pr.s >= s0 - 1 && pr.s <= s1 + 1 ? pr : null;
  };
  for (const c of data.cameras) {
    const pr = place(c.at, c.road ? CAM_ON_ROAD : CAM_BESIDE);
    if (!pr || !facesRoute(c, line.bearingAt(pr.s, 20))) continue;
    cams.push({ id: `cam:${c.id}`, s: pr.s, at: pr.point, limit: parseMaxspeed(c.tags.maxspeed) });
  }
  const checks: SpeedCheck[] = [];
  for (const e of data.checks) {
    const kind = e.tags.enforcement;
    const limit = parseMaxspeed(e.tags.maxspeed);
    if (kind === 'average_speed') {
      const a = e.from.map((p) => place(p, 30)).find(Boolean);
      const b = e.to.map((p) => place(p, 30)).find(Boolean);
      if (a && b && b.s - a.s > 200 && b.s - a.s < 100_000) checks.push({ id: `check:${e.id}`, s0: a.s, s1: b.s, limit });
      continue;
    }
    if (kind !== 'maxspeed') continue;
    // Where the checked stretch starts must come before the camera along the route (else it
    // checks the other direction).
    const from = e.from.map((p) => place(p, 30)).find(Boolean) ?? null;
    for (const d of e.devices) {
      const pr = place(d, CAM_BESIDE);
      if (!pr || (e.from.length && (!from || from.s > pr.s + 5))) continue;
      cams.push({ id: `cam:${e.id}:${Math.round(pr.s)}`, s: pr.s, at: pr.point, limit });
    }
  }
  return { cameras: foldCameras(cams), checks };
}

/** Cameras in route order, those within 60 m of each other folded into one (keeping a limit). */
export function foldCameras(list: SpeedCamera[]): SpeedCamera[] {
  const out: SpeedCamera[] = [];
  for (const c of [...list].sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1];
    if (last && c.s - last.s < SAME_CAMERA) {
      if (last.limit == null && c.limit != null) out[out.length - 1] = { ...last, limit: c.limit };
      continue;
    }
    out.push({ ...c });
  }
  return out;
}

/** The next camera from s (just passed counts for a few metres), within `reach`. */
export function cameraAhead(cams: SpeedCamera[], s: number, reach: number): { cam: SpeedCamera; dist: number } | null {
  for (const c of cams) {
    const d = c.s - s;
    if (d < -10) continue;
    return d <= reach ? { cam: c, dist: Math.max(0, d) } : null;
  }
  return null;
}

/** The average speed check we are in, or the next one within `reach`. */
export function checkAt(checks: SpeedCheck[], s: number, reach: number): { check: SpeedCheck; inside: boolean; dist: number } | null {
  for (const c of checks) {
    if (s > c.s1) continue;
    if (s >= c.s0) return { check: c, inside: true, dist: c.s1 - s };
    return c.s0 - s <= reach ? { check: c, inside: false, dist: c.s0 - s } : null;
  }
  return null;
}

/* ------------------------------------------------------------------ Overpass */

/**
 * One query for a stretch of route: toll booths (for the toll reminder) and, for the speed
 * alerts, roads with a speed limit, speed cameras with the road each stands on, and enforcement
 * relations with their points.
 */
export function buildRoadsAheadQuery(path: LngLat[]): string {
  const c = path.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(',');
  return (
    '[out:json][timeout:30];' +
    `(node(around:35,${c})["barrier"="toll_booth"];way(around:35,${c})["barrier"="toll_booth"];);out center tags;` +
    `way(around:${LIMIT_NEAR + 3},${c})["highway"][~"^maxspeed(:forward|:backward)?$"~"."];out tags geom;` +
    `node(around:40,${c})["highway"="speed_camera"]->.cam;.cam out tags;way(bn.cam)["highway"];out body geom;` +
    `rel(around:60,${c})["type"="enforcement"]["enforcement"~"^(maxspeed|average_speed)$"];out body;node(r);out skel qt;`
  );
}

type El = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  tags?: Record<string, string>;
  nodes?: number[];
  geometry?: ({ lat: number; lon: number } | null)[];
  members?: { type: string; ref: number; role: string }[];
};

/** Pieces of a way's geometry (Overpass leaves out points outside a clipped box as null). */
function pieces(g: El['geometry']): LngLat[][] {
  const out: LngLat[][] = [[]];
  for (const p of g ?? []) {
    if (p) out[out.length - 1].push([p.lon, p.lat]);
    else if (out[out.length - 1].length) out.push([]);
  }
  return out.filter((x) => x.length >= 2);
}

/** The speed part of an Overpass answer from buildRoadsAheadQuery. */
export function parseSpeedAnswer(json: { elements?: El[] }): SpeedData {
  const els = json.elements ?? [];
  const nodes = new Map<number, LngLat>();
  for (const e of els) if (e.type === 'node' && e.lat != null && e.lon != null) nodes.set(e.id, [e.lon, e.lat]);
  const ways: LimitWay[] = [];
  const onWay = new Map<number, { coords: LngLat[]; oneway: -1 | 0 | 1 }>();
  for (const e of els) {
    if (e.type !== 'way' || !e.tags?.highway) continue;
    const parts = pieces(e.geometry);
    if (Object.keys(e.tags).some((k) => /^maxspeed(:forward|:backward)?$/.test(k))) parts.forEach((coords, i) => ways.push({ id: `w${e.id}${i ? `-${i}` : ''}`, coords, tags: e.tags! }));
    // Ways listed with their nodes are the roads the cameras stand on.
    if (e.nodes && parts.length === 1) for (const n of e.nodes) if (!onWay.has(n)) onWay.set(n, { coords: parts[0], oneway: onewayOf(e.tags) });
  }
  const cameras: CameraPoint[] = [];
  for (const e of els) {
    if (e.type !== 'node' || e.tags?.highway !== 'speed_camera' || e.lat == null || e.lon == null) continue;
    const road = onWay.get(e.id);
    cameras.push({ id: `n${e.id}`, at: [e.lon, e.lat], tags: e.tags, ...(road ? { road } : {}) });
  }
  const checks: Enforcement[] = [];
  for (const e of els) {
    if (e.type !== 'relation' || e.tags?.type !== 'enforcement') continue;
    const role = (r: string) => (e.members ?? []).filter((m) => m.type === 'node' && m.role === r && nodes.has(m.ref)).map((m) => nodes.get(m.ref)!);
    checks.push({ id: `r${e.id}`, tags: e.tags, devices: role('device'), from: role('from'), to: role('to') });
  }
  return { ways, cameras, checks };
}

async function overpass<T>(endpoints: string[], query: string, parse: (json: unknown) => T): Promise<T> {
  let lastErr: unknown;
  for (const url of endpoints) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query) });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      return parse(await res.json());
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error('Overpass unavailable');
}

/**
 * The toll booths and the speed data for a stretch of route from one Overpass query: the toll
 * and speed lookups ask for the same stretches, and the second to ask gets the first one's answer.
 */
export class OverpassRoadsAhead {
  private cache = new Map<string, { at: number; answer: Promise<{ elements?: El[] }> }>();

  constructor(private endpoints: () => string[]) {}

  private answer(path: LngLat[]): Promise<{ elements?: El[] }> {
    const key = path.map((p) => `${p[0].toFixed(5)},${p[1].toFixed(5)}`).join(';');
    const now = Date.now();
    for (const [k, v] of this.cache) if (now - v.at > 120_000) this.cache.delete(k);
    const hit = this.cache.get(key);
    if (hit) return hit.answer;
    const answer = overpass(this.endpoints(), buildRoadsAheadQuery(path), (j) => j as { elements?: El[] });
    this.cache.set(key, { at: now, answer });
    answer.catch(() => this.cache.delete(key));
    return answer;
  }

  readonly tolls: TollProvider = {
    fetch: async (path: LngLat[], signal?: AbortSignal): Promise<TollPoint[]> => {
      const json = await abortable(this.answer(path), signal);
      return parseTollAnswer(json as Parameters<typeof parseTollAnswer>[0]);
    },
  };

  readonly speed: SpeedProvider = {
    fetch: async (path: LngLat[], signal?: AbortSignal): Promise<SpeedData> => parseSpeedAnswer(await abortable(this.answer(path), signal)),
  };
}

/** A shared answer, given up on by one asker without cancelling it for the other. */
function abortable<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'));
  return new Promise<T>((ok, fail) => {
    const stop = () => fail(new DOMException('Aborted', 'AbortError'));
    signal.addEventListener('abort', stop, { once: true });
    p.then(
      (v) => {
        signal.removeEventListener('abort', stop);
        ok(v);
      },
      (e) => {
        signal.removeEventListener('abort', stop);
        fail(e);
      },
    );
  });
}

/* ------------------------------------------------------------------ loading along the drive */

export interface SpeedInfo {
  limits: LimitSpan[];
  cameras: SpeedCamera[];
  checks: SpeedCheck[];
}

/**
 * Loads the speed data for a route a little ahead of the driver, one lookup per ~20 km (the same
 * stretches as the toll lookup), on top of the router's own limits and the national ones.
 */
export class SpeedLoader {
  static readonly CHUNK = 20000;
  private route: Route | null = null;
  private router: LimitSpan[] = [];
  private national: LimitSpan[] = [];
  private osm: LimitSpan[] = [];
  private cams: SpeedCamera[] = [];
  private checkList: SpeedCheck[] = [];
  private chunks = new Map<number, 'loading' | 'done' | number>();
  private ctrl: AbortController | null = null;
  info: SpeedInfo = { limits: [], cameras: [], checks: [] };

  constructor(
    public provider: SpeedProvider | null,
    private onChange: (info: SpeedInfo) => void,
  ) {}

  private publish() {
    const limits = mergeLimits(this.router, this.osm, this.national);
    this.info = { limits, cameras: this.cams, checks: this.checkList };
    this.onChange(this.info);
  }

  setRoute(route: Route) {
    this.ctrl?.abort();
    this.ctrl = new AbortController();
    this.route = route;
    this.router = routerLimits(route);
    this.national = nationalLimits(route);
    this.osm = [];
    this.cams = [];
    this.checkList = [];
    this.chunks.clear();
    this.publish();
  }

  /** Make sure the stretch at s and the next one are loaded (or loading). */
  ensure(s: number) {
    const route = this.route;
    if (!route || !this.provider) return;
    const i0 = Math.floor(s / SpeedLoader.CHUNK);
    for (const i of [i0, i0 + 1]) {
      const s0 = i * SpeedLoader.CHUNK;
      if (s0 > route.line.length) continue;
      const st = this.chunks.get(i);
      if (st === 'loading' || st === 'done' || (typeof st === 'number' && Date.now() - st < 60_000)) continue;
      this.chunks.set(i, 'loading');
      const s1 = Math.min(route.line.length, s0 + SpeedLoader.CHUNK);
      const signal = this.ctrl?.signal;
      this.provider
        .fetch(chunkPath(route, s0, s1), signal)
        .then((data) => {
          if (this.route !== route) return;
          this.osm = mergeLimits(this.osm, matchLimits(route, data.ways, [s0, s1]));
          const found = matchCameras(route, data, [s0, s1]);
          this.cams = foldCameras([...this.cams, ...found.cameras]);
          this.checkList = [...this.checkList.filter((c) => !found.checks.some((x) => x.id === c.id)), ...found.checks].sort((a, b) => a.s0 - b.s0);
          this.chunks.set(i, 'done');
          this.publish();
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          console.warn('[speed] lookup failed', (e as Error).message);
          this.chunks.set(i, Date.now());
        });
    }
  }

  stop() {
    this.ctrl?.abort();
    this.route = null;
  }
}
