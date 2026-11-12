/**
 * The JunctionNav map: one look in two modes (light purple by day, dark purple by night), for the
 * online tiles (OpenFreeMap, OpenMapTiles schema) and the offline pack (Protomaps).
 *
 * The map is the stage for the route: quiet land, water and parks, roads in three tiers
 * (expressways stand out a little), labels in the palette's ink, and small icons for places from
 * street level. The route line on top (violet by day, glowing lilac by night) is the brightest
 * thing on screen.
 */
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { namedFlavor, type Flavor } from '@protomaps/basemaps';
import { themeFor, themeId } from '../theme/palette';

/* ------------------------------------------------------------------ offline (Protomaps) */

/** The Protomaps flavour in the JunctionNav palette. */
export function techFlavor(night: boolean): Flavor {
  const c = themeFor(night).map;
  const base = namedFlavor(night ? 'dark' : 'light');
  return {
    ...base,
    background: c.land,
    earth: c.land,
    park_a: c.park,
    park_b: c.park,
    hospital: c.urban,
    industrial: c.industrial,
    school: c.urban,
    wood_a: c.wood,
    wood_b: c.wood,
    pedestrian: c.urban,
    scrub_a: c.park,
    scrub_b: c.park,
    glacier: c.urban,
    sand: c.urban,
    beach: c.urban,
    aerodrome: c.industrial,
    runway: c.runway,
    water: c.water,
    zoo: c.park,
    military: c.industrial,
    tunnel_other_casing: c.land,
    tunnel_minor_casing: c.land,
    tunnel_link_casing: c.land,
    tunnel_major_casing: c.land,
    tunnel_highway_casing: c.land,
    tunnel_other: c.tunnel,
    tunnel_minor: c.tunnel,
    tunnel_link: c.tunnel,
    tunnel_major: c.tunnel,
    tunnel_highway: c.tunnel,
    pier: c.urban,
    buildings: c.building,
    minor_service_casing: c.minorCase,
    minor_casing: c.minorCase,
    link_casing: c.majorCase,
    major_casing_late: c.majorCase,
    highway_casing_late: c.highwayCase,
    other: c.minor,
    minor_service: c.minor,
    minor_a: c.minor,
    minor_b: c.minor,
    link: c.link,
    major_casing_early: c.majorCase,
    major: c.major,
    highway_casing_early: c.highwayCase,
    highway: c.highway,
    railway: c.rail,
    boundaries: c.boundary,
    bridges_other_casing: c.minorCase,
    bridges_minor_casing: c.minorCase,
    bridges_link_casing: c.majorCase,
    bridges_major_casing: c.majorCase,
    bridges_highway_casing: c.highwayCase,
    bridges_other: c.minor,
    bridges_minor: c.minor,
    bridges_link: c.link,
    bridges_major: c.major,
    bridges_highway: c.highway,
    roads_label_minor: c.label,
    roads_label_minor_halo: c.labelHalo,
    roads_label_major: c.labelMajor,
    roads_label_major_halo: c.labelHalo,
    ocean_label: c.label,
    subplace_label: c.label,
    subplace_label_halo: c.labelHalo,
    city_label: c.place,
    city_label_halo: c.labelHalo,
    state_label: c.label,
    state_label_halo: c.labelHalo,
    country_label: c.label,
    address_label: c.label,
    address_label_halo: c.labelHalo,
    landcover: {
      grassland: c.park,
      barren: c.urban,
      urban_area: c.urban,
      farmland: c.park,
      glacier: c.urban,
      scrub: c.park,
      forest: c.wood,
    },
  };
}

/* ------------------------------------------------------------------ online (OpenMapTiles) */

export const OFM_TILES = 'https://tiles.openfreemap.org/planet';
const OFM_GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';
const ATTRIBUTION =
  '<a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> Data from <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a>';

type Expr = ExpressionSpecification;
const zoomed = (...stops: number[]): Expr => ['interpolate', ['exponential', 1.5], ['zoom'], ...stops] as unknown as Expr;
const cls = (...v: string[]): Expr => ['match', ['get', 'class'], v, true, false] as unknown as Expr;
const brunnel = (v: 'bridge' | 'tunnel' | 'none'): Expr =>
  (v === 'none' ? ['!', ['match', ['get', 'brunnel'], ['bridge', 'tunnel'], true, false]] : ['==', ['get', 'brunnel'], v]) as unknown as Expr;
const all = (...e: Expr[]): Expr => ['all', ...e] as unknown as Expr;

function nameExpr(lang: string): Expr {
  if (lang === 'ja') return ['coalesce', ['get', 'name:ja'], ['get', 'name:latin'], ['get', 'name']] as unknown as Expr;
  if (lang === 'en') return ['coalesce', ['get', 'name:en'], ['get', 'name:latin'], ['get', 'name']] as unknown as Expr;
  return ['coalesce', ['get', 'name:latin'], ['get', 'name']] as unknown as Expr;
}

/** Road tiers: casing and fill widths per zoom, and their colours. */
const TIERS = [
  { id: 'minor', match: cls('minor', 'service', 'track'), w: [12, 0.5, 14, 2, 18, 14], min: 12 },
  { id: 'major', match: cls('primary', 'secondary', 'tertiary'), w: [8, 0.6, 12, 2.2, 14, 4, 18, 20], min: 7 },
  { id: 'highway', match: cls('motorway', 'trunk'), w: [5, 0.8, 10, 2.4, 14, 5.5, 18, 26], min: 5 },
] as const;

/**
 * The tiles' points of interest (OpenMapTiles classes) as the app's kinds of places, for the same
 * icons as the downloaded places (`place-<kind>`, drawn by src/map/placesLayer.ts). Where the
 * downloaded places cover the map, these are hidden in their favour.
 */
const POI_GROUP = [
  'match',
  ['get', 'class'],
  ['restaurant', 'fast_food', 'food_court', 'bar', 'beer', 'pub'],
  'food',
  ['cafe', 'ice_cream', 'bakery'],
  'cafe',
  ['grocery', 'supermarket', 'convenience', 'alcohol_shop', 'butcher', 'marketplace'],
  'grocery',
  ['mall', 'department_store'],
  'mall',
  ['shop', 'clothing_store', 'jewelry', 'furniture', 'florist', 'books', 'mobile_phone', 'electronics', 'hardware', 'gift', 'optician', 'shoes', 'stationery', 'toys', 'music', 'pet'],
  'shop',
  ['fuel'],
  'fuel',
  ['charging_station'],
  'ev',
  ['parking', 'bicycle_parking', 'motorcycle_parking'],
  'parking',
  ['car', 'car_repair', 'car_rental', 'motorcycle', 'bicycle'],
  'car',
  ['lodging', 'hotel', 'motel', 'hostel', 'campsite'],
  'hotel',
  ['hospital', 'doctors', 'dentist', 'pharmacy', 'clinic', 'veterinary'],
  'health',
  ['school', 'college', 'university', 'kindergarten', 'library'],
  'education',
  ['place_of_worship'],
  'worship',
  ['bank', 'atm'],
  'bank',
  ['police', 'post', 'town_hall', 'fire_station', 'embassy', 'courthouse'],
  'government',
  ['railway', 'bus', 'aerialway', 'ferry_terminal', 'harbor', 'airport', 'aerodrome'],
  'transport',
  ['attraction', 'museum', 'art_gallery', 'castle', 'monument', 'zoo', 'theme_park', 'viewpoint'],
  'attraction',
  ['park', 'garden', 'playground'],
  'park',
  ['stadium', 'sports', 'golf', 'swimming', 'pitch', 'fitness'],
  'sport',
  ['cinema', 'theatre', 'nightclub', 'casino'],
  'leisure',
  ['laundry', 'hairdresser', 'beauty'],
  'service',
  'other',
] as unknown as ExpressionSpecification;

/** The JunctionNav map on OpenFreeMap's free vector tiles (no key needed). */
export function techOnlineStyle(night: boolean, lang = 'en'): StyleSpecification {
  const c = themeFor(night).map;
  const name = nameExpr(lang);
  const src = 'openmaptiles';
  const layers: LayerSpecification[] = [];
  const add = (l: Record<string, unknown>) => layers.push({ source: src, ...l } as unknown as LayerSpecification);

  layers.push({ id: 'land', type: 'background', paint: { 'background-color': c.land } });
  add({ id: 'landuse-urban', type: 'fill', 'source-layer': 'landuse', filter: cls('residential', 'commercial', 'retail', 'school', 'hospital', 'university', 'college', 'stadium', 'pitch'), paint: { 'fill-color': c.urban } });
  add({ id: 'landuse-industrial', type: 'fill', 'source-layer': 'landuse', filter: cls('industrial', 'railway', 'military', 'quarry', 'garages'), paint: { 'fill-color': c.industrial } });
  add({ id: 'landcover-wood', type: 'fill', 'source-layer': 'landcover', filter: cls('wood', 'forest'), paint: { 'fill-color': c.wood } });
  add({ id: 'landcover-green', type: 'fill', 'source-layer': 'landcover', filter: cls('grass', 'farmland', 'wetland', 'park'), paint: { 'fill-color': c.park } });
  add({ id: 'park', type: 'fill', 'source-layer': 'park', paint: { 'fill-color': c.park } });
  add({ id: 'water', type: 'fill', 'source-layer': 'water', filter: ['!=', ['get', 'brunnel'], 'tunnel'], paint: { 'fill-color': c.water } });
  add({
    id: 'waterway',
    type: 'line',
    'source-layer': 'waterway',
    filter: ['!=', ['get', 'brunnel'], 'tunnel'],
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': c.waterLine,
      // Zoom has to be the outer expression; rivers and canals wider than streams and drains.
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, ['match', ['get', 'class'], ['river', 'canal'], 1, 0.3], 14, ['match', ['get', 'class'], ['river', 'canal'], 3, 1], 18, ['match', ['get', 'class'], ['river', 'canal'], 12, 4]],
    },
  });
  add({ id: 'runway', type: 'line', 'source-layer': 'aeroway', minzoom: 11, filter: cls('runway', 'taxiway'), paint: { 'line-color': c.runway, 'line-width': zoomed(11, 2, 16, 40) } });
  add({
    id: 'building',
    type: 'fill',
    'source-layer': 'building',
    minzoom: 14,
    paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingLine, 'fill-opacity': zoomed(14, 0, 15, 1) },
  });

  // Tunnels: a faint dashed line where the road runs underground.
  add({
    id: 'road-tunnel',
    type: 'line',
    'source-layer': 'transportation',
    minzoom: 12,
    filter: all(brunnel('tunnel'), cls('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'minor')),
    paint: { 'line-color': c.tunnel, 'line-width': zoomed(12, 1, 18, 14), 'line-dasharray': [1, 0.6] },
  });

  // Roads on the ground, then bridges on top: casings first, fills after, wider tiers last.
  for (const level of ['none', 'bridge'] as const) {
    const where = brunnel(level);
    for (const t of TIERS) {
      const col = t.id === 'highway' ? c.highwayCase : t.id === 'major' ? c.majorCase : c.minorCase;
      add({
        id: `road-${level}-${t.id}-case`,
        type: 'line',
        'source-layer': 'transportation',
        minzoom: t.min,
        filter: all(where, t.match),
        layout: { 'line-cap': level === 'bridge' ? 'butt' : 'round', 'line-join': 'round' },
        paint: { 'line-color': col, 'line-width': zoomed(...t.w.map((v, i) => (i % 2 ? v + (v > 2 ? 2 : 0.8) : v))) },
      });
    }
    for (const t of TIERS) {
      const col = t.id === 'highway' ? c.highway : t.id === 'major' ? c.major : c.minor;
      add({
        id: `road-${level}-${t.id}`,
        type: 'line',
        'source-layer': 'transportation',
        minzoom: t.min,
        filter: all(where, t.match),
        layout: { 'line-cap': level === 'bridge' ? 'butt' : 'round', 'line-join': 'round' },
        // Ramps a touch lighter than the road they leave, like the gore paint at an exit.
        paint: { 'line-color': ['case', ['==', ['get', 'ramp'], 1], c.link, col] as unknown as Expr, 'line-width': zoomed(...t.w) },
      });
    }
    if (level === 'none')
      add({
        id: 'rail',
        type: 'line',
        'source-layer': 'transportation',
        minzoom: 11,
        filter: all(brunnel('none'), cls('rail', 'transit')),
        paint: { 'line-color': c.rail, 'line-width': zoomed(11, 0.6, 18, 3), 'line-dasharray': [3, 2] },
      });
  }
  add({
    id: 'boundary',
    type: 'line',
    'source-layer': 'boundary',
    filter: ['<=', ['get', 'admin_level'], 4],
    paint: { 'line-color': c.boundary, 'line-width': zoomed(3, 0.6, 10, 1.4), 'line-dasharray': [3, 2] },
  });

  // Labels.
  const halo = { 'text-halo-color': c.labelHalo, 'text-halo-width': 1.6, 'text-halo-blur': 0.4 };
  add({
    id: 'water-name',
    type: 'symbol',
    'source-layer': 'water_name',
    minzoom: 12,
    layout: { 'text-field': name, 'text-font': ['Noto Sans Italic'], 'text-size': 12 },
    paint: { 'text-color': c.label, ...halo },
  });
  add({
    id: 'road-name-minor',
    type: 'symbol',
    'source-layer': 'transportation_name',
    minzoom: 14,
    filter: cls('minor', 'service'),
    layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': zoomed(14, 10, 18, 13), 'text-max-angle': 30 },
    paint: { 'text-color': c.label, ...halo },
  });
  add({
    id: 'road-name-major',
    type: 'symbol',
    'source-layer': 'transportation_name',
    minzoom: 11,
    filter: cls('primary', 'secondary', 'tertiary', 'trunk', 'motorway'),
    layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': zoomed(11, 10, 18, 14), 'text-max-angle': 30 },
    paint: { 'text-color': c.labelMajor, ...halo },
  });
  add({
    id: 'road-ref',
    type: 'symbol',
    'source-layer': 'transportation_name',
    minzoom: 9,
    filter: all(cls('motorway', 'trunk', 'primary'), ['has', 'ref'] as unknown as Expr),
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 420,
      'text-field': ['get', 'ref'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
      'text-rotation-alignment': 'viewport',
      'text-letter-spacing': 0.04,
    },
    paint: { 'text-color': c.labelMajor, 'text-halo-color': c.labelHalo, 'text-halo-width': 2.4 },
  });
  // Points of interest from street level (the more prominent from a little further out).
  add({
    id: 'poi',
    type: 'symbol',
    'source-layer': 'poi',
    minzoom: 14,
    filter: ['all', ['has', 'name'], ['<=', ['get', 'rank'], ['step', ['zoom'], 3, 15, 12, 16, 30, 17, 99]]] as unknown as Expr,
    layout: {
      'icon-image': ['concat', 'place-', POI_GROUP],
      'icon-size': zoomed(14, 0.75, 18, 1),
      'text-field': ['step', ['zoom'], '', 16, name],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-anchor': 'top',
      'text-offset': [0, 0.85],
      'text-max-width': 8,
      'text-optional': true,
      'symbol-sort-key': ['get', 'rank'],
    },
    paint: { 'text-color': c.label, ...halo },
  });
  add({
    id: 'place-minor',
    type: 'symbol',
    'source-layer': 'place',
    minzoom: 11,
    filter: cls('suburb', 'quarter', 'neighbourhood', 'village', 'hamlet'),
    layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': zoomed(11, 11, 16, 14), 'text-max-width': 8 },
    paint: { 'text-color': c.label, ...halo },
  });
  add({
    id: 'place-major',
    type: 'symbol',
    'source-layer': 'place',
    maxzoom: 15,
    filter: cls('city', 'town'),
    layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': zoomed(5, 11, 12, 18), 'text-max-width': 8 },
    paint: { 'text-color': c.place, ...halo },
  });

  return {
    version: 8,
    name: `JunctionNav ${night ? 'night' : 'day'}`,
    glyphs: OFM_GLYPHS,
    sources: { [src]: { type: 'vector', url: OFM_TILES, attribution: ATTRIBUTION } },
    layers,
  } as StyleSpecification;
}

/** One object per theme, mode and language, so style comparisons by identity stay stable. */
const cache = new Map<string, StyleSpecification>();
export function techStyle(night: boolean, lang: string): StyleSpecification {
  const k = `${themeId()}|${night ? 'n' : 'd'}|${lang}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = techOnlineStyle(night, lang)));
  return s;
}
