/**
 * The places around you, in memory (in the places worker): what the map shows in view, search by
 * name, places of a kind near a point or along the route, one place's details, and the name of the
 * town an area is around. Built from the downloaded cells (src/places/format.ts); a cell can be
 * swapped for a newer copy or dropped on its own.
 */
import { CELL_DEG, GROUPS, metres, normName, type CellFile, type PlaceDetails, type PlaceGroup } from './format';

export interface PlaceHit {
  /** "<cell>:<row>", valid until the cell is next updated. */
  id: string;
  name: string;
  group: PlaceGroup;
  /** The source's category key ("malaysian_restaurant"). */
  key: string;
  lon: number;
  lat: number;
  rank: number;
  d?: PlaceDetails;
  /** Metres from the point asked about, when there was one. */
  dist?: number;
}

/** What the map layer needs per place. */
export type MapPlace = [id: string, lon: number, lat: number, name: string, group: PlaceGroup, rank: number];

/** Roughly where an address is (src/places/placesIndex.ts addressArea). */
export interface AreaHit {
  by: 'street' | 'postcode';
  lon: number;
  lat: number;
  /** Places it is the middle of. */
  n: number;
}

/**
 * The middle of some points (the median each way, so a few strays do not pull it), or null when
 * most of them lie further than `spread` metres from it.
 */
export function middle(all: [number, number][], spread: number): [number, number] | null {
  if (!all.length) return null;
  // A few thousand are plenty to find the middle of.
  const step = Math.ceil(all.length / 4000);
  const pts = step > 1 ? all.filter((_, i) => i % step === 0) : all;
  const med = (v: number[]) => {
    const s = [...v].sort((a, b) => a - b);
    const m = s.length >> 1;
    return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
  };
  const mid: [number, number] = [med(pts.map((p) => p[0])), med(pts.map((p) => p[1]))];
  const d = pts.map((p) => metres(mid, p)).sort((a, b) => a - b);
  return d[Math.floor(d.length * 0.8)] <= spread ? mid : null;
}

/** Address shorthand, written out, so "Jln SS2/24" and "Jalan SS 2/24" read the same. */
const ADDRESS_ABBR: Record<string, string> = {
  jln: 'jalan',
  jl: 'jalan',
  lrg: 'lorong',
  psn: 'persiaran',
  lbh: 'lebuh',
  tmn: 'taman',
  kg: 'kampung',
  kpg: 'kampung',
  bdr: 'bandar',
  bkt: 'bukit',
  sg: 'sungai',
  bt: 'batu',
  sek: 'seksyen',
};

/** Words that do not tell one street from another. */
const GENERIC_STREET = new Set(['jalan', 'lorong', 'persiaran', 'lebuh', 'lebuhraya', 'lingkaran', 'lengkok', 'medan', 'taman', 'kampung', 'bandar', 'bukit', 'sungai', 'batu', 'seksyen', 'besar']);

/** An address as plain words: lower case, letters apart from numbers ("ss2" is "ss 2"), shorthand written out. */
export function addressWords(s: string): string {
  return s
    .toLowerCase()
    .replace(/([a-z])(?=\d)/g, '$1 ')
    .replace(/(\d)(?=[a-z])/g, '$1 ')
    .split(/[^a-z0-9]+/)
    .filter(Boolean)
    .map((w) => ADDRESS_ABBR[w] ?? w)
    .join(' ');
}

/** The app's category buttons, in terms of groups and category keys. */
export type PlaceCategory = 'fuel' | 'ev' | 'parking' | 'food' | 'rest' | 'store';

export function inCategory(cat: PlaceCategory, group: PlaceGroup, key: string): boolean {
  switch (cat) {
    case 'food':
      return group === 'food' || group === 'cafe';
    case 'store':
      return group === 'grocery' && /convenience|minimarket|mini_mart/.test(key);
    default:
      return group === cat;
  }
}

/** Kinds left off the map while driving: they crowd it without helping on the road. */
const NOT_WHILE_DRIVING = new Set<PlaceGroup>(['office', 'service', 'shop', 'other', 'car', 'sport', 'bank']);

interface Cell {
  id: string;
  w: number;
  s: number;
  names: string[];
  norm: string[];
  /** English names, normalised, where the place has one. */
  normEn: (string | undefined)[];
  cat: Uint16Array;
  lon: Float64Array;
  lat: Float64Array;
  rank: Uint8Array;
  details: (PlaceDetails | undefined)[];
  cats: [string, PlaceGroup][];
}

/** How a name matches the words typed: 100 for the whole name, down to 50 for a part of a word. */
export function matchScore(name: string, q: string, words: string[]): number {
  if (!name) return 0;
  if (name === q) return 100;
  if (name.startsWith(q)) return 90;
  if (name.includes(' ' + q)) return 78;
  const parts = name.split(' ');
  if (words.length > 1 && words.every((w) => parts.some((p) => p.startsWith(w)))) return 68;
  if (q.length >= 3 && name.includes(q)) return 50;
  return 0;
}

export class PlacesIndex {
  private cells = new Map<string, Cell>();

  get count(): number {
    let n = 0;
    for (const c of this.cells.values()) n += c.names.length;
    return n;
  }

  get cellIds(): string[] {
    return [...this.cells.keys()];
  }

  has(id: string): boolean {
    return this.cells.has(id);
  }

  /** Adds a cell, replacing an older copy of it. */
  add(f: CellFile) {
    const n = f.p.length;
    const [ix, iy] = f.id.split('_').map(Number);
    const c: Cell = {
      id: f.id,
      w: ix * CELL_DEG,
      s: iy * CELL_DEG,
      names: new Array(n),
      norm: new Array(n),
      normEn: new Array(n),
      cat: new Uint16Array(n),
      lon: new Float64Array(n),
      lat: new Float64Array(n),
      rank: new Uint8Array(n),
      details: new Array(n),
      cats: f.cats,
    };
    for (let i = 0; i < n; i++) {
      const [name, cat, x, y, rank, d] = f.p[i];
      c.names[i] = name;
      c.norm[i] = normName(name);
      c.normEn[i] = d?.e ? normName(d.e) : undefined;
      c.cat[i] = cat;
      c.lon[i] = x / 1e5;
      c.lat[i] = y / 1e5;
      c.rank[i] = rank;
      c.details[i] = d;
    }
    this.cells.set(f.id, c);
  }

  remove(id: string) {
    this.cells.delete(id);
  }

  clear() {
    this.cells.clear();
  }

  private hit(c: Cell, i: number, dist?: number): PlaceHit {
    const [key, group] = c.cats[c.cat[i]] ?? ['place', 'other'];
    return { id: `${c.id}:${i}`, name: c.names[i], group, key, lon: c.lon[i], lat: c.lat[i], rank: c.rank[i], d: c.details[i], dist };
  }

  private cellsIn(w: number, s: number, e: number, n: number): Cell[] {
    const out: Cell[] = [];
    for (const c of this.cells.values()) if (c.w <= e && c.w + CELL_DEG >= w && c.s <= n && c.s + CELL_DEG >= s) out.push(c);
    return out;
  }

  /**
   * Places to draw in a view: the kinds that matter at this zoom (prominent places a little
   * earlier), highest rank first, at most `limit`. While driving, offices, shops and services
   * are left out.
   */
  box(bbox: [number, number, number, number], zoom: number, limit: number, driving = false): MapPlace[] {
    const [w, s, e, n] = bbox;
    const found: MapPlace[] = [];
    for (const c of this.cellsIn(w, s, e, n)) {
      let taken = 0;
      // Rows are stored highest rank first, so each cell can stop once it has given enough.
      for (let i = 0; i < c.names.length && taken < limit; i++) {
        const lon = c.lon[i];
        const lat = c.lat[i];
        if (lon < w || lon > e || lat < s || lat > n) continue;
        const group = c.cats[c.cat[i]]?.[1] ?? 'other';
        if (driving && NOT_WHILE_DRIVING.has(group)) continue;
        const r = c.rank[i];
        const early = r >= 75 ? 2 : r >= 60 ? 1 : r >= 48 ? 0.5 : 0;
        if (zoom < GROUPS[group].minZoom - early) continue;
        found.push([`${c.id}:${i}`, lon, lat, c.names[i], group, r]);
        taken++;
      }
    }
    found.sort((a, b) => b[5] - a[5]);
    return found.length > limit ? found.slice(0, limit) : found;
  }

  /** Places whose name matches what was typed, the best match nearest first, within `maxKm`. */
  search(query: string, near: [number, number] | null, limit = 8, maxKm = 150): PlaceHit[] {
    const q = normName(query);
    if (q.length < 2) return [];
    const words = q.split(' ').filter(Boolean);
    const first = words[0];
    const scored: { c: Cell; i: number; score: number; dist?: number }[] = [];
    for (const c of this.cells.values()) {
      for (let i = 0; i < c.norm.length; i++) {
        // Every kind of match needs the first word somewhere in the name: a quick no for most places.
        const en = c.normEn[i];
        if (!c.norm[i].includes(first) && !(en && en.includes(first))) continue;
        const m = Math.max(matchScore(c.norm[i], q, words), en ? matchScore(en, q, words) : 0);
        if (!m) continue;
        const group = c.cats[c.cat[i]]?.[1];
        if (group === 'locality') continue;
        let score = m + c.rank[i] * 0.12;
        let dist: number | undefined;
        if (near) {
          dist = metres(near, [c.lon[i], c.lat[i]]);
          if (dist > maxKm * 1000) continue;
          score -= Math.min(35, (dist / 1000) * 0.7);
        }
        scored.push({ c, i, score, dist });
      }
    }
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(({ c, i, dist }) => this.hit(c, i, dist));
  }

  /** Places of a category within `radius` of a point, or of a line given as points, nearest first. */
  near(points: [number, number][], radius: number, cat: PlaceCategory, limit = 120): PlaceHit[] {
    if (!points.length) return [];
    let w = Infinity;
    let s = Infinity;
    let e = -Infinity;
    let n = -Infinity;
    for (const [x, y] of points) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
    const dLat = radius / 110_574;
    const dLon = radius / (111_320 * Math.max(0.05, Math.cos(((s + n) / 2) * (Math.PI / 180))));
    w -= dLon;
    e += dLon;
    s -= dLat;
    n += dLat;
    const out: PlaceHit[] = [];
    for (const c of this.cellsIn(w, s, e, n)) {
      for (let i = 0; i < c.names.length; i++) {
        const lon = c.lon[i];
        const lat = c.lat[i];
        if (lon < w || lon > e || lat < s || lat > n) continue;
        const [key, group] = c.cats[c.cat[i]] ?? ['place', 'other'];
        if (!inCategory(cat, group, key)) continue;
        let best = Infinity;
        for (const p of points) {
          const d = metres(p, [lon, lat]);
          if (d < best) best = d;
          if (best <= radius && points.length === 1) break;
        }
        if (best <= radius) out.push(this.hit(c, i, best));
      }
    }
    out.sort((a, b) => (a.dist ?? 0) - (b.dist ?? 0));
    return out.slice(0, limit);
  }

  get(id: string): PlaceHit | null {
    const k = id.lastIndexOf(':');
    const c = this.cells.get(id.slice(0, k));
    const i = Number(id.slice(k + 1));
    if (!c || !Number.isInteger(i) || i < 0 || i >= c.names.length) return null;
    return this.hit(c, i);
  }

  /** The place nearest to a point within `maxDist` (towns left out), for naming a dropped pin. */
  nearest(p: [number, number], maxDist = 30): PlaceHit | null {
    let best: { c: Cell; i: number; d: number } | null = null;
    const dLat = maxDist / 110_574;
    const dLon = maxDist / (111_320 * Math.max(0.05, Math.cos(p[1] * (Math.PI / 180))));
    for (const c of this.cellsIn(p[0] - dLon, p[1] - dLat, p[0] + dLon, p[1] + dLat)) {
      for (let i = 0; i < c.names.length; i++) {
        if (Math.abs(c.lon[i] - p[0]) > dLon || Math.abs(c.lat[i] - p[1]) > dLat) continue;
        if (c.cats[c.cat[i]]?.[1] === 'locality') continue;
        const d = metres(p, [c.lon[i], c.lat[i]]);
        if (d <= maxDist && (!best || d < best.d)) best = { c, i, d };
      }
    }
    return best ? this.hit(best.c, best.i, best.d) : null;
  }

  /**
   * Roughly where an address is, from the addresses of the places around you: the middle of the
   * places on that street (in that postcode or town, when given), and of the places in that
   * postcode. Matches spread too wide to mean one place (a "Jalan 1" in every town) are left out.
   */
  addressArea(o: { street?: string | null; postcode?: string | null; town?: string | null }): AreaHit[] {
    const st = o.street ? addressWords(o.street) : '';
    const pc = o.postcode && /^\d{5}$/.test(o.postcode) ? o.postcode : '';
    const town = o.town ? ` ${addressWords(o.town)} ` : '';
    const pcRe = pc ? new RegExp(`(^|\\D)${pc}(\\D|$)`) : null;
    // A street needs a word of its own ("Jalan 14" is too common alone, but the postcode narrows it).
    const own = st.split(' ').filter((w) => !GENERIC_STREET.has(w));
    const useStreet = own.length > 0 && st.includes(' ');
    // A quick look for its most telling word comes before the full comparison.
    const key = useStreet ? new RegExp([...own].sort((a, b) => b.length - a.length)[0], 'i') : null;
    const stPad = ` ${st} `;
    const onStreet: { p: [number, number]; pc: boolean; town: boolean }[] = [];
    const inPostcode: [number, number][] = [];
    for (const c of this.cells.values()) {
      for (let i = 0; i < c.names.length; i++) {
        const a = c.details[i]?.a;
        if (!a) continue;
        const inPc = !!pcRe && pcRe.test(a);
        if (inPc) inPostcode.push([c.lon[i], c.lat[i]]);
        if (key?.test(a)) {
          const aw = ` ${addressWords(a)} `;
          if (aw.includes(stPad)) onStreet.push({ p: [c.lon[i], c.lat[i]], pc: inPc, town: !!town && aw.includes(town) });
        }
      }
    }
    const out: AreaHit[] = [];
    if (onStreet.length) {
      // The ones in the right postcode or town, when the address says.
      const narrow = onStreet.filter((h) => h.pc).length ? onStreet.filter((h) => h.pc) : onStreet.filter((h) => h.town).length ? onStreet.filter((h) => h.town) : onStreet;
      const mid = middle(narrow.map((h) => h.p), 3000);
      if (mid) out.push({ by: 'street', lon: mid[0], lat: mid[1], n: narrow.length });
    }
    if (inPostcode.length) {
      const mid = middle(inPostcode, 9000);
      if (mid) out.push({ by: 'postcode', lon: mid[0], lat: mid[1], n: inPostcode.length });
    }
    return out;
  }

  /** The town an area is around: a city or town close to the point, else the nearest suburb or village. */
  areaName(p: [number, number], maxDist = 30_000): string | null {
    const weight: Record<string, number> = { city: 4, town: 2.5, suburb: 1.2, quarter: 1, village: 1, neighbourhood: 0.6, hamlet: 0.4 };
    let best: { name: string; score: number } | null = null;
    for (const c of this.cells.values()) {
      for (let i = 0; i < c.names.length; i++) {
        const [key, group] = c.cats[c.cat[i]] ?? ['', 'other'];
        if (group !== 'locality') continue;
        const d = metres(p, [c.lon[i], c.lat[i]]);
        if (d > maxDist) continue;
        const score = (weight[key] ?? 0.5) / (1 + d / 2000);
        if (!best || score > best.score) best = { name: c.names[i], score };
      }
    }
    return best?.name ?? null;
  }
}
