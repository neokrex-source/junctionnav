/** Talks to the places worker (src/places/places.worker.ts). */
import PlacesWorker from './places.worker?worker&inline';
import type { AreaHit, PlaceCategory, PlaceHit, MapPlace } from './placesIndex';
import type { PlacesRequest } from './places.worker';
import type { PlacesState } from './schedule';

export class PlacesClient {
  private worker: Worker | null = null;
  private seq = 0;
  private pending = new Map<number, { resolve: (v: unknown) => void; reject: (e: Error) => void }>();
  /** Download progress of the update under way (bytes). */
  onProgress: ((done: number, total: number) => void) | null = null;

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new PlacesWorker();
    w.onmessage = (e: MessageEvent<{ id?: number; ok?: boolean; value?: unknown; error?: string; progress?: { done: number; total: number } }>) => {
      const d = e.data;
      if (d.progress) {
        this.onProgress?.(d.progress.done, d.progress.total);
        return;
      }
      const p = this.pending.get(d.id!);
      if (!p) return;
      this.pending.delete(d.id!);
      if (d.ok) p.resolve(d.value);
      else p.reject(new Error(d.error));
    };
    w.onerror = (e) => {
      for (const p of this.pending.values()) p.reject(new Error(e.message || 'The places worker failed'));
      this.pending.clear();
    };
    this.worker = w;
    return w;
  }

  private call<T>(msg: PlacesRequest): Promise<T> {
    const id = ++this.seq;
    return new Promise<T>((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      this.ensure().postMessage({ id, msg });
    });
  }

  init(): Promise<PlacesState | null> {
    return this.call({ type: 'init' });
  }
  update(base: string, center: [number, number], radiusKm: number, force = false): Promise<PlacesState> {
    return this.call({ type: 'update', base, center, radiusKm, force });
  }
  clear(): Promise<void> {
    return this.call({ type: 'clear' });
  }
  box(bbox: [number, number, number, number], zoom: number, limit: number, driving = false): Promise<MapPlace[]> {
    return this.call({ type: 'box', bbox, zoom, limit, driving });
  }
  search(q: string, near: [number, number] | null, limit = 8): Promise<PlaceHit[]> {
    return this.call({ type: 'search', q, near, limit });
  }
  near(points: [number, number][], radius: number, cat: PlaceCategory, limit = 120): Promise<PlaceHit[]> {
    return this.call({ type: 'near', points, radius, cat, limit });
  }
  get(id: string): Promise<PlaceHit | null> {
    return this.call({ type: 'get', id });
  }
  nearest(p: [number, number], maxDist = 30): Promise<PlaceHit | null> {
    return this.call({ type: 'nearest', p, maxDist });
  }
  /** Roughly where a street or postcode is, from the places' addresses. */
  area(street: string | null, postcode: string | null, town: string | null): Promise<AreaHit[]> {
    return this.call({ type: 'area', street, postcode, town });
  }
}
