/** Traffic words in the app's languages: incident names, spoken warnings and the traffic list. */
import { LANGS, type LangCode, type Units } from '../routing/instructions';
import type { IncidentKind, NewsKind, RouteIncident } from './types';

const KINDS: Record<LangCode, Record<IncidentKind, string>> = {
  en: {
    accident: 'Accident',
    jam: 'Slow traffic',
    closure: 'Road closed',
    laneClosed: 'Lane closed',
    roadworks: 'Roadworks',
    flooding: 'Flooding',
    weather: 'Bad weather',
    hazard: 'Hazard',
    breakdown: 'Broken-down vehicle',
    other: 'Traffic incident',
  },
  ms: {
    accident: 'Kemalangan',
    jam: 'Kesesakan',
    closure: 'Jalan ditutup',
    laneClosed: 'Lorong ditutup',
    roadworks: 'Kerja jalan',
    flooding: 'Banjir',
    weather: 'Cuaca buruk',
    hazard: 'Bahaya',
    breakdown: 'Kenderaan rosak',
    other: 'Insiden trafik',
  },
  ja: {
    accident: '事故',
    jam: '渋滞',
    closure: '通行止め',
    laneClosed: '車線規制',
    roadworks: '工事',
    flooding: '冠水',
    weather: '悪天候',
    hazard: '危険',
    breakdown: '故障車',
    other: '交通情報',
  },
};

const NEWS_KINDS: Record<LangCode, Record<NewsKind, string>> = {
  en: { accident: 'Accident', jam: 'Traffic', closure: 'Closure', flood: 'Flood', roadworks: 'Roadworks', other: 'Traffic' },
  ms: { accident: 'Kemalangan', jam: 'Trafik', closure: 'Penutupan', flood: 'Banjir', roadworks: 'Kerja jalan', other: 'Trafik' },
  ja: { accident: '事故', jam: '交通', closure: '通行止め', flood: '冠水', roadworks: '工事', other: '交通' },
};

export type TrafficKey =
  | 'traffic'
  | 'onRoute'
  | 'news'
  | 'newsRoute'
  | 'noIncidents'
  | 'noNews'
  | 'needKey'
  | 'delay'
  | 'trafficDelay'
  | 'inDist'
  | 'faster'
  | 'switch'
  | 'keep'
  | 'switched'
  | 'updated'
  | 'from'
  | 'liveOff'
  | 'source'
  | 'inArea'
  | 'noIncidentsArea'
  | 'noDelays'
  | 'arrival'
  | 'zoomIn'
  | 'now'
  | 'ago'
  | 'ahead'
  | 'forNext'
  | 'left'
  | 'long'
  | 'fasterShort';

const UI: Record<LangCode, Record<TrafficKey, string>> = {
  en: {
    traffic: 'Traffic',
    onRoute: 'On your route',
    news: 'Traffic news',
    newsRoute: 'News about your roads',
    noIncidents: 'No traffic problems reported on your route.',
    noNews: 'No traffic news in the last few hours.',
    needKey: 'Add a free TomTom key in Settings for live traffic on the map and your route.',
    delay: '+{m} min',
    trafficDelay: '+{m} min traffic',
    inDist: 'in {d}',
    faster: 'Faster route via {via}: saves {m} min',
    switch: 'Switch',
    keep: 'Keep',
    switched: 'Switched to the faster route.',
    updated: 'Updated {t}',
    from: '{a} to {b}',
    liveOff: 'Live traffic is off. Turn it on in Settings.',
    source: 'Traffic by TomTom',
    inArea: 'In this area',
    noIncidentsArea: 'No traffic problems reported around here.',
    noDelays: 'No traffic delays',
    arrival: 'Arrival with traffic {t}',
    zoomIn: 'Zoom in to see incidents.',
    now: 'here',
    ago: '{t} ago',
    ahead: '{d} ahead',
    forNext: 'For the next {d}',
    left: '{d} left',
    long: '{d} long',
    fasterShort: 'Via {via}: {m} min faster',
  },
  ms: {
    traffic: 'Trafik',
    onRoute: 'Di laluan anda',
    news: 'Berita trafik',
    newsRoute: 'Berita tentang jalan anda',
    noIncidents: 'Tiada masalah trafik dilaporkan di laluan anda.',
    noNews: 'Tiada berita trafik dalam beberapa jam lalu.',
    needKey: 'Tambah kunci TomTom percuma dalam Tetapan untuk trafik langsung di peta dan laluan anda.',
    delay: '+{m} min',
    trafficDelay: '+{m} min trafik',
    inDist: 'dalam {d}',
    faster: 'Laluan lebih pantas melalui {via}: jimat {m} min',
    switch: 'Tukar',
    keep: 'Kekal',
    switched: 'Ditukar ke laluan lebih pantas.',
    updated: 'Dikemas kini {t}',
    from: '{a} ke {b}',
    liveOff: 'Trafik langsung dimatikan. Hidupkan dalam Tetapan.',
    source: 'Trafik oleh TomTom',
    inArea: 'Di kawasan ini',
    noIncidentsArea: 'Tiada masalah trafik dilaporkan di sekitar sini.',
    noDelays: 'Tiada kelewatan trafik',
    arrival: 'Tiba dengan trafik {t}',
    zoomIn: 'Zum masuk untuk melihat insiden.',
    now: 'di sini',
    ago: '{t} lalu',
    ahead: '{d} di hadapan',
    forNext: 'Untuk {d} lagi',
    left: '{d} lagi',
    long: 'Sepanjang {d}',
    fasterShort: 'Melalui {via}: {m} min lebih pantas',
  },
  ja: {
    traffic: '交通情報',
    onRoute: 'ルート上',
    news: '交通ニュース',
    newsRoute: 'ルートの道路のニュース',
    noIncidents: 'ルート上に交通障害の情報はありません。',
    noNews: 'ここ数時間の交通ニュースはありません。',
    needKey: '地図とルートのリアルタイム交通情報には、設定で無料の TomTom キーを入力してください。',
    delay: '+{m}分',
    trafficDelay: '渋滞 +{m}分',
    inDist: '{d}先',
    faster: '{via}経由の速いルート: {m}分短縮',
    switch: '切り替える',
    keep: 'このまま',
    switched: '速いルートに切り替えました。',
    updated: '{t} 更新',
    from: '{a} から {b}',
    liveOff: 'リアルタイム交通情報はオフです。設定でオンにできます。',
    source: '交通情報: TomTom',
    inArea: 'この付近',
    noIncidentsArea: 'この付近に交通障害の情報はありません。',
    noDelays: '渋滞による遅れなし',
    arrival: '渋滞を考慮した到着 {t}',
    zoomIn: '拡大すると交通障害が表示されます。',
    now: '現在地',
    ago: '{t}前',
    ahead: '{d}先',
    forNext: 'この先{d}続きます',
    left: '残り{d}',
    long: '長さ{d}',
    fasterShort: '{via}経由: {m}分早い',
  },
};

export function tt(lang: LangCode, key: TrafficKey, vars: Record<string, string> = {}): string {
  return UI[lang][key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

export function kindName(lang: LangCode, k: IncidentKind): string {
  return KINDS[lang][k];
}

export function newsKindName(lang: LangCode, k: NewsKind): string {
  return NEWS_KINDS[lang][k];
}

/** Minutes for display, at least 1. */
export const minutes = (sec: number) => String(Math.max(1, Math.round(sec / 60)));

/** Worth a spoken warning: closures, accidents, floods and hazards always; slow traffic and works when they cost time. */
export function worthWarning(i: RouteIncident): boolean {
  if (i.kind === 'closure' || i.kind === 'accident' || i.kind === 'flooding' || i.kind === 'hazard') return true;
  if (i.kind === 'weather' || i.kind === 'other') return i.delay >= 120 || i.magnitude === 'major';
  return i.delay >= 90 || i.magnitude === 'major' || i.magnitude === 'moderate';
}

/** "Accident ahead in 2 kilometres. About 8 minutes' delay." */
export function warningSpeech(i: RouteIncident, dist: number, lang: LangCode, units: Units): string {
  const d = LANGS[lang].spokenDistance(dist, units);
  const m = Math.round(i.delay / 60);
  if (lang === 'ms') {
    const what: Record<IncidentKind, string> = {
      accident: 'Kemalangan di hadapan',
      jam: 'Kesesakan di hadapan',
      closure: 'Jalan ditutup di hadapan',
      laneClosed: 'Lorong ditutup di hadapan',
      roadworks: 'Kerja jalan di hadapan',
      flooding: 'Banjir dilaporkan di hadapan',
      weather: 'Cuaca buruk di hadapan',
      hazard: 'Bahaya di jalan di hadapan',
      breakdown: 'Kenderaan rosak di hadapan',
      other: 'Insiden trafik di hadapan',
    };
    return `${what[i.kind]}, dalam ${d}.${m >= 2 ? ` Lewat kira-kira ${m} minit.` : ''}`;
  }
  if (lang === 'ja') {
    const what: Record<IncidentKind, string> = {
      accident: '事故があります',
      jam: '渋滞しています',
      closure: '通行止めです',
      laneClosed: '車線規制があります',
      roadworks: '工事をしています',
      flooding: '冠水の情報があります',
      weather: '悪天候の情報があります',
      hazard: '路上に危険があります',
      breakdown: '故障車がいます',
      other: '交通障害があります',
    };
    return `${d}先、${what[i.kind]}。${m >= 2 ? `約${m}分の遅れが見込まれます。` : ''}`;
  }
  const what: Record<IncidentKind, string> = {
    accident: 'Accident ahead',
    jam: 'Slow traffic ahead',
    closure: 'Road closed ahead',
    laneClosed: 'Lane closed ahead',
    roadworks: 'Roadworks ahead',
    flooding: 'Flooding reported ahead',
    weather: 'Bad weather ahead',
    hazard: 'Hazard on the road ahead',
    breakdown: 'Broken-down vehicle ahead',
    other: 'Traffic incident ahead',
  };
  return `${what[i.kind]}, in ${d}.${m >= 2 ? ` About ${m} minutes' delay.` : ''}`;
}

/** "A faster route is available, saving 7 minutes." */
export function fasterSpeech(save: number, lang: LangCode): string {
  const m = minutes(save);
  if (lang === 'ms') return `Laluan lebih pantas tersedia, jimat ${m} minit.`;
  if (lang === 'ja') return `${m}分早く着くルートがあります。`;
  return `A faster route is available, saving ${m} minutes.`;
}

/* ------------------------------------------------------------------ the traffic voice guide */

/** At the start of a drive: what traffic adds, and when you arrive. */
export function summarySpeech(delay: number, clock: string, lang: LangCode): string {
  const m = Math.round(delay / 60);
  if (lang === 'ms') return m >= 2 ? `Trafik di laluan anda menambah kira-kira ${m} minit. Tiba pada ${clock}.` : `Tiada kelewatan trafik di laluan anda. Tiba pada ${clock}.`;
  if (lang === 'ja') return m >= 2 ? `ルート上の渋滞で約${m}分遅れます。到着は${clock}の予定です。` : `ルート上に渋滞はありません。到着は${clock}の予定です。`;
  return m >= 2 ? `Traffic on your route adds about ${m} minutes. Arriving at ${clock}.` : `No traffic delays on your route. Arriving at ${clock}.`;
}

/** The short reminder when the trouble is close: "Slow traffic in 400 metres." */
export function nearSpeech(kind: IncidentKind, dist: number, lang: LangCode, units: Units): string {
  const d = LANGS[lang].spokenDistance(dist, units);
  if (lang === 'ms') return `${KINDS.ms[kind]} dalam ${d}.`;
  if (lang === 'ja') return `${d}先、${KINDS.ja[kind]}です。`;
  return `${KINDS.en[kind]} in ${d}.`;
}

/** Through the slow stretch. */
export function clearSpeech(lang: LangCode): string {
  if (lang === 'ms') return 'Trafik kembali lancar.';
  if (lang === 'ja') return '渋滞を抜けました。';
  return 'Traffic is clearing.';
}

/** The traffic delay changed: the new arrival time, and how much later or earlier. */
export function etaChangeSpeech(change: number, clock: string, lang: LangCode): string {
  const m = Math.max(1, Math.round(Math.abs(change) / 60));
  const later = change > 0;
  if (lang === 'ms') return `Kemas kini trafik: tiba pada ${clock}, ${m} minit ${later ? 'lewat' : 'lebih awal'}.`;
  if (lang === 'ja') return `交通情報の更新です。到着は${clock}、${m}分${later ? '遅く' : '早く'}なります。`;
  return `Traffic update: arriving at ${clock}, ${m} minutes ${later ? 'later' : 'earlier'}.`;
}

/** Malay or English, for headlines (the feed has both). */
export function headlineLang(title: string): LangCode {
  return /\b(di|dan|ke|kemalangan|kesesakan|lebuhraya|ditutup|penutupan|banjir|lencongan|arah|selepas|berhampiran|akibat|kenderaan|lori|susulan)\b/i.test(title) ? 'ms' : 'en';
}

/**
 * News naming a road on the route: the headline itself when it is in the language the app
 * speaks, else which road it is about.
 */
export function newsSpeech(title: string, road: string, lang: LangCode): string {
  const own = lang !== 'ja' && headlineLang(title) === lang;
  const t = title.replace(/\s+/g, ' ').trim().replace(/[.!?]?$/, '.');
  if (lang === 'ms') return own ? `Berita trafik di laluan anda: ${t}` : `Ada berita trafik tentang ${road} di laluan anda.`;
  if (lang === 'ja') return `ルート上の${road}について交通ニュースがあります。`;
  return own ? `Traffic news on your route: ${t}` : `There is traffic news about ${road} on your route.`;
}
