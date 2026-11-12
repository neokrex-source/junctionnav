/// <reference lib="webworker" />
/**
 * Offline worker: loads the road graph and place index from browser storage (OPFS) and answers
 * routing, junction-detail, tunnel and search requests without blocking the map.
 */
import type { LngLat } from '../geo/geo';
import { OfflineGraph } from './graph';
import { PlaceIndex } from './places';
import { junctionData, roadWays, speedData, tunnelWays } from './queries';
import { OfflineRouter, type OfflineRouteRequest } from './router';

export type WorkerRequest =
  | { type: 'load'; dir: string[] }
  | { type: 'route'; req: OfflineRouteRequest }
  | { type: 'junction'; points: LngLat[]; radius: number }
  | { type: 'tunnels'; path: LngLat[] }
  | { type: 'search'; q: string; near: LngLat | null; limit: number }
  | { type: 'nearest'; p: LngLat }
  | { type: 'pois'; kinds: string[]; points: LngLat[]; radius: number }
  | { type: 'roads'; names: string[]; center: LngLat; radius: number }
  | { type: 'speed'; path: LngLat[] };

let graph: OfflineGraph | null = null;
let router: OfflineRouter | null = null;
let places: PlaceIndex | null = null;

async function readFile(dir: string[], name: string): Promise<ArrayBuffer> {
  let d = await navigator.storage.getDirectory();
  for (const part of dir) d = await d.getDirectoryHandle(part);
  return (await (await d.getFileHandle(name)).getFile()).arrayBuffer();
}

async function handle(msg: WorkerRequest): Promise<unknown> {
  switch (msg.type) {
    case 'load': {
      graph = new OfflineGraph(await readFile(msg.dir, 'graph.bin'));
      router = new OfflineRouter(graph);
      try {
        places = new PlaceIndex(await readFile(msg.dir, 'places.bin'));
      } catch {
        places = null;
      }
      return { segments: graph.h.nS, places: places?.count ?? 0, bbox: graph.h.bbox };
    }
    case 'route':
      if (!router) throw new Error('Offline data is not loaded');
      return router.route(msg.req);
    case 'junction':
      if (!graph) throw new Error('Offline data is not loaded');
      return junctionData(graph, msg.points, msg.radius);
    case 'tunnels':
      if (!graph) throw new Error('Offline data is not loaded');
      return tunnelWays(graph, msg.path);
    case 'search':
      return places ? places.search(msg.q, msg.near, msg.limit) : [];
    case 'nearest':
      return places?.nearest(msg.p) ?? null;
    case 'pois':
      return places ? places.byKind(msg.kinds, msg.points, msg.radius) : [];
    case 'roads':
      if (!graph) throw new Error('Offline data is not loaded');
      return roadWays(graph, msg.names, msg.center, msg.radius);
    case 'speed':
      if (!graph) throw new Error('Offline data is not loaded');
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
