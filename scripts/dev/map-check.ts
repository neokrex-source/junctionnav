/**
 * Checks the online JunctionNav map against OpenFreeMap (run on GitHub Actions, which can reach
 * it): the tile layers and fields the style uses exist, the fonts load, and a day and a night
 * picture of central KL with a route on it. Usage: vite-node scripts/dev/map-check.ts <out dir>
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { VectorTile } from '@mapbox/vector-tile';
import Pbf from 'pbf';
import { techOnlineStyle } from '../../src/map/techStyle';
import { themeFor } from '../../src/theme/palette';

const out = process.argv[2] ?? 'map-check';
mkdirSync(out, { recursive: true });
const style = techOnlineStyle(false, 'en');
const problems: string[] = [];

const tilejson = await (await fetch('https://tiles.openfreemap.org/planet')).json();
const have = new Set((tilejson.vector_layers ?? []).map((l: { id: string }) => l.id));
const used = new Set(style.layers.map((l) => (l as { 'source-layer'?: string })['source-layer']).filter(Boolean) as string[]);
for (const l of used) if (!have.has(l)) problems.push(`tile layer missing: ${l}`);
console.log('tile layers used:', [...used].join(', '));

for (const font of ['Noto Sans Regular', 'Noto Sans Bold', 'Noto Sans Italic']) {
  const res = await fetch(style.glyphs!.replace('{fontstack}', encodeURIComponent(font)).replace('{range}', '0-255'));
  if (!res.ok) problems.push(`font ${font}: ${res.status}`);
}

// One z14 tile over KLCC: are the fields the style filters on there?
const z = 14;
const [lng, lat] = [101.7119, 3.1578];
const x = Math.floor(((lng + 180) / 360) * 2 ** z);
const y = Math.floor(((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * 2 ** z);
const tileUrl = (tilejson.tiles[0] as string).replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y));
const tile = new VectorTile(new Pbf(new Uint8Array(await (await fetch(tileUrl)).arrayBuffer())));
const seen = (layer: string, key: string) => {
  const l = tile.layers[layer];
  if (!l) return false;
  for (let i = 0; i < l.length; i++) if (l.feature(i).properties[key] !== undefined) return true;
  return false;
};
for (const [layer, key] of [
  ['transportation', 'class'],
  ['transportation', 'brunnel'],
  ['transportation', 'ramp'],
  ['transportation_name', 'name'],
  ['transportation_name', 'name:en'],
  ['transportation_name', 'ref'],
  ['building', 'render_height'],
  ['place', 'class'],
]) {
  const ok = seen(layer, key);
  console.log(`${layer}.${key}: ${ok ? 'yes' : 'NO'}`);
  if (!ok && key !== 'name:en') problems.push(`field missing in KL tile: ${layer}.${key}`);
}

// Pictures: a page with MapLibre from node_modules and both styles, the route drawn on top.
for (const night of [false, true]) {
  const t = themeFor(night);
  writeFileSync(join(out, `style-${night ? 'night' : 'day'}.json`), JSON.stringify(techOnlineStyle(night, 'en')));
  writeFileSync(
    join(out, `page-${night ? 'night' : 'day'}.html`),
    `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/node_modules/maplibre-gl/dist/maplibre-gl.css">
<style>html,body,#m{margin:0;width:100%;height:100%}</style><div id="m"></div>
<script src="/node_modules/maplibre-gl/dist/maplibre-gl.js"></script>
<script>
const map = new maplibregl.Map({ container: 'm', style: '/${out}/style-${night ? 'night' : 'day'}.json', center: [101.7, 3.145], zoom: 14.2, pitch: 0, attributionControl: false });
map.on('load', () => {
  const coords = [[101.6865,3.1302],[101.6930,3.1360],[101.7010,3.1420],[101.7080,3.1490],[101.7119,3.1578]];
  map.addSource('r', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'LineString', coordinates: coords } } });
  map.addLayer({ id: 'g', type: 'line', source: 'r', layout: { 'line-cap': 'round' }, paint: { 'line-color': '${t.routeGlow}', 'line-width': 30, 'line-blur': 10 } });
  map.addLayer({ id: 'c', type: 'line', source: 'r', layout: { 'line-cap': 'round' }, paint: { 'line-color': '${t.routeCasing}', 'line-width': 14 } });
  map.addLayer({ id: 'l', type: 'line', source: 'r', layout: { 'line-cap': 'round' }, paint: { 'line-color': '${t.route}', 'line-width': 10 } });
  map.once('idle', () => (window.done = true));
});
map.on('error', (e) => console.error(String(e.error && e.error.message)));
</script>`,
  );
}
writeFileSync(join(out, 'problems.json'), JSON.stringify(problems, null, 1));
console.log(problems.length ? `PROBLEMS:\n${problems.join('\n')}` : 'no problems');
