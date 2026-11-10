/**
 * The map's road lines, read from the same vector tiles the map draws, for lining routes up with
 * them (src/routing/align.ts): OpenFreeMap's (OpenMapTiles layout, zoom 14, their most detailed
 * level) or TomTom's (src/map/tomtomStyle.ts layout). Tiles load a few at a time in the order the
 * route passes them and stay in memory for later routes (reroutes, alternatives). The browser's
 * cache is shared with the map, so a tile the map already has costs nothing.
 *
 * Roads near a tile's edge are looked up in the neighbouring tiles too, so it does not matter how
 * far past its edge a tile carries its neighbours' roads.
 */
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { LngLat } from '../geo/geo';
import { metres, type RoadSeg, type RoadSet } from '../routing/align';

export const ROAD_ZOOM = 14;
/** Roads a car can be routed on (OpenMapTiles classes; TomTom's categories are put into these). */
const CAR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'busway']);
/** Index cells per tile side (about 76 m at zoom 14 on the equator). */
const CELLS = 32;

export type RoadSchema = 'openmaptiles' | 'tomtom';

export function tileOf(p: LngLat, z = ROAD_ZOOM): [number, number] {
  const n = 2 ** z;
  const lat = Math.max(-85, Math.min(85, p[1])) * (Math.PI / 180);
  const x = Math.floor(((p[0] + 180) / 360) * n);
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

const keyOf = (x: number, y: number) => `${x}/${y}`;

function lngOf(x: number, z: number): number {
  return (x / 2 ** z) * 360 - 180;
}
function latOf(y: number, z: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;
}

/** TomTom's road categories as OpenMapTiles classes (null: not a road for cars). */
function tomtomClass(category: string, sub: string): string | null {
  switch (category) {
    case 'motorway':
    case 'trunk':
    case 'primary':
    case 'secondary':
    case 'tertiary':
      return category;
    case 'street':
      return 'minor';
    case 'minor':
      return sub === 'pedestrian' ? null : 'service';
    default:
      return null;
  }
}

/** Per road line: OpenMapTiles class codes. */
const CLASS_CODES = [...CAR_ROADS];

/**
 * One tile's car roads, kept compact (a phone holds dozens of these): all vertices in one array,
 * each line a run of them, segments from each vertex to the next in its line.
 */
interface Tile {
  x: number;
  y: number;
  /** West, north edges and size of an index cell, in degrees. */
  west: number;
  north: number;
  cw: number;
  ch: number;
  /** Vertices: lng, lat. */
  xy: Float64Array;
  /** Metres along its line at each vertex. */
  m: Float64Array;
  /** The line (index in this tile) of each vertex. */
  vLine: Int32Array;
  /** First vertex of each line, and one past the last line's end. */
  first: Int32Array;
  cls: Uint8Array;
  oneway: Int8Array;
  /** 1 = ramp, 2 = tunnel. */
  flags: Uint8Array;
  /** Id of the tile's first line; its lines' ids follow on. */
  id0: number;
  /** Index cells: segment start vertices of cell c are cellVerts[cellStart[c] .. cellStart[c + 1]). */
  cellStart: Int32Array;
  cellVerts: Int32Array;
  /** Which lookup last saw each vertex (no sets per lookup). */
  stamp: Uint32Array;
  used: number;
}

export interface RoadTilesOptions {
  /** TileJSON address of the vector tiles. */
  tileJson?: string;
  /** Or the tile address itself ({z}/{x}/{y}), asked each time (null while there is none). */
  tiles?: () => string | null;
  /** Their layout (OpenMapTiles unless said). */
  schema?: RoadSchema;
  /** Zoom of the tiles read (14). */
  zoom?: number;
  fetch?: typeof fetch;
  /** Tiles kept in memory (150: about 25 MB in the densest city, much less elsewhere). */
  maxTiles?: number;
  /** Downloads at a time (6). */
  parallel?: number;
}

interface Decoded {
  xy: number[];
  m: number[];
  vLine: number[];
  first: number[];
  cls: number[];
  oneway: number[];
  flags: number[];
}

/** The car roads of one tile, as flat arrays (consecutive vertices of a line at least 5 cm apart). */
export function decodeTile(buf: Uint8Array, x: number, y: number, z = ROAD_ZOOM, schema: RoadSchema = 'openmaptiles'): Decoded {
  const out: Decoded = { xy: [], m: [], vLine: [], first: [], cls: [], oneway: [], flags: [] };
  if (!buf.length) return out;
  const vt = new VectorTile(new Pbf(buf));
  const tt = schema === 'tomtom';
  const layer = vt.layers[tt ? 'roads' : 'transportation'];
  if (!layer) return out;
  const ext = layer.extent;
  for (let f = 0; f < layer.length; f++) {
    const feat = layer.feature(f);
    if (feat.type !== 2) continue;
    const pr = feat.properties;
    const cls = tt ? tomtomClass(String(pr.category ?? ''), String(pr.subcategory ?? '')) : String(pr.class ?? '');
    if (!cls || !CAR_ROADS.has(cls)) continue;
    const ow = Number((tt ? pr.direction : pr.oneway) ?? 0);
    const ramp = !tt && (pr.ramp === 1 || pr.ramp === true || pr.ramp === '1');
    const tunnel = tt ? pr.tunnel === true || pr.tunnel === 'true' : pr.brunnel === 'tunnel';
    for (const ring of feat.loadGeometry()) {
      if (ring.length < 2) continue;
      const l = out.first.length;
      const start = out.m.length;
      let prev: LngLat | null = null;
      let m = 0;
      for (const pt of ring) {
        const p: LngLat = [lngOf(x + pt.x / ext, z), latOf(y + pt.y / ext, z)];
        if (prev) {
          const len = metres(prev, p);
          if (len < 0.05) continue;
          m += len;
        }
        out.xy.push(p[0], p[1]);
        out.m.push(m);
        out.vLine.push(l);
        prev = p;
      }
      if (out.m.length - start < 2) {
        // Nothing but one point: drop it.
        out.xy.length = start * 2;
        out.m.length = start;
        out.vLine.length = start;
        continue;
      }
      out.first.push(start);
      out.cls.push(CLASS_CODES.indexOf(cls));
      out.oneway.push(ow === 1 ? 1 : ow === -1 ? -1 : 0);
      out.flags.push((ramp ? 1 : 0) | (tunnel ? 2 : 0));
    }
  }
  return out;
}

/** The car roads of one tile as road pieces (for checks and tests). */
export function decodeRoads(buf: ArrayBuffer | Uint8Array, x: number, y: number, nextLine: () => number, opts: { zoom?: number; schema?: RoadSchema } = {}): { segs: RoadSeg[]; lines: Map<number, RoadSeg[]> } {
  const t = new RoadTiles({ tileJson: '', ...opts });
  t.addTile(x, y, buf instanceof Uint8Array ? buf : new Uint8Array(buf));
  const segs: RoadSeg[] = [];
  const lines = new Map<number, RoadSeg[]>();
  for (const id of t.lineIds()) {
    const l = t.line(id)!;
    const own = nextLine();
    const copy = l.map((s) => ({ ...s, line: own }));
    lines.set(own, copy);
    segs.push(...copy);
  }
  return { segs, lines };
}

export class RoadTiles implements RoadSet {
  private tiles = new Map<string, Tile>();
  /** Tiles by their first line id, in id order (for finding a line's tile). */
  private byId: Tile[] = [];
  /** Lines built as road pieces lately (the matcher asks for the same ones again and again; the oldest go first). */
  private built = new Map<number, RoadSeg[]>();
  private waiting = new Map<string, Promise<boolean>>();
  private failedAt = new Map<string, number>();
  private queue: { key: string; done: (ok: boolean) => void }[] = [];
  private active = 0;
  private lineSeq = 1;
  private lookups = 0;
  private template: Promise<string | null> | null = null;
  private readonly f: typeof fetch;

  constructor(private opts: RoadTilesOptions) {
    this.f = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  get zoom(): number {
    return this.opts.zoom ?? ROAD_ZOOM;
  }

  /** The tiles a line passes through (and those within 30 m of it), in its order. */
  keysFor(coords: LngLat[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const z = this.zoom;
    const add = (p: LngLat) => {
      const dLat = 30 / 111_195;
      const dLng = dLat / Math.max(0.2, Math.cos((p[1] * Math.PI) / 180));
      const [x0, y0] = tileOf([p[0] - dLng, p[1] + dLat], z);
      const [x1, y1] = tileOf([p[0] + dLng, p[1] - dLat], z);
      for (let x = x0; x <= x1; x++)
        for (let y = y0; y <= y1; y++) {
          const k = keyOf(x, y);
          if (!seen.has(k)) {
            seen.add(k);
            out.push(k);
          }
        }
    };
    for (let i = 0; i < coords.length; i++) {
      add(coords[i]);
      if (i + 1 >= coords.length) break;
      const a = coords[i];
      const b = coords[i + 1];
      const n = Math.ceil(metres(a, b) / 20);
      for (let j = 1; j < n; j++) add([a[0] + ((b[0] - a[0]) * j) / n, a[1] + ((b[1] - a[1]) * j) / n]);
    }
    return out;
  }

  has(key: string): boolean {
    return this.tiles.has(key);
  }

  /**
   * Loads the tiles (a few at a time, in the given order). Resolves true once all are in, or false
   * after `budgetMs` or when some cannot be had; the downloads carry on either way.
   */
  load(keys: string[], budgetMs = Infinity, signal?: AbortSignal): Promise<boolean> {
    const all = Promise.all(keys.map((k) => this.want(k))).then((oks) => oks.every(Boolean));
    const races: Promise<boolean>[] = [all];
    let timer = 0;
    if (Number.isFinite(budgetMs)) races.push(new Promise((ok) => (timer = setTimeout(() => ok(false), budgetMs) as unknown as number)));
    if (signal)
      races.push(
        new Promise((_, no) => {
          if (signal.aborted) no(new DOMException('Aborted', 'AbortError'));
          signal.addEventListener('abort', () => no(new DOMException('Aborted', 'AbortError')), { once: true });
        }),
      );
    return Promise.race(races).finally(() => clearTimeout(timer));
  }

  private want(key: string): Promise<boolean> {
    if (this.tiles.has(key)) return Promise.resolve(true);
    const w = this.waiting.get(key);
    if (w) return w;
    // A tile that failed lately is not asked for again straight away.
    if (Date.now() - (this.failedAt.get(key) ?? -Infinity) < 30_000) return Promise.resolve(false);
    const p = new Promise<boolean>((done) => this.queue.push({ key, done }));
    this.waiting.set(key, p);
    this.pump();
    return p;
  }

  private pump() {
    const max = this.opts.parallel ?? 6;
    while (this.active < max && this.queue.length) {
      const job = this.queue.shift()!;
      this.active++;
      void this.fetchTile(job.key)
        .then((ok) => {
          if (!ok) this.failedAt.set(job.key, Date.now());
          job.done(ok);
        })
        .finally(() => {
          this.waiting.delete(job.key);
          this.active--;
          this.pump();
        });
    }
  }

  private tileUrl(): Promise<string | null> {
    if (this.opts.tiles) return Promise.resolve(this.opts.tiles());
    this.template ??= this.f(this.opts.tileJson ?? '')
      .then((r) => (r.ok ? r.json() : null))
      .then((j: { tiles?: string[] } | null) => j?.tiles?.[0] ?? null)
      .catch(() => null)
      .then((t) => {
        // Try again later when the tile list could not be had.
        if (!t) setTimeout(() => (this.template = null), 30_000);
        return t;
      });
    return this.template;
  }

  private async fetchTile(key: string): Promise<boolean> {
    try {
      const tpl = await this.tileUrl();
      if (!tpl) return false;
      const [x, y] = key.split('/').map(Number);
      const res = await this.f(tpl.replace('{z}', String(this.zoom)).replace('{x}', String(x)).replace('{y}', String(y)));
      if (!res.ok) return res.status === 204 || res.status === 404 ? this.addTile(x, y, new Uint8Array(0)) : false;
      return this.addTile(x, y, new Uint8Array(await res.arrayBuffer()));
    } catch {
      return false;
    }
  }

  /** Adds a downloaded tile (also used by the checks). */
  addTile(x: number, y: number, buf: Uint8Array): boolean {
    const z = this.zoom;
    const d = decodeTile(buf, x, y, z, this.opts.schema);
    const west = lngOf(x, z);
    const north = latOf(y, z);
    const id0 = this.lineSeq;
    this.lineSeq += d.first.length + 1;
    const first = Int32Array.from([...d.first, d.m.length]);
    const t: Tile = {
      x,
      y,
      west,
      north,
      cw: (lngOf(x + 1, z) - west) / CELLS,
      ch: (north - latOf(y + 1, z)) / CELLS,
      xy: Float64Array.from(d.xy),
      m: Float64Array.from(d.m),
      vLine: Int32Array.from(d.vLine),
      first,
      cls: Uint8Array.from(d.cls),
      oneway: Int8Array.from(d.oneway),
      flags: Uint8Array.from(d.flags),
      id0,
      cellStart: new Int32Array(0),
      cellVerts: new Int32Array(0),
      stamp: new Uint32Array(d.m.length),
      used: Date.now(),
    };
    // Two passes over the segments: count per cell, then fill.
    const side = CELLS + 4;
    const count = new Int32Array(side * side + 1);
    const eachCell = (fn: (c: number, v: number) => void) => {
      for (let l = 0; l + 1 < first.length; l++) {
        for (let v = first[l]; v + 1 < first[l + 1]; v++) {
          const [ax, ay, bx, by] = [t.xy[2 * v], t.xy[2 * v + 1], t.xy[2 * v + 2], t.xy[2 * v + 3]];
          const c0 = this.cell(t, Math.min(ax, bx), Math.max(ay, by));
          const c1 = this.cell(t, Math.max(ax, bx), Math.min(ay, by));
          for (let cx = c0[0]; cx <= c1[0]; cx++) for (let cy = c0[1]; cy <= c1[1]; cy++) fn(cx * side + cy, v);
        }
      }
    };
    eachCell((c) => count[c + 1]++);
    for (let c = 1; c < count.length; c++) count[c] += count[c - 1];
    const fill = count.slice();
    const verts = new Int32Array(count[count.length - 1]);
    eachCell((c, v) => (verts[fill[c]++] = v));
    t.cellStart = count;
    t.cellVerts = verts;
    const key = keyOf(x, y);
    const had = this.tiles.get(key);
    if (had) this.drop(key, had);
    this.tiles.set(key, t);
    this.byId.push(t);
    this.evict();
    return true;
  }

  /** Index cell of a point (cells reach two past the tile's edges, for its border roads). */
  private cell(t: Tile, lng: number, lat: number): [number, number] {
    const cx = Math.max(-2, Math.min(CELLS + 1, Math.floor((lng - t.west) / t.cw)));
    const cy = Math.max(-2, Math.min(CELLS + 1, Math.floor((t.north - lat) / t.ch)));
    return [cx + 2, cy + 2];
  }

  private drop(key: string, t: Tile) {
    this.tiles.delete(key);
    this.byId = this.byId.filter((x) => x !== t);
    for (let l = 0; l + 1 < t.first.length; l++) this.built.delete(t.id0 + l);
  }

  private evict() {
    const max = this.opts.maxTiles ?? 150;
    if (this.tiles.size <= max) return;
    const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.tiles.size - max);
    for (const [k, t] of old) this.drop(k, t);
  }

  /** The tile holding a line, and the line's index in it. */
  private tileOfLine(id: number): [Tile, number] | null {
    let lo = 0;
    let hi = this.byId.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const t = this.byId[mid];
      if (id < t.id0) hi = mid - 1;
      else if (id >= t.id0 + t.first.length - 1) lo = mid + 1;
      else return [t, id - t.id0];
    }
    return null;
  }

  /** Every loaded line's id (for checks). */
  *lineIds(): Generator<number> {
    for (const t of this.byId) for (let l = 0; l + 1 < t.first.length; l++) yield t.id0 + l;
  }

  private build(t: Tile, l: number): RoadSeg[] {
    const id = t.id0 + l;
    const had = this.built.get(id);
    if (had) return had;
    const segs: RoadSeg[] = [];
    const cls = CLASS_CODES[t.cls[l]] ?? 'minor';
    const oneway = t.oneway[l] as -1 | 0 | 1;
    const ramp = (t.flags[l] & 1) !== 0;
    const tunnel = (t.flags[l] & 2) !== 0;
    let a: LngLat = [t.xy[2 * t.first[l]], t.xy[2 * t.first[l] + 1]];
    for (let v = t.first[l]; v + 1 < t.first[l + 1]; v++) {
      const b: LngLat = [t.xy[2 * v + 2], t.xy[2 * v + 3]];
      const kx = Math.cos((a[1] * Math.PI) / 180);
      const brg = ((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
      segs.push({ line: id, i: segs.length, a, b, m: t.m[v], len: t.m[v + 1] - t.m[v], brg, cls, ramp, oneway, tunnel });
      a = b;
    }
    this.built.set(id, segs);
    if (this.built.size > 4000) this.built.delete(this.built.keys().next().value as number);
    return segs;
  }

  near(p: LngLat, r: number): RoadSeg[] | null {
    const dLat = r / 111_195;
    const dLng = dLat / Math.max(0.2, Math.cos((p[1] * Math.PI) / 180));
    const z = this.zoom;
    const [x0, y0] = tileOf([p[0] - dLng, p[1] + dLat], z);
    const [x1, y1] = tileOf([p[0] + dLng, p[1] - dLat], z);
    const stamp = ++this.lookups;
    const out: RoadSeg[] = [];
    for (let tx = x0; tx <= x1; tx++)
      for (let ty = y0; ty <= y1; ty++) {
        const t = this.tiles.get(keyOf(tx, ty));
        if (!t) return null;
        t.used = Date.now();
        const c0 = this.cell(t, p[0] - dLng, p[1] + dLat);
        const c1 = this.cell(t, p[0] + dLng, p[1] - dLat);
        let lastL = -1;
        let segs: RoadSeg[] = [];
        for (let cx = c0[0]; cx <= c1[0]; cx++)
          for (let cy = c0[1]; cy <= c1[1]; cy++) {
            const c = cx * (CELLS + 4) + cy;
            for (let k = t.cellStart[c]; k < t.cellStart[c + 1]; k++) {
              const v = t.cellVerts[k];
              if (t.stamp[v] === stamp) continue;
              t.stamp[v] = stamp;
              const l = t.vLine[v];
              if (l !== lastL) {
                segs = this.build(t, l);
                lastL = l;
              }
              out.push(segs[v - t.first[l]]);
            }
          }
      }
    return out;
  }

  line(id: number): RoadSeg[] | undefined {
    const at = this.tileOfLine(id);
    return at ? this.build(at[0], at[1]) : undefined;
  }
}
