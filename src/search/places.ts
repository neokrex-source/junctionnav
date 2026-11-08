/** Place search with Photon (OSM-based, allows search-as-you-type) plus coordinate input. */
import type { LngLat } from '../geo/geo';
import type { PlaceInfo } from '../places/format';
import { parseCoordinates } from './coords';
import { escapeHtml, h } from '../ui/dom';

export interface Place {
  name: string;
  sub: string;
  lngLat: LngLat;
  /** Category id for category results. */
  kind?: string;
  /** Badge such as "Home", "Work", "Recent". */
  tag?: string;
  /** Short right-aligned note, e.g. distance. */
  note?: string;
  /** Direction of travel through this place (trip links), to pick the right carriageway. */
  bearing?: number;
  /** Details from the places around you (kind, address, phone, website, hours). */
  info?: PlaceInfo;
  /** The place in the places around you, for its details when they are not here yet. */
  placeId?: string;
  /** One of your pins on the map (src/pins/pins.ts). */
  pinId?: string;
}

interface PhotonFeature {
  geometry: { coordinates: [number, number] };
  properties: Record<string, string | undefined>;
}

function label(p: Record<string, string | undefined>): { name: string; sub: string } {
  const name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ') || p.city || p.state || 'Unnamed place';
  const sub = [p.street && p.name ? p.street : '', p.district, p.city !== name ? p.city : '', p.state, p.country]
    .filter(Boolean)
    .filter((v, i, a) => a.indexOf(v) === i)
    .join(', ');
  return { name, sub };
}

/** Coordinates in any of the usual forms (src/search/coords.ts). */
export { parseCoordinates };

/** Anything that can look places up by text and name a point on the map. */
export interface PlaceSearchEngine {
  search(q: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]>;
  reverse(p: LngLat, signal?: AbortSignal): Promise<Place | null>;
}

export class PhotonSearch implements PlaceSearchEngine {
  constructor(private base: () => string) {}

  async search(q: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    const coord = parseCoordinates(q);
    if (coord) return [{ name: `${coord[1].toFixed(5)}, ${coord[0].toFixed(5)}`, sub: 'Coordinates', lngLat: coord }];
    const params = new URLSearchParams({ q, limit: '7' });
    if (near) {
      params.set('lat', near[1].toFixed(4));
      params.set('lon', near[0].toFixed(4));
    }
    if (['en', 'de', 'fr', 'it'].includes(lang)) params.set('lang', lang);
    const res = await fetch(`${this.base().replace(/\/$/, '')}/api/?${params}`, { signal });
    if (!res.ok) throw new Error(`Search failed (${res.status})`);
    const json = (await res.json()) as { features: PhotonFeature[] };
    return json.features.map((f) => ({ ...label(f.properties), lngLat: f.geometry.coordinates }));
  }

  async reverse(p: LngLat, signal?: AbortSignal): Promise<Place | null> {
    try {
      const res = await fetch(`${this.base().replace(/\/$/, '')}/reverse?lon=${p[0]}&lat=${p[1]}`, { signal });
      if (!res.ok) return null;
      const json = (await res.json()) as { features: PhotonFeature[] };
      const f = json.features[0];
      return f ? { ...label(f.properties), lngLat: p } : null;
    } catch {
      return null;
    }
  }
}

/** Wire an input to a suggestion list. */
export function attachSearch(
  input: HTMLInputElement,
  list: HTMLElement,
  opts: {
    engine: PlaceSearchEngine;
    near: () => LngLat | null;
    lang: () => string;
    onPick: (p: Place) => void;
    extra?: () => Place[];
    onInput?: (v: string) => void;
    /** Adds a note (e.g. distance) to each result. */
    decorate?: (p: Place) => Place;
  },
) {
  let timer = 0;
  let ctrl: AbortController | null = null;
  const render = (places: Place[]) => {
    list.innerHTML = '';
    list.hidden = places.length === 0;
    for (const p of places) {
      // A note (a link that cannot be read here, a hint) explains rather than goes somewhere.
      if (!Number.isFinite(p.lngLat[0])) {
        list.append(h('li', { class: 's-note-row', role: 'note' }, h('span', { class: 's-name' }, p.name), h('span', { class: 's-sub' }, p.sub)));
        continue;
      }
      const b = h('button', {
        type: 'button',
        html:
          `<span class="s-name">${p.tag ? `<em class="s-tag">${escapeHtml(p.tag)}</em>` : ''}${escapeHtml(p.name)}</span>` +
          `<span class="s-sub">${escapeHtml(p.sub)}</span>` +
          (p.note ? `<span class="s-note">${escapeHtml(p.note)}</span>` : ''),
      });
      b.addEventListener('click', () => {
        list.hidden = true;
        input.value = p.name;
        opts.onPick(p);
      });
      list.append(h('li', {}, b));
    }
  };
  input.addEventListener('input', () => {
    opts.onInput?.(input.value);
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 2) {
      render(opts.extra?.() ?? []);
      return;
    }
    timer = window.setTimeout(async () => {
      ctrl?.abort();
      ctrl = new AbortController();
      try {
        const found = await opts.engine.search(q, opts.near(), opts.lang(), ctrl.signal);
        render(opts.decorate ? found.map(opts.decorate) : found);
      } catch (e) {
        if ((e as Error).name !== 'AbortError') render([{ name: 'Search is unavailable', sub: (e as Error).message, lngLat: [NaN, NaN] }]);
      }
    }, 280);
  });
  input.addEventListener('focus', () => {
    if (!input.value.trim()) render(opts.extra?.() ?? []);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = list.querySelector('button');
      if (first) (first as HTMLButtonElement).click();
    } else if (e.key === 'Escape') {
      list.hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    if (!list.contains(e.target as Node) && e.target !== input) list.hidden = true;
  });
}
