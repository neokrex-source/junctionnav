/** Talks to the offline worker. */
import type { LngLat } from '../geo/geo';
import type { OsmData, OsmWay } from '../junction/osmdata';
import type { OsrmResponse } from '../routing/osrm';
import OfflineWorker from './offline.worker?worker&inline';
import type { WorkerRequest } from './offline.worker';
import type { OfflinePlace } from './places';
import type { OfflineRouteRequest } from './router';

export class OfflineClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  private loading: Promise<unknown> | null = null;
  private dir: string[] = [];

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

  /** Loads the pack's graph and place index (once per pack). */
  load(dir: string[]): Promise<unknown> {
    if (this.loading && dir.join('/') === this.dir.join('/')) return this.loading;
    this.dir = dir;
    this.loading = this.call({ type: 'load', dir }).catch((e) => {
      this.loading = null;
      throw e;
    });
    return this.loading;
  }

  unload() {
    this.worker?.terminate();
    this.worker = null;
    this.loading = null;
    this.dir = [];
  }

  get loaded(): boolean {
    return !!this.loading;
  }

  async route(req: OfflineRouteRequest): Promise<OsrmResponse> {
    await this.loading;
    return this.call({ type: 'route', req });
  }
  async junction(points: LngLat[], radius = 450): Promise<OsmData> {
    await this.loading;
    return this.call({ type: 'junction', points, radius });
  }
  async tunnels(path: LngLat[]): Promise<OsmWay[]> {
    await this.loading;
    return this.call({ type: 'tunnels', path });
  }
  async search(q: string, near: LngLat | null, limit = 10): Promise<OfflinePlace[]> {
    await this.loading;
    return this.call({ type: 'search', q, near, limit });
  }
  async nearest(p: LngLat): Promise<OfflinePlace | null> {
    await this.loading;
    return this.call({ type: 'nearest', p });
  }
  /** Main roads by ref or name near a point (trip link road points without Overpass). */
  async roads(names: string[], center: LngLat, radius: number): Promise<OsmWay[]> {
    await this.loading;
    return this.call({ type: 'roads', names, center, radius });
  }
  async pois(kinds: string[], points: LngLat[], radius: number): Promise<(OfflinePlace & { dist: number })[]> {
    await this.loading;
    return this.call({ type: 'pois', kinds, points, radius });
  }
}
