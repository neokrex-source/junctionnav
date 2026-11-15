#!/usr/bin/env node
// For the Pages deploy: copies the packs marked `site` in regions.json from their release into the
// site (dist/offline/<id>/), and writes the catalog the app reads (dist/offline/catalog.json) and,
// for older app versions, dist/offline/manifest.json (the first site pack).
// Needs gh (GH_TOKEN) to read the releases of SITE_REPO.
// Usage: node site-packs.mjs <catalog.json> <out dir>
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { siteCatalog } from './catalog-lib.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const [catalogPath, out] = process.argv.slice(2);
const { regions } = JSON.parse(readFileSync(join(HERE, 'regions.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(catalogPath, 'utf8'));
const repo = process.env.SITE_REPO || process.env.GITHUB_REPOSITORY;
mkdirSync(out, { recursive: true });
const local = new Set();
for (const r of regions.filter((x) => x.site)) {
  const e = catalog.packs.find((x) => x.id === r.id);
  if (!e) continue;
  const dir = join(out, r.id);
  mkdirSync(dir, { recursive: true });
  const version = e.manifest.version;
  try {
    execFileSync('gh', ['release', 'download', `maps-${r.id}`, '-R', repo, '-p', `${version}.*`, '-D', dir, '--clobber'], { stdio: 'inherit' });
    local.add(r.id);
  } catch (err) {
    console.log(`::warning::Could not copy the ${r.id} pack into the site: ${err.message}`);
  }
}
const site = siteCatalog(catalog, regions, local);
writeFileSync(join(out, 'catalog.json'), JSON.stringify(site));
const first = site.packs.find((e) => e.web);
if (first) writeFileSync(join(out, 'manifest.json'), JSON.stringify(first.manifest, null, 1));
console.log(`::notice title=Offline maps published::${site.packs.length} countries and regions in the catalog; on the site: ${site.packs.filter((e) => e.web).map((e) => e.id).join(', ') || 'none'}`);
