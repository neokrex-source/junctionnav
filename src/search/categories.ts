/** Category search (petrol, EV charging, parking, food, rest areas, convenience stores) nearby or along the route. */
import { haversine, type LngLat } from '../geo/geo';
import { formatDistance, t, type LangCode, type UiKey, type Units } from '../routing/instructions';
import type { Route } from '../routing/types';
import type { Place } from './places';

export type CategoryId = 'fuel' | 'ev' | 'parking' | 'food' | 'rest' | 'store';

export interface Category {
  id: CategoryId;
  /** Overpass tag filter. */
  filter: string;
  label: UiKey;
  icon: string;
}

const svg = (body: string) => `<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;
const S = 'fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"';

export const CATEGORIES: Category[] = [
  {
    id: 'fuel',
    filter: '["amenity"="fuel"]',
    label: 'cat_fuel',
    icon: svg(`<path ${S} d="M4 21V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v16M3 21h12M6 9h6"/><path ${S} d="M14 10h2a2 2 0 0 1 2 2v4a1.5 1.5 0 0 0 3 0V8l-3-3"/>`),
  },
  {
    id: 'ev',
    filter: '["amenity"="charging_station"]',
    label: 'cat_ev',
    icon: svg(`<path fill="currentColor" d="M13 2 4 14h6l-1 8 9-12h-6z"/>`),
  },
  {
    id: 'parking',
    filter: '["amenity"="parking"]',
    label: 'cat_parking',
    icon: svg(`<rect ${S} x="3" y="3" width="18" height="18" rx="4"/><path ${S} d="M9.5 17V7h3.5a3 3 0 0 1 0 6H9.5"/>`),
  },
  {
    id: 'food',
    filter: '["amenity"~"^(restaurant|fast_food|cafe|food_court)$"]',
    label: 'cat_food',
    icon: svg(`<path ${S} d="M7 3v8M4.5 3v5a2.5 2.5 0 0 0 5 0V3M7 11v10M17 21V3c-2.5 1-3.5 4-3.5 7.5 0 2 1.5 3 3.5 3"/>`),
  },
  {
    id: 'rest',
    filter: '["highway"~"^(rest_area|services)$"]',
    label: 'cat_rest',
    icon: svg(`<path ${S} d="M4 9h12v5a5 5 0 0 1-5 5H9a5 5 0 0 1-5-5zM16 10h1.5a2.5 2.5 0 0 1 0 5H16M7 3c0 1.5 1 1.5 1 3M11 3c0 1.5 1 1.5 1 3"/>`),
  },
  {
    id: 'store',
    filter: '["shop"="convenience"]',
    label: 'cat_store',
    icon: svg(`<path ${S} d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8zM9 8V6a3 3 0 0 1 6 0v2"/>`),
  },
];

export interface RawPoi {
  id: string;
  lngLat: LngLat;
  tags: Record<string, string>;
}

export interface PoiProvider {
  /** POIs of a category within `radius` metres of the point (one point) or of the polyline (several points). */
  query(cat: Category, points: LngLat[], radius: number, signal?: AbortSignal): Promise<RawPoi[]>;
}

export class OverpassPoiProvider implements PoiProvider {
  constructor(private endpoints: () => string[]) {}

  async query(cat: Category, points: LngLat[], radius: number, signal?: AbortSignal): Promise<RawPoi[]> {
    const coords = points.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(',');
    const q = `[out:json][timeout:20];nwr(around:${Math.round(radius)},${coords})${cat.filter};out center tags 120;`;
    let last: unknown;
    for (const url of this.endpoints()) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
          signal,
        });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        const json = (await res.json()) as {
          elements: { type: string; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: Record<string, string> }[];
        };
        return json.elements
          .map((e) => {
            const lat = e.lat ?? e.center?.lat;
            const lon = e.lon ?? e.center?.lon;
            return lat == null || lon == null ? null : { id: `${e.type}/${e.id}`, lngLat: [lon, lat] as LngLat, tags: e.tags ?? {} };
          })
          .filter((x): x is RawPoi => !!x);
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error('Place search unavailable');
  }
}

export interface CategoryPlace extends Place {
  /** Along-route position for along-route results. */
  alongS?: number;
}

function toPlace(p: RawPoi, cat: Category, lang: LangCode): CategoryPlace {
  const tg = p.tags;
  const name = tg[`name:${lang}`] || tg.name || tg.brand || tg.operator || t(lang, cat.label);
  const sub = [tg.brand && tg.brand !== name ? tg.brand : '', tg['addr:street'], tg['addr:city'] || tg['addr:place']]
    .filter(Boolean)
    .join(', ');
  return { name, sub: sub || t(lang, cat.label), lngLat: p.lngLat, kind: cat.id, ...(tg._place ? { placeId: tg._place } : {}) };
}

export class CategorySearch {
  constructor(public provider: PoiProvider) {}

  async nearby(cat: Category, center: LngLat, lang: LangCode, units: Units, signal?: AbortSignal): Promise<CategoryPlace[]> {
    let raw = await this.provider.query(cat, [center], 2500, signal);
    if (raw.length < 3) raw = await this.provider.query(cat, [center], 8000, signal);
    return raw
      .map((p) => ({ p, d: haversine(center, p.lngLat) }))
      .sort((a, b) => a.d - b.d)
      .slice(0, 25)
      .map(({ p, d }) => ({ ...toPlace(p, cat, lang), note: formatDistance(d, units) }));
  }

  /** Results ahead on the route, ordered by how far along the route they are. */
  async alongRoute(cat: Category, route: Route, fromS: number, lang: LangCode, units: Units, signal?: AbortSignal): Promise<CategoryPlace[]> {
    const line = route.line;
    const end = Math.min(line.length, fromS + 60000);
    const span = Math.max(1, end - fromS);
    const step = Math.max(250, span / 90);
    const pts: LngLat[] = [];
    for (let s = fromS; s < end; s += step) pts.push(line.pointAt(s));
    pts.push(line.pointAt(end));
    const raw = await this.provider.query(cat, pts, 400, signal);
    const out: CategoryPlace[] = [];
    for (const p of raw) {
      const pr = line.project(p.lngLat, Math.max(0, fromS - 50), end + 500);
      // Results that come with their detour (TomTom) were picked for it: keep them a little further off.
      const reach = p.tags._detour != null ? 2500 : 450;
      if (pr.dist > reach || pr.s < fromS) continue;
      const pl = toPlace(p, cat, lang);
      out.push({
        ...pl,
        alongS: pr.s,
        note: t(lang, 'inDist', { d: formatDistance(pr.s - fromS, units) }),
        sub: [pl.sub, pr.dist > 60 ? t(lang, 'offRoute', { d: formatDistance(pr.dist, units) }) : ''].filter(Boolean).join(' · '),
      });
    }
    return out.sort((a, b) => (a.alongS ?? 0) - (b.alongS ?? 0)).slice(0, 25);
  }
}
