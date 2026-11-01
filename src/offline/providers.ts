/**
 * Online services with an offline fallback. In "auto" mode the online service is used and the
 * offline pack takes over when there is no connection; in "always" mode the pack is used first.
 */
import type { LngLat } from '../geo/geo';
import type { JunctionDataProvider, OsmData, OsmWay } from '../junction/osmdata';
import type { TunnelProvider } from '../nav/tunnels';
import { labelRoutes, normalizeOsrm, sameRoute } from '../routing/osrm';
import type { RouteRequest, RouteResult, Router } from '../routing/types';
import type { Category, PoiProvider, RawPoi } from '../search/categories';
import type { Place, PlaceSearchEngine } from '../search/places';
import type { OfflineClient } from './client';
import type { OfflinePlace } from './places';

export type OfflineUse = 'auto' | 'always';

export interface OfflineSwitch {
  /** The pack is installed and loaded. */
  available(): boolean;
  mode(): OfflineUse;
  client: OfflineClient;
}

export function isNetworkError(e: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const m = String((e as Error)?.message ?? e);
  // Also busy or broken servers (rate limits, 5xx): the offline maps can answer instead.
  return e instanceof TypeError || /Failed to fetch|NetworkError|Load failed|network|Overpass unavailable|timed? ?out|\((429|5\d\d)\)/i.test(m);
}

function useOfflineFirst(sw: OfflineSwitch): boolean {
  return sw.available() && (sw.mode() === 'always' || (typeof navigator !== 'undefined' && navigator.onLine === false));
}

/** OSRM-shaped routing on the offline graph. */
export class OfflineRouter implements Router {
  readonly name = 'Offline';
  constructor(private client: OfflineClient) {}

  async route(req: RouteRequest): Promise<RouteResult> {
    const coords = [req.origin, ...(req.via ?? []), req.destination];
    const bearings = [req.bearing ?? null, ...(req.via ?? []).map((_, i) => req.viaBearings?.[i] ?? null), null];
    const res = await this.client.route({ coords, bearings, avoid: { tolls: req.avoid?.tolls, motorways: req.avoid?.motorways } });
    if (res.code !== 'Ok') throw new Error(res.message ?? 'No route found in the offline data.');
    const routes = normalizeOsrm(res, 'Offline');
    const warnings: string[] = [];
    if (req.offerTollFree && !req.avoid?.tolls && routes[0]?.hasToll) {
      try {
        const alt = await this.client.route({ coords, bearings, avoid: { tolls: true, motorways: req.avoid?.motorways } });
        if (alt.code === 'Ok') {
          const r = normalizeOsrm(alt, 'Offline')[0];
          if (r && !sameRoute(r, routes[0])) routes.push(r);
        }
      } catch {
        /* the main route is enough */
      }
    }
    labelRoutes(routes);
    return { routes, warnings };
  }
}

export class HybridRouter implements Router {
  constructor(
    private online: () => Router,
    private sw: OfflineSwitch,
  ) {}
  get name() {
    return useOfflineFirst(this.sw) ? 'Offline' : this.online().name;
  }
  async route(req: RouteRequest, signal?: AbortSignal): Promise<RouteResult> {
    const off = new OfflineRouter(this.sw.client);
    if (useOfflineFirst(this.sw)) {
      try {
        return await off.route(req);
      } catch (e) {
        if (this.sw.mode() === 'always' && navigator.onLine) {
          const r = await this.online().route(req, signal);
          r.warnings.unshift(`Offline routing failed (${(e as Error).message}); used the online router.`);
          return r;
        }
        throw e;
      }
    }
    try {
      return await this.online().route(req, signal);
    } catch (e) {
      if (!this.sw.available() || !isNetworkError(e) || signal?.aborted) throw e;
      const r = await off.route(req);
      r.warnings.unshift('No internet connection: this route was planned with the offline maps.');
      return r;
    }
  }
}

function toPlace(p: OfflinePlace, lang: string): Place {
  const label = lang === 'en' && p.alt ? p.alt : p.name;
  return { name: label, sub: describeKind(p.kind), lngLat: p.lngLat };
}

/** Plain words for the OSM tag, for the second line of a search result. */
export function describeKind(kind: string): string {
  const [k, v = ''] = kind.split('=');
  const words: Record<string, string> = {
    fuel: 'Petrol station',
    charging_station: 'EV charging',
    parking: 'Parking',
    restaurant: 'Restaurant',
    fast_food: 'Fast food',
    cafe: 'Café',
    food_court: 'Food court',
    hospital: 'Hospital',
    clinic: 'Clinic',
    school: 'School',
    university: 'University',
    college: 'College',
    place_of_worship: 'Place of worship',
    mosque: 'Mosque',
    services: 'Rest area',
    rest_area: 'Rest area',
    motorway_junction: 'Interchange',
    toll_booth: 'Toll plaza',
    toll_gantry: 'Toll gantry',
    station: 'Station',
    aerodrome: 'Airport',
    mall: 'Shopping mall',
    supermarket: 'Supermarket',
    convenience: 'Convenience store',
    hotel: 'Hotel',
    attraction: 'Attraction',
    park: 'Park',
    city: 'City',
    town: 'Town',
    village: 'Village',
    suburb: 'Area',
    neighbourhood: 'Neighbourhood',
  };
  if (k === 'highway' && !words[v]) return 'Street';
  return (words[v] ?? v.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase())) + ' · offline';
}

export class HybridSearch implements PlaceSearchEngine {
  constructor(
    private online: () => PlaceSearchEngine,
    private sw: OfflineSwitch,
  ) {}
  private async offline(q: string, near: LngLat | null, lang: string): Promise<Place[]> {
    return (await this.sw.client.search(q, near, 10)).map((p) => toPlace(p, lang));
  }
  async search(q: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    if (useOfflineFirst(this.sw)) return this.offline(q, near, lang);
    try {
      return await this.online().search(q, near, lang, signal);
    } catch (e) {
      if (!this.sw.available() || !isNetworkError(e) || signal?.aborted) throw e;
      return this.offline(q, near, lang);
    }
  }
  async reverse(p: LngLat, signal?: AbortSignal): Promise<Place | null> {
    const off = async () => {
      const n = await this.sw.client.nearest(p);
      return n ? toPlace(n, 'en') : null;
    };
    if (useOfflineFirst(this.sw)) return off();
    try {
      return await this.online().reverse(p, signal);
    } catch (e) {
      if (!this.sw.available() || !isNetworkError(e)) throw e;
      return off();
    }
  }
}

export class HybridJunctionData implements JunctionDataProvider {
  constructor(
    private online: JunctionDataProvider,
    private sw: OfflineSwitch,
  ) {}
  get name() {
    return useOfflineFirst(this.sw) ? 'Offline' : this.online.name;
  }
  async fetch(points: LngLat[], signal?: AbortSignal): Promise<OsmData> {
    if (useOfflineFirst(this.sw)) return this.sw.client.junction(points);
    try {
      return await this.online.fetch(points, signal);
    } catch (e) {
      if (!this.sw.available() || signal?.aborted) throw e;
      return this.sw.client.junction(points);
    }
  }
}

export class HybridTunnels implements TunnelProvider {
  constructor(
    private online: () => TunnelProvider,
    private sw: OfflineSwitch,
  ) {}
  get name() {
    return 'Hybrid';
  }
  async fetch(path: LngLat[], signal?: AbortSignal): Promise<OsmWay[]> {
    if (useOfflineFirst(this.sw)) return this.sw.client.tunnels(path);
    try {
      return await this.online().fetch(path, signal);
    } catch (e) {
      if (!this.sw.available() || signal?.aborted) throw e;
      return this.sw.client.tunnels(path);
    }
  }
}

/** '["amenity"~"^(restaurant|cafe)$"]' -> ['amenity=restaurant', 'amenity=cafe'] */
export function kindsOf(filter: string): string[] {
  const out: string[] = [];
  for (const m of filter.matchAll(/\["([^"]+)"(=|~)"([^"]+)"\]/g)) {
    const [, k, op, v] = m;
    const vals = op === '=' ? [v] : v.replace(/^\^\(?|\)?\$$/g, '').split('|');
    for (const x of vals) out.push(`${k}=${x}`);
  }
  return out;
}

export class HybridPois implements PoiProvider {
  constructor(
    private online: PoiProvider,
    private sw: OfflineSwitch,
  ) {}
  private async offline(cat: Category, points: LngLat[], radius: number): Promise<RawPoi[]> {
    const list = await this.sw.client.pois(kindsOf(cat.filter), points, radius);
    return list.map((p, i) => {
      const [k, v] = p.kind.split('=');
      return { id: `offline/${i}/${p.lngLat.join(',')}`, lngLat: p.lngLat, tags: { name: p.name, ...(p.alt ? { 'name:en': p.alt } : {}), [k]: v } };
    });
  }
  async query(cat: Category, points: LngLat[], radius: number, signal?: AbortSignal): Promise<RawPoi[]> {
    if (useOfflineFirst(this.sw)) return this.offline(cat, points, radius);
    try {
      return await this.online.query(cat, points, radius, signal);
    } catch (e) {
      if (!this.sw.available() || signal?.aborted) throw e;
      return this.offline(cat, points, radius);
    }
  }
}
