/** Links for discovered places: social pages from OpenStreetMap tags, Commons photos, and "look it up" searches. */
import type { LngLat } from '../geo/geo';
import type { DiscoverPhoto, SourceLink } from './types';

/**
 * Sent with requests to the Wikimedia APIs, which ask browser apps to name themselves (a
 * browser cannot set User-Agent).
 */
export const WIKI_HEADERS: Record<string, string> = { 'Api-User-Agent': 'JunctionNav/1.0 (https://github.com/neokrex-source/junctionnav)' };

/** The first of several values ("a;b"), trimmed. */
const first = (v: string | undefined) => (v ?? '').split(';')[0].trim();

function asUrl(v: string, host: RegExp): URL | null {
  const s = /^https?:\/\//i.test(v) ? v : /^(www\.|m\.)?[a-z0-9-]+\.[a-z]{2,}\//i.test(v) ? `https://${v}` : '';
  if (!s) return null;
  try {
    const u = new URL(s);
    return host.test(u.hostname) ? u : null;
  } catch {
    return null;
  }
}

/** A Facebook page from an OSM value: a link, "facebook.com/x" or just the page name. */
export function facebookUrl(raw: string | undefined): string | null {
  const v = first(raw);
  if (!v) return null;
  const u = asUrl(v, /(^|\.)(facebook\.com|fb\.com|fb\.me)$/i);
  if (u) return `https://www.facebook.com${u.pathname.replace(/\/+$/, '')}${u.search}`;
  if (/^https?:/i.test(v) || /\s/.test(v)) return null;
  return /^[A-Za-z0-9.\-]{2,80}$/.test(v) ? `https://www.facebook.com/${v}` : null;
}

/** An Instagram profile from an OSM value: a link, "@name" or "name". */
export function instagramUrl(raw: string | undefined): string | null {
  const v = first(raw);
  if (!v) return null;
  const u = asUrl(v, /(^|\.)(instagram\.com|instagr\.am)$/i);
  if (u) {
    const handle = u.pathname.split('/').filter(Boolean)[0];
    return handle ? `https://www.instagram.com/${handle}/` : null;
  }
  const h = v.replace(/^@/, '');
  return /^[A-Za-z0-9._]{1,30}$/.test(h) ? `https://www.instagram.com/${h}/` : null;
}

/** A TikTok profile from an OSM value: a link, "@name" or "name". */
export function tiktokUrl(raw: string | undefined): string | null {
  const v = first(raw);
  if (!v) return null;
  const u = asUrl(v, /(^|\.)tiktok\.com$/i);
  if (u) {
    const handle = u.pathname.split('/').filter(Boolean)[0];
    return handle ? `https://www.tiktok.com/${handle.startsWith('@') ? handle : `@${handle}`}` : null;
  }
  const h = v.replace(/^@/, '');
  return /^[A-Za-z0-9._]{2,24}$/.test(h) ? `https://www.tiktok.com/@${h}` : null;
}

/** "@yutkee" for a profile link, the page name for Facebook. */
export function socialLabel(url: string): string {
  try {
    const seg = new URL(url).pathname.split('/').filter(Boolean)[0] ?? '';
    if (!seg) return url;
    return seg.startsWith('@') ? seg : /facebook/.test(url) ? seg : `@${seg}`;
  } catch {
    return url;
  }
}

/** A website as given in OSM, made into a link (or null when it is not one). */
export function websiteUrl(raw: string | undefined): string | null {
  const v = first(raw);
  if (!v) return null;
  const s = /^https?:\/\//i.test(v) ? v : /^[a-z0-9-]+(\.[a-z0-9-]+)+(\/|$)/i.test(v) ? `https://${v}` : '';
  if (!s) return null;
  try {
    const u = new URL(s);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

/** A thumbnail of a Commons file about `width` pixels wide. */
export function commonsThumb(file: string, width = 480): string {
  const name = file.replace(/^(File|Image):/i, '').replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(name)}?width=${width}`;
}

/** The Commons page of a file. */
export function commonsPage(file: string): string {
  const name = file.replace(/^(File|Image):/i, '').replace(/ /g, '_');
  return `https://commons.wikimedia.org/wiki/File:${encodeURIComponent(name)}`;
}

/** "File:Name.jpg" from a Commons page link, a FilePath link or the bare name. */
export function commonsFile(v: string | undefined): string | null {
  const s = first(v);
  if (!s) return null;
  const m = /(?:commons\.wikimedia\.org\/wiki\/(?:Special:FilePath\/)?)((?:File:)?[^?#]+)/i.exec(s);
  const raw = m ? m[1] : /^(File|Image):/i.test(s) ? s : /^[^/:]+\.(jpe?g|png|gif|webp|tiff?|svg)$/i.test(s) ? s : null;
  if (!raw) return null;
  let name = raw;
  try {
    name = decodeURIComponent(raw);
  } catch {
    /* as it is */
  }
  name = name.replace(/^(File|Image):/i, '').replace(/_/g, ' ').trim();
  return name ? `File:${name}` : null;
}

/**
 * A photo from OSM's image and wikimedia_commons tags: a Commons file (with its page for the
 * credit), or a direct link to an image.
 */
export function osmPhoto(tags: Record<string, string>): DiscoverPhoto | null {
  const file = commonsFile(tags.wikimedia_commons) ?? commonsFile(tags.image);
  if (file) return { url: commonsThumb(file), file, page: commonsPage(file) };
  const img = first(tags.image);
  if (/^https:\/\/[^\s]+\.(jpe?g|png|webp)(\?.*)?$/i.test(img)) return { url: img, page: img };
  return null;
}

/** A Wikipedia article from OSM's "en:Title" form. */
export function wikipediaUrl(raw: string | undefined): { url: string; lang: string; title: string } | null {
  const m = /^([a-z]{2,3}(?:-[a-z]+)?):(.+)$/i.exec(first(raw));
  if (!m) return null;
  const title = m[2].trim();
  return { url: `https://${m[1].toLowerCase()}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, lang: m[1].toLowerCase(), title };
}

/**
 * Searches for the place on TikTok, Instagram, Facebook and Google Maps, to see what people post
 * about it (the viral videos and reviews) and its ratings.
 */
export function lookUpLinks(name: string, area: string | undefined, at: LngLat): SourceLink[] {
  const q = [name, area].filter(Boolean).join(' ');
  const e = encodeURIComponent(q);
  return [
    { kind: 'tiktok', url: `https://www.tiktok.com/search?q=${e}`, label: 'TikTok' },
    { kind: 'instagram', url: `https://www.instagram.com/explore/search/keyword/?q=${e}`, label: 'Instagram' },
    { kind: 'facebook', url: `https://www.facebook.com/search/top/?q=${e}`, label: 'Facebook' },
    { kind: 'website', url: `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${name} ${at[1].toFixed(5)},${at[0].toFixed(5)}`)}`, label: 'Google Maps' },
  ];
}

/** Adds a link unless one to the same address is there already. */
export function addSource(list: SourceLink[], s: SourceLink | null | undefined): void {
  if (!s?.url) return;
  const key = s.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase();
  if (list.some((x) => x.url.replace(/^https?:\/\/(www\.)?/, '').replace(/\/+$/, '').toLowerCase() === key)) return;
  list.push(s);
}
