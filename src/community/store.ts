/**
 * Your places, kept in this browser per account (like pins and saved places) and, with the
 * shared places service and a signed-in account, sent to it and fetched back on every device.
 * Changes are made here first and sent when the service can be reached, so adding a place works
 * with no signal too. Plus the public places of everyone else around the map, fetched as needed.
 */
import { haversine, type LngLat } from '../geo/geo';
import { matchScore } from '../places/placesIndex';
import { normName, type PlaceGroup } from '../places/format';
import type { SharedPlacesApi } from './remote';
import type { LocalPlace, SharedPlace, Visibility } from './types';

const KEY = 'junctionnav.myplaces.v1';
export const MAX_PLACES = 500;

function newId(): string {
  const c = (globalThis as { crypto?: Crypto }).crypto;
  if (c?.randomUUID) return c.randomUUID();
  const h = (n: number) =>
    Array.from({ length: n }, () =>
      Math.floor(Math.random() * 16)
        .toString(16)
        .toLowerCase(),
    ).join('');
  return `${h(8)}-${h(4)}-4${h(3)}-${'89ab'[Math.floor(Math.random() * 4)]}${h(3)}-${h(12)}`;
}

function valid(x: unknown): x is LocalPlace {
  const p = x as LocalPlace;
  return !!p && typeof p.id === 'string' && typeof p.name === 'string' && Array.isArray(p.lngLat) && Number.isFinite(p.lngLat[0]) && Number.isFinite(p.lngLat[1]);
}

const round7 = (v: number) => Math.round(v * 1e7) / 1e7;

/** How well a place's name answers a search (0: not at all), like the places around you. */
export function nameScore(name: string, q: string): number {
  const nq = normName(q);
  if (!nq) return 0;
  return matchScore(normName(name), nq, nq.split(' ').filter(Boolean));
}

export type PlaceFields = Pick<SharedPlace, 'name' | 'category' | 'note' | 'phone' | 'website' | 'lngLat' | 'heading' | 'visibility'>;

export class MyPlacesStore {
  places: LocalPlace[] = [];
  /** The shared places service, when the site has one. */
  api: SharedPlacesApi | null = null;
  /** The signed-in account on that service ('' when there is none). */
  owner = '';
  ownerName = '';
  /** Called after every change (the map and lists redraw). */
  onChange: (() => void) | null = null;
  /** The last sync problem, if the last sync failed. */
  lastError: string | null = null;
  private key = KEY;
  private syncing: Promise<void> | null = null;
  private again = false;

  constructor(private storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null) {
    this.load();
  }

  private load() {
    this.places = [];
    try {
      const raw = this.storage?.getItem(this.key);
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      this.places = Array.isArray(list) ? list.filter(valid) : [];
    } catch {
      /* storage unavailable or damaged */
    }
  }

  private persist() {
    try {
      this.storage?.setItem(this.key, JSON.stringify(this.places));
    } catch {
      /* storage unavailable */
    }
    this.onChange?.();
  }

  /**
   * Places belong to the signed-in account. `owner` is the account on the shared places service
   * (empty for an account kept only in this browser, or a guest).
   */
  useScope(userId: string | null, account: { owner: string; name: string } | null, api: SharedPlacesApi | null) {
    this.key = userId ? `${KEY}.${userId}` : KEY;
    this.owner = account?.owner ?? '';
    this.ownerName = (account?.name ?? '').trim().split(/\s+/)[0] ?? '';
    this.api = api;
    this.lastError = null;
    this.load();
    this.onChange?.();
    if (this.canShare) void this.sync();
  }

  /** Places can go to the shared service: it exists and you are signed in to it. */
  get canShare(): boolean {
    return !!this.api && !!this.owner;
  }

  /** Your places, newest first. */
  list(): LocalPlace[] {
    return this.places.filter((p) => !p.deleted).sort((a, b) => b.updated - a.updated);
  }

  get(id: string): LocalPlace | undefined {
    return this.places.find((p) => p.id === id && !p.deleted);
  }

  /** Your places matching a search, best first, then nearest. */
  matches(q: string, near: LngLat | null, limit = 6): LocalPlace[] {
    return this.list()
      .map((p) => ({ p, s: nameScore(p.name, q), d: near ? haversine(near, p.lngLat) : 0 }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.d - b.d)
      .slice(0, limit)
      .map((x) => x.p);
  }

  /** Your places of some kinds within `radius` metres of any of the points. */
  near(points: LngLat[], radius: number, groups: PlaceGroup[]): LocalPlace[] {
    return this.list().filter((p) => groups.includes(p.category) && points.some((q) => haversine(q, p.lngLat) <= radius));
  }

  add(f: PlaceFields): LocalPlace {
    const p: LocalPlace = {
      ...f,
      id: newId(),
      lngLat: [round7(f.lngLat[0]), round7(f.lngLat[1])],
      visibility: this.canShare ? f.visibility : 'private',
      ownerName: this.ownerName,
      owner: this.owner,
      updated: Date.now(),
      synced: false,
      remote: false,
    };
    this.places = [p, ...this.places].slice(0, MAX_PLACES);
    this.persist();
    void this.sync();
    return p;
  }

  update(id: string, f: Partial<PlaceFields>): LocalPlace | undefined {
    const p = this.get(id);
    if (!p) return undefined;
    Object.assign(p, f);
    if (f.lngLat) p.lngLat = [round7(f.lngLat[0]), round7(f.lngLat[1])];
    if (!this.canShare) p.visibility = p.remote ? p.visibility : 'private';
    p.ownerName = this.ownerName || p.ownerName;
    p.updated = Date.now();
    p.synced = false;
    this.persist();
    void this.sync();
    return p;
  }

  remove(id: string) {
    const p = this.places.find((x) => x.id === id);
    if (!p) return;
    if (p.remote) {
      p.deleted = true;
      p.synced = false;
    } else this.places = this.places.filter((x) => x.id !== id);
    this.persist();
    void this.sync();
  }

  /** Changes not on the shared service yet. */
  get pending(): number {
    return this.places.filter((p) => !p.synced).length;
  }

  /**
   * Sends what changed here and fetches what changed elsewhere (another device). One at a time;
   * a call while one runs asks for another round after it.
   */
  sync(): Promise<void> {
    if (!this.canShare) return Promise.resolve();
    if (this.syncing) {
      this.again = true;
      return this.syncing;
    }
    this.syncing = (async () => {
      do {
        this.again = false;
        await this.round();
      } while (this.again);
    })().finally(() => (this.syncing = null));
    return this.syncing;
  }

  private async round() {
    const api = this.api;
    const owner = this.owner;
    if (!api || !owner) return;
    const key = this.key;
    try {
      for (const p of this.places.filter((x) => !x.synced)) {
        // Signed out or into another account meanwhile: these are not that account's places.
        if (this.key !== key || this.owner !== owner) return;
        if (p.deleted) {
          if (p.remote) await api.remove(p.id);
          this.places = this.places.filter((x) => x !== p);
          continue;
        }
        const at = p.updated;
        const sent = p.remote ? ((await api.update(p)) ?? (await api.create(p))) : await api.create(p);
        p.remote = true;
        p.hidden = sent.hidden;
        // Changed again while it was on its way: that goes next round.
        if (p.updated === at && !p.deleted) p.synced = true;
      }
      const rows = await api.mine(owner);
      if (this.key !== key) return;
      const byId = new Map(rows.map((r) => [r.id, r]));
      const next: LocalPlace[] = [];
      for (const p of this.places) {
        const r = byId.get(p.id);
        byId.delete(p.id);
        if (!p.synced) next.push(p);
        else if (r) next.push({ ...r, synced: true, remote: true });
        else if (!p.remote) next.push(p);
        // Synced before but gone there: deleted on another device.
      }
      for (const r of byId.values()) next.push({ ...r, synced: true, remote: true });
      this.places = next;
      this.lastError = null;
    } catch (e) {
      this.lastError = (e as Error).message;
    }
    if (this.key === key) this.persist();
  }
}

/** A tile of the public places cache (degrees). */
const TILE = 0.2;
/** A tile is fetched again after this long (ms). */
const FRESH = 10 * 60_000;

/** Everyone's public places around where the map is, fetched a tile at a time. */
export class PublicPlaces {
  private byId = new Map<string, SharedPlace>();
  private tiles = new Map<string, { at: number; ids: string[] }>();
  private loading = new Set<string>();
  onChange: (() => void) | null = null;

  constructor(
    public api: () => SharedPlacesApi | null,
    private now: () => number = () => Date.now(),
  ) {}

  clear() {
    this.byId.clear();
    this.tiles.clear();
  }

  /** Makes sure the tiles covering the box are loaded (at most 12 at a time). */
  async load(box: [number, number, number, number]): Promise<void> {
    const api = this.api();
    if (!api) return;
    const [w, s, e, n] = box;
    const keys: [string, [number, number, number, number]][] = [];
    for (let x = Math.floor(w / TILE); x <= Math.floor(e / TILE); x++)
      for (let y = Math.floor(s / TILE); y <= Math.floor(n / TILE); y++) {
        const k = `${x}/${y}`;
        const t = this.tiles.get(k);
        if (this.loading.has(k) || (t && this.now() - t.at < FRESH)) continue;
        keys.push([k, [x * TILE, y * TILE, (x + 1) * TILE, (y + 1) * TILE]]);
      }
    if (!keys.length || keys.length > 12) return;
    await Promise.all(
      keys.map(async ([k, b]) => {
        this.loading.add(k);
        try {
          const list = await api.inBox(b, 300);
          for (const id of this.tiles.get(k)?.ids ?? []) this.byId.delete(id);
          for (const p of list) this.byId.set(p.id, p);
          this.tiles.set(k, { at: this.now(), ids: list.map((p) => p.id) });
        } catch (err) {
          console.info('[places] shared places not loaded:', (err as Error).message);
        } finally {
          this.loading.delete(k);
        }
      }),
    );
    this.onChange?.();
  }

  /** A place (fetched or loaded by a link) to keep with the rest. */
  put(p: SharedPlace) {
    this.byId.set(p.id, p);
    this.onChange?.();
  }

  drop(id: string) {
    if (this.byId.delete(id)) this.onChange?.();
  }

  get(id: string): SharedPlace | undefined {
    return this.byId.get(id);
  }

  inBox([w, s, e, n]: [number, number, number, number]): SharedPlace[] {
    return [...this.byId.values()].filter((p) => p.lngLat[0] >= w && p.lngLat[0] <= e && p.lngLat[1] >= s && p.lngLat[1] <= n);
  }

  near(points: LngLat[], radius: number, groups: PlaceGroup[]): SharedPlace[] {
    return [...this.byId.values()].filter((p) => p.visibility === 'public' && groups.includes(p.category) && points.some((q) => haversine(q, p.lngLat) <= radius));
  }

  matches(q: string, near: LngLat | null, limit = 6): SharedPlace[] {
    return [...this.byId.values()]
      .filter((p) => p.visibility === 'public')
      .map((p) => ({ p, s: nameScore(p.name, q), d: near ? haversine(near, p.lngLat) : 0 }))
      .filter((x) => x.s > 0 && x.d < 150_000)
      .sort((a, b) => b.s - a.s || a.d - b.d)
      .slice(0, limit)
      .map((x) => x.p);
  }
}

export type { Visibility };
