/** Road data from the offline graph in the shapes the junction view and tunnel signs expect. */
import { haversine, type LngLat } from '../geo/geo';
import type { OsmData, OsmNode, OsmWay } from '../junction/osmdata';
import type { OfflineGraph } from './graph';
import { wayLevel } from '../junction/vertical';
import { CLASSES, D_BWD, D_FWD, F_BRIDGE, F_LINK, F_TUNNEL } from './graphLayout';
import type { PlaceIndex } from './places';
import type { CameraPoint, LimitWay, SpeedData } from '../nav/speed';

function wayOf(G: OfflineGraph, seg: number): OsmWay {
  const pts = G.points(seg);
  const nodes = pts.map((_, i) => (i === 0 ? G.segA[seg] + 1 : i === pts.length - 1 ? G.segB[seg] + 1 : -(G.segShape[seg] + i)));
  return {
    id: seg + 1,
    nodes,
    geometry: pts.map(([lon, lat]) => ({ lat, lon })),
    tags: G.tags(G.segWay[seg]),
  };
}

function near(G: OfflineGraph, seg: number, p: LngLat, radius: number): boolean {
  return G.points(seg).some((q) => haversine(p, q) <= radius);
}

/**
 * Main roads (tertiary and up, with their ramps) and every bridge and tunnel reach this far from
 * the junction, beyond the other roads: the flyovers around a junction stand up in its view, and
 * their heights come out right only when the roads they cross are known too.
 */
export const STRUCTURE_RADIUS = 900;

function reachesFar(G: OfflineGraph, seg: number): boolean {
  const w = G.segWay[seg];
  if (G.wayClass[w] <= TERTIARY || (G.wayFlags[w] & (F_BRIDGE | F_TUNNEL)) !== 0) return true;
  return wayLevel(G.tags(w)) !== 0;
}

/**
 * Roads within `radius` of each point (as Overpass would return them), main roads, bridges and
 * tunnels out to `structRadius`, plus exit-number nodes.
 */
export function junctionData(G: OfflineGraph, points: LngLat[], radius = 450, structRadius = Math.max(radius, STRUCTURE_RADIUS)): OsmData {
  const segs = new Set<number>();
  for (const p of points) for (const s of G.segmentsNear(p, radius)) if (!segs.has(s) && near(G, s, p, radius + 60)) segs.add(s);
  if (structRadius > radius)
    for (const p of points) for (const s of G.segmentsNear(p, structRadius)) if (!segs.has(s) && reachesFar(G, s) && near(G, s, p, structRadius + 60)) segs.add(s);
  const ways = [...segs].map((s) => wayOf(G, s));
  const nodes: OsmNode[] = [];
  for (let i = 0; i < G.jV.length; i++) {
    const v = G.jV[i];
    const q = G.vertex(v);
    if (!points.some((p) => haversine(p, q) <= radius + 100)) continue;
    nodes.push({ id: v + 1, lon: q[0], lat: q[1], tags: { highway: 'motorway_junction', ref: G.str(G.jRef[i]), name: G.str(G.jName[i]) } });
  }
  return { ways, nodes };
}

/** Tunnel stretches of road near a path. */
export function tunnelWays(G: OfflineGraph, path: LngLat[]): OsmWay[] {
  const segs = new Set<number>();
  let last: LngLat | null = null;
  for (const p of path) {
    if (last && haversine(last, p) < 150) continue;
    last = p;
    for (const s of G.segmentsNear(p, 200)) if (G.wayFlags[G.segWay[s]] & F_TUNNEL) segs.add(s);
  }
  return [...segs].map((s) => wayOf(G, s));
}

const SECONDARY = CLASSES.indexOf('secondary');
const TERTIARY = CLASSES.indexOf('tertiary');
const norm = (s: string) => s.toUpperCase().replace(/\s+/g, '');

/**
 * Main roads (expressway to secondary, no ramps) matching a ref ("E19") or a name ("SUKE")
 * within `radius` metres of a point, as Overpass would return them for a trip link road point.
 */
export function roadWays(G: OfflineGraph, names: string[], center: LngLat, radius: number): OsmWay[] {
  const refs = names.filter((n) => /^[A-Z]{1,3}\s?\d{1,4}[A-Z]?$/i.test(n.trim())).map(norm);
  const words = names.filter((n) => !refs.includes(norm(n))).map((n) => n.toLowerCase());
  const c = G.h.cell;
  const dLat = radius / 111_320;
  const dLon = radius / (111_320 * Math.cos((center[1] * Math.PI) / 180));
  const cx0 = Math.max(0, Math.floor((center[0] - dLon - c.lonMin) / c.size));
  const cx1 = Math.min(c.nx - 1, Math.floor((center[0] + dLon - c.lonMin) / c.size));
  const cy0 = Math.max(0, Math.floor((center[1] - dLat - c.latMin) / c.size));
  const cy1 = Math.min(c.ny - 1, Math.floor((center[1] + dLat - c.latMin) / c.size));
  const wayOk = new Map<number, boolean>();
  const segs = new Set<number>();
  for (let cy = cy0; cy <= cy1; cy++)
    for (let cx = cx0; cx <= cx1; cx++) {
      const key = cy * c.nx + cx;
      let lo = 0;
      let hi = G.cellKey.length;
      while (lo < hi) {
        const m = (lo + hi) >>> 1;
        if (G.cellKey[m] < key) lo = m + 1;
        else hi = m;
      }
      if (lo >= G.cellKey.length || G.cellKey[lo] !== key) continue;
      for (let k = G.cellStart[lo]; k < G.cellStart[lo + 1]; k++) {
        const seg = G.cellSegs[k];
        const w = G.segWay[seg];
        if (G.wayClass[w] > SECONDARY || G.wayFlags[w] & F_LINK) continue;
        let ok = wayOk.get(w);
        if (ok === undefined) {
          const t = G.tags(w);
          const wayRefs = (t.ref ?? '').split(';').map(norm);
          const nm = `${t.name ?? ''}|${t['name:en'] ?? ''}`.toLowerCase();
          ok = refs.some((r) => wayRefs.includes(r)) || words.some((x) => nm.includes(x));
          wayOk.set(w, ok);
        }
        if (ok && near(G, seg, center, radius)) segs.add(seg);
      }
    }
  return [...segs].map((s) => wayOf(G, s));
}

/**
 * The speed data along a path, as the Overpass lookup gives it: roads with a speed limit within
 * 15 m of the path, and the speed cameras within 45 m with the road each stands on. Speed cameras
 * are in the place index as "Speed camera 110 km/h" (the limit, when the map has one).
 */
export function speedData(G: OfflineGraph, places: PlaceIndex | null, path: LngLat[]): SpeedData {
  const segs = new Set<number>();
  let last: LngLat | null = null;
  for (const p of path) {
    if (last && haversine(last, p) < 10) continue;
    last = p;
    for (const s of G.segmentsNear(p, 15)) {
      if (segs.has(s)) continue;
      const t = G.tags(G.segWay[s]);
      if (!t.maxspeed && !t['maxspeed:forward'] && !t['maxspeed:backward']) continue;
      if (near(G, s, p, 40)) segs.add(s);
    }
  }
  const ways: LimitWay[] = [...segs].map((s) => ({ id: `seg${s}`, coords: G.points(s), tags: G.tags(G.segWay[s]) }));
  const cameras: CameraPoint[] = [];
  for (const c of places?.byKind(['highway=speed_camera'], path, 45) ?? []) {
    const m = /(\d+)\s*km\/h/.exec(c.name);
    // The road it stands on: the nearest segment within a few metres.
    let road: CameraPoint['road'];
    let bestD = 4;
    for (const s of G.segmentsNear(c.lngLat, 10)) {
      const pts = G.points(s);
      for (let i = 0; i + 1 < pts.length; i++) {
        const d = pointSegDist(c.lngLat, pts[i], pts[i + 1]);
        if (d < bestD) {
          bestD = d;
          const fwd = (G.segDir[s] & D_FWD) !== 0;
          const bwd = (G.segDir[s] & D_BWD) !== 0;
          road = { coords: pts, oneway: fwd && !bwd ? 1 : bwd && !fwd ? -1 : 0 };
        }
      }
    }
    cameras.push({ id: `p${c.lngLat[0].toFixed(6)},${c.lngLat[1].toFixed(6)}`, at: c.lngLat, tags: { highway: 'speed_camera', ...(m ? { maxspeed: m[1] } : {}) }, ...(road ? { road } : {}) });
  }
  return { ways, cameras, checks: [] };
}

function pointSegDist(p: LngLat, a: LngLat, b: LngLat): number {
  const kx = 111_320 * Math.cos((p[1] * Math.PI) / 180);
  const ky = 110_540;
  const ax = (a[0] - p[0]) * kx;
  const ay = (a[1] - p[1]) * ky;
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * ky;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len2)) : 0;
  return Math.hypot(ax + dx * t, ay + dy * t);
}
