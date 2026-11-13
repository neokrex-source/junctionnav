/**
 * Google Maps places, in the one form Google allows next to another company's map: the Places
 * UI Kit, Google's own search list and place card, shown as Google draws them with Google's
 * attribution. Nothing they show is copied into the app or saved: the place's location (which
 * the terms let an app keep for up to 30 days) only plans the route, named by the app's own
 * address search. It needs a Google Cloud key with the Maps JavaScript API and the Places UI
 * Kit turned on (Settings, or VITE_GOOGLE_MAPS_KEY for everyone using the site); the first
 * 10,000 searches a month are free.
 */
import type { LngLat } from '../geo/geo';
import { h } from '../ui/dom';

export interface GoogleWords {
  title: string;
  searchFor: (q: string) => string;
  directions: string;
  open: string;
  back: string;
  close: string;
  loading: string;
  failed: string;
  badKey: string;
  noResults: string;
  note: string;
}

const EN: GoogleWords = {
  title: 'Google Maps',
  searchFor: (q) => `Search Google Maps for “${q}”`,
  directions: 'Directions',
  open: 'Open in Google Maps',
  back: 'Back to the list',
  close: 'Close',
  loading: 'Asking Google Maps…',
  failed: 'Google Maps could not be reached.',
  badKey: 'Google refused the key. Check that the Maps JavaScript API and the Places UI Kit are turned on for it, and that it allows this site.',
  noResults: 'Google Maps found nothing for that.',
  note: 'Results and details from Google Maps, shown as Google provides them. The route is planned by JunctionNav.',
};

const WORDS: Record<string, GoogleWords> = {
  en: EN,
  ms: {
    title: 'Google Maps',
    searchFor: (q) => `Cari “${q}” di Google Maps`,
    directions: 'Arah',
    open: 'Buka di Google Maps',
    back: 'Kembali ke senarai',
    close: 'Tutup',
    loading: 'Bertanya kepada Google Maps…',
    failed: 'Google Maps tidak dapat dihubungi.',
    badKey: 'Google menolak kunci ini. Pastikan Maps JavaScript API dan Places UI Kit dihidupkan untuknya, dan ia membenarkan laman ini.',
    noResults: 'Google Maps tidak menemui apa-apa.',
    note: 'Hasil dan butiran daripada Google Maps, dipaparkan seperti yang diberikan oleh Google. Laluan dirancang oleh JunctionNav.',
  },
  ja: {
    title: 'Google マップ',
    searchFor: (q) => `Google マップで「${q}」を検索`,
    directions: 'ルート',
    open: 'Google マップで開く',
    back: '一覧に戻る',
    close: '閉じる',
    loading: 'Google マップに問い合わせ中…',
    failed: 'Google マップに接続できません。',
    badKey: 'Google がキーを拒否しました。Maps JavaScript API と Places UI Kit が有効で、このサイトが許可されているか確認してください。',
    noResults: 'Google マップで見つかりませんでした。',
    note: '検索結果と詳細は Google マップが提供するとおりに表示しています。ルートは JunctionNav が計算します。',
  },
};

export function googleWords(lang: string): GoogleWords {
  return WORDS[lang] ?? EN;
}

/**
 * A Google Maps link (free, no key) that opens the spot, so a place can be compared with what
 * Google has there; with Google's own id (from the Places UI Kit), that place's page.
 */
export function googleMapsUrl(at: LngLat, placeId?: string): string {
  const u = new URL('https://www.google.com/maps/search/');
  u.searchParams.set('api', '1');
  u.searchParams.set('query', `${at[1].toFixed(6)},${at[0].toFixed(6)}`);
  if (placeId) u.searchParams.set('query_place_id', placeId);
  return u.href;
}

interface GPlace {
  id?: string;
  location?: { lat(): number; lng(): number } | null;
}

type GoogleNs = { maps?: { importLibrary?: (name: string) => Promise<unknown> } };

let loading: Promise<void> | null = null;
let loadedKey = '';
let keyRefused = false;

function googleNs(): GoogleNs | undefined {
  return (window as unknown as { google?: GoogleNs }).google;
}

/** Loads Google's script once (with the key it was first loaded with) and its places library. */
export function loadPlacesKit(key: string, lang: string): Promise<void> {
  if (loading && loadedKey === key) return loading;
  if (loading && loadedKey !== key) return Promise.reject(new Error('Reload the app to use the new Google key.'));
  loadedKey = key;
  const w = window as unknown as Record<string, unknown>;
  // Google calls this when the key is refused.
  w.gm_authFailure = () => {
    keyRefused = true;
    document.dispatchEvent(new CustomEvent('junctionnav:google-key-refused'));
  };
  loading = new Promise<void>((resolve, reject) => {
    const cb = '__junctionnavGoogleReady';
    w[cb] = () => resolve();
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&v=weekly&loading=async&libraries=places&language=${encodeURIComponent(lang)}&callback=${cb}`;
    s.async = true;
    s.onerror = () => reject(new Error('Google Maps could not be loaded.'));
    document.head.append(s);
  })
    .then(async () => {
      await googleNs()?.maps?.importLibrary?.('places');
    })
    .catch((e) => {
      loading = null;
      throw e;
    });
  return loading;
}

export interface GooglePanelOptions {
  key: string;
  lang: string;
  query: string;
  near: LngLat | null;
  /** Plan the route to a spot. */
  onDirections: (at: LngLat) => void;
}

/** Google's search list for the text, and Google's card for the one picked, in a dialog. */
export function openGooglePanel(o: GooglePanelOptions): void {
  const w = googleWords(o.lang);
  const status = h('p', { class: 'gp-status', role: 'status' }, w.loading);
  const body = h('div', { class: 'gp-body' });
  const actions = h('div', { class: 'gp-actions', hidden: true });
  const close = h('button', { class: 'mini', type: 'button', 'aria-label': w.close, html: '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true"><path fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" d="M6 6l12 12M18 6L6 18"/></svg>' });
  const dlg = h(
    'dialog',
    { class: 'gpanel', 'aria-label': w.title },
    h('div', { class: 'gp-head' }, h('h2', {}, w.title), close),
    status,
    body,
    actions,
    h('p', { class: 'gp-note' }, w.note),
  ) as HTMLDialogElement;
  const shut = () => {
    if (dlg.open) dlg.close();
  };
  dlg.addEventListener('close', () => {
    document.removeEventListener('junctionnav:google-key-refused', refused);
    dlg.remove();
  });
  close.addEventListener('click', shut);
  dlg.addEventListener('cancel', (e) => {
    e.preventDefault();
    shut();
  });
  const fail = (msg: string) => {
    status.textContent = msg;
    status.hidden = false;
    status.classList.add('is-error');
  };
  const refused = () => fail(w.badKey);
  document.addEventListener('junctionnav:google-key-refused', refused);
  document.body.append(dlg);
  dlg.showModal();

  let list: HTMLElement | null = null;
  const showList = () => {
    actions.hidden = true;
    body.replaceChildren(list!);
  };

  const showDetails = (place: GPlace) => {
    const id = place.id ?? '';
    const details = document.createElement('gmp-place-details-compact');
    details.setAttribute('orientation', 'vertical');
    const req = document.createElement('gmp-place-details-place-request');
    req.setAttribute('place', id);
    details.append(req, document.createElement('gmp-place-all-content'));
    body.replaceChildren(details);
    let at: LngLat | null = place.location ? [place.location.lng(), place.location.lat()] : null;
    details.addEventListener('gmp-load', () => {
      const p = (details as unknown as { place?: GPlace }).place;
      if (!at && p?.location) at = [p.location.lng(), p.location.lat()];
      go.disabled = !at;
      if (at) open.setAttribute('href', googleMapsUrl(at, id));
    });
    const go = h('button', { class: 'btn btn-primary', type: 'button', disabled: !at }, w.directions) as HTMLButtonElement;
    go.addEventListener('click', () => {
      if (!at) return;
      shut();
      o.onDirections(at);
    });
    const open = h('a', { class: 'btn btn-ghost', href: googleMapsUrl(at ?? [0, 0], id), target: '_blank', rel: 'noopener' }, w.open);
    const back = h('button', { class: 'btn btn-ghost', type: 'button' }, w.back);
    back.addEventListener('click', showList);
    actions.replaceChildren(go, open, back);
    actions.hidden = false;
  };

  if (keyRefused) return fail(w.badKey);
  loadPlacesKit(o.key, o.lang).then(
    () => {
      const search = document.createElement('gmp-place-search');
      search.setAttribute('orientation', 'vertical');
      search.setAttribute('selectable', '');
      const req = document.createElement('gmp-place-text-search-request') as HTMLElement & { textQuery?: string; locationBias?: unknown; maxResultCount?: number };
      req.textQuery = o.query;
      req.maxResultCount = 10;
      if (o.near) req.locationBias = { lat: o.near[1], lng: o.near[0] };
      search.append(document.createElement('gmp-place-all-content'), req);
      search.addEventListener('gmp-load', () => {
        status.hidden = true;
        const found = (search as unknown as { places?: unknown[] }).places;
        if (Array.isArray(found) && !found.length) fail(w.noResults);
      });
      search.addEventListener('gmp-error', () => fail(keyRefused ? w.badKey : w.failed));
      search.addEventListener('gmp-select', (e) => {
        const place = (e as unknown as { place?: GPlace }).place;
        if (place?.id) showDetails(place);
      });
      list = search;
      showList();
    },
    (e: Error) => fail(keyRefused ? w.badKey : e.message || w.failed),
  );
}
