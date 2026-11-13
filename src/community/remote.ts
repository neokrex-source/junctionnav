/**
 * The shared places service: the `shared_places` table of the site's Supabase project over its
 * REST API (supabase/shared-places.sql sets it up). Reading public places needs no account;
 * adding, changing, deleting and reporting need the signed-in person's token, and the database
 * itself checks that a place is theirs.
 */
import type { LngLat } from '../geo/geo';
import { isGroup, type SharedPlace, type Visibility } from './types';

/** A row of shared_places as the REST API returns it. */
export interface PlaceRow {
  id: string;
  owner: string;
  owner_name: string;
  name: string;
  category: string;
  note: string;
  phone: string;
  website: string;
  lon: number;
  lat: number;
  heading: number | null;
  visibility: Visibility;
  hidden?: boolean;
  updated_at: string;
}

export function fromRow(r: PlaceRow): SharedPlace {
  return {
    id: r.id,
    name: r.name,
    category: isGroup(r.category) ? r.category : 'other',
    note: r.note ?? '',
    phone: r.phone ?? '',
    website: r.website ?? '',
    lngLat: [r.lon, r.lat],
    heading: r.heading == null ? null : r.heading,
    visibility: r.visibility === 'public' ? 'public' : 'private',
    ownerName: r.owner_name ?? '',
    owner: r.owner,
    updated: Date.parse(r.updated_at) || 0,
    ...(r.hidden ? { hidden: true } : {}),
  };
}

/** The columns the app writes (the database fills in the owner and the times). */
export function toRow(p: SharedPlace): Omit<PlaceRow, 'owner' | 'updated_at' | 'hidden'> {
  return {
    id: p.id,
    owner_name: p.visibility === 'public' ? p.ownerName.slice(0, 60) : '',
    name: p.name,
    category: p.category,
    note: p.note,
    phone: p.phone,
    website: p.website,
    lon: Math.round(p.lngLat[0] * 1e7) / 1e7,
    lat: Math.round(p.lngLat[1] * 1e7) / 1e7,
    heading: p.heading == null ? null : Math.round(((p.heading % 360) + 360) % 360) % 360,
    visibility: p.visibility,
  };
}

export class SharedPlacesError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'SharedPlacesError';
  }
}

export interface SharedPlacesApi {
  /** Public places (and your own) in a box: west, south, east, north. */
  inBox(box: [number, number, number, number], limit?: number): Promise<SharedPlace[]>;
  /** Public places (and your own) whose name has the text, near a point first. */
  search(text: string, near: LngLat | null, limit?: number): Promise<SharedPlace[]>;
  /** One place by id (a shared link). */
  get(id: string): Promise<SharedPlace | null>;
  /** All of your own places. */
  mine(owner: string): Promise<SharedPlace[]>;
  create(p: SharedPlace): Promise<SharedPlace>;
  update(p: SharedPlace): Promise<SharedPlace | null>;
  remove(id: string): Promise<void>;
  report(id: string, reason: string): Promise<void>;
}

const COLUMNS = 'id,owner,owner_name,name,category,note,phone,website,lon,lat,heading,visibility,hidden,updated_at';

export class SupabasePlaces implements SharedPlacesApi {
  private base: string;

  constructor(
    url: string,
    private anonKey: string,
    /** The signed-in person's token, or null for a guest. */
    private token: () => Promise<string | null>,
    private f: typeof fetch = (...a) => fetch(...a),
  ) {
    this.base = `${url.replace(/\/$/, '')}/rest/v1`;
  }

  private async call<T>(path: string, init: { method?: string; body?: unknown; prefer?: string; auth?: boolean } = {}): Promise<T> {
    const token = await this.token();
    if (init.auth && !token) throw new SharedPlacesError('Sign in to change shared places.', 401);
    let res: Response;
    try {
      res = await this.f(`${this.base}/${path}`, {
        method: init.method ?? 'GET',
        headers: {
          apikey: this.anonKey,
          Authorization: `Bearer ${token ?? this.anonKey}`,
          ...(init.body ? { 'Content-Type': 'application/json' } : {}),
          ...(init.prefer ? { Prefer: init.prefer } : {}),
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      throw new SharedPlacesError('Cannot reach the shared places service.', 0);
    }
    const text = await res.text();
    if (!res.ok) {
      let msg = text;
      try {
        const j = JSON.parse(text) as { message?: string; hint?: string };
        msg = j.message ?? text;
      } catch {
        /* not JSON */
      }
      throw new SharedPlacesError(res.status === 404 ? 'The shared places table is not set up on this site (supabase/shared-places.sql).' : msg || `Shared places error ${res.status}`, res.status);
    }
    return (text ? JSON.parse(text) : null) as T;
  }

  async inBox([w, s, e, n]: [number, number, number, number], limit = 300): Promise<SharedPlace[]> {
    const q = new URLSearchParams({ select: COLUMNS, order: 'updated_at.desc', limit: String(limit) });
    q.append('lon', `gte.${w.toFixed(5)}`);
    q.append('lon', `lte.${e.toFixed(5)}`);
    q.append('lat', `gte.${s.toFixed(5)}`);
    q.append('lat', `lte.${n.toFixed(5)}`);
    return (await this.call<PlaceRow[]>(`shared_places?${q}`)).map(fromRow);
  }

  async search(text: string, near: LngLat | null, limit = 20): Promise<SharedPlace[]> {
    // Words in any order: every word somewhere in the name.
    const words = text
      .toLowerCase()
      .replace(/[%*,()."\\]/g, ' ')
      .split(/\s+/)
      .filter((w) => w.length > 0)
      .slice(0, 4);
    if (!words.length) return [];
    const q = new URLSearchParams({ select: COLUMNS, limit: String(limit * 3) });
    for (const w of words) q.append('name', `ilike.*${w}*`);
    if (near) {
      // About 150 km around: places nearby are the ones wanted.
      const d = 1.4;
      q.append('lon', `gte.${(near[0] - d).toFixed(4)}`);
      q.append('lon', `lte.${(near[0] + d).toFixed(4)}`);
      q.append('lat', `gte.${(near[1] - d).toFixed(4)}`);
      q.append('lat', `lte.${(near[1] + d).toFixed(4)}`);
    }
    const rows = (await this.call<PlaceRow[]>(`shared_places?${q}`)).map(fromRow);
    if (near) rows.sort((a, b) => dist2(a.lngLat, near) - dist2(b.lngLat, near));
    return rows.slice(0, limit);
  }

  async get(id: string): Promise<SharedPlace | null> {
    if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
    const rows = await this.call<PlaceRow[]>(`shared_places?select=${COLUMNS}&id=eq.${id}`);
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async mine(owner: string): Promise<SharedPlace[]> {
    return (await this.call<PlaceRow[]>(`shared_places?select=${COLUMNS}&owner=eq.${owner}&order=updated_at.desc&limit=1000`, { auth: true })).map(fromRow);
  }

  async create(p: SharedPlace): Promise<SharedPlace> {
    const rows = await this.call<PlaceRow[]>('shared_places', { method: 'POST', body: toRow(p), prefer: 'return=representation', auth: true });
    return fromRow(rows[0]);
  }

  async update(p: SharedPlace): Promise<SharedPlace | null> {
    const { id, ...fields } = toRow(p);
    const rows = await this.call<PlaceRow[]>(`shared_places?id=eq.${id}`, { method: 'PATCH', body: fields, prefer: 'return=representation', auth: true });
    return rows[0] ? fromRow(rows[0]) : null;
  }

  async remove(id: string): Promise<void> {
    await this.call(`shared_places?id=eq.${id}`, { method: 'DELETE', auth: true });
  }

  async report(id: string, reason: string): Promise<void> {
    try {
      await this.call('shared_place_reports', { method: 'POST', body: { place_id: id, reason: reason.slice(0, 200) }, prefer: 'return=minimal', auth: true });
    } catch (e) {
      // Reported before: that is fine.
      if (e instanceof SharedPlacesError && e.status === 409) return;
      throw e;
    }
  }
}

function dist2(a: LngLat, b: LngLat): number {
  const k = Math.cos((b[1] * Math.PI) / 180);
  return ((a[0] - b[0]) * k) ** 2 + (a[1] - b[1]) ** 2;
}
