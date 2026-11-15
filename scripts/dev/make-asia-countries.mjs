#!/usr/bin/env node
// Makes src/geo/asiaCountries.json: simplified outlines of the countries of Asia (Natural Earth
// 1:50m via world-atlas), for telling which country a point is in (toll payment cards and the like).
// Usage: npm i --no-save world-atlas@2 topojson-client@3 && node scripts/dev/make-asia-countries.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';

const require = createRequire(import.meta.url);
const topo = require(process.env.WORLD_ATLAS ?? 'world-atlas/countries-50m.json');
const { feature } = require(process.env.TOPOJSON ?? 'topojson-client');

/** ISO 3166 numeric → alpha-2 for the countries the app covers. */
const ISO = {
  458: 'MY', 702: 'SG', 96: 'BN', 764: 'TH', 360: 'ID', 608: 'PH', 704: 'VN', 116: 'KH', 418: 'LA', 104: 'MM', 626: 'TL',
  392: 'JP', 410: 'KR', 408: 'KP', 158: 'TW', 156: 'CN', 344: 'HK', 446: 'MO', 496: 'MN',
  356: 'IN', 586: 'PK', 50: 'BD', 144: 'LK', 524: 'NP', 64: 'BT', 462: 'MV',
  398: 'KZ', 860: 'UZ', 417: 'KG', 762: 'TJ', 795: 'TM', 4: 'AF',
  364: 'IR', 368: 'IQ', 682: 'SA', 784: 'AE', 634: 'QA', 48: 'BH', 414: 'KW', 512: 'OM', 887: 'YE', 400: 'JO', 422: 'LB', 376: 'IL', 275: 'PS', 760: 'SY', 51: 'AM', 31: 'AZ',
};
const TOL = 0.04;

function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    let max = 0;
    let idx = -1;
    const [ax, ay] = pts[a];
    const [bx, by] = pts[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1e-12;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + bx * ay - by * ax) / len;
      if (d > max) {
        max = d;
        idx = i;
      }
    }
    if (max > tol && idx > 0) {
      keep[idx] = 1;
      stack.push([a, idx], [idx, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/** A closed ring simplified in two halves (its ends are the same point). */
function simplifyRing(ring, tol) {
  let far = 0;
  let best = -1;
  for (let i = 1; i < ring.length - 1; i++) {
    const d = Math.hypot(ring[i][0] - ring[0][0], ring[i][1] - ring[0][1]);
    if (d > best) {
      best = d;
      far = i;
    }
  }
  if (far <= 0) return ring;
  return [...simplify(ring.slice(0, far + 1), tol).slice(0, -1), ...simplify(ring.slice(far), tol)];
}

const out = [];
const fc = feature(topo, topo.objects.countries);
for (const f of fc.features) {
  const code = ISO[Number(f.id)];
  if (!code) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  let w = 180, s = 90, e = -180, n = -90;
  for (const poly of polys) {
    // Outer rings only: lakes do not change the country.
    let r = simplifyRing(poly[0], TOL).map(([x, y]) => [Math.round(x * 100) / 100, Math.round(y * 100) / 100]);
    if (r.length < 4) {
      // Too small to keep its shape (Bahrain, Macao, an atoll): its box.
      const xs = poly[0].map((p) => p[0]);
      const ys = poly[0].map((p) => p[1]);
      const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)].map((v) => Math.round(v * 100) / 100);
      if (x1 - x0 < 0.005 && y1 - y0 < 0.005) continue;
      r = [[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]];
    }
    for (const [x, y] of r) {
      w = Math.min(w, x);
      e = Math.max(e, x);
      s = Math.min(s, y);
      n = Math.max(n, y);
    }
    rings.push(r.flat());
  }
  if (rings.length) out.push({ c: code, b: [w, s, e, n], r: rings });
}
out.sort((a, b) => (a.b[2] - a.b[0]) * (a.b[3] - a.b[1]) - (b.b[2] - b.b[0]) * (b.b[3] - b.b[1]));
writeFileSync(new URL('../../src/geo/asiaCountries.json', import.meta.url), JSON.stringify(out));
console.log(`${out.length} countries, ${JSON.stringify(out).length} bytes`);
