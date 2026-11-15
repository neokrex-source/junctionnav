import { describe, expect, it, vi } from 'vitest';
import { commonsFile, facebookUrl, instagramUrl, lookUpLinks, osmPhoto, tiktokUrl, websiteUrl, wikipediaUrl } from '../src/discover/links';
import { osmKind, osmPlace, overpassQuery } from '../src/discover/osm';
import { listingCat, parseListings, plainWiki } from '../src/discover/wikivoyage';
import { fetchWikidataPhotos, wikiCat, type WikiPage } from '../src/discover/wiki';
import { DiscoverService, mergeInto, nameKey, radiusFor, samePlace } from '../src/discover/service';
import type { DiscoverPlace } from '../src/discover/types';

describe('social pages and photos from OpenStreetMap tags', () => {
  it('reads Facebook, Instagram and TikTok in their usual forms', () => {
    expect(facebookUrl('https://www.facebook.com/YutKeeRestaurant/')).toBe('https://www.facebook.com/YutKeeRestaurant');
    expect(facebookUrl('facebook.com/yutkee')).toBe('https://www.facebook.com/yutkee');
    expect(facebookUrl('yutkee')).toBe('https://www.facebook.com/yutkee');
    expect(facebookUrl('https://example.com/x')).toBeNull();
    expect(instagramUrl('@yutkee')).toBe('https://www.instagram.com/yutkee/');
    expect(instagramUrl('https://instagram.com/yutkee?hl=en')).toBe('https://www.instagram.com/yutkee/');
    expect(instagramUrl('not a handle')).toBeNull();
    expect(tiktokUrl('@yutkee.kl')).toBe('https://www.tiktok.com/@yutkee.kl');
    expect(tiktokUrl('https://www.tiktok.com/@yutkee')).toBe('https://www.tiktok.com/@yutkee');
    expect(websiteUrl('www.yutkee.com.my')).toBe('https://www.yutkee.com.my/');
    expect(websiteUrl('call us')).toBeNull();
    expect(wikipediaUrl('en:Petronas Towers')?.url).toBe('https://en.wikipedia.org/wiki/Petronas_Towers');
  });

  it('takes a Commons photo from image or wikimedia_commons, or a direct image link', () => {
    expect(commonsFile('File:Petronas_Towers.jpg')).toBe('File:Petronas Towers.jpg');
    expect(commonsFile('https://commons.wikimedia.org/wiki/File:Batu%20Caves.jpg')).toBe('File:Batu Caves.jpg');
    expect(commonsFile('Category:Batu Caves')).toBeNull();
    expect(osmPhoto({ wikimedia_commons: 'File:Batu Caves.jpg' })?.url).toBe('https://commons.wikimedia.org/wiki/Special:FilePath/Batu_Caves.jpg?width=480');
    expect(osmPhoto({ image: 'https://example.org/p/stall.jpg' })?.url).toBe('https://example.org/p/stall.jpg');
    expect(osmPhoto({ image: 'http://example.org/insecure.jpg' })).toBeNull();
  });

  it('looks a place up on TikTok, Instagram, Facebook and Google Maps by its name and area', () => {
    const l = lookUpLinks('Yut Kee', 'Kuala Lumpur', [101.697, 3.155]);
    expect(l.map((x) => x.label)).toEqual(['TikTok', 'Instagram', 'Facebook', 'Google Maps']);
    expect(l[0].url).toBe('https://www.tiktok.com/search?q=Yut%20Kee%20Kuala%20Lumpur');
  });
});

describe('OpenStreetMap', () => {
  it('asks Overpass for each kind around the point', () => {
    const q = overpassQuery('food', [101.7, 3.15], 5000);
    expect(q).toContain('(around:5000,3.15000,101.70000)');
    expect(q).toContain('"amenity"~"^(restaurant|cafe|food_court|ice_cream|fast_food)$"');
    expect(q).toContain('contact:instagram');
    expect(overpassQuery('themeparks', [101.7, 3.15], 40000)).toContain('"leisure"="water_park"');
  });

  it('makes a place with its kind, details, social links and sources', () => {
    const p = osmPlace(
      {
        type: 'node',
        id: 42,
        lat: 3.155,
        lon: 101.697,
        tags: { amenity: 'restaurant', name: 'Yut Kee', cuisine: 'malaysian;hainanese', 'contact:instagram': '@yutkee', facebook: 'yutkee', opening_hours: 'Tu-Su 07:30-16:30', 'addr:street': 'Jalan Kamunting', 'addr:city': 'Kuala Lumpur', wikidata: 'Q1234' },
      },
      'food',
      'en',
    )!;
    expect(p.kind).toBe('Malaysian restaurant');
    expect(p.area).toBe('Kuala Lumpur');
    expect(p.social.instagram).toBe('https://www.instagram.com/yutkee/');
    expect(p.sources.map((s) => s.kind)).toEqual(['osm', 'facebook', 'instagram', 'wikidata']);
    expect(p.sources[0].url).toBe('https://www.openstreetmap.org/node/42');
    expect(osmKind({ tourism: 'museum' }, 'ms')).toBe('Muzium');
  });

  it('leaves out rides inside parks and chain fast food, and puts chains after local places', () => {
    expect(osmPlace({ type: 'node', id: 1, lat: 3, lon: 101, tags: { attraction: 'roller_coaster', tourism: 'attraction', name: 'Coaster' } }, 'attractions', 'en')).toBeNull();
    expect(osmPlace({ type: 'node', id: 2, lat: 3, lon: 101, tags: { amenity: 'fast_food', brand: 'Burger Chain', name: 'Burger Chain', website: 'x.com' } }, 'food', 'en')).toBeNull();
    const chain = osmPlace({ type: 'node', id: 3, lat: 3, lon: 101, tags: { amenity: 'cafe', brand: 'Coffee Chain', name: 'Coffee Chain', website: 'https://c.com' } }, 'food', 'en')!;
    const local = osmPlace({ type: 'node', id: 4, lat: 3, lon: 101, tags: { amenity: 'cafe', name: 'Kopi Corner', website: 'https://k.com' } }, 'food', 'en')!;
    expect(chain.chain).toBe(true);
    expect(local.score).toBeGreaterThan(chain.score);
  });
});

const GUIDE = `
==See==
* {{see
| name=[[Petronas Twin Towers]] | alt= | url=https://www.petronastwintowers.com.my | email=
| address=KLCC | lat=3.1579 | long=101.7116 | directions=
| hours=Tu-Su 09:00-21:00 | price={{MYR|98}} for adults
| image=Petronas Towers at night.jpg | wikidata=Q83063
| content=The tallest twin towers in the world, with a '''skybridge'''.<ref>x</ref>
}}
* {{do | name=Sunway Lagoon | lat=3.0710 | long=101.6066 | content=A water park and theme park. }}
* {{see | name=No position | content=Somewhere. }}
==Eat==
* {{eat
| name=Yut Kee | lat=3.1551 | long=101.6971 | url=www.yutkee.com.my
| content=Hainanese kopitiam famous for its roti babi.
}}
* {{listing | type=drink | name=Bar Nine | lat=3.15 | long=101.71 | content=Cocktails. }}
* {{drink | name=VCR | lat=3.14 | long=101.70 | content=Speciality coffee café. }}
==Buy==
* {{buy | name=Pavilion KL | lat=3.149 | long=101.713 | content=Big shopping mall on Bukit Bintang. }}
==Sleep==
* {{sleep | name=Pangkor Laut Resort | lat=4.2 | long=100.55 | content=Island resort. }}
* {{sleep | name=Backpacker Inn | lat=3.15 | long=101.70 | content=Dorms. }}
`;

describe('Wikivoyage traveller picks', () => {
  it('reads the listings with a position, in plain words', () => {
    const l = parseListings(GUIDE, 'Kuala Lumpur/City Centre');
    expect(l.map((x) => x.name)).toEqual(['Petronas Twin Towers', 'Sunway Lagoon', 'Yut Kee', 'Bar Nine', 'VCR', 'Pavilion KL', 'Pangkor Laut Resort', 'Backpacker Inn']);
    expect(l[0].content).toBe('The tallest twin towers in the world, with a skybridge.');
    expect(l[0].price).toBe('MYR 98 for adults');
    expect(l[0].wikidata).toBe('Q83063');
    expect(l[3].type).toBe('drink');
    expect(plainWiki("[[Bukit Bintang|BB]] and '''bold''' {{tag}}")).toBe('BB and bold');
  });

  it('sorts them into the five kinds', () => {
    const cats = parseListings(GUIDE, 'KL').map((l) => [l.name, listingCat(l)]);
    expect(Object.fromEntries(cats)).toEqual({
      'Petronas Twin Towers': 'attractions',
      'Sunway Lagoon': 'themeparks',
      'Yut Kee': 'food',
      'Bar Nine': null,
      VCR: 'food',
      'Pavilion KL': 'malls',
      'Pangkor Laut Resort': 'resorts',
      'Backpacker Inn': null,
    });
  });
});

describe('Wikipedia landmarks', () => {
  const page = (title: string, description: string, type?: string): WikiPage => ({ lang: 'en', title, description, type, lngLat: [101.7, 3.15] });
  it('keeps sights, sorts parks, malls and resorts, and leaves out towns, roads and schools', () => {
    expect(wikiCat(page('Petronas Towers', 'Twin skyscrapers in Kuala Lumpur, Malaysia', 'landmark'))).toBe('attractions');
    expect(wikiCat(page('Batu Caves', 'Limestone hill with caves and temples'))).toBe('attractions');
    expect(wikiCat(page('Sunway Lagoon', 'Theme park in Selangor, Malaysia'))).toBe('themeparks');
    expect(wikiCat(page('Pavilion Kuala Lumpur', 'Shopping mall in Kuala Lumpur'))).toBe('malls');
    expect(wikiCat(page('Bukit Bintang', 'District of Kuala Lumpur'))).toBeNull();
    expect(wikiCat(page('Jalan Ampang', 'Road in Kuala Lumpur'))).toBeNull();
    expect(wikiCat(page('SMK Bukit Bintang', 'Secondary school in Malaysia'))).toBeNull();
    expect(wikiCat(page('Kuala Lumpur', 'Capital of Malaysia', 'city'))).toBeNull();
  });

  it('gets photos for Wikidata items in one query', async () => {
    const fetchFn = vi.fn(async (_url: string) =>
      new Response(
        JSON.stringify({
          results: {
            bindings: [
              { item: { value: 'http://www.wikidata.org/entity/Q83063' }, image: { value: 'http://commons.wikimedia.org/wiki/Special:FilePath/Petronas%20Towers%20at%20night.jpg' }, enwiki: { value: 'https://en.wikipedia.org/wiki/Petronas_Towers' } },
            ],
          },
        }),
      ),
    );
    const got = await fetchWikidataPhotos(['Q83063', 'bad'], fetchFn as unknown as typeof fetch);
    expect(got.get('Q83063')).toEqual({ file: 'File:Petronas Towers at night.jpg', enwiki: 'https://en.wikipedia.org/wiki/Petronas_Towers' });
    expect(String(fetchFn.mock.calls[0][0])).toContain('wd%3AQ83063');
  });
});

describe('putting the sources together', () => {
  const base = (over: Partial<DiscoverPlace>): DiscoverPlace => ({ id: 'x', name: 'X', lngLat: [101.7, 3.15], cat: 'attractions', kind: '', social: {}, sources: [], score: 30, ...over });

  it('one place from OSM, Wikivoyage and Wikipedia, with every link', () => {
    const osm = base({ id: 'osm:way/1', name: 'Petronas Twin Towers', lngLat: [101.7117, 3.1578], wikidata: 'Q83063', kind: 'Landmark building', sources: [{ kind: 'osm', url: 'https://www.openstreetmap.org/way/1', label: 'OpenStreetMap' }] });
    const wv = base({ id: 'wv:petronas', name: 'Petronas Twin Towers', lngLat: [101.7116, 3.1579], wikidata: 'Q83063', pick: true, about: 'The tallest twin towers.', aboutFrom: 'wikivoyage', sources: [{ kind: 'wikivoyage', url: 'https://en.wikivoyage.org/wiki/KL', label: 'Wikivoyage: KL' }], score: 55 });
    const wp = base({ id: 'wp:en:Petronas Towers', name: 'Petronas Towers', lngLat: [101.7115, 3.158], wikidata: 'Q83063', about: 'Skyscrapers.', aboutFrom: 'wikipedia', photo: { url: 'https://upload.wikimedia.org/x.jpg' }, sources: [{ kind: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Petronas_Towers', label: 'Wikipedia' }], score: 60 });
    const list = mergeInto(mergeInto([osm], [wv]), [wp]);
    expect(list).toHaveLength(1);
    const p = list[0];
    expect(p.lngLat).toEqual([101.7117, 3.1578]);
    expect(p.about).toBe('The tallest twin towers.');
    expect(p.pick).toBe(true);
    expect(p.photo?.url).toBe('https://upload.wikimedia.org/x.jpg');
    expect(p.sources.map((s) => s.kind)).toEqual(['osm', 'wikivoyage', 'wikipedia']);
    expect(p.score).toBeGreaterThan(60);
  });

  it('alike names close together are the same place; far apart or different are not', () => {
    expect(nameKey('Restoran Yut Kee')).toBe(nameKey('Yut Kee'));
    expect(samePlace(base({ name: 'Restoran Yut Kee', cat: 'food' }), base({ name: 'Yut Kee', cat: 'food', lngLat: [101.7005, 3.1505] }))).toBe(true);
    expect(samePlace(base({ name: 'Yut Kee', cat: 'food' }), base({ name: 'Yut Kee', cat: 'food', lngLat: [101.75, 3.15] }))).toBe(false);
    expect(samePlace(base({ name: 'Central Market' }), base({ name: 'Chinatown' }))).toBe(false);
    // Theme parks are big: their entries can be far apart.
    expect(samePlace(base({ name: 'Sunway Lagoon', cat: 'themeparks' }), base({ name: 'Sunway Lagoon Theme Park', cat: 'themeparks', lngLat: [101.709, 3.15] }))).toBe(true);
  });

  it('looks wider when zoomed out, within each kind’s limits', () => {
    expect(radiusFor('food', 1000)).toBe(5000);
    expect(radiusFor('food', 50_000)).toBe(12_000);
    expect(radiusFor('resorts', 20_000)).toBe(40_000);
  });

  it('asks every source at once, keeps what answers, and says what could not be reached', async () => {
    const fetchFn = vi.fn(async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes('overpass')) return new Response(JSON.stringify({ elements: [{ type: 'node', id: 7, lat: 3.1551, lon: 101.6971, tags: { amenity: 'restaurant', name: 'Restoran Yut Kee', instagram: 'yutkee' } }] }));
      if (u.includes('wikivoyage') && u.includes('geosearch')) return new Response(JSON.stringify({ query: { geosearch: [{ title: 'Kuala Lumpur/City Centre', dist: 900 }] } }));
      if (u.includes('wikivoyage') && u.includes('parse')) return new Response(JSON.stringify({ parse: { title: 'Kuala Lumpur/City Centre', wikitext: GUIDE } }));
      if (u.includes('wikipedia')) return new Response('down', { status: 503 });
      return new Response('{}');
    });
    const svc = new DiscoverService({ fetchFn: fetchFn as unknown as typeof fetch, overpass: () => ['https://overpass.test/api/interpreter'] });
    const r = await svc.discover('food', [101.7, 3.15], 5000, 'en');
    expect(r.used).toEqual(['osm', 'wikivoyage']);
    expect(r.failed).toEqual(['wikipedia']);
    const names = r.places.map((p) => p.name);
    expect(names).toContain('Restoran Yut Kee');
    expect(names).toContain('VCR');
    const yk = r.places.find((p) => p.name === 'Restoran Yut Kee')!;
    expect(yk.pick).toBe(true);
    expect(yk.about).toContain('roti babi');
    expect(yk.sources.map((s) => s.kind)).toEqual(['osm', 'instagram', 'wikivoyage', 'website']);
    // Kept: a second tap within 15 minutes asks nothing new.
    const calls = fetchFn.mock.calls.length;
    expect(svc.cached('food', [101.7, 3.15], 5000, 'en')).not.toBeNull();
    await svc.discover('food', [101.7, 3.15], 5000, 'en');
    expect(fetchFn.mock.calls.length).toBe(calls);
    // Refresh asks again.
    await svc.discover('food', [101.7, 3.15], 5000, 'en', true);
    expect(fetchFn.mock.calls.length).toBeGreaterThan(calls);
  });

  it('without internet, the places on this phone', async () => {
    const local = vi.fn(async () => [base({ id: 'local:1', name: 'Muzium Negara', cat: 'attractions' })]);
    const svc = new DiscoverService({ overpass: () => [], local, online: () => false });
    const r = await svc.discover('attractions', [101.7, 3.15], 10000, 'en');
    expect(r.used).toEqual(['local']);
    expect(r.places[0].name).toBe('Muzium Negara');
  });
});
