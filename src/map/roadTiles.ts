/**
 * The map's road lines, read from the same OpenFreeMap vector tiles the map draws (zoom 14, the
 * most detailed level; the map scales those up beyond it), for lining routes up with them
 * (src/routing/align.ts). Tiles load a few at a time in the order the route passes them and stay
 * in memory for later routes (reroutes, alternatives). The browser's cache is shared with the
 * map, so a tile the map already has costs nothing, and one fetched here is ready for the map.
 *
 * A z14 tile carries its neighbours' roads for about 38 m past its edge, so the roads within 25 m
 * of a point all come from the point's own tile.
 */
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import type { LngLat } from '../geo/geo';
import { metres, type RoadSeg, type RoadSet } from '../routing/align';

export const ROAD_ZOOM = 14;
const N = 2 ** ROAD_ZOOM;
/** Roads a car can be routed on (OpenMapTiles classes). */
const CAR_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor', 'service', 'busway']);
/** Index cells per tile side. */
const CELLS = 16;

export function tileOf(p: LngLat): [number, number] {
  const lat = Math.max(-85, Math.min(85, p[1])) * (Math.PI / 180);
  const x = Math.floor(((p[0] + 180) / 360) * N);
  const y = Math.floor(((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * N);
  return [Math.max(0, Math.min(N - 1, x)), Math.max(0, Math.min(N - 1, y))];
}

const keyOf = (x: number, y: number) => `${x}/${y}`;

function lngOf(x: number): number {
  return (x / N) * 360 - 180;
}
function latOf(y: number): number {
  return (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / N))) * 180) / Math.PI;
}

interface Tile {
  x: number;
  y: number;
  /** West, north edges and size of an index cell, in degrees. */
  west: number;
  north: number;
  cw: number;
  ch: number;
  segs: RoadSeg[];
  cells: Map<number, number[]>;
  lines: number[];
  used: number;
}

export interface RoadTilesOptions {
  /** TileJSON address of the vector tiles (OpenMapTiles schema). */
  tileJson: string;
  fetch?: typeof fetch;
  /** Tiles kept in memory (300). */
  maxTiles?: number;
  /** Downloads at a time (6). */
  parallel?: number;
}

/** Decodes the car roads of one tile. `nextLine` hands out line ids. */
export function decodeRoads(buf: ArrayBuffer | Uint8Array, x: number, y: number, nextLine: () => number): { segs: RoadSeg[]; lines: Map<number, RoadSeg[]> } {
  const vt = new VectorTile(new Pbf(buf instanceof Uint8Array ? buf : new Uint8Array(buf)));
  const layer = vt.layers.transportation;
  const segs: RoadSeg[] = [];
  const lines = new Map<number, RoadSeg[]>();
  if (!layer) return { segs, lines };
  const ext = layer.extent;
  for (let f = 0; f < layer.length; f++) {
    const feat = layer.feature(f);
    if (feat.type !== 2) continue;
    const pr = feat.properties;
    const cls = String(pr.class ?? '');
    if (!CAR_ROADS.has(cls)) continue;
    const ow = Number(pr.oneway ?? 0);
    const oneway: -1 | 0 | 1 = ow === 1 ? 1 : ow === -1 ? -1 : 0;
    const ramp = pr.ramp === 1 || pr.ramp === true || pr.ramp === '1';
    const tunnel = pr.brunnel === 'tunnel';
    for (const ring of feat.loadGeometry()) {
      if (ring.length < 2) continue;
      const id = nextLine();
      const list: RoadSeg[] = [];
      let m = 0;
      let a: LngLat = [lngOf(x + ring[0].x / ext), latOf(y + ring[0].y / ext)];
      for (let k = 1; k < ring.length; k++) {
        const b: LngLat = [lngOf(x + ring[k].x / ext), latOf(y + ring[k].y / ext)];
        const len = metres(a, b);
        if (len >= 0.05) {
          const kx = Math.cos((a[1] * Math.PI) / 180);
          const brg = ((Math.atan2((b[0] - a[0]) * kx, b[1] - a[1]) * 180) / Math.PI + 360) % 360;
          const seg: RoadSeg = { line: id, i: list.length, a, b, m, len, brg, cls, ramp, oneway, tunnel };
          list.push(seg);
          segs.push(seg);
          m += len;
          a = b;
        }
      }
      if (list.length) lines.set(id, list);
    }
  }
  return { segs, lines };
}

export class RoadTiles implements RoadSet {
  private tiles = new Map<string, Tile>();
  private lines = new Map<number, RoadSeg[]>();
  private waiting = new Map<string, Promise<boolean>>();
  private failedAt = new Map<string, number>();
  private queue: { key: string; done: (ok: boolean) => void }[] = [];
  private active = 0;
  private lineSeq = 1;
  private template: Promise<string | null> | null = null;
  private readonly f: typeof fetch;

  constructor(private opts: RoadTilesOptions) {
    this.f = opts.fetch ?? ((input, init) => fetch(input, init));
  }

  /** The tiles a line passes through, in its order. */
  keysFor(coords: LngLat[]): string[] {
    const seen = new Set<string>();
    const out: string[] = [];
    const add = (p: LngLat) => {
      const [x, y] = tileOf(p);
      const k = keyOf(x, y);
      if (!seen.has(k)) {
        seen.add(k);
        out.push(k);
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
    this.template ??= this.f(this.opts.tileJson)
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
      const res = await this.f(tpl.replace('{z}', String(ROAD_ZOOM)).replace('{x}', String(x)).replace('{y}', String(y)));
      if (!res.ok) return res.status === 204 || res.status === 404 ? this.addTile(x, y, new Uint8Array(0)) : false;
      return this.addTile(x, y, new Uint8Array(await res.arrayBuffer()));
    } catch {
      return false;
    }
  }

  /** Adds a downloaded tile (also used by the checks). */
  addTile(x: number, y: number, buf: Uint8Array): boolean {
    const { segs, lines } = buf.length ? decodeRoads(buf, x, y, () => this.lineSeq++) : { segs: [], lines: new Map<number, RoadSeg[]>() };
    const west = lngOf(x);
    const north = latOf(y);
    const t: Tile = { x, y, west, north, cw: (lngOf(x + 1) - west) / CELLS, ch: (north - latOf(y + 1)) / CELLS, segs, cells: new Map(), lines: [...lines.keys()], used: Date.now() };
    segs.forEach((s, i) => {
      const c0 = this.cell(t, Math.min(s.a[0], s.b[0]), Math.max(s.a[1], s.b[1]));
      const c1 = this.cell(t, Math.max(s.a[0], s.b[0]), Math.min(s.a[1], s.b[1]));
      for (let cx = c0[0]; cx <= c1[0]; cx++)
        for (let cy = c0[1]; cy <= c1[1]; cy++) {
          const k = cx * 64 + cy;
          const list = t.cells.get(k);
          if (list) list.push(i);
          else t.cells.set(k, [i]);
        }
    });
    for (const [id, l] of lines) this.lines.set(id, l);
    this.tiles.set(keyOf(x, y), t);
    this.evict();
    return true;
  }

  /** Index cell of a point (cells reach two past the tile's edges, for its border roads). */
  private cell(t: Tile, lng: number, lat: number): [number, number] {
    const cx = Math.max(-2, Math.min(CELLS + 1, Math.floor((lng - t.west) / t.cw)));
    const cy = Math.max(-2, Math.min(CELLS + 1, Math.floor((t.north - lat) / t.ch)));
    return [cx + 2, cy + 2];
  }

  private evict() {
    const max = this.opts.maxTiles ?? 300;
    if (this.tiles.size <= max) return;
    const old = [...this.tiles.entries()].sort((a, b) => a[1].used - b[1].used).slice(0, this.tiles.size - max);
    for (const [k, t] of old) {
      this.tiles.delete(k);
      for (const id of t.lines) this.lines.delete(id);
    }
  }

  near(p: LngLat, r: number): RoadSeg[] | null {
    const [x, y] = tileOf(p);
    const t = this.tiles.get(keyOf(x, y));
    if (!t) return null;
    t.used = Date.now();
    const dLat = r / 111_195;
    const dLng = dLat / Math.max(0.2, Math.cos((p[1] * Math.PI) / 180));
    const c0 = this.cell(t, p[0] - dLng, p[1] + dLat);
    const c1 = this.cell(t, p[0] + dLng, p[1] - dLat);
    const seen = new Set<number>();
    const out: RoadSeg[] = [];
    for (let cx = c0[0]; cx <= c1[0]; cx++)
      for (let cy = c0[1]; cy <= c1[1]; cy++) {
        for (const i of t.cells.get(cx * 64 + cy) ?? []) {
          if (seen.has(i)) continue;
          seen.add(i);
          out.push(t.segs[i]);
        }
      }
    return out;
  }

  line(id: number): RoadSeg[] | undefined {
    return this.lines.get(id);
  }
}
