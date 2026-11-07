import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cellId, cellsInCircle, overtureGroup, type CellFile, type PlacesManifest } from '../src/places/format';

const KL: [number, number] = [101.6869, 3.139];
const at = (dx: number, dy: number): [number, number] => [KL[0] + dx / 111_150, KL[1] + dy / 110_574];
const feature = (coords: [number, number], properties: Record<string, unknown>, type = 'Point') => ({
  type: 'Feature',
  geometry: type === 'Point' ? { type, coordinates: coords } : { type, coordinates: [[coords, [coords[0] + 0.001, coords[1]], [coords[0] + 0.001, coords[1] + 0.001], coords]] },
  properties,
});

function build(overture: object[], osm: object[], extra: string[] = []) {
  const dir = mkdtempSync(join(tmpdir(), 'jn-places-'));
  writeFileSync(join(dir, 'overture.geojsonseq'), overture.map((f) => '\x1e' + JSON.stringify(f)).join('\n') + '\n');
  writeFileSync(join(dir, 'osm.geojsonseq'), osm.map((f) => JSON.stringify(f)).join('\n') + '\n');
  const out = join(dir, 'out');
  const log = new TextDecoder().decode(
    execFileSync(process.execPath, ['scripts/places/build-places.mjs', '--overture', join(dir, 'overture.geojsonseq'), '--osm', join(dir, 'osm.geojsonseq'), '--out', out, '--overture-release', '2025-10-22.0', '--osm-date', '2026-11-08', ...extra], { stdio: 'pipe' }),
  );
  const manifest = JSON.parse(new TextDecoder().decode(readFileSync(join(out, 'manifest.json')))) as PlacesManifest;
  const cell = (id: string) => JSON.parse(new TextDecoder().decode(readFileSync(join(out, 'cells', `${id}.json`)))) as CellFile;
  return { out, log, manifest, cell };
}

const ov = (coords: [number, number], name: string, category: string, confidence: number, more: Record<string, unknown> = {}) =>
  feature(coords, { id: name, names: { primary: name }, categories: { primary: category }, confidence, addresses: [{ freeform: 'Jalan Ampang', locality: 'Kuala Lumpur', postcode: '50450', country: 'MY' }], ...more });

describe('places data builder', () => {
  it('merges Overture places with OpenStreetMap ones into cells with a manifest', () => {
    const { manifest, cell, log } = build(
      [
        // The same café as in OSM, 30 m off: one place, with OSM's position and both sources' details.
        ov(at(30, 0), "Kopi O' Corner", 'coffee_shop', 0.9, { phones: ['+60 3-1111 2222'], websites: ['https://kopio.my'] }),
        ov(at(500, 200), 'Nasi Lemak Wanjo', 'malaysian_restaurant', 0.85, { brand: { names: { primary: 'Wanjo' } } }),
        // Listed twice by Overture's sources: kept once.
        ov(at(800, 0), 'Petronas Ampang', 'gas_station', 0.7),
        ov(at(810, 5), 'Petronas Ampang', 'gas_station', 0.95),
        // Too uncertain, closed, or in another country.
        ov(at(-300, 0), 'Maybe A Shop', 'clothing_store', 0.3),
        ov(at(-400, 0), 'Old Kedai', 'hardware_store', 0.9, { operating_status: 'permanently_closed' }),
        ov(at(-500, 0), 'Toko Batam', 'convenience_store', 0.9, { addresses: [{ country: 'ID' }] }),
      ],
      [
        feature(at(0, 0), { name: 'Kopi O Corner', amenity: 'cafe', opening_hours: 'Mo-Su 07:00-22:00', 'addr:street': 'Jalan Ampang', 'addr:city': 'Kuala Lumpur' }),
        // Unnamed petrol station with a brand: listed by its brand.
        feature(at(2000, 0), { amenity: 'fuel', brand: 'Shell' }),
        // An unnamed bench: not a place.
        feature(at(100, 100), { amenity: 'bench' }),
        // A mall drawn as an outline, a mosque, and the city itself.
        feature(at(-1500, 800), { name: 'Suria KLCC', shop: 'mall' }, 'Polygon'),
        feature(at(1200, -900), { name: 'Masjid Jamek', amenity: 'place_of_worship', religion: 'muslim' }),
        feature(at(0, 50), { name: 'Kuala Lumpur', place: 'city' }),
      ],
    );
    expect(log).toMatch(/Overture 7 read, 2 added, 1 matched to OSM, 1 duplicates/);
    expect(manifest.v).toBe(1);
    expect(manifest.sources).toEqual({ overture: '2025-10-22.0', osm: '2026-11-08' });
    expect(manifest.cell).toBe(0.25);
    expect(manifest.attribution).toMatch(/Overture Maps/);
    const id = cellId(...KL);
    expect(Object.keys(manifest.cells)).toEqual([id]);
    const c = cell(id);
    expect(manifest.cells[id].n).toBe(c.p.length);
    expect(manifest.count).toBe(c.p.length);
    expect(manifest.cells[id].h).toMatch(/^[0-9a-f]{12}$/);
    const byName = new Map(c.p.map((r) => [r[0], r]));
    expect([...byName.keys()].sort()).toEqual(['Kopi O Corner', 'Kuala Lumpur', 'Masjid Jamek', 'Nasi Lemak Wanjo', 'Petronas Ampang', 'Shell', 'Suria KLCC']);
    // The merged café: OSM's name, position and hours with Overture's phone and website.
    const kopi = byName.get('Kopi O Corner')!;
    expect(c.cats[kopi[1]]).toEqual(['cafe', 'cafe']);
    expect(kopi[2]).toBe(Math.round(KL[0] * 1e5));
    expect(kopi[5]).toMatchObject({ h: 'Mo-Su 07:00-22:00', t: '+60 3-1111 2222', w: 'https://kopio.my', s: 'om', a: 'Jalan Ampang, Kuala Lumpur' });
    // The duplicate kept the more certain listing.
    expect(byName.get('Petronas Ampang')![2]).toBe(Math.round(at(810, 5)[0] * 1e5));
    expect(c.cats[byName.get('Petronas Ampang')![1]]).toEqual(['gas_station', 'fuel']);
    expect(byName.get('Nasi Lemak Wanjo')![5]).toMatchObject({ b: 'Wanjo', s: 'o', a: 'Jalan Ampang, 50450 Kuala Lumpur' });
    expect(c.cats[byName.get('Masjid Jamek')![1]]).toEqual(['mosque', 'worship']);
    expect(c.cats[byName.get('Suria KLCC')![1]]).toEqual(['mall', 'mall']);
    expect(c.cats[byName.get('Kuala Lumpur')![1]]).toEqual(['city', 'locality']);
    // Highest rank first.
    const ranks = c.p.map((r) => r[4]);
    expect([...ranks].sort((a, b) => b - a)).toEqual(ranks);
    expect(c.p[0][0]).toBe('Suria KLCC');
  });

  it('builds from OpenStreetMap alone when Overture could not be read', () => {
    const dir = mkdtempSync(join(tmpdir(), 'jn-places-'));
    writeFileSync(join(dir, 'osm.geojsonseq'), JSON.stringify(feature(at(0, 0), { name: 'Restoran Ali', amenity: 'restaurant' })) + '\n');
    execFileSync(process.execPath, ['scripts/places/build-places.mjs', '--osm', join(dir, 'osm.geojsonseq'), '--out', join(dir, 'out')], { stdio: 'pipe' });
    expect(existsSync(join(dir, 'out', 'cells', `${cellId(...KL)}.json`))).toBe(true);
  });

  it('keeps under the size budget by asking more of Overture-only places', () => {
    const many = Array.from({ length: 4000 }, (_, i) => ov(at((i % 60) * 120, Math.floor(i / 60) * 120), `Kedai Nombor ${i}`, 'clothing_store', 0.6 + (i % 40) / 100));
    const { manifest, log } = build(many, [feature(at(0, 0), { name: 'Restoran Ali', amenity: 'restaurant' })], ['--budget-mb', '0.15']);
    const bytes = Object.values(manifest.cells).reduce((a, c) => a + c.b, 0);
    expect(bytes).toBeLessThan(0.17 * 1024 * 1024);
    expect(log).toMatch(/need confidence/);
    expect(manifest.count).toBeGreaterThan(100);
  });

  it('gives a cell whose places did not change the same hash in the next build', () => {
    const input = [ov(at(100, 100), 'Restoran Sama', 'malaysian_restaurant', 0.9)];
    const a = build(input, []);
    const b = build(input, []);
    const id = cellId(...KL);
    expect(b.manifest.built >= a.manifest.built).toBe(true);
    expect(b.manifest.cells[id].h).toBe(a.manifest.cells[id].h);
    const c = build([...input, ov(at(300, 100), 'Kedai Baru', 'grocery_store', 0.9)], []);
    expect(c.manifest.cells[id].h).not.toBe(a.manifest.cells[id].h);
  });

  it('knows which cells lie within reach', () => {
    const ids = cellsInCircle(KL, 100);
    expect(ids).toContain(cellId(...KL));
    expect(ids.length).toBeGreaterThan(40);
    expect(ids.length).toBeLessThan(70);
    // Penang is 300 km away.
    expect(ids).not.toContain(cellId(100.33, 5.41));
    expect(cellsInCircle(KL, 50).length).toBeLessThan(ids.length);
  });

  it('groups Overture categories', () => {
    expect(overtureGroup('malaysian_restaurant')).toBe('food');
    expect(overtureGroup('bubble_tea')).toBe('cafe');
    expect(overtureGroup('ev_charging_station')).toBe('ev');
    expect(overtureGroup('atms')).toBe('bank');
    expect(overtureGroup('mosque')).toBe('worship');
    expect(overtureGroup('shopping_center')).toBe('mall');
    expect(overtureGroup('convenience_store')).toBe('grocery');
    expect(overtureGroup('automotive_repair')).toBe('car');
    expect(overtureGroup('pet_store')).toBe('shop');
    expect(overtureGroup('travel_agents')).toBe('office');
    expect(overtureGroup(undefined)).toBe('other');
  });
});
