/**
 * Place search and the category buttons (petrol, EV charging, parking, food, rest areas,
 * convenience stores) on TomTom's Search service: typed search with the user's position as a
 * bias, addresses for a point on the map, places near a point, and places along the route with
 * how far off it they are.
 */
import type { LngLat } from '../geo/geo';
import type { Category, CategoryId, PoiProvider, RawPoi } from '../search/categories';
import { parseCoordinates, type Place, type PlaceSearchEngine } from '../search/places';
import { TomTomError, ttEither, TT_BASE, type Family } from './http';

export interface TtResult {
  type?: string;
  id?: string;
  dist?: number;
  poi?: { name?: string; categories?: string[]; brands?: { name: string }[]; phone?: string };
  address?: {
    freeformAddress?: string;
    streetName?: string;
    streetNumber?: string;
    municipality?: string;
    municipalitySubdivision?: string;
    countrySubdivision?: string;
    countrySubdivisionName?: string;
    country?: string;
    localName?: string;
  };
  position?: { lat: number; lon: number };
  entryPoints?: { type?: string; position: { lat: number; lon: number } }[];
  detourTime?: number;
  detourDistance?: number;
}

/** TomTom POI category numbers for the app's categories (both API families use them). */
export const TT_CATEGORY: Record<CategoryId, { set?: string; query: string }> = {
  fuel: { set: '7311', query: 'petrol station' },
  ev: { set: '7309', query: 'electric vehicle station' },
  parking: { set: '7369,7313', query: 'parking' },
  food: { set: '7315,9376', query: 'restaurant' },
  rest: { set: '7395', query: 'rest area' },
  // Convenience stores are a kind of shop with no number of their own: found by name.
  store: { query: 'convenience store' },
};

const cap = (s: string) => s.replace(/^./, (c) => c.toUpperCase());

/** Where to go for a result: its main entrance when TomTom knows it, else its position. */
export function resultPoint(r: TtResult): LngLat | null {
  const e = r.entryPoints?.find((p) => p.type === 'main') ?? r.entryPoints?.[0];
  const p = e?.position ?? r.position;
  return p && Number.isFinite(p.lat) && Number.isFinite(p.lon) ? [p.lon, p.lat] : null;
}

/** A search result in the app's shape: a name, a second line, a point. */
export function resultToPlace(r: TtResult): Place | null {
  const lngLat = resultPoint(r);
  if (!lngLat) return null;
  const a = r.address ?? {};
  const street = [a.streetName, a.streetNumber].filter(Boolean).join(' ');
  const area = a.municipalitySubdivision || a.municipality || a.localName || '';
  const region = a.countrySubdivisionName || a.countrySubdivision || '';
  if (r.poi?.name) {
    const kind = r.poi.categories?.[0] ? cap(r.poi.categories[0]) : '';
    const where = [street, area !== street ? area : '', region].filter(Boolean).filter((v, i, x) => x.indexOf(v) === i);
    return { name: r.poi.name, sub: [kind, where.slice(0, 2).join(', ')].filter(Boolean).join(' · ') || a.freeformAddress || '', lngLat };
  }
  const name = (r.type === 'Geography' ? area || a.freeformAddress : street || a.freeformAddress) || area || 'Unnamed place';
  const sub = [r.type === 'Geography' ? '' : area, region, a.country].filter(Boolean).filter((v) => v !== name).filter((v, i, x) => x.indexOf(v) === i).join(', ');
  return { name, sub, lngLat };
}

const llq = (p: LngLat) => ({ lat: p[1].toFixed(5), lon: p[0].toFixed(5) });

/** Search addresses for both families (the newer one wants an API version and a bias shape). */
function searchUrl(f: Family, path: string, key: string, params: Record<string, string>, near?: LngLat | null): string {
  const q = new URLSearchParams({ key, ...params });
  if (f === 'orbis') {
    q.set('apiVersion', '1');
    if (near) q.set('geobias', `point:${near[1].toFixed(5)},${near[0].toFixed(5)}`);
    return `${TT_BASE}/maps/orbis/places/${path}?${q.toString()}`;
  }
  if (near) {
    const { lat, lon } = llq(near);
    q.set('lat', lat);
    q.set('lon', lon);
  }
  return `${TT_BASE}/search/2/${path}?${q.toString()}`;
}

/** TomTom's search speaks Malay and English, not Japanese (an unknown language is refused). */
const langTag = (lang: string) => (lang === 'ms' ? 'ms-MY' : 'en-GB');

export class TomTomPlaceSearch implements PlaceSearchEngine {
  readonly name = 'TomTom';
  constructor(private key: () => string) {}

  private k(): string {
    const k = this.key().trim();
    if (!k) throw new TomTomError('No TomTom key.', 401);
    return k;
  }

  async search(q: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    const coord = parseCoordinates(q);
    if (coord) return [{ name: `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`, sub: 'Coordinates', lngLat: coord }];
    const key = this.k();
    const path = `search/${encodeURIComponent(q.trim())}.json`;
    const json = await ttEither<{ results?: TtResult[] }>(
      'search',
      (f) => searchUrl(f, path, key, { typeahead: 'true', limit: '8', language: langTag(lang) }, near),
      {},
      signal,
    );
    return (json.results ?? []).map(resultToPlace).filter((p): p is Place => !!p);
  }

  async reverse(p: LngLat, signal?: AbortSignal): Promise<Place | null> {
    const key = this.k();
    const json = await ttEither<{ addresses?: { address?: TtResult['address'] }[] }>(
      'search',
      (f) => searchUrl(f, `reverseGeocode/${p[1].toFixed(6)},${p[0].toFixed(6)}.json`, key, {}),
      {},
      signal,
    );
    const a = json.addresses?.[0]?.address;
    if (!a) return null;
    const name = [a.streetName, a.streetNumber].filter(Boolean).join(' ') || a.freeformAddress || a.municipality || 'Dropped pin';
    const sub = [a.municipalitySubdivision || a.municipality, a.countrySubdivisionName || a.countrySubdivision].filter(Boolean).filter((v) => v !== name).join(', ');
    return { name, sub, lngLat: p };
  }
}

/** A TomTom result in the shape the category search reads (OSM-like tags). */
function toRaw(r: TtResult): RawPoi | null {
  const lngLat = resultPoint(r);
  if (!lngLat) return null;
  const tags: Record<string, string> = {};
  if (r.poi?.name) tags.name = r.poi.name;
  const brand = r.poi?.brands?.[0]?.name;
  if (brand) tags.brand = brand;
  if (r.address?.streetName) tags['addr:street'] = r.address.streetName;
  const city = r.address?.municipalitySubdivision || r.address?.municipality;
  if (city) tags['addr:city'] = city;
  // Results along a route come with the detour they cost; the category search keeps them even
  // when they are a little further off the route than a plain radius would allow.
  if (r.detourTime != null) tags._detour = String(r.detourTime);
  return { id: `tomtom/${r.id ?? `${lngLat[0].toFixed(5)},${lngLat[1].toFixed(5)}`}`, lngLat, tags };
}

export class TomTomPoiProvider implements PoiProvider {
  readonly name = 'TomTom';
  constructor(
    private key: () => string,
    private lang: () => string = () => 'en',
  ) {}

  async query(cat: Category, points: LngLat[], radius: number, signal?: AbortSignal): Promise<RawPoi[]> {
    const key = this.key().trim();
    if (!key) throw new TomTomError('No TomTom key.', 401);
    const c = TT_CATEGORY[cat.id];
    const language = langTag(this.lang());
    let results: TtResult[];
    if (points.length === 1) {
      // Near a point: by category number where there is one, else by category name.
      const params: Record<string, string> = { radius: String(Math.round(radius)), limit: '50', language };
      const path = c.set ? 'nearbySearch/.json' : `categorySearch/${encodeURIComponent(c.query)}.json`;
      if (c.set) params.categorySet = c.set;
      const near = points[0];
      const json = await ttEither<{ results?: TtResult[] }>(
        'search',
        (f) => {
          const u = searchUrl(f, path, key, params, near);
          // Nearby search needs the point itself in both families.
          if (f === 'orbis' && c.set) {
            const { lat, lon } = llq(near);
            return `${u}&lat=${lat}&lon=${lon}`;
          }
          return u;
        },
        {},
        signal,
      );
      results = json.results ?? [];
    } else {
      // Along the route: places worth at most a five-minute detour.
      const params: Record<string, string> = { maxDetourTime: '300', limit: '20', language, spreadingMode: 'auto' };
      if (c.set) params.categorySet = c.set;
      const body = JSON.stringify({ route: { points: points.map((p) => ({ lat: +p[1].toFixed(6), lon: +p[0].toFixed(6) })) } });
      const json = await ttEither<{ results?: TtResult[] }>(
        'search',
        (f) => searchUrl(f, `searchAlongRoute/${encodeURIComponent(c.query)}.json`, key, params),
        { method: 'POST', headers: { 'Content-Type': 'application/json' }, body },
        signal,
      );
      results = json.results ?? [];
    }
    return results.map(toRaw).filter((x): x is RawPoi => !!x);
  }
}
