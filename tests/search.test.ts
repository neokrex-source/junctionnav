import { describe, expect, it, vi } from 'vitest';
import { haversine, type LngLat } from '../src/geo/geo';
import { cellId, type CellFile, type PlaceGroup } from '../src/places/format';
import { addressWords, middle, PlacesIndex } from '../src/places/placesIndex';
import { addressFallbacks, cleanAddress, looksLikeAddress, postcodeOf, streetOf, townOf } from '../src/search/address';
import { coordText, dmsText, parseCoordinates } from '../src/search/coords';
import { findLink, isMapsLink, isShortMapsLink, linkInPage, parseMapsLink, resolveShortLink } from '../src/search/googleLinks';
import type { Place, PlaceSearchEngine } from '../src/search/places';
import { decodePlusCode, encodePlusCode, isFullPlusCode, parsePlusCode, recoverPlusCode } from '../src/search/pluscode';
import { APPROX, SmartSearch } from '../src/search/smartSearch';

const KL: LngLat = [101.6869, 3.139];
const close = (a: LngLat | null, b: LngLat, metres = 2) => {
  expect(a).not.toBeNull();
  expect(haversine(a!, b)).toBeLessThan(metres);
};

describe('coordinates', () => {
  it('reads the forms people paste', () => {
    for (const q of [
      '3.139, 101.6869',
      '3.139 101.6869',
      '3.139,101.6869',
      ' 3.139 ,  101.6869 ',
      '3.139; 101.6869',
      '101.6869, 3.139',
      '3.139°N 101.6869°E',
      '3.139° N, 101.6869° E',
      'N 3.139, E 101.6869',
      'N3.139 E101.6869',
      '3.139N 101.6869E',
      '101.6869 E 3.139 N',
      '@3.139,101.6869',
      'lat: 3.139, lng: 101.6869',
      'Latitude 3.139 Longitude 101.6869',
      '(3.139, 101.6869)',
      'geo:3.139,101.6869',
      'geo:3.139,101.6869;u=35',
      'geo:0,0?q=3.139,101.6869(Suria KLCC)',
    ])
      close(parseCoordinates(q), KL);
  });

  it('reads degrees, minutes and seconds the way Google Maps writes them', () => {
    close(parseCoordinates(`3°08'20.4"N 101°41'12.8"E`), KL, 5);
    close(parseCoordinates(`3°08′20.4″N 101°41′12.8″E`), KL, 5);
    close(parseCoordinates(`3°08.340'N 101°41.213'E`), KL, 5);
    close(parseCoordinates('3d8m20.4s N 101d41m12.8s E'), KL, 5);
    close(parseCoordinates(`N 3° 8' 20.4", E 101° 41' 12.8"`), KL, 5);
  });

  it('keeps the hemisphere: south and west are negative', () => {
    close(parseCoordinates('33.8688° S, 151.2093° E'), [151.2093, -33.8688]);
    close(parseCoordinates(`33°52'08"S 151°12'33"E`), [151.2092, -33.8689], 10);
    close(parseCoordinates('-3.1, -60.02'), [-60.02, -3.1]);
    close(parseCoordinates('40.7128 N, 74.0060 W'), [-74.006, 40.7128]);
  });

  it('leaves alone what is not coordinates', () => {
    for (const q of [
      '12 34',
      'Jalan 12',
      '47300',
      '3.139-101.68',
      "McDonald's Bangsar",
      '100.5, 200.5',
      '3.139, 101.6869, 17z',
      '3,139, 101,6869',
      '91.5 N 10 E',
      'geo:0,0',
      'N 3.1 N 101.6',
      '',
    ])
      expect(parseCoordinates(q), q).toBeNull();
  });

  it('writes a point back', () => {
    expect(coordText(KL)).toBe('3.13900, 101.68690');
    expect(dmsText([101.6868889, 3.139])).toBe(`3°08'20.4"N 101°41'12.8"E`);
    expect(dmsText([-74.006, -33.8688])).toBe(`33°52'07.7"S 74°00'21.6"W`);
    // Rounding up to a whole minute carries over.
    expect(dmsText([101.99999999, 3.9999999])).toBe(`4°00'00.0"N 102°00'00.0"E`);
  });
});

describe('plus codes', () => {
  it('matches the reference implementation', () => {
    expect(encodePlusCode([2.7821875, 20.3700625])).toBe('7FG49QCJ+2V');
    close(decodePlusCode('7FG49QCJ+2V'), [2.7821875, 20.3700625], 0.01);
    // Padded codes stand for bigger areas, decoded to their centre.
    close(decodePlusCode('7FG49Q00+'), [2.775, 20.375], 1);
    // Digits past the tenth narrow it down in a 4 by 5 grid.
    const fine = decodePlusCode('7FG49QCJ+2VX');
    expect(haversine(fine, [2.7821875, 20.3700625])).toBeLessThan(8);
  });

  it('round trips anywhere to within the size of a code', () => {
    for (const p of [KL, [103.8198, 1.3521], [-74.006, 40.7128], [151.2093, -33.8688], [-0.0001, 0.0001], [179.9999, 89.9999], [-180, -90]] as LngLat[]) {
      const code = encodePlusCode(p);
      expect(code).toMatch(/^[23456789CFGHJMPQRVWX]{8}\+[23456789CFGHJMPQRVWX]{2}$/);
      expect(haversine(decodePlusCode(code), p)).toBeLessThan(10);
    }
  });

  it('reads codes in text, with the town after a short one', () => {
    expect(parsePlusCode('6PH57VP3+PR')).toEqual({ code: '6PH57VP3+PR', locality: '' });
    expect(parsePlusCode('6ph57vp3+pr')).toEqual({ code: '6PH57VP3+PR', locality: '' });
    expect(parsePlusCode('7VP3+PR Kuala Lumpur')).toEqual({ code: '7VP3+PR', locality: 'Kuala Lumpur' });
    expect(parsePlusCode('7VP3+PR, Kuala Lumpur, Federal Territory of Kuala Lumpur')?.locality).toBe('Kuala Lumpur, Federal Territory of Kuala Lumpur');
    expect(isFullPlusCode('6PH57VP3+PR')).toBe(true);
    expect(isFullPlusCode('7VP3+PR')).toBe(false);
    for (const q of ['hello+world', '2+2', '6PH57VP3+P', 'XX000000+', '7V0P3+PR', 'Jalan 7VP3', 'KL Sentral']) expect(parsePlusCode(q), q).toBeNull();
  });

  it('completes a short code from a place nearby, across a cell edge too', () => {
    const p: LngLat = [101.7123, 3.1578];
    const full = encodePlusCode(p);
    const short = full.slice(4);
    close(recoverPlusCode(short, [101.6, 3.05]), decodePlusCode(full), 1);
    // Just east of a whole degree, seen from just west of it.
    const east: LngLat = [102.0012, 3.0004];
    const shortEast = encodePlusCode(east).slice(4);
    close(recoverPlusCode(shortEast, [101.95, 2.98]), decodePlusCode(encodePlusCode(east)), 1);
    // A full code is just decoded.
    close(recoverPlusCode(full, [0, 0]), decodePlusCode(full), 0.01);
  });
});

describe('Google Maps links', () => {
  it('finds the link in shared text', () => {
    expect(findLink('Suria KLCC\nhttps://maps.app.goo.gl/AbCd1234XyZ')).toBe('https://maps.app.goo.gl/AbCd1234XyZ');
    expect(findLink('see (https://www.google.com/maps/@3.139,101.6869,15z).')).toBe('https://www.google.com/maps/@3.139,101.6869,15z');
    expect(findLink('maps.app.goo.gl/AbCd1234')).toBe('https://maps.app.goo.gl/AbCd1234');
    expect(findLink('Jalan Alor')).toBeNull();
    expect(isShortMapsLink('https://maps.app.goo.gl/AbCd1234')).toBe(true);
    expect(isShortMapsLink('https://goo.gl/maps/AbCd1234')).toBe(true);
    expect(isShortMapsLink('https://maps.google.com/?cid=123456789')).toBe(true);
    expect(isShortMapsLink('https://www.google.com/maps/place/x')).toBe(false);
  });

  it("takes the place's own position over the map view", () => {
    const m = parseMapsLink(
      'https://www.google.com/maps/place/Suria+KLCC/@3.1579,101.7095,17z/data=!3m1!4b1!4m6!3m5!1s0x31cc37d12d669c1f:0x9e3afdd17c8a9056!8m2!3d3.1578!4d101.7123!16zL20vMDVxY3E5?entry=ttu',
    )!;
    expect(m.name).toBe('Suria KLCC');
    close(m.point!, [101.7123, 3.1578]);
    close(m.view!, [101.7095, 3.1579]);
  });

  it('reads pins, searches and directions', () => {
    close(parseMapsLink('https://www.google.com/maps/@3.139,101.6869,15z')!.view!, KL);
    expect(parseMapsLink('https://www.google.com/maps/@3.139,101.6869,15z')!.point).toBeUndefined();
    close(parseMapsLink('https://maps.google.com/?q=3.139,101.6869')!.point!, KL);
    close(parseMapsLink('https://maps.google.com/maps?q=loc:3.139,101.6869&z=15')!.point!, KL);
    close(parseMapsLink('https://www.google.com/maps?ll=3.139,101.6869&z=15')!.point!, KL);
    close(parseMapsLink('https://www.google.com/maps/search/?api=1&query=3.139%2C101.6869')!.point!, KL);
    close(parseMapsLink("https://www.google.com/maps/place/3%C2%B008'20.4%22N+101%C2%B041'12.8%22E/@3.139,101.6869,17z")!.point!, KL, 5);
    expect(parseMapsLink('https://www.google.com.my/maps?q=Suria+KLCC')).toEqual({ query: 'Suria KLCC' });
    expect(parseMapsLink('https://www.google.com/maps/search/?api=1&query=Suria%20KLCC&query_place_id=ChIJ')!.query).toBe('Suria KLCC');
    const search = parseMapsLink('https://www.google.com/maps/search/nasi+lemak/@3.15,101.71,15z')!;
    expect(search.query).toBe('nasi lemak');
    close(search.view!, [101.71, 3.15]);
    expect(parseMapsLink('https://www.google.com/maps/dir/?api=1&destination=Suria+KLCC')!.query).toBe('Suria KLCC');
    close(parseMapsLink('https://www.google.com/maps/dir/?api=1&origin=KL+Sentral&destination=3.1578,101.7123')!.point!, [101.7123, 3.1578]);
    const dir = parseMapsLink(
      'https://www.google.com/maps/dir/KL+Sentral/Suria+KLCC/@3.14,101.70,14z/data=!3m1!4b1!4m14!4m13!1m5!1m1!1s0x0:0x0!2m2!1d101.6866!2d3.134!1m5!1m1!1s0x0:0x0!2m2!1d101.7123!2d3.1578!3e0',
    )!;
    expect(dir.query).toBe('Suria KLCC');
    close(dir.point!, [101.7123, 3.1578]);
    expect(parseMapsLink('https://maps.google.com/maps?daddr=3.1578,101.7123')!.point).toEqual([101.7123, 3.1578]);
    expect(parseMapsLink('https://www.google.com/maps/place/7VP3%2BPR+Kuala+Lumpur/@3.139,101.6869,17z')!.name).toBe('7VP3+PR Kuala Lumpur');
  });

  it('turns down what is not a map link', () => {
    expect(parseMapsLink('https://www.google.com/search?q=klcc')).toBeNull();
    expect(parseMapsLink('https://example.com/maps/@3.1,101.6,15z')).toBeNull();
    expect(parseMapsLink('https://www.google.com/maps?cid=123')).toBeNull();
    expect(isMapsLink('https://www.google.com/maps?cid=123')).toBe(true);
    expect(isMapsLink('https://example.com/maps')).toBe(false);
    expect(parseMapsLink('not a link')).toBeNull();
  });

  it('follows a short link through its redirects and consent page', async () => {
    const place = 'https://www.google.com/maps/place/Suria+KLCC/data=!4m2!3m1!1s0x0:0x0!8m2!3d3.1578!4d101.7123';
    const hops: Record<string, { status: number; headers: Record<string, string>; body?: string }> = {
      'https://maps.app.goo.gl/AbCd': { status: 302, headers: { Location: 'https://consent.google.com/m?continue=' + encodeURIComponent(place) } },
    };
    const get = vi.fn(async (u: string) => hops[u] ?? { status: 200, headers: {} });
    expect(await resolveShortLink('https://maps.app.goo.gl/AbCd', get)).toBe(place);
    // Through a second redirect, the header in lower case.
    const hops2: Record<string, { status: number; headers: Record<string, string> }> = {
      'https://maps.app.goo.gl/x': { status: 301, headers: { location: 'https://goo.gl/maps/y' } },
      'https://goo.gl/maps/y': { status: 302, headers: { location: place } },
    };
    expect(await resolveShortLink('https://maps.app.goo.gl/x', async (u) => hops2[u])).toBe(place);
    // A page that sends the browser on with a script.
    const page = `<html><script>window.location.replace("${place.replace(/\//g, '\\/')}")</script></html>`;
    expect(await resolveShortLink('https://maps.app.goo.gl/z', async () => ({ status: 200, headers: {}, body: page }))).toBe(place);
    expect(linkInPage(`<a href="${place.replace(/&/g, '&amp;')}">`)).toBe(place);
    await expect(resolveShortLink('https://maps.app.goo.gl/gone', async () => ({ status: 404, headers: {} }))).rejects.toThrow(/expired/);
  });
});

describe('rough addresses', () => {
  it('knows an address when it sees one', () => {
    for (const q of ['Jalan Alor', 'No 12, Jln SS2/24', '47300 Petaling Jaya', '12, Lorong 3', 'Lot 5 Kampung Baru', 'Taman Tun Dr Ismail']) expect(looksLikeAddress(q), q).toBe(true);
    for (const q of ['KLCC', "McDonald's Bangsar", 'Pavilion KL', 'nasi lemak', 'KL Sentral']) expect(looksLikeAddress(q), q).toBe(false);
  });

  it('tidies it for the search services', () => {
    expect(cleanAddress('No 12, Jln SS2/24,  47300 PJ, Selangor')).toBe('12, Jalan SS2/24, 47300 Petaling Jaya, Selangor');
    expect(cleanAddress('Unit A-3-1, Blok A, Tmn Desa, 58100 KL')).toBe('Taman Desa, 58100 Kuala Lumpur');
    expect(cleanAddress('Tingkat 2, Lot 5, Jalan Stesen Sentral 5, KL Sentral, 50470 Kuala Lumpur')).toBe('Jalan Stesen Sentral 5, KL Sentral, 50470 Kuala Lumpur');
    expect(cleanAddress('Lrg Bkt Bintang, Sg. Besi, W.P. Kuala Lumpur')).toBe('Lorong Bukit Bintang, Sungai Besi, Wilayah Persekutuan Kuala Lumpur');
  });

  it('picks out the postcode, street and town', () => {
    const q = '12, Jalan SS 2/24, 47300 Petaling Jaya, Selangor';
    expect(postcodeOf(q)).toBe('47300');
    expect(postcodeOf('Tel 0123456789')).toBeNull();
    expect(streetOf(q)).toBe('Jalan SS 2/24');
    expect(streetOf('12 Jalan Bukit Bintang Taman Tiara 55100 Kuala Lumpur')).toBe('Jalan Bukit Bintang');
    expect(streetOf('Taman Desa')).toBeNull();
    expect(townOf(q)).toBe('Petaling Jaya');
    expect(townOf('Jalan SS 2/24, Petaling Jaya, Selangor')).toBe('Petaling Jaya');
    expect(townOf('Jalan Alor')).toBeNull();
  });

  it('falls back to broader versions of it, never a state alone', () => {
    expect(addressFallbacks('No 12, Jalan SS 2/24, 47300 Petaling Jaya, Selangor')).toEqual([
      'Jalan SS 2/24, 47300 Petaling Jaya, Selangor',
      '47300 Petaling Jaya, Selangor',
      '47300 Petaling Jaya',
      'Petaling Jaya',
    ]);
    expect(addressFallbacks('12 Jalan Bukit Bintang Taman Tiara 55100 Kuala Lumpur')).toEqual([
      'Jalan Bukit Bintang Taman Tiara 55100 Kuala Lumpur',
      'Taman Tiara 55100 Kuala Lumpur',
      '55100 Kuala Lumpur',
      'Kuala Lumpur',
    ]);
    expect(addressFallbacks('Jalan Alor, Selangor')).toEqual([]);
  });
});

describe('roughly where a street or postcode is', () => {
  const at = (dx: number, dy: number, from: LngLat = KL): [number, number] => [from[0] + dx / 111_150, from[1] + dy / 110_574];
  const PJ: LngLat = [101.6156, 3.1073];
  function cellOf(rows: [string, [number, number], string][]): CellFile {
    const cats: [string, PlaceGroup][] = [['restaurant', 'food']];
    return { v: 1, id: cellId(...rows[0][1]), built: '2026-11-08T00:00:00Z', cats, p: rows.map(([n, [x, y], a]) => [n, 0, Math.round(x * 1e5), Math.round(y * 1e5), 40, { a, s: 'o' }]) };
  }

  it('writes addresses as plain words', () => {
    expect(addressWords('No. 12, Jln SS2/24, 47300 PJ')).toBe('no 12 jalan ss 2 24 47300 pj');
    expect(addressWords('Lrg Bkt Bintang')).toBe('lorong bukit bintang');
  });

  it('finds the middle of the places on a street, in the right postcode', () => {
    const ix = new PlacesIndex();
    ix.add(
      cellOf([
        ['Kedai A', at(0, 0, PJ), '1, Jalan SS 2/24, 47300 Petaling Jaya'],
        ['Kedai B', at(120, 10, PJ), '5, Jln SS2/24, 47300 Petaling Jaya'],
        ['Kedai C', at(240, 20, PJ), '9 Jalan SS 2/24 47300 PJ'],
        // Another street whose name starts the same.
        ['Kedai D', at(2000, 900, PJ), '3, Jalan SS 2/240, 47300 Petaling Jaya'],
        // The same name in another town.
        ['Kedai E', at(30_000, 20_000, PJ), '7, Jalan SS 2/24, 40000 Shah Alam'],
        ['Kedai F', at(600, -400, PJ), '22, Jalan SS 2/55, 47300 Petaling Jaya'],
      ]),
    );
    const hits = ix.addressArea({ street: 'Jalan SS 2/24', postcode: '47300', town: 'Petaling Jaya' });
    const street = hits.find((h) => h.by === 'street')!;
    expect(street.n).toBe(3);
    expect(haversine([street.lon, street.lat], at(120, 10, PJ))).toBeLessThan(30);
    const pc = hits.find((h) => h.by === 'postcode')!;
    expect(pc.n).toBe(5);
    // A street with no word of its own is not looked for.
    expect(ix.addressArea({ street: 'Jalan', postcode: null, town: null })).toEqual([]);
    // Spread over two towns with nothing to choose between them: no answer rather than a wrong one.
    expect(ix.addressArea({ street: 'Jalan SS 2/24', postcode: null, town: null })).toEqual([]);
    // The town decides it.
    expect(ix.addressArea({ street: 'Jalan SS 2/24', postcode: null, town: 'Shah Alam' })[0].n).toBe(1);
  });

  it('ignores a few strays when finding the middle', () => {
    const pts = [at(0, 0), at(50, 0), at(0, 50), at(60, 60), at(40, 20), at(30_000, 0)];
    close(middle(pts, 3000), at(35, 35), 40);
    expect(middle([at(0, 0), at(20_000, 0), at(40_000, 0)], 3000)).toBeNull();
  });
});

describe('the search box', () => {
  const found = (name: string, p: LngLat, sub = ''): Place => ({ name, sub, lngLat: p });
  function engine(answers: Record<string, Place[] | Error>) {
    const calls: { q: string; near: LngLat | null }[] = [];
    const base: PlaceSearchEngine = {
      search: async (q, near) => {
        calls.push({ q, near });
        const a = answers[q];
        if (a instanceof Error) throw a;
        return a ?? [];
      },
      reverse: async () => null,
    };
    return { base, calls };
  }

  it('takes coordinates and full plus codes without asking anyone', async () => {
    const { base, calls } = engine({});
    const s = new SmartSearch(() => base);
    const [c] = await s.search(`3°08'20.4"N 101°41'12.8"E`, null, 'en');
    close(c.lngLat, KL, 5);
    expect(c.kind).toBe('coords');
    expect(c.name).toBe('3.13900, 101.68689');
    const [pc] = await s.search('7FG49QCJ+2V', null, 'en');
    close(pc.lngLat, [2.7821875, 20.3700625], 1);
    expect(calls).toEqual([]);
  });

  it('completes a short plus code from its town', async () => {
    const p: LngLat = [101.7123, 3.1578];
    const short = encodePlusCode(p).slice(4);
    const { base, calls } = engine({ 'Kuala Lumpur': [found('Kuala Lumpur', [101.6942, 3.1516])] });
    const s = new SmartSearch(() => base);
    const [r] = await s.search(`${short} Kuala Lumpur`, null, 'en');
    expect(haversine(r.lngLat, p)).toBeLessThan(10);
    expect(calls[0].q).toBe('Kuala Lumpur');
    // Without a town, from where you are; with neither, a hint.
    expect(haversine((await s.search(short, KL, 'en'))[0].lngLat, p)).toBeLessThan(10);
    const [hint] = await s.search(short, null, 'en');
    expect(Number.isNaN(hint.lngLat[0])).toBe(true);
  });

  it('opens Google Maps links, and short ones only where they can be followed', async () => {
    const { base } = engine({});
    const web = new SmartSearch(() => base, { resolveLink: null });
    const [n] = await web.search('Suria KLCC https://maps.app.goo.gl/AbCd', null, 'en');
    expect(n.kind).toBe('note');
    expect(Number.isNaN(n.lngLat[0])).toBe(true);
    const resolveLink = vi.fn(async () => 'https://www.google.com/maps/place/Suria+KLCC/data=!3d3.1578!4d101.7123');
    const app = new SmartSearch(() => base, { resolveLink });
    const [r] = await app.search('Suria KLCC https://maps.app.goo.gl/AbCd', null, 'en');
    expect(r.name).toBe('Suria KLCC');
    close(r.lngLat, [101.7123, 3.1578]);
    expect(resolveLink).toHaveBeenCalledWith('https://maps.app.goo.gl/AbCd');
    const failing = new SmartSearch(() => base, { resolveLink: async () => Promise.reject(new Error('offline')) });
    expect((await failing.search('https://maps.app.goo.gl/AbCd', null, 'en'))[0]).toMatchObject({ kind: 'note', sub: 'offline' });
    expect((await web.search('https://www.google.com/maps?cid=1', null, 'en'))[0].name).toBe('The link does not say where');
  });

  it('looks a named link up on the map it was shown on', async () => {
    const view: LngLat = [101.71, 3.15];
    const { base, calls } = engine({
      'nasi lemak': [found('Nasi Lemak Far Away', [100.3, 5.4]), found('Nasi Lemak Here', [101.712, 3.151])],
      'kedai x': [found('Kedai X Penang', [100.3, 5.4])],
    });
    const s = new SmartSearch(() => base);
    const r = await s.search('https://www.google.com/maps/search/nasi+lemak/@3.15,101.71,15z', null, 'en');
    expect(r.map((p) => p.name)).toEqual(['Nasi Lemak Here']);
    expect(calls[0].near).toEqual(view);
    // Not found on that map: the map itself, marked as approximate.
    const [a] = await s.search('https://www.google.com/maps/search/kedai+x/@3.15,101.71,15z', null, 'en');
    expect(a).toMatchObject({ name: 'kedai x', tag: APPROX, lngLat: view });
  });

  it('falls back to the street or area for an address it cannot find', async () => {
    const { base, calls } = engine({
      'Jalan SS 2/24, 47300 Petaling Jaya, Selangor': [],
      '12, Jalan SS 2/24, 47300 Petaling Jaya, Selangor': [],
      '47300 Petaling Jaya, Selangor': [found('47300 Petaling Jaya', [101.62, 3.11], 'Selangor')],
    });
    const area = vi.fn(async () => [{ by: 'street' as const, lon: 101.6156, lat: 3.1073, n: 4 }]);
    const s = new SmartSearch(() => base, { area });
    const r = await s.search('No 12, Jln SS2/24, 47300 PJ, Selangor', null, 'en');
    expect(calls.map((c) => c.q)).toEqual(['12, Jalan SS2/24, 47300 Petaling Jaya, Selangor', 'Jalan SS2/24, 47300 Petaling Jaya, Selangor', '47300 Petaling Jaya, Selangor']);
    expect(r.map((p) => p.tag)).toEqual([APPROX, APPROX]);
    expect(r[0].sub).toMatch(/^Approximate \(47300 Petaling Jaya, Selangor\)/);
    expect(r[1]).toMatchObject({ name: 'Jalan SS2/24, Petaling Jaya', lngLat: [101.6156, 3.1073] });
    expect(r[1].sub).toMatch(/middle of 4 places on this street/);
    expect(area).toHaveBeenCalledWith('Jalan SS2/24', '47300', 'Petaling Jaya');
  });

  it('keeps exact answers first and drops rough ones next to them', async () => {
    const exact = found('12 Jalan SS 2/24', [101.6156, 3.1073]);
    const { base } = engine({ '12 Jalan SS 2/24, 47300 Petaling Jaya': [exact] });
    const area = async () => [
      { by: 'street' as const, lon: 101.6157, lat: 3.1074, n: 4 },
      { by: 'postcode' as const, lon: 101.63, lat: 3.12, n: 300 },
    ];
    const r = await new SmartSearch(() => base, { area }).search('12 Jalan SS 2/24, 47300 Petaling Jaya', null, 'en');
    expect(r.map((p) => p.name)).toEqual(['12 Jalan SS 2/24', 'Postcode 47300 Petaling Jaya']);
  });

  it('answers from the places around you when the search service is down', async () => {
    const { base } = engine({ 'Jalan Alor': new Error('Search failed (503)') });
    const area = async () => [{ by: 'street' as const, lon: 101.708, lat: 3.145, n: 12 }];
    const r = await new SmartSearch(() => base, { area }).search('Jalan Alor', null, 'en');
    expect(r).toHaveLength(1);
    expect(r[0].tag).toBe(APPROX);
    await expect(new SmartSearch(() => base).search('Jalan Alor', null, 'en')).rejects.toThrow('503');
  });

  it('passes everything else straight on', async () => {
    const { base, calls } = engine({ KLCC: [found('Suria KLCC', [101.7123, 3.1578])] });
    expect((await new SmartSearch(() => base).search('  KLCC ', KL, 'en'))[0].name).toBe('Suria KLCC');
    expect(calls).toEqual([{ q: 'KLCC', near: KL }]);
  });
});
