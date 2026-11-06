/**
 * Live traffic from TomTom (https://developer.tomtom.com), with the user's own API key from
 * Settings. The free tier (no card) covers 2,500 incident requests, 200,000 traffic tiles and
 * 20,000 routing requests a month, plenty for one driver: incidents along the road ahead every
 * few minutes, the traffic layer on the map, and travel times with traffic.
 *
 * Incidents use the current (Orbis) Traffic API; if a key is not set up for it, the long-standing
 * v5 incident details service answers instead. All calls are plain GETs or a JSON POST with the
 * key in the query string, which TomTom serves to browsers (CORS).
 */
import type { LngLat } from '../geo/geo';
import type { Incident, IncidentKind, Magnitude } from './types';

const BASE = 'https://api.tomtom.com';

/** v5 numeric icon categories, for the older service. */
const NUMERIC: Record<number, string> = {
  0: 'unknown',
  1: 'accident',
  2: 'fog',
  3: 'dangerousConditions',
  4: 'rain',
  5: 'ice',
  6: 'jam',
  7: 'laneClosed',
  8: 'roadClosed',
  9: 'roadWorks',
  10: 'wind',
  11: 'flooding',
  14: 'brokenDownVehicle',
};

export function kindOf(cat: string | number | undefined): IncidentKind {
  const c = typeof cat === 'number' ? NUMERIC[cat] ?? 'unknown' : (cat ?? 'unknown');
  switch (c) {
    case 'accident':
      return 'accident';
    case 'jam':
      return 'jam';
    case 'roadClosed':
      return 'closure';
    case 'laneClosed':
      return 'laneClosed';
    case 'roadWorks':
      return 'roadworks';
    case 'flooding':
      return 'flooding';
    case 'fog':
    case 'rain':
    case 'ice':
    case 'wind':
      return 'weather';
    case 'dangerousConditions':
      return 'hazard';
    case 'brokenDownVehicle':
      return 'breakdown';
    default:
      return 'other';
  }
}

const MAGNITUDES: Magnitude[] = ['unknown', 'minor', 'moderate', 'major', 'undefined'];

interface RawIncident {
  type?: string;
  geometry?: { type: string; coordinates: LngLat | LngLat[] };
  properties?: {
    id?: string;
    iconCategory?: string | number;
    magnitudeOfDelay?: string | number;
    events?: { description?: string; code?: number; iconCategory?: string | number }[];
    from?: string;
    to?: string;
    lengthInMeters?: number;
    length?: number;
    delayInSeconds?: number;
    delay?: number;
    roadNumbers?: string[];
  };
}

/** Either service's incident, in the app's shape. */
export function normalizeIncident(r: RawIncident): Incident | null {
  const g = r.geometry;
  const p = r.properties ?? {};
  if (!g || !p.id) return null;
  const geometry: LngLat[] = g.type === 'Point' ? [g.coordinates as LngLat] : (g.coordinates as LngLat[]);
  if (!geometry.length) return null;
  const mag = typeof p.magnitudeOfDelay === 'number' ? MAGNITUDES[p.magnitudeOfDelay] ?? 'unknown' : ((p.magnitudeOfDelay as Magnitude) ?? 'unknown');
  return {
    id: p.id,
    kind: kindOf(p.iconCategory),
    magnitude: mag,
    delay: Math.max(0, p.delayInSeconds ?? p.delay ?? 0),
    length: Math.max(0, p.lengthInMeters ?? p.length ?? 0),
    description: (p.events ?? []).map((e) => e.description).filter(Boolean).join(', ') || '',
    from: p.from || undefined,
    to: p.to || undefined,
    roads: p.roadNumbers ?? [],
    geometry,
  };
}

export type Bbox = [number, number, number, number];

/** Area of a lon/lat box in km² (TomTom allows up to 10,000 km² per incident request). */
export function bboxArea([w, s, e, n]: Bbox): number {
  const kmLat = 111.32;
  const kmLon = 111.32 * Math.cos((((s + n) / 2) * Math.PI) / 180);
  return Math.abs(e - w) * kmLon * Math.abs(n - s) * kmLat;
}

export class TomTomTraffic {
  /** The Orbis service refused this key: use the older one from now on. */
  private legacy = false;

  constructor(
    private key: () => string,
    private lang: () => string = () => 'en-GB',
  ) {}

  get enabled(): boolean {
    return !!this.key().trim();
  }

  /** Incidents happening now inside a box (minLon, minLat, maxLon, maxLat). */
  async incidents(bbox: Bbox, signal?: AbortSignal): Promise<Incident[]> {
    const key = encodeURIComponent(this.key().trim());
    const box = bbox.map((v) => v.toFixed(5)).join(',');
    const lang = encodeURIComponent(this.lang());
    if (!this.legacy) {
      // Descriptions come in the browser's language (Accept-Language), English by default.
      const res = await fetch(`${BASE}/maps/orbis/traffic/incidents/details?apiVersion=2&key=${key}&bbox=${box}&timeValidity=present`, { signal });
      if (res.ok) return ((await res.json()) as { incidents?: RawIncident[] }).incidents?.map(normalizeIncident).filter((i): i is Incident => !!i) ?? [];
      if (res.status !== 400 && res.status !== 403 && res.status !== 404) throw new Error(`Traffic incidents failed (${res.status}).`);
      this.legacy = true;
    }
    const fields = '{incidents{type,geometry{type,coordinates},properties{id,iconCategory,magnitudeOfDelay,events{description,code,iconCategory},from,to,length,delay,roadNumbers}}}';
    const res = await fetch(
      `${BASE}/traffic/services/5/incidentDetails?key=${key}&bbox=${box}&fields=${encodeURIComponent(fields)}&language=${lang}&timeValidityFilter=present`,
      { signal },
    );
    if (!res.ok) throw new Error(res.status === 403 ? 'The TomTom key was refused. Check it in Settings.' : `Traffic incidents failed (${res.status}).`);
    return ((await res.json()) as { incidents?: RawIncident[] }).incidents?.map(normalizeIncident).filter((i): i is Incident => !!i) ?? [];
  }

  /**
   * Travel time with live traffic along a given path (the rest of the route): TomTom routes
   * through the points as supporting points, so the time is for this route, not its own choice.
   */
  async travelTime(points: LngLat[], signal?: AbortSignal): Promise<{ travelTime: number; delay: number }> {
    if (points.length < 2) throw new Error('Not enough points');
    const key = encodeURIComponent(this.key().trim());
    const a = points[0];
    const b = points[points.length - 1];
    const url =
      `${BASE}/routing/1/calculateRoute/${a[1].toFixed(6)},${a[0].toFixed(6)}:${b[1].toFixed(6)},${b[0].toFixed(6)}/json` +
      `?key=${key}&traffic=true&travelMode=car&routeType=fastest&routeRepresentation=summaryOnly&computeTravelTimeFor=all`;
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ supportingPoints: points.map((p) => ({ latitude: +p[1].toFixed(6), longitude: +p[0].toFixed(6) })) }),
      signal,
    });
    if (!res.ok) throw new Error(`Traffic travel time failed (${res.status}).`);
    const s = ((await res.json()) as { routes?: { summary: { travelTimeInSeconds: number; trafficDelayInSeconds?: number } }[] }).routes?.[0]?.summary;
    if (!s) throw new Error('No travel time in the answer');
    return { travelTime: s.travelTimeInSeconds, delay: Math.max(0, s.trafficDelayInSeconds ?? 0) };
  }

  /**
   * The traffic layer for the map: only roads slower than usual are coloured (orange, red, dark
   * red), the rest stays clear. `orbis` is the current service's tiles, for keys the older
   * tiles refuse (those colour free-flowing roads too, in green).
   */
  flowTiles(variant: 'classic' | 'orbis', night: boolean): string {
    const key = encodeURIComponent(this.key().trim());
    return variant === 'classic'
      ? `${BASE}/traffic/map/4/tile/flow/relative-delay/{z}/{x}/{y}.png?key=${key}&tileSize=256&thickness=6`
      : `${BASE}/maps/orbis/traffic/flow/raster/tile/{z}/{x}/{y}?apiVersion=2&key=${key}&style=${night ? 'dark' : 'light'}&tileSize=256`;
  }
}
