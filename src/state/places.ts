/** Saved places: Home, Work, favourites and recent destinations (kept in this browser). */
import type { Place } from '../search/places';

export interface SavedPlaces {
  home?: Place;
  work?: Place;
  favourites: Place[];
  recents: Place[];
}

const KEY = 'junctionnav.places.v1';
const MAX_RECENTS = 10;

function clean(p: Place): Place {
  return { name: p.name, sub: p.sub, lngLat: [Math.round(p.lngLat[0] * 1e6) / 1e6, Math.round(p.lngLat[1] * 1e6) / 1e6] };
}

export function samePlace(a: Place, b: Place): boolean {
  return Math.abs(a.lngLat[0] - b.lngLat[0]) < 2e-5 && Math.abs(a.lngLat[1] - b.lngLat[1]) < 2e-5;
}

export class PlaceStore {
  data: SavedPlaces = { favourites: [], recents: [] };

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) this.data = { favourites: [], recents: [], ...(JSON.parse(raw) as Partial<SavedPlaces>) };
    } catch {
      /* storage unavailable */
    }
  }

  private persist() {
    try {
      localStorage.setItem(KEY, JSON.stringify(this.data));
    } catch {
      /* storage unavailable */
    }
  }

  addRecent(p: Place) {
    if (!Number.isFinite(p.lngLat[0])) return;
    this.data.recents = [clean(p), ...this.data.recents.filter((r) => !samePlace(r, p))].slice(0, MAX_RECENTS);
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

  isFavourite(p: Place): boolean {
    return this.data.favourites.some((f) => samePlace(f, p));
  }

  toggleFavourite(p: Place): boolean {
    if (this.isFavourite(p)) {
      this.data.favourites = this.data.favourites.filter((f) => !samePlace(f, p));
      this.persist();
      return false;
    }
    this.data.favourites = [clean(p), ...this.data.favourites].slice(0, 30);
    this.persist();
    return true;
  }
}
