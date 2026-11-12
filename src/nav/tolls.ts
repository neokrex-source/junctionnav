/**
 * Toll plazas on the route, for the voice reminder to get the toll card ready (Touch 'n Go in
 * Malaysia, ETC in Japan). They come from the router when it reports toll gates (TomTom can) and
 * from OpenStreetMap: toll booths (barrier=toll_booth, a node per plaza or per lane, sometimes a
 * line across the lanes), found along the route one Overpass query per 20 km ahead (or in the
 * offline maps), placed on the route and grouped into one plaza each.
 */
import { haversine, type LngLat } from '../geo/geo';
import type { Route } from '../routing/types';
import { simplifyPath } from './tunnels';

/** A toll booth from OSM. */
export interface TollPoint {
  id: string;
  at: LngLat;
  name?: string;
}

/** A toll plaza on the route. */
export interface TollPlaza {
  id: string;
  /** Where it is along the route (metres): its first booth. */
  s: number;
  at: LngLat;
  name: string | null;
}

/** The next plaza ahead, and how far it is. */
export interface TollState {
  plaza: TollPlaza;
  dist: number;
}

export interface TollProvider {
  fetch(path: LngLat[], signal?: AbortSignal): Promise<TollPoint[]>;
}

/** Booths further than this from the route line are on another road (or the far side of a wide plaza). */
const ON_ROUTE = 35;
/** Booths this close along the route are one plaza (several lanes, both directions). */
export const SAME_PLAZA = 300;

/** How the toll is paid where the plaza is, for what the reminder asks to have ready. */
export type TollPay = 'tng' | 'etc' | 'generic' | 'none';

/** The Johor Strait, west to east (longitude, latitude): Singapore lies south of it. */
const JOHOR_STRAIT: LngLat[] = [
  [103.55, 1.33],
  [103.635, 1.36],
  [103.7, 1.43],
  [103.77, 1.452],
  [103.83, 1.462],
  [103.87, 1.45],
  [103.95, 1.43],
  [104.05, 1.41],
  [104.15, 1.4],
];

function straitLat(lon: number): number {
  const s = JOHOR_STRAIT;
  for (let i = 1; i < s.length; i++) {
    if (lon <= s[i][0]) return s[i - 1][1] + ((s[i][1] - s[i - 1][1]) * (lon - s[i - 1][0])) / (s[i][0] - s[i - 1][0]);
  }
  return s[s.length - 1][1];
}

/** The country a point is in, roughly, for the few things that differ by country. */
export type Region = 'MY' | 'SG' | 'JP' | 'other';

/**
 * Malaysia (a line down the Strait of Malacca keeps Sumatra out, the Johor Strait keeps
 * Singapore out, Brunei is cut out of Borneo), Singapore, Japan (Korea, which shares its box,
 * is cut out), or elsewhere.
 */
export function regionAt(p: LngLat): Region {
  const [lon, lat] = p;
  const inBox = (w: number, s: number, e: number, n: number) => lon >= w && lon <= e && lat >= s && lat <= n;
  if (inBox(103.55, 1.15, 104.15, 1.48) && lat < straitLat(lon)) return 'SG';
  const peninsula = inBox(99.6, 1.2, 104.6, 6.75) && lon > 100.1 + (5 - lat) * 0.5;
  const borneo = inBox(109.5, 0.85, 119.3, 7.4) && !inBox(114.0, 4.0, 115.4, 5.1);
  if (peninsula || borneo) return 'MY';
  const korea = lon < 129.6 && lat > 33 && lat < 38.7 && lon > 124 && !(lon > 128.5 && lat < 34.75);
  if (inBox(122.9, 24, 146.0, 45.6) && !korea) return 'JP';
  return 'other';
}

/**
 * Touch 'n Go across Malaysia, ETC in Japan, nothing to get ready in Singapore (its road pricing
 * is automatic), a plain reminder elsewhere.
 */
export function tollPayment(p: LngLat): TollPay {
  const r = regionAt(p);
  return r === 'MY' ? 'tng' : r === 'JP' ? 'etc' : r === 'SG' ? 'none' : 'generic';
}

/**
 * The stretch of route a 20 km lookup covers, simplified for the Overpass query (the toll and
 * speed lookups share it, so one query answers both).
 */
export function chunkPath(route: Route, s0: number, s1: number): LngLat[] {
  return simplifyPath(route.line.slice(Math.max(0, s0 - 50), s1 + 50), 6).slice(0, 600);
}

export function buildTollQuery(path: LngLat[], radius = ON_ROUTE): string {
  const coords = path.map((p) => `${p[1].toFixed(5)},${p[0].toFixed(5)}`).join(',');
  return `[out:json][timeout:25];(node(around:${radius},${coords})["barrier"="toll_booth"];way(around:${radius},${coords})["barrier"="toll_booth"];);out center tags;`;
}

type OverpassElement = {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  geometry?: ({ lat: number; lon: number } | null)[];
  tags?: Record<string, string>;
};

/** The toll booths in an Overpass answer (only them: the answer may hold the speed lookup too). */
export function parseTollAnswer(json: { elements?: OverpassElement[] }): TollPoint[] {
  const out: TollPoint[] = [];
  for (const e of json.elements ?? []) {
    if (e.tags?.barrier !== 'toll_booth') continue;
    const pts = (e.geometry ?? []).filter((g): g is { lat: number; lon: number } => !!g);
    const mid = pts.length ? { lat: pts.reduce((a, g) => a + g.lat, 0) / pts.length, lon: pts.reduce((a, g) => a + g.lon, 0) / pts.length } : undefined;
    const lat = e.lat ?? e.center?.lat ?? mid?.lat;
    const lon = e.lon ?? e.center?.lon ?? mid?.lon;
    if (lat == null || lon == null) continue;
    const name = e.tags?.name || e.tags?.['name:en'];
    out.push({ id: `${e.type}/${e.id}`, at: [lon, lat], ...(name ? { name } : {}) });
  }
  return out;
}

export class OverpassTollProvider implements TollProvider {
  readonly name = 'Overpass';
  constructor(private endpoints: () => string[]) {}

  async fetch(path: LngLat[], signal?: AbortSignal): Promise<TollPoint[]> {
    const query = buildTollQuery(path);
    let lastErr: unknown;
    for (const url of this.endpoints()) {
      try {
        const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(query), signal });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        return parseTollAnswer(await res.json());
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        lastErr = e;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('Overpass unavailable');
  }
}

/** Points every `step` metres along a path (the offline index measures to points, not lines). */
export function densifyPath(pts: LngLat[], step: number): LngLat[] {
  if (pts.length < 2) return pts.slice();
  const out: LngLat[] = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1];
    const b = pts[i];
    const n = Math.ceil(haversine(a, b) / step);
    for (let k = 1; k <= n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  return out;
}

const SAYS_TOLL = /\b(tol|toll|plaza)\b|料金/i;

/** Plazas sorted along the route, with points of one plaza (within 300 m) folded into the first. */
function fold(list: TollPlaza[]): TollPlaza[] {
  const out: TollPlaza[] = [];
  for (const p of [...list].sort((a, b) => a.s - b.s)) {
    const last = out[out.length - 1];
    if (last && p.s - last.s < SAME_PLAZA) {
      // The same plaza: keep where it starts, and a name (one that says it is a toll plaza first).
      if (p.name && (!last.name || (SAYS_TOLL.test(p.name) && !SAYS_TOLL.test(last.name)))) out[out.length - 1] = { ...last, name: p.name };
      continue;
    }
    out.push({ ...p });
  }
  return out;
}

/** Toll points placed on the route within [s0, s1], grouped into plazas, in route order. */
export function matchTolls(route: Route, points: TollPoint[], [s0, s1]: [number, number]): TollPlaza[] {
  const line = route.line;
  const on: TollPlaza[] = [];
  for (const p of points) {
    const pr = line.project(p.at, Math.max(0, s0 - 100), s1 + 100);
    if (pr.dist > ON_ROUTE || pr.s < s0 - 1 || pr.s > s1 + 1) continue;
    on.push({ id: `toll:${Math.round(pr.s)}`, s: pr.s, at: pr.point, name: p.name ?? null });
  }
  return fold(on);
}

/** The toll gates the router reported, as plazas. */
export function tollsFromRoute(route: Route): TollPlaza[] {
  return fold((route.tollGates ?? []).map((g) => ({ id: `toll:${Math.round(g.s)}`, s: g.s, at: g.at, name: g.name ?? null })));
}

/** One list from several sources: plazas within 300 m of each other are the same one. */
export function mergeTolls(...sets: TollPlaza[][]): TollPlaza[] {
  return fold(sets.flat());
}

/** The next plaza from `s` (just passed counts for a few metres), within `reach` metres. */
export function tollAhead(plazas: TollPlaza[], s: number, reach: number): TollState | null {
  for (const p of plazas) {
    const d = p.s - s;
    if (d < -15) continue;
    return d <= reach ? { plaza: p, dist: Math.max(0, d) } : null;
  }
  return null;
}

/**
 * Loads the toll plazas for a route a little ahead of the driver, one query per ~20 km, the
 * way the tunnel detail is loaded, on top of the gates the router reported.
 */
export class TollLoader {
  static readonly CHUNK = 20000;
  private route: Route | null = null;
  private base: TollPlaza[] = [];
  private osm: TollPlaza[] = [];
  private chunks = new Map<number, 'loading' | 'done' | number>();
  private ctrl: AbortController | null = null;

  constructor(
    public provider: TollProvider | null,
    private onChange: (plazas: TollPlaza[]) => void,
  ) {}

  get plazas(): TollPlaza[] {
    return mergeTolls(this.osm, this.base);
  }

  setRoute(route: Route) {
    this.ctrl?.abort();
    this.ctrl = new AbortController();
    this.route = route;
    this.base = tollsFromRoute(route);
    this.osm = [];
    this.chunks.clear();
    this.onChange(this.plazas);
  }

  /** Make sure the chunk at s and the next one are loaded (or loading). */
  ensure(s: number) {
    const route = this.route;
    if (!route || !this.provider) return;
    const i0 = Math.floor(s / TollLoader.CHUNK);
    for (const i of [i0, i0 + 1]) {
      const s0 = i * TollLoader.CHUNK;
      if (s0 > route.line.length) continue;
      const st = this.chunks.get(i);
      if (st === 'loading' || st === 'done' || (typeof st === 'number' && Date.now() - st < 60_000)) continue;
      this.chunks.set(i, 'loading');
      const s1 = Math.min(route.line.length, s0 + TollLoader.CHUNK);
      const path = chunkPath(route, s0, s1);
      const signal = this.ctrl?.signal;
      this.provider
        .fetch(path, signal)
        .then((points) => {
          if (this.route !== route) return;
          this.osm = mergeTolls(this.osm, matchTolls(route, points, [s0, s1]));
          this.chunks.set(i, 'done');
          this.onChange(this.plazas);
        })
        .catch((e) => {
          if ((e as Error).name === 'AbortError') return;
          console.warn('[tolls] lookup failed', (e as Error).message);
          this.chunks.set(i, Date.now());
        });
    }
  }

  stop() {
    this.ctrl?.abort();
    this.route = null;
  }
}
