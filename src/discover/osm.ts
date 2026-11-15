/**
 * Discover places from OpenStreetMap (Overpass): attractions and landmarks, eateries that are
 * known (with a Wikipedia article, photo, website or their own Facebook, Instagram or TikTok
 * page), resorts, theme parks and water parks, shopping malls.
 */
import type { LngLat } from '../geo/geo';
import type { LangCode } from '../routing/instructions';
import { addSource, facebookUrl, instagramUrl, osmPhoto, socialLabel, tiktokUrl, websiteUrl, wikipediaUrl } from './links';
import type { DiscoverCat, DiscoverPlace, SourceLink } from './types';

/** Keys whose presence says an eatery is known beyond its street. */
const KNOWN = '^(wikidata|wikipedia|image|wikimedia_commons|website|contact:website|facebook|contact:facebook|instagram|contact:instagram|tiktok|contact:tiktok)$';

/** Overpass filters for each kind of place. */
export const OSM_FILTERS: Record<DiscoverCat, string[]> = {
  attractions: [
    '["tourism"~"^(attraction|museum|gallery|viewpoint|zoo|aquarium)$"]["name"]',
    '["historic"~"^(monument|memorial|castle|fort|ruins|archaeological_site|palace|city_gate|building|heritage|temple)$"]["name"][~"^(wikidata|wikipedia|tourism|heritage)$"~"."]',
    '["natural"~"^(waterfall|beach|peak|cave_entrance|hot_spring)$"]["name"]',
    '["leisure"~"^(park|nature_reserve|garden)$"]["name"][~"^(wikidata|wikipedia)$"~"."]',
    '["amenity"="place_of_worship"]["name"]["wikidata"]',
    '["man_made"~"^(tower|lighthouse|bridge)$"]["name"]["wikidata"]',
    '["building"]["name"]["wikidata"]["height"]',
  ],
  food: [`["amenity"~"^(restaurant|cafe|food_court|ice_cream|fast_food)$"]["name"][~"${KNOWN}"~"."]`],
  resorts: ['["leisure"="resort"]["name"]', '["tourism"~"^(hotel|chalet|guest_house|camp_site|apartment)$"]["name"~"[Rr]esort|[Rr]etreat|RESORT|リゾート"]'],
  themeparks: ['["tourism"="theme_park"]["name"]', '["leisure"="water_park"]["name"]'],
  malls: ['["shop"~"^(mall|department_store)$"]["name"]'],
};

export function overpassQuery(cat: DiscoverCat, center: LngLat, radius: number): string {
  const around = `(around:${Math.round(radius)},${center[1].toFixed(5)},${center[0].toFixed(5)})`;
  const parts = OSM_FILTERS[cat].map((f) => `nwr${f}${around};`).join('');
  return `[out:json][timeout:25];(${parts});out center tags 300;`;
}

type Label = { en: string; ms: string; ja: string };
const KIND: Record<string, Label> = {
  'tourism=attraction': { en: 'Attraction', ms: 'Tarikan', ja: '観光スポット' },
  'tourism=museum': { en: 'Museum', ms: 'Muzium', ja: '博物館' },
  'tourism=gallery': { en: 'Gallery', ms: 'Galeri', ja: 'ギャラリー' },
  'tourism=viewpoint': { en: 'Viewpoint', ms: 'Tempat pandangan', ja: '展望スポット' },
  'tourism=zoo': { en: 'Zoo', ms: 'Zoo', ja: '動物園' },
  'tourism=aquarium': { en: 'Aquarium', ms: 'Akuarium', ja: '水族館' },
  'tourism=theme_park': { en: 'Theme park', ms: 'Taman tema', ja: 'テーマパーク' },
  'leisure=water_park': { en: 'Water park', ms: 'Taman air', ja: 'ウォーターパーク' },
  'leisure=resort': { en: 'Resort', ms: 'Resort', ja: 'リゾート' },
  'tourism=hotel': { en: 'Resort hotel', ms: 'Hotel resort', ja: 'リゾートホテル' },
  'tourism=chalet': { en: 'Chalet resort', ms: 'Chalet', ja: 'シャレー' },
  'tourism=camp_site': { en: 'Camp resort', ms: 'Tapak perkhemahan', ja: 'キャンプ場' },
  'shop=mall': { en: 'Shopping mall', ms: 'Pusat beli-belah', ja: 'ショッピングモール' },
  'shop=department_store': { en: 'Department store', ms: 'Gedung serbaneka', ja: '百貨店' },
  'amenity=restaurant': { en: 'Restaurant', ms: 'Restoran', ja: 'レストラン' },
  'amenity=cafe': { en: 'Café', ms: 'Kafe', ja: 'カフェ' },
  'amenity=food_court': { en: 'Food court', ms: 'Medan selera', ja: 'フードコート' },
  'amenity=ice_cream': { en: 'Ice cream', ms: 'Aiskrim', ja: 'アイスクリーム' },
  'amenity=fast_food': { en: 'Quick bites', ms: 'Makanan segera', ja: 'ファストフード' },
  'amenity=place_of_worship': { en: 'Place of worship', ms: 'Rumah ibadat', ja: '宗教施設' },
  'historic=monument': { en: 'Monument', ms: 'Monumen', ja: '記念碑' },
  'historic=memorial': { en: 'Memorial', ms: 'Tugu peringatan', ja: '記念碑' },
  'historic=castle': { en: 'Castle', ms: 'Istana kota', ja: '城' },
  'historic=fort': { en: 'Fort', ms: 'Kubu', ja: '砦' },
  'historic=ruins': { en: 'Ruins', ms: 'Runtuhan', ja: '遺跡' },
  'historic=archaeological_site': { en: 'Archaeological site', ms: 'Tapak arkeologi', ja: '遺跡' },
  'historic=palace': { en: 'Palace', ms: 'Istana', ja: '宮殿' },
  'historic=building': { en: 'Historic building', ms: 'Bangunan bersejarah', ja: '歴史的建造物' },
  'historic=temple': { en: 'Temple', ms: 'Kuil', ja: '寺院' },
  'natural=waterfall': { en: 'Waterfall', ms: 'Air terjun', ja: '滝' },
  'natural=beach': { en: 'Beach', ms: 'Pantai', ja: 'ビーチ' },
  'natural=peak': { en: 'Hill or peak', ms: 'Puncak', ja: '山' },
  'natural=cave_entrance': { en: 'Cave', ms: 'Gua', ja: '洞窟' },
  'natural=hot_spring': { en: 'Hot spring', ms: 'Kolam air panas', ja: '温泉' },
  'leisure=park': { en: 'Park', ms: 'Taman', ja: '公園' },
  'leisure=nature_reserve': { en: 'Nature reserve', ms: 'Hutan simpan', ja: '自然保護区' },
  'leisure=garden': { en: 'Garden', ms: 'Taman', ja: '庭園' },
  'man_made=tower': { en: 'Tower', ms: 'Menara', ja: 'タワー' },
  'man_made=lighthouse': { en: 'Lighthouse', ms: 'Rumah api', ja: '灯台' },
  'man_made=bridge': { en: 'Bridge', ms: 'Jambatan', ja: '橋' },
  building: { en: 'Landmark building', ms: 'Bangunan mercu tanda', ja: 'ランドマーク' },
};
const KIND_KEYS = ['tourism', 'leisure', 'shop', 'amenity', 'historic', 'natural', 'man_made'];

/** "Museum", "Malaysian restaurant", "Water park": the kind of place in words. */
export function osmKind(tags: Record<string, string>, lang: LangCode): string {
  for (const k of KIND_KEYS) {
    const v = tags[k];
    if (!v) continue;
    const l = KIND[`${k}=${v}`];
    if (!l) continue;
    const word = l[lang] ?? l.en;
    // "Malaysian restaurant" in English, with the first cuisine.
    if (k === 'amenity' && lang === 'en' && tags.cuisine && (v === 'restaurant' || v === 'cafe')) {
      const c = tags.cuisine.split(';')[0].trim().replace(/_/g, ' ');
      if (c && !/^(regional|local)$/.test(c)) return `${c[0].toUpperCase()}${c.slice(1)} ${word.toLowerCase()}`;
    }
    return word;
  }
  if (tags.building && tags.wikidata) return KIND.building[lang] ?? KIND.building.en;
  return '';
}

function address(t: Record<string, string>): string | undefined {
  if (t['addr:full']) return t['addr:full'];
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const s = [street, t['addr:suburb'] ?? t['addr:district'], t['addr:city'] ?? t['addr:place']].filter(Boolean).join(', ');
  return s || undefined;
}

/** How well known a place seems from its tags (higher first). */
export function osmScore(cat: DiscoverCat, t: Record<string, string>, photo: boolean, social: number): number {
  let s = 20;
  if (t.wikidata) s += 30;
  if (t.wikipedia) s += 15;
  if (photo) s += 15;
  s += Math.min(20, social * 8);
  if (t.website || t['contact:website']) s += 4;
  if (t.opening_hours) s += 2;
  if (t['name:en'] || t['name:ms'] || t['name:ja'] || t['name:zh']) s += 3;
  if (cat === 'attractions') {
    if (t.tourism === 'attraction' || t.tourism === 'museum' || t.tourism === 'zoo' || t.tourism === 'aquarium') s += 10;
    if (t.heritage) s += 6;
    if (t.tourism === 'viewpoint' && !t.wikidata) s -= 6;
  }
  if (cat === 'food') {
    if (t.amenity === 'fast_food') s -= 6;
    if (t.brand || t['brand:wikidata']) s -= 25;
  }
  if (cat === 'resorts' && t.leisure === 'resort') s += 8;
  if (cat === 'themeparks' && t.tourism === 'theme_park') s += 8;
  if (cat === 'malls' && t.shop === 'mall') s += 6;
  return s;
}

export interface OsmElement {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Record<string, string>;
}

/** One OSM object as a place to discover (null without a name or a position). */
export function osmPlace(e: OsmElement, cat: DiscoverCat, lang: LangCode): DiscoverPlace | null {
  const t = e.tags ?? {};
  const lat = e.lat ?? e.center?.lat;
  const lon = e.lon ?? e.center?.lon;
  const name = t[`name:${lang}`] || (lang === 'en' ? t['name:en'] : '') || t.name;
  if (lat == null || lon == null || !name) return null;
  // Rides and shops inside a park or mall are part of it, not places of their own.
  if (t.attraction || (cat === 'food' && t.amenity === 'fast_food' && (t.brand || t['brand:wikidata']))) return null;
  const photo = osmPhoto(t);
  const fb = facebookUrl(t['contact:facebook'] ?? t.facebook);
  const ig = instagramUrl(t['contact:instagram'] ?? t.instagram);
  const tt = tiktokUrl(t['contact:tiktok'] ?? t.tiktok);
  const site = websiteUrl(t.website ?? t['contact:website'] ?? t.url);
  const wp = wikipediaUrl(t.wikipedia);
  const sources: SourceLink[] = [{ kind: 'osm', url: `https://www.openstreetmap.org/${e.type}/${e.id}`, label: 'OpenStreetMap' }];
  if (site) addSource(sources, { kind: 'website', url: site, label: site.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '').slice(0, 40) });
  if (fb) addSource(sources, { kind: 'facebook', url: fb, label: socialLabel(fb) });
  if (ig) addSource(sources, { kind: 'instagram', url: ig, label: socialLabel(ig) });
  if (tt) addSource(sources, { kind: 'tiktok', url: tt, label: socialLabel(tt) });
  if (wp) addSource(sources, { kind: 'wikipedia', url: wp.url, label: `Wikipedia: ${wp.title}` });
  if (t.wikidata) addSource(sources, { kind: 'wikidata', url: `https://www.wikidata.org/wiki/${t.wikidata}`, label: `Wikidata ${t.wikidata}` });
  const social = [fb, ig, tt].filter(Boolean).length;
  const cuisine = t.cuisine ? t.cuisine.split(';').map((c) => c.trim().replace(/_/g, ' ')).filter(Boolean).join(', ') : undefined;
  return {
    id: `osm:${e.type}/${e.id}`,
    name,
    lngLat: [lon, lat],
    cat,
    kind: osmKind(t, lang),
    ...(photo ? { photo } : {}),
    ...(t.description ? { about: t.description, aboutFrom: 'osm' as const } : {}),
    address: address(t),
    hours: t.opening_hours,
    phone: t.phone ?? t['contact:phone'],
    website: site ?? undefined,
    cuisine,
    area: t['addr:city'] ?? t['addr:suburb'] ?? t['addr:district'] ?? t['addr:place'],
    wikidata: /^Q\d+$/.test(t.wikidata ?? '') ? t.wikidata : undefined,
    social: { ...(fb ? { facebook: fb } : {}), ...(ig ? { instagram: ig } : {}), ...(tt ? { tiktok: tt } : {}) },
    sources,
    score: osmScore(cat, t, !!photo, social),
    ...(t.brand || t['brand:wikidata'] ? { chain: true } : {}),
  };
}

/** Asks Overpass for one kind of place around a point (trying each server in turn). */
export async function fetchOsm(
  cat: DiscoverCat,
  center: LngLat,
  radius: number,
  lang: LangCode,
  endpoints: string[],
  fetchFn: typeof fetch,
  signal?: AbortSignal,
): Promise<DiscoverPlace[]> {
  const q = overpassQuery(cat, center, radius);
  let last: unknown = new Error('No Overpass server');
  for (const url of endpoints) {
    try {
      const res = await fetchFn(url, { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(q), signal });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements?: OsmElement[] };
      const seen = new Set<string>();
      const out: DiscoverPlace[] = [];
      for (const e of json.elements ?? []) {
        const p = osmPlace(e, cat, lang);
        if (!p || seen.has(p.id)) continue;
        seen.add(p.id);
        out.push(p);
      }
      return out;
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      last = e;
    }
  }
  throw last instanceof Error ? last : new Error('Overpass unavailable');
}
