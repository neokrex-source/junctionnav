/**
 * Dumps the KL test drives' routes and the road data, terrain and candidates of every junction
 * on them from the real pack, for looking at the junction views of real interchanges in a browser
 * without the 280 MB pack. Runs only with PACK_DIR and DUMP_DIR (see .github/workflows/kl-fixtures.yml).
 */
import { describe, expect, it } from 'vitest';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { detectJunctions } from '../src/junction/detect';
import { OfflineGraph } from '../src/offline/graph';
import { PlaceIndex } from '../src/offline/places';
import { junctionData, roadWays } from '../src/offline/queries';
import { OfflineRouter } from '../src/offline/router';
import { normalizeOsrm } from '../src/routing/osrm';
import { driveQuery, KL_DRIVES } from '../src/sim/drives';
import { parseTripLink, resolveTrip } from '../src/trip/tripLink';
import { terrainAt } from './realTerrain';

const dir = process.env.PACK_DIR;
const out = process.env.DUMP_DIR;
/** Wider than the app's 450 m, so changes to how far the view reaches can be tried on it. */
const RADIUS = 900;

describe.skipIf(!dir || !out)('KL junction fixtures', () => {
  it('dumps every junction on the KL drives', async () => {
    const ab = (f: string) => {
      const b = readFileSync(join(dir!, f));
      return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
    };
    const G = new OfflineGraph(ab('graph.bin'));
    const P = new PlaceIndex(ab('places.bin'));
    const router = new OfflineRouter(G);
    mkdirSync(out!, { recursive: true });
    const index: { drive: string; title: string; junctions: { file: string; kind: string; s: number }[] }[] = [];
    for (const drive of KL_DRIVES) {
      const spec = parseTripLink(driveQuery(drive))!;
      const pts = await resolveTrip(spec, {
        geocode: async (q, near) => {
          const hit = P.search(q, near, 5)[0];
          return hit ? { lngLat: hit.lngLat, label: hit.name } : null;
        },
        roads: async (names, center, radius) => roadWays(G, names, center, radius),
        here: async () => null,
        near: [101.6869, 3.139],
      });
      const req = { coords: pts.map((p) => p.lngLat), bearings: pts.map((p, i) => (i === pts.length - 1 ? null : p.bearing)) };
      const res = router.route(req);
      expect(res.code).toBe('Ok');
      writeFileSync(join(out!, `route-${drive.id}.json`), JSON.stringify(res));
      const route = normalizeOsrm(structuredClone(res), 'Offline')[0];
      const entry = { drive: drive.id, title: drive.title, junctions: [] as { file: string; kind: string; s: number }[] };
      for (const [k, j] of detectJunctions(route).entries()) {
        const terrain = await terrainAt(j.location);
        const file = `jv-${drive.id}-${k}.json`;
        writeFileSync(
          join(out!, file),
          JSON.stringify({
            cand: j,
            osm: junctionData(G, [j.location], RADIUS),
            terrain: terrain && { center: terrain.center, half: terrain.half, cell: terrain.cell, n: terrain.n, data: Array.from(terrain.data, (v) => Math.round(v * 10) / 10) },
          }),
        );
        entry.junctions.push({ file, kind: j.kind, s: Math.round(j.s) });
      }
      index.push(entry);
    }
    writeFileSync(join(out!, 'index.json'), JSON.stringify(index, null, 1));
    console.log(JSON.stringify(index));
  }, 300_000);
});
