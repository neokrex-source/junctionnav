#!/usr/bin/env node
// Builds the offline routing graph (graph.bin) from OSM roads in OPL format, produced by:
//   osmium add-locations-to-ways roads.osm.pbf -o roads-loc.osm.pbf
//   osmium cat roads-loc.osm.pbf -f opl,add_metadata=false,locations_on_ways=true -o roads.opl
// Usage: node build-graph.mjs roads.opl graph.bin streets.jsonl --bbox w,s,e,n [--side left|right]
import { createReadStream, createWriteStream, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import {
  CLASSES,
  D_BWD,
  D_FWD,
  F_BRIDGE,
  F_LINK,
  F_ONEWAY,
  F_ONEWAY_REV,
  F_ROUNDABOUT,
  F_TOLL,
  F_TUNNEL,
  GRAPH_MAGIC,
  GRAPH_VERSION,
  KEPT_TAGS,
  R_NO,
  R_ONLY,
  TAG_SEP,
  sectionOffsets,
  KIND_BYTES,
} from '../../src/offline/graphLayout.ts';

const [input, output, streetsOut, ...rest] = process.argv.slice(2);
const opt = (name, def) => {
  const i = rest.indexOf(`--${name}`);
  return i >= 0 ? rest[i + 1] : def;
};
const bbox = opt('bbox', '-180,-85,180,85').split(',').map(Number);
const side = opt('side', 'left');
const CELL = 0.01;

const DRIVABLE = new Set([
  'motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link',
  'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'road',
]);
const BAD_SERVICE = new Set(['driveway', 'parking_aisle', 'drive-through', 'emergency_access', 'alley']);
const DEFAULT_SPEED = {
  motorway: 100, trunk: 80, primary: 60, secondary: 50, tertiary: 40, unclassified: 30, residential: 25,
  living_street: 10, service: 15, road: 30, motorway_link: 55, trunk_link: 45, primary_link: 40, secondary_link: 35, tertiary_link: 30,
};

/* ------------------------------------------------------------------ OPL parsing */

const unesc = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));

function parseTagsOpl(tok) {
  const out = {};
  if (!tok) return out;
  for (const kv of tok.split(',')) {
    const i = kv.indexOf('=');
    if (i > 0) out[unesc(kv.slice(0, i))] = unesc(kv.slice(i + 1));
  }
  return out;
}

function parseLine(line) {
  const parts = line.split(' ');
  const head = parts[0];
  const rec = { type: head[0], id: Number(head.slice(1)), tags: {}, nodes: null, members: null, x: 0, y: 0 };
  for (let i = 1; i < parts.length; i++) {
    const p = parts[i];
    const k = p[0];
    const v = p.slice(1);
    if (k === 'T') rec.tags = parseTagsOpl(v);
    else if (k === 'x') rec.x = Number(v);
    else if (k === 'y') rec.y = Number(v);
    else if (k === 'N') rec.nodes = v ? v.split(',') : [];
    else if (k === 'M') rec.members = v ? v.split(',') : [];
  }
  return rec;
}

/** "n123x101.5y3.1" -> [id, lon, lat] */
function parseNodeRef(s) {
  const xi = s.indexOf('x');
  const yi = s.indexOf('y', xi);
  if (xi < 0 || yi < 0) return null;
  return [Number(s.slice(1, xi)), Number(s.slice(xi + 1, yi)), Number(s.slice(yi + 1))];
}

async function* lines(file) {
  const rl = createInterface({ input: createReadStream(file), crlfDelay: Infinity });
  for await (const l of rl) if (l) yield l;
}

/* ------------------------------------------------------------------ way filtering */

function drivable(t) {
  const hw = t.highway;
  if (!DRIVABLE.has(hw) || t.area === 'yes') return false;
  const motor = t.motor_vehicle ?? t.motorcar ?? t.vehicle;
  if (['no', 'private'].includes(t.access) && !['yes', 'designated', 'destination', 'permissive'].includes(motor)) return false;
  if (['no', 'private'].includes(motor)) return false;
  if (hw === 'service' && (!t.name || BAD_SERVICE.has(t.service))) return false;
  return true;
}

function speedOf(t) {
  const hw = t.highway;
  let v = DEFAULT_SPEED[hw] ?? 30;
  const m = /^(\d+)\s*(mph)?/.exec(t.maxspeed ?? '');
  if (m) v = Math.min(120, Math.round(Number(m[1]) * (m[2] ? 1.609 : 1) * 0.9));
  if (t.junction === 'roundabout' || t.junction === 'circular') v = Math.min(v, 30);
  return Math.max(5, Math.min(255, v));
}

function flagsOf(t) {
  let f = 0;
  const ow = t.oneway;
  const hw = t.highway;
  const round = t.junction === 'roundabout' || t.junction === 'circular';
  if (ow === '-1' || ow === 'reverse') f |= F_ONEWAY_REV;
  else if (ow === 'yes' || ow === '1' || ow === 'true' || (ow !== 'no' && (round || hw === 'motorway'))) f |= F_ONEWAY;
  if (round) f |= F_ROUNDABOUT;
  if (hw.endsWith('_link')) f |= F_LINK;
  if (t.toll === 'yes') f |= F_TOLL;
  if ((t.tunnel && t.tunnel !== 'no') || t.covered === 'yes') f |= F_TUNNEL;
  if (t.bridge && t.bridge !== 'no') f |= F_BRIDGE;
  return f;
}

function classOf(hw) {
  const base = hw.replace(/_link$/, '');
  const i = CLASSES.indexOf(base);
  return i >= 0 ? i : CLASSES.indexOf('road');
}

/* ------------------------------------------------------------------ growable typed arrays */

class Grow {
  constructor(Type, n = 1 << 16) {
    this.Type = Type;
    this.a = new Type(n);
    this.n = 0;
  }
  push(v) {
    if (this.n === this.a.length) {
      const b = new this.Type(this.a.length * 2);
      b.set(this.a);
      this.a = b;
    }
    this.a[this.n++] = v;
  }
  view() {
    return this.a.subarray(0, this.n);
  }
}

function lowerBound(arr, v) {
  let lo = 0;
  let hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >>> 1;
    if (arr[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/* ------------------------------------------------------------------ geometry */

const R = 6371008.8;
const rad = Math.PI / 180;
function dist(lon1, lat1, lon2, lat2) {
  const dLat = (lat2 - lat1) * rad;
  const dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

/** Douglas-Peucker on [lon, lat] points (local metres), keeping end points. */
function simplify(pts, tol) {
  if (pts.length < 3) return pts;
  const lat0 = pts[0][1] * rad;
  const kx = R * rad * Math.cos(lat0);
  const ky = R * rad;
  const xy = pts.map(([x, y]) => [x * kx, y * ky]);
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = xy[a];
    const [bx, by] = xy[b];
    const dx = bx - ax;
    const dy = by - ay;
    const len = Math.hypot(dx, dy) || 1;
    let best = -1;
    let bestD = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((xy[i][0] - ax) * dy - (xy[i][1] - ay) * dx) / len;
      if (d > bestD) {
        bestD = d;
        best = i;
      }
    }
    if (best > 0) {
      keep[best] = 1;
      stack.push([a, best], [best, b]);
    }
  }
  return pts.filter((_, i) => keep[i]);
}

/* ------------------------------------------------------------------ pass 1: vertices */

const t0 = Date.now();
const log = (...a) => console.log(`[graph ${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a);

const refs = new Grow(Float64Array, 1 << 20);
const ends = new Grow(Float64Array, 1 << 18);
let wayCount = 0;
for await (const line of lines(input)) {
  if (line[0] !== 'w') continue;
  const r = parseLine(line);
  if (!drivable(r.tags) || !r.nodes || r.nodes.length < 2) continue;
  wayCount++;
  for (const s of r.nodes) refs.push(Number(s.slice(1, s.indexOf('x') > 0 ? s.indexOf('x') : undefined)));
  ends.push(Number(r.nodes[0].slice(1, r.nodes[0].indexOf('x'))));
  ends.push(Number(r.nodes[r.nodes.length - 1].slice(1, r.nodes[r.nodes.length - 1].indexOf('x'))));
}
log(`pass 1: ${wayCount} drivable ways, ${refs.n} node refs`);
const sorted = refs.view().slice().sort();
const vset = new Grow(Float64Array, 1 << 18);
for (let i = 1; i < sorted.length; i++) if (sorted[i] === sorted[i - 1] && (vset.n === 0 || vset.a[vset.n - 1] !== sorted[i])) vset.push(sorted[i]);
const allV = new Float64Array(vset.n + ends.n);
allV.set(vset.view());
allV.set(ends.view(), vset.n);
allV.sort();
let nV = 0;
for (let i = 0; i < allV.length; i++) if (i === 0 || allV[i] !== allV[i - 1]) allV[nV++] = allV[i];
const vertIds = allV.subarray(0, nV);
log(`${nV} routing vertices`);

/* ------------------------------------------------------------------ pass 2: segments */

const vLat = new Int32Array(nV);
const vLon = new Int32Array(nV);
const segA = new Grow(Uint32Array);
const segB = new Grow(Uint32Array);
const segLen = new Grow(Float32Array);
const segWay = new Grow(Uint32Array);
const segShape = new Grow(Uint32Array);
const segDir = new Grow(Uint8Array);
const shapeLat = new Grow(Int32Array, 1 << 20);
const shapeLon = new Grow(Int32Array, 1 << 20);
const wayClass = new Grow(Uint8Array);
const waySpeed = new Grow(Uint8Array);
const wayFlags = new Grow(Uint16Array);
const wayTags = new Grow(Uint32Array);
const wayIndex = new Map(); // osm id -> way index

const strings = [''];
const strIdx = new Map([['', 0]]);
const str = (s) => {
  if (!s) return 0;
  let i = strIdx.get(s);
  if (i === undefined) {
    i = strings.length;
    strings.push(s);
    strIdx.set(s, i);
  }
  return i;
};

const junctionNodes = []; // [osmId, ref, name]
const restrictions = []; // [fromWayOsm, viaNodeOsm, toWayOsm, type]
const streets = createWriteStream(streetsOut);
const streetSeen = new Set();

for await (const line of lines(input)) {
  const kind = line[0];
  if (kind === 'n') {
    const r = parseLine(line);
    if (r.tags.highway === 'motorway_junction') junctionNodes.push([r.id, r.tags.ref ?? '', r.tags.name ?? '']);
    continue;
  }
  if (kind === 'r') {
    const r = parseLine(line);
    const t = r.tags;
    const rest = t['restriction:motorcar'] ?? t.restriction;
    if (t.type !== 'restriction' || !rest || !r.members) continue;
    if (t.except && /motorcar/.test(t.except)) continue;
    const m = (role, type) => r.members.filter((x) => x.endsWith(`@${role}`) && x[0] === type).map((x) => Number(x.slice(1, x.indexOf('@'))));
    const from = m('from', 'w');
    const via = m('via', 'n');
    const to = m('to', 'w');
    if (from.length !== 1 || via.length !== 1 || to.length !== 1) continue; // via-way restrictions are skipped
    const type = rest.startsWith('only_') ? R_ONLY : rest.startsWith('no_') ? R_NO : -1;
    if (type >= 0) restrictions.push([from[0], via[0], to[0], type]);
    continue;
  }
  if (kind !== 'w') continue;
  const r = parseLine(line);
  const t = r.tags;
  if (!drivable(t) || !r.nodes || r.nodes.length < 2) continue;
  const pts = r.nodes.map(parseNodeRef).filter(Boolean);
  if (pts.length < 2) continue;
  const wi = wayClass.n;
  wayIndex.set(r.id, wi);
  wayClass.push(classOf(t.highway));
  waySpeed.push(speedOf(t));
  const f = flagsOf(t);
  wayFlags.push(f);
  wayTags.push(str(KEPT_TAGS.filter((k) => t[k] != null).map((k) => `${k}=${t[k]}`).join(TAG_SEP)));
  const dir = f & F_ONEWAY ? D_FWD : f & F_ONEWAY_REV ? D_BWD : D_FWD | D_BWD;

  if (t.name) {
    const mid = pts[pts.length >> 1];
    const key = `${t.name}|${Math.round(mid[1] / 0.02)}|${Math.round(mid[2] / 0.02)}`;
    if (!streetSeen.has(key)) {
      streetSeen.add(key);
      streets.write(JSON.stringify([t.name, mid[1], mid[2], t.highway, t['name:en'] ?? '']) + '\n');
    }
  }

  // Split at vertices.
  let start = 0;
  for (let i = 1; i < pts.length; i++) {
    const vi = lowerBound(vertIds, pts[i][0]);
    const isV = vi < nV && vertIds[vi] === pts[i][0];
    if (!isV && i < pts.length - 1) continue;
    const a = lowerBound(vertIds, pts[start][0]);
    const b = vi;
    const run = pts.slice(start, i + 1);
    let len = 0;
    for (let k = 1; k < run.length; k++) len += dist(run[k - 1][1], run[k - 1][2], run[k][1], run[k][2]);
    for (const [idx, p] of [[a, run[0]], [b, run[run.length - 1]]]) {
      vLon[idx] = Math.round(p[1] * 1e6);
      vLat[idx] = Math.round(p[2] * 1e6);
    }
    if (a === b && len < 1) {
      start = i;
      continue;
    }
    segA.push(a);
    segB.push(b);
    segLen.push(len);
    segWay.push(wi);
    segDir.push(dir);
    segShape.push(shapeLat.n);
    const inner = simplify(run.map((p) => [p[1], p[2]]), 2.5).slice(1, -1);
    for (const [x, y] of inner) {
      shapeLon.push(Math.round(x * 1e6));
      shapeLat.push(Math.round(y * 1e6));
    }
    start = i;
  }
}
segShape.push(shapeLat.n);
streets.end();
const nS = segA.n;
log(`pass 2: ${nS} segments, ${wayClass.n} ways, ${shapeLat.n} shape points, ${restrictions.length} restrictions`);

/* ------------------------------------------------------------------ adjacency */

const adjStart = new Uint32Array(nV + 1);
const A = segA.view();
const B = segB.view();
for (let s = 0; s < nS; s++) {
  adjStart[A[s] + 1]++;
  if (B[s] !== A[s]) adjStart[B[s] + 1]++;
}
for (let v = 0; v < nV; v++) adjStart[v + 1] += adjStart[v];
const adj = new Uint32Array(adjStart[nV]);
const fill = adjStart.slice(0, nV);
for (let s = 0; s < nS; s++) {
  adj[fill[A[s]]++] = (s << 1) | 0; // leaving A toward B
  if (B[s] !== A[s]) adj[fill[B[s]]++] = (s << 1) | 1; // leaving B toward A
}

/* ------------------------------------------------------------------ restrictions and junctions */

const vIndex = (osm) => {
  const i = lowerBound(vertIds, osm);
  return i < nV && vertIds[i] === osm ? i : -1;
};
const restr = restrictions
  .map(([f, v, t, ty]) => [vIndex(v), wayIndex.get(f), wayIndex.get(t), ty])
  .filter(([v, f, t]) => v >= 0 && f !== undefined && t !== undefined)
  .sort((x, y) => x[0] - y[0]);
const junc = junctionNodes.map(([id, ref, name]) => [vIndex(id), str(ref), str(name)]).filter(([v]) => v >= 0);
log(`${restr.length} restrictions kept, ${junc.length} motorway junctions`);

/* ------------------------------------------------------------------ spatial grid */

const lonMin = bbox[0];
const latMin = bbox[1];
const nx = Math.ceil((bbox[2] - bbox[0]) / CELL) + 1;
const ny = Math.ceil((bbox[3] - bbox[1]) / CELL) + 1;
const cellPairs = new Grow(Float64Array, 1 << 20); // key * 2^24 + seg would overflow; store pairs separately
const cellSegsTmp = new Grow(Uint32Array, 1 << 20);
const SL = shapeLat.view();
const SO = shapeLon.view();
const SS = segShape.view();
for (let s = 0; s < nS; s++) {
  let x0 = vLon[A[s]];
  let x1 = x0;
  let y0 = vLat[A[s]];
  let y1 = y0;
  const pts = [[vLon[B[s]], vLat[B[s]]]];
  for (let k = SS[s]; k < SS[s + 1]; k++) pts.push([SO[k], SL[k]]);
  for (const [x, y] of pts) {
    if (x < x0) x0 = x;
    if (x > x1) x1 = x;
    if (y < y0) y0 = y;
    if (y > y1) y1 = y;
  }
  const cx0 = Math.max(0, Math.floor((x0 / 1e6 - lonMin) / CELL));
  const cx1 = Math.min(nx - 1, Math.floor((x1 / 1e6 - lonMin) / CELL));
  const cy0 = Math.max(0, Math.floor((y0 / 1e6 - latMin) / CELL));
  const cy1 = Math.min(ny - 1, Math.floor((y1 / 1e6 - latMin) / CELL));
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      cellPairs.push(cy * nx + cx);
      cellSegsTmp.push(s);
    }
}
const order = Array.from({ length: cellPairs.n }, (_, i) => i).sort((i, j) => cellPairs.a[i] - cellPairs.a[j] || cellSegsTmp.a[i] - cellSegsTmp.a[j]);
const cellKeyG = new Grow(Uint32Array);
const cellStartG = new Grow(Uint32Array);
const cellSegs = new Uint32Array(order.length);
order.forEach((o, i) => {
  const key = cellPairs.a[o];
  if (cellKeyG.n === 0 || cellKeyG.a[cellKeyG.n - 1] !== key) {
    cellKeyG.push(key);
    cellStartG.push(i);
  }
  cellSegs[i] = cellSegsTmp.a[o];
});
cellStartG.push(order.length);
log(`${cellKeyG.n} grid cells`);

/* ------------------------------------------------------------------ strings and output */

const enc = new TextEncoder();
const strEnc = strings.map((s) => enc.encode(s));
const strOff = new Uint32Array(strings.length + 1);
for (let i = 0; i < strEnc.length; i++) strOff[i + 1] = strOff[i] + strEnc[i].length;
const strBytes = new Uint8Array(strOff[strings.length]);
strEnc.forEach((b, i) => strBytes.set(b, strOff[i]));

const header = {
  nV,
  nS,
  nAdj: adj.length,
  nShape: shapeLat.n,
  nWays: wayClass.n,
  nRestr: restr.length,
  nJunc: junc.length,
  nStr: strings.length,
  strBytes: strBytes.length,
  cell: { size: CELL, lonMin, latMin, nx, ny, nCells: cellKeyG.n, nCellSegs: cellSegs.length },
  bbox,
  drivingSide: side,
  built: new Date().toISOString(),
  source: 'OpenStreetMap contributors (ODbL)',
};
const headerBytes = enc.encode(JSON.stringify(header));
const start = 12 + headerBytes.length;
const offs = sectionOffsets(header, start);
const buf = Buffer.alloc(offs.__end.offset);
buf.writeUInt32LE(GRAPH_MAGIC, 0);
buf.writeUInt32LE(GRAPH_VERSION, 4);
buf.writeUInt32LE(headerBytes.length, 8);
buf.set(headerBytes, 12);
const data = {
  vLat,
  vLon,
  segA: segA.view(),
  segB: segB.view(),
  segLen: segLen.view(),
  segWay: segWay.view(),
  segShape: segShape.view(),
  segDir: segDir.view(),
  adjStart,
  adj,
  shapeLat: shapeLat.view(),
  shapeLon: shapeLon.view(),
  wayClass: wayClass.view(),
  waySpeed: waySpeed.view(),
  wayFlags: wayFlags.view(),
  wayTags: wayTags.view(),
  rVia: Uint32Array.from(restr.map((r) => r[0])),
  rFrom: Uint32Array.from(restr.map((r) => r[1])),
  rTo: Uint32Array.from(restr.map((r) => r[2])),
  rType: Uint8Array.from(restr.map((r) => r[3])),
  jV: Uint32Array.from(junc.map((j) => j[0])),
  jRef: Uint32Array.from(junc.map((j) => j[1])),
  jName: Uint32Array.from(junc.map((j) => j[2])),
  cellKey: cellKeyG.view(),
  cellStart: cellStartG.view(),
  cellSegs,
  strOff,
  strBytes,
};
for (const [name, sec] of Object.entries(offs)) {
  if (name === '__end') continue;
  const arr = data[name];
  if (arr.length !== sec.length) throw new Error(`section ${name}: ${arr.length} != ${sec.length}`);
  buf.set(new Uint8Array(arr.buffer, arr.byteOffset, arr.length * KIND_BYTES[sec.kind]), sec.offset);
}
writeFileSync(output, buf);
log(`wrote ${output}: ${(buf.length / 1048576).toFixed(1)} MB`);
