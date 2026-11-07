/**
 * Coordinates typed or pasted into search, in the forms people copy them in:
 *
 *   3.139, 101.6869            3.139 101.6869            101.6869, 3.139 (longitude first)
 *   3.139°N 101.6869°E         N 3.139, E 101.6869       -3.1, -60.02
 *   3°08'20.4"N 101°41'12.8"E  (as Google Maps shows them)
 *   3°08.340'N 101°41.213'E    3d8m20s N 101d41m13s E
 *   geo:3.139,101.6869         geo:0,0?q=3.139,101.6869(Suria KLCC)
 */
import type { LngLat } from '../geo/geo';

/** One coordinate: degrees, minutes, seconds and a hemisphere letter, each optional but the degrees. */
const BODY = String.raw`([NSEWnsew])?\s*([+-]?\d{1,3}(?:\.\d+)?)\s*(?:°|º|˚|deg|d(?![a-z]))?\s*(?:(\d{1,2}(?:\.\d+)?)\s*(?:'|′|’|‘|m(?![a-z])|min)\s*)?(?:(\d{1,2}(?:\.\d+)?)\s*(?:"|″|”|''|s(?![a-z])|sec)\s*)?`;
const PART = new RegExp(BODY + '([NSEWnsew])?', 'y');
/** The same without a letter after: with one before, a letter after starts the next part ("N3.139 E101.6869"). */
const PART_LEAD = new RegExp(BODY, 'y');

interface Part {
  value: number;
  hemi: 'N' | 'S' | 'E' | 'W' | null;
  /** Written with minutes or seconds. */
  dms: boolean;
}

function readPart(s: string, at: number): { part: Part; end: number } | null {
  PART.lastIndex = at;
  let m = PART.exec(s);
  if (m?.[1] && m[5]) {
    PART_LEAD.lastIndex = at;
    m = PART_LEAD.exec(s);
  }
  if (!m || m.index !== at || !m[2]) return null;
  const pre = m[1]?.toUpperCase() as Part['hemi'];
  const post = m[5]?.toUpperCase() as Part['hemi'];
  const deg = Number(m[2]);
  const min = m[3] ? Number(m[3]) : 0;
  const sec = m[4] ? Number(m[4]) : 0;
  if (min >= 60 || sec >= 60) return null;
  const sign = deg < 0 || m[2].startsWith('-') ? -1 : 1;
  let value = sign * (Math.abs(deg) + min / 60 + sec / 3600);
  const hemi = pre ?? post ?? null;
  if (hemi === 'S' || hemi === 'W') value = -Math.abs(value);
  return { part: { value, hemi, dms: !!(m[3] || m[4]) }, end: at + m[0].length };
}

/** A point from typed or pasted coordinates, or null when the text is something else. */
export function parseCoordinates(q: string): LngLat | null {
  let s = q.trim();
  if (!s) return null;
  // geo: links (Android shares places this way); the q= point wins over the 0,0 placeholder.
  const geo = s.match(/^geo:([^?]*)(?:\?(.*))?$/i);
  if (geo) {
    const qp = new URLSearchParams(geo[2] ?? '').get('q');
    const fromQ = qp ? parseCoordinates(qp.replace(/\(.*\)\s*$/, '')) : null;
    if (fromQ) return fromQ;
    s = geo[1].split(';')[0];
    const p = parseCoordinates(s);
    return p && (p[0] !== 0 || p[1] !== 0) ? p : null;
  }
  // "lat: 3.139, lng: 101.6869", "@3.139,101.6869" (from a map link), brackets.
  s = s
    .replace(/^@/, '')
    .replace(/\b(?:lat(?:itude)?|lng|lon(?:g(?:itude)?)?)\b\s*[:=]?/gi, ' ')
    .replace(/[()[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const a = readPart(s, 0);
  if (!a) return null;
  let i = a.end;
  // Between the two: a comma, semicolon, slash or just space.
  const sep = s.slice(i).match(/^\s*[,;/]?\s*/);
  i += sep ? sep[0].length : 0;
  if (i === a.end && !/\s|[NSEWnsew]/.test(s[a.end - 1] ?? '') && a.part.hemi == null) return null;
  const b = readPart(s, i);
  if (!b || s.slice(b.end).trim()) return null;
  let lat: number;
  let lng: number;
  const latFirst = (p: Part) => p.hemi === 'N' || p.hemi === 'S';
  const lngFirst = (p: Part) => p.hemi === 'E' || p.hemi === 'W';
  // Two latitudes or two longitudes is not a point.
  if ((latFirst(a.part) && latFirst(b.part)) || (lngFirst(a.part) && lngFirst(b.part))) return null;
  if (latFirst(a.part) || lngFirst(b.part)) {
    lat = a.part.value;
    lng = b.part.value;
  } else if (lngFirst(a.part) || latFirst(b.part)) {
    lat = b.part.value;
    lng = a.part.value;
  } else if (Math.abs(a.part.value) > 90 && Math.abs(b.part.value) <= 90) {
    // Longitude first, as some apps and spreadsheets write it.
    lat = b.part.value;
    lng = a.part.value;
  } else {
    lat = a.part.value;
    lng = b.part.value;
  }
  // Plain numbers need a decimal point (or a sign) somewhere: "12 34" is more likely an address.
  if (!a.part.hemi && !b.part.hemi && !a.part.dms && !b.part.dms && !/[.-]/.test(s)) return null;
  if (!(Math.abs(lat) <= 90 && Math.abs(lng) <= 180)) return null;
  return [lng, lat];
}

/** "3.13900, 101.68690", the way the app shows a point. */
export function coordText(p: LngLat): string {
  return `${p[1].toFixed(5)}, ${p[0].toFixed(5)}`;
}

/** 3°08'20.4"N 101°41'12.8"E, the way Google Maps writes it. */
export function dmsText(p: LngLat): string {
  const one = (v: number, pos: string, neg: string) => {
    const a = Math.abs(v);
    let d = Math.floor(a);
    let m = Math.floor((a - d) * 60);
    let s = Math.round(((a - d) * 60 - m) * 600) / 10;
    if (s >= 60) {
      s = 0;
      m++;
    }
    if (m >= 60) {
      m = 0;
      d++;
    }
    return `${d}°${String(m).padStart(2, '0')}'${s.toFixed(1).padStart(4, '0')}"${v < 0 ? neg : pos}`;
  };
  return `${one(p[1], 'N', 'S')} ${one(p[0], 'E', 'W')}`;
}
