/**
 * Speed limits and speed cameras on real roads: the Peninsular Malaysia pack (PACK_DIR, as on
 * GitHub Actions), routes around KL and Perak from the offline router, and for each the limits
 * the app would show (OpenStreetMap's maxspeed from the pack, the national 110 km/h on
 * expressways where the map has none) and the speed cameras on the route's own carriageway.
 * Prints a table per trip and the cameras found; fails when expressways are left without a
 * limit, when a limit is not one Malaysia signs, or when the pack's cameras cannot be read.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LngLat } from '../src/geo/geo';
import { limitAt, matchCameras, matchLimits, mergeLimits, nationalLimits, type LimitSpan } from '../src/nav/speed';
import { densifyPath } from '../src/nav/tolls';
import { OfflineGraph } from '../src/offline/graph';
import { PlaceIndex } from '../src/offline/places';
import { speedData } from '../src/offline/queries';
import { OfflineRouter } from '../src/offline/router';
import { routeKinds } from '../src/routing/align';
import { normalizeOsrm } from '../src/routing/osrm';

const dir = process.env.PACK_DIR;
const ab = (f: string) => {
  const b = readFileSync(join(dir!, f));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

const TRIPS: [string, LngLat, LngLat][] = [
  ['KLCC to KLIA', [101.7119, 3.1578], [101.7099, 2.7456]],
  ['Mid Valley to Sunway', [101.6772, 3.1181], [101.607, 3.0731]],
  ['Bangsar South to Wangsa Maju', [101.6656, 3.111], [101.7316, 3.205]],
  ['Putrajaya to Cyberjaya', [101.6939, 2.9264], [101.655, 2.9213]],
  ['UTP to Ipoh', [100.9786, 4.385], [101.0829, 4.5975]],
  ['Ampang to Cheras', [101.7576, 3.1593], [101.736, 3.09]],
  ['Shah Alam to Klang', [101.5183, 3.0733], [101.4455, 3.0449]],
  ['Klang to KLCC', [101.4455, 3.0449], [101.7119, 3.1578]],
  // Long expressway runs, where the AWAS cameras are.
  ['KL to Seremban (E2)', [101.7119, 3.1578], [101.9381, 2.7259]],
  ['Seremban to Ayer Keroh (E2)', [101.9381, 2.7259], [102.2864, 2.2737]],
  ['KL to Tanjung Malim (E1)', [101.67, 3.172], [101.5236, 3.6846]],
  ['Tanjung Malim to Ipoh (E1)', [101.5236, 3.6846], [101.0829, 4.5975]],
  ['Kajang to Seremban (LEKAS)', [101.7906, 2.9935], [101.9381, 2.7259]],
  ['Shah Alam to Rawang (Guthrie)', [101.5183, 3.0733], [101.5766, 3.3213]],
  ['KL to Karak (E8)', [101.7119, 3.1578], [102.0328, 3.4116]],
];

/** Metres of `spans` between a and b. */
const covered = (spans: LimitSpan[], a: number, b: number) => spans.reduce((t, x) => t + Math.max(0, Math.min(b, x.s1) - Math.max(a, x.s0)), 0);
const km = (m: number) => (m / 1000).toFixed(1).padStart(6);

describe.skipIf(!dir)('speed limits and cameras on real roads', () => {
  it('routes around KL and Perak, with the limits and cameras the app would show', { timeout: 300_000 }, () => {
    const G = new OfflineGraph(ab('graph.bin'));
    const P = new PlaceIndex(ab('places.bin'));
    const router = new OfflineRouter(G);
    const out: string[] = [];
    const bad: string[] = [];
    let motorway = 0;
    let motorwayKnown = 0;
    let motorwayOsm = 0;
    let cams = 0;
    out.push('  trip                              length  with a limit   from OSM  national   none  limits (km/h)                 cameras');
    for (const [name, from, to] of TRIPS) {
      const json = router.route({ coords: [from, to] });
      if (json.code !== 'Ok') {
        out.push(`  ${name}: no route (${json.code})`);
        continue;
      }
      const r = normalizeOsrm(json, 'Offline')[0];
      const len = r.line.length;
      const d = speedData(G, P, densifyPath(r.geometry, 20));
      const osm = matchLimits(r, d.ways, [0, len]);
      const national = nationalLimits(r);
      const limits = mergeLimits(osm, national);
      const found = matchCameras(r, d, [0, len]);
      const kinds = routeKinds(r);
      // Expressway metres, and how many of them have a limit.
      for (let s = 0; s < len; s += 50) {
        if (!kinds(s + 25).motorway) continue;
        motorway += 50;
        const l = limitAt(limits, s + 25);
        if (l) motorwayKnown += 50;
        if (l?.src === 'osm') motorwayOsm += 50;
      }
      for (const l of limits) {
        // What Malaysia signs: 30 to 110 in tens (and the odd 35 by a school).
        if (l.kmh < 20 || l.kmh > 110) bad.push(`${name}: ${l.kmh} km/h at ${(l.s0 / 1000).toFixed(2)} km (${l.src})`);
      }
      const values = [...new Set(limits.map((l) => Math.round(l.kmh)))].sort((a, b) => a - b).join(' ');
      const camText = found.cameras.map((c) => `${(c.s / 1000).toFixed(1)} km${c.limit ? ` (${c.limit})` : ''}`).join(', ');
      cams += found.cameras.length;
      const withLimit = covered(limits, 0, len);
      const fromOsm = covered(osm, 0, len);
      out.push(`  ${name.padEnd(32)} ${km(len)} km  ${km(withLimit)} km  ${km(fromOsm)} km  ${km(withLimit - fromOsm)} km  ${km(len - withLimit)} km  ${values.padEnd(28)}  ${found.cameras.length}${camText ? `: ${camText}` : ''}`);
      // A camera's own limit agrees with the road's where both are mapped.
      for (const c of found.cameras) {
        const road = limitAt(osm, c.s)?.kmh;
        if (c.limit && road && Math.abs(c.limit - road) > 20) out.push(`    note: camera at ${(c.s / 1000).toFixed(1)} km says ${c.limit}, the road ${road}`);
      }
    }
    const all = P.byKind(['highway=speed_camera'], [[101.7, 3.1]], 2_000_000, 100_000);
    out.push('');
    out.push(`  expressway: ${(motorway / 1000).toFixed(0)} km, ${((100 * motorwayKnown) / Math.max(1, motorway)).toFixed(1)}% with a limit, ${((100 * motorwayOsm) / Math.max(1, motorway)).toFixed(1)}% from OpenStreetMap`);
    out.push(`  speed cameras in the pack: ${all.length}${all.length ? '' : ' (a pack built before cameras were added)'}, on these routes: ${cams}`);
    if (all.length) {
      const withLimit = all.filter((c) => /\d+ km\/h/.test(c.name)).length;
      out.push(`  of them with a limit mapped: ${withLimit}`);
    }
    if (bad.length) out.push('', '  LIMITS OUT OF RANGE:', ...bad.map((b) => `    ${b}`));
    console.log(out.join('\n'));
    expect(bad).toEqual([]);
    // Every expressway stretch has a limit (the national one fills in where the map has none).
    expect(motorwayKnown / Math.max(1, motorway)).toBeGreaterThan(0.9);
    // A pack with cameras has more than a handful, and every name reads as a camera.
    if (all.length) {
      expect(all.length).toBeGreaterThan(10);
      expect(all.every((c) => /^Speed camera( \d+ km\/h)?$/.test(c.name))).toBe(true);
    }
  });
});
