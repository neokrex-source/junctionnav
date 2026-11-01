#!/usr/bin/env node
// Bundles map fonts and sprites, compresses the graph and place index, splits big files into
// parts GitHub Pages serves comfortably, and writes manifest.json.
// Usage: node finish-pack.mjs <work dir> <out dir> --id peninsular-my --name "Peninsular Malaysia" --bbox w,s,e,n --side left
import { closeSync, createReadStream, createWriteStream, existsSync, mkdirSync, openSync, readSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { createGzip } from 'node:zlib';
import { pipeline } from 'node:stream/promises';
import { join } from 'node:path';

const [work, out, ...rest] = process.argv.slice(2);
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};
// GitHub Pages serves files up to 100 MB; smaller parts also make a paused download lose less.
const PART = Math.round(Number(opt('part-mb', '45')) * 1024 * 1024);
const ASSETS = 'https://raw.githubusercontent.com/protomaps/basemaps-assets/main';
const FONTS = ['Noto Sans Regular', 'Noto Sans Medium', 'Noto Sans Italic'];
// Latin and extensions, Greek, Cyrillic, Tamil, general punctuation, letterlike symbols and arrows.
const RANGES = [0, 256, 512, 768, 1024, 2816, 7680, 7936, 8192, 8448];

mkdirSync(out, { recursive: true });

/* ---------------------------------------------------- fonts and sprites -> assets.bin */
async function buildAssets() {
  const items = [];
  for (const font of FONTS)
    for (const r of RANGES) items.push([`fonts/${font}/${r}-${r + 255}.pbf`, `${ASSETS}/fonts/${encodeURIComponent(font)}/${r}-${r + 255}.pbf`]);
  for (const flavor of ['light', 'dark'])
    for (const suffix of ['.json', '.png', '@2x.json', '@2x.png']) items.push([`sprites/${flavor}${suffix}`, `${ASSETS}/sprites/v4/${flavor}${suffix}`]);
  const index = {};
  const chunks = [];
  let off = 0;
  for (const [path, url] of items) {
    const res = await fetch(url);
    if (!res.ok) {
      console.warn(`[assets] skip ${path}: ${res.status}`);
      continue;
    }
    const b = new Uint8Array(await res.arrayBuffer());
    index[path] = [off, b.length];
    chunks.push(b);
    off += b.length;
  }
  const bin = Buffer.concat(chunks);
  writeFileSync(join(work, 'assets.bin'), bin);
  writeFileSync(join(work, 'assets.json'), JSON.stringify(index));
  console.log(`[assets] ${Object.keys(index).length} files, ${(bin.length / 1048576).toFixed(1)} MB`);
}

async function gzipFile(src, dst) {
  await pipeline(createReadStream(src), createGzip({ level: 9 }), createWriteStream(dst));
}

/** Copies a file into the output as parts of at most PART bytes. */
function split(src, name) {
  const size = statSync(src).size;
  const fd = openSync(src, 'r');
  const buf = Buffer.alloc(PART);
  const parts = [];
  for (let i = 0, k = 0; i < size; i += PART, k++) {
    const path = `${name}.${String(k).padStart(3, '0')}`;
    const n = readSync(fd, buf, 0, Math.min(PART, size - i), i);
    writeFileSync(join(out, path), buf.subarray(0, n));
    parts.push({ path, size: n });
  }
  closeSync(fd);
  return parts;
}

if (!existsSync(join(work, 'assets.bin'))) await buildAssets();

const files = [];
const add = async (name, src, gzip) => {
  if (!existsSync(src)) throw new Error(`missing ${src}`);
  let from = src;
  if (gzip) {
    from = `${src}.gz`;
    await gzipFile(src, from);
  }
  const size = statSync(src).size;
  files.push({ name, size, gzip: !!gzip, parts: split(from, gzip ? `${name}.gz` : name) });
  if (gzip) rmSync(from);
  console.log(`[pack] ${name}: ${(size / 1048576).toFixed(1)} MB${gzip ? ` (${(files.at(-1).parts.reduce((a, p) => a + p.size, 0) / 1048576).toFixed(1)} MB compressed)` : ''}`);
};
await add('tiles.pmtiles', join(work, 'tiles.pmtiles'), false);
await add('graph.bin', join(work, 'graph.bin'), true);
await add('places.bin', join(work, 'places.bin'), true);
await add('assets.bin', join(work, 'assets.bin'), true);
await add('assets.json', join(work, 'assets.json'), false);
// Ground heights: already compressed tile by tile, so stored as they are.
if (existsSync(join(work, 'terrain.bin'))) await add('terrain.bin', join(work, 'terrain.bin'), false);

const built = new Date().toISOString();
const manifest = {
  id: opt('id', 'region'),
  name: opt('name', 'Offline region'),
  // Changes only when the pack is rebuilt, so an unfinished download can resume safely.
  version: built.replace(/[-:]/g, '').slice(0, 13),
  built,
  bbox: opt('bbox', '0,0,0,0').split(',').map(Number),
  drivingSide: opt('side', 'left'),
  attribution: '© OpenStreetMap contributors, © Protomaps',
  files,
};
writeFileSync(join(out, 'manifest.json'), JSON.stringify(manifest, null, 1));
const total = files.reduce((a, f) => a + f.parts.reduce((b, p) => b + p.size, 0), 0);
console.log(`[pack] manifest written; download size ${(total / 1048576).toFixed(0)} MB`);
