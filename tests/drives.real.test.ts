/**
 * The KL test drives on the real Peninsular Malaysia pack. Runs only where the pack is
 * available (PACK_DIR with graph.bin and places.bin, as on GitHub Actions); prints a report of
 * every junction view along each drive: what the road does, how high, how steep.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { LngLat } from '../src/geo/geo';
import { detectJunctions } from '../src/junction/detect';
import { buildScene } from '../src/junction/scene';
import { GridPatch, TERRAIN_URL, type TerrainPatch } from '../src/junction/terrain';
import { OfflineGraph } from '../src/offline/graph';
import { PlaceIndex } from '../src/offline/places';
import { junctionData, roadWays } from '../src/offline/queries';
import { OfflineRouter } from '../src/offline/router';
import { normalizeOsrm } from '../src/routing/osrm';
import { driveQuery, KL_DRIVES } from '../src/sim/drives';
import { parseTripLink, resolveTrip } from '../src/trip/tripLink';
import { decodePng } from './png';

const dir = process.env.PACK_DIR;
const ab = (f: string) => {
  const b = readFileSync(join(dir!, f));
  return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
};

/** Terrain from the public tiles, decoded in Node (the app does this in the browser). */
const tiles = new Map<string, Promise<Float32Array | null>>();
let corsHeader: string | null | undefined;
async function tile(z: number, x: number, y: number): Promise<Float32Array | null> {
  const key = `${z}/${x}/${y}`;
  let t = tiles.get(key);
  if (!t) {
    t = (async () => {
      const res = await fetch(TERRAIN_URL.replace('{z}', String(z)).replace('{x}', String(x)).replace('{y}', String(y)), {
        headers: { Origin: 'https://neokrex-source.github.io' },
      });
      if (corsHeader === undefined) corsHeader = res.headers.get('access-control-allow-origin');
      if (!res.ok) return null;
      const { width, rgba } = decodePng(new Uint8Array(await res.arrayBuffer()));
      const out = new Float32Array(width * width);
      for (let i = 0; i < out.length; i++) out[i] = rgba[i * 4] * 256 + rgba[i * 4 + 1] + rgba[i * 4 + 2] / 256 - 32768;
      return out;
    })().catch(() => null);
    tiles.set(key, t);
  }
  return t;
}
async function terrainAt(center: LngLat): Promise<TerrainPatch | null> {
  const z = 14;
  const n = 2 ** z;
  const txy = (p: LngLat) => {
    const lat = (p[1] * Math.PI) / 180;
    return [((p[0] + 180) / 360) * n, ((1 - Math.log(Math.tan(lat) + 1 / Math.cos(lat)) / Math.PI) / 2) * n];
  };
  const [cx, cy] = txy(center).map(Math.floor);
  const loaded = new Map<string, Float32Array>();
  for (let dx = -1; dx <= 1; dx++)
    for (let dy = -1; dy <= 1; dy++) {
      const d = await tile(z, cx + dx, cy + dy);
      if (d) loaded.set(`${cx + dx}/${cy + dy}`, d);
    }
  if (!loaded.size) return null;
  return GridPatch.sample(center, 950, 15, (p) => {
    const [fx, fy] = txy(p);
    const d = loaded.get(`${Math.floor(fx)}/${Math.floor(fy)}`);
    if (!d) return null;
    const px = Math.min(255, Math.max(0, Math.floor((fx % 1) * 256)));
    const py = Math.min(255, Math.max(0, Math.floor((fy % 1) * 256)));
    return Math.max(0, d[py * 256 + px]);
  });
}

describe.skipIf(!dir)('KL test drives on the real pack', () => {
  const G = dir ? new OfflineGraph(ab('graph.bin')) : (null as unknown as OfflineGraph);
  const P = dir ? new PlaceIndex(ab('places.bin')) : (null as unknown as PlaceIndex);
  const router = dir ? new OfflineRouter(G) : (null as unknown as OfflineRouter);

  for (const drive of KL_DRIVES) {
    it(drive.id, async () => {
      const lines: string[] = [`DRIVE ${drive.id}: ${drive.title}`];
      const spec = parseTripLink(driveQuery(drive))!;
      const pts = await resolveTrip(spec, {
        geocode: async (q, near) => {
          const hit = P.search(q, near, 5)[0];
          if (hit) lines.push(`  place "${q}" -> ${hit.name} (${hit.kind}) ${hit.lngLat[1].toFixed(5)},${hit.lngLat[0].toFixed(5)}`);
          return hit ? { lngLat: hit.lngLat, label: hit.name } : null;
        },
        roads: async (names, center, radius) => roadWays(G, names, center, radius),
        here: async () => null,
        near: [101.6869, 3.139],
      });
      for (const p of pts) lines.push(`  point ${p.label}: ${p.lngLat[1].toFixed(5)},${p.lngLat[0].toFixed(5)} heading ${p.bearing ?? '-'}`);
      const res = router.route({ coords: pts.map((p) => p.lngLat), bearings: pts.map((p, i) => (i === pts.length - 1 ? null : p.bearing)) });
      expect(res.code, res.message).toBe('Ok');
      const route = normalizeOsrm(res, 'Offline')[0];
      const roads = [...new Set(route.steps.map((s) => s.ref || s.name).filter(Boolean))];
      lines.push(`  route ${(route.distance / 1000).toFixed(1)} km, ${Math.round(route.duration / 60)} min, ${route.steps.length} steps; roads: ${roads.slice(0, 18).join(' > ')}`);
      const js = detectJunctions(route);
      lines.push(`  junction views: ${js.length}`);
      const kinds = new Set<string>();
      for (const j of js) {
        const terrain = await terrainAt(j.location);
        const sc = buildScene(route, j, junctionData(G, [j.location], 450), { terrain });
        const p = sc.profile;
        kinds.add(p.kind);
        const step = route.steps[j.stepIndex];
        const g0 = terrain?.at(j.location);
        lines.push(
          `  ${(j.s / 1000).toFixed(2).padStart(6)} km ${j.kind.padEnd(5)} ${sc.source.padEnd(9)} ${p.kind.padEnd(9)} peak ${p.peak.h >= 0 ? '+' : ''}${p.peak.h.toFixed(1)} m @${p.peak.s} grade ${p.grade}% ground ${g0 != null ? g0.toFixed(0) + ' m' : '-'}` +
            `  ${step.type}/${step.modifier ?? ''} ${step.ref ?? ''} ${step.name ?? ''} ${step.destinations ? '-> ' + step.destinations : ''} ${j.location[1].toFixed(5)},${j.location[0].toFixed(5)}`,
        );
      }
      lines.push(`  kinds seen: ${[...kinds].join(', ')}; terrain CORS: ${corsHeader ?? 'none'}`);
      console.log(lines.join('\n'));
      expect(js.length).toBeGreaterThan(2);
    }, 120_000);
  }
});
