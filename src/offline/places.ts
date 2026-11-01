/** Offline place search over places.bin: names of places, businesses and streets in the pack. */
import { haversine, type LngLat } from '../geo/geo';
import { align4, PLACES_MAGIC } from './graphLayout';

export interface OfflinePlace {
  name: string;
  /** English name when OSM has a different one. */
  alt: string;
  lngLat: LngLat;
  /** OSM tag that describes it, e.g. "amenity=fuel". */
  kind: string;
}

export class PlaceIndex {
  readonly count: number;
  private kinds: string[];
  private lon: Int32Array;
  private lat: Int32Array;
  private kind: Uint16Array;
  private names: string;
  private lower: string;
  /** Start offset of each entry inside `names`, and inside the folded copy (accents removed). */
  private starts: Uint32Array;
  private lstarts: Uint32Array;

  constructor(buf: ArrayBuffer) {
    const dv = new DataView(buf);
    if (dv.getUint32(0, true) !== PLACES_MAGIC) throw new Error('Not an offline place index');
    const hl = dv.getUint32(8, true);
    const h = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, hl))) as { count: number; kinds: string[]; nameBytes: number };
    const n = (this.count = h.count);
    this.kinds = h.kinds;
    let off = align4(12 + hl);
    this.lon = new Int32Array(buf, off, n);
    off += n * 4;
    this.lat = new Int32Array(buf, off, n);
    off += n * 4;
    this.kind = new Uint16Array(buf, off, n);
    off = align4(off + n * 2);
    this.names = new TextDecoder().decode(new Uint8Array(buf, off, h.nameBytes));
    this.lower = fold(this.names);
    this.starts = lineStarts(this.names, n);
    this.lstarts = lineStarts(this.lower, n);
  }

  private entry(i: number): OfflinePlace {
    const raw = this.names.slice(this.starts[i], this.starts[i + 1] - 1);
    const [name, alt = ''] = raw.split('\t');
    return { name, alt, lngLat: [this.lon[i] / 1e6, this.lat[i] / 1e6], kind: this.kinds[this.kind[i]] ?? '' };
  }

  private indexAt(pos: number): number {
    let lo = 0;
    let hi = this.count - 1;
    while (lo < hi) {
      const m = (lo + hi + 1) >>> 1;
      if (this.lstarts[m] <= pos) lo = m;
      else hi = m - 1;
    }
    return lo;
  }

  /**
   * Entries matching every word of the query (anywhere in the name), best first: names that
   * start with the query, then word starts, then nearer to `near`.
   */
  search(q: string, near: LngLat | null, limit = 10): OfflinePlace[] {
    const words = fold(q).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    const longest = words.reduce((a, b) => (b.length > a.length ? b : a));
    const whole = fold(q).trim();
    const wordStart = new RegExp(`(^|[\\s\\t(-])${escapeRe(words[0])}`);
    const scored = new Map<number, number>();
    let from = 0;
    let guard = 0;
    while (scored.size < 4000 && guard++ < 200_000) {
      const pos = this.lower.indexOf(longest, from);
      if (pos < 0) break;
      from = pos + 1;
      const i = this.indexAt(pos);
      if (scored.has(i)) continue;
      const text = this.lower.slice(this.lstarts[i], this.lstarts[i + 1] - 1);
      if (!words.every((w) => text.includes(w))) continue;
      let score = text.startsWith(whole) ? 0 : wordStart.test(text) ? 1 : 2;
      if (near) score += Math.min(3, haversine(near, [this.lon[i] / 1e6, this.lat[i] / 1e6]) / 20_000);
      // Streets matter less than named places with the same score.
      if (this.kinds[this.kind[i]]?.startsWith('highway=') && !this.kinds[this.kind[i]]?.includes('motorway_junction')) score += 0.3;
      scored.set(i, score);
    }
    return [...scored.entries()]
      .sort((a, b) => a[1] - b[1])
      .slice(0, limit)
      .map(([i]) => this.entry(i));
  }

  /** Entries of the given kinds ("amenity=fuel") within `radius` of any of the points, nearest first. */
  byKind(kinds: string[], points: LngLat[], radius: number, limit = 120): (OfflinePlace & { dist: number })[] {
    const want = new Set(kinds.map((k) => this.kinds.indexOf(k)).filter((i) => i >= 0));
    if (!want.size || !points.length) return [];
    let minLon = Infinity;
    let maxLon = -Infinity;
    let minLat = Infinity;
    let maxLat = -Infinity;
    for (const [x, y] of points) {
      minLon = Math.min(minLon, x);
      maxLon = Math.max(maxLon, x);
      minLat = Math.min(minLat, y);
      maxLat = Math.max(maxLat, y);
    }
    const pad = radius / 111_320 + 0.001;
    const out: (OfflinePlace & { dist: number })[] = [];
    for (let i = 0; i < this.count; i++) {
      if (!want.has(this.kind[i])) continue;
      const q: LngLat = [this.lon[i] / 1e6, this.lat[i] / 1e6];
      if (q[0] < minLon - pad * 1.2 || q[0] > maxLon + pad * 1.2 || q[1] < minLat - pad || q[1] > maxLat + pad) continue;
      let d = Infinity;
      for (const p of points) d = Math.min(d, haversine(p, q));
      if (d <= radius) out.push({ ...this.entry(i), dist: d });
    }
    return out.sort((a, b) => a.dist - b.dist).slice(0, limit);
  }

  /** Closest entry to p (used to name a dropped pin offline). */
  nearest(p: LngLat, maxDist = 300): OfflinePlace | null {
    let best = -1;
    let bestD = maxDist;
    const lon = Math.round(p[0] * 1e6);
    const lat = Math.round(p[1] * 1e6);
    const box = Math.round((maxDist / 111_320) * 1e6 * 1.5);
    for (let i = 0; i < this.count; i++) {
      if (Math.abs(this.lon[i] - lon) > box || Math.abs(this.lat[i] - lat) > box) continue;
      const d = haversine(p, [this.lon[i] / 1e6, this.lat[i] / 1e6]);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best >= 0 ? this.entry(best) : null;
  }
}

function lineStarts(s: string, n: number): Uint32Array {
  const out = new Uint32Array(n + 1);
  let k = 1;
  for (let i = 0; i < s.length && k < n; i++) if (s.charCodeAt(i) === 10) out[k++] = i + 1;
  out[n] = s.length + 1;
  return out;
}

/** Lower case without accents, so "Jalan" matches "jalan" and "café" matches "cafe". */
function fold(s: string): string {
  return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
