/**
 * Puts routes onto the map's roads (src/routing/align.ts) with the road tiles they pass
 * (src/map/roadTiles.ts). Routes are handed back after a short wait for the tiles; a long route
 * whose far end was not loaded by then comes back lined up as far as the tiles go, and
 * `complete()` gives the whole of it once the rest is in.
 */
import type { RoadTiles } from '../map/roadTiles';
import { alignRoute } from './align';
import type { Route } from './types';

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
