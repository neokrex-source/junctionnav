/** Road data from the offline graph in the shapes the junction view and tunnel signs expect. */
import { haversine, type LngLat } from '../geo/geo';
import type { OsmData, OsmNode, OsmWay } from '../junction/osmdata';
import type { OfflineGraph } from './graph';
import { F_TUNNEL } from './graphLayout';

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

/** Roads within `radius` of each point (as Overpass would return them) plus exit-number nodes. */
export function junctionData(G: OfflineGraph, points: LngLat[], radius = 450): OsmData {
  const segs = new Set<number>();
  for (const p of points) for (const s of G.segmentsNear(p, radius)) if (!segs.has(s) && near(G, s, p, radius + 60)) segs.add(s);
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
