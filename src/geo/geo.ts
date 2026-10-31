/** Geodesy and polyline helpers. Coordinates are [lng, lat] like GeoJSON. */
export type LngLat = [number, number];
export type XY = [number, number];

export const EARTH_R = 6371008.8;
const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function haversine(a: LngLat, b: LngLat): number {
  const dLat = (b[1] - a[1]) * D2R;
  const dLng = (b[0] - a[0]) * D2R;
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(a[1] * D2R) * Math.cos(b[1] * D2R) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Initial bearing a→b in degrees clockwise from north, 0..360. */
export function bearing(a: LngLat, b: LngLat): number {
  const φ1 = a[1] * D2R;
  const φ2 = b[1] * D2R;
  const Δλ = (b[0] - a[0]) * D2R;
  const y = Math.sin(Δλ) * Math.cos(φ2);
  const x = Math.cos(φ1) * Math.sin(φ2) - Math.sin(φ1) * Math.cos(φ2) * Math.cos(Δλ);
  return (Math.atan2(y, x) * R2D + 360) % 360;
}

export function destination(p: LngLat, brg: number, dist: number): LngLat {
  const δ = dist / EARTH_R;
  const θ = brg * D2R;
  const φ1 = p[1] * D2R;
  const λ1 = p[0] * D2R;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 =
    λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [((λ2 * R2D + 540) % 360) - 180, φ2 * R2D];
}

/** Signed smallest difference b - a in degrees, in (-180, 180]. Positive = b is clockwise (to the right) of a. */
export function angleDiff(a: number, b: number): number {
  let d = (b - a) % 360;
  if (d > 180) d -= 360;
  if (d <= -180) d += 360;
  return d;
}

export function normBearing(b: number): number {
  return ((b % 360) + 360) % 360;
}

export const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export function smoothstep(e0: number, e1: number, x: number): number {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** Flat local frame (east/north metres) around an origin. Accurate to <0.1% within a few km. */
export class LocalFrame {
  readonly kx: number;
  readonly ky: number;
  constructor(readonly origin: LngLat) {
    this.ky = EARTH_R * D2R;
    this.kx = EARTH_R * D2R * Math.cos(origin[1] * D2R);
  }
  toXY(p: LngLat): XY {
    return [(p[0] - this.origin[0]) * this.kx, (p[1] - this.origin[1]) * this.ky];
  }
  toLngLat(x: number, y: number): LngLat {
    return [this.origin[0] + x / this.kx, this.origin[1] + y / this.ky];
  }
}

/** Bearing of a planar east/north vector, degrees clockwise from north. */
export function xyBearing(dx: number, dy: number): number {
  return (Math.atan2(dx, dy) * R2D + 360) % 360;
}

export interface Projection {
  s: number; // distance along line
  dist: number; // perpendicular distance in metres
  idx: number; // segment index
  point: LngLat;
}

export class Polyline {
  readonly coords: LngLat[];
  readonly cum: Float64Array;
  readonly length: number;

  constructor(coords: LngLat[]) {
    this.coords = coords;
    this.cum = new Float64Array(coords.length);
    for (let i = 1; i < coords.length; i++) {
      this.cum[i] = this.cum[i - 1] + haversine(coords[i - 1], coords[i]);
    }
    this.length = coords.length ? this.cum[coords.length - 1] : 0;
  }

  /** Index i of the segment containing distance s (cum[i] <= s <= cum[i+1]). */
  segmentAt(s: number): number {
    const n = this.coords.length;
    if (n < 2) return 0;
    if (s <= 0) return 0;
    if (s >= this.length) return n - 2;
    let lo = 0;
    let hi = n - 1;
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (this.cum[mid] <= s) lo = mid;
      else hi = mid;
    }
    return lo;
  }

  pointAt(s: number): LngLat {
    const n = this.coords.length;
    if (n === 0) return [0, 0];
    if (n === 1) return this.coords[0];
    s = clamp(s, 0, this.length);
    const i = this.segmentAt(s);
    const segLen = this.cum[i + 1] - this.cum[i];
    const t = segLen > 0 ? (s - this.cum[i]) / segLen : 0;
    const a = this.coords[i];
    const b = this.coords[i + 1];
    return [lerp(a[0], b[0], t), lerp(a[1], b[1], t)];
  }

  /** Heading at s, measured over a short look-ahead window for stability. */
  bearingAt(s: number, window = 20): number {
    const a = this.pointAt(Math.max(0, Math.min(s, this.length - window)));
    const b = this.pointAt(Math.min(this.length, Math.max(s, 0) + window));
    if (a[0] === b[0] && a[1] === b[1]) {
      const i = this.segmentAt(s);
      return bearing(this.coords[i], this.coords[Math.min(i + 1, this.coords.length - 1)]);
    }
    return bearing(a, b);
  }

  /** Coordinates between s0 and s1 including interpolated end points. */
  slice(s0: number, s1: number): LngLat[] {
    s0 = clamp(s0, 0, this.length);
    s1 = clamp(s1, 0, this.length);
    if (s1 <= s0) return [this.pointAt(s0)];
    const out: LngLat[] = [this.pointAt(s0)];
    const i0 = this.segmentAt(s0);
    const i1 = this.segmentAt(s1);
    for (let i = i0 + 1; i <= i1; i++) {
      if (this.cum[i] > s0 && this.cum[i] < s1) out.push(this.coords[i]);
    }
    out.push(this.pointAt(s1));
    return out;
  }

  /** Nearest point on the line to p, searching only between sMin and sMax. */
  project(p: LngLat, sMin = 0, sMax = Infinity): Projection {
    const n = this.coords.length;
    const best: Projection = { s: 0, dist: Infinity, idx: 0, point: this.coords[0] ?? [0, 0] };
    if (n < 2) {
      if (n === 1) best.dist = haversine(p, this.coords[0]);
      return best;
    }
    const frame = new LocalFrame(p);
    const iStart = this.segmentAt(Math.max(0, sMin));
    const iEnd = this.segmentAt(Math.min(this.length, sMax));
    for (let i = iStart; i <= iEnd && i < n - 1; i++) {
      const [ax, ay] = frame.toXY(this.coords[i]);
      const [bx, by] = frame.toXY(this.coords[i + 1]);
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 > 0 ? -(ax * dx + ay * dy) / len2 : 0;
      t = clamp(t, 0, 1);
      const px = ax + dx * t;
      const py = ay + dy * t;
      const d = Math.hypot(px, py);
      if (d < best.dist) {
        const segLen = this.cum[i + 1] - this.cum[i];
        best.dist = d;
        best.idx = i;
        best.s = this.cum[i] + segLen * t;
        best.point = frame.toLngLat(px, py);
      }
    }
    return best;
  }
}

/** Planar polyline helpers used by the junction scene builder. */
export function xyLength(pts: XY[]): number[] {
  const cum = new Array<number>(pts.length).fill(0);
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1] + Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  return cum;
}

/** Resample a planar polyline so no segment is longer than `step` metres. Returns points and source segment index. */
export function resampleXY(pts: XY[], step: number): { pts: XY[]; src: number[] } {
  const out: XY[] = [];
  const src: number[] = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const k = Math.max(1, Math.ceil(len / step));
    for (let j = 0; j < k; j++) {
      const t = j / k;
      out.push([lerp(a[0], b[0], t), lerp(a[1], b[1], t)]);
      src.push(i);
    }
  }
  if (pts.length) {
    out.push(pts[pts.length - 1]);
    src.push(Math.max(0, pts.length - 2));
  }
  return { pts: out, src };
}

/** Unit normals pointing to the right of travel direction, averaged at joints. */
export function rightNormals(pts: XY[]): XY[] {
  const n = pts.length;
  const out: XY[] = [];
  for (let i = 0; i < n; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(n - 1, i + 1)];
    let dx = b[0] - a[0];
    let dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    dx /= len;
    dy /= len;
    out.push([dy, -dx]);
  }
  return out;
}

/** Distance from point to planar polyline. */
export function distToPolyline(p: XY, pts: XY[]): number {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i];
    const b = pts[i + 1];
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const len2 = dx * dx + dy * dy;
    let t = len2 > 0 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2 : 0;
    t = clamp(t, 0, 1);
    const d = Math.hypot(a[0] + dx * t - p[0], a[1] + dy * t - p[1]);
    if (d < best) best = d;
  }
  return best;
}

/** Point at distance s along a planar polyline with cumulative lengths. */
export function xyAt(pts: XY[], cum: number[], s: number): { p: XY; i: number; t: number } {
  const n = pts.length;
  if (n === 1) return { p: pts[0], i: 0, t: 0 };
  if (s <= 0) return { p: pts[0], i: 0, t: 0 };
  if (s >= cum[n - 1]) return { p: pts[n - 1], i: n - 2, t: 1 };
  let lo = 0;
  let hi = n - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (cum[mid] <= s) lo = mid;
    else hi = mid;
  }
  const seg = cum[lo + 1] - cum[lo];
  const t = seg > 0 ? (s - cum[lo]) / seg : 0;
  return { p: [lerp(pts[lo][0], pts[lo + 1][0], t), lerp(pts[lo][1], pts[lo + 1][1], t)], i: lo, t };
}

/** Seeded PRNG (mulberry32) so scenery is stable for a junction. */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hashString(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}
