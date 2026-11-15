#!/usr/bin/env node
// The catalog entry for a pack published on a GitHub release: its region details from
// regions.json and its manifest with every part's release address.
// Usage: node release-entry.mjs <pack dir> <region id> <address prefix>
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { entryFor } from './catalog-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [dir, id, prefix] = process.argv.slice(2);
const { regions } = JSON.parse(readFileSync(join(HERE, 'regions.json'), 'utf8'));
const manifest = JSON.parse(readFileSync(join(dir, 'manifest.json'), 'utf8'));
const region = regions.find((r) => r.id === id);
if (!region) throw new Error(`no region ${id}`);
console.log(JSON.stringify(entryFor(region, manifest, prefix)));
