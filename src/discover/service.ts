/**
 * Gathers places to discover when a button is tapped: OpenStreetMap for the kind of place,
 * Wikivoyage's traveller picks and Wikipedia's landmarks around the map centre, with photos
 * from Wikidata where a place has none yet. The same place from several sources becomes one,
 * with all their links. Results are kept for a while per area; Refresh asks again.
 */
import { haversine, type LngLat } from '../geo/geo';
import type { LangCode } from '../routing/instructions';
import { addSource } from './links';
import { fetchOsm } from './osm';
import type { DiscoverCat, DiscoverPlace, DiscoverResult, SourceKind } from './types';
import { fetchListings, listingsFor, type Listing } from './wikivoyage';
import { fetchWikidataPhotos, fetchWikiPages, wikiCat, wikidataPhoto, wikiLangs, wikiPlace, type WikiPage } from './wiki';

/** How far around the map centre each kind is looked for (metres), and the most when zoomed out. */
export const RADIUS: Record<DiscoverCat, { base: number; max: number }> = {
  attractions: { base: 10_000, max: 25_000 },
  food: { base: 5_000, max: 12_000 },
  resorts: { base: 40_000, max: 60_000 },
  themeparks: { base: 40_000, max: 60_000 },
  malls: { base: 12_000, max: 25_000 },
};

/** The radius for a kind of place with this much of the map on screen (metres from the centre to the edge). */
export function radiusFor(cat: DiscoverCat, view: number): number {
  const r = RADIUS[cat];
  return Math.round(Math.min(r.max, Math.max(r.base, view * 0.8)));
}

/** At most this many places per answer. */
export const MAX_PLACES = 40;
/** Answers are kept this long (ms) before a tap asks again. */
export const KEEP_FOR = 15 * 60_000;

const STOP = /\b(the|restoran|restaurant|kedai|makan|cafe|café|kafe|hotel|resort|mall|shopping|centre|center|museum|muzium|taman|park)\b/g;

/** A name made comparable: lower case, no accents, no common words or punctuation. */
export function nameKey(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(STOP, '')
    .replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Two entries are the same place: the same Wikidata item, or alike names close together. */
export function samePlace(a: DiscoverPlace, b: DiscoverPlace): boolean {
  if (a.wikidata && b.wikidata) return a.wikidata === b.wikidata;
  const big = a.cat === 'themeparks' || a.cat === 'resorts' || a.cat === 'malls';
  const d = haversine(a.lngLat, b.lngLat);
  if (d > (big ? 1500 : 300)) return false;
  const ka = nameKey(a.name);
  const kb = nameKey(b.name);
  if (!ka || !kb) return a.name.toLowerCase() === b.name.toLowerCase() && d < 100;
  if (ka === kb) return true;
  const [s, l] = ka.length < kb.length ? [ka, kb] : [kb, ka];
  return s.length >= 5 && l.includes(s);
}

/** One place from two entries: OSM's position and details, the best words and photo, every link. */
export function mergePlaces(a: DiscoverPlace, b: DiscoverPlace): DiscoverPlace {
  const osm = a.id.startsWith('osm:') ? a : b.id.startsWith('osm:') ? b : a;
  const other = osm === a ? b : a;
  const about = [a, b].find((x) => x.aboutFrom === 'wikivoyage') ?? [a, b].find((x) => x.aboutFrom === 'wikipedia') ?? [a, b].find((x) => x.about);
  const sources = [...osm.sources];
  for (const s of other.sources) addSource(sources, s);
  return {
    ...other,
    ...osm,
    name: osm.name || other.name,
    kind: osm.kind || other.kind,
    about: about?.about,
    aboutFrom: about?.aboutFrom,
    photo: osm.photo ?? other.photo,
    address: osm.address ?? other.address,
    hours: osm.hours ?? other.hours,
    phone: osm.phone ?? other.phone,
    website: osm.website ?? other.website,
    price: osm.price ?? other.price,
    cuisine: osm.cuisine ?? other.cuisine,
    area: osm.area ?? other.area,
    wikidata: osm.wikidata ?? other.wikidata,
    pick: !!(a.pick || b.pick),
    social: { ...other.social, ...osm.social },
    sources,
    // Found in more than one source: better known.
    score: Math.max(a.score, b.score) + 15,
    chain: osm.chain,
  };
}

/** Adds each entry to the list, folding it into the same place when it is there already. */
export function mergeInto(list: DiscoverPlace[], more: DiscoverPlace[]): DiscoverPlace[] {
  for (const p of more) {
    const i = list.findIndex((x) => samePlace(x, p));
    if (i >= 0) list[i] = mergePlaces(list[i], p);
    else list.push(p);
  }
  return list;
}

/** Best known first; chains after local places; nearer first when alike. */
export function rank(list: DiscoverPlace[], center: LngLat, radius: number): DiscoverPlace[] {
  const value = (p: DiscoverPlace) => p.score - (p.chain ? 40 : 0) - (haversine(center, p.lngLat) / radius) * 12;
  return [...list].sort((a, b) => value(b) - value(a));
}

/** Places on this phone (the offline places), for when the sources cannot be reached. */
export type LocalDiscover = (cat: DiscoverCat, center: LngLat, radius: number, lang: LangCode) => Promise<DiscoverPlace[]>;

export interface DiscoverDeps {
  fetchFn?: typeof fetch;
  overpass: () => string[];
  local?: LocalDiscover;
  online?: () => boolean;
}

const cell = (p: LngLat) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`;

export class DiscoverService {
  private results = new Map<string, DiscoverResult>();
  private listings = new Map<string, { at: number; list: Promise<Listing[]> }>();
  private wiki = new Map<string, { at: number; pages: Promise<WikiPage[]> }>();
  private fetchFn: typeof fetch;

  constructor(private deps: DiscoverDeps) {
    this.fetchFn = deps.fetchFn ?? ((...a) => fetch(...a));
  }

  /** The last answer for this kind of place around here, if it is still fresh. */
  cached(cat: DiscoverCat, center: LngLat, radius: number, lang: LangCode): DiscoverResult | null {
    const r = this.results.get(`${cat}|${lang}|${cell(center)}|${radius}`);
    return r && Date.now() - r.at < KEEP_FOR ? r : null;
  }

  private guideListings(center: LngLat, force: boolean, signal?: AbortSignal): Promise<Listing[]> {
    const k = cell(center);
    const hit = this.listings.get(k);
    if (hit && !force && Date.now() - hit.at < KEEP_FOR) return hit.list;
    const list = fetchListings(center, this.fetchFn, signal);
    this.listings.set(k, { at: Date.now(), list });
    list.catch(() => this.listings.delete(k));
    return list;
  }

  private wikiPages(lang: string, center: LngLat, force: boolean, signal?: AbortSignal): Promise<WikiPage[]> {
    const k = `${lang}|${cell(center)}`;
    const hit = this.wiki.get(k);
    if (hit && !force && Date.now() - hit.at < KEEP_FOR) return hit.pages;
    const pages = fetchWikiPages(lang, center, 10_000, this.fetchFn, signal);
    this.wiki.set(k, { at: Date.now(), pages });
    pages.catch(() => this.wiki.delete(k));
    return pages;
  }

  /**
   * The places of one kind around a point: from the sources (all asked at once; whatever answers
   * counts), else from the places on this phone. `force` asks again even when an answer is fresh.
   */
  async discover(cat: DiscoverCat, center: LngLat, radius: number, lang: LangCode, force = false, signal?: AbortSignal): Promise<DiscoverResult> {
    const key = `${cat}|${lang}|${cell(center)}|${radius}`;
    if (!force) {
      const hit = this.cached(cat, center, radius, lang);
      if (hit) return hit;
    }
    const used: SourceKind[] = [];
    const failed: SourceKind[] = [];
    const online = this.deps.online?.() ?? true;
    let list: DiscoverPlace[] = [];
    if (online) {
      const [osm, wv, ...wp] = await Promise.allSettled([
        fetchOsm(cat, center, radius, lang, this.deps.overpass(), this.fetchFn, signal),
        this.guideListings(center, force, signal).then((all) => listingsFor(all, cat, center, radius)),
        ...wikiLangs(lang).map((l) =>
          this.wikiPages(l, center, force, signal).then((pages) => pages.flatMap((p) => (wikiCat(p) === cat && haversine(center, p.lngLat) <= radius ? [wikiPlace(p, cat)] : []))),
        ),
      ]);
      const bad = new Set<SourceKind>();
      const take = (r: PromiseSettledResult<DiscoverPlace[]>, kind: SourceKind) => {
        if (r.status === 'fulfilled') {
          if (!used.includes(kind)) used.push(kind);
          mergeInto(list, r.value);
        } else {
          if ((r.reason as Error)?.name === 'AbortError') throw r.reason;
          bad.add(kind);
        }
      };
      take(osm, 'osm');
      take(wv, 'wikivoyage');
      for (const r of wp) take(r, 'wikipedia');
      for (const k of bad) if (!used.includes(k)) failed.push(k);
      // Photos for places with a Wikidata item and none yet.
      const need = list.filter((p) => !p.photo && p.wikidata).map((p) => p.wikidata!);
      if (need.length) {
        try {
          const photos = await fetchWikidataPhotos(need, this.fetchFn, signal);
          if (photos.size) used.push('wikidata');
          list = list.map((p) => {
            const w = p.wikidata ? photos.get(p.wikidata) : undefined;
            if (!w) return p;
            const sources = [...p.sources];
            if (w.enwiki) addSource(sources, { kind: 'wikipedia', url: w.enwiki, label: `Wikipedia: ${decodeURIComponent(w.enwiki.split('/wiki/')[1] ?? '').replace(/_/g, ' ')}` });
            return { ...p, ...(w.file && !p.photo ? { photo: wikidataPhoto(w.file), score: p.score + 10 } : {}), sources };
          });
        } catch (e) {
          if ((e as Error).name === 'AbortError') throw e;
        }
      }
    }
    if (!used.length && this.deps.local) {
      list = await this.deps.local(cat, center, radius, lang).catch(() => []);
      if (list.length) used.push('local');
    }
    const places = rank(
      list.filter((p) => haversine(center, p.lngLat) <= radius * 1.1),
      center,
      radius,
    ).slice(0, MAX_PLACES);
    const result: DiscoverResult = { cat, center, radius, places, at: Date.now(), used, failed: online ? failed : ['osm', 'wikivoyage', 'wikipedia'] };
    if (used.length && !used.includes('local')) this.results.set(key, result);
    return result;
  }
}
