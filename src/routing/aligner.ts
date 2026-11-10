/**
 * Puts routes onto the map's roads (src/routing/align.ts) with the road tiles they pass
 * (src/map/roadTiles.ts). Routes are handed back after a short wait for the tiles; a long route
 * whose far end was not loaded by then comes back lined up as far as the tiles go, and
 * `complete()` gives the whole of it once the rest is in.
 */
import type { RoadTiles } from '../map/roadTiles';
import { alignRoute } from './align';
import type { Route, RouteRequest, RouteResult, Router } from './types';

const pause = () => new Promise<void>((ok) => setTimeout(ok, 0));

export class RouteAligner {
  /** The router's own route behind each lined-up one. */
  private source = new WeakMap<Route, Route>();
  private finishing = new WeakMap<Route, Promise<Route | null>>();

  constructor(
    readonly roads: RoadTiles,
    /** How long to wait for the tiles before handing routes back (ms). */
    readonly budgetMs = 1500,
  ) {}

  /** The routes on the map's roads (each as far as its tiles came in time; else as they were). */
  async align(routes: Route[], signal?: AbortSignal): Promise<Route[]> {
    const keys = [...new Set(routes.flatMap((r) => this.roads.keysFor(r.geometry)))];
    await this.roads.load(keys, this.budgetMs, signal);
    const out: Route[] = [];
    for (const r of routes) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      out.push(await this.one(r));
    }
    return out;
  }

  private async one(r: Route): Promise<Route> {
    try {
      const a = await alignRoute(r, this.roads, pause);
      if (!a) return r;
      this.source.set(a, r);
      return a;
    } catch {
      return r;
    }
  }

  /** The route still has stretches waiting for road tiles. */
  pending(r: Route): boolean {
    return r.aligned === 'partial' && this.source.has(r);
  }

  /**
   * All of the route on the map's roads, once its tiles are in (null when that changes nothing or
   * the tiles cannot be had within `timeoutMs`).
   */
  complete(r: Route, timeoutMs = 90_000): Promise<Route | null> {
    const had = this.finishing.get(r);
    if (had) return had;
    const src = this.source.get(r);
    const p = !src
      ? Promise.resolve(null)
      : this.roads.load(this.roads.keysFor(src.geometry), timeoutMs).then(async (all) => {
          if (!all) return null;
          const a = await this.one(src);
          return a === src || a.aligned === 'partial' ? null : a;
        });
    this.finishing.set(r, p);
    return p;
  }
}

/** Whose map a route was planned on: TomTom's, or OpenStreetMap (OSRM, the offline maps). */
export function routeData(r: Route): 'tomtom' | 'osm' {
  return r.provider === 'TomTom' ? 'tomtom' : 'osm';
}

/**
 * A router whose routes are put onto the roads of the map being drawn: TomTom's routes when the
 * map is OpenStreetMap's, OpenStreetMap routes when the map is TomTom's (`alignerFor` says which
 * aligner a route needs, or null when it was planned on the map's own data).
 */
export class AligningRouter implements Router {
  constructor(
    private inner: Router,
    private alignerFor: (r: Route) => RouteAligner | null,
  ) {}

  get name() {
    return this.inner.name;
  }

  async route(req: RouteRequest, signal?: AbortSignal): Promise<RouteResult> {
    const res = await this.inner.route(req, signal);
    const groups = new Map<RouteAligner, number[]>();
    res.routes.forEach((r, i) => {
      const al = this.alignerFor(r);
      if (!al) return;
      const g = groups.get(al);
      if (g) g.push(i);
      else groups.set(al, [i]);
    });
    if (!groups.size) return res;
    const routes = res.routes.slice();
    for (const [al, idx] of groups) {
      try {
        const out = await al.align(
          idx.map((i) => routes[i]),
          signal,
        );
        idx.forEach((i, k) => (routes[i] = out[k]));
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        /* the routes as they came */
      }
    }
    return { ...res, routes };
  }
}
