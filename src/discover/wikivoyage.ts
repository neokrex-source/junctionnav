/**
 * Traveller picks from Wikivoyage: the "See", "Do", "Eat", "Drink", "Sleep" and "Buy" listings
 * of the travel guides near the map centre (the ones with a position), with their own words.
 */
import { haversine, type LngLat } from '../geo/geo';
import { addSource, commonsFile, commonsPage, commonsThumb, websiteUrl, WIKI_HEADERS, wikipediaUrl } from './links';
import type { DiscoverCat, DiscoverPlace, SourceLink } from './types';

const API = 'https://en.wikivoyage.org/w/api.php';

export interface Listing {
  type: 'see' | 'do' | 'eat' | 'drink' | 'sleep' | 'buy' | 'go' | 'other';
  name: string;
  lngLat: LngLat;
  url?: string;
  address?: string;
  hours?: string;
  price?: string;
  phone?: string;
  content?: string;
  image?: string;
  wikidata?: string;
  wikipedia?: string;
  /** The guide it is in ("Kuala Lumpur/Bukit Bintang"). */
  article: string;
}

/** The text of every {{...}} template starting with one of the listing names, braces balanced. */
function templates(text: string): string[] {
  const out: string[] = [];
  const re = /\{\{\s*(see|do|eat|drink|sleep|buy|go|listing|marker)\s*[|}\n]/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let depth = 0;
    let i = m.index;
    for (; i < text.length - 1; i++) {
      if (text[i] === '{' && text[i + 1] === '{') {
        depth++;
        i++;
      } else if (text[i] === '}' && text[i + 1] === '}') {
        depth--;
        i++;
        if (depth === 0) break;
      }
    }
    out.push(text.slice(m.index + 2, i - 1));
    re.lastIndex = i;
  }
  return out;
}

/** Splits a template's inside at the bars that are not inside a link or another template. */
function params(inner: string): { name: string; p: Record<string, string> } {
  const parts: string[] = [];
  let depth = 0;
  let cur = '';
  for (let i = 0; i < inner.length; i++) {
    const two = inner.slice(i, i + 2);
    if (two === '{{' || two === '[[') {
      depth++;
      cur += two;
      i++;
    } else if ((two === '}}' || two === ']]') && depth > 0) {
      depth--;
      cur += two;
      i++;
    } else if (inner[i] === '|' && depth === 0) {
      parts.push(cur);
      cur = '';
    } else cur += inner[i];
  }
  parts.push(cur);
  const name = parts.shift()!.trim().toLowerCase();
  const p: Record<string, string> = {};
  for (const part of parts) {
    const eq = part.indexOf('=');
    if (eq < 0) continue;
    const k = part.slice(0, eq).trim().toLowerCase();
    const v = part.slice(eq + 1).trim();
    if (k && v) p[k] = v;
  }
  return { name, p };
}

/** Wiki markup as plain words: links as their text, no templates, references, bold or tags. */
export function plainWiki(s: string): string {
  return s
    .replace(/<ref[^>]*\/>/gi, '')
    .replace(/<ref[^>]*>[\s\S]*?<\/ref>/gi, '')
    .replace(/\{\{\s*([A-Z]{3})\s*\|\s*([^}|]+?)\s*\}\}/g, '$1 $2')
    .replace(/\{\{[^{}]*\}\}/g, '')
    .replace(/\[\[(?:[^|\]]*\|)?([^\]]+)\]\]/g, '$1')
    .replace(/\[https?:\/\/\S+\s+([^\]]+)\]/g, '$1')
    .replace(/\[https?:\/\/\S+\]/g, '')
    .replace(/'{2,}/g, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** The listings with a position in a guide's wikitext. */
export function parseListings(wikitext: string, article: string): Listing[] {
  const out: Listing[] = [];
  for (const t of templates(wikitext)) {
    const { name: tpl, p } = params(t);
    const lat = Number(p.lat);
    const lon = Number(p.long ?? p.lon);
    const name = plainWiki(p.name ?? '');
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0) || Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;
    const kind = (tpl === 'listing' || tpl === 'marker' ? (p.type ?? 'other') : tpl).toLowerCase();
    const type = (['see', 'do', 'eat', 'drink', 'sleep', 'buy', 'go'].includes(kind) ? kind : 'other') as Listing['type'];
    const content = plainWiki(p.content ?? p.description ?? '');
    out.push({
      type,
      name,
      lngLat: [lon, lat],
      url: p.url,
      address: p.address ? plainWiki(p.address) : undefined,
      hours: p.hours ? plainWiki(p.hours) : undefined,
      price: p.price ? plainWiki(p.price) : undefined,
      phone: p.phone ? plainWiki(p.phone) : undefined,
      content: content || undefined,
      image: p.image,
      wikidata: /^Q\d+$/.test(p.wikidata ?? '') ? p.wikidata : undefined,
      wikipedia: p.wikipedia,
      article,
    });
  }
  return out;
}

const THEME = /theme park|amusement park|water ?park|funfair|adventure park|legoland|wonderland/i;
const MALL = /\bmalls?\b|shopping (cent(re|er)|complex|centre)|department store|galleria|\bplaza\b/i;
const RESORT = /\bresorts?\b|\bretreat\b/i;
const CAFE = /caf[eé]|coffee|kopi|\btea\b|dessert|bakery|kopitiam/i;
const FOOD = /restaurant|hawker|food court|eatery|stall|cuisine|dishes|kopitiam|nasi|mee |laksa|satay/i;

/** Which kind of place a listing is, for the five buttons (null for none of them). */
export function listingCat(l: Listing): DiscoverCat | null {
  const text = `${l.name} ${l.content ?? ''}`;
  switch (l.type) {
    case 'eat':
      return 'food';
    case 'drink':
      return CAFE.test(text) ? 'food' : null;
    case 'sleep':
      return RESORT.test(l.name) || RESORT.test(l.content?.slice(0, 120) ?? '') ? 'resorts' : null;
    case 'buy':
      return MALL.test(l.name) || MALL.test(l.content?.slice(0, 120) ?? '') ? 'malls' : null;
    case 'see':
    case 'do':
      if (THEME.test(text)) return 'themeparks';
      if (MALL.test(l.name)) return 'malls';
      if (l.type === 'do' && FOOD.test(l.name)) return 'food';
      return 'attractions';
    default:
      return null;
  }
}

/** A listing as a place to discover. */
export function listingPlace(l: Listing, cat: DiscoverCat): DiscoverPlace {
  const site = websiteUrl(l.url);
  const file = commonsFile(l.image);
  const wp = l.wikipedia ? wikipediaUrl(l.wikipedia.includes(':') ? l.wikipedia : `en:${l.wikipedia}`) : null;
  const guide = `https://en.wikivoyage.org/wiki/${encodeURIComponent(l.article.replace(/ /g, '_')).replace(/%2F/g, '/')}`;
  const sources: SourceLink[] = [{ kind: 'wikivoyage', url: guide, label: `Wikivoyage: ${l.article}` }];
  if (site) addSource(sources, { kind: 'website', url: site, label: site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 40) });
  if (wp) addSource(sources, { kind: 'wikipedia', url: wp.url, label: `Wikipedia: ${wp.title}` });
  if (l.wikidata) addSource(sources, { kind: 'wikidata', url: `https://www.wikidata.org/wiki/${l.wikidata}`, label: `Wikidata ${l.wikidata}` });
  const area = l.article.split('/')[0];
  let score = 45 + Math.min(10, Math.floor((l.content?.length ?? 0) / 60));
  if (file) score += 10;
  if (l.wikidata) score += 10;
  return {
    id: `wv:${l.name.toLowerCase()}@${l.lngLat[1].toFixed(3)},${l.lngLat[0].toFixed(3)}`,
    name: l.name,
    lngLat: l.lngLat,
    cat,
    kind: '',
    ...(l.content ? { about: l.content, aboutFrom: 'wikivoyage' as const } : {}),
    ...(file ? { photo: { url: commonsThumb(file), file, page: commonsPage(file) } } : {}),
    address: l.address,
    hours: l.hours,
    phone: l.phone,
    price: l.price,
    website: site ?? undefined,
    area,
    wikidata: l.wikidata,
    pick: true,
    social: {},
    sources,
    score,
  };
}

/** The travel guides near a point (closest first). */
export async function nearbyGuides(center: LngLat, fetchFn: typeof fetch, signal?: AbortSignal): Promise<{ title: string; dist: number }[]> {
  const url = `${API}?action=query&list=geosearch&gscoord=${center[1].toFixed(5)}|${center[0].toFixed(5)}&gsradius=10000&gslimit=6&gsnamespace=0&format=json&origin=*`;
  const res = await fetchFn(url, { headers: WIKI_HEADERS, signal });
  if (!res.ok) throw new Error(`Wikivoyage ${res.status}`);
  const json = (await res.json()) as { query?: { geosearch?: { title: string; dist: number }[] } };
  return (json.query?.geosearch ?? []).map((g) => ({ title: g.title, dist: g.dist }));
}

/** A guide's wikitext. */
export async function guideText(title: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<{ title: string; text: string }> {
  const url = `${API}?action=parse&page=${encodeURIComponent(title)}&prop=wikitext&redirects=1&format=json&formatversion=2&origin=*`;
  const res = await fetchFn(url, { headers: WIKI_HEADERS, signal });
  if (!res.ok) throw new Error(`Wikivoyage ${res.status}`);
  const json = (await res.json()) as { parse?: { title?: string; wikitext?: string } };
  return { title: json.parse?.title ?? title, text: json.parse?.wikitext ?? '' };
}

/**
 * The listings with a position in the (up to three) guides closest to a point. Guides for a city
 * are often split into districts; the closest ones cover where the map is.
 */
export async function fetchListings(center: LngLat, fetchFn: typeof fetch, signal?: AbortSignal): Promise<Listing[]> {
  const guides = (await nearbyGuides(center, fetchFn, signal)).slice(0, 3);
  const texts = await Promise.allSettled(guides.map((g) => guideText(g.title, fetchFn, signal)));
  const out: Listing[] = [];
  const seen = new Set<string>();
  for (const t of texts) {
    if (t.status !== 'fulfilled') continue;
    for (const l of parseListings(t.value.text, t.value.title)) {
      const key = `${l.name.toLowerCase()}@${l.lngLat[1].toFixed(4)},${l.lngLat[0].toFixed(4)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(l);
    }
  }
  if (!out.length && texts.length && texts.every((t) => t.status === 'rejected')) throw new Error('Wikivoyage unavailable');
  return out;
}

/** The listings of one kind within `radius` metres. */
export function listingsFor(all: Listing[], cat: DiscoverCat, center: LngLat, radius: number): DiscoverPlace[] {
  const out: DiscoverPlace[] = [];
  for (const l of all) {
    if (listingCat(l) !== cat || haversine(center, l.lngLat) > radius) continue;
    out.push(listingPlace(l, cat));
  }
  return out;
}
