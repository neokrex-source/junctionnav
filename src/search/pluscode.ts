/**
 * Plus codes (Open Location Code), as Google Maps shows them for places and dropped pins: full
 * codes ("6PM35P56+4W") and short ones with a town ("5P56+4W Kuala Lumpur"), recovered from a
 * nearby reference point. Follows the open specification (github.com/google/open-location-code).
 */
import type { LngLat } from '../geo/geo';

const ALPHABET = '23456789CFGHJMPQRVWX';
const SEP = '+';
const SEP_AT = 8;
const PAIRS = [20, 1, 0.05, 0.0025, 0.000125];

const valid = (c: string) => ALPHABET.includes(c);

/** A plus code in text, with the town after it for a short code. */
export function parsePlusCode(text: string): { code: string; locality: string } | null {
  const m = text.trim().match(/^([23456789CFGHJMPQRVWX]{2,8}0*\+[23456789CFGHJMPQRVWX]{0,7})(?:[\s,]+(.+))?$/i);
  if (!m) return null;
  const code = m[1].toUpperCase();
  const sep = code.indexOf(SEP);
  if (sep % 2 === 1 || sep > SEP_AT || code.length - sep === 2) return null;
  // A full code has eight digits before the separator; a short one needs a place to be near.
  if (sep < SEP_AT && code.includes('0')) return null;
  if (sep === SEP_AT && (ALPHABET.indexOf(code[0]) * 20 >= 180 || ALPHABET.indexOf(code[1]) * 20 >= 360)) return null;
  return { code, locality: (m[2] ?? '').trim() };
}

export function isFullPlusCode(code: string): boolean {
  return code.indexOf(SEP) === SEP_AT;
}

/** The centre of the area a full code stands for. */
export function decodePlusCode(full: string): LngLat {
  const code = full.replace(SEP, '').replace(/0+$/, '').toUpperCase();
  let lat = -90;
  let lng = -180;
  let resLat = 20;
  let resLng = 20;
  const n = Math.min(code.length, 10);
  for (let i = 0; i < n; i += 2) {
    const r = PAIRS[i / 2];
    if (!valid(code[i]) || !valid(code[i + 1] ?? '2')) throw new Error('Not a plus code');
    lat += ALPHABET.indexOf(code[i]) * r;
    lng += ALPHABET.indexOf(code[i + 1] ?? '2') * r;
    resLat = resLng = r;
  }
  // Characters past the tenth refine within a 4 × 5 grid.
  for (let i = 10; i < code.length; i++) {
    if (!valid(code[i])) throw new Error('Not a plus code');
    resLat /= 5;
    resLng /= 4;
    const d = ALPHABET.indexOf(code[i]);
    lat += Math.floor(d / 4) * resLat;
    lng += (d % 4) * resLng;
  }
  return [lng + resLng / 2, lat + resLat / 2];
}

/** The ten-digit code of a point (about 14 m), with its separator. */
export function encodePlusCode(p: LngLat): string {
  // In whole steps of the tenth digit (1/8000 of a degree), so rounding cannot creep in.
  const steps = (v: number) => Math.floor(Math.round(v * 8000 * 1e6) / 1e6);
  let lat = Math.min(180 * 8000 - 1, steps(Math.min(90, Math.max(-90, p[1])) + 90));
  let lng = steps(((((p[0] + 180) % 360) + 360) % 360)) % (360 * 8000);
  let out = '';
  for (let i = 0, unit = 160_000; i < 5; i++, unit /= 20) {
    const a = Math.floor(lat / unit);
    const b = Math.floor(lng / unit);
    lat -= a * unit;
    lng -= b * unit;
    out += ALPHABET[a] + ALPHABET[b];
    if (i === 3) out += SEP;
  }
  return out;
}

/** The point of a short code, taking the missing first digits from the reference point nearby. */
export function recoverPlusCode(short: string, ref: LngLat): LngLat {
  const code = short.toUpperCase();
  if (isFullPlusCode(code)) return decodePlusCode(code);
  const pad = SEP_AT - code.indexOf(SEP);
  const res = Math.pow(20, 2 - pad / 2);
  const half = res / 2;
  const full = encodePlusCode(ref).replace(SEP, '').slice(0, pad) + code;
  const [lng0, lat0] = decodePlusCode(full.slice(0, SEP_AT) + SEP + full.slice(SEP_AT + 1));
  let lat = lat0;
  let lng = lng0;
  // The nearest of the neighbouring areas to the reference.
  if (ref[1] + half < lat && lat - res >= -90) lat -= res;
  else if (ref[1] - half > lat && lat + res <= 90) lat += res;
  if (ref[0] + half < lng) lng -= res;
  else if (ref[0] - half > lng) lng += res;
  return [lng, lat];
}
