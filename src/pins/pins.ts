/**
 * Your pins on the map: dropped with the pin button or a long-press, dragged to move, each with
 * an optional direction of travel (the heading), so a route to it arrives on the right side of
 * a divided road. Kept in this browser with the signed-in account, like saved places.
 */
import type { LngLat } from '../geo/geo';
import type { Place } from '../search/places';
import { normHeading } from './heading';

export interface Pin {
  id: string;
  lngLat: LngLat;
  /** What is there (from the address search), or "Dropped pin" until it is known. */
  name: string;
  sub: string;
  /** Direction of travel there, degrees from north; null for any direction. */
  heading: number | null;
  /** When it was dropped (ms), newest first in lists. */
  at: number;
}

const KEY = 'junctionnav.pins.v1';
export const MAX_PINS = 100;

const round6 = (v: number) => Math.round(v * 1e6) / 1e6;

function valid(p: unknown): p is Pin {
  const x = p as Pin;
  return !!x && typeof x.id === 'string' && Array.isArray(x.lngLat) && Number.isFinite(x.lngLat[0]) && Number.isFinite(x.lngLat[1]) && typeof x.name === 'string';
}

/** A pin as a place for search, directions and the place card. */
export function pinPlace(p: Pin): Place {
  return { name: p.name, sub: p.sub, lngLat: p.lngLat, kind: 'pin', pinId: p.id, ...(p.heading != null ? { bearing: p.heading } : {}) };
}

export class PinStore {
  pins: Pin[] = [];
  private key = KEY;
  /** Called after every change (the map and lists redraw). */
  onChange: (() => void) | null = null;

  constructor() {
    this.load();
  }

  private load() {
    this.pins = [];
    try {
      const raw = localStorage.getItem(this.key);
      const list = raw ? (JSON.parse(raw) as unknown[]) : [];
      this.pins = Array.isArray(list) ? list.filter(valid).map((p) => ({ ...p, heading: p.heading == null ? null : normHeading(p.heading), sub: p.sub ?? '' })) : [];
    } catch {
      /* storage unavailable or damaged: start again */
    }
  }

  private persist() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.pins));
    } catch {
      /* storage unavailable */
    }
    this.onChange?.();
  }

  /** Pins belong to the signed-in account, like saved places. */
  useScope(userId: string | null) {
    this.key = userId ? `${KEY}.${userId}` : KEY;
    this.load();
    this.onChange?.();
  }

  get(id: string): Pin | undefined {
    return this.pins.find((p) => p.id === id);
  }

  /** Newest first. */
  list(): Pin[] {
    return [...this.pins].sort((a, b) => b.at - a.at);
  }

  add(lngLat: LngLat, name: string, sub = '', heading: number | null = null): Pin {
    const pin: Pin = {
      id: `p${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
      lngLat: [round6(lngLat[0]), round6(lngLat[1])],
      name,
      sub,
      heading: heading == null ? null : normHeading(heading),
      at: Date.now(),
    };
    // The oldest go when there are too many.
    this.pins = [pin, ...this.list()].slice(0, MAX_PINS);
    this.persist();
    return pin;
  }

  update(id: string, patch: Partial<Omit<Pin, 'id' | 'at'>>): Pin | undefined {
    const pin = this.get(id);
    if (!pin) return undefined;
    if (patch.lngLat) pin.lngLat = [round6(patch.lngLat[0]), round6(patch.lngLat[1])];
    if (patch.name != null) pin.name = patch.name;
    if (patch.sub != null) pin.sub = patch.sub;
    if (patch.heading !== undefined) pin.heading = patch.heading == null ? null : normHeading(patch.heading);
    this.persist();
    return pin;
  }

  remove(id: string) {
    this.pins = this.pins.filter((p) => p.id !== id);
    this.persist();
  }

  clear() {
    this.pins = [];
    this.persist();
  }
}
