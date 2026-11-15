import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { catalogFromManifest, packAt, packFor, packName } from '../src/offline/store';
import { archivesFor, tileBox, tileFrom, type TileArchive } from '../src/offline/offlineMap';
import { OfflineRouter } from '../src/offline/providers';
import type { OfflineClient } from '../src/offline/client';
import type { PackManifest } from '../src/offline/graphLayout';
// @ts-expect-error plain JavaScript shared with the build scripts
import { entryFor, mergeCatalog, siteCatalog } from '../scripts/offline/catalog-lib.mjs';

const man = (id: string, bbox: [number, number, number, number], version = 'v1'): PackManifest => ({
  id,
  name: id,
  version,
  built: '2026-11-02T00:00:00Z',
  bbox,
  drivingSide: 'left',
  attribution: '',
  files: [{ name: 'graph.bin', size: 10, gzip: true, parts: [{ path: 'graph.bin.gz.000', size: 6 }] }],
});
const pm = { manifest: man('peninsular-my', [99.45, 1.15, 104.65, 6.85]) };
const bor = { manifest: man('my-borneo', [109.5, 0.8, 119.4, 7.45]) };
const th = { manifest: man('th', [97.3, 5.6, 105.7, 20.5]) };

describe('choosing the pack', () => {
  it('the pack at a point, the smaller where boxes overlap (the Thai border)', () => {
    expect(packAt([pm, bor, th], [101.69, 3.14])?.manifest.id).toBe('peninsular-my');
    expect(packAt([pm, bor, th], [116.07, 5.98])?.manifest.id).toBe('my-borneo');
    expect(packAt([pm, bor, th], [100.5, 13.75])?.manifest.id).toBe('th');
    // Alor Setar is in both boxes: Peninsular Malaysia's is smaller.
    expect(packAt([pm, th], [100.37, 6.12])?.manifest.id).toBe('peninsular-my');
    expect(packAt([pm], [139.7, 35.7])).toBeNull();
  });

  it('the pack with the whole trip in it, else the one where it starts', () => {
    expect(packFor([pm, th], [[100.47, 7.0], [100.5, 13.75]])?.manifest.id).toBe('th');
    expect(packFor([pm, th], [[101.69, 3.14], [100.5, 13.75]])?.manifest.id).toBe('peninsular-my');
    expect(packFor([pm, bor], [[101.69, 3.14], [116.07, 5.98]])?.manifest.id).toBe('peninsular-my');
  });

  it('names in the app’s language, English where there is none', () => {
    expect(packName({ name: { en: 'Japan: Kanto (Tokyo)', ja: '関東' } }, 'ja')).toBe('関東');
    expect(packName({ name: { en: 'Thailand' } }, 'ms')).toBe('Thailand');
    expect(packName({ name: 'Peninsular Malaysia' }, 'ja')).toBe('Peninsular Malaysia');
  });

  it('before any catalog: the one pack on the site, with full addresses', () => {
    const c = catalogFromManifest(pm.manifest, 'https://example.org/offline/manifest.json');
    expect(c.packs).toHaveLength(1);
    expect(c.packs[0].web).toBe(true);
    expect(c.packs[0].manifest.files[0].parts[0].path).toBe('https://example.org/offline/graph.bin.gz.000');
  });
});

describe('every pack as one map', () => {
  const arch = (id: string, bbox: [number, number, number, number], has: (z: number, x: number, y: number) => boolean, maxzoom = 15): TileArchive => ({
    id,
    minzoom: 0,
    maxzoom,
    bbox,
    get: async (z, x, y) => (has(z, x, y) ? new TextEncoder().encode(id).buffer : null),
  });

  it('tile boxes', () => {
    const [w, s, e, n] = tileBox(1, 1, 0);
    expect([w, e]).toEqual([0, 180]);
    expect(s).toBeCloseTo(0, 6);
    expect(n).toBeCloseTo(85.0511, 3);
  });

  it('a tile comes from the pack that covers it; empty where none does', async () => {
    const list = [arch('pm', [99.45, 1.15, 104.65, 6.85], () => true), arch('bor', [109.5, 0.8, 119.4, 7.45], () => true)];
    // z10 tiles over Kuala Lumpur and over Kota Kinabalu.
    const kl = [10, 801, 503] as const;
    const kk = [10, 842, 495] as const;
    expect(new TextDecoder().decode(await tileFrom(list, ...kl))).toBe('pm');
    expect(new TextDecoder().decode(await tileFrom(list, ...kk))).toBe('bor');
    expect((await tileFrom(list, 10, 900, 400)).byteLength).toBe(0);
  });

  it('at a border the smaller pack goes first, and the next one answers if it has nothing', async () => {
    const small = arch('pm', [99.45, 1.15, 104.65, 6.85], () => false);
    const big = arch('th', [97.3, 5.6, 105.7, 20.5], () => true);
    expect(archivesFor([big, small], 10, 797, 494).map((a) => a.id)).toEqual(['pm', 'th']);
    expect(new TextDecoder().decode(await tileFrom([big, small], 10, 797, 494))).toBe('th');
    // Beyond a pack's deepest zoom it is not asked.
    expect(archivesFor([arch('z14', [99, 1, 105, 7], () => true, 14)], 15, 25630, 16100)).toEqual([]);
  });
});

describe('routes offline stay in one pack', () => {
  const client = (covers: (pts: [number, number][]) => boolean) =>
    ({ covers, route: async () => ({ code: 'Ok', routes: [] }) }) as unknown as OfflineClient;

  it('says so when the trip goes beyond the packs on the device', async () => {
    const r = new OfflineRouter(client((pts) => pts.every((p) => p[0] < 105)));
    await expect(r.route({ origin: [101.69, 3.14], destination: [116.07, 5.98] } as never)).rejects.toThrow(/goes beyond the offline maps/);
    const none = new OfflineRouter(client(() => false));
    await expect(none.route({ origin: [139.7, 35.7], destination: [139.8, 35.6] } as never)).rejects.toThrow(/no offline maps on this device for this trip/);
  });
});

describe('the catalog the build writes', () => {
  const regions = JSON.parse(readFileSync('scripts/offline/regions.json', 'utf8')).regions;

  it('lists Asia by part, each region with a unique id, a Geofabrik extract and its names', () => {
    const ids = regions.map((r: { id: string }) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const r of regions) {
      expect(['sea', 'east', 'south', 'central', 'west']).toContain(r.group);
      expect(r.geofabrik).toBeTruthy();
      expect(r.name.en && r.name.ms && r.name.ja).toBeTruthy();
      expect(['left', 'right']).toContain(r.side);
    }
    expect(regions.filter((r: { site?: boolean }) => r.site).map((r: { id: string }) => r.id)).toEqual(['peninsular-my']);
    for (const id of ['th', 'id-java', 'ph', 'vn', 'jp-kanto', 'kr', 'tw', 'in-north', 'lk', 'kz', 'gcc']) expect(ids).toContain(id);
  });

  it('entries carry the release addresses; the next catalog keeps packs not rebuilt', () => {
    const r = regions.find((x: { id: string }) => x.id === 'th');
    const e = entryFor(r, man('th', [97.3, 5.6, 105.7, 20.5], '20261102T0100'), 'https://github.com/o/r/releases/download/maps-th/20261102T0100.');
    expect(e.manifest.files[0].parts[0].path).toBe('https://github.com/o/r/releases/download/maps-th/20261102T0100.graph.bin.gz.000');
    expect(e.web).toBe(false);
    const old = { packs: [{ ...e, id: 'vn', name: { en: 'old' } }, { ...e, id: 'gone' }] };
    const cat = mergeCatalog(regions, [e], old);
    expect(cat.packs.map((x: { id: string }) => x.id)).toEqual(['th', 'vn']);
    expect(cat.packs[1].name.en).toBe('Vietnam');
  });

  it('on the site, its own packs get addresses next to the catalog', () => {
    const r = regions.find((x: { id: string }) => x.id === 'peninsular-my');
    const e = entryFor(r, man('peninsular-my', [99.45, 1.15, 104.65, 6.85], '20261102T0100'), 'https://github.com/o/r/releases/download/maps-peninsular-my/20261102T0100.');
    const t = entryFor(regions.find((x: { id: string }) => x.id === 'th'), man('th', [97, 5, 105, 20]), 'https://x/');
    const site = siteCatalog({ v: 1, built: '', packs: [e, t] }, regions, new Set(['peninsular-my']));
    expect(site.packs[0].web).toBe(true);
    expect(site.packs[0].manifest.files[0].parts[0].path).toBe('peninsular-my/20261102T0100.graph.bin.gz.000');
    expect(site.packs[1].web).toBe(false);
  });
});
