/** Reads graph.bin and answers spatial questions about it (nearest road, roads near a point). */
import { angleDiff, bearing, haversine, LocalFrame, type LngLat } from '../geo/geo';
import { D_BWD, D_FWD, GRAPH_MAGIC, parseTags, sectionOffsets, type GraphHeader } from './graphLayout';

const CTOR = { i32: Int32Array, u32: Uint32Array, f32: Float32Array, u16: Uint16Array, u8: Uint8Array } as const;

export interface Snap {
  seg: number;
  /** 0..1 along the segment from A to B, by length. */
  t: number;
  dist: number;
  point: LngLat;
  /** Direction of the road at the snap point (A to B). */
  bearing: number;
}

export class OfflineGraph {
  readonly h: GraphHeader;
  vLat!: Int32Array;
  vLon!: Int32Array;
  segA!: Uint32Array;
  segB!: Uint32Array;
  segLen!: Float32Array;
  segWay!: Uint32Array;
  segShape!: Uint32Array;
  segDir!: Uint8Array;
  adjStart!: Uint32Array;
  adj!: Uint32Array;
  shapeLat!: Int32Array;
  shapeLon!: Int32Array;
  wayClass!: Uint8Array;
  waySpeed!: Uint8Array;
  wayFlags!: Uint16Array;
  wayTags!: Uint32Array;
  rVia!: Uint32Array;
  rFrom!: Uint32Array;
  rTo!: Uint32Array;
  rType!: Uint8Array;
  jV!: Uint32Array;
  jRef!: Uint32Array;
  jName!: Uint32Array;
  cellKey!: Uint32Array;
  cellStart!: Uint32Array;
  cellSegs!: Uint32Array;
  strOff!: Uint32Array;
  strBytes!: Uint8Array;
  private dec = new TextDecoder();
  private strCache = new Map<number, string>();
  private tagCache = new Map<number, Record<string, string>>();
  private juncByV = new Map<number, number>();

  constructor(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== GRAPH_MAGIC) throw new Error('Not an offline road graph');
    const hl = dv.getUint32(8, true);
    this.h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl))) as GraphHeader;
    const offs = sectionOffsets(this.h, 12 + hl);
    for (const [name, s] of Object.entries(offs)) {
      if (name === '__end') continue;
      (this as unknown as Record<string, ArrayBufferView>)[name] = new CTOR[s.kind](buf, s.offset, s.length);
    }
    for (let i = 0; i < this.jV.length; i++) this.juncByV.set(this.jV[i], i);
  }

  str(i: number): string {
    if (!i) return '';
    let s = this.strCache.get(i);
    if (s === undefined) {
      s = this.dec.decode(this.strBytes.subarray(this.strOff[i], this.strOff[i + 1]));
      if (this.strCache.size > 50_000) this.strCache.clear();
      this.strCache.set(i, s);
    }
    return s;
  }

  tags(way: number): Record<string, string> {
    let t = this.tagCache.get(way);
    if (!t) {
      t = parseTags(this.str(this.wayTags[way]));
      if (this.tagCache.size > 50_000) this.tagCache.clear();
      this.tagCache.set(way, t);
    }
    return t;
  }

  vertex(v: number): LngLat {
    return [this.vLon[v] / 1e6, this.vLat[v] / 1e6];
  }

  /** Motorway junction (exit) at a vertex, if any. */
  junctionAt(v: number): { ref: string; name: string } | null {
    const j = this.juncByV.get(v);
    return j === undefined ? null : { ref: this.str(this.jRef[j]), name: this.str(this.jName[j]) };
  }

  /** Points of a segment, in travel direction (dir 0: A to B, 1: B to A). */
  points(seg: number, dir = 0): LngLat[] {
    const pts: LngLat[] = [this.vertex(this.segA[seg])];
    for (let k = this.segShape[seg]; k < this.segShape[seg + 1]; k++) pts.push([this.shapeLon[k] / 1e6, this.shapeLat[k] / 1e6]);
    pts.push(this.vertex(this.segB[seg]));
    return dir ? pts.reverse() : pts;
  }

  /** Can the segment be driven in this direction? */
  allowed(seg: number, dir: number): boolean {
    return (this.segDir[seg] & (dir ? D_BWD : D_FWD)) !== 0;
  }

  /** Vertex where a traversal starts / ends. */
  from(seg: number, dir: number): number {
    return dir ? this.segB[seg] : this.segA[seg];
  }
  to(seg: number, dir: number): number {
    return dir ? this.segA[seg] : this.segB[seg];
  }

  /** Bearing leaving the start vertex of a traversal, measured over the first ~20 m. */
  bearingOut(seg: number, dir: number): number {
    const pts = this.points(seg, dir);
    return bearing(pts[0], along(pts, 20));
  }

  /** Bearing arriving at the end vertex of a traversal, over the last ~20 m. */
  bearingIn(seg: number, dir: number): number {
    const pts = this.points(seg, dir).reverse();
    return (bearing(pts[0], along(pts, 20)) + 180) % 360;
  }

  /** Segments whose grid cells fall within `radius` metres of p. */
  segmentsNear(p: LngLat, radius: number): number[] {
    const c = this.h.cell;
    const dLat = radius / 111_320;
    const dLon = radius / (111_320 * Math.cos((p[1] * Math.PI) / 180));
    const cx0 = Math.max(0, Math.floor((p[0] - dLon - c.lonMin) / c.size));
    const cx1 = Math.min(c.nx - 1, Math.floor((p[0] + dLon - c.lonMin) / c.size));
    const cy0 = Math.max(0, Math.floor((p[1] - dLat - c.latMin) / c.size));
    const cy1 = Math.min(c.ny - 1, Math.floor((p[1] + dLat - c.latMin) / c.size));
    const out = new Set<number>();
    for (let cy = cy0; cy <= cy1; cy++)
      for (let cx = cx0; cx <= cx1; cx++) {
        const key = cy * c.nx + cx;
        const i = lowerBound(this.cellKey, key);
        if (i >= this.cellKey.length || this.cellKey[i] !== key) continue;
        for (let k = this.cellStart[i]; k < this.cellStart[i + 1]; k++) out.add(this.cellSegs[k]);
      }
    return [...out];
  }

  /**
   * Nearest drivable road to p. With a bearing, roads running the other way (or across) are
   * skipped when a matching one is close, which picks the right carriageway.
   */
  snap(p: LngLat, bearingDeg: number | null = null, maxDist = 2000): Snap | null {
    for (const radius of [150, 600, maxDist]) {
      let best: Snap | null = null;
      let bestScore = Infinity;
      const f = new LocalFrame(p);
      for (const seg of this.segmentsNear(p, radius)) {
        if (!this.allowed(seg, 0) && !this.allowed(seg, 1)) continue;
        const pts = this.points(seg).map((q) => f.toXY(q));
        let acc = 0;
        let total = 0;
        for (let i = 1; i < pts.length; i++) total += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        for (let i = 1; i < pts.length; i++) {
          const [ax, ay] = pts[i - 1];
          const [bx, by] = pts[i];
          const dx = bx - ax;
          const dy = by - ay;
          const l2 = dx * dx + dy * dy;
          const u = l2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / l2)) : 0;
          const d = Math.hypot(ax + dx * u, ay + dy * u);
          const segL = Math.sqrt(l2);
          if (d <= radius) {
            const brg = (Math.atan2(dx, dy) * 180) / Math.PI;
            let score = d;
            if (bearingDeg != null) {
              const fwd = Math.abs(angleDiff(brg, bearingDeg)) < 60 && this.allowed(seg, 0);
              const bwd = Math.abs(angleDiff(brg + 180, bearingDeg)) < 60 && this.allowed(seg, 1);
              if (!fwd && !bwd) score += 80;
            }
            if (score < bestScore) {
              bestScore = score;
              best = {
                seg,
                t: total > 0 ? (acc + segL * u) / total : 0,
                dist: d,
                point: f.toLngLat(ax + dx * u, ay + dy * u),
                bearing: (brg + 360) % 360,
              };
            }
          }
          acc += segL;
        }
      }
      if (best) return best;
    }
    return null;
  }

  /** Restrictions with this vertex as via: [fromWay, toWay, type][]. */
  restrictionsAt(v: number): [number, number, number][] {
    const out: [number, number, number][] = [];
    for (let i = lowerBound(this.rVia, v); i < this.rVia.length && this.rVia[i] === v; i++) out.push([this.rFrom[i], this.rTo[i], this.rType[i]]);
    return out;
  }
}

export function lowerBound(arr: ArrayLike<number>, v: number): number {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (arr[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Point `d` metres along a polyline (or its end). */
export function along(pts: LngLat[], d: number): LngLat {
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = haversine(pts[i - 1], pts[i]);
    if (acc + l >= d && l > 0) {
      const f = (d - acc) / l;
      return [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
    }
    acc += l;
  }
  return pts[pts.length - 1];
}

/** Splits a polyline at fraction t (by length): [before, after], sharing the cut point. */
export function cutAt(pts: LngLat[], t: number): [LngLat[], LngLat[]] {
  const lens: number[] = [];
  let total = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = haversine(pts[i - 1], pts[i]);
    lens.push(l);
    total += l;
  }
  const target = Math.max(0, Math.min(1, t)) * total;
  let acc = 0;
  for (let i = 1; i < pts.length; i++) {
    const l = lens[i - 1];
    if (acc + l >= target) {
      const f = l > 0 ? (target - acc) / l : 0;
      const c: LngLat = [pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f];
      return [[...pts.slice(0, i), c], [c, ...pts.slice(i)]];
    }
    acc += l;
  }
  return [pts.slice(), [pts[pts.length - 1]]];
}
