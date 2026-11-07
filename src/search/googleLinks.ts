/**
 * Google Maps links pasted into search: a shared place, a dropped pin, a search, directions.
 *
 *   https://www.google.com/maps/place/Suria+KLCC/@3.1579,101.7119,17z/data=…!3d3.1578!4d101.7123…
 *   https://www.google.com/maps/@3.139,101.6869,15z
 *   https://maps.google.com/?q=3.139,101.6869      https://www.google.com.my/maps?q=Suria+KLCC
 *   https://www.google.com/maps/search/?api=1&query=3.139,101.6869
 *   https://www.google.com/maps/dir/?api=1&destination=Suria+KLCC
 *   https://www.google.com/maps/dir/KL+Sentral/Suria+KLCC/@…/data=…!1d101.71!2d3.15
 *   https://maps.app.goo.gl/AbCd1234   (a share link: a redirect to one of the above)
 *
 * The place's own position (`!3d<lat>!4d<lng>` in the data part) is exact; `@lat,lng` is only the
 * centre of the map that was on screen.
 */
import type { LngLat } from '../geo/geo';
import { parseCoordinates } from './coords';

export interface MapsLink {
  /** The place's own position. */
  point?: LngLat;
  /** The centre of the map view in the link, when it has no exact point. */
  view?: LngLat;
  /** The place's name (/place/<name>/). */
  name?: string;
  /** What the link searches for (q=, query=, /search/<text>, the destination of /dir/). */
  query?: string;
}

const MAPS_HOST = /^(?:www\.|maps\.)?google\.(?:com|[a-z]{2}|co\.[a-z]{2}|com\.[a-z]{2})$/i;

/** Short share links, which only say where they lead by redirecting. */
export function isShortMapsLink(url: string): boolean {
  return /^https?:\/\/(?:maps\.app\.goo\.gl|goo\.gl\/maps|g\.co\/kgs|maps\.google\.[a-z.]+\/\?cid=)/i.test(url.trim());
}

/** The first link in a pasted text ("Suria KLCC https://maps.app.goo.gl/…", as Google Maps shares it). */
export function findLink(text: string): string | null {
  const m = text.match(/https?:\/\/[^\s<>"']+/i);
  if (m) return m[0].replace(/[.,)]+$/, '');
  const bare = text.match(/(?:^|\s)((?:www\.)?(?:google\.[a-z.]+\/maps|maps\.google\.[a-z.]+|maps\.app\.goo\.gl|goo\.gl\/maps)\S*)/i);
  return bare ? `https://${bare[1]}` : null;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s.replace(/\+/g, ' ');
  }
};

/** A Google Maps address, whether or not it says where. */
export function isMapsLink(url: string): boolean {
  try {
    const u = new URL(url.trim());
    return MAPS_HOST.test(u.hostname) && (u.pathname.startsWith('/maps') || u.hostname.toLowerCase().startsWith('maps.'));
  } catch {
    return false;
  }
}

/** A Google Maps link written in a page (the page a short link sometimes answers with). */
export function linkInPage(body: string): string | null {
  const text = body
    .replace(/\\\//g, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003d/gi, '=')
    .replace(/&amp;/g, '&');
  for (const m of text.matchAll(/https?:\/\/(?:www\.|maps\.)?google\.[a-z.]+\/[^"'<>\s\\]*/gi)) if (parseMapsLink(m[0])) return m[0];
  return null;
}

/** What a Google Maps link points at, or null when it is not one. */
export function parseMapsLink(url: string): MapsLink | null {
  let u: URL;
  try {
    u = new URL(url.trim());
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  if (!MAPS_HOST.test(host) || (!u.pathname.startsWith('/maps') && !host.startsWith('maps.'))) return null;
  const out: MapsLink = {};
  const path = decode(u.pathname);
  // The place's own position: the last !3d…!4d… pair in the data part.
  const exact = [...path.matchAll(/!3d(-?\d{1,2}(?:\.\d+)?)!4d(-?\d{1,3}(?:\.\d+)?)/g)].pop();
  if (exact) out.point = [Number(exact[2]), Number(exact[1])];
  // Directions: each stop as !1d<lng>!2d<lat>, the destination last.
  const stops = [...path.matchAll(/!1d(-?\d{1,3}(?:\.\d+)?)!2d(-?\d{1,2}(?:\.\d+)?)/g)].pop();
  // The map view: /@lat,lng,zoom.
  const view = path.match(/@(-?\d{1,2}(?:\.\d+)?),(-?\d{1,3}(?:\.\d+)?)(?:,|\/|$)/);
  if (view) out.view = [Number(view[2]), Number(view[1])];

  const segs = u.pathname.split('/').filter(Boolean).map(decode);
  const after = (kind: string) => {
    const i = segs.indexOf(kind);
    const v = i >= 0 ? segs[i + 1] : undefined;
    return v && !v.startsWith('@') && !v.startsWith('data=') ? v.trim() : undefined;
  };
  const textOrPoint = (v: string | undefined, as: 'name' | 'query') => {
    if (!v) return;
    const c = parseCoordinates(v);
    if (c) out.point ??= c;
    else out[as] ??= v;
  };
  textOrPoint(after('place'), 'name');
  textOrPoint(after('search'), 'query');
  const dir = segs.indexOf('dir');
  if (dir >= 0) {
    const legs = segs.slice(dir + 1).filter((v) => v.trim() && !v.startsWith('@') && !v.startsWith('data='));
    if (stops) out.point ??= [Number(stops[1]), Number(stops[2])];
    textOrPoint(legs[legs.length - 1], 'query');
  }
  for (const k of ['q', 'query', 'destination', 'daddr', 'll', 'sll', 'center']) {
    const v = u.searchParams.get(k);
    if (!v) continue;
    const c = parseCoordinates(v.replace(/^loc:/i, ''));
    if (c) out.point ??= c;
    else if (k !== 'll' && k !== 'sll' && k !== 'center') out.query ??= v.trim();
  }
  return out.point || out.view || out.name || out.query ? out : null;
}

/**
 * Where a short link leads, by asking for it without following the redirects (only the Android
 * app can: a web page is not allowed to read another site's redirect). Up to six hops; a consent
 * page in between gives its destination.
 */
export async function resolveShortLink(
  url: string,
  get: (u: string) => Promise<{ status: number; headers: Record<string, string>; url?: string; body?: string }>,
): Promise<string> {
  let cur = url;
  for (let i = 0; i < 6; i++) {
    const r = await get(cur);
    const loc = Object.entries(r.headers ?? {}).find(([k]) => k.toLowerCase() === 'location')?.[1];
    if (r.status >= 300 && r.status < 400 && loc) {
      cur = new URL(loc, cur).href;
      const cont = new URL(cur).searchParams.get('continue');
      if (/consent\./.test(new URL(cur).hostname) && cont) cur = cont;
      if (parseMapsLink(cur)) return cur;
      continue;
    }
    if (r.status >= 400) {
      const e = new Error(r.status === 404 || r.status === 410 ? 'The link was not found. It may have expired.' : `The link could not be opened (${r.status}).`);
      if (r.status === 404 || r.status === 410) e.name = 'LinkGone';
      throw e;
    }
    if (r.url && parseMapsLink(r.url)) return r.url;
    // Some answers are a page that sends the browser on with a script; the link is in it.
    const inPage = r.body ? linkInPage(r.body) : null;
    return inPage ?? r.url ?? cur;
  }
  return cur;
}
