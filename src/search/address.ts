/**
 * Rough addresses: what people type or paste from a message ("No 12, Jln SS2/24, 47300 PJ"),
 * tidied for the search services, and broader versions of it to fall back on when the exact
 * address is not found (the street, then the area, then the postcode and town), so a search
 * still lands on the right neighbourhood.
 */

/** Malaysian address shorthand, written out. */
const ABBREV: [RegExp, string][] = [
  [/\bjln\.?(?=\s|$)/gi, 'Jalan'],
  [/\bjl\.(?=\s|$)/gi, 'Jalan'],
  [/\blrg\.?(?=\s|$)/gi, 'Lorong'],
  [/\btmn\.?(?=\s|$)/gi, 'Taman'],
  [/\bkg\.?(?=\s|$)/gi, 'Kampung'],
  [/\bkpg\.?(?=\s|$)/gi, 'Kampung'],
  [/\bbdr\.?(?=\s|$)/gi, 'Bandar'],
  [/\bpsn\.?(?=\s|$)/gi, 'Persiaran'],
  [/\blbh\.?(?=\s|$)/gi, 'Lebuh'],
  [/\blbh\s*raya\b/gi, 'Lebuhraya'],
  [/\bbkt\.?(?=\s|$)/gi, 'Bukit'],
  [/\bsg\.(?=\s|$)/gi, 'Sungai'],
  [/\bsg(?=\s+[A-Z][a-z])/g, 'Sungai'],
  [/\bbt\.(?=\s|$)/gi, 'Batu'],
  [/\bsek\.?(?=\s|$)/gi, 'Seksyen'],
  // KL, but not KL Sentral, KLCC or KLIA.
  [/\bkl\b(?!\s*sentral)/gi, 'Kuala Lumpur'],
  [/\bpj\b/gi, 'Petaling Jaya'],
  [/\bjb\b/gi, 'Johor Bahru'],
  [/\bw\.?\s?p\.?(?=\s|,|$)/gi, 'Wilayah Persekutuan'],
  [/\bn\.?\s?sembilan\b/gi, 'Negeri Sembilan'],
  [/\bp\.?\s?pinang\b/gi, 'Pulau Pinang'],
];

/** Parts of an address no map has: units, floors, blocks, the house number's "No.". */
const UNIT = /^(?:unit|lot|blok|block|blk|tingkat|tkt|level|lvl|floor|flr|fl|suite|ste|aras|bilik|room|rm|ground floor|g\/f|#)\b\.?\s*[\w./-]*\s*/i;

const STATES = /^(?:selangor|johor|kedah|kelantan|melaka|malacca|negeri sembilan|pahang|perak|perlis|pulau pinang|penang|sabah|sarawak|terengganu|wilayah persekutuan|kuala lumpur wilayah persekutuan|malaysia|singapore|brunei)$/i;

const ADDRESS_WORDS = /\b(?:no\.?|nombor|lot|unit|blok|block|jalan|jln|jl\.|lorong|lrg|taman|tmn|kampung|kg|bandar|bdr|persiaran|psn|lebuh|lebuhraya|seksyen|section|ss\s?\d+|usj\s?\d+|pju\s?\d+|apartment|kondominium|condo|pangsapuri|residensi)\b|\b\d{5}\b/i;

/** The text reads like an address (a street, a house number, a postcode). */
export function looksLikeAddress(q: string): boolean {
  return ADDRESS_WORDS.test(q) || (/\d/.test(q) && q.includes(','));
}

/** A Malaysian postcode in the text. */
export function postcodeOf(q: string): string | null {
  return q.match(/(?:^|\D)(\d{5})(?:\D|$)/)?.[1] ?? null;
}

/** The street part ("Jalan SS 2/24"). */
export function streetOf(q: string): string | null {
  const m = q.match(/\b(?:Jalan|Lorong|Persiaran|Lebuhraya|Lebuh|Lingkaran|Lengkok|Medan|Jalan Besar)\b[^,]*/i);
  if (!m) return null;
  // Up to the next area word or postcode, when there are no commas.
  return m[0].replace(/\s+(?:Taman|Bandar|Kampung|Seksyen|Section|\d{5}).*$/i, '').trim() || null;
}

/** The town: after the postcode, else the last part that is not a state or the street. */
export function townOf(q: string): string | null {
  const pc = postcodeOf(q);
  if (pc) {
    const after = q.slice(q.indexOf(pc) + pc.length).split(',')[0].trim();
    if (after && !STATES.test(after)) return after;
  }
  const parts = q.split(',').map((p) => p.trim()).filter(Boolean);
  for (let i = parts.length - 1; i > 0; i--) {
    const p = parts[i];
    if (STATES.test(p) || /\d/.test(p) || /^(?:jalan|lorong|persiaran|lebuh)\b/i.test(p)) continue;
    return p;
  }
  return null;
}

/** The address tidied for the search services: shorthand written out, units and "No." left out. */
export function cleanAddress(q: string): string {
  let s = q.replace(/\s+/g, ' ').trim();
  for (const [re, to] of ABBREV) s = s.replace(re, to);
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .map((p) => {
      let x = p;
      // "Unit A-3-1", "Tingkat 2", "Blok B" (possibly several in one part).
      for (let i = 0; i < 3 && UNIT.test(x); i++) x = x.replace(UNIT, '');
      return x.replace(/^(?:no\.?|nombor|number)\s*(?=\w)/i, '').trim();
    })
    .filter(Boolean);
  return parts.join(', ');
}

/**
 * Broader versions of an address, most specific first, to fall back on: without the house number,
 * then without the street, and so on to the postcode with the town. Never a state on its own.
 */
export function addressFallbacks(q: string): string[] {
  const clean = cleanAddress(q);
  const out: string[] = [];
  const add = (s: string) => {
    const t = s.replace(/\s+/g, ' ').replace(/^[\s,]+|[\s,]+$/g, '');
    if (t && t !== clean && !STATES.test(t) && !out.includes(t)) out.push(t);
  };
  const parts = clean.split(',').map((p) => p.trim()).filter(Boolean);
  // The house number off the first part ("12 Jalan X" -> "Jalan X").
  if (parts.length && /^\d+[a-z]?(?:[-/]\d+)*\s+\D/i.test(parts[0])) add([parts[0].replace(/^\d+[a-z]?(?:[-/]\d+)*\s+/i, ''), ...parts.slice(1)].join(', '));
  if (parts.length > 1) {
    // Drop the most specific part each time.
    for (let i = 1; i < parts.length; i++) add(parts.slice(i).join(', '));
  } else {
    // No commas: start again from each area word, and from the postcode.
    const marks = [...clean.matchAll(/\b(?:Taman|Bandar|Kampung|Seksyen|Section|Desa|Pangsapuri|Apartment|Kondominium)\b|\b\d{5}\b/gi)].map((m) => m.index ?? 0);
    for (const at of marks) if (at > 0) add(clean.slice(at));
  }
  // The postcode with the town after it, and the town alone.
  const pc = postcodeOf(clean);
  if (pc) {
    const tail = clean.slice(clean.indexOf(pc) + pc.length).split(',')[0].trim();
    if (tail) {
      add(`${pc} ${tail}`);
      if (!STATES.test(tail)) add(tail);
    }
  }
  return out;
}
