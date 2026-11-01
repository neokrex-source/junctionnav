/**
 * Offline routing on the pack's road graph: A* over directed segments (so turn restrictions
 * and U-turns can be honoured), then maneuvers in OSRM's response format so the rest of the
 * app (banner, lanes, junction views, signs, tunnels) works the same as online.
 */
import { angleDiff, bearing, haversine, LocalFrame, type LngLat } from '../geo/geo';
import type { OsrmIntersection, OsrmResponse, OsrmStep } from '../routing/osrm';
import { along, cutAt, type OfflineGraph, type Snap } from './graph';
import { CLASSES, F_LINK, F_ONEWAY, F_ONEWAY_REV, F_ROUNDABOUT, F_TOLL, F_TUNNEL, R_NO, R_ONLY } from './graphLayout';

export interface OfflineRouteRequest {
  coords: LngLat[];
  /** Direction of travel at each point (origin heading, stop directions), or null. */
  bearings?: (number | null)[];
  avoid?: { tolls?: boolean; motorways?: boolean };
}

const MOTORWAY = CLASSES.indexOf('motorway');
const TRUNK = CLASSES.indexOf('trunk');
const TERTIARY = CLASSES.indexOf('tertiary');
const UNCLASSIFIED = CLASSES.indexOf('unclassified');
const RESIDENTIAL = CLASSES.indexOf('residential');
/**
 * Long routes leave small roads alone once they are this far (metres) from both the start and
 * the destination, the way a driver would. It keeps searches across the peninsula quick.
 */
const MINOR_RADIUS = 12_000;
const TERTIARY_RADIUS = 35_000;
const MAX_POPS = 6_000_000;

const NONE: [number, number, number][] = [];

/* ------------------------------------------------------------------ heap */

class Heap {
  keys = new Float64Array(1 << 16);
  vals = new Int32Array(1 << 16);
  n = 0;
  push(k: number, v: number) {
    if (this.n === this.keys.length) {
      const k2 = new Float64Array(this.n * 2);
      k2.set(this.keys);
      const v2 = new Int32Array(this.n * 2);
      v2.set(this.vals);
      this.keys = k2;
      this.vals = v2;
    }
    let i = this.n++;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= k) break;
      this.keys[i] = this.keys[p];
      this.vals[i] = this.vals[p];
      i = p;
    }
    this.keys[i] = k;
    this.vals[i] = v;
  }
  topKey() {
    return this.keys[0];
  }
  pop(): number {
    const top = this.vals[0];
    const k = this.keys[--this.n];
    const v = this.vals[this.n];
    let i = 0;
    for (;;) {
      let c = 2 * i + 1;
      if (c >= this.n) break;
      if (c + 1 < this.n && this.keys[c + 1] < this.keys[c]) c++;
      if (this.keys[c] >= k) break;
      this.keys[i] = this.keys[c];
      this.vals[i] = this.vals[c];
      i = c;
    }
    this.keys[i] = k;
    this.vals[i] = v;
    return top;
  }
  clear() {
    this.n = 0;
  }
}

/* ------------------------------------------------------------------ router */

interface Traversal {
  seg: number;
  dir: number;
  way: number;
  pts: LngLat[];
  len: number;
  time: number;
  /** Vertex at the start / end, or -1 where the traversal starts or ends mid-segment. */
  startV: number;
  endV: number;
}

export class OfflineRouter {
  private g: Float64Array;
  private parent: Int32Array;
  private closed: Uint8Array;
  private touched: number[] = [];
  private heap = new Heap();
  private bearA: Float32Array;
  private bearB: Float32Array;
  /** Seconds to drive each segment, and the fastest speed anywhere (m/s) for the A* estimate. */
  private segCost: Float32Array;
  private maxSpeed: number;

  constructor(private G: OfflineGraph) {
    const n = G.h.nS * 2;
    this.g = new Float64Array(n).fill(Infinity);
    this.parent = new Int32Array(n).fill(-1);
    this.closed = new Uint8Array(n);
    this.bearA = new Float32Array(G.h.nS).fill(NaN);
    this.bearB = new Float32Array(G.h.nS).fill(NaN);
    this.segCost = new Float32Array(G.h.nS);
    let top = 30;
    for (let w = 0; w < G.waySpeed.length; w++) if (G.waySpeed[w] > top) top = G.waySpeed[w];
    this.maxSpeed = top / 3.6;
    for (let s = 0; s < G.h.nS; s++) this.segCost[s] = G.segLen[s] / (G.waySpeed[G.segWay[s]] / 3.6);
  }

  /** Bearing leaving the start vertex of a traversal, over its first ~20 m (cached, no allocations). */
  out(seg: number, dir: number): number {
    const arr = dir ? this.bearB : this.bearA;
    let b = arr[seg];
    if (Number.isNaN(b)) {
      b = this.bearingOut(seg, dir);
      arr[seg] = b;
    }
    return b;
  }

  private bearingOut(seg: number, dir: number): number {
    const G = this.G;
    const s0 = G.segShape[seg];
    const s1 = G.segShape[seg + 1];
    const nPts = s1 - s0 + 2;
    const lonAt = (i: number) => (i === 0 ? G.vLon[G.segA[seg]] : i === nPts - 1 ? G.vLon[G.segB[seg]] : G.shapeLon[s0 + i - 1]);
    const latAt = (i: number) => (i === 0 ? G.vLat[G.segA[seg]] : i === nPts - 1 ? G.vLat[G.segB[seg]] : G.shapeLat[s0 + i - 1]);
    const idx = (k: number) => (dir ? nPts - 1 - k : k);
    const lat0 = latAt(idx(0));
    const lon0 = lonAt(idx(0));
    const kx = Math.cos((lat0 / 1e6) * (Math.PI / 180)) * 0.11132; // metres per microdegree of longitude
    const ky = 0.11132;
    let x = 0;
    let y = 0;
    for (let k = 1; k < nPts; k++) {
      x = (lonAt(idx(k)) - lon0) * kx;
      y = (latAt(idx(k)) - lat0) * ky;
      if (x * x + y * y >= 400) break;
    }
    return ((Math.atan2(x, y) * 180) / Math.PI + 360) % 360;
  }

  /** Bearing arriving at the end vertex of a traversal. */
  in(seg: number, dir: number): number {
    return (this.out(seg, dir ? 0 : 1) + 180) % 360;
  }

  private cost(seg: number): number {
    return this.segCost[seg];
  }

  private reset() {
    for (const i of this.touched) {
      this.g[i] = Infinity;
      this.parent[i] = -1;
      this.closed[i] = 0;
    }
    this.touched = [];
    this.heap.clear();
  }

  private set(state: number, g: number, parent: number) {
    if (this.g[state] === Infinity) this.touched.push(state);
    this.g[state] = g;
    this.parent[state] = parent;
  }

  /** Directions a snapped point may be driven through, honouring a heading when one fits. */
  private dirsFor(s: Snap, heading: number | null): number[] {
    const both = [0, 1].filter((d) => this.G.allowed(s.seg, d));
    if (heading == null) return both;
    const fit = both.filter((d) => Math.abs(angleDiff(d ? s.bearing + 180 : s.bearing, heading)) < 90);
    return fit.length ? fit : both;
  }

  private turnCost(angle: number): number {
    const a = Math.abs(angle);
    if (a < 25) return 0;
    if (a < 60) return 3;
    if (a > 150) return 25;
    // Turning across oncoming traffic takes longer: right in left-hand traffic, left otherwise.
    const across = this.G.h.drivingSide === 'left' ? angle > 0 : angle < 0;
    return across ? 12 : 5;
  }

  /** One leg: the sequence of traversals from a to b. */
  private leg(a: Snap, aDirs: number[], b: Snap, bDirs: number[], avoid: OfflineRouteRequest['avoid']): Traversal[] | null {
    // Main roads only in the middle of long routes; if that finds nothing, search everything.
    if (haversine(a.point, b.point) > 2 * MINOR_RADIUS) return this.search(a, aDirs, b, bDirs, avoid, true) ?? this.search(a, aDirs, b, bDirs, avoid, false);
    return this.search(a, aDirs, b, bDirs, avoid, false);
  }

  private search(a: Snap, aDirs: number[], b: Snap, bDirs: number[], avoid: OfflineRouteRequest['avoid'], hierarchy: boolean): Traversal[] | null {
    const G = this.G;
    this.reset();
    const blocked = (seg: number) => {
      if (seg === a.seg || seg === b.seg) return false;
      const w = G.segWay[seg];
      if (avoid?.tolls && G.wayFlags[w] & F_TOLL) return true;
      if (avoid?.motorways && G.wayClass[w] === MOTORWAY) return true;
      return false;
    };
    const goal = b.point;
    const cosLat = Math.cos((goal[1] * Math.PI) / 180);
    const h = (v: number) => {
      const dx = (G.vLon[v] / 1e6 - goal[0]) * cosLat;
      const dy = G.vLat[v] / 1e6 - goal[1];
      return (Math.sqrt(dx * dx + dy * dy) * 111_320) / this.maxSpeed;
    };
    /** Distance (m) from a vertex to the nearer of start and destination. */
    const fromEnds = (v: number) => {
      const x = G.vLon[v] / 1e6;
      const y = G.vLat[v] / 1e6;
      const ds = Math.hypot((x - a.point[0]) * cosLat, y - a.point[1]);
      const dg = Math.hypot((x - goal[0]) * cosLat, y - goal[1]);
      return Math.min(ds, dg) * 111_320;
    };
    // Best way to finish: cost, the state we came from (-1 when on the start segment), direction.
    let best = { cost: Infinity, parent: -1, dir: -1, direct: false };
    for (const d of aDirs) {
      const part = d ? a.t : 1 - a.t;
      const c0 = part * this.cost(a.seg);
      const st = a.seg * 2 + d;
      this.set(st, c0, -1);
      this.heap.push(c0 + h(G.to(a.seg, d)), st);
      if (a.seg === b.seg && bDirs.includes(d) && (d ? b.t <= a.t : b.t >= a.t)) {
        const c = Math.abs(b.t - a.t) * this.cost(a.seg);
        if (c < best.cost) best = { cost: c, parent: -1, dir: d, direct: true };
      }
    }
    const hasRestrictions = G.rVia.length > 0;
    let pops = 0;
    while (this.heap.n) {
      if (this.heap.topKey() >= best.cost) break;
      const u = this.heap.pop();
      if (this.closed[u]) continue;
      this.closed[u] = 1;
      if (++pops > MAX_POPS) return null;
      const s = u >> 1;
      const d = u & 1;
      const v = G.to(s, d);
      const inB = this.in(s, d);
      const fromWay = G.segWay[s];
      const rs = hasRestrictions ? G.restrictionsAt(v) : NONE;
      const deg = G.adjStart[v + 1] - G.adjStart[v];
      const away = hierarchy ? fromEnds(v) : 0;
      const minClass = away > TERTIARY_RADIUS ? TERTIARY : away > MINOR_RADIUS ? UNCLASSIFIED : 99;
      for (let k = G.adjStart[v]; k < G.adjStart[v + 1]; k++) {
        const e = G.adj[k];
        const s2 = e >>> 1;
        const d2 = e & 1;
        if (!G.allowed(s2, d2) || blocked(s2)) continue;
        if (G.wayClass[G.segWay[s2]] >= minClass) continue;
        let extra = 0;
        if (s2 === s) {
          if (deg > 1) continue; // no U-turns except at dead ends
          extra = 30;
        }
        const toWay = G.segWay[s2];
        if (rs.length) {
          if (rs.some(([f, t, ty]) => ty === R_NO && f === fromWay && t === toWay)) continue;
          const only = rs.filter(([f, , ty]) => ty === R_ONLY && f === fromWay);
          if (only.length && !only.some(([, t]) => t === toWay)) continue;
        }
        const base = this.g[u] + extra + this.turnCost(angleDiff(inB, this.out(s2, d2)));
        if (s2 === b.seg && bDirs.includes(d2)) {
          const c = base + (d2 ? 1 - b.t : b.t) * this.cost(b.seg);
          if (c < best.cost) best = { cost: c, parent: u, dir: d2, direct: false };
        }
        const gNew = base + this.cost(s2);
        const st = s2 * 2 + d2;
        if (gNew < this.g[st]) {
          this.set(st, gNew, u);
          this.heap.push(gNew + h(G.to(s2, d2)), st);
        }
      }
    }
    if (best.cost === Infinity) return null;

    // Rebuild the chain of states.
    const states: number[] = [];
    if (best.direct) states.push(a.seg * 2 + best.dir);
    else {
      states.push(b.seg * 2 + best.dir);
      for (let u = best.parent; u >= 0; u = this.parent[u]) states.push(u);
      states.reverse();
    }
    return states.map((st, i) => {
      const seg = st >> 1;
      const dir = st & 1;
      let pts = G.points(seg, dir);
      const first = i === 0;
      const last = i === states.length - 1;
      const ta = dir ? 1 - a.t : a.t;
      const tb = dir ? 1 - b.t : b.t;
      if (first && last) pts = cutAt(cutAt(pts, tb)[0], ta / Math.max(1e-9, tb))[1];
      else if (first) pts = cutAt(pts, ta)[1];
      else if (last) pts = cutAt(pts, tb)[0];
      let len = 0;
      for (let k = 1; k < pts.length; k++) len += haversine(pts[k - 1], pts[k]);
      return {
        seg,
        dir,
        way: G.segWay[seg],
        pts,
        len,
        time: len / (this.G.waySpeed[this.G.segWay[seg]] / 3.6),
        startV: first ? -1 : G.from(seg, dir),
        endV: last ? -1 : G.to(seg, dir),
      };
    });
  }

  route(req: OfflineRouteRequest): OsrmResponse {
    const last = req.coords.length - 1;
    const snaps = req.coords.map((c, i) => this.snapConnected(c, req.bearings?.[i] ?? null, i < last, i > 0));
    const bad = snaps.findIndex((s) => !s);
    if (bad >= 0) return { code: 'NoSegment', message: bad === 0 ? 'The start is not near a road in the offline area.' : 'The destination is not near a road in the offline area.' };
    const legs: OsrmRoute['legs'] = [];
    const coords: LngLat[] = [];
    let total = 0;
    let totalTime = 0;
    for (let i = 0; i < snaps.length - 1; i++) {
      const a = snaps[i]!;
      const b = snaps[i + 1]!;
      const aDirs = this.dirsFor(a, i === 0 ? req.bearings?.[0] ?? null : req.bearings?.[i] ?? null);
      const bDirs = this.dirsFor(b, req.bearings?.[i + 1] ?? null);
      const trav = this.leg(a, aDirs, b, bDirs, req.avoid);
      if (!trav) return { code: 'NoRoute', message: 'No route found in the offline road data.' };
      const steps = this.steps(trav, req.coords[i + 1], i === snaps.length - 2);
      const pts = trav.flatMap((t, k) => (k === 0 ? t.pts : t.pts.slice(1)));
      for (const p of coords.length ? pts.slice(1) : pts) coords.push(p);
      const dist = trav.reduce((x, t) => x + t.len, 0);
      const time = trav.reduce((x, t) => x + t.time, 0);
      total += dist;
      totalTime += time;
      legs.push({ steps, summary: this.summary(trav), distance: dist, duration: time });
    }
    return { code: 'Ok', routes: [{ distance: total, duration: totalTime, geometry: { type: 'LineString', coordinates: coords }, legs }] };
  }

  /**
   * Nearest road that actually connects to the network: a point next to a car park loop or a
   * cut-off private road moves to the nearest street that can be driven from (and to).
   */
  private snapConnected(p: LngLat, heading: number | null, out: boolean, inn: boolean): Snap | null {
    const G = this.G;
    const levels: (((seg: number) => boolean) | undefined)[] = [
      undefined,
      (seg) => G.wayClass[G.segWay[seg]] <= RESIDENTIAL,
      (seg) => G.wayClass[G.segWay[seg]] <= TERTIARY,
    ];
    let first: Snap | null = null;
    for (const accept of levels) {
      const s = G.snap(p, heading, 2000, accept);
      if (!s) continue;
      first ??= s;
      const cut = (out && G.isolated(G.segB[s.seg], false) && G.isolated(G.segA[s.seg], false)) || (inn && G.isolated(G.segA[s.seg], true) && G.isolated(G.segB[s.seg], true));
      if (!cut) return s;
    }
    return first;
  }

  /* ------------------------------------------------------------------ maneuvers */

  private summary(trav: Traversal[]): string {
    const by = new Map<string, number>();
    for (const t of trav) {
      const tg = this.G.tags(t.way);
      const key = tg.ref ? tg.ref.split(';')[0] : tg.name;
      if (key) by.set(key, (by.get(key) ?? 0) + t.len);
    }
    return [...by.entries()]
      .sort((x, y) => y[1] - x[1])
      .slice(0, 2)
      .map((e) => e[0])
      .join(', ');
  }

  private classes(way: number): string[] | undefined {
    const G = this.G;
    const c: string[] = [];
    if (G.wayClass[way] === MOTORWAY) c.push('motorway');
    if (G.wayFlags[way] & F_TOLL) c.push('toll');
    if (G.wayFlags[way] & F_TUNNEL) c.push('tunnel');
    return c.length ? c : undefined;
  }

  /** "E1, AH2: Ipoh, Kuala Lumpur" from destination tags, looking along a chain of ramps. */
  private destinations(trav: Traversal[], from: number): string | undefined {
    for (let i = from; i < trav.length; i++) {
      const t = trav[i];
      const tg = this.G.tags(t.way);
      const dirKey = t.dir ? 'backward' : 'forward';
      const refs = (tg[`destination:ref:${dirKey}`] ?? tg['destination:ref'] ?? '').split(';').map((s) => s.trim()).filter(Boolean);
      const places = (tg[`destination:${dirKey}`] ?? tg.destination ?? '').split(';').map((s) => s.trim()).filter(Boolean);
      if (refs.length || places.length) return refs.length ? `${refs.join(', ')}: ${places.join(', ')}` : places.join(', ');
      if (!(this.G.wayFlags[t.way] & F_LINK)) break;
    }
    return undefined;
  }

  /**
   * Lanes at the end of a traversal. Lanes whose arrows match the maneuver are valid; at forks
   * and ramps, where arrows say "through" for the branch that keeps going, the lanes on the side
   * of the branch taken are valid (rightmost arrows when keeping right, and so on).
   */
  private lanes(t: Traversal, modifier: string, keep: 'left' | 'right' | 'middle' | null = null): OsrmIntersection['lanes'] {
    const tg = this.G.tags(t.way);
    const f = this.G.wayFlags[t.way];
    const oneway = (t.dir === 0 && f & F_ONEWAY) || (t.dir === 1 && f & F_ONEWAY_REV);
    const raw = t.dir === 0 ? tg['turn:lanes:forward'] ?? (oneway ? tg['turn:lanes'] : undefined) : tg['turn:lanes:backward'] ?? (oneway ? tg['turn:lanes'] : undefined);
    if (!raw) return undefined;
    const map: Record<string, string> = {
      through: 'straight',
      left: 'left',
      right: 'right',
      slight_left: 'slight left',
      slight_right: 'slight right',
      sharp_left: 'sharp left',
      sharp_right: 'sharp right',
      reverse: 'uturn',
      merge_to_left: 'straight',
      merge_to_right: 'straight',
      none: 'none',
      '': 'none',
    };
    const ok: Record<string, string[]> = {
      straight: ['straight', 'none'],
      'slight right': ['slight right', 'right'],
      right: ['right', 'slight right', 'sharp right'],
      'sharp right': ['sharp right', 'right'],
      'slight left': ['slight left', 'left'],
      left: ['left', 'slight left', 'sharp left'],
      'sharp left': ['sharp left', 'left'],
      uturn: ['uturn'],
    };
    const lanes = raw.split('|').map((l) => {
      const ind = [...new Set(l.split(';').map((x) => map[x.trim()] ?? 'none'))];
      return { indications: ind, valid: ind.some((i) => (ok[modifier] ?? []).includes(i)) };
    });
    if (lanes.some((l) => l.valid) && lanes.some((l) => !l.valid)) return lanes;
    if (keep) {
      const dirOf = (ind: string[]) => Math.max(...ind.map((i) => (/left/.test(i) ? -1 : /right/.test(i) ? 1 : 0)));
      const vals = lanes.map((l) => dirOf(l.indications));
      const want = keep === 'right' ? Math.max(...vals) : keep === 'left' ? Math.min(...vals) : 0;
      if (new Set(vals).size > 1 && vals.includes(want)) return lanes.map((l, i) => ({ ...l, valid: vals[i] === want }));
    }
    return undefined;
  }

  /**
   * Which way to merge: toward the side the main road comes from. Compares where our ramp and
   * the main road are 30 m back, measured across the direction of travel after the merge.
   */
  private mergeSide(v: number, a: Traversal, b: Traversal, outB: number): string {
    const G = this.G;
    const here = G.vertex(v);
    const lateral = (p: LngLat) => {
      const f = new LocalFrame(here);
      const [x, y] = f.toXY(p);
      const h = (outB * Math.PI) / 180;
      return x * Math.cos(h) - y * Math.sin(h);
    };
    const ours = lateral(along([...a.pts].reverse(), 30));
    for (let k = G.adjStart[v]; k < G.adjStart[v + 1]; k++) {
      const e = G.adj[k];
      const s = e >>> 1;
      const d = e & 1;
      if (s === a.seg || s === b.seg || !G.allowed(s, d ? 0 : 1)) continue;
      const w = G.segWay[s];
      if (G.wayFlags[w] & F_LINK || (G.wayClass[w] !== MOTORWAY && G.wayClass[w] !== TRUNK)) continue;
      const main = lateral(along(G.points(s, d), 30));
      return main > ours ? 'slight right' : 'slight left';
    }
    return G.h.drivingSide === 'left' ? 'slight right' : 'slight left';
  }

  private modifier(angle: number): string {
    const a = Math.abs(angle);
    if (a < 15) return 'straight';
    const side = angle > 0 ? 'right' : 'left';
    if (a < 60) return `slight ${side}`;
    if (a < 135) return side;
    if (a < 170) return `sharp ${side}`;
    return 'uturn';
  }

  private intersection(v: number, inT: Traversal | null, outT: Traversal, lanes?: OsrmIntersection['lanes']): OsrmIntersection {
    const G = this.G;
    const items: { b: number; entry: boolean; isIn: boolean; isOut: boolean }[] = [];
    for (let k = G.adjStart[v]; k < G.adjStart[v + 1]; k++) {
      const e = G.adj[k];
      const s = e >>> 1;
      const d = e & 1;
      items.push({
        b: Math.round(this.out(s, d)),
        entry: G.allowed(s, d) && !(inT && s === inT.seg),
        isIn: !!inT && s === inT.seg && d !== inT.dir,
        isOut: s === outT.seg && d === outT.dir,
      });
    }
    items.sort((x, y) => x.b - y.b);
    const inI = items.findIndex((x) => x.isIn);
    const outI = items.findIndex((x) => x.isOut);
    return {
      location: G.vertex(v),
      bearings: items.map((x) => x.b),
      entry: items.map((x) => x.entry),
      in: inI >= 0 ? inI : undefined,
      out: outI >= 0 ? outI : undefined,
      lanes,
      classes: this.classes(outT.way),
    };
  }

  private steps(trav: Traversal[], requested: LngLat, lastLeg: boolean): OsrmStep[] {
    const G = this.G;
    const side = G.h.drivingSide;
    const steps: OsrmStep[] = [];
    const nameOf = (w: number) => G.tags(w).name ?? '';
    const refOf = (w: number) => G.tags(w).ref?.split(';').join('; ') || undefined;
    const isLink = (w: number) => (G.wayFlags[w] & F_LINK) !== 0;
    const isRound = (w: number) => (G.wayFlags[w] & F_ROUNDABOUT) !== 0;
    const isMajor = (w: number) => G.wayClass[w] === MOTORWAY || G.wayClass[w] === TRUNK;
    const make = (type: string, modifier: string | undefined, loc: LngLat, before: number, after: number, t: Traversal, ix: OsrmIntersection, extra: Partial<OsrmStep> = {}): OsrmStep => ({
      distance: 0,
      duration: 0,
      name: nameOf(t.way),
      ref: refOf(t.way),
      mode: 'driving',
      driving_side: side,
      maneuver: { type, modifier, location: loc, bearing_before: Math.round(before), bearing_after: Math.round(after) },
      intersections: [ix],
      ...extra,
    });

    const first = trav[0];
    const b0 = bearing(first.pts[0], along(first.pts, 20));
    steps.push(make('depart', undefined, first.pts[0], 0, b0, first, { location: first.pts[0], bearings: [Math.round(b0)], entry: [true], out: 0, classes: this.classes(first.way) }));
    let cur = steps[0];
    let curClasses = (this.classes(first.way) ?? []).join();
    let round: { step: OsrmStep; exits: number; entryB: number } | null = null;

    const addLen = (t: Traversal) => {
      cur.distance += t.len;
      cur.duration += t.time;
    };
    addLen(first);

    for (let i = 0; i < trav.length - 1; i++) {
      const a = trav[i];
      const b = trav[i + 1];
      const v = a.endV;
      const loc = G.vertex(v);
      const inB = this.in(a.seg, a.dir);
      const outB = this.out(b.seg, b.dir);
      const angle = angleDiff(inB, outB);
      // Other ways one could take here.
      const others: { angle: number; way: number }[] = [];
      for (let k = G.adjStart[v]; k < G.adjStart[v + 1]; k++) {
        const e = G.adj[k];
        const s = e >>> 1;
        const d = e & 1;
        if (s === a.seg || (s === b.seg && d === b.dir) || !G.allowed(s, d)) continue;
        others.push({ angle: angleDiff(inB, this.out(s, d)), way: G.segWay[s] });
      }
      let type: string | null = null;
      let modifier: string | undefined;
      let extra: Partial<OsrmStep> = {};

      if (round) {
        if (isRound(b.way)) {
          if (others.length) round.exits++;
        } else {
          round.exits++;
          round.step.maneuver.exit = round.exits;
          round.step.maneuver.modifier = this.modifier(angleDiff(round.entryB, outB));
          round = null;
          // Leaving the roundabout is part of the roundabout step.
        }
        addLen(b);
        continue;
      }
      if (!isRound(a.way) && isRound(b.way)) {
        type = 'roundabout';
        modifier = 'straight';
      } else {
        const forward = others.filter((o) => Math.abs(o.angle) < 50);
        const rank = (w: number) => (isLink(w) ? 10 : G.wayClass[w]);
        const similar = forward.filter((o) => Math.abs(rank(o.way) - rank(b.way)) <= 1 || (isLink(o.way) && isLink(b.way)));
        const keepSide = (os: { angle: number }[]) =>
          os.every((o) => angle > o.angle) ? 'slight right' : os.every((o) => angle < o.angle) ? 'slight left' : 'straight';
        const target = !isLink(a.way) && isLink(b.way) ? trav.slice(i + 1).find((t) => !isLink(t.way)) : undefined;
        const onto = target ? G.wayClass[target.way] : -1;
        if (!isLink(a.way) && isLink(b.way) && (G.wayClass[a.way] === MOTORWAY || (isMajor(a.way) && onto !== MOTORWAY))) {
          // Leaving an expressway (or a trunk road for an ordinary road).
          type = 'off ramp';
          modifier = forward.length ? keepSide(forward) : this.modifier(angle);
          const j = G.junctionAt(v);
          if (j?.ref) extra.exits = j.ref;
        } else if (!isLink(a.way) && isLink(b.way)) {
          type = onto === MOTORWAY || (onto === TRUNK && !isMajor(a.way)) ? 'on ramp' : Math.abs(angle) < 35 && similar.length ? 'fork' : 'turn';
          modifier = type === 'fork' ? keepSide(similar) : forward.length && Math.abs(angle) < 50 ? keepSide(forward) : this.modifier(angle);
        } else if (isLink(a.way) && !isLink(b.way) && isMajor(b.way)) {
          type = 'merge';
          modifier = this.mergeSide(v, a, b, outB);
        } else if (Math.abs(angle) < 50 && similar.length) {
          type = 'fork';
          modifier = keepSide(similar);
        } else if (Math.abs(angle) >= 35 && others.length) {
          const goesOn = others.some((o) => Math.abs(o.angle) < 35);
          const oppositeSide = others.some((o) => Math.sign(o.angle) !== Math.sign(angle));
          type = !goesOn && oppositeSide && Math.abs(angle) >= 50 ? 'end of road' : 'turn';
          modifier = this.modifier(angle);
        } else {
          const ta = G.tags(a.way);
          const tb = G.tags(b.way);
          const sameRef = !!ta.ref && ta.ref === tb.ref;
          if (!sameRef && (ta.name ?? '') !== (tb.name ?? '') && (tb.name || tb.ref)) {
            type = 'new name';
            modifier = this.modifier(angle);
          }
        }
      }

      if (type) {
        const keep = type === 'fork' || type === 'off ramp' || type === 'on ramp' ? (modifier === 'slight right' ? 'right' : modifier === 'slight left' ? 'left' : modifier === 'straight' ? 'middle' : null) : null;
        const lanes = type === 'roundabout' ? undefined : this.lanes(a, modifier ?? 'straight', keep);
        const dest = type === 'on ramp' || type === 'off ramp' || type === 'fork' || type === 'merge' ? this.destinations(trav, i + 1) : undefined;
        const step = make(type, modifier, loc, inB, outB, b, this.intersection(v, a, b, lanes), { ...extra, destinations: dest });
        steps.push(step);
        cur = step;
        curClasses = (this.classes(b.way) ?? []).join();
        if (type === 'roundabout') round = { step, exits: 0, entryB: inB };
      } else {
        // Road classes changing mid-step (toll, tunnel) get an intersection of their own.
        const cls = (this.classes(b.way) ?? []).join();
        if (cls !== curClasses) {
          cur.intersections.push(this.intersection(v, a, b));
          curClasses = cls;
        }
      }
      addLen(b);
    }

    // Arrival, with the side of the road when the requested point is off to one side.
    const last = trav[trav.length - 1];
    const end = last.pts[last.pts.length - 1];
    const prev = last.pts.length > 1 ? last.pts[last.pts.length - 2] : end;
    const inB = last.pts.length > 1 ? bearing(prev, end) : 0;
    let modifier: string | undefined;
    if (haversine(end, requested) > 5) {
      const f = new LocalFrame(end);
      const [rx, ry] = f.toXY(requested);
      const [px, py] = f.toXY(prev);
      const cross = -px * ry + py * rx;
      modifier = cross > 0 ? 'left' : 'right';
    }
    steps.push(
      make('arrive', modifier, end, inB, 0, last, { location: end, bearings: [Math.round((inB + 180) % 360)], entry: [true], in: 0 }),
    );
    void lastLeg;
    return steps;
  }
}

type OsrmRoute = NonNullable<OsrmResponse['routes']>[number];
