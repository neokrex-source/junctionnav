#!/usr/bin/env node
// Builds terrain.bin: ground heights for the 3D junction views without internet, from the public
// Terrarium elevation tiles (the same ones the app reads online), for the land inside the region.
//
// It starts at zoom 12 (a height every 38 m or so) and steps down to zoom 11 (about 76 m) if the
// file would be bigger than --max-mb. The 3D view smooths away anything narrower than about
// 180 m (buildings and trees in the source data) either way, so both keep the hills it shows.
//
// Usage: node build-terrain.mjs <region.geojson> <out terrain.bin> [--zoom 12] [--max-mb 40]
import { readFileSync, writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';
import { decodePng } from './png.mjs';
import { encodeHeights, terrariumHeight, writeTerrainPack } from '../../src/offline/terrainLayout.ts';

const [regionPath, output, ...rest] = process.argv.slice(2);
if (!regionPath || !output) {
  console.error('usage: node build-terrain.mjs <region.geojson> <out terrain.bin> [--zoom 12] [--max-mb 40]');
  process.exit(2);
}
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};
const ZOOM = Number(opt('zoom', '12'));
const MAX_BYTES = Number(opt('max-mb', '40')) * 1048576;
const TEMPLATE = opt('url', process.env.TERRAIN_URL || 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png');
const SIZE = 256;
const CONCURRENCY = 16;

/* ---------------------------------------------------------------- region and tile grid */
const g = JSON.parse(readFileSync(regionPath, 'utf8'));
const geom = g.type === 'Feature' ? g.geometry : g.type === 'FeatureCollection' ? g.features[0].geometry : g;
const rings = geom.type === 'Polygon' ? [geom.coordinates[0]] : geom.coordinates.map((p) => p[0]);

function inRing(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inside = (lon, lat) => rings.some((r) => inRing(r, lon, lat));

const lon2x = (lon, z) => ((lon + 180) / 360) * 2 ** z;
const lat2y = (lat, z) => {
  const r = (lat * Math.PI) / 180;
  return ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * 2 ** z;
};
const x2lon = (x, z) => (x / 2 ** z) * 360 - 180;
const y2lat = (y, z) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / 2 ** z))) * 180) / Math.PI;

/** Tiles that touch the region: a 9×9 sample inside the tile, or an outline corner in it. */
function tilesFor(z) {
  const pts = rings.flat();
  const x0 = Math.floor(lon2x(Math.min(...pts.map((p) => p[0])), z));
  const x1 = Math.floor(lon2x(Math.max(...pts.map((p) => p[0])), z));
  const y0 = Math.floor(lat2y(Math.max(...pts.map((p) => p[1])), z));
  const y1 = Math.floor(lat2y(Math.min(...pts.map((p) => p[1])), z));
  const out = [];
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const w = x2lon(x, z);
      const e = x2lon(x + 1, z);
      const n = y2lat(y, z);
      const s = y2lat(y + 1, z);
      let hit = pts.some(([lon, lat]) => lon >= w && lon < e && lat <= n && lat > s);
      for (let j = 0; j < 9 && !hit; j++) for (let i = 0; i < 9 && !hit; i++) hit = inside(w + ((i + 0.5) / 9) * (e - w), n + ((j + 0.5) / 9) * (s - n));
      if (hit) out.push([x, y]);
    }
  return out;
}

/* ---------------------------------------------------------------- download */
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchTile(z, x, y) {
  const url = TEMPLATE.replace('{z}', z).replace('{x}', x).replace('{y}', y);
  let last;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const res = await fetch(url);
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const png = decodePng(Buffer.from(await res.arrayBuffer()));
      if (png.width !== SIZE || png.height !== SIZE || png.channels < 3) throw new Error(`unexpected tile ${png.width}×${png.height}×${png.channels}`);
      const h = new Int16Array(SIZE * SIZE);
      const c = png.channels;
      for (let i = 0; i < SIZE * SIZE; i++) h[i] = terrariumHeight(png.data[i * c], png.data[i * c + 1], png.data[i * c + 2]);
      return h;
    } catch (e) {
      last = e;
      await sleep(1000 * 2 ** attempt);
    }
  }
  throw new Error(`${url}: ${last?.message ?? last}`);
}

async function downloadAll(z, list) {
  const heights = new Map();
  let next = 0;
  let done = 0;
  let failed = 0;
  let missing = 0;
  const t0 = Date.now();
  await Promise.all(
    Array.from({ length: CONCURRENCY }, async () => {
      while (next < list.length) {
        const [x, y] = list[next++];
        try {
          const h = await fetchTile(z, x, y);
          if (h) heights.set(`${x}/${y}`, h);
          else missing++;
        } catch (e) {
          failed++;
          console.warn(`[terrain] ${e.message}`);
        }
        if (++done % 250 === 0) console.log(`[terrain] ${done}/${list.length} tiles (${Math.round((Date.now() - t0) / 1000)} s)`);
      }
    }),
  );
  if (failed > list.length * 0.02) throw new Error(`${failed} of ${list.length} terrain tiles failed to download`);
  console.log(`[terrain] downloaded ${heights.size} tiles, ${missing} without data, ${failed} failed`);
  return heights;
}

/* ---------------------------------------------------------------- encode */
function encodeAll(heights) {
  const tiles = [];
  for (const [key, h] of heights) {
    const [x, y] = key.split('/').map(Number);
    tiles.push({ x, y, data: deflateSync(encodeHeights(h, SIZE), { level: 9 }) });
  }
  return tiles;
}

/** One zoom level up: each pixel is the mean of the 2×2 pixels under it (missing tiles are sea). */
function halve(heights) {
  const parents = new Map();
  for (const [key, h] of heights) {
    const [x, y] = key.split('/').map(Number);
    const pk = `${x >> 1}/${y >> 1}`;
    if (!parents.has(pk)) parents.set(pk, [null, null, null, null]);
    parents.get(pk)[(y & 1) * 2 + (x & 1)] = h;
  }
  const out = new Map();
  for (const [pk, kids] of parents) {
    const p = new Int16Array(SIZE * SIZE);
    for (let py = 0; py < SIZE; py++)
      for (let px = 0; px < SIZE; px++) {
        const kid = kids[(py >> 7) * 2 + (px >> 7)];
        if (!kid) continue;
        const cx = (px & 127) * 2;
        const cy = (py & 127) * 2;
        const s = kid[cy * SIZE + cx] + kid[cy * SIZE + cx + 1] + kid[(cy + 1) * SIZE + cx] + kid[(cy + 1) * SIZE + cx + 1];
        p[py * SIZE + px] = Math.round(s / 4);
      }
    out.set(pk, p);
  }
  return out;
}

const list = tilesFor(ZOOM);
console.log(`[terrain] zoom ${ZOOM}: ${list.length} tiles touch the region`);
let heights = await downloadAll(ZOOM, list);
let zoom = ZOOM;
let file = writeTerrainPack(zoom, SIZE, encodeAll(heights));
while (file.length > MAX_BYTES && zoom > 9) {
  console.log(`[terrain] zoom ${zoom} is ${(file.length / 1048576).toFixed(1)} MB, over ${MAX_BYTES / 1048576} MB; trying zoom ${zoom - 1}`);
  heights = halve(heights);
  zoom--;
  file = writeTerrainPack(zoom, SIZE, encodeAll(heights));
}
writeFileSync(output, file);
console.log(`[terrain] wrote ${output}: zoom ${zoom}, ${heights.size} tiles, ${(file.length / 1048576).toFixed(1)} MB`);
