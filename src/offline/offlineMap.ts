/** Map rendering from the offline pack: Protomaps vector tiles, fonts and sprites from browser storage. */
import maplibregl, { type StyleSpecification } from 'maplibre-gl';
import { layers } from '@protomaps/basemaps';
import { techFlavor } from '../map/techStyle';
import { PMTiles, Protocol, type RangeResponse, type Source } from 'pmtiles';
import type { OfflineStore } from './store';

const KEY = 'offline-pack';

/** PMTiles reads byte ranges; the stored file (a Blob joined from its parts) slices them directly. */
class FileSource implements Source {
  constructor(private file: Blob) {}
  getKey() {
    return KEY;
  }
  async getBytes(offset: number, length: number): Promise<RangeResponse> {
    return { data: await this.file.slice(offset, offset + length).arrayBuffer() };
  }
}

let protocol: Protocol | null = null;
let assetsFrom: OfflineStore | null = null;

/** Registers the pmtiles:// and offline:// protocols for the installed pack. */
export async function enableOfflineMap(store: OfflineStore): Promise<void> {
  const file = await store.file('tiles.pmtiles');
  assetsFrom = store;
  if (!protocol) {
    protocol = new Protocol();
    maplibregl.addProtocol('pmtiles', protocol.tile);
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
  protocol.add(new PMTiles(new FileSource(file)));
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
        url: `pmtiles://${KEY}`,
        attribution: '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors, <a href="https://protomaps.com" target="_blank" rel="noopener">Protomaps</a>',
      },
    },
    layers: layers('protomaps', techFlavor(night), { lang: ['en', 'ms', 'ja'].includes(lang) ? lang : 'en' }),
  } as StyleSpecification;
}
