/**
 * Landmarks from Wikipedia (articles with a position near the map centre, with their photo and
 * first lines), photos from Wikidata for places that have an item, and the photo credits from
 * Wikimedia Commons.
 */
import type { LngLat } from '../geo/geo';
import type { LangCode } from '../routing/instructions';
import { commonsPage, commonsThumb, WIKI_HEADERS } from './links';
import type { DiscoverCat, DiscoverPhoto, DiscoverPlace, SourceLink } from './types';

export interface WikiPage {
  lang: string;
  title: string;
  lngLat: LngLat;
  type?: string;
  description?: string;
  extract?: string;
  thumb?: string;
  file?: string;
  wikidata?: string;
}

/** Articles with a position within `radius` metres (up to 10 km, Wikipedia's limit). */
export async function fetchWikiPages(lang: string, center: LngLat, radius: number, fetchFn: typeof fetch, signal?: AbortSignal): Promise<WikiPage[]> {
  const r = Math.max(10, Math.min(10000, Math.round(radius)));
  const url =
    `https://${lang}.wikipedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*` +
    `&generator=geosearch&ggscoord=${center[1].toFixed(5)}|${center[0].toFixed(5)}&ggsradius=${r}&ggslimit=50&ggsnamespace=0` +
    `&prop=coordinates|pageimages|description|extracts|pageprops&coprop=type&piprop=thumbnail|name&pithumbsize=480` +
    `&exintro=1&explaintext=1&exsentences=2&exlimit=20&ppprop=wikibase_item`;
  const res = await fetchFn(url, { headers: WIKI_HEADERS, signal });
  if (!res.ok) throw new Error(`Wikipedia ${res.status}`);
  const json = (await res.json()) as {
    query?: {
      pages?: {
        title: string;
        coordinates?: { lat: number; lon: number; type?: string }[];
        description?: string;
        extract?: string;
        thumbnail?: { source: string };
        pageimage?: string;
        pageprops?: { wikibase_item?: string };
      }[];
    };
  };
  const out: WikiPage[] = [];
  for (const p of json.query?.pages ?? []) {
    const c = p.coordinates?.[0];
    if (!c) continue;
    out.push({
      lang,
      title: p.title,
      lngLat: [c.lon, c.lat],
      type: c.type,
      description: p.description,
      extract: p.extract?.trim() || undefined,
      thumb: p.thumbnail?.source,
      file: p.pageimage ? `File:${p.pageimage.replace(/_/g, ' ')}` : undefined,
      wikidata: p.pageprops?.wikibase_item,
    });
  }
  return out;
}

const NOT_A_SIGHT_TYPES = new Set(['city', 'adm1st', 'adm2nd', 'adm3rd', 'country', 'state', 'edu', 'railwaystation', 'airport', 'event', 'satellite']);
const NOT_A_SIGHT =
  /\b(villages?|towns?|cit(y|ies)|district|mukim|constituency|schools?|universit(y|ies)|college|stations?|highway|expressway|motorway|road|street|avenue|compan(y|ies)|neighbou?rhood|suburb|residential|township|hospital|federal territory|state of|electoral|parliament(ary)? seat|ward|interchange|toll plaza|bus|lrt|mrt|monorail|condominium|apartment|housing estate|industrial|office|embassy|ministry|police|fire station|clinic|bank|stadium of|campus)\b|駅|学校|大学|市$|町$|村$|区$|道路|高速|sekolah|stesen|lebuhraya|jalan|kampung|daerah/i;
const THEME = /theme park|amusement park|water ?park|funfair|テーマパーク|遊園地|taman tema|taman air/i;
const MALL = /shopping (mall|cent(re|er)|complex)|\bmalls?\b|department store|ショッピング(モール|センター)|百貨店|pusat beli-belah/i;
const RESORT = /\bresorts?\b|リゾート/i;
const FOOD = /\b(restaurant|hawker|food court|caf[eé]|eatery|bakery|kopitiam)\b|レストラン|食堂|restoran|medan selera/i;
const SIGHT =
  /museum|mosque|temple|church|cathedral|shrine|tower|monument|memorial|park|garden|palace|fort|castle|cave|waterfall|beach|hill|mountain|lake|island|skyscraper|building|square|gallery|zoo|aquarium|bridge|landmark|heritage|historic|market|aquaria|bird park|botanic|reserve|forest|viewpoint|lighthouse|statue|clock|archway|street art|博物館|美術館|神社|寺|城|公園|タワー|滝|山|湖|橋|庭園|muzium|masjid|kuil|menara|taman|istana|kubu|gua|air terjun|pantai|bukit|tasik|pulau|tugu/i;

/** Which of the five kinds an article is about (null for towns, roads, schools and the like). */
export function wikiCat(p: WikiPage): DiscoverCat | null {
  const text = `${p.title} ${p.description ?? ''} ${(p.extract ?? '').split(/(?<=\.)\s/)[0]}`;
  if (p.type && NOT_A_SIGHT_TYPES.has(p.type)) return null;
  if (THEME.test(text)) return 'themeparks';
  if (MALL.test(`${p.title} ${p.description ?? ''}`)) return 'malls';
  if (RESORT.test(`${p.title} ${p.description ?? ''}`)) return 'resorts';
  if (FOOD.test(`${p.title} ${p.description ?? ''}`)) return 'food';
  if (NOT_A_SIGHT.test(`${p.title} ${p.description ?? ''}`)) return null;
  if (p.type === 'landmark' || p.type === 'mountain' || p.type === 'waterbody' || p.type === 'isle' || p.type === 'forest' || SIGHT.test(text)) return 'attractions';
  return null;
}

function kindFrom(desc: string | undefined): string {
  if (!desc || desc.length > 60) return '';
  return desc[0].toUpperCase() + desc.slice(1);
}

/** An article as a place to discover. */
export function wikiPlace(p: WikiPage, cat: DiscoverCat): DiscoverPlace {
  const url = `https://${p.lang}.wikipedia.org/wiki/${encodeURIComponent(p.title.replace(/ /g, '_'))}`;
  const sources: SourceLink[] = [{ kind: 'wikipedia', url, label: `Wikipedia: ${p.title}` }];
  if (p.wikidata) sources.push({ kind: 'wikidata' as const, url: `https://www.wikidata.org/wiki/${p.wikidata}`, label: `Wikidata ${p.wikidata}` });
  const photo: DiscoverPhoto | undefined = p.thumb ? { url: p.thumb, ...(p.file ? { file: p.file, page: commonsPage(p.file) } : {}) } : undefined;
  return {
    id: `wp:${p.lang}:${p.title}`,
    name: p.title.replace(/\s*\([^)]*\)$/, ''),
    lngLat: p.lngLat,
    cat,
    kind: kindFrom(p.description),
    ...(p.extract ? { about: p.extract, aboutFrom: 'wikipedia' as const } : {}),
    ...(photo ? { photo } : {}),
    wikidata: p.wikidata,
    social: {},
    sources,
    score: 40 + (p.thumb ? 15 : 0) + (p.extract ? 5 : 0),
  };
}

/** The Wikipedia languages to ask: the app's own and English. */
export function wikiLangs(lang: LangCode): string[] {
  return lang === 'en' ? ['en'] : [lang, 'en'];
}

/**
 * Photos (and the English article) for Wikidata items, in one query: the item's image (P18) as a
 * Commons file.
 */
export async function fetchWikidataPhotos(ids: string[], fetchFn: typeof fetch, signal?: AbortSignal): Promise<Map<string, { file?: string; enwiki?: string }>> {
  const out = new Map<string, { file?: string; enwiki?: string }>();
  const list = [...new Set(ids.filter((id) => /^Q\d+$/.test(id)))].slice(0, 60);
  if (!list.length) return out;
  const q = `SELECT ?item ?image ?enwiki WHERE { VALUES ?item { ${list.map((id) => `wd:${id}`).join(' ')} } OPTIONAL { ?item wdt:P18 ?image. } OPTIONAL { ?enwiki schema:about ?item; schema:isPartOf <https://en.wikipedia.org/>. } }`;
  const res = await fetchFn(`https://query.wikidata.org/sparql?format=json&query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/sparql-results+json', ...WIKI_HEADERS }, signal });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const json = (await res.json()) as { results?: { bindings?: { item?: { value: string }; image?: { value: string }; enwiki?: { value: string } }[] } };
  for (const b of json.results?.bindings ?? []) {
    const id = b.item?.value.split('/').pop();
    if (!id) continue;
    const cur = out.get(id) ?? {};
    if (b.image && !cur.file) {
      const raw = b.image.value.split('Special:FilePath/')[1];
      if (raw) {
        let name = raw;
        try {
          name = decodeURIComponent(raw);
        } catch {
          /* as it is */
        }
        cur.file = `File:${name.replace(/_/g, ' ')}`;
      }
    }
    if (b.enwiki && !cur.enwiki) cur.enwiki = b.enwiki.value;
    out.set(id, cur);
  }
  return out;
}

/** A Wikidata photo as a place's photo. */
export function wikidataPhoto(file: string): DiscoverPhoto {
  return { url: commonsThumb(file), file, page: commonsPage(file) };
}

/** Who took a Commons photo and its licence ("Jane Doe, CC BY-SA 4.0"), and its page. */
export async function fetchPhotoCredit(file: string, fetchFn: typeof fetch, signal?: AbortSignal): Promise<{ credit: string; page: string } | null> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&format=json&formatversion=2&origin=*&prop=imageinfo&iiprop=extmetadata|url&iiextmetadatafilter=Artist|LicenseShortName&titles=${encodeURIComponent(file)}`;
  const res = await fetchFn(url, { headers: WIKI_HEADERS, signal });
  if (!res.ok) return null;
  const json = (await res.json()) as {
    query?: { pages?: { imageinfo?: { descriptionurl?: string; extmetadata?: { Artist?: { value?: string }; LicenseShortName?: { value?: string } } }[] }[] };
  };
  const info = json.query?.pages?.[0]?.imageinfo?.[0];
  if (!info) return null;
  const strip = (s: string | undefined) =>
    (s ?? '')
      .replace(/<[^>]+>/g, '')
      .replace(/&amp;/g, '&')
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  const artist = strip(info.extmetadata?.Artist?.value).slice(0, 80);
  const licence = strip(info.extmetadata?.LicenseShortName?.value);
  const credit = [artist, licence].filter(Boolean).join(', ');
  return { credit: credit || 'Wikimedia Commons', page: info.descriptionurl ?? commonsPage(file) };
}
