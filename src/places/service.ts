/**
 * The places around you, kept up to date: loads what is on the device at start, then checks every
 * half hour while the app is open (and when it comes back to the front or online) whether an
 * update is due (src/places/schedule.ts), and runs it in the places worker. Settings shows its
 * state and can start an update or remove the places.
 */
import { safeStorage } from '../auth/types';
import { PlacesClient } from './client';
import { metres } from './format';
import { connectionOk, updateDue, type PlacesState, type PlacesUpdate } from './schedule';

export type PlacesStatus = { kind: 'idle' } | { kind: 'updating'; done: number; total: number } | { kind: 'error'; message: string };

export interface PlacesServiceOptions {
  /** The website's places/ folder, or null when this build has none (the preview, the demo). */
  base: () => string | null;
  settings: () => { placesUpdate: PlacesUpdate; placesRadius: number; placesWifiOnly: boolean };
  /** Where the user is (or the map, when there is no fix yet). */
  position: () => [number, number] | null;
  /** Downloads wait while this is true (navigating). */
  busy: () => boolean;
}

const LAST_TRY = 'junctionnav.places.lastTry';
const CHECK_EVERY = 30 * 60_000;

export class PlacesService {
  readonly client = new PlacesClient();
  state: PlacesState | null = null;
  status: PlacesStatus = { kind: 'idle' };
  private listeners = new Set<() => void>();
  private running: Promise<PlacesState | null> | null = null;
  private started = false;
  private kv = safeStorage('local');
  private lastTry = Number(this.kv.get(LAST_TRY) ?? 0) || 0;

  constructor(private o: PlacesServiceOptions) {
    this.client.onProgress = (done, total) => {
      this.status = { kind: 'updating', done, total };
      this.emit();
    };
  }

  /** Places are on the device. */
  get available(): boolean {
    return !!this.state && this.state.count > 0;
  }

  /** The covered area, for the map. */
  get coverage(): { center: [number, number]; radiusKm: number } | null {
    return this.available ? { center: this.state!.center, radiusKm: this.state!.radiusKm } : null;
  }

  covers(p: [number, number]): boolean {
    const c = this.coverage;
    return !!c && metres(c.center, p) <= c.radiusKm * 1000;
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }

  /** Loads the places on the device and starts the checks. */
  async start(firstCheckIn = 8000): Promise<void> {
    if (this.started) return;
    this.started = true;
    try {
      this.state = await this.client.init();
    } catch (e) {
      console.warn('[places]', (e as Error).message);
    }
    this.emit();
    window.setTimeout(() => this.check(), firstCheckIn);
    window.setInterval(() => this.check(), CHECK_EVERY);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.check();
    });
    window.addEventListener('online', () => this.check());
  }

  /** Runs an update if one is due and the moment suits it. */
  check() {
    const base = this.o.base();
    if (!base || this.running || this.o.busy() || navigator.onLine === false) return;
    const s = this.o.settings();
    const due = updateDue(this.state, { now: Date.now(), every: s.placesUpdate, radiusKm: s.placesRadius, pos: this.o.position(), lastTry: this.lastTry });
    if (!due || !connectionOk(s.placesWifiOnly)) return;
    console.info(`[places] updating (${due})`);
    void this.update(false, false);
  }

  /** Brings the places up to date now (`manual` from Update now: no waiting rules, errors shown). */
  update(force = false, manual = true): Promise<PlacesState | null> {
    if (this.running) return this.running;
    const base = this.o.base();
    const pos = this.o.position() ?? this.state?.center ?? null;
    if (!base || !pos) {
      this.status = { kind: 'error', message: !base ? 'This version of the app has no places data.' : 'Waiting for your location.' };
      this.emit();
      return Promise.resolve(this.state);
    }
    const radius = this.o.settings().placesRadius;
    this.status = { kind: 'updating', done: 0, total: 0 };
    this.emit();
    this.running = this.client
      .update(base, pos, radius, force)
      .then((st) => {
        this.state = st;
        this.status = { kind: 'idle' };
        this.setLastTry(0);
        return st;
      })
      .catch((e: Error) => {
        this.status = { kind: 'error', message: e.message };
        if (!manual) this.setLastTry(Date.now());
        console.warn('[places] update failed:', e.message);
        return this.state;
      })
      .finally(() => {
        this.running = null;
        this.emit();
      });
    return this.running;
  }

  async clear(): Promise<void> {
    await this.running?.catch(() => null);
    await this.client.clear();
    this.state = null;
    this.status = { kind: 'idle' };
    this.emit();
  }

  private setLastTry(t: number) {
    this.lastTry = t;
    if (t) this.kv.set(LAST_TRY, String(t));
    else this.kv.remove(LAST_TRY);
  }
}
