/**
 * TomTom first, the usual services when it cannot answer: each wrapper asks TomTom while the
 * gate says so, and on a failure rests TomTom (see gate.ts) and asks the OpenStreetMap service
 * instead, so the user gets an answer either way.
 */
import type { LngLat } from '../geo/geo';
import type { RouteRequest, RouteResult, Router } from '../routing/types';
import type { Category, PoiProvider, RawPoi } from '../search/categories';
import type { Place, PlaceSearchEngine } from '../search/places';
import type { TomTomGate } from './gate';

const aborted = (e: unknown, signal?: AbortSignal) => signal?.aborted || (e as Error)?.name === 'AbortError';

export class FallbackRouter implements Router {
  constructor(
    private primary: Router,
    private secondary: () => Router,
    private gate: TomTomGate,
  ) {}

  get name(): string {
    return this.gate.usable ? this.primary.name : this.secondary().name;
  }

  async route(req: RouteRequest, signal?: AbortSignal): Promise<RouteResult> {
    if (!this.gate.usable) return this.secondary().route(req, signal);
    try {
      const r = await this.primary.route(req, signal);
      this.gate.ok();
      return r;
    } catch (e) {
      if (aborted(e, signal)) throw e;
      console.warn('[tomtom] routing:', (e as Error).message);
      this.gate.fail(e);
      const r = await this.secondary().route(req, signal);
      r.note = `TomTom could not plan this (${shortReason(e)}), so these routes come from OpenStreetMap, without live traffic.`;
      return r;
    }
  }
}

export class FallbackSearch implements PlaceSearchEngine {
  constructor(
    private primary: PlaceSearchEngine,
    private secondary: () => PlaceSearchEngine,
    private gate: TomTomGate,
  ) {}

  async search(q: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    if (!this.gate.usable) return this.secondary().search(q, near, lang, signal);
    try {
      const r = await this.primary.search(q, near, lang, signal);
      this.gate.ok();
      return r;
    } catch (e) {
      if (aborted(e, signal)) throw e;
      console.warn('[tomtom] search:', (e as Error).message);
      this.gate.fail(e);
      return this.secondary().search(q, near, lang, signal);
    }
  }

  async reverse(p: LngLat, signal?: AbortSignal): Promise<Place | null> {
    if (!this.gate.usable) return this.secondary().reverse(p, signal);
    try {
      const r = await this.primary.reverse(p, signal);
      this.gate.ok();
      return r ?? (await this.secondary().reverse(p, signal));
    } catch (e) {
      if (aborted(e, signal)) throw e;
      this.gate.fail(e);
      return this.secondary().reverse(p, signal);
    }
  }
}

export class FallbackPois implements PoiProvider {
  constructor(
    private primary: PoiProvider,
    private secondary: PoiProvider,
    private gate: TomTomGate,
  ) {}

  async query(cat: Category, points: LngLat[], radius: number, signal?: AbortSignal): Promise<RawPoi[]> {
    if (!this.gate.usable) return this.secondary.query(cat, points, radius, signal);
    try {
      const r = await this.primary.query(cat, points, radius, signal);
      this.gate.ok();
      return r;
    } catch (e) {
      if (aborted(e, signal)) throw e;
      console.warn('[tomtom] places:', (e as Error).message);
      this.gate.fail(e);
      return this.secondary.query(cat, points, radius, signal);
    }
  }
}

/** A few words on why TomTom did not answer. */
export function shortReason(e: unknown): string {
  const status = (e as { status?: number })?.status ?? 0;
  if (status === 401 || status === 403) return 'key refused or daily allowance used up';
  if (status === 429) return 'too busy';
  if (status === 400) return (e as Error).message.includes('NO_ROUTE') || /no route/i.test((e as Error).message) ? 'no route' : 'request not accepted';
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 'no internet';
  return status ? `error ${status}` : 'not reachable';
}
