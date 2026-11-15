/**
 * Saved places: Home, Work, favourites, your groups (Want to go and the ones you create) and
 * recent destinations, kept in this browser with the signed-in account.
 */
import type { Place } from '../search/places';

export interface SavedGroup {
  id: string;
  /** Your name for it ('' for a built-in group not renamed, shown in the app's language). */
  name: string;
  builtIn?: 'want';
  color: string;
  items: Place[];
  /** When it was made (ms). */
  at: number;
}

export interface SavedPlaces {
  home?: Place;
  work?: Place;
  favourites: Place[];
  recents: Place[];
  groups?: SavedGroup[];
}

const KEY = 'junctionnav.places.v1';
const MAX_RECENTS = 10;
export const MAX_FAVOURITES = 200;
export const MAX_GROUP_ITEMS = 300;
export const MAX_GROUPS = 40;
/** The favourites, shown as the first group. */
export const FAV = 'fav';
const COLORS = ['#0d9488', '#ea580c', '#7c3aed', '#2563eb', '#db2777', '#16a34a', '#ca8a04', '#0891b2'];

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

/** What is kept of a place: its name, position and heading, and for saved places their details, note and link. */
export function clean(p: Place, full = false): Place {
  const out: Place = { name: p.name, sub: p.sub, lngLat: [round6(p.lngLat[0]), round6(p.lngLat[1])] };
  // A direction of travel (a pin's heading) stays with the place: Home on a divided road, say.
  if (p.bearing != null && Number.isFinite(p.bearing)) out.bearing = Math.round(p.bearing);
  if (!full) return out;
  if (p.info) out.info = p.info;
  if (p.placeId) out.placeId = p.placeId;
  if (p.discover) out.discover = { ...p.discover, sources: p.discover.sources.slice(0, 12) };
  if (p.memo) out.memo = p.memo.slice(0, 500);
  if (p.link) out.link = p.link.slice(0, 500);
  return out;
}

export function samePlace(a: Place, b: Place): boolean {
  return Math.abs(a.lngLat[0] - b.lngLat[0]) < 2e-5 && Math.abs(a.lngLat[1] - b.lngLat[1]) < 2e-5;
}

const defaultGroups = (): SavedGroup[] => [{ id: 'want', name: '', builtIn: 'want', color: COLORS[0], items: [], at: 0 }];

export class PlaceStore {
  data: SavedPlaces = { favourites: [], recents: [], groups: defaultGroups() };
  private key = KEY;
  /** Called after every change (lists and the map redraw). */
  onChange: (() => void) | null = null;

  constructor() {
    this.load();
  }

  private load() {
    this.data = { favourites: [], recents: [], groups: defaultGroups() };
    try {
      const raw = localStorage.getItem(this.key);
      if (raw) {
        const got = JSON.parse(raw) as Partial<SavedPlaces>;
        this.data = { favourites: [], recents: [], ...got, groups: Array.isArray(got.groups) ? got.groups.filter((g) => g && typeof g.id === 'string' && Array.isArray(g.items)) : defaultGroups() };
      }
    } catch {
      /* storage unavailable */
    }
  }

  /**
   * Saved places belong to the signed-in account. The first account to sign in on a device
   * takes over places saved before accounts existed.
   */
  useScope(userId: string | null) {
    this.key = userId ? `${KEY}.${userId}` : KEY;
    try {
      if (userId && !localStorage.getItem(this.key) && !localStorage.getItem(`${KEY}.migrated`)) {
        const legacy = localStorage.getItem(KEY);
        if (legacy) localStorage.setItem(this.key, legacy);
        localStorage.setItem(`${KEY}.migrated`, '1');
      }
    } catch {
      /* storage unavailable */
    }
    this.load();
    this.onChange?.();
  }

  private persist() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch {
      /* storage unavailable */
    }
    this.onChange?.();
  }

  addRecent(p: Place) {
    if (!Number.isFinite(p.lngLat[0])) return;
    this.data.recents = [clean(p), ...this.data.recents.filter((r) => !samePlace(r, p))].slice(0, MAX_RECENTS);
    this.persist();
  }

  clearRecents() {
    this.data.recents = [];
    this.persist();
  }

  setHome(p: Place) {
    this.data.home = clean(p);
    this.persist();
  }

  setWork(p: Place) {
    this.data.work = clean(p);
    this.persist();
  }

  clearHome() {
    delete this.data.home;
    this.persist();
  }

  clearWork() {
    delete this.data.work;
    this.persist();
  }

  isFavourite(p: Place): boolean {
    return this.data.favourites.some((f) => samePlace(f, p));
  }

  toggleFavourite(p: Place): boolean {
    if (this.isFavourite(p)) {
      this.removeFrom(FAV, p);
      return false;
    }
    this.addTo(FAV, p);
    return true;
  }

  /* ---------------------------------------------------------------- groups */

  get groups(): SavedGroup[] {
    return (this.data.groups ??= defaultGroups());
  }

  /** The places in a group (the favourites for FAV). */
  items(id: string): Place[] {
    if (id === FAV) return this.data.favourites;
    return this.groups.find((g) => g.id === id)?.items ?? [];
  }

  /** The groups a place is in. */
  groupsWith(p: Place): string[] {
    const out: string[] = [];
    if (this.isFavourite(p)) out.push(FAV);
    for (const g of this.groups) if (g.items.some((x) => samePlace(x, p))) out.push(g.id);
    return out;
  }

  /** Every saved place in any group, once. */
  allSaved(): Place[] {
    const out: Place[] = [];
    for (const p of [...this.data.favourites, ...this.groups.flatMap((g) => g.items)]) if (!out.some((x) => samePlace(x, p))) out.push(p);
    return out;
  }

  addTo(id: string, p: Place): boolean {
    if (!Number.isFinite(p.lngLat[0])) return false;
    const item = clean(p, true);
    if (id === FAV) {
      const old = this.data.favourites.find((f) => samePlace(f, p));
      this.data.favourites = [{ ...old, ...item }, ...this.data.favourites.filter((f) => !samePlace(f, p))].slice(0, MAX_FAVOURITES);
    } else {
      const g = this.groups.find((x) => x.id === id);
      if (!g) return false;
      const old = g.items.find((f) => samePlace(f, p));
      g.items = [{ ...old, ...item }, ...g.items.filter((f) => !samePlace(f, p))].slice(0, MAX_GROUP_ITEMS);
    }
    this.persist();
    return true;
  }

  removeFrom(id: string, p: Place) {
    if (id === FAV) this.data.favourites = this.data.favourites.filter((f) => !samePlace(f, p));
    else {
      const g = this.groups.find((x) => x.id === id);
      if (g) g.items = g.items.filter((f) => !samePlace(f, p));
    }
    this.persist();
  }

  /** Moves a place from one group to another (keeping its note and link). */
  move(from: string, to: string, p: Place) {
    if (from === to) return;
    const item = this.items(from).find((x) => samePlace(x, p)) ?? p;
    this.addTo(to, item);
    this.removeFrom(from, p);
  }

  /** Your note and link on a saved place, wherever it is saved. */
  updateItem(p: Place, change: { memo?: string; link?: string }) {
    const apply = (x: Place) => {
      if (!samePlace(x, p)) return x;
      const next = { ...x };
      if (change.memo != null) change.memo.trim() ? (next.memo = change.memo.trim().slice(0, 500)) : delete next.memo;
      if (change.link != null) change.link.trim() ? (next.link = change.link.trim().slice(0, 500)) : delete next.link;
      return next;
    };
    this.data.favourites = this.data.favourites.map(apply);
    for (const g of this.groups) g.items = g.items.map(apply);
    this.persist();
  }

  /** A saved copy of a place (with your note and link), if it is saved. */
  savedCopy(p: Place): Place | undefined {
    return this.allSaved().find((x) => samePlace(x, p));
  }

  createGroup(name: string): string | null {
    const n = name.trim().slice(0, 60);
    if (!n || this.groups.length >= MAX_GROUPS) return null;
    const id = `g${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
    const used = new Set(this.groups.map((g) => g.color));
    const color = COLORS.find((c) => !used.has(c)) ?? COLORS[this.groups.length % COLORS.length];
    this.groups.push({ id, name: n, color, items: [], at: Date.now() });
    this.persist();
    return id;
  }

  renameGroup(id: string, name: string) {
    const g = this.groups.find((x) => x.id === id);
    const n = name.trim().slice(0, 60);
    if (!g || !n) return;
    g.name = n;
    this.persist();
  }

  deleteGroup(id: string) {
    this.data.groups = this.groups.filter((g) => g.id !== id);
    this.persist();
  }
}
