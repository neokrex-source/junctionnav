#!/usr/bin/env node
// Builds the offline place index (places.bin) from named OSM features exported with
//   osmium export places.osm.pbf -f geojsonseq -x print_record_separator=false -o places.geojsonseq
// plus street names collected by build-graph.mjs.
// Usage: node build-places.mjs places.geojsonseq streets.jsonl places.bin
import { createReadStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { PLACES_MAGIC, align4 } from '../../src/offline/graphLayout.ts';

const [geojsonPath, streetsPath, output] = process.argv.slice(2);

/** Which tag gives a feature its kind, in priority order. */
const KIND_KEYS = ['place', 'aeroway', 'railway', 'highway', 'amenity', 'shop', 'tourism', 'leisure', 'healthcare', 'office', 'building'];
const KEEP = {
  place: null, // any
  aeroway: new Set(['aerodrome', 'terminal']),
  railway: new Set(['station', 'halt']),
  highway: new Set(['services', 'rest_area', 'motorway_junction']),
  amenity: null,
  shop: null,
  tourism: null,
  leisure: new Set(['park', 'stadium', 'golf_course', 'sports_centre', 'water_park', 'nature_reserve']),
  healthcare: null,
  office: null,
  building: new Set(['commercial', 'retail', 'hospital', 'university', 'school', 'mosque', 'temple', 'church', 'train_station']),
};

const entries = []; // [name, alt, lon, lat, kind]
const kinds = [];
const kindIdx = new Map();
const kindOf = (k) => {
  let i = kindIdx.get(k);
  if (i === undefined) {
    i = kinds.length;
    kinds.push(k);
    kindIdx.set(k, i);
  }
  return i;
};

function centroid(g) {
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

/** Unnamed features worth finding by category, with the name they get instead. */
const GENERIC = {
  'amenity=fuel': (p) => p.brand ?? p.operator ?? 'Fuel station',
  'amenity=charging_station': (p) => p.operator ?? p.brand ?? 'EV charging',
  'amenity=parking': (p) => p.operator ?? 'Parking',
  'highway=services': () => 'Rest area',
  'highway=rest_area': () => 'Rest area',
};
const clean = (s) => String(s).replace(/[\t\n\r]+/g, ' ').trim();

const seen = new Set();
const add = (name, alt, lon, lat, kind) => {
  name = clean(name);
  alt = alt ? clean(alt) : '';
  if (!name) return;
  const key = `${name.toLowerCase()}|${Math.round(lon / 0.002)}|${Math.round(lat / 0.002)}`;
  if (seen.has(key)) return;
  seen.add(key);
  entries.push([name, alt && alt !== name ? alt : '', lon, lat, kindOf(kind)]);
};

for await (const line of createInterface({ input: createReadStream(geojsonPath), crlfDelay: Infinity })) {
  const s = line.replace(/^\x1e/, '').trim();
  if (!s) continue;
  let f;
  try {
    f = JSON.parse(s);
  } catch {
    continue;
  }
  const p = f.properties ?? {};
  if (!f.geometry) continue;
  let kind = null;
  for (const k of KIND_KEYS) {
    const v = p[k];
    if (v && (KEEP[k] === null || KEEP[k].has(v))) {
      kind = `${k}=${v}`;
      break;
    }
  }
  if (!kind) continue;
  const name = p.name ?? GENERIC[kind]?.(p);
  if (!name) continue;
  const c = centroid(f.geometry);
  if (!c) continue;
  add(name, p['name:en'] ?? '', c[0], c[1], kind);
}
const poiCount = entries.length;

for await (const line of createInterface({ input: createReadStream(streetsPath), crlfDelay: Infinity })) {
  if (!line) continue;
  const [name, lon, lat, hw, en] = JSON.parse(line);
  add(name, en, lon, lat, `highway=${hw}`);
}
console.log(`[places] ${poiCount} places and businesses, ${entries.length - poiCount} street names, ${kinds.length} kinds`);

const enc = new TextEncoder();
const names = enc.encode(entries.map((e) => (e[1] ? `${e[0]}\t${e[1]}` : e[0])).join('\n'));
const header = enc.encode(JSON.stringify({ count: entries.length, kinds, nameBytes: names.length, built: new Date().toISOString() }));
const n = entries.length;
let off = align4(12 + header.length);
const lonOff = off;
off += n * 4;
const latOff = off;
off += n * 4;
const kindOff = off;
off = align4(off + n * 2);
const namesOff = off;
off += names.length;
const buf = Buffer.alloc(off);
buf.writeUInt32LE(PLACES_MAGIC, 0);
buf.writeUInt32LE(1, 4);
buf.writeUInt32LE(header.length, 8);
buf.set(header, 12);
const lonA = new Int32Array(n);
const latA = new Int32Array(n);
const kindA = new Uint16Array(n);
entries.forEach((e, i) => {
  lonA[i] = Math.round(e[2] * 1e6);
  latA[i] = Math.round(e[3] * 1e6);
  kindA[i] = e[4];
});
buf.set(new Uint8Array(lonA.buffer), lonOff);
buf.set(new Uint8Array(latA.buffer), latOff);
buf.set(new Uint8Array(kindA.buffer), kindOff);
buf.set(names, namesOff);
writeFileSync(output, buf);
console.log(`[places] wrote ${output}: ${(buf.length / 1048576).toFixed(1)} MB`);
