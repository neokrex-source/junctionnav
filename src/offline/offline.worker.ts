/// <reference lib="webworker" />
/**
 * Offline worker: loads the road graphs and place indexes of the packs from browser storage
 * (OPFS) as they are needed and answers routing, junction-detail, tunnel and search requests
 * without blocking the map. Each request names the pack it is for.
 */
import type { LngLat } from '../geo/geo';
import { OfflineGraph } from './graph';
import { PlaceIndex } from './places';
import { junctionData, roadWays, speedData, tunnelWays } from './queries';
import { OfflineRouter, type OfflineRouteRequest } from './router';

export type WorkerRequest =
  | { type: 'load'; dir: string[] }
  | { type: 'route'; dir: string[]; req: OfflineRouteRequest }
  | { type: 'junction'; dir: string[]; points: LngLat[]; radius: number }
  | { type: 'tunnels'; dir: string[]; path: LngLat[] }
  | { type: 'search'; dir: string[]; q: string; near: LngLat | null; limit: number }
  | { type: 'nearest'; dir: string[]; p: LngLat }
  | { type: 'pois'; dir: string[]; kinds: string[]; points: LngLat[]; radius: number }
  | { type: 'roads'; dir: string[]; names: string[]; center: LngLat; radius: number }
  | { type: 'speed'; dir: string[]; path: LngLat[] }
  | { type: 'forget'; dir: string[] };

interface Loaded {
  graph: OfflineGraph;
  router: OfflineRouter;
  places: PlaceIndex | null;
}

/** Packs in memory, the most recently used last (two at most: a road graph can be large). */
const packs = new Map<string, Promise<Loaded>>();
const KEEP = 2;

async function readFile(dir: string[], name: string): Promise<ArrayBuffer> {
  let d = await navigator.storage.getDirectory();
  for (const part of dir) d = await d.getDirectoryHandle(part);
  return (await (await d.getFileHandle(name)).getFile()).arrayBuffer();
}

function pack(dir: string[]): Promise<Loaded> {
  const key = dir.join('/');
  let p = packs.get(key);
  if (p) {
    packs.delete(key);
    packs.set(key, p);
    return p;
  }
  p = (async () => {
    const graph = new OfflineGraph(await readFile(dir, 'graph.bin'));
    let places: PlaceIndex | null = null;
    try {
      places = new PlaceIndex(await readFile(dir, 'places.bin'));
    } catch {
      places = null;
    }
    return { graph, router: new OfflineRouter(graph), places };
  })();
  p.catch(() => packs.delete(key));
  packs.set(key, p);
  while (packs.size > KEEP) packs.delete(packs.keys().next().value as string);
  return p;
}

async function handle(msg: WorkerRequest): Promise<unknown> {
  if (msg.type === 'forget') {
    packs.delete(msg.dir.join('/'));
    return null;
  }
  const { graph, router, places } = await pack(msg.dir);
  switch (msg.type) {
    case 'load':
      return { segments: graph.h.nS, places: places?.count ?? 0, bbox: graph.h.bbox };
    case 'route':
      return router.route(msg.req);
    case 'junction':
      return junctionData(graph, msg.points, msg.radius);
    case 'tunnels':
      return tunnelWays(graph, msg.path);
    case 'search':
      return places ? places.search(msg.q, msg.near, msg.limit) : [];
    case 'nearest':
      return places?.nearest(msg.p) ?? null;
    case 'pois':
      return places ? places.byKind(msg.kinds, msg.points, msg.radius) : [];
    case 'roads':
      return roadWays(graph, msg.names, msg.center, msg.radius);
    case 'speed':
      return speedData(graph, places, msg.path);
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; msg: WorkerRequest }>) => {
  const { id, msg } = e.data;
  try {
    (self as unknown as Worker).postMessage({ id, ok: true, value: await handle(msg) });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, ok: false, error: (err as Error).message ?? String(err) });
  }
};
