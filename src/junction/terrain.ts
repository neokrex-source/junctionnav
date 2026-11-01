/**
 * Ground elevation around junctions, from public terrain tiles (Terrarium PNG encoding:
 * height = R·256 + G + B/256 − 32768 metres). The source is a surface model (it includes some
 * trees and buildings), so the samples are cleaned before use: a morphological opening removes
 * bumps narrower than about 180 m, then a light blur smooths what is left.
 */
import { LocalFrame, type LngLat, type XY } from '../geo/geo';

export interface TerrainPatch {
  /** Ground height in metres above sea level, or null outside the patch. */
  at(p: LngLat): number | null;
}

export interface TerrainProvider {
  readonly name: string;
  fetch(center: LngLat, radius: number, signal?: AbortSignal): Promise<TerrainPatch | null>;
}

/** A square grid of ground heights in local metres around a centre. */
export class GridPatch implements TerrainPatch {
  readonly frame: LocalFrame;
  constructor(
    readonly center: LngLat,
    readonly half: number,
    readonly cell: number,
    readonly n: number,
    readonly data: Float32Array,
  ) {
    this.frame = new LocalFrame(center);
  }

  atXY([x, y]: XY): number | null {
    const fx = (x + this.half) / this.cell;
    const fy = (y + this.half) / this.cell;
    if (fx < 0 || fy < 0 || fx > this.n - 1 || fy > this.n - 1) return null;
    const i = Math.min(this.n - 2, Math.floor(fx));
    const j = Math.min(this.n - 2, Math.floor(fy));
    const tx = fx - i;
    const ty = fy - j;
    const d = this.data;
    const n = this.n;
    const a = d[j * n + i] * (1 - tx) + d[j * n + i + 1] * tx;
    const b = d[(j + 1) * n + i] * (1 - tx) + d[(j + 1) * n + i + 1] * tx;
    return a * (1 - ty) + b * ty;
  }

  at(p: LngLat): number | null {
    return this.atXY(this.frame.toXY(p));
  }

  /** Builds a patch by sampling a height function on the grid, then cleaning it. */
  static sample(center: LngLat, half: number, cell: number, height: (p: LngLat) => number | null, clean = true): GridPatch | null {
    const n = Math.round((2 * half) / cell) + 1;
    const frame = new LocalFrame(center);
    const data = new Float32Array(n * n);
    let missing = 0;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const h = height(frame.toLngLat(-half + i * cell, -half + j * cell));
        if (h == null || !Number.isFinite(h)) missing++;
        data[j * n + i] = h ?? NaN;
      }
    if (missing > n * n * 0.2) return null;
    fillGaps(data, n);
    if (clean) {
      // Radius 90 m: removes towers, malls and tree belts up to about 180 m across (the KLCC
      // towers and podium, office blocks); hills and valleys are much wider than that.
      const r = Math.max(1, Math.round(90 / cell));
      open(data, n, r);
      blur(data, n, Math.max(1, Math.round(20 / cell)));
      blur(data, n, Math.max(1, Math.round(20 / cell)));
    }
    return new GridPatch(center, half, cell, n, data);
  }
}

function fillGaps(d: Float32Array, n: number) {
  let sum = 0;
  let k = 0;
  for (const v of d)
    if (Number.isFinite(v)) {
      sum += v;
      k++;
    }
  const mean = k ? sum / k : 0;
  for (let i = 0; i < d.length; i++) if (!Number.isFinite(d[i])) d[i] = mean;
  void n;
}

/** Separable min (or max) filter of radius r. */
function extreme(d: Float32Array, n: number, r: number, max: boolean) {
  const tmp = new Float32Array(d.length);
  const pick = max ? Math.max : Math.min;
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      let v = d[j * n + i];
      for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) v = pick(v, d[j * n + k]);
      tmp[j * n + i] = v;
    }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      let v = tmp[j * n + i];
      for (let k = Math.max(0, j - r); k <= Math.min(n - 1, j + r); k++) v = pick(v, tmp[k * n + i]);
      d[j * n + i] = v;
    }
}

/** Opening: erosion then dilation, which removes narrow bumps (buildings, tree lines, decks). */
function open(d: Float32Array, n: number, r: number) {
  extreme(d, n, r, false);
  extreme(d, n, r, true);
}

function blur(d: Float32Array, n: number, r: number) {
  const tmp = new Float32Array(d.length);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      for (let k = Math.max(0, i - r); k <= Math.min(n - 1, i + r); k++) {
        s += d[j * n + k];
        c++;
      }
      tmp[j * n + i] = s / c;
    }
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      let s = 0;
      let c = 0;
      for (let k = Math.max(0, j - r); k <= Math.min(n - 1, j + r); k++) {
        s += tmp[k * n + i];
        c++;
      }
      d[j * n + i] = s / c;
    }
}

/* ---------------------------------------------------------------- Terrarium tiles */

const env = import.meta.env;
export const TERRAIN_URL: string = env.VITE_TERRAIN_URL || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

function tileXY(p: LngLat, z: number): [number, number] {
  const n = 2 ** z;
  const lat = (p[1] * Math.PI) / 180;
  return [((p[0] + 180) / 360) * n, ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n];
}

/** Decodes a Terrarium PNG into heights (browser only). */
async function decodeTile(blob: Blob): Promise<Float32Array> {
  const bmp = await createImageBitmap(blob, { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  const w = bmp.width;
  const h = bmp.height;
  const canvas: OffscreenCanvas | HTMLCanvasElement =
    typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(w, h) : Object.assign(document.createElement('canvas'), { width: w, height: h });
  const ctx = canvas.getContext('2d', { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!ctx) throw new Error('No 2D canvas');
  ctx.drawImage(bmp, 0, 0);
  bmp.close?.();
  const px = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = px[i * 4] * 256 + px[i * 4 + 1] + px[i * 4 + 2] / 256 - 32768;
  return out;
}

export class TerrariumProvider implements TerrainProvider {
  readonly name = 'Terrain tiles';
  private tiles = new Map<string, Promise<Float32Array | null>>();

  constructor(
    private url: () => string = () => TERRAIN_URL,
    private zoom = 14,
  ) {}

  private tile(x: number, y: number, signal?: AbortSignal): Promise<Float32Array | null> {
    const key = `${this.zoom}/${x}/${y}`;
    let t = this.tiles.get(key);
    if (!t) {
      const href = this.url().replace('{z}', String(this.zoom)).replace('{x}', String(x)).replace('{y}', String(y));
      t = fetch(href, { signal, mode: 'cors' })
        .then((r) => (r.ok ? r.blob() : Promise.reject(new Error(`terrain ${r.status}`))))
        .then(decodeTile)
        .catch((e) => {
          this.tiles.delete(key);
          throw e;
        });
      if (this.tiles.size > 24) this.tiles.delete(this.tiles.keys().next().value!);
      this.tiles.set(key, t);
    }
    return t;
  }

  async fetch(center: LngLat, radius: number, signal?: AbortSignal): Promise<TerrainPatch | null> {
    if (typeof createImageBitmap === 'undefined') return null;
    const z = this.zoom;
    const frame = new LocalFrame(center);
    const sw = frame.toLngLat(-radius, -radius);
    const ne = frame.toLngLat(radius, radius);
    const [x0, y1] = tileXY(sw, z).map(Math.floor);
    const [x1, y0] = tileXY(ne, z).map(Math.floor);
    const loaded = new Map<string, Float32Array>();
    await Promise.all(
      [...Array(x1 - x0 + 1).keys()].flatMap((dx) =>
        [...Array(y1 - y0 + 1).keys()].map(async (dy) => {
          const d = await this.tile(x0 + dx, y0 + dy, signal);
          if (d) loaded.set(`${x0 + dx}/${y0 + dy}`, d);
        }),
      ),
    );
    const size = 256;
    const height = (p: LngLat): number | null => {
      const [fx, fy] = tileXY(p, z);
      const tx = Math.floor(fx);
      const ty = Math.floor(fy);
      const d = loaded.get(`${tx}/${ty}`);
      if (!d) return null;
      const px = Math.min(size - 1, Math.max(0, Math.round((fx - tx) * size - 0.5)));
      const py = Math.min(size - 1, Math.max(0, Math.round((fy - ty) * size - 0.5)));
      const v = d[py * size + px];
      // Sea is shown at sea level; heights far below it are missing data.
      return v < -500 ? null : Math.max(0, v);
    };
    return GridPatch.sample(center, radius, 15, height);
  }
}

/** Ground for the demo: a gentle rise to the north and Bukit Demo, the hill the tunnel runs through. */
export class DemoTerrainProvider implements TerrainProvider {
  readonly name = 'Demo terrain';
  constructor(private height: (p: XY) => number, private origin: LngLat) {}
  async fetch(center: LngLat, radius: number): Promise<TerrainPatch | null> {
    const f = new LocalFrame(this.origin);
    return GridPatch.sample(center, radius, 15, (p) => this.height(f.toXY(p)), false);
  }
}

/** Fetches and keeps terrain patches per junction. */
export class TerrainCache {
  private patches = new Map<string, Promise<TerrainPatch | null>>();
  constructor(
    public provider: TerrainProvider,
    private radius = 950,
  ) {}

  static key(p: LngLat): string {
    return `${p[0].toFixed(4)},${p[1].toFixed(4)}`;
  }

  get(p: LngLat): Promise<TerrainPatch | null> {
    const k = TerrainCache.key(p);
    let t = this.patches.get(k);
    if (!t) {
      t = this.provider.fetch(p, this.radius).catch((e) => {
        console.warn('[terrain]', (e as Error).message ?? e);
        return null;
      });
      if (this.patches.size > 40) this.patches.delete(this.patches.keys().next().value!);
      this.patches.set(k, t);
    }
    return t;
  }
}
