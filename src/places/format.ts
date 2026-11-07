/**
 * Places around you: the data the Places workflow publishes (scripts/places, weekly) and the app
 * downloads for the area within 50 to 150 km of where you are (src/places/places.worker.ts).
 *
 * Shared by the builder (Node runs this file directly, so it uses only erasable TypeScript and
 * imports nothing) and the app.
 *
 * The data is split into cells of 0.25° (about 28 km): places/cells/<ix>_<iy>.json, where ix and
 * iy are the cell's south-west corner divided by 0.25, listed in places/manifest.json with a hash
 * each, so an update downloads only the cells that changed.
 */

export const PLACES_VERSION = 1;
/** Cell size in degrees. */
export const CELL_DEG = 0.25;

export type PlaceGroup =
  | 'food'
  | 'cafe'
  | 'grocery'
  | 'mall'
  | 'shop'
  | 'fuel'
  | 'ev'
  | 'parking'
  | 'car'
  | 'rest'
  | 'hotel'
  | 'health'
  | 'education'
  | 'worship'
  | 'bank'
  | 'government'
  | 'transport'
  | 'attraction'
  | 'park'
  | 'sport'
  | 'leisure'
  | 'service'
  | 'office'
  | 'locality'
  | 'other';

export interface GroupInfo {
  /** Icon disc colour on the map. */
  color: string;
  /** Shown on the map from this zoom (the most useful kinds first). */
  minZoom: number;
  /** Starting rank (0 to 100) for places of this group. */
  rank: number;
  label: { en: string; ms: string; ja: string };
}

export const GROUPS: Record<PlaceGroup, GroupInfo> = {
  food: { color: '#ea580c', minZoom: 15, rank: 36, label: { en: 'Food and drink', ms: 'Makanan dan minuman', ja: '飲食店' } },
  cafe: { color: '#c2410c', minZoom: 15.5, rank: 30, label: { en: 'Café', ms: 'Kafe', ja: 'カフェ' } },
  grocery: { color: '#2563eb', minZoom: 15, rank: 34, label: { en: 'Groceries', ms: 'Barangan runcit', ja: 'スーパー・コンビニ' } },
  mall: { color: '#4f46e5', minZoom: 13, rank: 70, label: { en: 'Shopping mall', ms: 'Pusat beli-belah', ja: 'ショッピングモール' } },
  shop: { color: '#3b82f6', minZoom: 16, rank: 20, label: { en: 'Shop', ms: 'Kedai', ja: 'ショップ' } },
  fuel: { color: '#0f766e', minZoom: 14, rank: 55, label: { en: 'Petrol station', ms: 'Stesen minyak', ja: 'ガソリンスタンド' } },
  ev: { color: '#16a34a', minZoom: 14.5, rank: 45, label: { en: 'EV charging', ms: 'Pengecas EV', ja: 'EV充電' } },
  parking: { color: '#1d4ed8', minZoom: 16, rank: 22, label: { en: 'Parking', ms: 'Tempat letak kereta', ja: '駐車場' } },
  car: { color: '#475569', minZoom: 16.5, rank: 15, label: { en: 'Car services', ms: 'Servis kenderaan', ja: '自動車サービス' } },
  rest: { color: '#0f766e', minZoom: 12, rank: 70, label: { en: 'Rest area', ms: 'R&R', ja: 'SA・PA' } },
  hotel: { color: '#db2777', minZoom: 15, rank: 42, label: { en: 'Hotel', ms: 'Hotel', ja: 'ホテル' } },
  health: { color: '#dc2626', minZoom: 15, rank: 34, label: { en: 'Health', ms: 'Kesihatan', ja: '医療' } },
  education: { color: '#a16207', minZoom: 15, rank: 34, label: { en: 'Education', ms: 'Pendidikan', ja: '教育' } },
  worship: { color: '#57534e', minZoom: 15, rank: 40, label: { en: 'Place of worship', ms: 'Rumah ibadat', ja: '礼拝所' } },
  bank: { color: '#047857', minZoom: 16, rank: 26, label: { en: 'Bank and ATM', ms: 'Bank dan ATM', ja: '銀行・ATM' } },
  government: { color: '#475569', minZoom: 15, rank: 38, label: { en: 'Public service', ms: 'Perkhidmatan awam', ja: '公共機関' } },
  transport: { color: '#0284c7', minZoom: 13.5, rank: 62, label: { en: 'Transport', ms: 'Pengangkutan', ja: '交通' } },
  attraction: { color: '#0d9488', minZoom: 14, rank: 58, label: { en: 'Attraction', ms: 'Tarikan', ja: '観光スポット' } },
  park: { color: '#15803d', minZoom: 14.5, rank: 46, label: { en: 'Park', ms: 'Taman', ja: '公園' } },
  sport: { color: '#0891b2', minZoom: 16, rank: 26, label: { en: 'Sport and fitness', ms: 'Sukan dan kecergasan', ja: 'スポーツ' } },
  leisure: { color: '#9333ea', minZoom: 15.5, rank: 32, label: { en: 'Entertainment', ms: 'Hiburan', ja: 'レジャー' } },
  service: { color: '#6b7280', minZoom: 17, rank: 12, label: { en: 'Service', ms: 'Perkhidmatan', ja: 'サービス' } },
  office: { color: '#64748b', minZoom: 17, rank: 8, label: { en: 'Office', ms: 'Pejabat', ja: 'オフィス' } },
  locality: { color: '#64748b', minZoom: 99, rank: 0, label: { en: 'Place', ms: 'Tempat', ja: '地名' } },
  other: { color: '#78716c', minZoom: 17.5, rank: 5, label: { en: 'Place', ms: 'Tempat', ja: 'スポット' } },
};

export const GROUP_IDS = Object.keys(GROUPS) as PlaceGroup[];

/** What a place's detail line holds (short keys keep the files small). */
export interface PlaceDetails {
  /** Name in English, when the main name is in another language or script. */
  e?: string;
  /** Address. */
  a?: string;
  /** Phone. */
  t?: string;
  /** Website (or the place's social media page when it has no website). */
  w?: string;
  /** Opening hours, OSM syntax ("Mo-Fr 08:00-17:00"). */
  h?: string;
  /** Cuisine ("malaysian;indian"). */
  c?: string;
  /** Brand. */
  b?: string;
  /** Source: Overture Maps, OpenStreetMap, or both. */
  s?: 'o' | 'm' | 'om';
}

/** What the place card shows for a place from the places data. */
export interface PlaceInfo {
  group: PlaceGroup;
  /** The kind in words ("Malaysian restaurant"). */
  label: string;
  address?: string;
  phone?: string;
  website?: string;
  hours?: string;
  cuisine?: string;
  brand?: string;
  source?: 'o' | 'm' | 'om';
}

/** One place: name, index into the cell's categories, longitude and latitude ×1e5, rank 0 to 100, details. */
export type PlaceRow = [name: string, cat: number, x: number, y: number, rank: number, details?: PlaceDetails];

export interface CellFile {
  v: number;
  id: string;
  /** Not written by the builder (the manifest has it), so unchanged cells keep their hash. */
  built?: string;
  /** Categories used in this cell: the source's own key ("malaysian_restaurant") and its group. */
  cats: [string, PlaceGroup][];
  /** Highest rank first. */
  p: PlaceRow[];
}

export interface PlacesManifest {
  v: number;
  built: string;
  /** Overture release and OSM extract date the data comes from. */
  sources: { overture?: string; osm?: string };
  cell: number;
  /** Total places, and per cell: places, bytes and a hash of the file. */
  count: number;
  cells: Record<string, { n: number; b: number; h: string }>;
  attribution: string;
  license: string;
}

export const PLACES_ATTRIBUTION = '<a href="https://overturemaps.org" target="_blank" rel="noopener">© Overture Maps Foundation</a> <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">© OpenStreetMap</a>';
export const PLACES_LICENSE = 'Overture Maps places: CDLA Permissive 2.0 (https://cdla.dev/permissive-2-0/). OpenStreetMap: ODbL 1.0 (https://www.openstreetmap.org/copyright).';

/* ------------------------------------------------------------------ cells */

export function cellIndex(lon: number, lat: number): [number, number] {
  return [Math.floor(lon / CELL_DEG + 1e-9), Math.floor(lat / CELL_DEG + 1e-9)];
}

export function cellId(lon: number, lat: number): string {
  const [ix, iy] = cellIndex(lon, lat);
  return `${ix}_${iy}`;
}

/** [west, south, east, north] of a cell. */
export function cellBounds(id: string): [number, number, number, number] {
  const [ix, iy] = id.split('_').map(Number);
  return [ix * CELL_DEG, iy * CELL_DEG, (ix + 1) * CELL_DEG, (iy + 1) * CELL_DEG];
}

const R = 6371008.8;
const rad = Math.PI / 180;

export function metres(a: [number, number], b: [number, number]): number {
  const dLat = (b[1] - a[1]) * rad;
  const dLon = (b[0] - a[0]) * rad;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * rad) * Math.cos(b[1] * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** The cells any part of which lies within `km` of the point. */
export function cellsInCircle(center: [number, number], km: number): string[] {
  const [lon, lat] = center;
  const dLat = km / 110.574;
  const dLon = km / (111.32 * Math.max(0.05, Math.cos(lat * rad)));
  const [x0, y0] = cellIndex(lon - dLon, lat - dLat);
  const [x1, y1] = cellIndex(lon + dLon, lat + dLat);
  const out: string[] = [];
  for (let ix = x0; ix <= x1; ix++) {
    for (let iy = y0; iy <= y1; iy++) {
      const w = ix * CELL_DEG;
      const s = iy * CELL_DEG;
      const nearest: [number, number] = [Math.min(Math.max(lon, w), w + CELL_DEG), Math.min(Math.max(lat, s), s + CELL_DEG)];
      if (metres(center, nearest) <= km * 1000) out.push(`${ix}_${iy}`);
    }
  }
  return out;
}

/* ------------------------------------------------------------------ categories */

/** Overture category keys to groups: the first rule that matches wins (most specific first). */
const OVERTURE_RULES: [RegExp, PlaceGroup][] = [
  [/ev_charging|charging_station/, 'ev'],
  [/gas_station|fuel|petrol/, 'fuel'],
  [/parking|car_park/, 'parking'],
  [/rest_area|rest_stop|service_area|truck_stop|highway_services/, 'rest'],
  [/shopping_cent|shopping_mall|^mall$|department_store|outlet_mall|outlet_store/, 'mall'],
  [/supermarket|grocery|convenience|hypermarket|minimarket|mini_mart|wet_market|night_market|farmers_market|^market|butcher|fishmonger|fruits?_and_vegetables|greengrocer/, 'grocery'],
  [/hospital|clinic|medical|doctor|dentist|dental|pharmacy|drugstore|physiotherap|optometrist|veterinar|maternity|diagnostic|laborator|chiropract|psychiatr|pediatric|surgeon|nursing|health_?care|traditional_chinese_medicine/, 'health'],
  [/mosque|surau|church|temple|shrine|synagogue|gurdwara|religious|place_of_worship|cathedral|chapel|monastery|buddhis|hindu|taois/, 'worship'],
  [/school|college|universit|kindergarten|preschool|education|tutor|academy|learning_cent|training_cent|library|childcare|day_care/, 'education'],
  [/^banks?$|bank_credit|^atms?$|credit_union|currency_exchange|money_transfer|financial_service/, 'bank'],
  [/police|post_office|government|city_hall|town_hall|courthouse|embassy|consulate|fire_station|fire_department|immigration|public_service|community_cent|civic_cent|social_service/, 'government'],
  [/airport|train_station|railway|metro|subway|bus_station|bus_stop|transit|ferry|taxi|light_rail|monorail|transportation/, 'transport'],
  [/hotel|motel|hostel|resort|guest_house|homestay|lodging|^inn$|bed_and_breakfast|accommodation|chalet|serviced_apartment|vacation_rental|campground|campsite/, 'hotel'],
  [/cafe|coffee|tea_room|tea_house|bubble_tea|juice|smoothie|dessert|bakery|bakeries|patisserie|ice_cream|cake|donut|kopitiam/, 'cafe'],
  [/restaurant|food|eatery|hawker|diner|bistro|steakhouse|buffet|barbecue|bbq|noodle|pizza|burger|sushi|ramen|seafood|canteen|catering|^bars?$|_bar$|^pub$|brewery|gastropub|lounge|dim_sum|nasi|mamak|halal/, 'food'],
  [/museum|landmark|historical|monument|tourist|attraction|^zoo|aquarium|art_gallery|^gallery|viewpoint|scenic|castle|palace|memorial|heritage|cultural_cent|planetarium|observatory|theme_park|amusement_park|water_park/, 'attraction'],
  [/^park$|_park$|garden|beach|^lake|waterfall|forest|nature|hiking|trail|playground|botanical|recreation_area|^island|mountain|^river|hot_spring/, 'park'],
  [/gym|fitness|sport|stadium|arena|golf|swimming|yoga|pilates|martial_arts|tennis|badminton|futsal|football|soccer|bowling|climbing|dance_studio|squash|cycling|skate|archery|shooting_range/, 'sport'],
  [/cinema|movie|theater|theatre|karaoke|arcade|amusement|entertainment|night_?club|casino|escape_room|event_venue|concert|music_venue|performing_arts|internet_cafe/, 'leisure'],
  [/car_dealer|car_rental|car_wash|car_repair|auto|automotive|tire|tyre|motorcycle|vehicle|mechanic|towing|windshield|car_battery|car_accessor|body_shop/, 'car'],
  [/pet_store|pet_shop|store|shop|retail|boutique|clothing|fashion|electronics|furniture|hardware|book|jewel|mobile_phone|florist|optician|eyewear|shoe|gift|toy|sporting_goods|cosmetic|watch|bicycle|music_instrument|stationery|appliance|computer/, 'shop'],
  [/beauty|hair|salon|barber|nail|spa|massage|laundr|dry_clean|tailor|repair|printing|photograph|cleaning|pet_|grooming|tattoo|locksmith|plumb|electrician|pest|moving|storage|courier|shipping|funeral|wedding|event_plann/, 'service'],
  [/office|company|agency|consult|lawyer|legal|attorney|accountant|accounting|insurance|real_estate|property|corporate|business|it_service|information_technology|software|marketing|advertising|engineering|construction|contractor|architect|design|manufactur|factory|industrial|wholesale|supplier|logistics|trading|travel_agen|professional_services/, 'office'],
];

export function overtureGroup(category: string | undefined | null): PlaceGroup {
  const c = (category ?? '').toLowerCase();
  if (!c) return 'other';
  for (const [re, g] of OVERTURE_RULES) if (re.test(c)) return g;
  return 'other';
}

const OSM_AMENITY: Record<string, PlaceGroup> = {
  restaurant: 'food',
  fast_food: 'food',
  food_court: 'food',
  bar: 'food',
  pub: 'food',
  biergarten: 'food',
  cafe: 'cafe',
  ice_cream: 'cafe',
  fuel: 'fuel',
  charging_station: 'ev',
  parking: 'parking',
  parking_entrance: 'parking',
  motorcycle_parking: 'parking',
  car_wash: 'car',
  car_rental: 'car',
  vehicle_inspection: 'car',
  hospital: 'health',
  clinic: 'health',
  doctors: 'health',
  dentist: 'health',
  pharmacy: 'health',
  veterinary: 'health',
  school: 'education',
  college: 'education',
  university: 'education',
  kindergarten: 'education',
  library: 'education',
  driving_school: 'education',
  language_school: 'education',
  childcare: 'education',
  place_of_worship: 'worship',
  bank: 'bank',
  atm: 'bank',
  bureau_de_change: 'bank',
  police: 'government',
  post_office: 'government',
  townhall: 'government',
  courthouse: 'government',
  fire_station: 'government',
  embassy: 'government',
  community_centre: 'government',
  social_facility: 'government',
  bus_station: 'transport',
  ferry_terminal: 'transport',
  taxi: 'transport',
  cinema: 'leisure',
  theatre: 'leisure',
  nightclub: 'leisure',
  casino: 'leisure',
  arts_centre: 'attraction',
  marketplace: 'grocery',
};

const OSM_SHOP: Record<string, PlaceGroup> = {
  supermarket: 'grocery',
  convenience: 'grocery',
  greengrocer: 'grocery',
  butcher: 'grocery',
  seafood: 'grocery',
  wholesale: 'grocery',
  bakery: 'cafe',
  pastry: 'cafe',
  mall: 'mall',
  department_store: 'mall',
  car: 'car',
  car_repair: 'car',
  car_parts: 'car',
  tyres: 'car',
  motorcycle: 'car',
  hairdresser: 'service',
  beauty: 'service',
  laundry: 'service',
  dry_cleaning: 'service',
  tailor: 'service',
  massage: 'service',
};

const OSM_TOURISM: Record<string, PlaceGroup> = {
  hotel: 'hotel',
  motel: 'hotel',
  hostel: 'hotel',
  guest_house: 'hotel',
  chalet: 'hotel',
  apartment: 'hotel',
  camp_site: 'hotel',
  attraction: 'attraction',
  museum: 'attraction',
  gallery: 'attraction',
  zoo: 'attraction',
  aquarium: 'attraction',
  theme_park: 'attraction',
  viewpoint: 'attraction',
};

const OSM_LEISURE: Record<string, PlaceGroup> = {
  park: 'park',
  garden: 'park',
  nature_reserve: 'park',
  playground: 'park',
  sports_centre: 'sport',
  stadium: 'sport',
  fitness_centre: 'sport',
  golf_course: 'sport',
  swimming_pool: 'sport',
  sports_hall: 'sport',
  water_park: 'attraction',
  amusement_arcade: 'leisure',
  bowling_alley: 'sport',
};

/** The group and category key of an OSM feature, or null when it is not a place worth listing. */
export function osmCategory(t: Record<string, string | undefined>): { key: string; group: PlaceGroup } | null {
  const religion = t.religion;
  if (t.amenity === 'place_of_worship') {
    const key = religion === 'muslim' ? 'mosque' : religion === 'christian' ? 'church' : religion === 'buddhist' || religion === 'hindu' || religion === 'taoist' || religion === 'chinese_folk' || religion === 'sikh' ? `${religion}_temple` : 'place_of_worship';
    return { key, group: 'worship' };
  }
  if (t.highway === 'services' || t.highway === 'rest_area') return { key: t.highway === 'services' ? 'rest_area' : 'rest_stop', group: 'rest' };
  if (t.amenity && OSM_AMENITY[t.amenity]) return { key: t.amenity, group: OSM_AMENITY[t.amenity] };
  if (t.shop) return { key: t.shop === 'yes' ? 'shop' : t.shop, group: OSM_SHOP[t.shop] ?? 'shop' };
  if (t.tourism && OSM_TOURISM[t.tourism]) return { key: t.tourism, group: OSM_TOURISM[t.tourism] };
  if (t.leisure && OSM_LEISURE[t.leisure]) return { key: t.leisure, group: OSM_LEISURE[t.leisure] };
  if (t.healthcare) return { key: t.healthcare === 'yes' ? 'healthcare' : t.healthcare, group: 'health' };
  if (t.railway === 'station' || t.railway === 'halt' || t.public_transport === 'station') return { key: 'train_station', group: 'transport' };
  if (t.aeroway === 'aerodrome' || t.aeroway === 'terminal') return { key: 'airport', group: 'transport' };
  if (t.historic && t.historic !== 'yes') return { key: t.historic, group: 'attraction' };
  if (t.office) return { key: t.office === 'yes' ? 'office' : t.office, group: 'office' };
  if (t.craft) return { key: t.craft, group: 'service' };
  if (t.place && ['city', 'town', 'village', 'suburb', 'quarter', 'neighbourhood', 'hamlet'].includes(t.place)) return { key: t.place, group: 'locality' };
  return null;
}

/** Plain words for a category key: "malaysian_restaurant" -> "Malaysian restaurant". */
const LABELS: Record<string, string> = {
  atm: 'ATM',
  atms: 'ATM',
  bank_credit_union: 'Bank',
  college_university: 'College or university',
  landmark_and_historical_building: 'Landmark',
  automotive_repair: 'Car repair',
  gas_station: 'Petrol station',
  fuel: 'Petrol station',
  ev_charging_station: 'EV charging',
  charging_station: 'EV charging',
  convenience: 'Convenience store',
  convenience_store: 'Convenience store',
  fast_food: 'Fast food',
  fast_food_restaurant: 'Fast food',
  doctors: 'Doctor',
  townhall: 'Town hall',
  marketplace: 'Market',
  place_of_worship: 'Place of worship',
  muslim_temple: 'Mosque',
  buddhist_temple: 'Buddhist temple',
  hindu_temple: 'Hindu temple',
  taoist_temple: 'Taoist temple',
  chinese_folk_temple: 'Chinese temple',
  sikh_temple: 'Gurdwara',
  rest_area: 'Rest area (R&R)',
  rest_stop: 'Rest stop',
  train_station: 'Station',
  hairdresser: 'Hair salon',
  car: 'Car dealer',
  supermarket: 'Supermarket',
  mall: 'Shopping mall',
  shopping_center: 'Shopping mall',
};

export function categoryLabel(key: string): string {
  if (LABELS[key]) return LABELS[key];
  const s = key.replace(/^(amenity|shop|tourism|leisure|office|craft|healthcare)=/, '').replace(/[_;]+/g, ' ').trim();
  return s ? s[0].toUpperCase() + s.slice(1) : 'Place';
}

/** How prominent a place is (0 to 100): its kind first, then what is known about it. */
export function placeRank(group: PlaceGroup, key: string, d: PlaceDetails, confidence?: number): number {
  let r = GROUPS[group].rank;
  if (/hospital|university|airport|train_station|stadium|shopping_cent|^mall$|museum/.test(key)) r += 15;
  if (d.b) r += 8;
  if (d.w || d.t) r += 6;
  if (d.h) r += 4;
  if (d.s === 'om') r += 8;
  if (confidence != null) r += Math.round((confidence - 0.6) * 20);
  return Math.max(0, Math.min(100, r));
}

/** Lower case, no accents, apostrophes or punctuation: what names are compared and searched by. */
export function normName(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** Two names for the same place ("McDonald's Bangsar" and "McDonalds")? */
export function sameName(a: string, b: string): boolean {
  const x = normName(a);
  const y = normName(b);
  if (!x || !y) return false;
  if (x === y || x.includes(y) || y.includes(x)) return true;
  const ta = new Set(x.split(' ').filter((w) => w.length > 1));
  const tb = new Set(y.split(' ').filter((w) => w.length > 1));
  if (!ta.size || !tb.size) return false;
  let common = 0;
  for (const w of ta) if (tb.has(w)) common++;
  return common / Math.min(ta.size, tb.size) >= 0.6;
}
