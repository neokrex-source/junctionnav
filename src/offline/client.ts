/** Talks to the offline worker. */
import type { LngLat } from '../geo/geo';
import type { OsmData, OsmWay } from '../junction/osmdata';
import type { SpeedData } from '../nav/speed';
import type { OsrmResponse } from '../routing/osrm';
import OfflineWorker from './offline.worker?worker&inline';
import type { WorkerRequest } from './offline.worker';
import type { OfflinePlace } from './places';
import type { OfflineRouteRequest } from './router';
import { packFor } from './store';
import type { PackManifest } from './graphLayout';

/** A pack the worker can open: its folder and its box. */
export interface PackRef {
  id: string;
  dir: string[];
  manifest: PackManifest;
}

export class OfflineClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private packs: PackRef[] = [];

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    const w = new OfflineWorker();
    w.onmessage = (e: MessageEvent<{ id: number; ok: boolean; value?: unknown; error?: string }>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      this.pending.delete(e.data.id);
      if (e.data.ok) p.resolve(e.data.value);
      else p.reject(new Error(e.data.error));
    };
    w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'Offline worker failed'));
      this.pending.clear();
    };
    this.worker = w;
    return w;
  }

  private call<T>(msg: WorkerRequest): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ensureWorker().postMessage({ id, msg });
    });
  }

  /** The packs on the device (the app picks one for each request by where it is). */
  setPacks(packs: PackRef[]) {
    const keep = new Set(packs.map((p) => p.dir.join('/')));
    for (const p of this.packs) if (!keep.has(p.dir.join('/'))) void this.call({ type: 'forget', dir: p.dir }).catch(() => {});
    this.packs = packs;
  }

  /** Opens a pack's graph and place index now (to check it opens, and to answer the first request at once). */
  async load(dir: string[]): Promise<unknown> {
    return this.call({ type: 'load', dir });
  }

  unload() {
    this.worker?.terminate();
    this.worker = null;
    this.packs = [];
  }

  /** Any pack to answer from. */
  get loaded(): boolean {
    return this.packs.length > 0;
  }

  /** The pack for these points: one that has them all, else the one at the first. */
  private dirFor(points: LngLat[]): string[] {
    const p = packFor(this.packs, points) ?? this.packs[0];
    if (!p) throw new Error('No offline maps on this device.');
    return p.dir;
  }

  /** Is there a pack with every one of these points in it? */
  covers(points: LngLat[]): boolean {
    return this.packs.some((p) => points.every((q) => q[0] >= p.manifest.bbox[0] && q[0] <= p.manifest.bbox[2] && q[1] >= p.manifest.bbox[1] && q[1] <= p.manifest.bbox[3]));
  }

  async route(req: OfflineRouteRequest): Promise<OsrmResponse> {
    return this.call({ type: 'route', dir: this.dirFor(req.coords), req });
  }
  async junction(points: LngLat[], radius = 450): Promise<OsmData> {
    return this.call({ type: 'junction', dir: this.dirFor(points), points, radius });
  }
  async tunnels(path: LngLat[]): Promise<OsmWay[]> {
    return this.call({ type: 'tunnels', dir: this.dirFor(path), path });
  }
  async search(q: string, near: LngLat | null, limit = 10): Promise<OfflinePlace[]> {
    return this.call({ type: 'search', dir: this.dirFor(near ? [near] : []), q, near, limit });
  }
  async nearest(p: LngLat): Promise<OfflinePlace | null> {
    if (!this.covers([p])) return null;
    return this.call({ type: 'nearest', dir: this.dirFor([p]), p });
  }
  /** Main roads by ref or name near a point (trip link road points without Overpass). */
  async roads(names: string[], center: LngLat, radius: number): Promise<OsmWay[]> {
    return this.call({ type: 'roads', dir: this.dirFor([center]), names, center, radius });
  }
  /** Roads with speed limits and speed cameras along a path (src/nav/speed.ts). */
  async speed(path: LngLat[]): Promise<SpeedData> {
    return this.call({ type: 'speed', dir: this.dirFor(path), path });
  }
  async pois(kinds: string[], points: LngLat[], radius: number): Promise<(OfflinePlace & { dist: number })[]> {
    if (!points.length || !this.covers([points[0]])) return [];
    return this.call({ type: 'pois', dir: this.dirFor(points), kinds, points, radius });
  }
}
