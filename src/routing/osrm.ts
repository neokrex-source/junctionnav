import { Polyline, type LngLat } from '../geo/geo';
import type { Avoid, Intersection, Lane, Leg, Route, RouteRequest, RouteResult, Router, Step } from './types';

/* Minimal shapes of the OSRM v5 route response we rely on. */
export interface OsrmLane {
  indications: string[];
  valid: boolean;
}
export interface OsrmIntersection {
  location: LngLat;
  bearings: number[];
  entry: boolean[];
  in?: number;
  out?: number;
  lanes?: OsrmLane[];
  classes?: string[];
}
export interface OsrmStep {
  distance: number;
  duration: number;
  name: string;
  ref?: string;
  destinations?: string;
  exits?: string;
  rotary_name?: string;
  mode: string;
  driving_side?: 'left' | 'right';
  maneuver: {
    type: string;
    modifier?: string;
    location: LngLat;
    bearing_before: number;
    bearing_after: number;
    exit?: number;
  };
  intersections: OsrmIntersection[];
}
export interface OsrmRoute {
  distance: number;
  duration: number;
  geometry: { type: 'LineString'; coordinates: LngLat[] };
  legs: { steps: OsrmStep[]; summary: string; distance: number; duration: number }[];
}
export interface OsrmResponse {
  code: string;
  message?: string;
  routes?: OsrmRoute[];
}

/** OSRM exclude class for each avoid option (names from OSRM's car profile). */
const EXCLUDE: Record<keyof Avoid, string> = { tolls: 'toll', motorways: 'motorway', ferries: 'ferry' };
const AVOID_ORDER: (keyof Avoid)[] = ['tolls', 'motorways', 'ferries'];
const AVOID_NAME: Record<keyof Avoid, string> = { tolls: 'toll roads', motorways: 'highways', ferries: 'ferries' };

export function avoidList(a?: Partial<Avoid>): (keyof Avoid)[] {
  return AVOID_ORDER.filter((k) => a?.[k]);
}

type Fetched = Route[] | 'unsupported' | 'noroute';

export class OsrmRouter implements Router {
  readonly name = 'OSRM';
  /** Exclude combinations this server rejected, so we do not ask again. */
  private unsupported = new Set<string>();

  /**
   * @param baseUrl e.g. https://routing.openstreetmap.de/routed-car/route/v1/driving
   *                or  https://router.project-osrm.org/route/v1/driving
   *                or  your own server http://localhost:5000/route/v1/driving
   */
  constructor(private baseUrl: string) {}

  buildUrl(req: RouteRequest, exclude: (keyof Avoid)[], alternatives = !!req.alternatives): string {
    const pts = [req.origin, ...(req.via ?? []), req.destination];
    const coords = pts.map((c) => `${c[0].toFixed(6)},${c[1].toFixed(6)}`).join(';');
    const params = new URLSearchParams({
      overview: 'full',
      geometries: 'geojson',
      steps: 'true',
      // OSRM only returns alternatives for two-point requests.
      alternatives: alternatives && pts.length === 2 ? '2' : 'false',
      continue_straight: 'default',
    });
    const ok = (b: number | null | undefined): b is number => b != null && Number.isFinite(b);
    const viaB = (req.via ?? []).map((_, i) => req.viaBearings?.[i]);
    if (ok(req.bearing) || viaB.some(ok)) {
      const b = (v: number | null | undefined, range: number) => (ok(v) ? `${((Math.round(v) % 360) + 360) % 360},${range}` : '');
      params.set('bearings', [b(req.bearing, 60), ...viaB.map((v) => b(v, 60)), ''].join(';'));
      if (ok(req.bearing)) params.set('radiuses', '40' + ';'.repeat(pts.length - 1));
    }
    if (exclude.length) params.set('exclude', exclude.map((k) => EXCLUDE[k]).join(','));
    return `${this.baseUrl.replace(/\/$/, '')}/${coords}?${params.toString()}`;
  }

  private async fetchRoutes(req: RouteRequest, exclude: (keyof Avoid)[], alternatives: boolean, signal?: AbortSignal): Promise<Fetched> {
    const key = exclude.join(',');
    if (exclude.length && this.unsupported.has(key)) return 'unsupported';
    const res = await fetch(this.buildUrl(req, exclude, alternatives), { signal });
    const text = await res.text();
    let json: OsrmResponse | null = null;
    try {
      json = JSON.parse(text) as OsrmResponse;
    } catch {
      /* not JSON */
    }
    if (!res.ok || json?.code !== 'Ok') {
      if (json?.code === 'NoRoute') return 'noroute';
      if (exclude.length && (res.status === 400 || /exclude/i.test(json?.message ?? text))) {
        this.unsupported.add(key);
        return 'unsupported';
      }
      throw new Error(json?.message ? `Routing failed: ${json.message}` : `Routing failed (${res.status}).`);
    }
    return normalizeOsrm(json, this.name);
  }

  async route(req: RouteRequest, signal?: AbortSignal): Promise<RouteResult> {
    const wanted = avoidList(req.avoid);
    const warnings: string[] = [];
    // Ask for a toll-free variant in parallel when tolls are allowed, so it can be offered.
    const tollFreeReq =
      req.offerTollFree && !wanted.includes('tolls')
        ? this.fetchRoutes(req, ['tolls', ...wanted], false, signal).catch(() => 'unsupported' as const)
        : null;

    let applied = wanted;
    let got = await this.fetchRoutes(req, wanted, true, signal);
    if (got === 'unsupported' && wanted.length > 1) {
      // Server cannot combine exclusions: keep the most important one it accepts.
      for (const k of wanted) {
        const single = await this.fetchRoutes(req, [k], true, signal);
        if (Array.isArray(single)) {
          got = single;
          applied = [k];
          break;
        }
      }
    }
    if ((got === 'unsupported' || got === 'noroute') && !wanted.length) throw new Error('No route found between these places.');
    if (got === 'unsupported' || got === 'noroute') {
      const missing = wanted.map((k) => AVOID_NAME[k]).join(' and ');
      warnings.push(
        got === 'noroute'
          ? `No route avoids ${missing}. Showing routes that use them.`
          : `This routing server can't avoid ${missing}. Routes that use them are marked.`,
      );
      applied = [];
      const plain = await this.fetchRoutes(req, [], true, signal);
      if (!Array.isArray(plain)) throw new Error('No route found between these places.');
      got = plain;
    } else if (applied.length < wanted.length) {
      const missing = wanted.filter((k) => !applied.includes(k)).map((k) => AVOID_NAME[k]).join(' and ');
      warnings.push(`This routing server can't also avoid ${missing}.`);
    }
    let routes = got;
    for (const r of routes) r.avoidApplied = applied;
    // When the server could not exclude, put routes that honour the wish first.
    if (wanted.length && applied.length < wanted.length) {
      const ok = (r: Route) => (!wanted.includes('tolls') || !r.hasToll) && (!wanted.includes('motorways') || !r.hasMotorway) && (!wanted.includes('ferries') || !r.hasFerry);
      routes = [...routes.filter(ok), ...routes.filter((r) => !ok(r))];
    }
    if (tollFreeReq) {
      const tf = await tollFreeReq;
      if (Array.isArray(tf) && tf[0] && !tf[0].hasToll && routes.every((r) => r.hasToll) && !routes.some((r) => sameRoute(r, tf[0]))) {
        tf[0].avoidApplied = ['tolls', ...applied];
        routes.push(tf[0]);
      }
    }
    labelRoutes(routes);
    return { routes, warnings };
  }
}

/** Two routes are the same if most of one lies on the other. */
export function sameRoute(a: Route, b: Route): boolean {
  if (Math.abs(a.distance - b.distance) > Math.max(a.distance, b.distance) * 0.03) return false;
  let on = 0;
  const n = 24;
  for (let i = 1; i < n; i++) {
    const p = b.line.pointAt((b.line.length * i) / n);
    if (a.line.project(p).dist < 30) on++;
  }
  return on >= n - 3;
}

export function labelRoutes(routes: Route[]) {
  if (!routes.length) return;
  const fastest = routes.reduce((m, r) => (r.duration < m.duration ? r : m), routes[0]);
  const shortest = routes.reduce((m, r) => (r.distance < m.distance ? r : m), routes[0]);
  const anyToll = routes.some((r) => r.hasToll);
  for (const r of routes) {
    if (r === fastest) r.label = 'fastest';
    else if (anyToll && !r.hasToll) r.label = 'tollFree';
    else if (r === shortest && r.distance < fastest.distance * 0.95) r.label = 'shortest';
    else r.label = 'alternative';
  }
  // Fastest first, then the rest in their original order.
  routes.sort((a, b) => (a === fastest ? -1 : b === fastest ? 1 : 0));
}

let routeSeq = 0;

export function normalizeOsrm(json: OsrmResponse, provider: string): Route[] {
  if (json.code !== 'Ok' || !json.routes?.length) {
    throw new Error(json.message || `No route found (${json.code})`);
  }
  return json.routes.map((r) => {
    const geometry = r.geometry.coordinates;
    const line = new Polyline(geometry);
    const steps: Step[] = [];
    const legs: Leg[] = [];
    let hasToll = false;
    let hasMotorway = false;
    let hasFerry = false;
    let sPrev = 0;
    let prevDist = 0;
    const classRuns: { s: number; classes: string[] }[] = [];
    r.legs.forEach((leg, li) => {
      const isLast = li === r.legs.length - 1;
      for (const st of leg.steps) {
        if (st.maneuver.type === 'depart' && steps.length > 0) continue; // depart of a later leg
        const intersections: Intersection[] = (st.intersections || []).map((ix) => {
          if (ix.classes?.includes('toll')) hasToll = true;
          if (ix.classes?.includes('motorway')) hasMotorway = true;
          if (ix.classes?.includes('ferry')) hasFerry = true;
          return {
            location: ix.location,
            bearings: ix.bearings,
            entry: ix.entry,
            in: ix.in,
            out: ix.out,
            lanes: ix.lanes?.map((l): Lane => ({ indications: l.indications, valid: l.valid })),
            classes: ix.classes,
          };
        });
        if (st.mode === 'ferry') hasFerry = true;
        // Locate the maneuver on the route line, searching forward from the previous one.
        const proj = line.project(st.maneuver.location, Math.max(0, sPrev - 5), sPrev + prevDist + 80);
        const s = steps.length === 0 ? 0 : proj.dist < 30 ? proj.s : sPrev + prevDist;
        const step: Step = {
          index: steps.length,
          type: st.maneuver.type as Step['type'],
          modifier: st.maneuver.modifier as Step['modifier'],
          location: st.maneuver.location,
          bearingBefore: st.maneuver.bearing_before,
          bearingAfter: st.maneuver.bearing_after,
          exit: st.maneuver.exit,
          name: st.name || '',
          ref: st.ref,
          destinations: st.destinations,
          exits: st.exits,
          rotaryName: st.rotary_name,
          drivingSide: st.driving_side || 'right',
          distance: st.distance,
          duration: st.duration,
          intersections,
          s: Math.min(s, line.length),
        };
        if (step.type === 'arrive' && !isLast) step.waypoint = li + 1;
        steps.push(step);
        // Where each intersection's road classes start along the route.
        let sIx = step.s;
        intersections.forEach((ix, k) => {
          if (k > 0) {
            const p = line.project(ix.location, sIx - 2, step.s + st.distance + 30);
            if (p.dist < 25) sIx = p.s;
          }
          classRuns.push({ s: sIx, classes: st.mode === 'ferry' ? [...(ix.classes ?? []), 'ferry'] : ix.classes ?? [] });
        });
        if (!intersections.length) classRuns.push({ s: step.s, classes: st.mode === 'ferry' ? ['ferry'] : [] });
        sPrev = step.s;
        prevDist = st.distance;
        if (step.type === 'arrive') legs.push({ distance: leg.distance, duration: leg.duration, endS: step.s });
      }
    });
    if (steps.length && steps[steps.length - 1].type === 'arrive') {
      steps[steps.length - 1].s = line.length;
      if (legs.length) legs[legs.length - 1].endS = line.length;
    }
    classRuns.sort((a, b) => a.s - b.s);
    let tollDistance = 0;
    let motorwayDistance = 0;
    let ferryDistance = 0;
    classRuns.forEach((run, i) => {
      const end = i < classRuns.length - 1 ? classRuns[i + 1].s : line.length;
      const len = Math.max(0, end - run.s);
      if (run.classes.includes('toll')) tollDistance += len;
      if (run.classes.includes('motorway')) motorwayDistance += len;
      if (run.classes.includes('ferry')) ferryDistance += len;
    });
    return {
      id: `r${++routeSeq}`,
      geometry,
      line,
      distance: r.distance,
      duration: r.duration,
      steps,
      summary: r.legs.map((l) => l.summary).filter(Boolean).join(', '),
      hasToll,
      hasMotorway,
      hasFerry,
      tollDistance,
      motorwayDistance,
      ferryDistance,
      legs,
      label: 'alternative',
      avoidApplied: [],
      provider,
    };
  });
}
