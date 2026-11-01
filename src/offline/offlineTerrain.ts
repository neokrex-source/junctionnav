/**
 * Ground heights from the offline pack (terrain.bin), for the hills in the 3D junction views
 * without internet. Tiles are read straight from browser storage when a junction needs them
 * (one, or at most four, per junction) and decompressed with the browser's own zlib.
 */
import { LocalFrame, type LngLat } from '../geo/geo';
import { GridPatch, tileXY, type TerrainPatch, type TerrainProvider } from '../junction/terrain';
import { decodeHeights, findTile, readTerrainHeader, readTerrainIndex, TERRAIN_ENTRY, TERRAIN_HEADER, type TerrainIndex } from './terrainLayout';

export interface TerrainFile {
  /** Changes when the pack changes; null when the installed pack has no heights. */
  key(): string | null;
  blob(): Promise<Blob>;
}

async function inflate(b: Blob): Promise<Uint8Array> {
  const stream = b.stream().pipeThrough(new DecompressionStream('deflate') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>);
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

export class TerrainPackReader {
  private opened: { key: string; idx: TerrainIndex; blob: Blob } | null = null;
  private opening: Promise<{ key: string; idx: TerrainIndex; blob: Blob } | null> | null = null;
  private tiles = new Map<string, Promise<Int16Array | null>>();

  constructor(private file: TerrainFile) {}

  /** The pack has heights. */
  get available(): boolean {
    return this.file.key() != null;
  }

  private open(): Promise<{ key: string; idx: TerrainIndex; blob: Blob } | null> {
    const key = this.file.key();
    if (!key) return Promise.resolve(null);
    if (this.opened?.key === key) return Promise.resolve(this.opened);
    if (this.opening) return this.opening;
    this.tiles.clear();
    this.opening = (async () => {
      try {
        const blob = await this.file.blob();
        const head = readTerrainHeader(new Uint8Array(await blob.slice(0, TERRAIN_HEADER).arrayBuffer()));
        const idx = readTerrainIndex(head, new Uint8Array(await blob.slice(TERRAIN_HEADER, TERRAIN_HEADER + head.count * TERRAIN_ENTRY).arrayBuffer()));
        this.opened = { key, idx, blob };
        return this.opened;
      } finally {
        this.opening = null;
      }
    })();
    return this.opening;
  }

  /** Zoom level and tile size of the stored heights. */
  async grid(): Promise<{ zoom: number; size: number } | null> {
    const o = await this.open();
    return o ? { zoom: o.idx.zoom, size: o.idx.size } : null;
  }

  /** Heights of one tile in whole metres (row by row from the north-west), or null outside the pack. */
  async tile(x: number, y: number): Promise<Int16Array | null> {
    const o = await this.open();
    if (!o) return null;
    const k = `${o.key}|${x}/${y}`;
    let t = this.tiles.get(k);
    if (!t) {
      const i = findTile(o.idx, x, y);
      if (i < 0) return null;
      const n = o.idx.size;
      t = inflate(o.blob.slice(o.idx.offset[i], o.idx.offset[i] + o.idx.length[i])).then((b) => decodeHeights(b, n));
      t.catch(() => this.tiles.delete(k));
      if (this.tiles.size >= 12) this.tiles.delete(this.tiles.keys().next().value!);
      this.tiles.set(k, t);
    }
    return t;
  }
}

/** The ground patch around a junction, sampled and cleaned like the online one. */
export class OfflineTerrainProvider implements TerrainProvider {
  readonly name = 'Offline terrain';
  constructor(private reader: TerrainPackReader) {}

  async fetch(center: LngLat, radius: number): Promise<TerrainPatch | null> {
    const g = await this.reader.grid();
    if (!g) return null;
    const { zoom: z, size } = g;
    const frame = new LocalFrame(center);
    // Pixel corners around the patch, one pixel of margin for the interpolation.
    const [ax, by] = tileXY(frame.toLngLat(-radius, -radius), z);
    const [bx, ay] = tileXY(frame.toLngLat(radius, radius), z);
    const loaded = new Map<string, Int16Array>();
    const tx0 = Math.floor(ax - 1 / size);
    const tx1 = Math.floor(bx + 1 / size);
    const ty0 = Math.floor(ay - 1 / size);
    const ty1 = Math.floor(by + 1 / size);
    await Promise.all(
      [...Array(tx1 - tx0 + 1).keys()].flatMap((dx) =>
        [...Array(ty1 - ty0 + 1).keys()].map(async (dy) => {
          const d = await this.reader.tile(tx0 + dx, ty0 + dy);
          if (d) loaded.set(`${tx0 + dx}/${ty0 + dy}`, d);
        }),
      ),
    );
    if (!loaded.size) return null;
    const pixel = (gx: number, gy: number): number | null => {
      const d = loaded.get(`${Math.floor(gx / size)}/${Math.floor(gy / size)}`);
      if (!d) return null;
      return d[(((gy % size) + size) % size) * size + (((gx % size) + size) % size)];
    };
    // Bilinear between pixel centres: the stored grid is coarser than the patch, so this keeps
    // slopes smooth instead of stepped.
    const height = (p: LngLat): number | null => {
      const [fx, fy] = tileXY(p, z);
      const gx = fx * size - 0.5;
      const gy = fy * size - 0.5;
      const i = Math.floor(gx);
      const j = Math.floor(gy);
      const u = gx - i;
      const v = gy - j;
      const a = pixel(i, j);
      const b = pixel(i + 1, j);
      const c = pixel(i, j + 1);
      const d = pixel(i + 1, j + 1);
      if (a == null || b == null || c == null || d == null) return a ?? b ?? c ?? d;
      return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
    };
    return GridPatch.sample(center, radius, 15, height);
  }
}
