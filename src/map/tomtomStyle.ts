/**
 * The JunctionNav map on TomTom's vector tiles: the same look as src/map/techStyle.ts (light
 * purple by day, dark purple by night, roads in three tiers, labels in the palette's ink), drawn
 * from TomTom's map instead of OpenStreetMap, so TomTom's routes and traffic lie on the roads
 * they were planned on.
 *
 * TomTom's map display tiles (classic `/map/2/tile/basic` and Orbis `/maps/orbis/display/vector/tile`)
 * share one layout: `roads` (category motorway, trunk, primary, secondary, tertiary, street,
 * minor, path, ferry, railway; `bridge`, `tunnel`, `toll` flags; `direction` 1 or -1 for one-way
 * roads; `z_level`; `name`, `name_<lang>`; road numbers as `shield_icon_text_<n>`), `water`,
 * `water_lines`, `land_use`, `land_cover`, `earth_cover`, `buildings`, `boundaries`, `places`,
 * `poi_basic` and `carto_labels`. Categories are matched loosely (by part of the word) so a
 * category the style does not list still lands in the right group.
 *
 * Layer ids follow the OpenFreeMap style (`road-none-major`, `poi`, `water-name`, …), so the rest
 * of the app (traffic layer order, the 3D junction ground, the places layer) treats both alike.
 */
import type { ExpressionSpecification, LayerSpecification, StyleSpecification } from 'maplibre-gl';
import { themeFor } from '../theme/palette';

type Expr = ExpressionSpecification;
const e = (x: unknown) => x as Expr;

/** The vector source's id in the style (the map view tells its tile errors apart by it). */
export const TT_SOURCE = 'tomtom';
/** TomTom's tiles are fetched up to this zoom and drawn larger beyond it (fewer tiles to pay for). */
export const TT_MAXZOOM = 16;
/** The same words as the traffic layer's, so the map shows "© TomTom" once. */
export const TT_ATTRIBUTION = '<a href="https://www.tomtom.com" target="_blank" rel="noopener">© TomTom</a>';
const GLYPHS = 'https://tiles.openfreemap.org/fonts/{fontstack}/{range}.pbf';

const zoomed = (...stops: number[]): Expr => e(['interpolate', ['exponential', 1.5], ['zoom'], ...stops]);
const cat = (...v: string[]): Expr => e(['match', ['get', 'category'], v, true, false]);
/** The category (or subcategory) contains one of the words. */
const catHas = (key: 'category' | 'subcategory', ...words: string[]): Expr => e(['any', ...words.map((w) => ['in', w, ['coalesce', ['get', key], '']])]);
const flag = (k: string): Expr => e(['==', ['get', k], true]);
const notFlag = (k: string): Expr => e(['!=', ['get', k], true]);
const all = (...x: Expr[]): Expr => e(['all', ...x]);

/** Label in the app's language: TomTom names its languages with region tags (name_en-GB, name_ja-JP). */
export function ttName(lang: string): Expr {
  const keys =
    lang === 'ja'
      ? ['name_ja-JP', 'name_ja', 'name_ngt-Latn', 'name_en-GB', 'name']
      : lang === 'ms'
        ? ['name_ms-MY', 'name_ms', 'name_ngt-Latn', 'name', 'name_en-GB']
        : ['name_en-GB', 'name_en-US', 'name_ngt-Latn', 'name'];
  return e(['coalesce', ...keys.map((k) => ['get', k])]);
}

/** Road tiers as in the OpenFreeMap style. */
const TIERS = [
  { id: 'minor', match: cat('street', 'minor'), w: [12, 0.5, 14, 2, 18, 14], min: 12 },
  { id: 'major', match: cat('primary', 'secondary', 'tertiary'), w: [8, 0.6, 12, 2.2, 14, 4, 18, 20], min: 7 },
  { id: 'highway', match: cat('motorway', 'trunk'), w: [5, 0.8, 10, 2.4, 14, 5.5, 18, 26], min: 5 },
] as const;

/** TomTom's point-of-interest categories as the app's kinds of places (the `place-<kind>` icons). */
const POI_GROUP = e([
  'case',
  catHas('category', 'restaurant', 'fast_food', 'food'),
  'food',
  catHas('category', 'cafe', 'coffee', 'bakery'),
  'cafe',
  catHas('category', 'supermarket', 'grocery', 'convenience', 'market'),
  'grocery',
  catHas('category', 'shopping_center', 'mall', 'department_store'),
  'mall',
  catHas('category', 'gas_station', 'petrol', 'fuel'),
  'fuel',
  catHas('category', 'electric_vehicle', 'charging'),
  'ev',
  catHas('category', 'parking'),
  'parking',
  catHas('category', 'car_dealer', 'repair', 'rent_a_car', 'motoring'),
  'car',
  catHas('category', 'hotel', 'motel', 'hostel', 'camping', 'resort'),
  'hotel',
  catHas('category', 'hospital', 'medical', 'doctor', 'dentist', 'pharmacy', 'clinic', 'health', 'veterinar'),
  'health',
  catHas('category', 'school', 'college', 'universit', 'library', 'kindergarten', 'education'),
  'education',
  catHas('category', 'worship', 'mosque', 'church', 'temple'),
  'worship',
  catHas('category', 'bank', 'atm', 'exchange'),
  'bank',
  catHas('category', 'police', 'post_office', 'government', 'town_hall', 'city_hall', 'fire_station', 'embassy', 'court'),
  'government',
  catHas('category', 'airport', 'railroad', 'railway', 'station', 'transport', 'ferry', 'bus', 'port'),
  'transport',
  catHas('category', 'museum', 'attraction', 'monument', 'zoo', 'amusement', 'theme_park', 'scenic', 'tourist'),
  'attraction',
  catHas('category', 'park', 'garden', 'playground'),
  'park',
  catHas('category', 'stadium', 'sport', 'golf', 'swimming', 'fitness'),
  'sport',
  catHas('category', 'cinema', 'theater', 'theatre', 'nightlife', 'casino', 'entertainment'),
  'leisure',
  catHas('category', 'shop', 'store'),
  'shop',
  'other',
]);

/** The JunctionNav map on TomTom's tiles (`tiles`: the tile address with the key). */
export function tomtomMapStyle(night: boolean, lang: string, tiles: string): StyleSpecification {
  const c = themeFor(night).map;
  const name = ttName(lang);
  const layers: LayerSpecification[] = [];
  const add = (l: Record<string, unknown>) => layers.push({ source: TT_SOURCE, ...l } as unknown as LayerSpecification);
  const urban = catHas('category', 'built_up', 'residential', 'commercial', 'retail', 'shopping', 'hospital', 'school', 'universit', 'college', 'stadium', 'sport');
  const industrial = catHas('category', 'industr', 'airport', 'military', 'quarry', 'port', 'railway', 'harbour', 'harbor');
  const green = catHas('category', 'park', 'garden', 'golf', 'cemetery', 'recreation', 'zoo', 'nature', 'grass', 'playground');
  const wood = catHas('category', 'forest', 'wood');

  layers.push({ id: 'land', type: 'background', paint: { 'background-color': c.land } });
  add({ id: 'landcover-wood', type: 'fill', 'source-layer': 'earth_cover', filter: catHas('category', 'wood', 'forest'), paint: { 'fill-color': c.wood } });
  add({ id: 'landcover-green', type: 'fill', 'source-layer': 'earth_cover', filter: catHas('category', 'herbaceous', 'cropland', 'grass', 'shrub'), paint: { 'fill-color': c.park } });
  add({ id: 'landcover-sand', type: 'fill', 'source-layer': 'land_cover', filter: catHas('category', 'beach', 'sand', 'dune'), paint: { 'fill-color': c.urban } });
  add({ id: 'landcover-heath', type: 'fill', 'source-layer': 'land_cover', filter: catHas('category', 'moor', 'heath'), paint: { 'fill-color': c.park } });
  add({ id: 'landuse-urban', type: 'fill', 'source-layer': 'land_use', filter: urban, paint: { 'fill-color': c.urban } });
  add({ id: 'landuse-industrial', type: 'fill', 'source-layer': 'land_use', filter: industrial, paint: { 'fill-color': c.industrial } });
  add({ id: 'park', type: 'fill', 'source-layer': 'land_use', filter: green, paint: { 'fill-color': c.park } });
  add({ id: 'landuse-wood', type: 'fill', 'source-layer': 'land_use', filter: wood, paint: { 'fill-color': c.wood } });
  add({ id: 'water', type: 'fill', 'source-layer': 'water', paint: { 'fill-color': c.water } });
  add({
    id: 'waterway',
    type: 'line',
    'source-layer': 'water_lines',
    layout: { 'line-cap': 'round' },
    paint: {
      'line-color': c.waterLine,
      'line-width': ['interpolate', ['exponential', 1.5], ['zoom'], 10, ['match', ['get', 'subcategory'], ['river', 'canal'], 1, 0.3], 14, ['match', ['get', 'subcategory'], ['river', 'canal'], 3, 1], 18, ['match', ['get', 'subcategory'], ['river', 'canal'], 12, 4]],
    },
  });
  add({
    id: 'building',
    type: 'fill',
    'source-layer': 'buildings',
    minzoom: 14,
    paint: { 'fill-color': c.building, 'fill-outline-color': c.buildingLine, 'fill-opacity': zoomed(14, 0, 15, 1) },
  });

  // Tunnels: a faint dashed line where the road runs underground.
  add({
    id: 'road-tunnel',
    type: 'line',
    'source-layer': 'roads',
    minzoom: 12,
    filter: all(flag('tunnel'), cat('motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'street')),
    paint: { 'line-color': c.tunnel, 'line-width': zoomed(12, 1, 18, 14), 'line-dasharray': [1, 0.6] },
  });

  // Roads on the ground, then bridges on top: casings first, fills after, wider tiers last.
  const sortKey = e(['coalesce', ['get', 'z_level'], 0]);
  for (const level of ['none', 'bridge'] as const) {
    const where = level === 'bridge' ? all(flag('bridge'), notFlag('tunnel')) : all(notFlag('bridge'), notFlag('tunnel'));
    for (const t of TIERS) {
      const col = t.id === 'highway' ? c.highwayCase : t.id === 'major' ? c.majorCase : c.minorCase;
      add({
        id: `road-${level}-${t.id}-case`,
        type: 'line',
        'source-layer': 'roads',
        minzoom: t.min,
        filter: all(where, t.match),
        layout: { 'line-cap': level === 'bridge' ? 'butt' : 'round', 'line-join': 'round', 'line-sort-key': sortKey },
        paint: { 'line-color': col, 'line-width': zoomed(...t.w.map((v, i) => (i % 2 ? v + (v > 2 ? 2 : 0.8) : v))) },
      });
    }
    for (const t of TIERS) {
      const col = t.id === 'highway' ? c.highway : t.id === 'major' ? c.major : c.minor;
      add({
        id: `road-${level}-${t.id}`,
        type: 'line',
        'source-layer': 'roads',
        minzoom: t.min,
        filter: all(where, t.match),
        layout: { 'line-cap': level === 'bridge' ? 'butt' : 'round', 'line-join': 'round', 'line-sort-key': sortKey },
        paint: { 'line-color': col, 'line-width': zoomed(...t.w) },
      });
    }
    if (level === 'none')
      add({
        id: 'rail',
        type: 'line',
        'source-layer': 'roads',
        minzoom: 11,
        filter: all(notFlag('tunnel'), cat('railway')),
        paint: { 'line-color': c.rail, 'line-width': zoomed(11, 0.6, 18, 3), 'line-dasharray': [3, 2] },
      });
  }
  add({
    id: 'boundary',
    type: 'line',
    'source-layer': 'boundaries',
    filter: cat('country', 'state'),
    paint: { 'line-color': c.boundary, 'line-width': zoomed(3, 0.6, 10, 1.4), 'line-dasharray': [3, 2] },
  });

  // Labels.
  const halo = { 'text-halo-color': c.labelHalo, 'text-halo-width': 1.6, 'text-halo-blur': 0.4 };
  // Water names: lakes and seas as points, rivers along their line.
  for (const [id, geom, placement] of [
    ['water-name', 'Point', 'point'],
    ['water-name-line', 'LineString', 'line'],
  ] as const)
    add({
      id,
      type: 'symbol',
      'source-layer': 'carto_labels',
      minzoom: 12,
      filter: all(catHas('category', 'water'), e(['==', ['geometry-type'], geom])),
      layout: { 'symbol-placement': placement, 'text-field': name, 'text-font': ['Noto Sans Italic'], 'text-size': 12 },
      paint: { 'text-color': c.label, ...halo },
    });
  add({
    id: 'road-name-minor',
    type: 'symbol',
    'source-layer': 'roads',
    minzoom: 14,
    filter: cat('street', 'minor'),
    layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': zoomed(14, 10, 18, 13), 'text-max-angle': 30 },
    paint: { 'text-color': c.label, ...halo },
  });
  add({
    id: 'road-name-major',
    type: 'symbol',
    'source-layer': 'roads',
    minzoom: 11,
    filter: cat('primary', 'secondary', 'tertiary', 'trunk', 'motorway'),
    layout: { 'symbol-placement': 'line', 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': zoomed(11, 10, 18, 14), 'text-max-angle': 30 },
    paint: { 'text-color': c.labelMajor, ...halo },
  });
  add({
    id: 'road-ref',
    type: 'symbol',
    'source-layer': 'roads',
    minzoom: 9,
    filter: all(cat('motorway', 'trunk', 'primary'), e(['has', 'shield_icon_text_0'])),
    layout: {
      'symbol-placement': 'line',
      'symbol-spacing': 420,
      'text-field': ['get', 'shield_icon_text_0'],
      'text-font': ['Noto Sans Bold'],
      'text-size': 11,
      'text-rotation-alignment': 'viewport',
      'text-letter-spacing': 0.04,
    },
    paint: { 'text-color': c.labelMajor, 'text-halo-color': c.labelHalo, 'text-halo-width': 2.4 },
  });
  // Points of interest from street level (the more important ones from a little further out).
  add({
    id: 'poi',
    type: 'symbol',
    'source-layer': 'poi_basic',
    minzoom: 14,
    filter: e(['all', ['has', 'name'], ['<=', ['coalesce', ['get', 'priority'], 10], ['step', ['zoom'], 3, 15, 6, 16, 9, 17, 99]]]),
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
      'symbol-sort-key': ['coalesce', ['get', 'priority'], 10],
    },
    paint: { 'text-color': c.label, ...halo },
  });
  add({
    id: 'place-minor',
    type: 'symbol',
    'source-layer': 'places',
    minzoom: 11,
    filter: e(['any', ['==', ['get', 'category'], 'settlement_division'], ['match', ['get', 'subcategory'], ['village', 'hamlet', 'neighbourhood'], true, false]]),
    layout: { 'text-field': name, 'text-font': ['Noto Sans Regular'], 'text-size': zoomed(11, 11, 16, 14), 'text-max-width': 8 },
    paint: { 'text-color': c.label, ...halo },
  });
  add({
    id: 'place-major',
    type: 'symbol',
    'source-layer': 'places',
    maxzoom: 15,
    filter: e(['all', ['==', ['get', 'category'], 'settlement'], ['match', ['get', 'subcategory'], ['city', 'town'], true, false]]),
    layout: { 'text-field': name, 'text-font': ['Noto Sans Bold'], 'text-size': zoomed(5, 11, 12, 18), 'text-max-width': 8, 'symbol-sort-key': ['coalesce', ['get', 'priority'], 50] },
    paint: { 'text-color': c.place, ...halo },
  });

  return {
    version: 8,
    name: `JunctionNav ${night ? 'night' : 'day'} (TomTom)`,
    glyphs: GLYPHS,
    sources: { [TT_SOURCE]: { type: 'vector', tiles: [tiles], minzoom: 0, maxzoom: TT_MAXZOOM, attribution: TT_ATTRIBUTION } },
    layers,
  } as StyleSpecification;
}

/** One object per mode, language and tile address, so style comparisons by identity stay stable. */
const cache = new Map<string, StyleSpecification>();
export function tomtomStyle(night: boolean, lang: string, tiles: string): StyleSpecification {
  const k = `${night ? 'n' : 'd'}|${lang}|${tiles}`;
  let s = cache.get(k);
  if (!s) cache.set(k, (s = tomtomMapStyle(night, lang, tiles)));
  return s;
}
