/**
 * Major roads of Peninsular Malaysia (and the links to Singapore) by the names drivers and the
 * news use for them, so traffic news can be matched to the roads on a route. Shared by the app
 * and the news collector (scripts/traffic/news.mjs, run on GitHub Actions), so it must not import
 * anything.
 *
 * `abbr` are matched as whole words in capitals only ("DUKE", not "duke"); `names` as whole words
 * in any case; `refs` are the route numbers on the map (OSM `ref`, e.g. E33, FT2) and in text.
 */

export interface Highway {
  key: string;
  abbr?: string[];
  names: string[];
  refs?: string[];
}

export const HIGHWAYS: Highway[] = [
  { key: 'PLUS', abbr: ['PLUS', 'NSE'], names: ['North-South Expressway', 'Lebuhraya Utara-Selatan'], refs: ['E1', 'E2'] },
  { key: 'NKVE', abbr: ['NKVE'], names: ['New Klang Valley Expressway', 'Lebuhraya Baru Lembah Klang'], refs: ['E1'] },
  { key: 'ELITE', abbr: ['ELITE'], names: ['North-South Expressway Central Link', 'Lebuhraya Utara-Selatan Hubungan Tengah'], refs: ['E6'] },
  { key: 'KESAS', abbr: ['KESAS'], names: ['Shah Alam Expressway', 'Lebuhraya Shah Alam'], refs: ['E5'] },
  { key: 'LDP', abbr: ['LDP'], names: ['Damansara-Puchong Expressway', 'Lebuhraya Damansara-Puchong'], refs: ['E11'] },
  { key: 'NPE', abbr: ['NPE'], names: ['New Pantai Expressway', 'Lebuhraya Baru Pantai'], refs: ['E10'] },
  { key: 'SPRINT', abbr: ['SPRINT'], names: ['Sistem Penyuraian Trafik KL Barat'], refs: ['E23'] },
  { key: 'DUKE', abbr: ['DUKE'], names: ['Duta-Ulu Kelang Expressway', 'Lebuhraya Duta-Ulu Kelang'], refs: ['E33'] },
  { key: 'MEX', abbr: ['MEX'], names: ['Maju Expressway', 'Lebuhraya Maju', 'KL-Putrajaya Expressway'], refs: ['E20'] },
  { key: 'SKVE', abbr: ['SKVE'], names: ['South Klang Valley Expressway', 'Lebuhraya Lembah Klang Selatan'], refs: ['E26'] },
  { key: 'GCE', abbr: ['GCE'], names: ['Guthrie Corridor Expressway', 'Lebuhraya Koridor Guthrie'], refs: ['E35'] },
  { key: 'LATAR', abbr: ['LATAR'], names: ['Kuala Lumpur-Kuala Selangor Expressway', 'Lebuhraya KL-Kuala Selangor'], refs: ['E25'] },
  { key: 'AKLEH', abbr: ['AKLEH'], names: ['Ampang-Kuala Lumpur Elevated Highway', 'Lebuhraya Bertingkat Ampang-KL'], refs: ['E12'] },
  { key: 'SMART', abbr: ['SMART'], names: ['SMART Tunnel', 'Terowong SMART'], refs: ['E38'] },
  { key: 'SUKE', abbr: ['SUKE'], names: ['Sungai Besi-Ulu Kelang Elevated Expressway', 'Lebuhraya Sungai Besi-Ulu Kelang'], refs: ['E19'] },
  { key: 'DASH', abbr: ['DASH'], names: ['Damansara-Shah Alam Elevated Expressway', 'Lebuhraya Damansara-Shah Alam'], refs: ['E31'] },
  { key: 'BESRAYA', abbr: ['BESRAYA'], names: ['Sungai Besi Expressway', 'Lebuhraya Sungai Besi'], refs: ['E9'] },
  { key: 'KARAK', names: ['Karak Highway', 'KL-Karak Expressway', 'Kuala Lumpur-Karak Expressway', 'Lebuhraya KL-Karak', 'Lebuhraya Karak'], refs: ['E8'] },
  { key: 'LPT', abbr: ['LPT', 'ECE'], names: ['East Coast Expressway', 'Lebuhraya Pantai Timur'], refs: ['E8'] },
  { key: 'FEDERAL', names: ['Federal Highway', 'Lebuhraya Persekutuan'], refs: ['FT2'] },
  { key: 'MRR2', abbr: ['MRR2'], names: ['Middle Ring Road 2', 'Jalan Lingkaran Tengah 2'], refs: ['FT28'] },
  { key: 'MRR1', abbr: ['MRR1'], names: ['Middle Ring Road 1', 'Jalan Lingkaran Tengah 1'] },
  { key: 'WCE', abbr: ['WCE'], names: ['West Coast Expressway', 'Lebuhraya Pantai Barat'], refs: ['E32'] },
  { key: 'KLIA', names: ['KLIA Expressway', 'Lebuhraya KLIA'] },
  { key: 'SILK', abbr: ['SILK'], names: ['Kajang Dispersal Link Expressway', 'Lebuhraya Kajang SILK'], refs: ['E18'] },
  { key: 'LEKAS', abbr: ['LEKAS'], names: ['Kajang-Seremban Highway', 'Lebuhraya Kajang-Seremban'], refs: ['E21'] },
  { key: 'CHERAS', names: ['Cheras-Kajang Highway', 'Lebuhraya Cheras-Kajang', 'Jalan Cheras'], refs: ['FT1'] },
  { key: 'PENANG-BRIDGE', names: ['Penang Bridge', 'Jambatan Pulau Pinang'], refs: ['E36'] },
  { key: 'SECOND-PENANG-BRIDGE', names: ['Second Penang Bridge', 'Sultan Abdul Halim Muadzam Shah Bridge', 'Jambatan Sultan Abdul Halim'], refs: ['E28'] },
  { key: 'BKE', abbr: ['BKE'], names: ['Butterworth-Kulim Expressway', 'Lebuhraya Butterworth-Kulim'], refs: ['E15'] },
  { key: 'LINKEDUA', names: ['Second Link Expressway', 'Linkedua', 'Lebuhraya Hubungan Kedua'], refs: ['E3'] },
  { key: 'CAUSEWAY', names: ['Johor Causeway', 'Tambak Johor'] },
  { key: 'EDL', abbr: ['EDL'], names: ['Eastern Dispersal Link', 'Lebuhraya Penyuraian Timur'], refs: ['E14'] },
  { key: 'PASIR-GUDANG', names: ['Pasir Gudang Highway', 'Lebuhraya Pasir Gudang'], refs: ['FT17'] },
  { key: 'SENAI-DESARU', names: ['Senai-Desaru Expressway', 'Lebuhraya Senai-Desaru'], refs: ['E22'] },
  { key: 'JALAN-TUN-RAZAK', names: ['Jalan Tun Razak'] },
  { key: 'JALAN-KUCHING', names: ['Jalan Kuching'] },
  { key: 'JALAN-DUTA', names: ['Jalan Duta'] },
  { key: 'JALAN-AMPANG', names: ['Jalan Ampang'] },
  { key: 'JALAN-IPOH', names: ['Jalan Ipoh'] },
  { key: 'JALAN-KLANG-LAMA', names: ['Jalan Klang Lama', 'Old Klang Road'] },
];

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
/** Dashes and spaces vary in names ("Duta-Ulu Kelang", "Duta – Ulu Kelang", "Duta Ulu Kelang"). */
const loose = (s: string) => escape(s).replace(/-|\s+/g, '[\\s\\u2010-\\u2015-]*');

interface Matcher {
  key: string;
  names: RegExp | null;
  caps: RegExp | null;
  refs: Set<string>;
}

const MATCHERS: Matcher[] = HIGHWAYS.map((hw) => ({
  key: hw.key,
  names: hw.names.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${hw.names.map(loose).join('|')})(?![\\p{L}\\p{N}])`, 'iu') : null,
  caps: hw.abbr?.length || hw.refs?.length ? new RegExp(`(?:^|[^\\p{L}\\p{N}])(?:${[...(hw.abbr ?? []), ...(hw.refs ?? [])].map(escape).join('|')})(?![\\p{L}\\p{N}])`, 'u') : null,
  refs: new Set(hw.refs ?? []),
}));

/** The roads (HIGHWAYS keys) a piece of text names, e.g. a news headline. */
export function roadsInText(text: string): string[] {
  const out: string[] = [];
  for (const m of MATCHERS) if (m.names?.test(text) || m.caps?.test(text)) out.push(m.key);
  return out;
}

/** The roads a route uses, from its steps' road names and numbers (OSM `name` and `ref`). */
export function roadsOfSteps(steps: { name?: string; ref?: string }[]): string[] {
  const out = new Set<string>();
  for (const st of steps) {
    for (const r of (st.ref ?? '').split(/[;,/]\s*|\s+/).filter(Boolean)) for (const m of MATCHERS) if (m.refs.has(r.toUpperCase())) out.add(m.key);
    if (st.name) for (const k of roadsInText(st.name)) out.add(k);
  }
  return [...out];
}

/** Display name of a road key. */
export function roadName(key: string): string {
  const hw = HIGHWAYS.find((h) => h.key === key);
  return hw?.abbr?.[0] ?? hw?.names[0] ?? key;
}
