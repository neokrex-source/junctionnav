/**
 * Pictures of the worst stretches route-align.mjs found: the JunctionNav map at street level with
 * every router's line drawn thin on top (served from the repo root on port 4173).
 *   node scripts/dev/route-align-shots.cjs <out dir>
 */
const { chromium } = require('playwright');
const { readFileSync, writeFileSync } = require('node:fs');
const { join } = require('node:path');

const out = process.argv[2] ?? 'route-align';
const shots = JSON.parse(readFileSync(join(out, 'shots.json'), 'utf8'));

const page = `<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="/node_modules/maplibre-gl/dist/maplibre-gl.css">
<style>html,body,#m{margin:0;width:100%;height:100%}#k{position:absolute;left:6px;top:6px;background:#fff;font:12px sans-serif;padding:4px 6px;border-radius:4px;z-index:5}</style>
<div id="m"></div><div id="k"></div>
<script src="/node_modules/maplibre-gl/dist/maplibre-gl.js"></script>
<script>
(async () => {
  const q = new URLSearchParams(location.search);
  const i = Number(q.get('i'));
  const [shots, routes, colors] = await Promise.all(['shots', 'routes', 'colors'].map((n) => fetch('/${out}/' + n + '.json').then((r) => r.json())));
  const s = shots[i];
  const set = routes[s.trip];
  document.getElementById('k').innerHTML = s.trip + ': ' + s.provider + ' ' + s.len + ' m, mean ' + s.mean.toFixed(1) + ' m<br>' +
    Object.keys(set).map((p) => '<span style="color:' + colors[p] + '">&#9632; ' + p + '</span>').join(' ');
  const map = new maplibregl.Map({ container: 'm', style: '/${out}/style-day.json', center: s.at, zoom: Number(q.get('z') || 17.3), attributionControl: false });
  map.on('load', () => {
    for (const [p, coords] of Object.entries(set)) {
      map.addSource(p, { type: 'geojson', data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } } });
      map.addLayer({ id: p, type: 'line', source: p, layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': colors[p], 'line-width': 3, 'line-opacity': 0.9 } });
    }
    map.once('idle', () => (window.done = true));
  });
})();
</script>`;
writeFileSync(join(out, 'shot.html'), page);

(async () => {
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
  for (const s of shots) {
    for (const z of [17.3, 15.6]) {
      const p = await browser.newPage({ viewport: { width: 520, height: 520 } });
      await p.goto(`http://localhost:4173/${out}/shot.html?i=${s.i}&z=${z}`);
      await p.waitForFunction(() => window.done, null, { timeout: 60000 }).catch(() => console.log(s.i, 'did not go idle'));
      await p.waitForTimeout(800);
      await p.screenshot({ path: join(out, `shot-${String(s.i).padStart(2, '0')}-z${Math.round(z)}.png`) });
      await p.close();
    }
  }
  await browser.close();
})();
