/**
 * Road heights around a junction, for the junction view and its height profile.
 *
 * A road's height is the ground under it plus the structure it is on.
 *
 * - Ground comes from a terrain model when one is available (hills, valleys), flat otherwise.
 *   Bridges and tunnels do not follow the ground below or above them: their base runs between
 *   the ground at the ends of the structure.
 * - Structure heights come from OSM. Where roads cross on different levels, the upper one clears
 *   the lower one by the lower road's signed headroom (`maxheight` plus 1.3 m of deck) or a
 *   standard 6.8 m (5.4 m headroom and a 1.4 m deck). Underpasses sit the same way below the road
 *   above. Long bridges and viaducts stay up between crossings, short bridges get a small hump,
 *   and every structure meets the ground at its ends at a drivable grade.
 * - Roads climb and descend at realistic grades (4.5 % on expressways, 5 % on main roads, 6.5 %
 *   on ramps). Main roads keep their level where ramps join them, so the ramp does the climbing.
 *
 * All heights are in metres. `heightAt` gives ground + structure, `structureAt` the structure
 * part only (what a driver sees as "going up onto a flyover"), `groundAt` the ground.
 */
import { clamp, LocalFrame, type XY } from '../geo/geo';
import type { OsmData } from './osmdata';

type Tags = Record<string, string>;
export type GroundFn = (p: XY) => number;

/** Height of one OSM layer: 5.4 m headroom plus a 1.4 m deck. */
export const LEVEL = 6.8;
/** Deck and margin added to a signed headroom (`maxheight`). */
const DECK = 1.3;
/** Hump of a short bridge over a drain or stream. */
const SMALL = 1.2;
/** Longest piece of road between height samples. */
const SEG = 8;
/** How much steeper a road may get than its usual grade to meet a fixed point. */
const STEEP = 1.6;

export function wayLevel(t: Tags | undefined): number {
  const l = parseInt(t?.layer ?? '', 10);
  if (Number.isFinite(l)) return clamp(l, -3, 4);
  if (t?.bridge && t.bridge !== 'no') return 1;
  if ((t?.tunnel && t.tunnel !== 'no') || t?.covered === 'yes') return -1;
  return 0;
}

/** "5", "5.4 m", "4.5m", "16'6\"" → metres; null for none/default/unparseable. */
export function parseHeight(v: string | undefined): number | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  const ft = /^(\d+(?:\.\d+)?)\s*'\s*(?:(\d+(?:\.\d+)?)\s*"?)?$/.exec(s);
  if (ft) return Number(ft[1]) * 0.3048 + Number(ft[2] ?? 0) * 0.0254;
  const m = /^(\d+(?:\.\d+)?)\s*(m|metres?|meters?)?$/.exec(s);
  if (!m) return null;
  const n = Number(m[1]);
  return n > 1.5 && n < 12 ? n : null;
}

/** Order in which roads are settled: expressways first, ramps last. */
function prioOf(t: Tags): number {
  const hw = t.highway ?? '';
  if (hw.endsWith('_link')) return 3;
  if (hw === 'motorway' || hw === 'trunk') return 0;
  if (hw === 'primary' || hw === 'secondary') return 1;
  return 2;
}

function gradeOf(t: Tags): number {
  const hw = t.highway ?? '';
  if (hw.endsWith('_link')) return 0.065;
  if (hw === 'motorway' || hw === 'trunk') return 0.045;
  if (hw === 'primary' || hw === 'secondary') return 0.05;
  return 0.07;
}

interface WayInfo {
  tags: Tags;
  level: number;
  tunnel: boolean;
  prio: number;
  grade: number;
  /** Signed headroom under structures above this road, metres. */
  headroom: number | null;
  major: boolean;
}

interface Crossing {
  /** Upper and lower edges, and the vertex of each nearest to the crossing point. */
  eu: number;
  el: number;
  vu: number;
  vl: number;
}

class Heap {
  k: number[] = [];
  v: number[] = [];
  push(key: number, val: number) {
    const k = this.k;
    const v = this.v;
    let i = k.length;
    k.push(key);
    v.push(val);
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (k[p] <= key) break;
      k[i] = k[p];
      v[i] = v[p];
      i = p;
    }
    k[i] = key;
    v[i] = val;
  }
  pop(): [number, number] {
    const k = this.k;
    const v = this.v;
    const top: [number, number] = [k[0], v[0]];
    const lk = k.pop()!;
    const lv = v.pop()!;
    if (k.length) {
      let i = 0;
      for (;;) {
        let c = 2 * i + 1;
        if (c >= k.length) break;
        if (c + 1 < k.length && k[c + 1] < k[c]) c++;
        if (k[c] >= lk) break;
        k[i] = k[c];
        v[i] = v[c];
        i = c;
      }
      k[i] = lk;
      v[i] = lv;
    }
    return top;
  }
  get size() {
    return this.k.length;
  }
}

export interface VerticalOptions {
  /** Metres around the junction to model (default 900). */
  radius?: number;
  /** Ground height at a local point (terrain); flat when missing. */
  ground?: GroundFn;
}

export class VerticalModel {
  readonly hasGround: boolean;
  private vx: number[] = [];
  private vy: number[] = [];
  private vadj: number[][] = [];
  private ea: number[] = [];
  private eb: number[] = [];
  private elen: number[] = [];
  private eway: number[] = [];
  private ways: WayInfo[] = [];
  private grid = new Map<string, number[]>();
  private readonly cell = 20;
  private radius: number;
  private ground: Float64Array = new Float64Array(0);
  private base: Float64Array = new Float64Array(0);
  private off: Float64Array = new Float64Array(0);
  /** Crossings between roads on different levels, kept for checks and tests. */
  readonly crossings: { upper: Tags; lower: Tags; at: XY; clearance: number }[] = [];

  constructor(osm: OsmData, frame: LocalFrame, opts: VerticalOptions = {}) {
    this.radius = opts.radius ?? 900;
    this.hasGround = !!opts.ground;
    this.build(osm, frame);
    const n = this.vx.length;
    this.ground = new Float64Array(n);
    if (opts.ground) for (let v = 0; v < n; v++) this.ground[v] = opts.ground([this.vx[v], this.vy[v]]);
    this.base = this.computeBase();
    this.off = this.solveAll();
  }

  /* -------------------------------------------------------------- graph */

  private vertex(p: XY): number {
    this.vx.push(p[0]);
    this.vy.push(p[1]);
    this.vadj.push([]);
    return this.vx.length - 1;
  }

  private build(osm: OsmData, frame: LocalFrame) {
    const R = this.radius;
    const nodeV = new Map<number, number>();
    for (const way of osm.ways) {
      if (!way.geometry?.length || way.nodes.length < 2) continue;
      const pts = way.geometry.map((g) => frame.toXY([g.lon, g.lat]));
      if (pts.every((p) => Math.hypot(p[0], p[1]) > R + 400)) continue;
      const wi = this.ways.length;
      const t = way.tags ?? {};
      this.ways.push({
        tags: t,
        level: wayLevel(t),
        tunnel: (!!t.tunnel && t.tunnel !== 'no') || t.covered === 'yes',
        prio: prioOf(t),
        grade: gradeOf(t),
        headroom: parseHeight(t.maxheight) ?? parseHeight(t['maxheight:physical']),
        major: /^(motorway|trunk|primary)/.test(t.highway ?? ''),
      });
      let prevV = -1;
      let prevP: XY | null = null;
      for (let i = 0; i < way.nodes.length; i++) {
        const p = pts[i];
        let v = nodeV.get(way.nodes[i]);
        if (v === undefined) {
          v = this.vertex(p);
          nodeV.set(way.nodes[i], v);
        }
        if (prevP && prevV >= 0 && prevV !== v) {
          const len = Math.hypot(p[0] - prevP[0], p[1] - prevP[1]);
          if (len > 0.05 && Math.min(Math.hypot(prevP[0], prevP[1]), Math.hypot(p[0], p[1])) <= R) {
            const k = Math.max(1, Math.ceil(len / SEG));
            let a = prevV;
            for (let j = 1; j <= k; j++) {
              const b = j === k ? v : this.vertex([prevP[0] + ((p[0] - prevP[0]) * j) / k, prevP[1] + ((p[1] - prevP[1]) * j) / k]);
              this.addEdge(a, b, len / k, wi);
              a = b;
            }
          }
        }
        prevV = v;
        prevP = p;
      }
    }
  }

  private addEdge(a: number, b: number, len: number, way: number) {
    const e = this.ea.length;
    this.ea.push(a);
    this.eb.push(b);
    this.elen.push(len);
    this.eway.push(way);
    this.vadj[a].push(e);
    this.vadj[b].push(e);
    const c = this.cell;
    const x0 = Math.floor(Math.min(this.vx[a], this.vx[b]) / c);
    const x1 = Math.floor(Math.max(this.vx[a], this.vx[b]) / c);
    const y0 = Math.floor(Math.min(this.vy[a], this.vy[b]) / c);
    const y1 = Math.floor(Math.max(this.vy[a], this.vy[b]) / c);
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++) {
        const k = `${x},${y}`;
        const list = this.grid.get(k);
        if (list) list.push(e);
        else this.grid.set(k, [e]);
      }
  }

  private other(e: number, v: number): number {
    return this.ea[e] === v ? this.eb[e] : this.ea[e];
  }

  private level(e: number): number {
    return this.ways[this.eway[e]].level;
  }

  /* -------------------------------------------------------------- ground under structures */

  /**
   * Base height of every point: the ground, except inside bridges and tunnels, where it runs
   * between the ground at the two nearest ends of the structure (a viaduct over a valley does
   * not dip into it; a tunnel does not climb over the hill).
   */
  private computeBase(): Float64Array {
    const n = this.vx.length;
    const base = Float64Array.from(this.ground);
    if (!this.hasGround) return base;
    const interior = (v: number) => this.vadj[v].length > 0 && this.vadj[v].every((e) => this.level(e) !== 0);
    // Two nearest distinct ends per interior point, along structure edges.
    const d1 = new Float64Array(n).fill(Infinity);
    const d2 = new Float64Array(n).fill(Infinity);
    const s1 = new Int32Array(n).fill(-1);
    const s2 = new Int32Array(n).fill(-1);
    const heap = new Heap();
    for (let v = 0; v < n; v++) {
      if (interior(v) || !this.vadj[v].some((e) => this.level(e) !== 0)) continue;
      d1[v] = 0;
      s1[v] = v;
      heap.push(0, v * 2);
    }
    while (heap.size) {
      const [d, code] = heap.pop();
      const v = code >> 1;
      const slot = code & 1;
      const src = slot ? s2[v] : s1[v];
      if ((slot ? d2[v] : d1[v]) < d) continue;
      for (const e of this.vadj[v]) {
        if (this.level(e) === 0) continue;
        const w = this.other(e, v);
        if (!interior(w)) continue;
        const nd = d + this.elen[e];
        if (src === s1[w]) {
          if (nd < d1[w]) {
            d1[w] = nd;
            heap.push(nd, w * 2);
          }
        } else if (nd < d1[w]) {
          d2[w] = d1[w];
          s2[w] = s1[w];
          d1[w] = nd;
          s1[w] = src;
          heap.push(nd, w * 2);
          if (s2[w] >= 0) heap.push(d2[w], w * 2 + 1);
        } else if (src !== s1[w] && nd < d2[w]) {
          d2[w] = nd;
          s2[w] = src;
          heap.push(nd, w * 2 + 1);
        }
      }
    }
    for (let v = 0; v < n; v++) {
      if (!interior(v) || s1[v] < 0) continue;
      if (s2[v] < 0) base[v] = this.ground[s1[v]];
      else base[v] = (this.ground[s1[v]] * d2[v] + this.ground[s2[v]] * d1[v]) / (d1[v] + d2[v]);
    }
    return this.limitGrades(this.smoothAlongRoads(base));
  }

  /**
   * No road climbs steeper than its class allows (expressways 7 %, main roads 9 %, ramps 10 %,
   * minor roads 14 %): the base is set midway between the lowest and highest profiles that keep
   * those grades, which removes what terrain noise is left on steep-looking stretches.
   */
  private limitGrades(base: Float64Array): Float64Array {
    const n = this.vx.length;
    const maxGrade = (e: number) => {
      const hw = this.ways[this.eway[e]].tags.highway ?? '';
      return hw.endsWith('_link') ? 0.1 : hw === 'motorway' || hw === 'trunk' ? 0.07 : hw === 'primary' || hw === 'secondary' ? 0.09 : 0.14;
    };
    const run = (sign: 1 | -1) => {
      const key = new Float64Array(n);
      const heap = new Heap();
      for (let v = 0; v < n; v++) {
        key[v] = -sign * base[v];
        if (this.vadj[v].length) heap.push(key[v], v);
      }
      while (heap.size) {
        const [k, v] = heap.pop();
        if (k > key[v]) continue;
        for (const e of this.vadj[v]) {
          const w = this.other(e, v);
          const nk = k + maxGrade(e) * this.elen[e];
          if (nk < key[w]) {
            key[w] = nk;
            heap.push(nk, w);
          }
        }
      }
      return key.map((k) => -sign * k);
    };
    const lo = run(1);
    const hi = run(-1);
    return base.map((b, v) => (this.vadj[v].length ? (lo[v] + hi[v]) / 2 : b));
  }

  /**
   * Roads are graded: they cut through small rises and fill small dips. Smoothing the base along
   * the road network (over roughly 50 m) removes what is left of terrain noise without moving
   * the road off the lie of the land.
   */
  private smoothAlongRoads(base: Float64Array): Float64Array {
    const n = this.vx.length;
    let cur = base;
    for (let it = 0; it < 40; it++) {
      const next = new Float64Array(n);
      for (let v = 0; v < n; v++) {
        const adj = this.vadj[v];
        if (!adj.length) {
          next[v] = cur[v];
          continue;
        }
        let sum = 0;
        for (const e of adj) sum += cur[this.other(e, v)];
        next[v] = 0.5 * cur[v] + (0.5 * sum) / adj.length;
      }
      cur = next;
    }
    return cur;
  }

  /* -------------------------------------------------------------- crossings */

  private findCrossings(): Crossing[] {
    const out: Crossing[] = [];
    const seen = new Set<string>();
    for (const list of this.grid.values()) {
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          let e1 = list[i];
          let e2 = list[j];
          const w1 = this.eway[e1];
          const w2 = this.eway[e2];
          if (w1 === w2) continue;
          const l1 = this.ways[w1].level;
          const l2 = this.ways[w2].level;
          if (l1 === l2) continue;
          const a1 = this.ea[e1];
          const b1 = this.eb[e1];
          const a2 = this.ea[e2];
          const b2 = this.eb[e2];
          if (a1 === a2 || a1 === b2 || b1 === a2 || b1 === b2) continue;
          const hit = segHit(this.vx[a1], this.vy[a1], this.vx[b1], this.vy[b1], this.vx[a2], this.vy[a2], this.vx[b2], this.vy[b2]);
          if (!hit) continue;
          const key = `${Math.min(w1, w2)}:${Math.max(w1, w2)}:${Math.round(hit.x / 6)}:${Math.round(hit.y / 6)}`;
          if (seen.has(key)) continue;
          seen.add(key);
          let t1 = hit.t;
          let t2 = hit.u;
          if (l1 < l2) {
            [e1, e2] = [e2, e1];
            [t1, t2] = [t2, t1];
          }
          out.push({ eu: e1, el: e2, vu: t1 < 0.5 ? this.ea[e1] : this.eb[e1], vl: t2 < 0.5 ? this.ea[e2] : this.eb[e2] });
        }
      }
    }
    return out;
  }

  /** Required height of the upper road's deck above the lower road at a crossing. */
  private separation(c: Crossing): number {
    const up = this.ways[this.eway[c.eu]];
    const lo = this.ways[this.eway[c.el]];
    const extra = Math.max(0, up.level - lo.level - 1) * LEVEL;
    return (lo.headroom != null ? lo.headroom + DECK : LEVEL) + extra;
  }

  /* -------------------------------------------------------------- solve */

  private solveAll(): Float64Array {
    const n = this.vx.length;
    const crossings = this.findCrossings();
    const comps = this.components();
    // First guess for each point: structures at their nominal level, roads on the ground.
    let est: Float64Array = new Float64Array(n);
    for (let v = 0; v < n; v++) {
      let lv = 0;
      for (const e of this.vadj[v]) {
        const l = this.level(e);
        if (Math.abs(l) > Math.abs(lv)) lv = l;
      }
      est[v] = lv * LEVEL;
    }
    let off: Float64Array = est;
    for (let pass = 0; pass < 3; pass++) {
      const targets = this.crossingTargets(crossings, est);
      const { floor, ceil } = this.limits(comps, targets);
      off = this.solve(targets, floor, ceil);
      est = off;
    }
    // Record the clearances that came out, for the record and for tests.
    for (const c of crossings) {
      this.crossings.push({
        upper: this.ways[this.eway[c.eu]].tags,
        lower: this.ways[this.eway[c.el]].tags,
        at: [this.vx[c.vu], this.vy[c.vu]],
        clearance: this.base[c.vu] + off[c.vu] - (this.base[c.vl] + off[c.vl]),
      });
    }
    return off;
  }

  private crossingTargets(crossings: Crossing[], est: Float64Array): Map<number, number> {
    const t = new Map<number, number>();
    const setMax = (v: number, h: number) => t.set(v, Math.max(t.get(v) ?? -Infinity, h));
    const setMin = (v: number, h: number) => t.set(v, Math.min(t.get(v) ?? Infinity, h));
    for (const c of crossings) {
      const Lu = this.level(c.eu);
      const Ll = this.level(c.el);
      const sep = this.separation(c);
      const bu = this.base[c.vu];
      const bl = this.base[c.vl];
      if (Lu > 0 && Ll < 0) {
        // Both are structures: share the separation by level.
        const mid = (bu + bl) / 2;
        setMax(c.vu, mid + (sep * Lu) / (Lu - Ll) - bu);
        setMin(c.vl, mid - (sep * -Ll) / (Lu - Ll) - bl);
      } else if (Lu > 0) {
        setMax(c.vu, Math.max(SMALL, bl + est[c.vl] + sep - bu));
      } else if (Ll < 0) {
        setMin(c.vl, Math.min(-SMALL, bu + est[c.vu] - sep - bl));
      }
    }
    return t;
  }

  /** Connected stretches of raised (bridge) and sunken (tunnel, underpass) road. */
  private components(): { raised: Int32Array; sunken: Int32Array; info: { len: number; level: number; tunnel: boolean; major: boolean }[] } {
    const n = this.vx.length;
    const raised = new Int32Array(n).fill(-1);
    const sunken = new Int32Array(n).fill(-1);
    const info: { len: number; level: number; tunnel: boolean; major: boolean }[] = [];
    for (const [arr, sign] of [
      [raised, 1],
      [sunken, -1],
    ] as const) {
      for (let s = 0; s < n; s++) {
        if (arr[s] >= 0 || !this.vadj[s].some((e) => Math.sign(this.level(e)) === sign)) continue;
        const id = info.length;
        const c = { len: 0, level: 0, tunnel: false, major: false };
        info.push(c);
        const stack = [s];
        arr[s] = id;
        const counted = new Set<number>();
        while (stack.length) {
          const v = stack.pop()!;
          for (const e of this.vadj[v]) {
            const l = this.level(e);
            if (Math.sign(l) !== sign) continue;
            if (!counted.has(e)) {
              counted.add(e);
              c.len += this.elen[e];
              if (Math.abs(l) > Math.abs(c.level)) c.level = l;
              const w = this.ways[this.eway[e]];
              c.tunnel ||= w.tunnel;
              c.major ||= w.major || w.prio === 3;
            }
            const w = this.other(e, v);
            if (arr[w] < 0) {
              arr[w] = id;
              stack.push(w);
            }
          }
        }
      }
    }
    return { raised, sunken, info };
  }

  /**
   * Floors under bridges and ceilings over tunnels: a structure stays at its deck (or tunnel)
   * level away from its ends and meets the ground at its ends at the road's grade.
   */
  private limits(comps: ReturnType<VerticalModel['components']>, targets: Map<number, number>) {
    const n = this.vx.length;
    const floor = new Float64Array(n).fill(NaN);
    const ceil = new Float64Array(n).fill(NaN);
    const R = this.radius;
    for (const sign of [1, -1]) {
      const arr = sign > 0 ? comps.raised : comps.sunken;
      // Level each structure is built to: from its crossings when it has any.
      const deck = new Map<number, number>();
      for (const [v, h] of targets) {
        const c = arr[v];
        if (c < 0 || Math.sign(h) !== sign) continue;
        deck.set(c, sign > 0 ? Math.max(deck.get(c) ?? 0, h) : Math.min(deck.get(c) ?? 0, h));
      }
      // Distance from each structure point to the nearest real end of the structure.
      const dist = new Float64Array(n).fill(Infinity);
      const heap = new Heap();
      for (let v = 0; v < n; v++) {
        if (arr[v] < 0) continue;
        const adj = this.vadj[v];
        const onStruct = adj.filter((e) => Math.sign(this.level(e)) === sign).length;
        const atEnd = onStruct < adj.length || (adj.length === 1 && Math.hypot(this.vx[v], this.vy[v]) < R - 40);
        if (atEnd) {
          dist[v] = 0;
          heap.push(0, v);
        }
      }
      while (heap.size) {
        const [d, v] = heap.pop();
        if (d > dist[v]) continue;
        for (const e of this.vadj[v]) {
          if (Math.sign(this.level(e)) !== sign) continue;
          const w = this.other(e, v);
          const nd = d + this.elen[e];
          if (nd < dist[w]) {
            dist[w] = nd;
            heap.push(nd, w);
          }
        }
      }
      for (let v = 0; v < n; v++) {
        const c = arr[v];
        if (c < 0) continue;
        const ci = comps.info[c];
        let level = deck.get(c);
        if (level === undefined) {
          if (sign < 0 && ci.tunnel && this.hasGround) continue; // a tunnel through a hill runs at its portals' level
          const long = ci.len >= 60 || (ci.major && ci.len >= 30);
          level = long ? ci.level * LEVEL : sign * SMALL;
        }
        let g = 0.045;
        for (const e of this.vadj[v]) if (Math.sign(this.level(e)) === sign) g = Math.max(g, this.ways[this.eway[e]].grade);
        const ramp = SMALL + g * dist[v];
        if (sign > 0) floor[v] = Math.min(level, ramp);
        else ceil[v] = Math.max(level, -ramp);
      }
    }
    return { floor, ceil };
  }

  /** Settles road priorities in order; each priority's roads start from the points already fixed. */
  private solve(targets: Map<number, number>, floor: Float64Array, ceil: Float64Array): Float64Array {
    const n = this.vx.length;
    const off = new Float64Array(n);
    const fixed = new Uint8Array(n);
    const vprio = new Int8Array(n).fill(9);
    for (let e = 0; e < this.ea.length; e++) {
      const p = this.ways[this.eway[e]].prio;
      if (p < vprio[this.ea[e]]) vprio[this.ea[e]] = p;
      if (p < vprio[this.eb[e]]) vprio[this.eb[e]] = p;
    }
    for (let p = 0; p <= 3; p++) {
      const free: number[] = [];
      for (let v = 0; v < n; v++) if (!fixed[v] && vprio[v] === p) free.push(v);
      if (!free.length) continue;
      const isFree = new Uint8Array(n);
      for (const v of free) isFree[v] = 1;
      const edgeOk = (e: number) => this.ways[this.eway[e]].prio === p;
      const up: [number, number][] = [];
      const down: [number, number][] = [];
      const hard: [number, number][] = [];
      for (const v of free) {
        const t = targets.get(v);
        if (t !== undefined) {
          (t > 0 ? up : down).push([v, t]);
          hard.push([v, t]);
        }
        if (floor[v] > 0) up.push([v, floor[v]]);
        if (ceil[v] < 0) down.push([v, ceil[v]]);
        // Points fixed earlier (where this road meets a more important one).
        for (const e of this.vadj[v]) {
          if (!edgeOk(e)) continue;
          const w = this.other(e, v);
          if (!fixed[w]) continue;
          hard.push([w, off[w]]);
          if (off[w] > 0) up.push([w, off[w]]);
          else if (off[w] < 0) down.push([w, off[w]]);
        }
      }
      const hi = this.spread(up, 1, 1, edgeOk, isFree);
      const lo = this.spread(down, -1, 1, edgeOk, isFree);
      const coneLo = this.spread(hard, 1, STEEP, edgeOk, isFree);
      const coneHi = this.spread(hard, -1, STEEP, edgeOk, isFree);
      for (const v of free) {
        let h = Math.max(0, hi[v]) + Math.min(0, lo[v]);
        if (floor[v] > 0) h = Math.max(h, floor[v]);
        if (ceil[v] < 0) h = Math.min(h, ceil[v]);
        const a = coneLo[v];
        const b = coneHi[v];
        h = a > b ? (a + b) / 2 : clamp(h, a, b);
        off[v] = h;
        fixed[v] = 1;
      }
    }
    return off;
  }

  /**
   * Best value reachable from the sources at the road's grade: sign 1 gives
   * max(value - grade·distance), sign -1 gives min(value + grade·distance).
   */
  private spread(src: [number, number][], sign: 1 | -1, factor: number, edgeOk: (e: number) => boolean, isFree: Uint8Array): Float64Array {
    const n = this.vx.length;
    const best = new Float64Array(n).fill(sign > 0 ? -Infinity : Infinity);
    const key = new Float64Array(n).fill(Infinity);
    const heap = new Heap();
    for (const [v, h] of src) {
      const k = -sign * h;
      if (k < key[v]) {
        key[v] = k;
        heap.push(k, v);
      }
    }
    while (heap.size) {
      const [k, v] = heap.pop();
      if (k > key[v]) continue;
      // Only free points are ever queued after the start, so anything else here is a source.
      if (isFree[v]) best[v] = -sign * k;
      for (const e of this.vadj[v]) {
        if (!edgeOk(e)) continue;
        const w = this.other(e, v);
        if (!isFree[w]) continue;
        const nk = k + this.ways[this.eway[e]].grade * factor * this.elen[e];
        if (nk < key[w]) {
          key[w] = nk;
          heap.push(nk, w);
        }
      }
    }
    return best;
  }

  /* -------------------------------------------------------------- queries */

  /** Nearest modelled road edge to p: of the given way when known, else on the same level. */
  private nearest(p: XY, tags?: Tags, maxD = 30): { e: number; t: number } | null {
    // Several modelled ways can share one tags object (offline data splits roads into pieces),
    // so "the road asked for" is matched by its tags.
    const level = tags ? wayLevel(tags) : null;
    const c = this.cell;
    const r = Math.ceil(maxD / c);
    const cx = Math.floor(p[0] / c);
    const cy = Math.floor(p[1] / c);
    let best: { e: number; t: number; score: number } | null = null;
    for (let x = cx - r; x <= cx + r; x++)
      for (let y = cy - r; y <= cy + r; y++)
        for (const e of this.grid.get(`${x},${y}`) ?? []) {
          const a = this.ea[e];
          const b = this.eb[e];
          const ax = this.vx[a];
          const ay = this.vy[a];
          const dx = this.vx[b] - ax;
          const dy = this.vy[b] - ay;
          const l2 = dx * dx + dy * dy;
          const t = l2 > 0 ? clamp(((p[0] - ax) * dx + (p[1] - ay) * dy) / l2, 0, 1) : 0;
          const d = Math.hypot(ax + dx * t - p[0], ay + dy * t - p[1]);
          if (d > maxD) continue;
          const w = this.eway[e];
          // The road asked for wins over another one up to 12 m nearer (lane offsets, parallel roads).
          const score = d + (tags && this.ways[w].tags !== tags ? 12 : 0) + (level !== null && this.ways[w].level !== level ? 8 : 0);
          if (!best || score < best.score) best = { e, t, score };
        }
    return best;
  }

  private sample(arr: Float64Array, p: XY, tags?: Tags): number | null {
    const hit = this.nearest(p, tags);
    if (!hit) return null;
    const a = this.ea[hit.e];
    const b = this.eb[hit.e];
    return arr[a] + (arr[b] - arr[a]) * hit.t;
  }

  /** Ground plus structure at a point on a road (tags pick the road where several overlap). */
  heightAt(p: XY, tags?: Tags): number {
    const hit = this.nearest(p, tags);
    if (!hit) return this.groundOnly(p);
    const a = this.ea[hit.e];
    const b = this.eb[hit.e];
    const ha = this.base[a] + this.off[a];
    const hb = this.base[b] + this.off[b];
    return ha + (hb - ha) * hit.t;
  }

  /** Structure part only: metres above (or below) the road's base. */
  structureAt(p: XY, tags?: Tags): number {
    return this.sample(this.off, p, tags) ?? 0;
  }

  /** Ground under a road point (the base, for bridges and tunnels). */
  baseAt(p: XY, tags?: Tags): number {
    return this.sample(this.base, p, tags) ?? this.groundOnly(p);
  }

  private groundOnly(p: XY): number {
    const hit = this.nearest(p, undefined, 400);
    if (!hit || !this.hasGround) return 0;
    return this.ground[this.ea[hit.e]];
  }

  /** Number of height samples (for tests and diagnostics). */
  get size(): number {
    return this.vx.length;
  }
}

/** Intersection of two segments (endpoints included), or null. */
function segHit(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number) {
  const rx = bx - ax;
  const ry = by - ay;
  const sx = dx - cx;
  const sy = dy - cy;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * sy - (cy - ay) * sx) / den;
  const u = ((cx - ax) * ry - (cy - ay) * rx) / den;
  const eps = 1e-6;
  if (t < -eps || t > 1 + eps || u < -eps || u > 1 + eps) return null;
  return { t: clamp(t, 0, 1), u: clamp(u, 0, 1), x: ax + rx * t, y: ay + ry * t };
}
