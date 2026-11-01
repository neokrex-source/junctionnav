import { describe, expect, it } from 'vitest';
import { deflateSync } from 'node:zlib';
import { decodePng } from '../scripts/offline/png.mjs';
import { LocalFrame, type LngLat } from '../src/geo/geo';
import { tileXY, type TerrainPatch, type TerrainProvider } from '../src/junction/terrain';
import { OfflineTerrainProvider, TerrainPackReader } from '../src/offline/offlineTerrain';
import { HybridTerrain } from '../src/offline/providers';
import {
  decodeHeights,
  encodeHeights,
  findTile,
  readTerrainHeader,
  readTerrainIndex,
  TERRAIN_ENTRY,
  TERRAIN_HEADER,
  terrariumHeight,
  writeTerrainPack,
} from '../src/offline/terrainLayout';

const N = 256;

/** A small deterministic random source. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
}

describe('offline ground heights: file layout', () => {
  it('turns Terrarium pixels into whole metres, with the sea at sea level', () => {
    // 32768 + h: R = high byte, G = low byte, B = fraction.
    const px = (h: number) => {
      const v = h + 32768;
      return [Math.floor(v / 256), Math.floor(v) % 256, Math.round((v % 1) * 256)] as const;
    };
    expect(terrariumHeight(...px(57.6))).toBe(58);
    expect(terrariumHeight(...px(2187))).toBe(2187);
    expect(terrariumHeight(...px(-35))).toBe(0);
    expect(terrariumHeight(...px(-3000))).toBe(0);
    expect(terrariumHeight(255, 255, 255)).toBe(9000);
  });

  it('stores tiles losslessly, and smooth ground in very little space', () => {
    const r = rng(7);
    const hills = new Int16Array(N * N);
    for (let j = 0; j < N; j++)
      for (let i = 0; i < N; i++)
        hills[j * N + i] = Math.round(40 + 25 * Math.sin(i / 23) + 30 * Math.cos(j / 31) + 600 * Math.exp(-((i - 180) ** 2 + (j - 60) ** 2) / 900) + r() * 2);
    // Cliffs and the clamp limits survive too.
    hills[0] = 9000;
    hills[1] = 0;
    hills[N * 5 + 7] = 9000;
    const enc = encodeHeights(hills, N);
    expect(enc.length).toBe(2 * N * N);
    expect(Array.from(decodeHeights(enc, N))).toEqual(Array.from(hills));
    const packed = deflateSync(enc, { level: 9 });
    // 128 KB of heights in a few kilobytes; a flat sea tile in almost nothing.
    expect(packed.length).toBeLessThan(40_000);
    expect(deflateSync(encodeHeights(new Int16Array(N * N), N), { level: 9 }).length).toBeLessThan(300);
  });

  it('finds tiles by position in the index', () => {
    const tiles = [
      { x: 3200, y: 2001, data: new Uint8Array([1, 2, 3]) },
      { x: 3199, y: 2002, data: new Uint8Array([4]) },
      { x: 3201, y: 2001, data: new Uint8Array([5, 6]) },
    ];
    const file = writeTerrainPack(12, 256, tiles);
    const head = readTerrainHeader(file.subarray(0, TERRAIN_HEADER));
    expect(head).toEqual({ zoom: 12, size: 256, count: 3 });
    const idx = readTerrainIndex(head, file.subarray(TERRAIN_HEADER, TERRAIN_HEADER + 3 * TERRAIN_ENTRY));
    const at = (x: number, y: number) => {
      const k = findTile(idx, x, y);
      return k < 0 ? null : Array.from(file.subarray(idx.offset[k], idx.offset[k] + idx.length[k]));
    };
    expect(at(3200, 2001)).toEqual([1, 2, 3]);
    expect(at(3201, 2001)).toEqual([5, 6]);
    expect(at(3199, 2002)).toEqual([4]);
    expect(at(3199, 2001)).toBeNull();
    expect(() => readTerrainHeader(new Uint8Array(16))).toThrow(/Not a terrain file/);
  });
});

/* A PNG writer using every row filter, to check the builder's decoder against all of them. */
function crc32(b: Uint8Array): number {
  let c = ~0;
  for (const x of b) {
    c ^= x;
    for (let k = 0; k < 8; k++) c = c & 1 ? (c >>> 1) ^ 0xedb88320 : c >>> 1;
  }
  return ~c >>> 0;
}
function chunk(name: string, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + body.length);
  const dv = new DataView(out.buffer);
  dv.setUint32(0, body.length);
  for (let i = 0; i < 4; i++) out[4 + i] = name.charCodeAt(i);
  out.set(body, 8);
  dv.setUint32(8 + body.length, crc32(out.subarray(4, 8 + body.length)));
  return out;
}
function writePng(w: number, h: number, ch: 3 | 4, px: Uint8Array): Uint8Array {
  const stride = w * ch;
  const raw = new Uint8Array(h * (stride + 1));
  for (let y = 0; y < h; y++) {
    const f = y % 5;
    raw[y * (stride + 1)] = f;
    for (let i = 0; i < stride; i++) {
      const x = px[y * stride + i];
      const a = i >= ch ? px[y * stride + i - ch] : 0;
      const b = y > 0 ? px[(y - 1) * stride + i] : 0;
      const c = y > 0 && i >= ch ? px[(y - 1) * stride + i - ch] : 0;
      const p = a + b - c;
      const paeth = Math.abs(p - a) <= Math.abs(p - b) && Math.abs(p - a) <= Math.abs(p - c) ? a : Math.abs(p - b) <= Math.abs(p - c) ? b : c;
      const pred = [0, a, b, (a + b) >> 1, paeth][f];
      raw[y * (stride + 1) + 1 + i] = (x - pred) & 255;
    }
  }
  const ihdr = new Uint8Array(13);
  const dv = new DataView(ihdr.buffer);
  dv.setUint32(0, w);
  dv.setUint32(4, h);
  ihdr.set([8, ch === 3 ? 2 : 6, 0, 0, 0], 8);
  const parts = [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', new Uint8Array())];
  const out = new Uint8Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) out.set(p, (o += p.length) - p.length);
  return out;
}

describe('offline ground heights: pack builder PNG decoder', () => {
  it('reads RGB and RGBA tiles with every row filter', () => {
    const r = rng(3);
    for (const ch of [3, 4] as const) {
      const w = 37;
      const h = 23;
      const px = new Uint8Array(w * h * ch);
      for (let i = 0; i < px.length; i++) px[i] = (i * 7 + Math.floor(r() * 40)) & 255;
      const png = decodePng(writePng(w, h, ch, px));
      expect(png.width).toBe(w);
      expect(png.height).toBe(h);
      expect(png.channels).toBe(ch);
      expect(Array.from(png.data)).toEqual(Array.from(px));
    }
    expect(() => decodePng(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]))).toThrow(/not a PNG/);
  });
});

/* ---------------------------------------------------------------- reading heights in the app */
const KL: LngLat = [101.6869, 3.1478];
const Z = 12;
const frameKL = new LocalFrame(KL);
/** The test ground: rising 3 m every 100 m to the east, with a 90 m hill 600 m north. */
const ground = (p: LngLat) => {
  const [x, y] = frameKL.toXY(p);
  return 60 + 0.03 * x + 90 * Math.exp(-(x ** 2 + (y - 600) ** 2) / (2 * 350 ** 2));
};
const pixelLngLat = (gx: number, gy: number, z: number): LngLat => {
  const n = 2 ** z * N;
  return [(gx / n) * 360 - 180, (Math.atan(Math.sinh(Math.PI * (1 - (2 * gy) / n))) * 180) / Math.PI];
};

function packAround(center: LngLat, z: number) {
  const [cx, cy] = tileXY(center, z).map(Math.floor);
  const tiles = [];
  for (let ty = cy - 1; ty <= cy + 1; ty++)
    for (let tx = cx - 1; tx <= cx + 1; tx++) {
      const h = new Int16Array(N * N);
      for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) h[j * N + i] = Math.round(ground(pixelLngLat(tx * N + i + 0.5, ty * N + j + 0.5, z)));
      tiles.push({ x: tx, y: ty, data: deflateSync(encodeHeights(h, N), { level: 9 }) });
    }
  return writeTerrainPack(z, N, tiles);
}

const file = packAround(KL, Z);
const reader = (bytes: Uint8Array | null = file, key = 'pack-1') =>
  new TerrainPackReader({ key: () => (bytes ? key : null), blob: async () => new Blob([bytes as Uint8Array<ArrayBuffer>]) });

describe('offline ground heights in the 3D junction view', () => {
  it('gives the same ground as the source around a junction', async () => {
    const patch = await new OfflineTerrainProvider(reader()).fetch(KL, 950);
    expect(patch).not.toBeNull();
    const err = (x: number, y: number) => Math.abs(patch!.at(frameKL.toLngLat(x, y))! - ground(frameKL.toLngLat(x, y)));
    // On the slope: within the metre rounding.
    expect(err(0, 0)).toBeLessThan(1);
    expect(err(-400, -300)).toBeLessThan(1.2);
    expect(err(500, -200)).toBeLessThan(1.2);
    // The hill keeps its height (it is far wider than the buildings the cleaning removes); the
    // cleaning trims a few metres off its rounded top, exactly as it does online.
    expect(patch!.at(frameKL.toLngLat(0, 600))!).toBeGreaterThan(140);
    expect(err(0, 600)).toBeLessThan(8);
  });

  it('works across tile edges, and gives nothing outside the pack or without heights', async () => {
    // A point 300 m from a tile corner: the patch spans four tiles.
    const [fx, fy] = tileXY(KL, Z).map(Math.floor);
    const corner = pixelLngLat(fx * N, fy * N, Z);
    const near: LngLat = [corner[0] + 0.002, corner[1] - 0.002];
    const patch = await new OfflineTerrainProvider(reader()).fetch(near, 950);
    expect(patch).not.toBeNull();
    expect(Math.abs(patch!.at(corner)! - ground(corner))).toBeLessThan(1.5);
    expect(await new OfflineTerrainProvider(reader()).fetch([103.8, 1.35], 950)).toBeNull();
    const none = reader(null);
    expect(none.available).toBe(false);
    expect(await new OfflineTerrainProvider(none).fetch(KL, 950)).toBeNull();
  });

  it('reads a coarser pack too (zoom 11)', async () => {
    const patch = await new OfflineTerrainProvider(reader(packAround(KL, 11), 'z11')).fetch(KL, 950);
    expect(Math.abs(patch!.at(KL)! - ground(KL))).toBeLessThan(2);
  });
});

describe('online and offline ground heights together', () => {
  const flat = (h: number): TerrainPatch => ({ at: () => h });
  const online = (fail: boolean): TerrainProvider & { calls: number } => ({
    name: 'Terrain tiles',
    calls: 0,
    async fetch() {
      this.calls++;
      if (fail) throw new TypeError('Failed to fetch');
      return flat(10);
    },
  });
  const offline: TerrainProvider = { name: 'Offline terrain', fetch: async () => flat(20) };

  it('uses the pack when the online tiles cannot be reached', async () => {
    const t = new HybridTerrain(online(true), offline, { available: () => true, mode: () => 'auto' });
    expect((await t.fetch(KL, 950))!.at(KL)).toBe(20);
    const none = new HybridTerrain(online(true), offline, { available: () => false, mode: () => 'auto' });
    await expect(none.fetch(KL, 950)).rejects.toThrow(/Failed to fetch/);
  });

  it('prefers online with a connection, and the pack first when set to always', async () => {
    const on = online(false);
    expect((await new HybridTerrain(on, offline, { available: () => true, mode: () => 'auto' }).fetch(KL, 950))!.at(KL)).toBe(10);
    const on2 = online(false);
    const always = new HybridTerrain(on2, offline, { available: () => true, mode: () => 'always' });
    expect((await always.fetch(KL, 950))!.at(KL)).toBe(20);
    expect(on2.calls).toBe(0);
    expect(always.name).toBe('Offline terrain');
    // Outside the pack (no patch): online fills in.
    const empty = new HybridTerrain(online(false), { name: 'Offline terrain', fetch: async () => null }, { available: () => true, mode: () => 'always' });
    expect((await empty.fetch(KL, 950))!.at(KL)).toBe(10);
  });
});
