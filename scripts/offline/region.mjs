#!/usr/bin/env node
// Resolves one offline region from regions.json into the settings build-pack.sh reads: the
// Geofabrik extract to download (from Geofabrik's index), the outline to cut tiles and heights to,
// its box, driving side and zoom. Prints KEY=value lines (for $GITHUB_ENV).
//
// Usage: node region.mjs <region id> <work dir> [--shell]   (--shell: export lines for a shell to source)
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [id, work, flag] = process.argv.slice(2);
if (!id || !work) {
  console.error('usage: node region.mjs <region id> <work dir>');
  process.exit(2);
}
const { regions } = JSON.parse(readFileSync(join(HERE, 'regions.json'), 'utf8'));
const r = regions.find((x) => x.id === id);
if (!r) {
  console.error(`no region "${id}" in regions.json`);
  process.exit(2);
}
mkdirSync(work, { recursive: true });

const indexPath = join(work, 'geofabrik-index.json');
if (!existsSync(indexPath)) {
  // Geofabrik turns busy clients away for a while: try again, waiting longer each time.
  for (let i = 0; ; i++) {
    try {
      const res = await fetch('https://download.geofabrik.de/index-v1.json');
      if (!res.ok) throw new Error(`Geofabrik index: ${res.status}`);
      writeFileSync(indexPath, Buffer.from(await res.arrayBuffer()));
      break;
    } catch (e) {
      if (i >= 7) throw e;
      console.error(`Geofabrik index not reached (${e.message}); trying again in ${30 * (i + 1)} s`);
      await new Promise((r) => setTimeout(r, 30_000 * (i + 1)));
    }
  }
}
const index = JSON.parse(readFileSync(indexPath, 'utf8'));
const f = index.features.find((x) => x.properties.id === r.geofabrik);
if (!f) throw new Error(`Geofabrik has no extract "${r.geofabrik}"`);
const pbf = f.properties.urls?.pbf;
if (!pbf) throw new Error(`Geofabrik extract "${r.geofabrik}" has no .osm.pbf`);

/** The box around a GeoJSON geometry, a little wider. */
function boxOf(g) {
  let w = 180, s = 90, e = -180, n = -90;
  const walk = (c) => {
    if (typeof c[0] === 'number') {
      w = Math.min(w, c[0]);
      e = Math.max(e, c[0]);
      s = Math.min(s, c[1]);
      n = Math.max(n, c[1]);
    } else c.forEach(walk);
  };
  walk(g.coordinates);
  const f2 = (v) => Math.round(v * 100) / 100;
  return [f2(w - 0.01), f2(s - 0.01), f2(e + 0.01), f2(n + 0.01)];
}

let outline;
let clip = '0';
if (r.region) {
  outline = join(HERE, r.region);
  clip = '1';
} else if (r.bbox) {
  const [w, s, e, n] = r.bbox;
  outline = join(work, 'outline.geojson');
  writeFileSync(outline, JSON.stringify({ type: 'Polygon', coordinates: [[[w, s], [e, s], [e, n], [w, n], [w, s]]] }));
  clip = '1';
} else {
  outline = join(work, 'outline.geojson');
  writeFileSync(outline, JSON.stringify(f.geometry));
}
const bbox = r.bbox ?? boxOf(f.geometry);
const lines = {
  PACK_ID: r.id,
  PACK_NAME: r.name.en,
  PBF_URL: pbf,
  REGION: outline,
  CLIP: clip,
  BBOX: bbox.join(','),
  SIDE: r.side ?? 'right',
  MAXZOOM: String(r.maxzoom ?? 15),
  TERRAIN_ZOOM: String(r.terrainZoom ?? 12),
  SITE: r.site ? '1' : '0',
};
for (const [k, v] of Object.entries(lines)) console.log(flag === '--shell' ? `export ${k}='${v.replace(/'/g, `'\\''`)}'` : `${k}=${v}`);
