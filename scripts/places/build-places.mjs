#!/usr/bin/env node
// Builds the places data the app downloads for the area around you (src/places/format.ts):
// Overture Maps places (businesses and points of interest from Meta, Microsoft and others) merged
// with OpenStreetMap's named places, split into 0.25° cells with a manifest.
//
//   node build-places.mjs --overture overture.geojsonseq --osm osm.geojsonseq --out places-data
//     [--min-confidence 0.6] [--countries MY,SG,BN] [--budget-mb 300]
//     [--overture-release 2025-10-22.0] [--osm-date 2026-11-08]
//
// overture.geojsonseq: `overturemaps download --type place -f geojsonseq` (one feature per line).
// osm.geojsonseq: `osmium export -f geojsonseq` of the POI tags (properties are the OSM tags).
//
// Where both sources have the same place (similar name within 80 m) it is kept once, with the
// OSM position and name and the details of both. Overture places below the confidence threshold,
// closed ones, and ones outside the listed countries are left out. If the whole set would pass
// the size budget, the least certain Overture-only places go first.
import { createHash } from 'node:crypto';
import { createReadStream, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { join } from 'node:path';
import {
  CELL_DEG,
  PLACES_ATTRIBUTION,
  PLACES_LICENSE,
  PLACES_VERSION,
  cellId,
  metres,
  normName,
  osmCategory,
  overtureGroup,
  placeRank,
  sameName,
} from '../../src/places/format.ts';

const args = process.argv.slice(2);
const opt = (name, def) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : def;
};
const OVERTURE = opt('overture');
const OSM = opt('osm');
const OUT = opt('out', 'places-data');
const MIN_CONF = Number(opt('min-confidence', '0.6'));
const COUNTRIES = new Set(opt('countries', 'MY,SG,BN').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean));
const BUDGET = Number(opt('budget-mb', '300')) * 1024 * 1024;

const clean = (s) => (s == null ? '' : String(s).replace(/[\t\n\r]+/g, ' ').replace(/\s{2,}/g, ' ').trim());
const cut = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

async function* lines(path) {
  if (!path) return;
  for await (const line of createInterface({ input: createReadStream(path), crlfDelay: Infinity })) {
    const s = line.replace(/^\x1e/, '').trim();
    if (!s) continue;
    try {
      yield JSON.parse(s);
    } catch {
      /* a broken line: skip it */
    }
  }
}

/** A point for any geometry: the point itself, or the average of an outline's corners. */
function pointOf(g) {
  if (!g) return null;
  if (g.type === 'Point') return g.coordinates;
  const pts = [];
  const walk = (c) => (typeof c[0] === 'number' ? pts.push(c) : c.forEach(walk));
  walk(g.coordinates);
  if (!pts.length) return null;
  let x = 0;
  let y = 0;
  for (const [a, b] of pts) {
    x += a;
    y += b;
  }
  return [x / pts.length, y / pts.length];
}

/* ---------------------------------------------------------------- OpenStreetMap */

/** Unnamed places worth listing anyway, with the name they get. */
const UNNAMED = {
  fuel: (t) => t.brand ?? t.operator,
  charging_station: (t) => t.operator ?? t.brand,
  parking: (t) => t.operator,
  rest_area: () => 'R&R',
  rest_stop: () => 'Rest stop',
  atm: (t) => (t.operator ?? t.brand ? `${t.operator ?? t.brand} ATM` : undefined),
};

function osmDetails(t) {
  const d = {};
  const en = clean(t['name:en']);
  if (en && en !== clean(t.name)) d.e = cut(en, 80);
  const street = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ');
  const town = [t['addr:postcode'], t['addr:city'] ?? t['addr:place'] ?? t['addr:suburb']].filter(Boolean).join(' ');
  const a = clean([street, town].filter(Boolean).join(', ') || t['addr:full']);
  if (a) d.a = cut(a, 120);
  const phone = clean(t.phone ?? t['contact:phone']).split(';')[0];
  if (phone) d.t = cut(phone, 40);
  const web = clean(t.website ?? t['contact:website'] ?? t['contact:facebook'] ?? t.url);
  if (/^https?:\/\//i.test(web)) d.w = cut(web, 160);
  const hours = clean(t.opening_hours);
  if (hours) d.h = cut(hours, 120);
  const cuisine = clean(t.cuisine);
  if (cuisine) d.c = cut(cuisine, 60);
  const brand = clean(t.brand);
  if (brand) d.b = cut(brand, 60);
  return d;
}

/* ---------------------------------------------------------------- Overture */

function overtureCategory(p) {
  const tax = p.taxonomy;
  return p.basic_category ?? p.categories?.primary ?? (typeof tax?.primary === 'string' ? tax.primary : undefined) ?? null;
}

function overtureDetails(p) {
  const d = {};
  const common = p.names?.common;
  const en = clean(common?.en ?? (Array.isArray(common) ? common.find((x) => x?.[0] === 'en')?.[1] : undefined));
  if (en && en !== clean(p.names?.primary)) d.e = cut(en, 80);
  const ad = Array.isArray(p.addresses) ? p.addresses[0] : null;
  if (ad) {
    const town = [ad.postcode, ad.locality].filter(Boolean).join(' ');
    const free = clean(ad.freeform);
    const a = clean([free, town && !free.includes(clean(ad.locality ?? '')) ? town : ''].filter(Boolean).join(', '));
    if (a) d.a = cut(a, 120);
  }
  const phone = clean(Array.isArray(p.phones) ? p.phones[0] : '');
  if (phone) d.t = cut(phone, 40);
  const web = clean(Array.isArray(p.websites) ? p.websites[0] : '') || clean(Array.isArray(p.socials) ? p.socials[0] : '');
  if (/^https?:\/\//i.test(web)) d.w = cut(web, 160);
  const brand = clean(p.brand?.names?.primary);
  if (brand) d.b = cut(brand, 60);
  return d;
}

/* ---------------------------------------------------------------- build */

/** Spatial buckets of about 220 m for finding the same place in both sources. */
const B = 0.002;
const bucket = (lon, lat) => `${Math.floor(lon / B)}:${Math.floor(lat / B)}`;
function near(index, lon, lat) {
  const bx = Math.floor(lon / B);
  const by = Math.floor(lat / B);
  const out = [];
  for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (const r of index.get(`${bx + dx}:${by + dy}`) ?? []) out.push(r);
  return out;
}

async function main() {
  const places = [];
  const osmIndex = new Map();
  let osmCount = 0;
  for await (const f of lines(OSM)) {
    const t = f.properties ?? {};
    const cat = osmCategory(t);
    if (!cat) continue;
    const name = clean(t.name ?? t['name:en'] ?? UNNAMED[cat.key]?.(t));
    if (!name) continue;
    const pt = pointOf(f.geometry);
    if (!pt) continue;
    const d = osmDetails(t);
    d.s = 'm';
    const rec = { name: cut(name, 90), key: cat.key, group: cat.group, lon: pt[0], lat: pt[1], d, conf: null };
    places.push(rec);
    const k = bucket(pt[0], pt[1]);
    (osmIndex.get(k) ?? osmIndex.set(k, []).get(k)).push(rec);
    osmCount++;
  }

  let ovSeen = 0;
  let ovKept = 0;
  let ovMerged = 0;
  let ovDup = 0;
  const ovIndex = new Map();
  for await (const f of lines(OVERTURE)) {
    ovSeen++;
    const p = f.properties ?? {};
    if (p.operating_status && p.operating_status !== 'open') continue;
    const conf = typeof p.confidence === 'number' ? p.confidence : 0;
    const country = (Array.isArray(p.addresses) ? p.addresses[0]?.country : undefined)?.toUpperCase();
    if (country && COUNTRIES.size && !COUNTRIES.has(country)) continue;
    const name = clean(p.names?.primary);
    const pt = pointOf(f.geometry);
    if (!name || !pt) continue;
    const key = overtureCategory(p) ?? 'place';
    const d = overtureDetails(p);
    // Already in OpenStreetMap: one place, with OSM's position and name and the details of both.
    const twin = near(osmIndex, pt[0], pt[1]).find((r) => metres([r.lon, r.lat], pt) <= 80 && sameName(r.name, name));
    if (twin) {
      for (const k of ['a', 't', 'w', 'b', 'e']) if (d[k] && !twin.d[k]) twin.d[k] = d[k];
      twin.d.s = 'om';
      twin.conf = Math.max(twin.conf ?? 0, conf);
      if (twin.group === 'other') twin.group = overtureGroup(key);
      ovMerged++;
      continue;
    }
    if (conf < MIN_CONF) continue;
    // The same business listed twice by Overture's sources: keep the more certain one.
    const nn = normName(name);
    const dup = near(ovIndex, pt[0], pt[1]).find((r) => metres([r.lon, r.lat], pt) <= 40 && normName(r.name) === nn);
    if (dup) {
      ovDup++;
      if (conf > dup.conf) Object.assign(dup, { lon: pt[0], lat: pt[1], conf, key, group: overtureGroup(key), d: { ...d, s: 'o' } });
      continue;
    }
    d.s = 'o';
    const rec = { name: cut(name, 90), key, group: overtureGroup(key), lon: pt[0], lat: pt[1], d, conf };
    places.push(rec);
    const k = bucket(pt[0], pt[1]);
    (ovIndex.get(k) ?? ovIndex.set(k, []).get(k)).push(rec);
    ovKept++;
  }
  console.log(`[places] OpenStreetMap ${osmCount}; Overture ${ovSeen} read, ${ovKept} added, ${ovMerged} matched to OSM, ${ovDup} duplicates`);

  // Rows, and the size budget: the least certain Overture-only places go first.
  const coord = (v) => Math.round(v * 1e5);
  for (const r of places) {
    r.rank = placeRank(r.group, r.key, r.d, r.conf ?? undefined);
    const d = Object.keys(r.d).length ? r.d : undefined;
    r.size = JSON.stringify([r.name, 0, coord(r.lon), coord(r.lat), r.rank, d]).length + 1;
  }
  let total = places.reduce((a, r) => a + r.size, 0);
  let floor = MIN_CONF;
  let kept = places;
  while (total > BUDGET && floor < 0.95) {
    floor += 0.05;
    kept = places.filter((r) => r.d.s !== 'o' || r.conf >= floor);
    total = kept.reduce((a, r) => a + r.size, 0);
    console.log(`[places] over the ${(BUDGET / 1048576).toFixed(0)} MB budget: Overture-only places need confidence ${floor.toFixed(2)} (${kept.length} places, ${(total / 1048576).toFixed(1)} MB)`);
  }

  // Cells.
  const cells = new Map();
  for (const r of kept) {
    const id = cellId(r.lon, r.lat);
    (cells.get(id) ?? cells.set(id, []).get(id)).push(r);
  }
  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(join(OUT, 'cells'), { recursive: true });
  const built = new Date().toISOString();
  const manifest = {
    v: PLACES_VERSION,
    built,
    sources: { overture: opt('overture-release'), osm: opt('osm-date') },
    cell: CELL_DEG,
    count: 0,
    cells: {},
    attribution: PLACES_ATTRIBUTION,
    license: PLACES_LICENSE,
  };
  let bytes = 0;
  for (const [id, list] of [...cells.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    list.sort((a, b) => b.rank - a.rank || (a.name < b.name ? -1 : 1));
    const catIdx = new Map();
    const cats = [];
    const rows = list.map((r) => {
      const ck = `${r.key}|${r.group}`;
      let ci = catIdx.get(ck);
      if (ci === undefined) {
        ci = cats.length;
        cats.push([r.key, r.group]);
        catIdx.set(ck, ci);
      }
      const d = Object.keys(r.d).length ? r.d : undefined;
      return d ? [r.name, ci, coord(r.lon), coord(r.lat), r.rank, d] : [r.name, ci, coord(r.lon), coord(r.lat), r.rank];
    });
    const text = JSON.stringify({ v: PLACES_VERSION, id, built, cats, p: rows });
    writeFileSync(join(OUT, 'cells', `${id}.json`), text);
    const h = createHash('sha1').update(text).digest('hex').slice(0, 12);
    manifest.cells[id] = { n: rows.length, b: Buffer.byteLength(text), h };
    manifest.count += rows.length;
    bytes += Buffer.byteLength(text);
  }
  writeFileSync(join(OUT, 'manifest.json'), JSON.stringify(manifest));
  const groups = {};
  for (const r of kept) groups[r.group] = (groups[r.group] ?? 0) + 1;
  console.log(`[places] ${manifest.count} places in ${cells.size} cells, ${(bytes / 1048576).toFixed(1)} MB`);
  console.log(`[places] by group: ${Object.entries(groups).sort((a, b) => b[1] - a[1]).map(([g, n]) => `${g} ${n}`).join(', ')}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
