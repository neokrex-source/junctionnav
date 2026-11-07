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

/** What the search box says about these results, in the app's languages. */
const TEXT = {
  en: {
    approx: APPROX,
    coords: 'Coordinates',
    plusCode: 'Plus code',
    fromLink: 'From the Google Maps link',
    linkView: 'the map it showed',
    linkViewApprox: 'the map it showed (approximate)',
    near: (what: string) => `near ${what}`,
    approxAs: (cand: string) => `Approximate (${cand})`,
    onStreet: (n: number) => `Approximate · the middle of ${n} place${n === 1 ? '' : 's'} on this street`,
    inPostcode: (n: number) => `Approximate · the middle of ${n} place${n === 1 ? '' : 's'} with this postcode`,
    postcode: (pc: string) => `Postcode ${pc}`,
    shortWeb: ['Short links open in the Android app', 'A web page cannot follow a maps.app.goo.gl link. Open it in Google Maps, then paste the long link from the address bar, or the coordinates.'],
    linkFailed: 'The link could not be opened',
    linkGone: 'The link was not found. It may have expired.',
    tryAgain: 'Check the internet connection and try again.',
    notMaps: ['Not a Google Maps link', 'Paste a link to a place, a pin or directions from Google Maps, or coordinates.'],
    noPlace: ['The link does not say where', 'Open it in Google Maps and share the place or pin again, or paste its coordinates.'],
    nothing: (q: string) => `Nothing found for "${q}"`,
    townMissing: (t: string) => [`"${t}" was not found`, 'Check the town after the plus code, or use the full code (like 6PM35P56+4W).'],
    needTown: ['Add the town to the plus code', 'A short plus code needs the town it is in, like "5P56+4W Kuala Lumpur".'],
  },
  ms: {
    approx: 'Anggaran',
    coords: 'Koordinat',
    plusCode: 'Plus code',
    fromLink: 'Dari pautan Google Maps',
    linkView: 'peta yang ditunjukkan',
    linkViewApprox: 'peta yang ditunjukkan (anggaran)',
    near: (what: string) => `berhampiran ${what}`,
    approxAs: (cand: string) => `Anggaran (${cand})`,
    onStreet: (n: number) => `Anggaran · di tengah ${n} tempat di jalan ini`,
    inPostcode: (n: number) => `Anggaran · di tengah ${n} tempat dengan poskod ini`,
    postcode: (pc: string) => `Poskod ${pc}`,
    shortWeb: ['Pautan pendek dibuka dalam aplikasi Android', 'Laman web tidak dapat mengikut pautan maps.app.goo.gl. Buka dalam Google Maps, kemudian tampal pautan panjang dari bar alamat, atau koordinatnya.'],
    linkFailed: 'Pautan tidak dapat dibuka',
    linkGone: 'Pautan tidak dijumpai. Mungkin sudah tamat tempoh.',
    tryAgain: 'Periksa sambungan internet dan cuba lagi.',
    notMaps: ['Bukan pautan Google Maps', 'Tampal pautan ke tempat, pin atau arah dari Google Maps, atau koordinat.'],
    noPlace: ['Pautan tidak menunjukkan lokasi', 'Buka dalam Google Maps dan kongsi tempat atau pin itu semula, atau tampal koordinatnya.'],
    nothing: (q: string) => `Tiada hasil untuk "${q}"`,
    townMissing: (t: string) => [`"${t}" tidak dijumpai`, 'Semak nama bandar selepas plus code, atau gunakan kod penuh (seperti 6PM35P56+4W).'],
    needTown: ['Tambah nama bandar pada plus code', 'Plus code pendek perlu nama bandarnya, seperti "5P56+4W Kuala Lumpur".'],
  },
  ja: {
    approx: '付近',
    coords: '座標',
    plusCode: 'Plus Code',
    fromLink: 'Google マップのリンクから',
    linkView: 'リンクの地図の中心',
    linkViewApprox: 'リンクの地図の中心（おおよその位置）',
    near: (what: string) => `${what} 付近`,
    approxAs: (cand: string) => `おおよその位置（${cand}）`,
    onStreet: (n: number) => `おおよその位置 · この通りの ${n} か所の中心`,
    inPostcode: (n: number) => `おおよその位置 · この郵便番号の ${n} か所の中心`,
    postcode: (pc: string) => `郵便番号 ${pc}`,
    shortWeb: ['短縮リンクは Android アプリで開けます', 'ウェブページでは maps.app.goo.gl のリンクを開けません。Google マップで開き、アドレスバーの長いリンクか座標を貼り付けてください。'],
    linkFailed: 'リンクを開けませんでした',
    linkGone: 'リンクが見つかりません。期限が切れている可能性があります。',
    tryAgain: 'インターネット接続を確認して、もう一度お試しください。',
    notMaps: ['Google マップのリンクではありません', 'Google マップの場所・ピン・経路のリンク、または座標を貼り付けてください。'],
    noPlace: ['リンクに場所が含まれていません', 'Google マップで開いて場所やピンを共有し直すか、座標を貼り付けてください。'],
    nothing: (q: string) => `「${q}」は見つかりませんでした`,
    townMissing: (t: string) => [`「${t}」が見つかりませんでした`, 'Plus Code の後の地名を確認するか、完全なコード（例: 6PM35P56+4W）を使ってください。'],
    needTown: ['Plus Code に地名を添えてください', '短い Plus Code には地名が必要です（例: 「5P56+4W Kuala Lumpur」）。'],
  },
};
type Texts = (typeof TEXT)['en'];
export const searchTexts = (lang: string): Texts => (TEXT as Record<string, Texts>)[lang] ?? TEXT.en;

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

export function coordPlace(p: LngLat, name: string, sub: string): Place {
  return { name, sub, lngLat: p, kind: 'coords' };
}

const ok = (p: Place) => Number.isFinite(p.lngLat[0]) && Number.isFinite(p.lngLat[1]);

/**
 * A place's name in a link often carries its whole address ("Chinatown Kuala Lumpur, Kuala Lumpur
 * City Centre, ..."): the name, and the rest for the line under it. A house number alone is not a name.
 */
export function splitPlaceName(label: string): [string, string] {
  const parts = label.split(/\s*,\s*/).filter(Boolean);
  const n = parts.length > 1 && /^(?:no\.?\s*|lot\s*|unit\s*)?\d/i.test(parts[0]) ? 2 : 1;
  return [parts.slice(0, n).join(', '), parts.slice(n).join(', ')];
}

export class SmartSearch implements PlaceSearchEngine {
  constructor(
    private base: () => PlaceSearchEngine,
    private o: SmartSearchOptions = {},
  ) {}

  async search(q: string, near: LngLat | null, lang: string, signal?: AbortSignal): Promise<Place[]> {
    const text = q.trim();
    const T = searchTexts(lang);
    const link = findLink(text);
    if (link) return this.fromLink(link, near, lang, T, signal);
    const c = parseCoordinates(text);
    if (c) return [coordPlace(c, coordText(c), `${T.coords} · ${dmsText(c)}`)];
    const pc = parsePlusCode(text);
    if (pc) return this.fromPlusCode(pc.code, pc.locality, near, lang, T, signal);
    if (looksLikeAddress(text)) return this.fromAddress(text, near, lang, T, signal);
    return this.base().search(text, near, lang, signal);
  }

  reverse(p: LngLat, signal?: AbortSignal): Promise<Place | null> {
    return this.base().reverse(p, signal);
  }

  private async fromPlusCode(code: string, locality: string, near: LngLat | null, lang: string, T: Texts, signal?: AbortSignal): Promise<Place[]> {
    const label = locality ? `${code} ${locality}` : code;
    const at = (p: LngLat) => coordPlace(p, label, `${T.plusCode} · ${coordText(p)}`);
    if (isFullPlusCode(code)) return [at(decodePlusCode(code))];
    // A short code is completed from the town after it (or from where you are).
    let ref: LngLat | null = near;
    if (locality) {
      const found = (await this.base().search(locality, near, lang, signal).catch(() => [] as Place[])).filter(ok);
      ref = found[0]?.lngLat ?? null;
      if (!ref) {
        const [title, sub] = T.townMissing(locality);
        return [note(title, sub)];
      }
    }
    if (!ref) return [note(T.needTown[0], T.needTown[1])];
    return [at(recoverPlusCode(code, ref))];
  }

  private async fromLink(url: string, near: LngLat | null, lang: string, T: Texts, signal?: AbortSignal): Promise<Place[]> {
    let target = url;
    if (isShortMapsLink(url)) {
      if (!this.o.resolveLink) return [note(T.shortWeb[0], T.shortWeb[1])];
      try {
        target = await this.o.resolveLink(url);
      } catch (e) {
        return [note(T.linkFailed, (e as Error).name === 'LinkGone' ? T.linkGone : T.tryAgain)];
      }
    }
    const m = parseMapsLink(target);
    if (!m) return [isMapsLink(target) ? note(T.noPlace[0], T.noPlace[1]) : note(T.notMaps[0], T.notMaps[1])];
    if (m.point) {
      const [name, rest] = splitPlaceName(m.name ?? m.query ?? coordText(m.point));
      return [coordPlace(m.point, name, `${T.fromLink} · ${rest || coordText(m.point)}`)];
    }
    const pc = m.name ? parsePlusCode(m.name) : null;
    if (pc) return this.fromPlusCode(pc.code, pc.locality, m.view ?? near, lang, T, signal);
    const text = m.name ?? m.query;
    if (text) {
      // A name and the map it was shown on: the place of that name on that map.
      const found = (await this.base().search(text, m.view ?? near, lang, signal).catch(() => [] as Place[])).filter(ok);
      const close = m.view ? found.filter((f) => haversine(f.lngLat, m.view!) < 8000) : found;
      if (close.length) return close;
      if (m.view) return [{ ...coordPlace(m.view, text, `${T.fromLink} · ${T.linkViewApprox}`), tag: T.approx }];
      return found.length ? found : [note(T.nothing(text), T.fromLink)];
    }
    return [coordPlace(m.view!, coordText(m.view!), `${T.fromLink} · ${T.linkView}`)];
  }

  /**
   * An address: tidied and searched; if nothing is found, broader versions of it (the street, the
   * area, the postcode and town); and the places around you know roughly where its street and
   * postcode are. Rough answers are marked Approx.
   */
  private async fromAddress(text: string, near: LngLat | null, lang: string, T: Texts, signal?: AbortSignal): Promise<Place[]> {
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
          extra.push(...r.slice(0, 3).map((p) => ({ ...p, tag: T.approx, sub: `${T.approxAs(cand)}${p.sub ? ` · ${p.sub}` : ''}` })));
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
        extra.push({
          name: a.by === 'street' ? `${street}${town ? `, ${town}` : ''}` : `${T.postcode(postcode!)}${town ? ` ${town}` : ''}`,
          sub: a.by === 'street' ? T.onStreet(a.n) : T.inPostcode(a.n),
          lngLat: [a.lon, a.lat],
          tag: T.approx,
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
