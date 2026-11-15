#!/usr/bin/env node
// Puts the offline catalog together after the pack builds: the entries built now (entry.json from
// each build) and those of the last catalog that were not rebuilt.
// Usage: node make-catalog.mjs <dir with */entry.json> <previous catalog.json or -> <out catalog.json>
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mergeCatalog } from './catalog-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [entriesDir, previousPath, out] = process.argv.slice(2);
const { regions } = JSON.parse(readFileSync(join(HERE, 'regions.json'), 'utf8'));
const fresh = [];
if (existsSync(entriesDir))
  for (const d of readdirSync(entriesDir)) {
    const p = join(entriesDir, d, 'entry.json');
    if (statSync(join(entriesDir, d)).isDirectory() && existsSync(p)) fresh.push(JSON.parse(readFileSync(p, 'utf8')));
  }
let previous = null;
if (previousPath && previousPath !== '-' && existsSync(previousPath)) {
  try {
    previous = JSON.parse(readFileSync(previousPath, 'utf8'));
  } catch {
    previous = null;
  }
}
const cat = mergeCatalog(regions, fresh, previous);
writeFileSync(out, JSON.stringify(cat));
const mb = (e) => e.manifest.files.reduce((a, f) => a + f.parts.reduce((b, p) => b + p.size, 0), 0) / 1048576;
console.log(`[catalog] ${cat.packs.length} packs (${fresh.length} built now): ${cat.packs.map((e) => `${e.id} ${mb(e).toFixed(0)} MB`).join(', ')}`);
