/**
 * Registered places in search, the category buttons and pressed points: your places and the
 * public ones of everyone else come first, and stand in for a place of the same name nearby
 * from the other sources (a place someone registered is the one they checked on the spot).
 */
import { haversine, type LngLat } from '../geo/geo';
import { metres, sameName, type PlaceGroup } from '../places/format';
import type { LangCode } from '../routing/instructions';
import type { Category, CategoryId, PoiProvider, RawPoi } from '../search/categories';
import type { Place, PlaceSearchEngine } from '../search/places';
import type { MyPlacesStore, PublicPlaces } from './store';
import { groupLabel, placeWords, type SharedPlace } from './types';

/** A registered place within this of another source's place of the same name replaces it (m). */
export const SAME_PLACE_M = 500;
/** Waiting longer than this for the shared places service is not worth it (ms). */
const REMOTE_WAIT = 2500;

/** Which registered places answer a category button. */
export const CATEGORY_GROUPS: Record<CategoryId, PlaceGroup[]> = {
  fuel: ['fuel'],
  ev: ['ev'],
  parking: ['parking'],
  food: ['food', 'cafe'],
  rest: ['rest'],
  store: ['grocery'],
};

export function sharedToPlace(p: SharedPlace, lang: LangCode, own: boolean, link = false): Place {
  const w = placeWords(lang);
  const label = groupLabel(p.category, lang);
  const who = own ? `${w.yourPlace} · ${p.visibility === 'public' ? w.public : w.private}` : w.addedBy(p.ownerName);
  return {
    name: p.name,
    sub: [label, who].join(' · '),
    lngLat: p.lngLat,
    ...(p.heading != null ? { bearing: p.heading } : {}),
    info: { group: p.category, label, ...(p.phone ? { phone: p.phone } : {}), ...(p.website ? { website: p.website } : {}) },
    shared: {
      id: p.id,
      own,
      visibility: p.visibility,
      ownerName: p.ownerName,
      note: p.note,
      ...(p.hidden ? { hidden: true } : {}),
      ...(link ? { link: true } : {}),
    },
  };
}

function timeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms);
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      () => {
        clearTimeout(t);
        resolve(fallback);
      },
    );
  });
}

/** Registered places first; another source's place of the same name close to one is dropped. */
export function mergeRegistered(registered: Place[], others: Place[], limit = 10): Place[] {
  const rest = others.filter((o) => !registered.some((r) => Number.isFinite(o.lngLat[0]) && metres(r.lngLat, o.lngLat) < SAME_PLACE_M && sameName(r.name, o.name)));
  return [...registered.slice(0, 5), ...rest, ...registered.slice(5)].slice(0, limit);
}

/** Public places of others for a search: those loaded around the map and the service's answer. */
function others(mine: MyPlacesStore, list: SharedPlace[]): SharedPlace[] {
  const seen = new Set<string>();
  return list.filter((p) => {
    if (seen.has(p.id) || p.visibility !== 'public' || p.hidden || mine.get(p.id) || (mine.owner && p.owner === mine.owner)) return false;
    seen.add(p.id);
    return true;
  });
}

export class CommunitySearch implements PlaceSearchEngine {
  constructor(
    private inner: PlaceSearchEngine,
    private mine: MyPlacesStore,
    private pub: PublicPlaces,
    private lang: () => LangCode,
  ) {}

  async search(q: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    const api = this.pub.api();
    const remote = api ? timeout(api.search(q, near, 8), REMOTE_WAIT, [] as SharedPlace[]) : Promise.resolve([] as SharedPlace[]);
    let found: Place[] = [];
    let err: unknown = null;
    try {
      found = await this.inner.search(q, near, lang, signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      err = e;
    }
    const L = lang as LangCode;
    const own = this.mine.matches(q, near, 5).map((p) => sharedToPlace(p, L, true));
    const theirs = others(this.mine, [...this.pub.matches(q, near, 5), ...(await remote)])
      .slice(0, 5)
      .map((p) => sharedToPlace(p, L, false));
    const registered = [...own, ...theirs];
    if (err && !registered.length) throw err;
    return mergeRegistered(registered, found);
  }

  /** A pressed point is one of the registered places when it is right there. */
  async reverse(p: LngLat, signal?: AbortSignal): Promise<Place | null> {
    const own = this.mine
      .list()
      .map((x) => ({ x, d: haversine(p, x.lngLat) }))
      .filter((x) => x.d <= 25)
      .sort((a, b) => a.d - b.d)[0];
    if (own) return sharedToPlace(own.x, this.lang(), true);
    const theirs = others(this.mine, this.pub.inBox([p[0] - 0.001, p[1] - 0.001, p[0] + 0.001, p[1] + 0.001]))
      .map((x) => ({ x, d: haversine(p, x.lngLat) }))
      .filter((x) => x.d <= 25)
      .sort((a, b) => a.d - b.d)[0];
    if (theirs) return sharedToPlace(theirs.x, this.lang(), false);
    return this.inner.reverse(p, signal);
  }
}

/** The category buttons with the registered places of those kinds added. */
export class CommunityPois implements PoiProvider {
  constructor(
    private inner: PoiProvider,
    private mine: MyPlacesStore,
    private pub: PublicPlaces,
    private lang: () => LangCode,
  ) {}

  async query(cat: Category, points: LngLat[], radius: number, signal?: AbortSignal): Promise<RawPoi[]> {
    const groups = CATEGORY_GROUPS[cat.id] ?? [];
    const api = this.pub.api();
    let remote: Promise<SharedPlace[]> = Promise.resolve([]);
    if (api && points.length) {
      // The box around the points, when it is not too big to ask for in one go.
      const pad = radius / 111_000 + 0.002;
      const w = Math.min(...points.map((p) => p[0])) - pad / Math.cos((points[0][1] * Math.PI) / 180);
      const e = Math.max(...points.map((p) => p[0])) + pad / Math.cos((points[0][1] * Math.PI) / 180);
      const s = Math.min(...points.map((p) => p[1])) - pad;
      const n = Math.max(...points.map((p) => p[1])) + pad;
      if (e - w < 1.5 && n - s < 1.5) remote = timeout(api.inBox([w, s, e, n], 300), REMOTE_WAIT, []);
    }
    let found: RawPoi[] = [];
    let err: unknown = null;
    try {
      found = await this.inner.query(cat, points, radius, signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      err = e;
    }
    const L = this.lang();
    const inReach = (p: SharedPlace) => groups.includes(p.category) && points.some((q) => haversine(q, p.lngLat) <= radius);
    const own = this.mine.near(points, radius, groups).map((p) => ({ p, own: true }));
    const theirs = others(this.mine, [...this.pub.near(points, radius, groups), ...(await remote).filter(inReach)]).map((p) => ({ p, own: false }));
    const registered = [...own, ...theirs];
    if (err && !registered.length) throw err;
    const rest = found.filter((o) => !registered.some(({ p }) => metres(p.lngLat, o.lngLat) < SAME_PLACE_M && sameName(p.name, o.tags.name ?? o.tags.brand ?? '')));
    return [
      ...registered.map(({ p, own: mine }) => {
        const place = sharedToPlace(p, L, mine);
        return { id: `community/${p.id}`, lngLat: p.lngLat, tags: { name: p.name }, place: { name: place.name, sub: place.sub, info: place.info, shared: place.shared, ...(place.bearing != null ? { bearing: place.bearing } : {}) } };
      }),
      ...rest,
    ];
  }
}
