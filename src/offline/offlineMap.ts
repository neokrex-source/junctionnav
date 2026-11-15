/**
 * Map rendering from the offline packs: Protomaps vector tiles, fonts and sprites from browser
 * storage. Every pack on the device draws as one map: each tile comes from the pack that covers
 * it (the smallest where several do, as at a border, where either has the whole tile).
 */
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { layers } from '@protomaps/basemaps';
import { techFlavor } from '../map/techStyle';
import { PMTiles, type RangeResponse, type Source } from 'pmtiles';
import type { InstalledPack, OfflineStore } from './store';

/** PMTiles reads byte ranges; the stored file (a Blob joined from its parts) slices them directly. */
class FileSource implements Source {
  constructor(
    private file: Blob,
    private key: string,
  ) {}
  getKey() {
    return this.key;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: await this.file.slice(offset, offset + length).arrayBuffer() };
  }
}

export interface TileArchive {
  id: string;
  minzoom: number;
  maxzoom: number;
  bbox: [number, number, number, number];
  get: (z: number, x: number, y: number, signal?: AbortSignal) => Promise<ArrayBuffer | null>;
}

/** A tile's box in longitude and latitude. */
export function tileBox(z: number, x: number, y: number): [number, number, number, number] {
  const n = 2 ** z;
  const lon = (i: number) => (i / n) * 360 - 180;
  const lat = (j: number) => (Math.atan(Math.sinh(Math.PI * (1 - (2 * j) / n))) * 180) / Math.PI;
  return [lon(x), lat(y + 1), lon(x + 1), lat(y)];
}

const overlaps = (a: number[], b: number[]) => a[0] <= b[2] && a[2] >= b[0] && a[1] <= b[3] && a[3] >= b[1];
const area = (b: number[]) => (b[2] - b[0]) * (b[3] - b[1]);

/** The packs that may hold a tile, the smallest first. */
export function archivesFor(list: TileArchive[], z: number, x: number, y: number): TileArchive[] {
  const box = tileBox(z, x, y);
  return list.filter((a) => z >= a.minzoom && z <= a.maxzoom && overlaps(a.bbox, box)).sort((a, b) => area(a.bbox) - area(b.bbox));
}

/** A tile from the first pack that has it (empty where none does). */
export async function tileFrom(list: TileArchive[], z: number, x: number, y: number, signal?: AbortSignal): Promise<ArrayBuffer> {
  for (const a of archivesFor(list, z, x, y)) {
    const data = await a.get(z, x, y, signal);
    if (data && data.byteLength) return data;
  }
  return new ArrayBuffer(0);
}

let archives: TileArchive[] = [];
let registered = false;
let assetsFrom: OfflineStore | null = null;

/** How deep the offline tiles go: the shallowest pack's deepest zoom (deeper is drawn enlarged). */
export function offlineMaxZoom(): number {
  return archives.length ? Math.min(...archives.map((a) => a.maxzoom)) : 15;
}

async function open(store: OfflineStore, pack: InstalledPack): Promise<TileArchive> {
  const pm = new PMTiles(new FileSource(await store.file(pack, 'tiles.pmtiles'), `pack:${pack.dir[1]}`));
  const h = await pm.getHeader();
  const box = pack.manifest.bbox;
  return {
    id: pack.id,
    minzoom: h.minZoom,
    maxzoom: h.maxZoom,
    // The pack's own box where the tiles claim the whole world (an extract keeps the planet's bounds).
    bbox: h.minLon > -180 || h.maxLon < 180 ? [h.minLon, h.minLat, h.maxLon, h.maxLat] : box,
    get: async (z, x, y, signal) => (await pm.getZxy(z, x, y, signal))?.data ?? null,
  };
}

/** Registers the offline-tiles:// and offline:// protocols for the packs on the device. */
export async function enableOfflineMap(store: OfflineStore): Promise<void> {
  assetsFrom = store;
  archives = await Promise.all(store.installed.map((p) => open(store, p)));
  if (registered) return;
  registered = true;
  maplibregl.addProtocol('offline-tiles', async (params, abort) => {
    const m = /^offline-tiles:\/\/(\d+)\/(\d+)\/(\d+)/.exec(params.url);
    if (!m) throw new Error(`Bad offline tile address: ${params.url}`);
    return { data: await tileFrom(archives, +m[1], +m[2], +m[3], abort.signal) };
  });
  maplibregl.addProtocol('offline', async (params) => {
    const path = decodeURIComponent(params.url.replace(/^offline:\/\//, ''));
    const data = (await assetsFrom?.asset(path)) ?? null;
    if (!data) {
      // Missing glyph ranges are fine (those characters just don't draw); missing sprites are not.
      if (path.startsWith('fonts/')) return { data: new ArrayBuffer(0) };
      throw new Error(`Offline map file missing: ${path}`);
    }
    if (params.type === 'json') return { data: JSON.parse(new TextDecoder().decode(data)) };
    return { data };
  });
}

/** Forgets the packs (all deleted). */
export function disableOfflineMap() {
  archives = [];
}

export function offlineStyle(night: boolean, lang: string): StyleSpecification {
  const flavor = night ? 'dark' : 'light';
  return {
    version: 8,
    glyphs: 'offline://fonts/{fontstack}/{range}.pbf',
    sprite: `offline://sprites/${flavor}`,
    sources: {
      protomaps: {
        type: 'vector',
        tiles: ['offline-tiles://{z}/{x}/{y}'],
        minzoom: 0,
        maxzoom: offlineMaxZoom(),
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>',
      },
    },
    layers: layers('protomaps', techFlavor(night), { lang: ['en', 'ms', 'ja'].includes(lang) ? lang : 'en' }),
  } as StyleSpecification;
}
