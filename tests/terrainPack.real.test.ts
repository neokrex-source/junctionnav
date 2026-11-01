/**
 * The ground heights in the real Peninsular Malaysia pack (terrain.bin), read the way the app
 * reads them, against the online terrain tiles at hilly junctions around KL. Runs only where the
 * pack is available (PACK_DIR with terrain.bin, as on GitHub Actions after a pack build).
 */
import { describe, expect, it } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { LocalFrame, type LngLat } from '../src/geo/geo';
import { tileXY } from '../src/junction/terrain';
import { OfflineTerrainProvider, TerrainPackReader } from '../src/offline/offlineTerrain';
import { findTile, readTerrainHeader, readTerrainIndex, TERRAIN_HEADER } from '../src/offline/terrainLayout';
import { terrainAt } from './realTerrain';

const dir = process.env.PACK_DIR;
const path = dir ? join(dir, 'terrain.bin') : '';
const have = !!dir && existsSync(path);

/** Junctions with hills around them (flat places would not show a mix-up of tiles). */
const HILLY: [string, LngLat][] = [
  ['SUKE at Sungai Besi', [101.7056, 3.0393]],
  ['DASH near Penchala', [101.6205, 3.1608]],
  ['MRR2 at Ampang', [101.762, 3.162]],
  ['Karak Highway at Gombak', [101.742, 3.247]],
  ['Genting Sempah', [101.79, 3.36]],
];
/** Places across the pack that must have heights. */
const COVER: [string, LngLat][] = [
  ['Johor Bahru', [103.7414, 1.4927]],
  ['Singapore', [103.8198, 1.3521]],
  ['Kota Bharu', [102.2381, 6.1254]],
  ['George Town', [100.3288, 5.4141]],
  ['Langkawi', [99.8, 6.35]],
  ['Kuantan', [103.326, 3.8077]],
];

describe.skipIf(!have)('ground heights in the real pack', () => {
  const bytes = have ? new Uint8Array(readFileSync(path)) : new Uint8Array();
  const reader = new TerrainPackReader({ key: () => 'real', blob: async () => new Blob([bytes as Uint8Array<ArrayBuffer>]) });

  it('covers the peninsula and Singapore', () => {
    const head = readTerrainHeader(bytes.subarray(0, TERRAIN_HEADER));
    const idx = readTerrainIndex(head, bytes.subarray(TERRAIN_HEADER));
    console.log(`::notice title=Offline ground heights::zoom ${head.zoom}, ${head.count} tiles, ${(bytes.length / 1048576).toFixed(1)} MB`);
    expect(head.zoom).toBeGreaterThanOrEqual(10);
    for (const [name, p] of COVER) {
      const [x, y] = tileXY(p, head.zoom).map(Math.floor);
      expect(findTile(idx, x, y), name).toBeGreaterThanOrEqual(0);
    }
  });

  it('matches the online heights at hilly junctions around KL', async () => {
    const lines: string[] = [];
    for (const [name, c] of HILLY) {
      const off = await new OfflineTerrainProvider(reader).fetch(c, 950);
      const on = await terrainAt(c);
      expect(off, name).not.toBeNull();
      if (!on) {
        lines.push(`${name}: online tiles unavailable, offline only`);
        continue;
      }
      const f = new LocalFrame(c);
      const diffs: number[] = [];
      let lo = Infinity;
      let hi = -Infinity;
      for (let y = -800; y <= 800; y += 50)
        for (let x = -800; x <= 800; x += 50) {
          const p = f.toLngLat(x, y);
          const a = off!.at(p);
          const b = on.at(p);
          if (a == null || b == null) continue;
          diffs.push(Math.abs(a - b));
          lo = Math.min(lo, b);
          hi = Math.max(hi, b);
        }
      diffs.sort((a, b) => a - b);
      const median = diffs[Math.floor(diffs.length / 2)];
      const p90 = diffs[Math.floor(diffs.length * 0.9)];
      lines.push(`${name}: ground ${lo.toFixed(0)} to ${hi.toFixed(0)} m; offline vs online median ${median.toFixed(1)} m, 90% within ${p90.toFixed(1)} m`);
      // Loose on purpose: the pack is coarser than the online tiles. A tile mix-up or a flipped
      // axis puts hills tens to hundreds of metres off.
      expect(median, name).toBeLessThan(8);
      expect(p90, name).toBeLessThan(30);
    }
    console.log(lines.join('\n'));
    console.log(`::notice title=Offline vs online heights::${lines.join(' | ')}`);
  }, 120_000);
});
