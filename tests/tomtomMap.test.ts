import { describe, expect, it, vi } from 'vitest';
import { checkTile, isTomTomMapTile, TomTomMap, tomtomTileUrl } from '../src/map/tomtomMap';
import { resolveStyle } from '../src/map/styles';
import { tomtomMapStyle, TT_SOURCE } from '../src/map/tomtomStyle';
import { DEFAULTS } from '../src/state/settings';

// A minimal vector tile in TomTom's layout, written by hand (protobuf): one 'roads' layer with
// one line in category `street`, or a layer by another name.
function varint(n: number): number[] {
  const out: number[] = [];
  while (n > 127) {
    out.push((n & 127) | 128);
    n >>>= 7;
  }
  out.push(n);
  return out;
}
const field = (no: number, wire: number) => varint((no << 3) | wire);
const bytes = (no: number, b: number[]) => [...field(no, 2), ...varint(b.length), ...b];
const str = (no: number, s: string) => bytes(no, [...new TextEncoder().encode(s)]);
function tile(layerName: string, category: string): Uint8Array {
  const zz = (n: number) => (n << 1) ^ (n >> 31);
  const geom = [...varint((1 & 7) | (1 << 3)), ...varint(zz(100)), ...varint(zz(100)), ...varint((2 & 7) | (1 << 3)), ...varint(zz(200)), ...varint(zz(0))];
  const feature = [...field(2, 2), ...varint(2), 0, 0, ...field(3, 0), 2, ...bytes(4, geom)];
  const value = str(1, category);
  const layer = [...field(15, 0), 2, ...str(1, layerName), ...bytes(2, feature), ...str(3, 'category'), ...bytes(4, value), ...field(5, 0), ...varint(4096)];
  return new Uint8Array(bytes(3, layer));
}

const memory = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
};
const answer = (status: number, body: Uint8Array = new Uint8Array(0)) => ({ ok: status >= 200 && status < 300, status, arrayBuffer: async () => body.buffer }) as unknown as Response;

describe('TomTom map tiles', () => {
  it('tells TomTom’s map tiles from its traffic tiles', () => {
    expect(isTomTomMapTile(tomtomTileUrl('classic', 'K').replace('{z}/{x}/{y}', '12/3/4'))).toBe(true);
    expect(isTomTomMapTile(tomtomTileUrl('orbis', 'K').replace('{z}/{x}/{y}', '12/3/4'))).toBe(true);
    expect(isTomTomMapTile('https://api.tomtom.com/traffic/map/4/tile/flow/relative/12/3/4.png?key=K')).toBe(false);
  });

  it('accepts tiles in TomTom’s layout only', () => {
    expect(checkTile(tile('roads', 'street')).ok).toBe(true);
    expect(checkTile(tile('roads', 'highway')).ok).toBe(false);
    expect(checkTile(tile('transportation', 'minor')).ok).toBe(false);
    expect(checkTile(new Uint8Array([1, 2, 3])).ok).toBe(false);
  });
});

describe('whether the map comes from TomTom', () => {
  const setup = (answers: Record<'classic' | 'orbis', number | Uint8Array>, wanted = true) => {
    const asked: string[] = [];
    const fetch = vi.fn(async (u: string) => {
      const fam = u.includes('/orbis/') ? 'orbis' : 'classic';
      asked.push(fam);
      const a = answers[fam];
      return typeof a === 'number' ? answer(a) : answer(200, a);
    });
    const storage = memory();
    const m = new TomTomMap(() => 'KEY', () => wanted, { fetch: fetch as unknown as typeof globalThis.fetch, storage });
    return { m, asked, storage };
  };

  it('the classic map when it answers in the right layout, kept for next time', async () => {
    const { m, asked, storage } = setup({ classic: tile('roads', 'motorway'), orbis: 404 });
    const changed = vi.fn();
    m.onChange = changed;
    await m.check();
    expect(asked).toEqual(['classic']);
    expect(m.tiles).toContain('/map/2/tile/basic/{z}/{x}/{y}.pbf?key=KEY');
    expect(changed).toHaveBeenCalledTimes(1);
    const again = new TomTomMap(() => 'KEY', () => true, { storage });
    again.restore();
    expect(again.tiles).toBe(m.tiles);
    // Another key: not this one's answer.
    const other = new TomTomMap(() => 'OTHER', () => true, { storage });
    other.restore();
    expect(other.tiles).toBeNull();
  });

  it('Orbis when the key is not set up for the classic map', async () => {
    const { m, asked } = setup({ classic: 403, orbis: tile('roads', 'street') });
    await m.check();
    expect(asked).toEqual(['classic', 'orbis']);
    expect(m.tiles).toContain('/maps/orbis/display/vector/tile/{z}/{x}/{y}.pbf?apiVersion=2&key=KEY');
  });

  it('OpenStreetMap when TomTom refuses, is busy or answers in another layout', async () => {
    const refused = setup({ classic: 403, orbis: 403 });
    await refused.m.check();
    expect(refused.m.tiles).toBeNull();
    expect(refused.m.reason).toMatch(/refused/);
    const busy = setup({ classic: 429, orbis: 429 });
    await busy.m.check();
    expect(busy.m.tiles).toBeNull();
    const other = setup({ classic: tile('transportation', 'minor'), orbis: 404 });
    await other.m.check();
    expect(other.m.tiles).toBeNull();
    expect(other.m.reason).toMatch(/layout/);
    const off = setup({ classic: tile('roads', 'street'), orbis: 404 }, false);
    await off.m.check();
    expect(off.asked).toEqual([]);
    expect(off.m.tiles).toBeNull();
  });

  it('a refused tile while drawing rests TomTom’s map', async () => {
    const { m } = setup({ classic: tile('roads', 'street'), orbis: 404 });
    await m.check();
    expect(m.tiles).not.toBeNull();
    const changed = vi.fn();
    m.onChange = changed;
    m.failed(403);
    expect(m.tiles).toBeNull();
    expect(changed).toHaveBeenCalledTimes(1);
    // A tile with no data is not a failure.
    const fine = setup({ classic: tile('roads', 'street'), orbis: 404 });
    await fine.m.check();
    fine.m.failed(404);
    expect(fine.m.tiles).not.toBeNull();
  });
});

describe('the JunctionNav look on TomTom’s map', () => {
  it('is used for the JunctionNav style when TomTom’s tiles can be had', () => {
    const tiles = tomtomTileUrl('classic', 'KEY');
    const s = resolveStyle({ ...DEFAULTS, mapStyle: 'tech' }, false, tiles);
    expect(typeof s === 'object' && s.sources[TT_SOURCE]).toBeTruthy();
    const osm = resolveStyle({ ...DEFAULTS, mapStyle: 'tech' }, false, null);
    expect(typeof osm === 'object' && osm.sources.openmaptiles).toBeTruthy();
    // Other styles stay as chosen.
    expect(resolveStyle({ ...DEFAULTS, mapStyle: 'ofm-liberty' }, false, tiles)).toBe('https://tiles.openfreemap.org/styles/liberty');
  });

  it('has the layers the rest of the app looks for, in day and night colours', () => {
    const day = tomtomMapStyle(false, 'en', 'https://example.test/{z}/{x}/{y}.pbf');
    const night = tomtomMapStyle(true, 'ms', 'https://example.test/{z}/{x}/{y}.pbf');
    const ids = day.layers.map((l) => l.id);
    for (const id of ['land', 'water', 'building', 'road-none-highway', 'road-bridge-major', 'road-tunnel', 'road-name-major', 'road-ref', 'poi', 'place-major']) expect(ids).toContain(id);
    expect(day.layers.filter((l) => 'source-layer' in l && l['source-layer'] === 'roads').length).toBeGreaterThan(10);
    expect(JSON.stringify(day.layers[0])).not.toBe(JSON.stringify(night.layers[0]));
    expect(JSON.stringify(night)).toContain('name_ms-MY');
    // Fetched up to zoom 16 and drawn larger beyond, with TomTom's credit.
    const src = day.sources[TT_SOURCE] as { maxzoom: number; attribution: string };
    expect(src.maxzoom).toBe(16);
    expect(src.attribution).toMatch(/TomTom/);
  });
});
