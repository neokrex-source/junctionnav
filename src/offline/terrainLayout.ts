/**
 * Binary layout of the offline ground heights (terrain.bin), used by the 3D junction views when
 * there is no internet. Shared by the pack builder (Node, run on GitHub Actions) and the app, so
 * it must not import anything.
 *
 * The heights come from the same public Terrarium tiles the app reads online, as square tiles in
 * the usual web map grid at one zoom level. Each tile is stored as whole metres, predicted from
 * its neighbours (LOCO-I median predictor), with the small leftovers split into a low and a high
 * byte plane and zlib compressed. Smooth ground leaves leftovers of a metre or two, so a tile
 * shrinks to a few kilobytes, and the sea to almost nothing.
 *
 * File: "JNTR" | version u8 | zoom u8 | tile size u16 | tile count u32 | reserved u32
 *       | count × (x u16 | y u16 | offset u32 | length u32), sorted by y then x
 *       | zlib streams. Little endian throughout.
 */

export const TERRAIN_MAGIC = 'JNTR';
export const TERRAIN_VERSION = 1;
export const TERRAIN_HEADER = 16;
export const TERRAIN_ENTRY = 12;
/** Heights are clamped to this range (metres); Gunung Tahan, the highest point, is 2,187 m. */
export const TERRAIN_MIN = 0;
export const TERRAIN_MAX = 9000;

export interface TerrainHeader {
  zoom: number;
  size: number;
  count: number;
}

export interface TerrainIndex extends TerrainHeader {
  x: Uint16Array;
  y: Uint16Array;
  offset: Uint32Array;
  length: Uint32Array;
}

/** Height in metres from a Terrarium pixel, as the app uses it: sea at sea level. */
export function terrariumHeight(r: number, g: number, b: number): number {
  const v = r * 256 + g + b / 256 - 32768;
  if (v < -500) return 0;
  return Math.min(TERRAIN_MAX, Math.max(TERRAIN_MIN, Math.round(v)));
}

function predict(h: Int16Array, n: number, i: number, j: number): number {
  if (j === 0) return i === 0 ? 0 : h[i - 1];
  if (i === 0) return h[(j - 1) * n];
  const a = h[j * n + i - 1];
  const b = h[(j - 1) * n + i];
  const c = h[(j - 1) * n + i - 1];
  if (c >= Math.max(a, b)) return Math.min(a, b);
  if (c <= Math.min(a, b)) return Math.max(a, b);
  return a + b - c;
}

/** A tile of n×n heights to prediction leftovers, as 2·n·n bytes (low bytes, then high bytes). */
export function encodeHeights(h: Int16Array, n: number): Uint8Array {
  const out = new Uint8Array(2 * n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const r = h[k] - predict(h, n, i, j);
      const z = r >= 0 ? r * 2 : -r * 2 - 1;
      out[k] = z & 255;
      out[n * n + k] = z >>> 8;
    }
  return out;
}

/** The inverse of encodeHeights. */
export function decodeHeights(bytes: Uint8Array, n: number): Int16Array {
  if (bytes.length < 2 * n * n) throw new Error('Terrain tile is too short');
  const h = new Int16Array(n * n);
  for (let j = 0; j < n; j++)
    for (let i = 0; i < n; i++) {
      const k = j * n + i;
      const z = bytes[k] | (bytes[n * n + k] << 8);
      const r = z & 1 ? -((z + 1) >>> 1) : z >>> 1;
      h[k] = predict(h, n, i, j) + r;
    }
  return h;
}

/** Writes the whole file from compressed tiles. */
export function writeTerrainPack(zoom: number, size: number, tiles: { x: number; y: number; data: Uint8Array }[]): Uint8Array {
  const sorted = [...tiles].sort((a, b) => a.y - b.y || a.x - b.x);
  const head = TERRAIN_HEADER + sorted.length * TERRAIN_ENTRY;
  const total = sorted.reduce((s, t) => s + t.data.length, head);
  const out = new Uint8Array(total);
  const dv = new DataView(out.buffer);
  for (let i = 0; i < 4; i++) out[i] = TERRAIN_MAGIC.charCodeAt(i);
  dv.setUint8(4, TERRAIN_VERSION);
  dv.setUint8(5, zoom);
  dv.setUint16(6, size, true);
  dv.setUint32(8, sorted.length, true);
  let off = head;
  sorted.forEach((t, k) => {
    const e = TERRAIN_HEADER + k * TERRAIN_ENTRY;
    dv.setUint16(e, t.x, true);
    dv.setUint16(e + 2, t.y, true);
    dv.setUint32(e + 4, off, true);
    dv.setUint32(e + 8, t.data.length, true);
    out.set(t.data, off);
    off += t.data.length;
  });
  return out;
}

/** Reads the first TERRAIN_HEADER bytes. */
export function readTerrainHeader(b: Uint8Array): TerrainHeader {
  if (b.length < TERRAIN_HEADER || String.fromCharCode(b[0], b[1], b[2], b[3]) !== TERRAIN_MAGIC) throw new Error('Not a terrain file');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  if (dv.getUint8(4) !== TERRAIN_VERSION) throw new Error(`Terrain file version ${dv.getUint8(4)} is not supported`);
  return { zoom: dv.getUint8(5), size: dv.getUint16(6, true), count: dv.getUint32(8, true) };
}

/** Reads the tile list that follows the header (pass the bytes from TERRAIN_HEADER on). */
export function readTerrainIndex(h: TerrainHeader, b: Uint8Array): TerrainIndex {
  if (b.length < h.count * TERRAIN_ENTRY) throw new Error('Terrain index is cut short');
  const dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
  const idx: TerrainIndex = { ...h, x: new Uint16Array(h.count), y: new Uint16Array(h.count), offset: new Uint32Array(h.count), length: new Uint32Array(h.count) };
  for (let k = 0; k < h.count; k++) {
    const e = k * TERRAIN_ENTRY;
    idx.x[k] = dv.getUint16(e, true);
    idx.y[k] = dv.getUint16(e + 2, true);
    idx.offset[k] = dv.getUint32(e + 4, true);
    idx.length[k] = dv.getUint32(e + 8, true);
  }
  return idx;
}

/** Position of tile (x, y) in the index, or -1. */
export function findTile(idx: TerrainIndex, x: number, y: number): number {
  let lo = 0;
  let hi = idx.count - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    const d = idx.y[mid] - y || idx.x[mid] - x;
    if (d === 0) return mid;
    if (d < 0) lo = mid + 1;
    else hi = mid - 1;
  }
  return -1;
}
