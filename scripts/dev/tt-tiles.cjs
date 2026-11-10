/**
 * Tiles in TomTom's map layout made from saved OpenFreeMap tiles (OpenMapTiles layout), for
 * checking the TomTom map style and its fallbacks in a browser without a TomTom key. Layers and
 * values follow TomTom's documented vector tile content: roads (category, subcategory, bridge,
 * tunnel, direction, name, shield_icon_text_0), water, water_lines, land_use, earth_cover,
 * buildings, places, poi_basic, carto_labels.
 *
 *   const { ttTile } = require('./tt-tiles.cjs');
 *   ttTile(dir, z, x, y) // Buffer (z14 to z16 from the z14 tile above; lower zooms: that tile's content)
 */
const { VectorTile } = require('@mapbox/vector-tile');
const Pbf = require('pbf').default ?? require('pbf');
const vtpbf = require('vt-pbf');
const { existsSync, readFileSync } = require('node:fs');
const { join } = require('node:path');

const ROAD = {
  motorway: 'motorway',
  trunk: 'trunk',
  primary: 'primary',
  secondary: 'secondary',
  tertiary: 'tertiary',
  minor: 'street',
  service: 'minor',
  track: 'path',
  path: 'path',
  rail: 'railway',
  transit: 'railway',
  ferry: 'ferry',
};
const LAND = { residential: 'built_up_area', commercial: 'built_up_area', retail: 'built_up_area', industrial: 'industrial_area', school: 'school', university: 'university', hospital: 'hospital', cemetery: 'cemetery', stadium: 'stadium' };
const COVER = { wood: 'woody', forest: 'woody', grass: 'herbaceous', farmland: 'cropland', sand: 'sand' };
const POI = {
  restaurant: 'restaurant',
  fast_food: 'restaurant',
  cafe: 'cafe_or_pub',
  bar: 'cafe_or_pub',
  fuel: 'gas_station',
  charging_station: 'electric_vehicle_station',
  parking: 'open_parking_area',
  hospital: 'hospital',
  pharmacy: 'pharmacy',
  school: 'school',
  college: 'college_or_university',
  university: 'college_or_university',
  place_of_worship: 'place_of_worship',
  bank: 'bank',
  atm: 'atm',
  police: 'police_station',
  post: 'post_office',
  railway: 'railroad_station',
  bus: 'public_transportation_stop',
  museum: 'museum',
  attraction: 'tourist_attraction',
  park: 'park_and_recreation_area',
  hotel: 'hotel_or_motel',
  lodging: 'hotel_or_motel',
  grocery: 'market',
  supermarket: 'market',
  convenience: 'shop',
  shop: 'shop',
  mall: 'shopping_center',
};

/** A layer of re-labelled features in vt-pbf's VectorTileJS shape. */
function layer(name, feats, extent) {
  return { name, version: 2, extent, length: feats.length, feature: (i) => feats[i] };
}

function feat(src, props, geom, type) {
  return { type: type ?? src.type, id: src.id, properties: props, loadGeometry: () => geom ?? src.loadGeometry() };
}

/** The z14 tile in TomTom's layout (geometry scaled and shifted for a tile `dz` zooms deeper). */
function convert(buf, dz = 0, ox = 0, oy = 0) {
  const vt = new VectorTile(new Pbf(buf));
  const s = 2 ** dz;
  const ext = 4096;
  const geomOf = (f) =>
    dz === 0
      ? f.loadGeometry()
      : f.loadGeometry().map((ring) => ring.map((p) => ({ x: Math.round((p.x - (ox * ext) / s) * s), y: Math.round((p.y - (oy * ext) / s) * s) })));
  const out = { roads: [], water: [], water_lines: [], land_use: [], earth_cover: [], buildings: [], places: [], poi_basic: [], carto_labels: [] };
  const each = (name, fn) => {
    const l = vt.layers[name];
    if (!l) return;
    for (let i = 0; i < l.length; i++) fn(l.feature(i));
  };
  each('transportation', (f) => {
    const p = f.properties;
    const category = ROAD[p.class];
    if (!category) return;
    const props = { category };
    if (p.class === 'service') props.subcategory = 'service';
    if (p.brunnel === 'bridge') props.bridge = true;
    if (p.brunnel === 'tunnel') props.tunnel = true;
    if (p.oneway === 1 || p.oneway === -1) props.direction = p.oneway;
    if (p.layer) props.z_level = Math.max(-3, Math.min(3, Number(p.layer)));
    out.roads.push(feat(f, props, geomOf(f)));
  });
  // Names and road numbers ride on the roads in TomTom's tiles.
  each('transportation_name', (f) => {
    const p = f.properties;
    const category = ROAD[p.class];
    if (!category || !p.name) return;
    const props = { category, name: p.name, 'name_en-GB': p['name:en'] ?? p.name };
    if (p.ref) props.shield_icon_text_0 = String(p.ref).split(';')[0];
    out.roads.push(feat(f, props, geomOf(f)));
  });
  each('water', (f) => out.water.push(feat(f, { category: 'permanent_water' }, geomOf(f))));
  each('waterway', (f) => out.water_lines.push(feat(f, { category: 'permanent_water', subcategory: f.properties.class === 'river' ? 'river' : 'stream' }, geomOf(f))));
  each('landuse', (f) => {
    const c = LAND[f.properties.class];
    if (c) out.land_use.push(feat(f, { category: c }, geomOf(f)));
  });
  each('park', (f) => out.land_use.push(feat(f, { category: 'park' }, geomOf(f))));
  each('landcover', (f) => {
    const c = COVER[f.properties.class];
    if (c) out.earth_cover.push(feat(f, { category: c }, geomOf(f)));
  });
  each('building', (f) => out.buildings.push(feat(f, { height: Number(f.properties.render_height ?? 10) }, geomOf(f))));
  each('place', (f) => {
    const c = f.properties.class;
    const big = ['city', 'town'].includes(c);
    out.places.push(feat(f, { category: big ? 'settlement' : 'settlement_division', subcategory: big ? c : 'neighbourhood', name: f.properties.name, 'name_en-GB': f.properties['name:en'] ?? f.properties.name, priority: Number(f.properties.rank ?? 10) }, geomOf(f)));
  });
  each('poi', (f) => {
    const c = POI[f.properties.class] ?? POI[f.properties.subclass];
    if (!c || !f.properties.name) return;
    out.poi_basic.push(feat(f, { category: c, name: f.properties.name, 'name_en-GB': f.properties['name:en'] ?? f.properties.name, priority: Number(f.properties.rank ?? 10) }, geomOf(f)));
  });
  each('water_name', (f) => out.carto_labels.push(feat(f, { category: 'permanent_water', subcategory: f.type === 1 ? 'lake' : 'river', name: f.properties.name }, geomOf(f))));
  const layers = {};
  for (const [k, v] of Object.entries(out)) if (v.length) layers[k] = layer(k, v, ext);
  return Buffer.from(vtpbf.fromVectorTileJs({ layers }));
}

/** A TomTom-layout tile for z/x/y from the saved z14 OpenFreeMap tiles in `dir` (null when there is none). */
function ttTile(dir, z, x, y) {
  if (z >= 14) {
    const dz = z - 14;
    const px = x >> dz;
    const py = y >> dz;
    const f = join(dir, `${px}-${py}.pbf`);
    if (!existsSync(f)) return null;
    return convert(readFileSync(f), dz, x - (px << dz), y - (py << dz));
  }
  // Further out: the content of one z14 tile inside this one, enough to tell the layout.
  const dz = 14 - z;
  for (let i = 0; i < 2 ** dz; i += Math.max(1, 2 ** (dz - 2)))
    for (let j = 0; j < 2 ** dz; j += Math.max(1, 2 ** (dz - 2))) {
      const f = join(dir, `${(x << dz) + i}-${(y << dz) + j}.pbf`);
      if (existsSync(f)) return convert(readFileSync(f));
    }
  return null;
}

module.exports = { ttTile, convert };
