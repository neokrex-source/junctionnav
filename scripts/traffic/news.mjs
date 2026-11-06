// Collects traffic headlines from Malaysian news feeds into one small JSON file the app reads
// (no key needed). Run every 20 minutes by .github/workflows/traffic-news.yml:
//
//   node --experimental-strip-types scripts/traffic/news.mjs out/news.json
//
// Keeps items from the last 12 hours that are about traffic (jams, accidents, closures, floods,
// roadworks) on a road, and tags each with the roads it names, so the app can flag the ones on
// the driver's route. Feeds that fail are skipped; the file lists which answered.
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { roadsInText } from '../../src/traffic/roads.ts';

const MAX_AGE_H = 12;
const MAX_ITEMS = 40;

const gnews = (q, lang) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(`${q} when:1d`)}&hl=${lang === 'ms' ? 'ms' : 'en-MY'}&gl=MY&ceid=MY:${lang}`;

const MAJOR = 'PLUS OR NKVE OR ELITE OR DUKE OR LDP OR MEX OR SPRINT OR KESAS OR NPE OR SKVE OR "Federal Highway" OR Karak OR LPT OR MRR2 OR Causeway OR "Second Link" OR "Penang Bridge"';
export const FEEDS = [
  { name: 'Google News', url: gnews(`(traffic OR jam OR congestion OR accident OR crash OR closure OR closed OR flood) (highway OR expressway OR road OR toll) Malaysia`, 'en') },
  { name: 'Google News', url: gnews(`(jam OR congestion OR crash OR accident OR closed OR closure OR flood OR landslide) (${MAJOR})`, 'en') },
  { name: 'Google News', url: gnews('(kesesakan OR kemalangan OR ditutup OR penutupan OR banjir OR lencongan OR "tanah runtuh") (lebuhraya OR jalan OR tol)', 'ms') },
  { name: 'Malay Mail', url: 'https://www.malaymail.com/feed/rss/malaysia' },
  { name: 'Free Malaysia Today', url: 'https://www.freemalaysiatoday.com/category/nation/feed/' },
  { name: 'New Straits Times', url: 'https://www.nst.com.my/feed' },
  { name: 'Berita Harian', url: 'https://www.bharian.com.my/feed' },
  { name: 'Harian Metro', url: 'https://www.hmetro.com.my/feed' },
  { name: 'Bernama', url: 'https://www.bernama.com/en/rssfeed.php' },
];

/* ------------------------------------------------------------------ RSS and Atom */

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
export function decode(s) {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e) => {
      if (e[0] === '#') {
        const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
        return Number.isFinite(n) ? String.fromCodePoint(n) : m;
      }
      return ENTITIES[e.toLowerCase()] ?? m;
    });
}
const strip = (html) => decode(html).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
const tag = (xml, name) => {
  const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
};
const attr = (xml, name, a) => xml.match(new RegExp(`<${name}\\s[^>]*${a}="([^"]*)"`, 'i'))?.[1] ?? '';

/** Items of an RSS or Atom feed: title, link, published, summary, and the outlet when the feed names it. */
export function parseFeed(xml, fallbackSource) {
  const out = [];
  const blocks = xml.match(/<item[\s>][\s\S]*?<\/item>/gi) ?? xml.match(/<entry[\s>][\s\S]*?<\/entry>/gi) ?? [];
  for (const b of blocks) {
    let title = strip(tag(b, 'title'));
    const link = decode(tag(b, 'link')).trim() || decode(attr(b, 'link', 'href'));
    const published = decode(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date')).trim();
    const summary = strip(tag(b, 'description') || tag(b, 'summary')).slice(0, 600);
    let source = strip(tag(b, 'source')) || fallbackSource;
    // Google News puts the outlet at the end of the title.
    if (source && title.endsWith(` - ${source}`)) title = title.slice(0, -(source.length + 3)).trim();
    if (title && /^https?:\/\//.test(link)) out.push({ title, link, published, summary, source });
  }
  return out;
}

/* ------------------------------------------------------------------ which items are traffic news */

const TRAFFIC = new RegExp(
  [
    'traffic', 'jams?', 'jammed', 'congest(?:ed|ion)', 'gridlock', 'crawl(?:ing)?', 'standstill', 'bottleneck', 'slow[- ]moving',
    'accidents?', 'crash(?:es|ed)?', 'collisions?', 'collided', 'overturn(?:s|ed)?', 'pile[- ]up', 'skidded', 'rammed',
    'clos(?:ed|ure|ures)', 'diversions?', 'detours?', 'flood(?:s|ed|ing)?', 'flash floods?', 'landslides?', 'sinkholes?', 'road ?works', 'resurfacing', 'breakdown',
    'kesesakan', 'sesak', 'kemalangan', 'nahas', 'terbalik', 'bertembung', 'rempuh', 'ditutup', 'penutupan', 'lencongan', 'banjir(?: kilat)?',
    'tanah runtuh', 'lubang benam', 'kerja[- ](?:kerja )?(?:pembaikan|penyelenggaraan|menurap)', 'trafik', 'lalu lintas', 'bergerak perlahan', 'lumpuh',
  ].join('|'),
  'i',
);
const ROADS = new RegExp(
  [
    'highway', 'expressway', 'motorway', 'road', 'street', 'toll', 'interchange', 'flyover', 'bypass', 'tunnel', 'bridge', 'causeway', 'junction', 'lane',
    'lebuhraya', 'jalan', 'plaza tol', 'tol', 'persimpangan', 'susur', 'jejantas', 'terowong', 'jambatan', 'lorong', 'km ?\\d+',
  ].map((w) => `\\b${w}\\b`).join('|'),
  'i',
);
/**
 * Not news of the roads right now: trafficking, summonses, air or web traffic, discounts, and
 * stories about road safety in general, campaigns, statistics and court cases over old crashes.
 */
const NOT = new RegExp(
  [
    'trafficking', 'pemerdagangan', 'summons', 'saman', 'compound', 'kompaun', 'discount', 'diskaun', 'air traffic', 'web traffic', 'internet traffic', 'drug', 'dadah',
    'black ?spots?', 'kawasan panas', 'upgrad', 'naik taraf', 'statistic', 'statistik', 'campaign', 'kempen', 'ops? selamat', 'awareness', 'kesedaran',
    'court', 'mahkamah', 'charged', 'didakwa', 'sentenced', 'dihukum', 'jail', 'penjara', 'compensation', 'pampasan', 'insurance', 'insurans',
  ].join('|'),
  'i',
);
/**
 * A particular road: one the app knows, a named road ("Jalan Ampang", "Lebuhraya Persekutuan",
 * "Old Klang Road"; not "jalan raya", which means roads in general), a KM marker, a toll plaza.
 */
const NAMED = /\b(?:Jalan|Jln|Lebuhraya|Lebuh|Persiaran|Lorong|Susur|Jambatan|Terowong|Plaza Tol)\s+(?!Raya\b)\p{Lu}|\p{Lu}[\p{L}'-]+\s+(?:Road|Highway|Expressway|Street|Avenue|Bridge|Tunnel|Toll|Interchange|Flyover|Bypass|Link)\b|\bKM\s?\d+|\btoll plaza\b/u;

const KIND = [
  ['accident', /accident|crash|collision|collided|overturn|pile[- ]up|skidded|rammed|kemalangan|nahas|terbalik|bertembung|rempuh/i],
  ['closure', /clos(?:ed|ure)|diversion|detour|ditutup|penutupan|lencongan/i],
  ['flood', /flood|landslide|banjir|tanah runtuh/i],
  ['roadworks', /road ?works|resurfacing|sinkhole|repair|kerja[- ](?:kerja )?(?:pembaikan|penyelenggaraan|menurap)|lubang benam/i],
  ['jam', /traffic|jam|congest|gridlock|crawl|standstill|bottleneck|slow[- ]moving|kesesakan|sesak|perlahan|lumpuh|trafik|lalu lintas/i],
];

export function classify(text) {
  for (const [k, re] of KIND) if (re.test(text)) return k;
  return 'other';
}

/** A traffic item on a named or general road, or null. */
export function trafficItem(it, now = Date.now()) {
  const text = `${it.title}. ${it.summary ?? ''}`;
  const t = Date.parse(it.published);
  if (!Number.isFinite(t) || now - t > MAX_AGE_H * 3600_000 || t - now > 3600_000) return null;
  if (NOT.test(it.title) || !TRAFFIC.test(it.title)) return null;
  const roads = roadsInText(text);
  if (!roads.length && !(ROADS.test(text) && NAMED.test(text))) return null;
  return { title: it.title, link: it.link, source: it.source, published: new Date(t).toISOString(), roads, kind: classify(it.title) };
}

const norm = (s) => s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

export function collect(lists, now = Date.now()) {
  const seen = new Set();
  const items = [];
  for (const it of lists.flat()) {
    const t = trafficItem(it, now);
    if (!t) continue;
    const key = norm(t.title).slice(0, 80);
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(t);
  }
  return items.sort((a, b) => Date.parse(b.published) - Date.parse(a.published)).slice(0, MAX_ITEMS);
}

async function fetchFeed(f) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 20_000);
  try {
    const res = await fetch(f.url, { signal: ctrl.signal, headers: { 'User-Agent': 'JunctionNav traffic news (+https://github.com/neokrex-source/junctionnav)', Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml' } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return parseFeed(await res.text(), f.name);
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  const out = process.argv[2] ?? 'news.json';
  const now = Date.now();
  const results = await Promise.all(
    FEEDS.map(async (f) => {
      try {
        const items = await fetchFeed(f);
        return { f, items, ok: true };
      } catch (err) {
        return { f, items: [], ok: false, error: String(err.message ?? err) };
      }
    }),
  );
  const items = collect(results.map((r) => r.items), now);
  const sources = results.map((r) => ({ name: r.f.name, url: r.f.url, ok: r.ok, items: r.items.length, traffic: r.items.filter((i) => trafficItem(i, now)).length, ...(r.error ? { error: r.error } : {}) }));
  for (const s of sources) console.log(`${s.ok ? 'ok  ' : 'FAIL'} ${s.name.padEnd(20)} ${String(s.items).padStart(3)} items, ${String(s.traffic).padStart(2)} traffic${s.error ? `  (${s.error})` : ''}`);
  console.log(`\n${items.length} traffic items:`);
  for (const it of items) console.log(`  ${it.published.slice(5, 16)} [${it.kind}] ${it.roads.length ? `{${it.roads.join(',')}} ` : ''}${it.title} (${it.source})`);
  await mkdir(dirname(out), { recursive: true });
  await writeFile(out, JSON.stringify({ updated: new Date(now).toISOString(), items, sources }, null, 1));
  if (!sources.some((s) => s.ok)) process.exitCode = 1;
}

if (import.meta.url === `file://${process.argv[1]}`) await main();
