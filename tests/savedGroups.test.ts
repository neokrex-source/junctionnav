import { beforeEach, describe, expect, it } from 'vitest';
import { FAV, PlaceStore } from '../src/state/places';
import type { Place } from '../src/search/places';

const mem = new Map<string, string>();
(globalThis as unknown as { localStorage: Storage }).localStorage = {
  getItem: (k: string) => mem.get(k) ?? null,
  setItem: (k: string, v: string) => void mem.set(k, v),
  removeItem: (k: string) => void mem.delete(k),
  clear: () => mem.clear(),
  key: () => null,
  length: 0,
} as Storage;

const klcc: Place = { name: 'Suria KLCC', sub: 'Mall', lngLat: [101.7123, 3.1579] };
const yk: Place = {
  name: 'Yut Kee',
  sub: 'Restaurant',
  lngLat: [101.6971, 3.1551],
  discover: { id: 'osm:node/7', name: 'Yut Kee', lngLat: [101.6971, 3.1551], cat: 'food', kind: 'Restaurant', social: {}, sources: [{ kind: 'osm', url: 'https://www.openstreetmap.org/node/7', label: 'OpenStreetMap' }], score: 50, photo: { url: 'https://x/y.jpg' } },
};

describe('saved groups', () => {
  beforeEach(() => mem.clear());

  it('starts with Favourites and Want to go', () => {
    const s = new PlaceStore();
    expect(s.groups.map((g) => g.builtIn)).toEqual(['want']);
    expect(s.items(FAV)).toEqual([]);
  });

  it('saves a place to several groups, with what Discover found about it', () => {
    const s = new PlaceStore();
    s.addTo(FAV, yk);
    s.addTo('want', yk);
    expect(s.groupsWith(yk)).toEqual([FAV, 'want']);
    expect(s.items('want')[0].discover?.photo?.url).toBe('https://x/y.jpg');
    expect(new PlaceStore().items(FAV)[0].discover?.sources[0].kind).toBe('osm');
  });

  it('creates, renames and deletes groups; moves and removes places', () => {
    const s = new PlaceStore();
    const id = s.createGroup('  Penang food trip  ')!;
    expect(s.groups.find((g) => g.id === id)?.name).toBe('Penang food trip');
    expect(s.createGroup('   ')).toBeNull();
    s.addTo(id, klcc);
    s.updateItem(klcc, { memo: 'Meet at the fountain', link: 'https://www.tiktok.com/@x/video/1' });
    s.move(id, 'want', klcc);
    expect(s.items(id)).toEqual([]);
    expect(s.items('want')[0].memo).toBe('Meet at the fountain');
    expect(s.items('want')[0].link).toBe('https://www.tiktok.com/@x/video/1');
    s.renameGroup(id, 'Penang');
    expect(s.groups.find((g) => g.id === id)?.name).toBe('Penang');
    s.removeFrom('want', klcc);
    expect(s.groupsWith(klcc)).toEqual([]);
    s.deleteGroup(id);
    expect(s.groups.some((g) => g.id === id)).toBe(false);
  });

  it('keeps favourites working as before (the star and search suggestions)', () => {
    const s = new PlaceStore();
    expect(s.toggleFavourite(klcc)).toBe(true);
    expect(s.isFavourite(klcc)).toBe(true);
    expect(s.data.favourites[0].name).toBe('Suria KLCC');
    expect(s.toggleFavourite(klcc)).toBe(false);
  });

  it('reads places saved before groups existed', () => {
    mem.set('junctionnav.places.v1', JSON.stringify({ favourites: [klcc], recents: [] }));
    const s = new PlaceStore();
    expect(s.items(FAV)).toHaveLength(1);
    expect(s.groups[0].builtIn).toBe('want');
  });
});
