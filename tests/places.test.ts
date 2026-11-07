import { describe, expect, it } from 'vitest';
import { cellId, type CellFile, type PlaceDetails, type PlaceGroup } from '../src/places/format';
import { PlacesIndex, inCategory, matchScore } from '../src/places/placesIndex';
import { connectionOk, RETRY_AFTER, updateDue, type PlacesState } from '../src/places/schedule';
import { hitToPlace, mergeResults } from '../src/places/search';
import type { Place } from '../src/search/places';

const KL: [number, number] = [101.6869, 3.139];
const at = (dx: number, dy: number): [number, number] => [KL[0] + dx / 111_150, KL[1] + dy / 110_574];

/** A cell file the way the builder writes it. */
function cell(places: [name: string, key: string, group: PlaceGroup, where: [number, number], rank: number, d?: PlaceDetails][]): CellFile {
  const cats: [string, PlaceGroup][] = [];
  const idx = new Map<string, number>();
  const rows = places
    .slice()
    .sort((a, b) => b[4] - a[4])
    .map(([name, key, group, [lon, lat], rank, d]) => {
      const k = `${key}|${group}`;
      if (!idx.has(k)) {
        idx.set(k, cats.length);
        cats.push([key, group]);
      }
      const row: CellFile['p'][number] = [name, idx.get(k)!, Math.round(lon * 1e5), Math.round(lat * 1e5), rank];
      if (d) row.push(d);
      return row;
    });
  return { v: 1, id: cellId(...places[0][3]), built: '2026-11-08T00:00:00Z', cats, p: rows };
}

const sample = () =>
  cell([
    ["McDonald's Bangsar", 'fast_food_restaurant', 'food', at(400, 300), 52, { b: "McDonald's", t: '+60 3-2287 0000', s: 'o' }],
    ['Nasi Lemak Wanjo', 'malaysian_restaurant', 'food', at(-200, 100), 44, { a: 'Jalan Raja Muda Musa, Kampung Baru', h: 'Mo-Su 06:00-14:00', s: 'om' }],
    ['Suria KLCC', 'mall', 'mall', at(1500, 800), 85, { w: 'https://suriaklcc.com.my', s: 'om' }],
    ['Petronas Jalan Ampang', 'gas_station', 'fuel', at(900, -100), 60, { b: 'Petronas', s: 'om' }],
    ['7-Eleven Ampang', 'convenience_store', 'grocery', at(950, -60), 40, { s: 'o' }],
    ['Kedai Runcit Ah Seng', 'grocery_store', 'grocery', at(-900, -900), 30, { s: 'o' }],
    ['Syarikat Perunding ABC', 'consultant', 'office', at(10, 10), 10, { s: 'o' }],
    ['老王茶室', 'cafe', 'cafe', at(-50, 600), 35, { e: 'Lao Wang Kopitiam', s: 'm' }],
    ['Kuala Lumpur', 'city', 'locality', at(0, 0), 0],
    ['Kampung Baru', 'suburb', 'locality', at(-600, 300), 0],
  ]);

describe('places index', () => {
  it('gives the map what matters at each zoom, most prominent first', () => {
    const ix = new PlacesIndex();
    ix.add(sample());
    expect(ix.count).toBe(10);
    const view: [number, number, number, number] = [KL[0] - 0.05, KL[1] - 0.05, KL[0] + 0.05, KL[1] + 0.05];
    const names = (z: number, driving = false) => ix.box(view, z, 100, driving).map((p) => p[3]);
    // Further out only the mall, then the petrol station (prominent: a zoom early); restaurants and
    // shops from street level.
    expect(names(12.5)).toEqual(['Suria KLCC']);
    expect(names(13)).toEqual(['Suria KLCC', 'Petronas Jalan Ampang']);
    expect(names(14)).toEqual(['Suria KLCC', 'Petronas Jalan Ampang']);
    expect(names(16)).toEqual(expect.arrayContaining(["McDonald's Bangsar", 'Nasi Lemak Wanjo', '7-Eleven Ampang', '老王茶室']));
    expect(names(16)).not.toContain('Syarikat Perunding ABC');
    expect(names(17.5)).toContain('Syarikat Perunding ABC');
    // Town names never: the base map has them.
    expect(names(18)).not.toContain('Kuala Lumpur');
    // While driving, no offices or small shops.
    expect(names(18, true)).not.toContain('Syarikat Perunding ABC');
    expect(names(18, true)).toContain('Petronas Jalan Ampang');
    const ranks = ix.box(view, 18, 100).map((p) => p[5]);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    expect(ix.box(view, 18, 3)).toHaveLength(3);
    // Nothing outside the view.
    expect(ix.box([KL[0] + 1, KL[1] + 1, KL[0] + 1.1, KL[1] + 1.1], 18, 100)).toEqual([]);
  });

  it('finds places by name, the way people type them, nearest first among equals', () => {
    const ix = new PlacesIndex();
    ix.add(sample());
    expect(ix.search('mcdonalds', KL)[0].name).toBe("McDonald's Bangsar");
    expect(ix.search('nasi lemak', KL)[0].name).toBe('Nasi Lemak Wanjo');
    expect(ix.search('wanjo', KL)[0].name).toBe('Nasi Lemak Wanjo');
    // By the English name of a place named in Chinese.
    expect(ix.search('lao wang', KL)[0].name).toBe('老王茶室');
    expect(ix.search('ampang', KL).map((h) => h.name)).toEqual(['Petronas Jalan Ampang', '7-Eleven Ampang']);
    expect(ix.search('kuala lumpur', KL)).toEqual([]);
    expect(ix.search('x', KL)).toEqual([]);
    const hit = ix.search('suria', KL)[0];
    expect(hit.d?.w).toBe('https://suriaklcc.com.my');
    expect(hit.dist).toBeGreaterThan(1500);
    expect(ix.get(hit.id)?.name).toBe('Suria KLCC');
  });

  it('finds places of a category near a point or along a line', () => {
    const ix = new PlacesIndex();
    ix.add(sample());
    expect(ix.near([KL], 2000, 'fuel').map((h) => h.name)).toEqual(['Petronas Jalan Ampang']);
    expect(ix.near([KL], 2000, 'food').map((h) => h.name)).toEqual(['Nasi Lemak Wanjo', "McDonald's Bangsar", '老王茶室']);
    expect(ix.near([KL], 2000, 'store').map((h) => h.name)).toEqual(['7-Eleven Ampang']);
    expect(ix.near([KL], 300, 'fuel')).toEqual([]);
    // Along a line of points (a route sampled every 100 m): within 150 m of any of them.
    const line = Array.from({ length: 41 }, (_, i) => at(-2000 + i * 100, -100));
    expect(ix.near(line, 150, 'fuel').map((h) => h.name)).toEqual(['Petronas Jalan Ampang']);
    expect(inCategory('food', 'cafe', 'cafe')).toBe(true);
    expect(inCategory('store', 'grocery', 'supermarket')).toBe(false);
  });

  it('names a pressed point and the area around a town, and swaps or drops cells', () => {
    const ix = new PlacesIndex();
    ix.add(sample());
    expect(ix.nearest(at(905, -95), 25)?.name).toBe('Petronas Jalan Ampang');
    expect(ix.nearest(at(5000, 5000), 25)).toBeNull();
    expect(ix.areaName(at(300, 300))).toBe('Kuala Lumpur');
    // A newer copy of the cell replaces the old one.
    ix.add(cell([['Restoran Baru', 'restaurant', 'food', at(0, 50), 40]]));
    expect(ix.count).toBe(1);
    expect(ix.search('baru', KL)[0].name).toBe('Restoran Baru');
    ix.remove(cellId(...KL));
    expect(ix.count).toBe(0);
    expect(ix.get(`${cellId(...KL)}:0`)).toBeNull();
  });

  it('scores name matches', () => {
    expect(matchScore('suria klcc', 'suria klcc', ['suria', 'klcc'])).toBe(100);
    expect(matchScore('suria klcc', 'sur', ['sur'])).toBe(90);
    expect(matchScore('nasi lemak wanjo', 'wanjo', ['wanjo'])).toBe(78);
    expect(matchScore('restoran nasi kandar pelita', 'pelita nasi', ['pelita', 'nasi'])).toBe(68);
    expect(matchScore('maybank', 'ybank', ['ybank'])).toBe(50);
    expect(matchScore('maybank', 'zz', ['zz'])).toBe(0);
  });
});

describe('places update schedule', () => {
  const st = (o: Partial<PlacesState> = {}): PlacesState => ({ center: KL, radiusKm: 100, updatedAt: Date.UTC(2026, 10, 1), built: '', sources: {}, count: 1000, cells: 50, bytes: 1, area: 'Kuala Lumpur', ...o });
  const now = Date.UTC(2026, 10, 8);
  const base = { now, every: 'monthly' as const, radiusKm: 100, pos: KL, lastTry: 0 };

  it('updates first, then on the schedule chosen', () => {
    expect(updateDue(null, base)).toBe('first');
    expect(updateDue(st(), base)).toBeNull();
    expect(updateDue(st(), { ...base, every: 'weekly' })).toBe('schedule');
    expect(updateDue(st({ updatedAt: now - 31 * 86_400_000 }), base)).toBe('schedule');
    expect(updateDue(st({ updatedAt: now - 60 * 86_400_000 }), { ...base, every: 'quarterly' })).toBeNull();
    expect(updateDue(null, { ...base, every: 'manual' })).toBeNull();
  });

  it('updates for a new area or distance, and waits after a failure or without a position', () => {
    // Penang is 300 km from Kuala Lumpur.
    expect(updateDue(st(), { ...base, pos: [100.33, 5.41] })).toBe('moved');
    expect(updateDue(st(), { ...base, pos: at(30_000, 0) })).toBeNull();
    expect(updateDue(st(), { ...base, radiusKm: 150 })).toBe('radius');
    expect(updateDue(null, { ...base, lastTry: now - 3600_000 })).toBeNull();
    expect(updateDue(null, { ...base, lastTry: now - RETRY_AFTER - 1 })).toBe('first');
    expect(updateDue(null, { ...base, pos: null })).toBeNull();
  });

  it('downloads on Wi-Fi only when asked, and never with data saver on', () => {
    expect(connectionOk(true, { type: 'wifi' })).toBe(true);
    expect(connectionOk(true, { type: 'cellular' })).toBe(false);
    expect(connectionOk(false, { type: 'cellular' })).toBe(true);
    // Browsers that do not say (computers) count as fine.
    expect(connectionOk(true, {})).toBe(true);
    expect(connectionOk(true, undefined)).toBe(true);
    expect(connectionOk(false, { type: 'wifi', saveData: true })).toBe(false);
  });
});

describe('places in search', () => {
  it('lists a place found both locally and online once, with the local details', () => {
    const ix = new PlacesIndex();
    ix.add(sample());
    const local = ix.search('suria', KL).map((h) => hitToPlace(h, 'en'));
    expect(local[0].sub).toBe('Shopping mall');
    expect(local[0].info?.website).toBe('https://suriaklcc.com.my');
    const online: Place[] = [{ name: 'Suria KLCC', sub: 'Shopping center · Kuala Lumpur', lngLat: at(1510, 790) }, { name: 'Suria Sabah', sub: 'Kota Kinabalu', lngLat: [116.08, 5.98] }];
    const merged = mergeResults('suria', local, online);
    expect(merged.map((p) => p.name)).toEqual(['Suria KLCC', 'Suria Sabah']);
    expect(merged[0].sub).toBe('Shopping center · Kuala Lumpur');
    expect(merged[0].info?.website).toBe('https://suriaklcc.com.my');
  });

  it('puts strong local matches first and the rest after the online ones', () => {
    const ix = new PlacesIndex();
    ix.add(sample());
    const local = ix.search('ampang', KL).map((h) => hitToPlace(h, 'en'));
    const online: Place[] = [{ name: 'Ampang Point', sub: 'Ampang', lngLat: at(6000, 2000) }];
    // "Petronas Jalan Ampang" and "7-Eleven Ampang" match a word of the name: strong.
    expect(mergeResults('ampang', local, online).map((p) => p.name)).toEqual(['Petronas Jalan Ampang', '7-Eleven Ampang', 'Ampang Point']);
    const weak = ix.search('mpang', KL).map((h) => hitToPlace(h, 'en'));
    expect(mergeResults('mpang', weak, online).map((p) => p.name)).toEqual(['Ampang Point', 'Petronas Jalan Ampang', '7-Eleven Ampang']);
  });

  it('names places in the language chosen', () => {
    const ix = new PlacesIndex();
    ix.add(sample());
    const kopi = ix.search('lao wang', KL)[0];
    expect(hitToPlace(kopi, 'en').name).toBe('Lao Wang Kopitiam');
    expect(hitToPlace(kopi, 'ms').name).toBe('老王茶室');
    expect(hitToPlace(kopi, 'ms').info?.label).toBe('Kafe');
    expect(hitToPlace(ix.search('wanjo', KL)[0], 'en').info).toMatchObject({ label: 'Malaysian restaurant', hours: 'Mo-Su 06:00-14:00', source: 'om', group: 'food' });
  });
});
