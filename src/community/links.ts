/**
 * Links to registered places. A public place on the shared service is linked by its id, so the
 * link shows it as it is now; any other place carries its details in the link itself
 * (?place=lat,lng&name=…), so a private place can be passed to a friend without publishing it.
 */
import { isGroup, NAME_MAX, NOTE_MAX, type SharedPlace } from './types';

export type PlaceLink = { kind: 'id'; id: string } | { kind: 'inline'; place: SharedPlace };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function placeLink(base: string, p: SharedPlace, byId: boolean): string {
  const u = new URL(base);
  u.search = '';
  u.hash = '';
  if (byId && p.visibility === 'public' && UUID.test(p.id)) {
    u.searchParams.set('sp', p.id);
    return u.href;
  }
  u.searchParams.set('place', `${p.lngLat[1].toFixed(6)},${p.lngLat[0].toFixed(6)}`);
  u.searchParams.set('name', p.name);
  u.searchParams.set('kind', p.category);
  if (p.heading != null) u.searchParams.set('hd', String(Math.round(p.heading)));
  if (p.note) u.searchParams.set('note', p.note.slice(0, 300));
  if (p.phone) u.searchParams.set('tel', p.phone);
  if (p.website) u.searchParams.set('web', p.website);
  return u.href;
}

export function parsePlaceLink(search: string): PlaceLink | null {
  const q = new URLSearchParams(search);
  const id = q.get('sp');
  if (id) return UUID.test(id) ? { kind: 'id', id: id.toLowerCase() } : null;
  const at = q.get('place');
  const name = (q.get('name') ?? '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  if (!at || !name) return null;
  const m = /^\s*(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)\s*$/.exec(at);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  const hd = q.get('hd');
  const heading = hd != null && hd !== '' && Number.isFinite(Number(hd)) ? ((Math.round(Number(hd)) % 360) + 360) % 360 : null;
  const kind = q.get('kind');
  let website = (q.get('web') ?? '').trim().slice(0, 200);
  if (website && !/^https?:\/\//i.test(website)) website = '';
  return {
    kind: 'inline',
    place: {
      id: `link-${lat.toFixed(6)},${lng.toFixed(6)}`,
      name,
      category: isGroup(kind) ? kind : 'other',
      note: (q.get('note') ?? '').trim().slice(0, NOTE_MAX),
      phone: (q.get('tel') ?? '').replace(/\s+/g, ' ').trim().slice(0, 30),
      website,
      lngLat: [lng, lat],
      heading,
      visibility: 'private',
      ownerName: '',
      owner: '',
      updated: 0,
    },
  };
}

/** The link's own parameters, removed from the address once the place is open. */
export const PLACE_LINK_PARAMS = ['sp', 'place', 'name', 'kind', 'hd', 'note', 'tel', 'web'];
