/**
 * Lines a route up with the roads the map draws.
 *
 * TomTom plans on its own map and the app shows OpenStreetMap. The same road can lie a few metres
 * apart in the two (more at interchanges, where a ramp leaves the main road at another place), so
 * a TomTom route drawn on the map can run beside the road or cut across a ramp. This moves the
 * route onto the map's own road lines:
 *
 * - it walks the route in 4 m steps and finds the roads near each step that go its way (one-way
 *   roads only in their own direction; TomTom's motorway and tunnel stretches prefer motorways
 *   and tunnels);
 * - it picks one road for every step with a hidden Markov model solved by Viterbi: near roads are
 *   likely, and steps that keep the same spacing along one road are likely, so the route does not
 *   hop to a road alongside for a few steps;
 * - it snaps each step onto its road, and where the route changes road it passes through the
 *   point where the two roads meet (a ramp leaves the main road where the map has it);
 * - a stretch with no such road nearby (a new road the map does not have yet, a ferry) or with
 *   no road data loaded stays as the router drew it.
 *
 * Every position along the route (maneuvers, stops, toll gates) moves with it, so guidance works
 * on the lined-up route as on the router's own.
 */
import { angleDiff, Polyline, type LngLat } from '../geo/geo';
import type { Intersection, Route, Step } from './types';

/** A straight piece of a road line on the map. */
export interface RoadSeg {
  /** The road line it belongs to (unique while its map tile is loaded). */
  line: number;
  /** Its index in the line. */
  i: number;
  a: LngLat;
  b: LngLat;
  /** Metres along the line to `a`. */
  m: number;
  /** Length in metres. */
  len: number;
  /** Bearing a→b in degrees. */
  brg: number;
  /** OpenMapTiles road class (motorway, trunk, primary, secondary, tertiary, minor, service, …). */
  cls: string;
  ramp: boolean;
  /** 1 = one way along a→b, -1 = one way against it, 0 = both ways. */
  oneway: -1 | 0 | 1;
  tunnel: boolean;
}

/** The map's roads, as far as they are loaded. */
export interface RoadSet {
  /** Road pieces within about `r` metres of p, or null when the roads there are not loaded. */
  near(p: LngLat, r: number): RoadSeg[] | null;
  /** All pieces of a road line in order, while it is loaded. */
  line(id: number): RoadSeg[] | undefined;
}

/** What the router says about the road at a position along the route. */
export interface RoadKind {
  motorway: boolean;
  tunnel: boolean;
  ferry: boolean;
}

export interface AlignOptions {
  kindAt?: (s: number) => RoadKind;
  /** Step length in metres (4). */
  step?: number;
  /** Roads further than this from the route are not considered (25 m). */
  radius?: number;
}

export interface AlignedLine {
  coords: LngLat[];
  /** For each point, the position along the original line it stands for (NaN for joins between roads). */
  oldS: number[];
  /** Share of the route on a map road, and share where no road data was loaded (0..1). */
  matched: number;
  unknown: number;
  /** Largest move of the route, metres. */
  maxMove: number;
}

/* ------------------------------------------------------------------ small geometry */

const D2R = Math.PI / 180;
const KY = 6371008.8 * D2R;
const kxAt = (lat: number) => KY * Math.cos(lat * D2R);

export function metres(a: LngLat, b: LngLat): number {
  const kx = kxAt((a[1] + b[1]) / 2);
  return Math.hypot((b[0] - a[0]) * kx, (b[1] - a[1]) * KY);
}

/** Nearest point of segment a-b to p: distance, fraction along and the point. */
function projectSeg(p: LngLat, a: LngLat, b: LngLat): { d: number; t: number; q: LngLat } {
  const kx = kxAt(p[1]);
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * KY;
  const bx = (b[0] - p[0]) * kx;
  const by = (b[1] - p[1]) * KY;
  const dx = bx - ax;
  const dy = by - ay;
  const L2 = dx * dx + dy * dy;
  let t = L2 > 0 ? -(ax * dx + ay * dy) / L2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const x = ax + dx * t;
  const y = ay + dy * t;
  return { d: Math.hypot(x, y), t, q: [p[0] + x / kx, p[1] + y / KY] };
}

/** Closest points of two segments (by sampling the ends onto each other; enough for joins). */
function segGap(s: RoadSeg, u: RoadSeg): { d: number; onS: number; onU: number; q: LngLat } {
  let best = { d: Infinity, onS: 0, onU: 0, q: s.a };
  const tryS = (p: LngLat, tU: number) => {
    const pr = projectSeg(p, s.a, s.b);
    if (pr.d < best.d) best = { d: pr.d, onS: pr.t, onU: tU, q: midpoint(pr.q, p) };
  };
  const tryU = (p: LngLat, tS: number) => {
    const pr = projectSeg(p, u.a, u.b);
    if (pr.d < best.d) best = { d: pr.d, onS: tS, onU: pr.t, q: midpoint(pr.q, p) };
  };
  tryS(u.a, 0);
  tryS(u.b, 1);
  tryU(s.a, 0);
  tryU(s.b, 1);
  // Crossing segments: their intersection.
  const kx = kxAt(s.a[1]);
  const x1 = 0;
  const y1 = 0;
  const x2 = (s.b[0] - s.a[0]) * kx;
  const y2 = (s.b[1] - s.a[1]) * KY;
  const x3 = (u.a[0] - s.a[0]) * kx;
  const y3 = (u.a[1] - s.a[1]) * KY;
  const x4 = (u.b[0] - s.a[0]) * kx;
  const y4 = (u.b[1] - s.a[1]) * KY;
  const den = (x1 - x2) * (y3 - y4) - (y1 - y2) * (x3 - x4);
  if (Math.abs(den) > 1e-9) {
    const t = ((x1 - x3) * (y3 - y4) - (y1 - y3) * (x3 - x4)) / den;
    const v = -((x1 - x2) * (y1 - y3) - (y1 - y2) * (x1 - x3)) / den;
    if (t >= 0 && t <= 1 && v >= 0 && v <= 1) best = { d: 0, onS: t, onU: v, q: [s.a[0] + (x2 * t) / kx, s.a[1] + (y2 * t) / KY] };
  }
  return best;
}

const midpoint = (a: LngLat, b: LngLat): LngLat => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];

/* ------------------------------------------------------------------ the model */

const SIGMA = 5;
/** Cost of leaving a step where the router put it (about a road 14 m away). */
const OFF_ROAD = 4;
/** Metres by which the spacing of two steps on the map may differ from the route's per unit of cost. */
const BETA = 1.2;
/** Service roads (car parks, driveways, back lanes) are for the ends of a route, per step elsewhere. */
const SERVICE_MID = 0.25;
const END_ZONE = 300;
const SWITCH = 0.3;
/**
 * Changing to a road that does not meet this one (a road alongside): a car cannot do that, so
 * it costs about as much as 40 m on the wrong road.
 */
const HOP = 15;
/** Roads meet if they come within JOIN_GAP of each other within this many metres of the change. */
const MEET_WINDOW = 40;
const OFF_SWITCH = 8;
const BACKWARDS = 3;
/** At most this many roads per step. */
const MAX_CANDS = 8;
/** A road must go within this many degrees of the route's direction. */
const DIR_TOL = 50;
/** Two road lines this close count as meeting. */
const JOIN_GAP = 2.5;
const JOIN_WINDOW = 60;

interface Sample {
  p: LngLat;
  s: number;
  brg: number;
  /** Index of the router's own point, or -1 for a step in between. */
  v: number;
  /** No road data loaded here. */
  unknown: boolean;
  /** Within the first or last few hundred metres. */
  end: boolean;
}

interface Cand {
  seg: RoadSeg | null;
  q: LngLat;
  d: number;
  /** Metres along the road line at q. */
  m: number;
  /** 1 = travelling along the line's direction, -1 = against it. */
  dir: 1 | -1;
  e: number;
}

function kindCost(seg: RoadSeg, k: RoadKind | undefined, end: boolean): number {
  let c = !end && seg.cls === 'service' ? SERVICE_MID : 0;
  if (!k) return c;
  // A router's motorway is a motorway or trunk road on the map; the other way round says little
  // (routers and maps disagree on which expressways count as motorways).
  if (k.motorway && seg.cls !== 'motorway' && seg.cls !== 'trunk') c += 1.5;
  if (k.tunnel !== seg.tunnel) c += 2;
  return c;
}

function candidates(roads: RoadSet, sm: Sample, radius: number, kind: RoadKind | undefined): Cand[] {
  const off: Cand = { seg: null, q: sm.p, d: 0, m: 0, dir: 1, e: OFF_ROAD };
  if (kind?.ferry) return [off];
  const segs = roads.near(sm.p, radius);
  if (!segs) {
    sm.unknown = true;
    return [off];
  }
  const best = new Map<number, Cand>();
  for (const seg of segs) {
    if (seg.len < 0.05) continue;
    const pr = projectSeg(sm.p, seg.a, seg.b);
    if (pr.d > radius) continue;
    const along = Math.abs(angleDiff(seg.brg, sm.brg));
    for (const dir of [1, -1] as const) {
      if (dir === 1 ? along > DIR_TOL || seg.oneway === -1 : 180 - along > DIR_TOL || seg.oneway === 1) continue;
      const key = seg.line * 2 + (dir === 1 ? 0 : 1);
      const e = (pr.d * pr.d) / (2 * SIGMA * SIGMA) + kindCost(seg, kind, sm.end);
      const had = best.get(key);
      if (!had || e < had.e) best.set(key, { seg, q: pr.q, d: pr.d, m: seg.m + pr.t * seg.len, dir, e });
    }
  }
  const list = [...best.values()].sort((a, b) => a.e - b.e).slice(0, MAX_CANDS);
  list.push(off);
  return list;
}

/** A piece cut to the part between m0 and m1 metres along its line (null if none of it is). */
function clip(seg: RoadSeg, m0: number, m1: number): RoadSeg | null {
  const a = Math.max(m0, seg.m);
  const b = Math.min(m1, seg.m + seg.len);
  if (b < a) return null;
  if (a === seg.m && b === seg.m + seg.len) return seg;
  const at = (m: number): LngLat => {
    const t = seg.len > 0 ? (m - seg.m) / seg.len : 0;
    return [seg.a[0] + (seg.b[0] - seg.a[0]) * t, seg.a[1] + (seg.b[1] - seg.a[1]) * t];
  };
  return { ...seg, a: at(a), b: at(b), m: a, len: b - a };
}

/**
 * The road line's pieces within `win` metres along it of position m (cut at the window's ends:
 * a long straight piece must not count as meeting another road far away).
 */
function window(roads: RoadSet, seg: RoadSeg, m: number, win: number): RoadSeg[] {
  const line = roads.line(seg.line);
  if (!line || line[seg.i]?.m !== seg.m) return [clip(seg, m - win, m + win) ?? seg];
  let a = seg.i;
  let b = seg.i;
  while (a > 0 && line[a - 1].m + line[a - 1].len >= m - win) a--;
  while (b + 1 < line.length && line[b + 1].m <= m + win) b++;
  const out: RoadSeg[] = [];
  for (let i = a; i <= b; i++) {
    const c = clip(line[i], m - win, m + win);
    if (c) out.push(c);
  }
  return out;
}

/** The cost of going from one choice at a step to another at the next, with what it has worked out. */
function transitions(roads: RoadSet) {
  const meet = new Map<string, boolean>();
  /** The two roads meet near these places on them (a junction, a ramp's start, the same road in two tiles). */
  const meets = (j: Cand, k: Cand) => {
    const key = `${j.seg!.line}:${j.seg!.i}:${k.seg!.line}:${k.seg!.i}`;
    let v = meet.get(key);
    if (v === undefined) {
      v = false;
      const A = window(roads, j.seg!, j.m, MEET_WINDOW);
      const B = window(roads, k.seg!, k.m, MEET_WINDOW);
      for (const s of A) {
        for (const u of B) if (segGap(s, u).d <= JOIN_GAP) v = true;
        if (v) break;
      }
      meet.set(key, v);
    }
    return v;
  };
  return (j: Cand, k: Cand, step: number): number => {
    if (j.seg && k.seg && j.seg.line === k.seg.line && j.dir === k.dir) {
      const D = (k.m - j.m) * k.dir;
      if (D < -0.5) return BACKWARDS + -D / BETA;
      return Math.abs(D - step) / BETA;
    }
    const D = metres(j.q, k.q);
    let c = Math.abs(D - step) / BETA;
    if (!j.seg !== !k.seg) c += OFF_SWITCH;
    else if (j.seg && k.seg) c += SWITCH + (meets(j, k) ? 0 : HOP);
    return c;
  };
}

/** The route's points every `step` metres, with the router's own points among them. */
function samplesOf(old: Polyline, step: number): Sample[] {
  const out: Sample[] = [];
  const c = old.coords;
  const brgAt = (s: number) => old.bearingAt(Math.max(0, s - 5), 10);
  const end = (s: number) => s < END_ZONE || old.length - s < END_ZONE;
  for (let i = 0; i < c.length; i++) {
    const s0 = old.cum[i];
    out.push({ p: c[i], s: s0, brg: brgAt(s0), v: i, unknown: false, end: end(s0) });
    if (i + 1 >= c.length) break;
    const len = old.cum[i + 1] - s0;
    for (let t = step; t < len - step * 0.5; t += step) {
      const f = t / len;
      const p: LngLat = [c[i][0] + (c[i + 1][0] - c[i][0]) * f, c[i][1] + (c[i + 1][1] - c[i][1]) * f];
      out.push({ p, s: s0 + t, brg: brgAt(s0 + t), v: -1, unknown: false, end: end(s0 + t) });
    }
  }
  return out;
}

/** Nearest point of a road line to p, within `win` metres along it of m0. */
function onLine(roads: RoadSet, line: number, p: LngLat, m0: number, win: number, dir: 1 | -1, radius: number): Cand | null {
  const segs = roads.line(line);
  if (!segs) return null;
  let best: Cand | null = null;
  for (const seg of segs) {
    if (seg.m + seg.len < m0 - win || seg.m > m0 + win) continue;
    const pr = projectSeg(p, seg.a, seg.b);
    if (pr.d > radius || (best && pr.d >= best.d)) continue;
    best = { seg, q: pr.q, d: pr.d, m: seg.m + pr.t * seg.len, dir, e: 0 };
  }
  return best;
}

/** Where two road lines meet near the given positions on them, if they do. */
function joinOf(roads: RoadSet, A: Cand, B: Cand): { q: LngLat; mA: number; mB: number } | null {
  const la = roads.line(A.seg!.line);
  const lb = roads.line(B.seg!.line);
  if (!la || !lb) return null;
  const near = (segs: RoadSeg[], m: number) => segs.map((s) => clip(s, m - JOIN_WINDOW, m + JOIN_WINDOW)).filter((s): s is RoadSeg => !!s);
  let best: { d: number; q: LngLat; mA: number; mB: number; cost: number } | null = null;
  // Roads lying on each other here (the same road in two tiles, a road carrying on under another
  // name): they meet right where the change is.
  for (const [from, to, segs, m0] of [
    [A, 'B', near(lb, B.m), B.m],
    [B, 'A', near(la, A.m), A.m],
  ] as const) {
    for (const u of segs) {
      const pr = projectSeg(from.q, u.a, u.b);
      if (pr.d > JOIN_GAP) continue;
      const m = u.m + pr.t * u.len;
      const cost = pr.d + 0.1 * Math.abs(m - m0);
      if (best && cost >= best.cost) continue;
      best = to === 'B' ? { d: pr.d, q: midpoint(from.q, pr.q), mA: A.m, mB: m, cost } : { d: pr.d, q: midpoint(from.q, pr.q), mA: m, mB: B.m, cost };
    }
  }
  for (const s of near(la, A.m))
    for (const u of near(lb, B.m)) {
      const g = segGap(s, u);
      if (g.d > JOIN_GAP) continue;
      const mA = s.m + g.onS * s.len;
      const mB = u.m + g.onU * u.len;
      // Overlapping lines (the same road in two tiles) touch everywhere: take the place nearest the change.
      const cost = g.d + 0.1 * (Math.abs(mA - A.m) + Math.abs(mB - B.m));
      if (!best || cost < best.cost) best = { d: g.d, q: g.q, mA, mB, cost };
    }
  return best;
}

/** Drops points closer than `tol` metres to the line through their neighbours (kept points stay). */
function simplify(pts: LngLat[], keep: boolean[], tol: number): boolean[] {
  const out = keep.slice();
  const stack: [number, number][] = [];
  let a = 0;
  for (let i = 1; i < pts.length; i++) {
    if (!keep[i] && i < pts.length - 1) continue;
    stack.push([a, i]);
    a = i;
  }
  out[0] = true;
  out[pts.length - 1] = true;
  while (stack.length) {
    const [i, j] = stack.pop()!;
    if (j - i < 2) continue;
    let far = -1;
    let fd = tol;
    for (let k = i + 1; k < j; k++) {
      const d = projectSeg(pts[k], pts[i], pts[j]).d;
      if (d > fd) {
        fd = d;
        far = k;
      }
    }
    if (far >= 0) {
      out[far] = true;
      stack.push([i, far], [far, j]);
    }
  }
  return out;
}

/**
 * Lines a polyline up with the roads. Runs in slices, handing back control between them, so a
 * long route does not hold up the screen (`pause` is awaited between slices).
 */
export async function alignLine(coords: LngLat[], roads: RoadSet, opts: AlignOptions = {}, pause: () => Promise<void> = async () => {}): Promise<AlignedLine | null> {
  const it = alignSteps(coords, roads, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
    await pause();
  }
}

/** The same, all at once (short stretches, such as the road through one junction). */
export function alignLineSync(coords: LngLat[], roads: RoadSet, opts: AlignOptions = {}): AlignedLine | null {
  const it = alignSteps(coords, roads, opts);
  for (;;) {
    const r = it.next();
    if (r.done) return r.value;
  }
}

/** The work, handing back control between slices (a yield). */
function* alignSteps(coords: LngLat[], roads: RoadSet, opts: AlignOptions): Generator<void, AlignedLine | null> {
  if (coords.length < 2) return null;
  const step = opts.step ?? 4;
  const radius = opts.radius ?? 25;
  const old = new Polyline(coords);
  if (old.length < 1) return null;
  const sm = samplesOf(old, step);
  const n = sm.length;

  // Viterbi: the cheapest choice of road for every step.
  const transition = transitions(roads);
  const cands: Cand[][] = new Array(n);
  const from: Int16Array[] = new Array(n);
  let cost = new Float64Array(0);
  for (let i = 0; i < n; i++) {
    if (i > 0 && i % 3000 === 0) yield;
    const cs = candidates(roads, sm[i], radius, opts.kindAt?.(sm[i].s));
    cands[i] = cs;
    const next = new Float64Array(cs.length);
    const back = new Int16Array(cs.length);
    if (i === 0) for (let k = 0; k < cs.length; k++) next[k] = cs[k].e;
    else {
      const prev = cands[i - 1];
      const ds = sm[i].s - sm[i - 1].s;
      for (let k = 0; k < cs.length; k++) {
        let best = Infinity;
        let arg = 0;
        for (let j = 0; j < prev.length; j++) {
          const c = cost[j] + transition(prev[j], cs[k], ds);
          if (c < best) {
            best = c;
            arg = j;
          }
        }
        next[k] = best + cs[k].e;
        back[k] = arg;
      }
    }
    cost = next;
    from[i] = back;
  }
  const pick: Cand[] = new Array(n);
  let k = 0;
  for (let j = 1; j < cost.length; j++) if (cost[j] < cost[k]) k = j;
  for (let i = n - 1; i >= 0; i--) {
    pick[i] = cands[i][k];
    k = from[i][k];
  }

  // Along one road, never back.
  for (let i = 1; i < n; i++) {
    const a = pick[i - 1];
    const b = pick[i];
    if (a.seg && b.seg && a.seg.line === b.seg.line && a.dir === b.dir && (b.m - a.m) * b.dir < 0) pick[i] = { ...b, q: a.q, m: a.m };
  }

  // Road changes pass through the point where the roads meet.
  const joins = new Map<number, LngLat>();
  for (let i = 1; i < n; i++) {
    const A = pick[i - 1];
    const B = pick[i];
    if (!A.seg || !B.seg || A.seg.line === B.seg.line) continue;
    const j = joinOf(roads, A, B);
    if (!j) continue;
    const lineA = A.seg.line;
    const lineB = B.seg.line;
    // Steps on A already past the meeting point belong on B, and steps on B before it on A.
    let first = i;
    for (let x = i - 1; x >= 0 && sm[i - 1].s - sm[x].s <= JOIN_WINDOW; x--) {
      const c = pick[x];
      if (!c.seg || c.seg.line !== lineA || (c.m - j.mA) * c.dir <= 0.3) break;
      const on = onLine(roads, lineB, sm[x].p, j.mB, JOIN_WINDOW, B.dir, radius);
      pick[x] = on && (on.m - j.mB) * B.dir >= 0 ? on : { ...c, q: j.q, m: j.mA };
      first = x;
    }
    for (let x = i; x < n && sm[x].s - sm[i].s <= JOIN_WINDOW; x++) {
      const c = pick[x];
      if (!c.seg || c.seg.line !== lineB || (c.m - j.mB) * c.dir >= -0.3) break;
      const on = onLine(roads, lineA, sm[x].p, j.mA, JOIN_WINDOW, A.dir, radius);
      pick[x] = on && (on.m - j.mA) * A.dir <= 0 ? on : { ...c, q: j.q, m: j.mB };
    }
    // The first step now on B (after any moved onto A).
    let at = first;
    while (at < n && pick[at].seg?.line === lineA) at++;
    joins.set(at, j.q);
    i = Math.max(i, at);
  }

  // The new line: snapped steps, joins between roads, without points that add nothing.
  const pts: LngLat[] = [];
  const oldS: number[] = [];
  const keep: boolean[] = [];
  let matched = 0;
  let unknown = 0;
  let maxMove = 0;
  for (let i = 0; i < n; i++) {
    const join = joins.get(i);
    if (join) {
      pts.push(join);
      oldS.push(NaN);
      keep.push(true);
    }
    const c = pick[i];
    pts.push(c.q);
    oldS.push(sm[i].s);
    keep.push(sm[i].v >= 0);
    if (c.seg) matched++;
    if (sm[i].unknown) unknown++;
    if (c.seg) maxMove = Math.max(maxMove, metres(sm[i].p, c.q));
  }
  const kept = simplify(pts, keep, 0.25);
  const out: LngLat[] = [];
  const outS: number[] = [];
  for (let i = 0; i < pts.length; i++) {
    if (!kept[i]) continue;
    out.push(pts[i]);
    outS.push(oldS[i]);
  }
  return { coords: out, oldS: outS, matched: matched / n, unknown: unknown / n, maxMove };
}

/* ------------------------------------------------------------------ the route */

/** Maps a position on the original line to the lined-up one (both rising, piecewise linear). */
export function positionMap(oldS: number[], newCum: ArrayLike<number>, oldLength: number, newLength: number): (s: number) => number {
  const os: number[] = [];
  const ns: number[] = [];
  for (let i = 0; i < oldS.length; i++) {
    if (Number.isNaN(oldS[i])) continue;
    if (os.length && oldS[i] < os[os.length - 1]) continue;
    os.push(oldS[i]);
    ns.push(newCum[i]);
  }
  return (s: number) => {
    if (!os.length) return s;
    if (s <= os[0]) return ns[0];
    if (s >= oldLength || s >= os[os.length - 1]) return s >= oldLength ? newLength : ns[ns.length - 1];
    let lo = 0;
    let hi = os.length - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (os[mid] <= s) lo = mid;
      else hi = mid;
    }
    const span = os[hi] - os[lo];
    return span > 0 ? ns[lo] + ((ns[hi] - ns[lo]) * (s - os[lo])) / span : ns[lo];
  };
}

/** What the router said about the road along the route (its intersections' classes), by position. */
export function routeKinds(route: Route): (s: number) => RoadKind {
  const marks: { s: number; k: RoadKind }[] = [];
  const kind = (x: Intersection): RoadKind => {
    const c = x.classes ?? [];
    return { motorway: c.includes('motorway'), tunnel: c.includes('tunnel'), ferry: c.includes('ferry') };
  };
  route.steps.forEach((st, i) => {
    const end = route.steps[i + 1]?.s ?? route.line.length;
    st.intersections.forEach((x, k) => {
      const s = k === 0 ? st.s : route.line.project(x.location, st.s, end + 1).s;
      marks.push({ s, k: kind(x) });
    });
  });
  marks.sort((a, b) => a.s - b.s);
  const none: RoadKind = { motorway: false, tunnel: false, ferry: false };
  return (s: number) => {
    let lo = 0;
    let hi = marks.length - 1;
    if (hi < 0 || s < marks[0].s) return marks[0]?.k ?? none;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (marks[mid].s <= s) lo = mid;
      else hi = mid - 1;
    }
    return marks[lo].k;
  };
}

/**
 * The route on the map's roads, with every position along it moved to match. Null when nothing
 * could be lined up (no roads loaded there at all).
 */
export async function alignRoute(route: Route, roads: RoadSet, pause?: () => Promise<void>): Promise<Route | null> {
  const res = await alignLine(route.geometry, roads, { kindAt: routeKinds(route) }, pause);
  if (!res || res.matched === 0) return null;
  const line = new Polyline(res.coords);
  const map = positionMap(res.oldS, line.cum, route.line.length, line.length);
  const steps: Step[] = route.steps.map((st, i) => {
    const s = map(st.s);
    const end = route.steps[i + 1]?.s ?? route.line.length;
    const intersections = st.intersections.map((x, k) => {
      if (k === 0) return { ...x, location: line.pointAt(s) };
      const at = route.line.project(x.location, st.s, end + 1);
      return { ...x, location: line.pointAt(map(at.s)) };
    });
    return { ...st, s, location: line.pointAt(s), intersections };
  });
  const legs = route.legs.map((l, i) => ({ ...l, endS: i === route.legs.length - 1 ? line.length : map(l.endS) }));
  const tollGates = route.tollGates?.map((g) => {
    const s = map(g.s);
    return { ...g, s, at: line.pointAt(s) };
  });
  return {
    ...route,
    geometry: res.coords,
    line,
    steps,
    legs,
    ...(tollGates ? { tollGates } : {}),
    aligned: res.unknown > 0.002 ? 'partial' : 'full',
  };
}
