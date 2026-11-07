/**
 * The search box understands more than names: coordinates in the usual forms, plus codes, Google
 * Maps links (short share links too, in the Android app) and rough addresses, which fall back to
 * the street, area or postcode when the exact address is not known. Everything else goes to the
 * place search (TomTom or Photon, the places around you, the offline maps).
 */
import { haversine, type LngLat } from '../geo/geo';
import type { AreaHit } from '../places/placesIndex';
import { addressFallbacks, cleanAddress, looksLikeAddress, postcodeOf, streetOf, townOf } from './address';
import { coordText, dmsText, parseCoordinates } from './coords';
import { findLink, isMapsLink, isShortMapsLink, parseMapsLink } from './googleLinks';
import type { Place, PlaceSearchEngine } from './places';
import { decodePlusCode, isFullPlusCode, parsePlusCode, recoverPlusCode } from './pluscode';

export const APPROX = 'Approx.';

export interface SmartSearchOptions {
  /** Where a short share link leads (the Android app can find out; a web page cannot). */
  resolveLink?: ((url: string) => Promise<string>) | null;
  /** Roughly where a street or postcode is, from the places around you. */
  area?: (street: string | null, postcode: string | null, town: string | null) => Promise<AreaHit[]>;
}

/** A line in the results that explains rather than goes somewhere. */
export function note(name: string, sub: string): Place {
  return { name, sub, lngLat: [NaN, NaN], kind: 'note' };
}

export function coordPlace(p: LngLat, name?: string, sub?: string): Place {
  return { name: name ?? coordText(p), sub: sub ?? `Coordinates · ${dmsText(p)}`, lngLat: p, kind: 'coords' };
}

const ok = (p: Place) => Number.isFinite(p.lngLat[0]) && Number.isFinite(p.lngLat[1]);

export class SmartSearch implements PlaceSearchEngine {
  constructor(
    private base: () => PlaceSearchEngine,
    private o: SmartSearchOptions = {},
  ) {}

  async search(q: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    const text = q.trim();
    const link = findLink(text);
    if (link) return this.fromLink(link, near, lang, signal);
    const c = parseCoordinates(text);
    if (c) return [coordPlace(c)];
    const pc = parsePlusCode(text);
    if (pc) return this.fromPlusCode(pc.code, pc.locality, near, lang, signal);
    if (looksLikeAddress(text)) return this.fromAddress(text, near, lang, signal);
    return this.base().search(text, near, lang, signal);
  }

  reverse(p: LngLat, signal?: AbortSignal): Promise<Place | null> {
    return this.base().reverse(p, signal);
  }

  private async fromPlusCode(code: string, locality: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    const label = locality ? `${code} ${locality}` : code;
    if (isFullPlusCode(code)) {
      const p = decodePlusCode(code);
      return [coordPlace(p, label, `Plus code · ${coordText(p)}`)];
    }
    // A short code is completed from the town after it (or from where you are).
    let ref: LngLat | null = near;
    if (locality) {
      const found = (await this.base().search(locality, near, lang, signal).catch(() => [] as Place[])).filter(ok);
      ref = found[0]?.lngLat ?? null;
      if (!ref) return [note(`"${locality}" was not found`, 'Check the town after the plus code, or use the full code (like 6PM35P56+4W).')];
    }
    if (!ref) return [note('Add the town to the plus code', 'A short plus code needs the town it is in, like "5P56+4W Kuala Lumpur".')];
    const p = recoverPlusCode(code, ref);
    return [coordPlace(p, label, `Plus code · ${coordText(p)}`)];
  }

  private async fromLink(url: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    let target = url;
    if (isShortMapsLink(url)) {
      if (!this.o.resolveLink)
        return [note('Short links open in the Android app', 'A web page cannot follow a maps.app.goo.gl link. Open it in Google Maps, then paste the long link from the address bar, or the coordinates.')];
      try {
        target = await this.o.resolveLink(url);
      } catch (e) {
        return [note('The link could not be opened', (e as Error).message || 'Check the internet connection and try again.')];
      }
    }
    const m = parseMapsLink(target);
    if (!m)
      return [
        isMapsLink(target)
          ? note('The link does not say where', 'Open it in Google Maps and share the place or pin again, or paste its coordinates.')
          : note('Not a Google Maps link', 'Paste a link to a place, a pin or directions from Google Maps, or coordinates.'),
      ];
    const from = 'From the Google Maps link';
    if (m.point) return [coordPlace(m.point, m.name ?? m.query ?? coordText(m.point), `${from} · ${coordText(m.point)}`)];
    const pc = m.name ? parsePlusCode(m.name) : null;
    if (pc) return this.fromPlusCode(pc.code, pc.locality, m.view ?? near, lang, signal);
    const text = m.name ?? m.query;
    if (text) {
      // A name and the map it was shown on: the place of that name on that map.
      const found = (await this.base().search(text, m.view ?? near, lang, signal).catch(() => [] as Place[])).filter(ok);
      const close = m.view ? found.filter((f) => haversine(f.lngLat, m.view!) < 8000) : found;
      if (close.length) return close;
      if (m.view) return [{ ...coordPlace(m.view, text, `${from} · the map it showed (approximate)`), tag: APPROX }];
      return found.length ? found : [note(`Nothing found for "${text}"`, from)];
    }
    return [coordPlace(m.view!, coordText(m.view!), `${from} · the map it showed`)];
  }

  /**
   * An address: tidied and searched; if nothing is found, broader versions of it (the street, the
   * area, the postcode and town); and the places around you know roughly where its street and
   * postcode are. Rough answers are marked Approx.
   */
  private async fromAddress(text: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    const clean = cleanAddress(text);
    const base = this.base();
    let found: Place[] = [];
    let err: unknown = null;
    try {
      found = (await base.search(clean, near, lang, signal)).filter(ok);
    } catch (e) {
      if ((e as Error).name === 'AbortError') throw e;
      err = e;
    }
    const extra: Place[] = [];
    if (!found.length) {
      for (const cand of addressFallbacks(text).slice(0, 3)) {
        if (signal?.aborted) break;
        const r = (await base.search(cand, near, lang, signal).catch(() => [] as Place[])).filter(ok);
        if (r.length) {
          extra.push(...r.slice(0, 3).map((p) => ({ ...p, tag: APPROX, sub: `Approximate (${cand})${p.sub ? ` · ${p.sub}` : ''}` })));
          break;
        }
      }
    }
    const postcode = postcodeOf(clean);
    const street = streetOf(clean);
    if (this.o.area && (street || postcode)) {
      const town = townOf(clean);
      const areas = await this.o.area(street, postcode, town).catch(() => [] as AreaHit[]);
      for (const a of areas) {
        const what = a.by === 'street' ? 'on this street' : 'with this postcode';
        extra.push({
          name: a.by === 'street' ? `${street}${town ? `, ${town}` : ''}` : `Postcode ${postcode}${town ? ` ${town}` : ''}`,
          sub: `Approximate · the middle of ${a.n} place${a.n === 1 ? '' : 's'} ${what}`,
          lngLat: [a.lon, a.lat],
          tag: APPROX,
        });
      }
    }
    // A rough point next to one already found adds nothing.
    const out = [...found];
    for (const x of extra) if (!out.some((f) => haversine(f.lngLat, x.lngLat) < 250)) out.push(x);
    if (!out.length && err) throw err;
    return out.slice(0, 10);
  }
}
