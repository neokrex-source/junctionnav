/**
 * What surrounds a junction: buildings, land use, water, rivers, railways, notable
 * places and road names. Fetched from Overpass per junction and turned into local
 * geometry for the 3D junction view.
 */
import { distToPolyline, LocalFrame, type LngLat, type XY } from '../geo/geo';
import type { RoadStrip } from './scene';

type Tags = Record<string, string>;
type Geom = { lat: number; lon: number }[];

export interface SurroundData {
  ways: { id: number; tags: Tags; geometry: Geom }[];
  rels: { id: number; tags: Tags; members: { role: string; geometry?: Geom }[] }[];
  pois: { id: string; tags: Tags; lat: number; lon: number }[];
}

export const BUILDING_RADIUS = 450;
export const AREA_RADIUS = 700;

export function buildSurroundQuery(p: LngLat): string {
  const c = `${p[1].toFixed(6)},${p[0].toFixed(6)}`;
  const B = `around:${BUILDING_RADIUS},${c}`;
  const A = `around:${AREA_RADIUS},${c}`;
  return `[out:json][timeout:25];
(
  way(${B})["building"];
  way(${A})["landuse"~"^(residential|commercial|retail|industrial|construction|farmland|orchard|plantation|grass|meadow|forest|cemetery|reservoir|basin)$"];
  way(${A})["natural"~"^(water|wood|scrub|grassland|wetland)$"];
  way(${A})["leisure"~"^(park|golf_course|pitch|garden|nature_reserve)$"];
  way(${A})["waterway"~"^(river|canal|stream|drain)$"];
  way(${A})["railway"~"^(rail|light_rail|subway|monorail|narrow_gauge)$"];
  relation(${A})["type"="multipolygon"]["natural"~"^(water|wood)$"];
  relation(${A})["type"="multipolygon"]["landuse"];
);
out tags geom 4000;
(
  nwr(${B})["amenity"~"^(fuel|charging_station|hospital|university|college|school|place_of_worship|marketplace)$"];
  nwr(${B})["highway"~"^(services|rest_area)$"];
  nwr(${B})["shop"="mall"];
  nwr(${B})["tourism"~"^(attraction|hotel|museum)$"]["name"];
  node(${A})["place"~"^(city|town|suburb|village|neighbourhood|quarter|hamlet)$"];
);
out tags center 80;`;
}

interface OverpassEl {
  type: string;
  id: number;
  lat?: number;
  lon?: number;
  center?: { lat: number; lon: number };
  tags?: Tags;
  geometry?: Geom;
  members?: { role: string; geometry?: Geom }[];
}

export function parseSurround(json: { elements: OverpassEl[] }): SurroundData {
  const out: SurroundData = { ways: [], rels: [], pois: [] };
  for (const e of json.elements ?? []) {
    const tags = e.tags ?? {};
    const isPoi = tags.amenity || tags.place || tags.shop === 'mall' || tags.tourism || tags.highway === 'services' || tags.highway === 'rest_area';
    if (isPoi && !tags.building && !tags.landuse) {
      const lat = e.lat ?? e.center?.lat;
      const lon = e.lon ?? e.center?.lon;
      if (lat != null && lon != null) out.pois.push({ id: `${e.type}/${e.id}`, tags, lat, lon });
      if (e.type !== 'way' || !e.geometry) continue;
    }
    if (e.type === 'way' && e.geometry) out.ways.push({ id: e.id, tags, geometry: e.geometry });
    else if (e.type === 'relation' && e.members) out.rels.push({ id: e.id, tags, members: e.members });
  }
  return out;
}

export interface SurroundingsProvider {
  fetch(p: LngLat, signal?: AbortSignal): Promise<SurroundData>;
}

export class OverpassSurroundProvider implements SurroundingsProvider {
  constructor(private endpoints: () => string[]) {}
  async fetch(p: LngLat, signal?: AbortSignal): Promise<SurroundData> {
    const q = buildSurroundQuery(p);
    let last: unknown;
    for (const url of this.endpoints()) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
          body: 'data=' + encodeURIComponent(q),
          signal,
        });
        if (!res.ok) throw new Error(`Overpass ${res.status}`);
        return parseSurround(await res.json());
      } catch (e) {
        if ((e as Error).name === 'AbortError') throw e;
        last = e;
      }
    }
    throw last instanceof Error ? last : new Error('Surroundings unavailable');
  }
}

/** One request per junction, cached; failures are retried after a minute. */
export class SurroundCache {
  private cache = new Map<string, Promise<SurroundData | null>>();
  private failedAt = new Map<string, number>();
  constructor(public provider: SurroundingsProvider) {}

  static key(p: LngLat): string {
    return `${p[1].toFixed(4)},${p[0].toFixed(4)}`;
  }

  get(p: LngLat): Promise<SurroundData | null> {
    const k = SurroundCache.key(p);
    const failed = this.failedAt.get(k);
    if (failed != null && Date.now() - failed > 60_000) {
      this.failedAt.delete(k);
      this.cache.delete(k);
    }
    let hit = this.cache.get(k);
    if (!hit) {
      hit = this.provider.fetch(p).catch((e) => {
        console.warn('[junction] surroundings fetch failed', e);
        this.failedAt.set(k, Date.now());
        return null;
      });
      this.cache.set(k, hit);
    }
    return hit;
  }
}

/* ------------------------------------------------------------------ scene geometry */

export type AreaKind = 'water' | 'park' | 'forest' | 'farm' | 'palm' | 'residential' | 'commercial' | 'industrial';
export type BuildingKind = 'house' | 'block' | 'tower' | 'industrial' | 'roof';

export interface SurroundBuilding {
  ring: XY[];
  height: number;
  kind: BuildingKind;
}
export interface SurroundArea {
  kind: AreaKind;
  ring: XY[];
}
export interface SurroundLine {
  kind: 'river' | 'stream' | 'rail';
  pts: XY[];
  width: number;
}
export interface SurroundLabel {
  text: string;
  kind: 'road' | 'poi' | 'place';
  /** Candidate anchor points (ground position and height); the renderer picks a visible one. */
  anchors: { p: XY; h: number }[];
  /** Category of a point of interest, used for its marker colour. */
  poi?: 'fuel' | 'ev' | 'rest' | 'other';
  priority: number;
}

export interface SurroundScene {
  buildings: SurroundBuilding[];
  areas: SurroundArea[];
  lines: SurroundLine[];
  labels: SurroundLabel[];
}

function areaKind(t: Tags): AreaKind | null {
  const lu = t.landuse ?? '';
  if (t.natural === 'water' || lu === 'reservoir' || lu === 'basin') return 'water';
  if ((lu === 'orchard' || lu === 'farmland' || lu === 'plantation') && /palm/i.test(`${t.trees ?? ''} ${t.crop ?? ''} ${t.produce ?? ''}`)) return 'palm';
  if (lu === 'plantation') return 'palm';
  if (t.natural === 'wood' || lu === 'forest' || t.leisure === 'nature_reserve') return 'forest';
  if (['park', 'golf_course', 'pitch', 'garden'].includes(t.leisure ?? '') || ['grass', 'meadow', 'cemetery'].includes(lu) || ['scrub', 'grassland', 'wetland'].includes(t.natural ?? ''))
    return 'park';
  if (lu === 'farmland' || lu === 'orchard') return 'farm';
  if (lu === 'residential') return 'residential';
  if (lu === 'commercial' || lu === 'retail') return 'commercial';
  if (lu === 'industrial' || lu === 'construction') return 'industrial';
  return null;
}

function num(v?: string): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v.replace(',', '.'));
  return Number.isFinite(n) ? n : undefined;
}

export function buildingInfo(t: Tags): { height: number; kind: BuildingKind } {
  const b = t.building ?? 'yes';
  if (b === 'roof' || t['building:part'] === 'roof') return { height: num(t.height) ?? 6, kind: 'roof' };
  const levels = num(t['building:levels']);
  let height = num(t.height) ?? (levels != null ? levels * 3.2 + 1 : undefined);
  let kind: BuildingKind = 'block';
  if (['house', 'detached', 'terrace', 'semidetached_house', 'bungalow', 'hut', 'shed', 'garage', 'garages'].includes(b)) kind = 'house';
  else if (['industrial', 'warehouse', 'factory', 'hangar', 'manufacture'].includes(b)) kind = 'industrial';
  if (height == null) height = kind === 'house' ? 7 : kind === 'industrial' ? 10 : b === 'apartments' ? 30 : ['commercial', 'retail', 'office'].includes(b) ? 14 : 9;
  if (height >= 40) kind = 'tower';
  return { height: Math.max(3, Math.min(250, height)), kind };
}

function ringArea(r: XY[]): number {
  let a = 0;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) a += (r[j][0] - r[i][0]) * (r[j][1] + r[i][1]);
  return a / 2;
}

/** Drop repeated/near points, remove the closing duplicate and make the ring counter-clockwise. */
function cleanRing(pts: XY[]): XY[] | null {
  const out: XY[] = [];
  for (const p of pts) {
    const q = out[out.length - 1];
    if (!q || Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.4) out.push(p);
  }
  if (out.length > 2 && Math.hypot(out[0][0] - out[out.length - 1][0], out[0][1] - out[out.length - 1][1]) < 0.5) out.pop();
  if (out.length < 3) return null;
  if (ringArea(out) < 0) out.reverse();
  return out;
}

/** Join open member ways of a multipolygon into closed rings. */
function stitch(parts: XY[][]): XY[][] {
  const rings: XY[][] = [];
  const open = parts.map((p) => p.slice());
  const near = (a: XY, b: XY) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1;
  while (open.length) {
    let cur = open.shift()!;
    let grew = true;
    while (!near(cur[0], cur[cur.length - 1]) && grew) {
      grew = false;
      for (let i = 0; i < open.length; i++) {
        const o = open[i];
        const end = cur[cur.length - 1];
        if (near(end, o[0])) cur = cur.concat(o.slice(1));
        else if (near(end, o[o.length - 1])) cur = cur.concat(o.slice(0, -1).reverse());
        else continue;
        open.splice(i, 1);
        grew = true;
        break;
      }
    }
    if (near(cur[0], cur[cur.length - 1])) rings.push(cur);
  }
  return rings;
}

function centroid(r: XY[]): XY {
  let x = 0;
  let y = 0;
  for (const p of r) {
    x += p[0];
    y += p[1];
  }
  return [x / r.length, y / r.length];
}

function localized(t: Tags, key: string, lang?: string): string | undefined {
  return (lang && t[`${key}:${lang}`]) || t[key];
}

/**
 * Turn raw surroundings into local geometry around the junction. Buildings that would sit on a
 * drawn road are dropped (OSM sometimes maps them across bridges or passages).
 */
export function surroundScene(data: SurroundData, frame: LocalFrame, roads: RoadStrip[], lang?: string): SurroundScene {
  const toXY = (g: Geom) => g.map((q) => frame.toXY([q.lon, q.lat]));
  const roadBoxes = roads.map((r) => {
    let x0 = Infinity;
    let y0 = Infinity;
    let x1 = -Infinity;
    let y1 = -Infinity;
    for (const p of r.pts) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    const pad = Math.max(...r.width) / 2 + r.shoulder + 1.5;
    return { r, box: [x0 - pad, y0 - pad, x1 + pad, y1 + pad], pad };
  });
  const onRoad = (p: XY) =>
    roadBoxes.some(({ r, box, pad }) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3] && distToPolyline(p, r.pts) < pad);

  const buildings: SurroundBuilding[] = [];
  const areas: SurroundArea[] = [];
  const lines: SurroundLine[] = [];
  for (const w of data.ways) {
    const t = w.tags;
    if (t.building || t['building:part']) {
      if (t.building === 'no' || t.location === 'underground') continue;
      const ring = cleanRing(toXY(w.geometry));
      if (!ring) continue;
      const c = centroid(ring);
      if (Math.hypot(c[0], c[1]) > BUILDING_RADIUS + 60 || onRoad(c)) continue;
      buildings.push({ ring, ...buildingInfo(t) });
      continue;
    }
    const k = areaKind(t);
    if (k) {
      const ring = cleanRing(toXY(w.geometry));
      if (ring && ring.length >= 3) areas.push({ kind: k, ring });
      continue;
    }
    if (t.waterway) {
      const pts = toXY(w.geometry);
      const width = num(t.width) ?? (t.waterway === 'river' ? 22 : t.waterway === 'canal' ? 12 : 5);
      lines.push({ kind: t.waterway === 'river' || t.waterway === 'canal' ? 'river' : 'stream', pts, width });
      continue;
    }
    if (t.railway && !(t.tunnel && t.tunnel !== 'no')) {
      lines.push({ kind: 'rail', pts: toXY(w.geometry), width: 4 });
    }
  }
  for (const r of data.rels) {
    const k = areaKind(r.tags);
    if (!k) continue;
    const outers = r.members.filter((m) => m.role !== 'inner' && m.geometry?.length).map((m) => toXY(m.geometry!));
    for (const ring of stitch(outers)) {
      const c = cleanRing(ring);
      if (c) areas.push({ kind: k, ring: c });
    }
  }
  // Water and parks over farmland over built-up areas, so smaller features stay visible.
  const order: AreaKind[] = ['residential', 'commercial', 'industrial', 'farm', 'palm', 'forest', 'park', 'water'];
  areas.sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));

  const labels: SurroundLabel[] = [];
  // Road names, preferring roads that are not part of the route (those are on the signs).
  const seen = new Set<string>();
  const roadsByPriority = [...roads].sort((a, b) => (a.role === 'context' ? 0 : 1) - (b.role === 'context' ? 0 : 1));
  for (const r of roadsByPriority) {
    const name = r.name || r.ref;
    if (!name || seen.has(name) || r.role === 'approach') continue;
    seen.add(name);
    const anchors: { p: XY; h: number }[] = [];
    for (let i = 0; i < r.pts.length; i += 5) anchors.push({ p: r.pts[i], h: r.h[i] + 1.5 });
    labels.push({ text: name, kind: 'road', anchors, priority: r.role === 'context' ? 2 : 1 });
  }
  for (const p of data.pois) {
    const t = p.tags;
    const xy = frame.toXY([p.lon, p.lat]);
    const name = localized(t, 'name', lang) || t.brand;
    if (t.place) {
      if (name) labels.push({ text: name, kind: 'place', anchors: [{ p: xy, h: 45 }], priority: 3 });
      continue;
    }
    if (!name) continue;
    if (Math.hypot(xy[0], xy[1]) > BUILDING_RADIUS + 100) continue;
    const poi: SurroundLabel['poi'] =
      t.amenity === 'fuel' ? 'fuel' : t.amenity === 'charging_station' ? 'ev' : t.highway === 'services' || t.highway === 'rest_area' ? 'rest' : 'other';
    labels.push({ text: name, kind: 'poi', poi, anchors: [{ p: xy, h: 14 }], priority: poi === 'other' ? 1 : 2 });
  }
  labels.sort((a, b) => b.priority - a.priority);
  return { buildings: buildings.slice(0, 2500), areas, lines, labels: labels.slice(0, 24) };
}

/** Point-in-polygon (ray casting). */
export function inRing(p: XY, ring: XY[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > p[1] !== yj > p[1] && p[0] < ((xj - xi) * (p[1] - yi)) / (yj - yi + 1e-12) + xi) inside = !inside;
  }
  return inside;
}
