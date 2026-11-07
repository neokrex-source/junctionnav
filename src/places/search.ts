/**
 * The places around you in search and the category buttons: local matches (instant, and without
 * internet) merged with the online search (TomTom or Photon) and the online category search, one
 * entry per place, with the local details (kind, address, phone, hours) where they are known.
 */
import type { LngLat } from '../geo/geo';
import type { Category, PoiProvider, RawPoi } from '../search/categories';
import type { Place, PlaceSearchEngine } from '../search/places';
import type { PlacesClient } from './client';
import { categoryLabel, GROUPS, metres, normName, sameName, type PlaceInfo } from './format';
import { matchScore, type PlaceHit } from './placesIndex';

const LATIN = /[A-Za-z]/;

export function hitInfo(h: PlaceHit, lang: string): PlaceInfo {
  const d = h.d ?? {};
  const label = lang === 'ms' || lang === 'ja' ? GROUPS[h.group].label[lang] : categoryLabel(h.key);
  return {
    group: h.group,
    label,
    ...(d.a ? { address: d.a } : {}),
    ...(d.t ? { phone: d.t } : {}),
    ...(d.w ? { website: d.w } : {}),
    ...(d.h ? { hours: d.h } : {}),
    ...(d.c ? { cuisine: d.c } : {}),
    ...(d.b ? { brand: d.b } : {}),
    ...(d.s ? { source: d.s } : {}),
  };
}

/** A place from the places around you, as search and the place card take it. */
export function hitToPlace(h: PlaceHit, lang: string): Place {
  const info = hitInfo(h, lang);
  // A name in another script gets its English name in English, when there is one.
  const name = lang === 'en' && h.d?.e && !LATIN.test(h.name) ? h.d.e : h.name;
  return { name, sub: [info.label, info.address].filter(Boolean).join(' · '), lngLat: [h.lon, h.lat], info, placeId: h.id };
}

/**
 * One list from local and online results: strong local matches first (the name starts with what
 * was typed), then the online results, then other local ones; a place both found is listed once,
 * the online entry taking the local details.
 */
export function mergeResults(q: string, local: Place[], online: Place[], limit = 10): Place[] {
  const nq = normName(q);
  const words = nq.split(' ').filter(Boolean);
  const out = online.map((o) => ({ ...o }));
  const strong: Place[] = [];
  const weak: Place[] = [];
  for (const l of local) {
    const twin = out.find((o) => Number.isFinite(o.lngLat[0]) && metres(o.lngLat, l.lngLat) < 150 && sameName(o.name, l.name));
    if (twin) {
      twin.info ??= l.info;
      twin.placeId ??= l.placeId;
      continue;
    }
    (matchScore(normName(l.name), nq, words) >= 78 ? strong : weak).push(l);
  }
  return [...strong.slice(0, 4), ...out, ...strong.slice(4), ...weak].slice(0, limit);
}

export class MergedSearch implements PlaceSearchEngine {
  constructor(
    private online: PlaceSearchEngine,
    private local: () => PlacesClient | null,
    private lang: () => string,
  ) {}

  async search(q: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    const client = this.local();
    const loc = client ? client.search(q, near, 8).then((hits) => hits.map((h) => hitToPlace(h, lang)), () => [] as Place[]) : Promise.resolve([] as Place[]);
    let online: Place[] = [];
    let err: unknown = null;
    try {
      online = await this.online.search(q, near, lang, signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      err = e;
    }
    const local = await loc;
    if (err && !local.length) throw err;
    return mergeResults(q, local, online);
  }

  /** A pressed point names itself after a place right there, else asks the online search. */
  async reverse(p: LngLat, signal?: AbortSignal): Promise<Place | null> {
    const client = this.local();
    const hit = client ? await client.nearest(p, 25).catch(() => null) : null;
    if (hit) return hitToPlace(hit, this.lang());
    return this.online.reverse(p, signal);
  }
}

function hitToRaw(h: PlaceHit): RawPoi {
  const d = h.d ?? {};
  return {
    id: `places/${h.id}`,
    lngLat: [h.lon, h.lat],
    tags: { name: h.name, _place: h.id, ...(d.b && d.b !== h.name ? { brand: d.b } : {}), ...(d.a ? { 'addr:street': d.a } : {}) },
  };
}

/** The category buttons with the places around you added to the online results. */
export class MergedPois implements PoiProvider {
  constructor(
    private online: PoiProvider,
    private local: () => PlacesClient | null,
  ) {}

  async query(cat: Category, points: LngLat[], radius: number, signal?: AbortSignal): Promise<RawPoi[]> {
    const client = this.local();
    const loc = client ? client.near(points, radius, cat.id, 150).catch(() => [] as PlaceHit[]) : Promise.resolve([] as PlaceHit[]);
    let online: RawPoi[] = [];
    let err: unknown = null;
    try {
      online = await this.online.query(cat, points, radius, signal);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      err = e;
    }
    const local = await loc;
    if (err && !local.length) throw err;
    const out = [...online];
    for (const h of local) {
      const at: LngLat = [h.lon, h.lat];
      if (online.some((o) => metres(o.lngLat, at) < 60 && sameName(o.tags.name ?? o.tags.brand ?? '', h.name))) continue;
      out.push(hitToRaw(h));
    }
    return out;
  }
}
