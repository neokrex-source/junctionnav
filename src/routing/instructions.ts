import type { LaneState } from '../nav/lanes';
import type { TollPay, TollState } from '../nav/tolls';
import type { SpeedPrompt } from '../nav/speedWatch';
import { tunnelName, type TunnelSpan, type TunnelState } from '../nav/tunnels';
import { parseDestinations, splitRefs, type Modifier, type Step } from './types';

export type LangCode = 'en' | 'ms' | 'ja';
export type Units = 'metric' | 'imperial';
type Side = 'left' | 'right';

type Kind =
  | 'depart'
  | 'arrive'
  | 'arriveSide'
  | 'waypoint'
  | 'turn'
  | 'uturn'
  | 'continue'
  | 'keep'
  | 'ramp'
  | 'exit'
  | 'merge'
  | 'roundabout'
  | 'roundaboutExit'
  | 'endOfRoad';

interface Parts {
  dir?: Modifier;
  side?: Side;
  road?: string;
  toward?: string;
  exit?: string;
  n?: number;
  cardinal?: number;
}

export type UiKey =
  | 'search'
  | 'searchHere'
  | 'from'
  | 'to'
  | 'myLocation'
  | 'start'
  | 'simulate'
  | 'demo'
  | 'klDrives'
  | 'end'
  | 'avoidTolls'
  | 'avoidHighways'
  | 'avoidFerries'
  | 'recenter'
  | 'arrival'
  | 'settings'
  | 'rerouting'
  | 'junction'
  | 'directions'
  | 'addStop'
  | 'stop'
  | 'fastest'
  | 'shortest'
  | 'tollFree'
  | 'alternative'
  | 'toll'
  | 'tollKm'
  | 'noTolls'
  | 'steps'
  | 'routes'
  | 'home'
  | 'work'
  | 'setHome'
  | 'setWork'
  | 'save'
  | 'saved'
  | 'recent'
  | 'nearby'
  | 'alongRoute'
  | 'addAsStop'
  | 'goHere'
  | 'noResults'
  | 'preview'
  | 'copy'
  | 'copied'
  | 'cat_fuel'
  | 'cat_ev'
  | 'cat_parking'
  | 'cat_food'
  | 'cat_rest'
  | 'cat_store'
  | 'arrive'
  | 'finding'
  | 'junctionViews'
  | 'via'
  | 'close'
  | 'back'
  | 'droppedPin'
  | 'inDist'
  | 'offRoute'
  | 'searching'
  | 'remaining'
  | 'options'
  | 'pin'
  | 'pinNew'
  | 'placePin'
  | 'pinHint'
  | 'chooseOnMap'
  | 'heading'
  | 'anyDirection'
  | 'turnByHand'
  | 'headingTo'
  | 'headingHint'
  | 'movePin'
  | 'editHeading'
  | 'removePin'
  | 'pinRemoved'
  | 'setStart'
  | 'setDest'
  | 'setStop'
  | 'savePin'
  | 'cancel'
  | 'arriveHeading';

interface LangPack {
  speechLang: string;
  dir: Record<Modifier, string>;
  side: Record<Side, string>;
  cardinal: string[];
  build(kind: Kind, p: Parts): string;
  spokenDistance(m: number, units: Units): string;
  inDistance(d: string, text: string): string;
  now(text: string): string;
  then: string;
  ui: Record<UiKey, string>;
}

const CARD_EN = ['north', 'northeast', 'east', 'southeast', 'south', 'southwest', 'west', 'northwest'];

const en: LangPack = {
  speechLang: 'en-GB',
  dir: {
    uturn: 'U-turn',
    'sharp right': 'sharp right',
    right: 'right',
    'slight right': 'slight right',
    straight: 'straight',
    'slight left': 'slight left',
    left: 'left',
    'sharp left': 'sharp left',
  },
  side: { left: 'left', right: 'right' },
  cardinal: CARD_EN,
  build(kind, p) {
    const onto = p.road ? ` onto ${p.road}` : '';
    const toward = p.toward ? ` toward ${p.toward}` : onto;
    const side = p.side ? ` on the ${p.side}` : '';
    switch (kind) {
      case 'depart':
        return `Head ${CARD_EN[p.cardinal ?? 0]}${onto}`;
      case 'arrive':
        return 'You have arrived at your destination';
      case 'arriveSide':
        return `Your destination is on the ${p.side}`;
      case 'waypoint':
        return `You have reached stop ${p.n ?? 1}`;
      case 'turn':
        if (p.dir === 'straight') return `Go straight${toward}`;
        // A slight turn is a bear: "Bear left onto Jalan Ampang".
        if (p.dir === 'slight left' || p.dir === 'slight right') return `Bear ${p.dir.slice(7)}${onto || toward}`;
        return `Turn ${this.dir[p.dir ?? 'straight']}${onto || toward}`;
      case 'uturn':
        return `Make a U-turn${onto}`;
      case 'continue':
        return `Continue${p.dir && p.dir !== 'straight' ? ' ' + this.dir[p.dir] : ''}${onto || toward}`;
      case 'keep':
        return `Keep ${p.side ?? 'straight'}${toward}`;
      case 'ramp':
        return `Take the ramp${side}${toward}`;
      case 'exit':
        return p.exit ? `Take exit ${p.exit}${side}${toward}` : `Take the exit${side}${toward}`;
      case 'merge':
        return `Merge${p.side ? ' ' + p.side : ''}${onto || toward}`;
      case 'roundabout':
        return `At the roundabout, take the ${ordinalEn(p.n ?? 1)} exit${onto}`;
      case 'roundaboutExit':
        return `Exit the roundabout${onto}`;
      case 'endOfRoad':
        return `At the end of the road, turn ${this.dir[p.dir ?? 'right']}${onto || toward}`;
    }
  },
  spokenDistance(m, units) {
    if (units === 'imperial') {
      const mi = m / 1609.344;
      if (mi < 0.2) return `${Math.round((m * 3.28084) / 50) * 50} feet`;
      const v = mi < 1 ? Math.round(mi * 4) / 4 : Math.round(mi * 10) / 10;
      return `${v} ${v === 1 ? 'mile' : 'miles'}`;
    }
    // 960 m rounds to a kilometre, said as one.
    if (roundNice(m) < 1000) return `${roundNice(m)} metres`;
    const km = Math.round(m / 100) / 10;
    return `${km} ${km === 1 ? 'kilometre' : 'kilometres'}`;
  },
  inDistance: (d, t) => `In ${d}, ${lowerFirst(t)}`,
  now: (t) => t,
  then: 'Then',
  ui: {
    search: "Search places",
    searchHere: "Search here",
    from: "From",
    to: "To",
    myLocation: "My location",
    start: "Start",
    simulate: "Simulate",
    demo: "Demo drive",
    klDrives: "KL test drives",
    end: "End",
    avoidTolls: "Avoid tolls",
    avoidHighways: "Avoid highways",
    avoidFerries: "Avoid ferries",
    recenter: "Re-centre",
    arrival: "arrival",
    settings: "Settings",
    rerouting: "Rerouting…",
    junction: "Junction view",
    directions: "Directions",
    addStop: "Add stop",
    stop: "Stop",
    fastest: "Fastest",
    shortest: "Shorter",
    tollFree: "Toll-free",
    alternative: "Alternative",
    toll: "Toll",
    tollKm: "{d} on toll roads",
    noTolls: "No tolls",
    steps: "Steps",
    routes: "Routes",
    home: "Home",
    work: "Work",
    setHome: "Set as Home",
    setWork: "Set as Work",
    save: "Save",
    saved: "Saved",
    recent: "Recent",
    nearby: "Nearby",
    alongRoute: "Along route",
    addAsStop: "Add as stop",
    goHere: "Go here",
    noResults: "Nothing found here",
    preview: "Preview",
    copy: "Copy coordinates",
    copied: "Coordinates copied",
    cat_fuel: "Petrol",
    cat_ev: "EV charging",
    cat_parking: "Parking",
    cat_food: "Food",
    cat_rest: "Rest area",
    cat_store: "Convenience store",
    arrive: "Arrive",
    finding: "Finding routes…",
    junctionViews: "junction views",
    via: "via",
    close: "Close",
    back: "Back",
    droppedPin: "Dropped pin",
    inDist: "in {d}",
    offRoute: "{d} off route",
    searching: "Searching…",
    remaining: "Remaining steps",
    options: "Options",
    pin: "Pin",
    pinNew: "Drop a pin",
    placePin: "Place pin",
    pinHint: "Move the map or tap where it goes",
    chooseOnMap: "Choose on map",
    heading: "Direction of travel",
    anyDirection: "Any direction",
    turnByHand: "Turn by hand",
    headingTo: "Heading {dir}",
    headingHint: "Drag the ring to turn the arrow",
    movePin: "Move",
    editHeading: "Direction",
    removePin: "Remove pin",
    pinRemoved: "Pin removed",
    setStart: "Set as start",
    setDest: "Set as destination",
    setStop: "Set as stop {n}",
    savePin: "Save pin",
    cancel: "Cancel",
    arriveHeading: "Arriving heading {dir}",
  },
};

const CARD_MS = ['utara', 'timur laut', 'timur', 'tenggara', 'selatan', 'barat daya', 'barat', 'barat laut'];

const ms: LangPack = {
  speechLang: 'ms-MY',
  dir: {
    uturn: 'pusing U',
    'sharp right': 'tajam ke kanan',
    right: 'kanan',
    'slight right': 'serong ke kanan',
    straight: 'terus',
    'slight left': 'serong ke kiri',
    left: 'kiri',
    'sharp left': 'tajam ke kiri',
  },
  side: { left: 'kiri', right: 'kanan' },
  cardinal: CARD_MS,
  build(kind, p) {
    const onto = p.road ? ` ke ${p.road}` : '';
    const toward = p.toward ? ` menghala ke ${p.toward}` : onto;
    const side = p.side ? ` di sebelah ${this.side[p.side]}` : '';
    switch (kind) {
      case 'depart':
        return `Bergerak ke arah ${CARD_MS[p.cardinal ?? 0]}${onto}`;
      case 'arrive':
        return 'Anda telah tiba di destinasi';
      case 'arriveSide':
        return `Destinasi anda di sebelah ${this.side[p.side ?? 'left']}`;
      case 'waypoint':
        return `Anda telah tiba di hentian ${p.n ?? 1}`;
      case 'turn':
        return p.dir === 'straight' ? `Terus${toward}` : `Belok ${this.dir[p.dir ?? 'straight']}${onto || toward}`;
      case 'uturn':
        return `Buat pusingan U${onto}`;
      case 'continue':
        return `Teruskan${p.dir && p.dir !== 'straight' ? ' ' + this.dir[p.dir] : ''}${onto || toward}`;
      case 'keep':
        return `Kekal di sebelah ${this.side[p.side ?? 'left']}${toward}`;
      case 'ramp':
        return `Ambil susur masuk${side}${toward}`;
      case 'exit':
        return p.exit ? `Ambil susur keluar ${p.exit}${side}${toward}` : `Ambil susur keluar${side}${toward}`;
      case 'merge':
        return `Bergabung${onto || toward}`;
      case 'roundabout':
        return `Di bulatan, ambil susur keluar ke-${p.n ?? 1}${onto}`;
      case 'roundaboutExit':
        return `Keluar dari bulatan${onto}`;
      case 'endOfRoad':
        return `Di hujung jalan, belok ${this.dir[p.dir ?? 'right']}${onto || toward}`;
    }
  },
  spokenDistance(m) {
    if (roundNice(m) < 1000) return `${roundNice(m)} meter`;
    return `${(Math.round(m / 100) / 10).toString().replace('.', ' perpuluhan ')} kilometer`;
  },
  inDistance: (d, t) => `Dalam ${d}, ${lowerFirst(t)}`,
  now: (t) => t,
  then: 'Kemudian',
  ui: {
    search: "Cari tempat",
    searchHere: "Cari di sini",
    from: "Dari",
    to: "Ke",
    myLocation: "Lokasi saya",
    start: "Mula",
    simulate: "Simulasi",
    demo: "Pandu demo",
    klDrives: "Pandu uji KL",
    end: "Tamat",
    avoidTolls: "Elak tol",
    avoidHighways: "Elak lebuh raya",
    avoidFerries: "Elak feri",
    recenter: "Pusatkan",
    arrival: "tiba",
    settings: "Tetapan",
    rerouting: "Mencari laluan baharu…",
    junction: "Paparan simpang",
    directions: "Arah",
    addStop: "Tambah hentian",
    stop: "Hentian",
    fastest: "Terpantas",
    shortest: "Lebih pendek",
    tollFree: "Tanpa tol",
    alternative: "Alternatif",
    toll: "Tol",
    tollKm: "{d} jalan bertol",
    noTolls: "Tiada tol",
    steps: "Langkah",
    routes: "Laluan",
    home: "Rumah",
    work: "Tempat kerja",
    setHome: "Jadikan Rumah",
    setWork: "Jadikan Tempat kerja",
    save: "Simpan",
    saved: "Disimpan",
    recent: "Terkini",
    nearby: "Berdekatan",
    alongRoute: "Sepanjang laluan",
    addAsStop: "Tambah sebagai hentian",
    goHere: "Pergi ke sini",
    noResults: "Tiada hasil di sini",
    preview: "Pratonton",
    copy: "Salin koordinat",
    copied: "Koordinat disalin",
    cat_fuel: "Petrol",
    cat_ev: "Pengecas EV",
    cat_parking: "Parkir",
    cat_food: "Makanan",
    cat_rest: "R&R",
    cat_store: "Kedai serbaneka",
    arrive: "Tiba",
    finding: "Mencari laluan…",
    junctionViews: "paparan simpang",
    via: "melalui",
    close: "Tutup",
    back: "Kembali",
    droppedPin: "Pin dijatuhkan",
    inDist: "dalam {d}",
    offRoute: "{d} dari laluan",
    searching: "Mencari…",
    remaining: "Langkah seterusnya",
    options: "Pilihan",
    pin: "Pin",
    pinNew: "Letak pin",
    placePin: "Letak pin",
    pinHint: "Gerakkan peta atau ketik di lokasinya",
    chooseOnMap: "Pilih pada peta",
    heading: "Arah perjalanan",
    anyDirection: "Mana-mana arah",
    turnByHand: "Pusing sendiri",
    headingTo: "Menghala ke {dir}",
    headingHint: "Seret gelang untuk memusing anak panah",
    movePin: "Alih",
    editHeading: "Arah",
    removePin: "Buang pin",
    pinRemoved: "Pin dibuang",
    setStart: "Jadikan titik mula",
    setDest: "Jadikan destinasi",
    setStop: "Jadikan hentian {n}",
    savePin: "Simpan pin",
    cancel: "Batal",
    arriveHeading: "Tiba menghala ke {dir}",
  },
};

const CARD_JA = ['北', '北東', '東', '南東', '南', '南西', '西', '北西'];

const ja: LangPack = {
  speechLang: 'ja-JP',
  dir: {
    uturn: 'Uターン',
    'sharp right': '大きく右',
    right: '右折',
    'slight right': '斜め右',
    straight: '直進',
    'slight left': '斜め左',
    left: '左折',
    'sharp left': '大きく左',
  },
  side: { left: '左', right: '右' },
  cardinal: CARD_JA,
  build(kind, p) {
    const pre = p.toward ? `${p.toward}方面、` : p.road ? `${p.road}、` : '';
    const side = p.side ? `${this.side[p.side]}方向、` : '';
    switch (kind) {
      case 'depart':
        return `${CARD_JA[p.cardinal ?? 0]}方向に出発します`;
      case 'arrive':
        return '目的地に到着しました';
      case 'arriveSide':
        return `目的地は${this.side[p.side ?? 'left']}側です`;
      case 'waypoint':
        return `経由地${p.n ?? 1}に到着しました`;
      case 'turn':
        return `${pre}${this.dir[p.dir ?? 'straight']}です`;
      case 'uturn':
        return 'Uターンです';
      case 'continue':
        return `${pre}道なりです`;
      case 'keep':
        return `${pre}${this.side[p.side ?? 'left']}方向です`;
      case 'ramp':
        return `${pre}${side}入口です`;
      case 'exit':
        return `${pre}${side}出口です`;
      case 'merge':
        return `${p.road ? p.road + 'に' : ''}合流です`;
      case 'roundabout':
        return `ロータリーを${p.n ?? 1}番目の出口です`;
      case 'roundaboutExit':
        return 'ロータリーを出ます';
      case 'endOfRoad':
        return `突き当たりを${this.dir[p.dir ?? 'right']}です`;
    }
  },
  spokenDistance(m) {
    if (roundNice(m) < 1000) return `${roundNice(m)}メートル`;
    return `${Math.round(m / 100) / 10}キロ`;
  },
  inDistance: (d, t) => `${d}先、${t}`,
  now: (t) => `まもなく、${t}`,
  then: 'その先',
  ui: {
    search: "場所を検索",
    searchHere: "この付近を検索",
    from: "出発地",
    to: "目的地",
    myLocation: "現在地",
    start: "案内開始",
    simulate: "シミュレーション",
    demo: "デモ走行",
    klDrives: "KLテスト走行",
    end: "終了",
    avoidTolls: "有料道路を避ける",
    avoidHighways: "高速道路を避ける",
    avoidFerries: "フェリーを避ける",
    recenter: "現在地に戻る",
    arrival: "到着",
    settings: "設定",
    rerouting: "ルート再検索中…",
    junction: "分岐拡大図",
    directions: "ルート",
    addStop: "経由地を追加",
    stop: "経由地",
    fastest: "最速",
    shortest: "距離優先",
    tollFree: "有料道路なし",
    alternative: "別ルート",
    toll: "有料",
    tollKm: "有料区間 {d}",
    noTolls: "有料区間なし",
    steps: "案内一覧",
    routes: "ルート候補",
    home: "自宅",
    work: "勤務先",
    setHome: "自宅に設定",
    setWork: "勤務先に設定",
    save: "保存",
    saved: "保存済み",
    recent: "履歴",
    nearby: "周辺",
    alongRoute: "ルート沿い",
    addAsStop: "経由地に追加",
    goHere: "ここへ行く",
    noResults: "見つかりませんでした",
    preview: "プレビュー",
    copy: "座標をコピー",
    copied: "座標をコピーしました",
    cat_fuel: "ガソリン",
    cat_ev: "EV充電",
    cat_parking: "駐車場",
    cat_food: "飲食店",
    cat_rest: "SA・PA",
    cat_store: "コンビニ",
    arrive: "到着",
    finding: "ルート検索中…",
    junctionViews: "分岐拡大図",
    via: "経由",
    close: "閉じる",
    back: "戻る",
    droppedPin: "ドロップしたピン",
    inDist: "{d}先",
    offRoute: "ルートから{d}",
    searching: "検索中…",
    remaining: "この先の案内",
    options: "条件",
    pin: "ピン",
    pinNew: "ピンを置く",
    placePin: "ピンを置く",
    pinHint: "地図を動かすか、置く場所をタップ",
    chooseOnMap: "地図で選ぶ",
    heading: "進行方向",
    anyDirection: "指定なし",
    turnByHand: "手動で回す",
    headingTo: "{dir}向き",
    headingHint: "リングをドラッグして矢印を回す",
    movePin: "移動",
    editHeading: "方向",
    removePin: "ピンを削除",
    pinRemoved: "ピンを削除しました",
    setStart: "出発地に設定",
    setDest: "目的地に設定",
    setStop: "経由地{n}に設定",
    savePin: "ピンを保存",
    cancel: "キャンセル",
    arriveHeading: "{dir}向きで到着",
  },
};

export const LANGS: Record<LangCode, LangPack> = { en, ms, ja };

function ordinalEn(n: number): string {
  const s = ['th', 'st', 'nd', 'rd'];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
function roundNice(m: number): number {
  if (m < 100) return Math.max(10, Math.round(m / 10) * 10);
  if (m < 500) return Math.round(m / 50) * 50;
  return Math.round(m / 100) * 100;
}
function lowerFirst(t: string): string {
  return t ? t[0].toLowerCase() + t.slice(1) : t;
}

export function formatDistance(m: number, units: Units = 'metric'): string {
  if (units === 'imperial') {
    const ft = m * 3.28084;
    if (ft < 1000) return `${Math.max(10, Math.round(ft / 10) * 10)} ft`;
    const mi = m / 1609.344;
    return `${mi < 10 ? mi.toFixed(1) : Math.round(mi)} mi`;
  }
  if (roundNice(m) < 1000) return `${roundNice(m)} m`;
  const km = m / 1000;
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

/** A short time to the next maneuver: "25 s" (in fives), "4 min", "1 h 5 min". */
export function formatShortTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return '';
  if (sec < 57.5) return `${Math.max(5, Math.round(sec / 5) * 5)} s`;
  return formatDuration(sec);
}

export function formatDuration(sec: number): string {
  const min = Math.round(sec / 60);
  if (min < 60) return `${Math.max(1, min)} min`;
  const h = Math.floor(min / 60);
  return `${h} h ${min % 60} min`;
}

export interface StepText {
  /** Big line: where you are heading (destination, road). */
  primary: string;
  /** The action ("Take exit 114 on the left"). */
  action: string;
  exitRef?: string;
  refs: string[];
  /** Full sentence for speech without distance prefix. */
  speech: string;
}

function sideOf(m?: Modifier): Side | undefined {
  if (!m) return undefined;
  if (m.includes('left')) return 'left';
  if (m.includes('right')) return 'right';
  return undefined;
}

export function roadLabel(step: Pick<Step, 'name' | 'ref'>): string {
  const refs = splitRefs(step.ref);
  if (step.name && refs.length) return `${refs[0]} ${step.name}`;
  return step.name || refs[0] || '';
}

export function describeStep(step: Step, lang: LangCode): StepText {
  const L = LANGS[lang];
  const dest = parseDestinations(step.destinations);
  const toward = dest.places.slice(0, 2).join(' / ') || dest.refs.slice(0, 2).join(' / ');
  const road = step.name || splitRefs(step.ref)[0] || '';
  const refs = dest.refs.length ? dest.refs : splitRefs(step.ref);
  const side = sideOf(step.modifier);
  const exitRef = step.exits?.split(';')[0];
  let kind: Kind;
  const parts: Parts = { dir: step.modifier, side, road, toward: toward || undefined };
  switch (step.type) {
    case 'depart':
      kind = 'depart';
      parts.cardinal = Math.round(step.bearingAfter / 45) % 8;
      break;
    case 'arrive':
      kind = step.waypoint ? 'waypoint' : side ? 'arriveSide' : 'arrive';
      parts.n = step.waypoint;
      break;
    case 'off ramp':
      kind = 'exit';
      parts.exit = exitRef;
      break;
    case 'on ramp':
      kind = 'ramp';
      break;
    case 'fork':
      kind = 'keep';
      break;
    case 'merge':
      kind = 'merge';
      break;
    case 'end of road':
      kind = 'endOfRoad';
      break;
    case 'roundabout':
    case 'rotary':
      kind = 'roundabout';
      parts.n = step.exit;
      if (step.rotaryName) parts.road = parts.road || step.rotaryName;
      break;
    case 'exit roundabout':
    case 'exit rotary':
      kind = 'roundaboutExit';
      break;
    case 'continue':
    case 'new name':
      kind = step.modifier?.startsWith('slight') ? 'keep' : 'continue';
      break;
    default:
      kind = step.modifier === 'uturn' ? 'uturn' : 'turn';
  }
  const action = L.build(kind, kind === 'keep' || kind === 'exit' || kind === 'ramp' ? parts : { ...parts, toward: parts.road ? undefined : parts.toward });
  const primary = toward || roadLabel(step) || action;
  return { primary, action, exitRef, refs, speech: action };
}

export function spokenInstruction(step: Step, distance: number | null, lang: LangCode, units: Units): string {
  const L = LANGS[lang];
  const t = describeStep(step, lang).speech;
  if (distance == null) return L.now(t);
  return L.inDistance(L.spokenDistance(distance, units), t);
}

/** UI string with {d}-style placeholders filled in. */
export function t(lang: LangCode, key: UiKey, vars: Record<string, string> = {}): string {
  return LANGS[lang].ui[key].replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
}

/* ------------------------------------------------------------------ lane advice phrases */


export type LanePhraseKind = 'hint' | 'early' | 'wrong' | 'late' | 'cue';

function laneWhat(l: LaneState, lang: LangCode): string {
  const step = l.target.step;
  const ref = step.exits?.split(';')[0];
  const turnSide = step.modifier?.includes('left') ? 'left' : 'right';
  const tbl: Record<LangCode, Record<string, string>> = {
    en: { exit: ref ? `Exit ${ref}` : 'The exit', ramp: 'The entrance', junction: 'The junction', turn: `Your ${turnSide} turn`, split: 'The split' },
    ms: { exit: ref ? `Susur keluar ${ref}` : 'Susur keluar', ramp: 'Susur masuk', junction: 'Persimpangan', turn: `Belokan ${turnSide === 'left' ? 'kiri' : 'kanan'}`, split: 'Pecahan jalan' },
    ja: { exit: '出口', ramp: '入口', junction: '分岐', turn: turnSide === 'left' ? '左折' : '右折', split: '分岐' },
  };
  return tbl[lang][l.target.label];
}

/** "the left lane", "the right 2 lanes", "the middle lane" in each language. */
function laneGroup(l: LaneState, lang: LangCode): string {
  const t = l.target;
  const k = t.to - t.from + 1;
  const side = t.side;
  if (lang === 'ms') {
    const sd = side === 'left' ? 'kiri' : side === 'right' ? 'kanan' : 'tengah';
    return k === 1 ? `lorong ${sd}` : `${k} lorong ${sd}`;
  }
  if (lang === 'ja') {
    const sd = side === 'left' ? '左' : side === 'right' ? '右' : '中央';
    return k === 1 ? `${sd}車線` : `${sd}側${k}車線`;
  }
  return k === 1 ? `the ${side} lane` : `the ${side} ${k} lanes`;
}

/** Text for lane advice: spoken hints, early advice, wrong-lane and too-late notes, and the short on-screen cue. */
export function lanePhrase(kind: LanePhraseKind, l: LaneState, lang: LangCode, units: Units): string {
  const what = laneWhat(l, lang);
  const group = laneGroup(l, lang);
  const known = l.target.known;
  const dir = l.move ?? (l.target.side === 'middle' ? null : l.target.side);
  const n = Math.max(1, l.changes);
  const d = LANGS[lang].spokenDistance(l.dist, units);
  const cueDist = formatDistance(l.dist, units);
  // Still before a tunnel that lies between us and the maneuver: change lanes before it.
  const vt = l.target.viaTunnel;
  const preTunnel = !!vt && l.target.step.s - l.dist < vt.fromS - 10;
  if (lang === 'ms') {
    const arah = dir === 'left' ? 'kiri' : 'kanan';
    switch (kind) {
      case 'hint':
        if (preTunnel) return known ? `Gunakan ${group} sebelum terowong.` : `Kekal di sebelah ${arah} sebelum terowong.`;
        return known ? `Gunakan ${group}.` : `Kekal di sebelah ${arah}.`;
      case 'early':
        if (preTunnel) return `${what} dalam ${d}, selepas terowong. ${known ? `Masuk ke ${group} sebelum terowong.` : `Mula bergerak ke ${arah} sebelum terowong.`}`;
        return `${what} dalam ${d}. ${known ? `Masuk ke ${group}.` : `Mula bergerak ke ${arah}.`}`;
      case 'wrong':
        return `Anda bukan di lorong yang betul untuk ${what.toLowerCase()}. Beralih ${n} lorong ke ${arah}.`;
      case 'late':
        return 'Jika tidak selamat untuk menukar lorong, kekal di lorong anda. Laluan akan dikemas kini.';
      case 'cue':
        if (l.status === 'ok') return 'Anda di lorong yang betul';
        if (l.status === 'late') return 'Kekal di lorong jika tidak selamat';
        if (l.status === 'wrong') return `Beralih ${n} lorong ke ${arah} · ${cueDist}`;
        return known ? `Gunakan ${group} · ${cueDist}` : `Kekal di ${arah} · ${cueDist}`;
    }
  }
  if (lang === 'ja') {
    const hou = dir === 'left' ? '左' : '右';
    switch (kind) {
      case 'hint':
        if (preTunnel) return known ? `トンネルの手前で${group}に移動してください。` : `トンネルの手前で${hou}側へ寄ってください。`;
        return known ? `${group}を走行してください。` : `${hou}寄りを走行してください。`;
      case 'early':
        if (preTunnel) return `${d}先、トンネルを出た先で${what}です。${known ? `トンネルの手前で${group}に移動してください。` : `トンネルの手前で${hou}側へ寄ってください。`}`;
        return `${d}先、${what}です。${known ? `${group}に移動してください。` : `${hou}側へ寄ってください。`}`;
      case 'wrong':
        return `${what}の車線ではありません。${hou}へ${n}車線移動してください。`;
      case 'late':
        return '安全に車線変更できない場合は、そのまま走行してください。ルートを再検索します。';
      case 'cue':
        if (l.status === 'ok') return '正しい車線を走行中';
        if (l.status === 'late') return '無理な車線変更はしないでください';
        if (l.status === 'wrong') return `${hou}へ${n}車線移動 · ${cueDist}`;
        return known ? `${group}へ · ${cueDist}` : `${hou}寄り · ${cueDist}`;
    }
  }
  switch (kind) {
    case 'hint':
      if (preTunnel) return known ? `Use ${group} before the tunnel.` : `Keep ${dir} before the tunnel.`;
      return known ? `Use ${group}.` : `Keep ${dir}.`;
    case 'early':
      if (preTunnel) return `${what} in ${d}, after the tunnel. ${known ? `Move to ${group} before the tunnel.` : `Start moving ${dir} before the tunnel.`}`;
      return `${what} in ${d}. ${known ? `Move to ${group}.` : `Start moving ${dir}.`}`;
    case 'wrong':
      return `You're not in a lane for ${what.charAt(0).toLowerCase() + what.slice(1)}. Move ${n === 1 ? 'one lane' : `${n} lanes`} to the ${dir}.`;
    case 'late':
      return "If you can't change lanes safely, stay in your lane. The route will update.";
    case 'cue':
      if (l.status === 'ok') return "You're in a correct lane";
      if (l.status === 'late') return 'Stay in lane if moving is not safe';
      if (l.status === 'wrong') return `Move ${n === 1 ? 'one lane' : `${n} lanes`} ${dir} · ${cueDist}`;
      return known ? `Use ${group} · ${cueDist}` : `Keep ${dir} · ${cueDist}`;
  }
}

/** Two spoken sentences as one prompt, with the full stop each language wants between them. */
export function joinSpeech(a: string, b: string, lang: LangCode): string {
  if (!b) return a;
  if (lang === 'ja') return /[。！？]$/.test(a) ? `${a}${b}` : `${a}。${b}`;
  return /[.!?]$/.test(a) ? `${a} ${b}` : `${a}. ${b}`;
}

/** Said after the first heads-up of a turn the router gave no lanes for. */
export function turnSidePhrase(side: 'left' | 'right', lang: LangCode): string {
  if (lang === 'ms') return `Masuk ke lorong ${side === 'left' ? 'kiri' : 'kanan'}.`;
  if (lang === 'ja') return `${side === 'left' ? '左' : '右'}車線に寄ってください。`;
  return `Move into the ${side} lane.`;
}

/* ------------------------------------------------------------------ toll plazas */

const SAYS_PLAZA = /(^|\s)(tol|toll|plaza)(\s|$)|料金/i;

/** The plaza's name as said and shown ("Plaza Tol Sungai Besi"), or the plain word for one. */
export function tollTitle(name: string | null, lang: LangCode): string {
  const n = name?.trim();
  if (!n) return lang === 'ms' ? 'Plaza tol' : lang === 'ja' ? '料金所' : 'Toll plaza';
  if (SAYS_PLAZA.test(n)) return n;
  return lang === 'ms' ? `Plaza Tol ${n}` : lang === 'ja' ? `${n}料金所` : `${n} toll plaza`;
}

/** What to have ready, for the screen ("Touch 'n Go", "ETC"), or nothing. */
export function tollPayLabel(pay: TollPay): string {
  return pay === 'tng' ? "Touch 'n Go" : pay === 'etc' ? 'ETC' : '';
}

/**
 * The toll reminders. Early: "Plaza Tol Sungai Besi in 800 metres. Get your Touch n Go card
 * ready." Near: "Toll plaza ahead. Prepare your Touch n Go." The brand is written the way speech
 * reads it best.
 */
export function tollSpeech(kind: 'early' | 'mid' | 'near', t: TollState, pay: TollPay, lang: LangCode, units: Units): string {
  const L = LANGS[lang];
  const d = L.spokenDistance(t.dist, units);
  const title = tollTitle(t.plaza.name, lang);
  if (lang === 'ms') {
    const ready = pay === 'tng' ? 'Sediakan kad Touch n Go anda.' : pay === 'etc' ? 'Pastikan kad ETC anda sedia.' : 'Sediakan bayaran tol anda.';
    if (kind === 'early') return `${title} dalam ${d}. ${ready}`;
    if (kind === 'mid') return `Plaza tol dalam ${d}. ${pay === 'tng' ? 'Perlahankan kenderaan dan ikut lorong Touch n Go.' : pay === 'etc' ? 'Perlahankan kenderaan dan ikut lorong ETC.' : 'Perlahankan kenderaan.'}`;
    return `Plaza tol di hadapan.${pay === 'tng' ? ' Sediakan Touch n Go.' : ''}`;
  }
  if (lang === 'ja') {
    const ready = pay === 'tng' ? 'Touch n Goカードをご用意ください。' : pay === 'etc' ? 'ETCカードをご確認ください。' : '通行料金のお支払いをご準備ください。';
    if (kind === 'early') return `${d}先、${title}です。${ready}`;
    if (kind === 'mid') return `${d}先、料金所です。${pay === 'tng' ? '速度を落として、Touch n Goのレーンにお進みください。' : pay === 'etc' ? '速度を落として、ETCレーンにお進みください。' : '速度を落としてください。'}`;
    return `まもなく${title}です。${pay === 'tng' ? 'Touch n Goをご用意ください。' : ''}`;
  }
  const ready = pay === 'tng' ? 'Get your Touch n Go card ready.' : pay === 'etc' ? 'Check your ETC card.' : 'Have your toll payment ready.';
  if (kind === 'early') return `${title} in ${d}. ${ready}`;
  if (kind === 'mid') return `Toll plaza in ${d}. ${pay === 'tng' ? 'Slow down and keep to the Touch n Go lanes.' : pay === 'etc' ? 'Slow down and keep to the ETC lane.' : 'Slow down for the toll plaza.'}`;
  return `Toll plaza ahead.${pay === 'tng' ? ' Prepare your Touch n Go.' : ''}`;
}

/* ------------------------------------------------------------------ speed */

/** A speed in the units of the settings (km/h, or mph). */
export function speedIn(kmh: number, units: Units): number {
  return Math.round(units === 'imperial' ? kmh / 1.609344 : kmh);
}

/**
 * The speed warnings: "Approaching the speed limit of 110." "Slow down. The speed limit is 110."
 * "Speed camera in 800 metres. Speed limit 110." "Average speed check for 12 kilometres."
 */
export function speedSpeech(p: SpeedPrompt, lang: LangCode, units: Units): string {
  const L = LANGS[lang];
  const lim = p.limit != null ? speedIn(p.limit, units) : null;
  const d = p.dist != null ? L.spokenDistance(p.dist, units) : '';
  if (lang === 'ms') {
    const had = lim != null ? ` Had laju ${lim}.` : '';
    switch (p.kind) {
      case 'speedNear':
        return `Hampir mencapai had laju ${lim}.`;
      case 'speedOver':
        return `Sila perlahankan. Had laju ${lim}.`;
      case 'camera':
        return `Kamera had laju dalam ${d}.${had}${p.over ? ' Sila perlahankan.' : ''}`;
      case 'cameraOver':
        return 'Kamera had laju di hadapan. Sila perlahankan.';
      case 'checkStart':
        return `Kawalan purata laju sejauh ${d}.${had}`;
      case 'checkEnd':
        return 'Tamat kawalan purata laju.';
    }
  }
  if (lang === 'ja') {
    const unit = units === 'imperial' ? 'マイル' : 'キロ';
    const had = lim != null ? `制限速度は${lim}${unit}です。` : '';
    switch (p.kind) {
      case 'speedNear':
        return `制限速度${lim}${unit}に近づいています。`;
      case 'speedOver':
        return `速度超過です。制限速度は${lim}${unit}です。`;
      case 'camera':
        return `${d}先、速度取締機があります。${had}${p.over ? '速度を落としてください。' : ''}`;
      case 'cameraOver':
        return 'この先、速度取締機です。速度を落としてください。';
      case 'checkStart':
        return `ここから${d}、区間速度取締りです。${had}`;
      case 'checkEnd':
        return '区間速度取締りが終わりました。';
    }
  }
  const lim2 = lim != null ? ` Speed limit ${lim}.` : '';
  switch (p.kind) {
    case 'speedNear':
      return `Approaching the speed limit of ${lim}.`;
    case 'speedOver':
      return `Slow down. The speed limit is ${lim}.`;
    case 'camera':
      return `Speed camera in ${d}.${lim2}${p.over ? ' Slow down.' : ''}`;
    case 'cameraOver':
      return 'Speed camera ahead. Slow down.';
    case 'checkStart':
      return `Average speed check for ${d}.${lim2}`;
    case 'checkEnd':
      return 'End of the average speed check.';
  }
}

/** Words on the screen for the speed camera chip and the speed sign. */
export function speedWords(lang: LangCode): { camera: string; check: string; average: string; limit: string } {
  if (lang === 'ms') return { camera: 'Kamera had laju', check: 'Kawalan purata laju', average: 'Purata laju', limit: 'Had laju' };
  if (lang === 'ja') return { camera: '速度取締機', check: '区間速度取締り', average: '平均速度', limit: '制限速度' };
  return { camera: 'Speed camera', check: 'Average speed check', average: 'Average speed', limit: 'Speed limit' };
}

/* ------------------------------------------------------------------ arrival */

/** Said once inside the arrival radius, with the side of the road when the router knows it. */
export function arrivalSpeech(lang: LangCode, side?: 'left' | 'right'): string {
  if (lang === 'ms') return `Anda telah sampai ke destinasi.${side ? ` Destinasi di sebelah ${side === 'left' ? 'kiri' : 'kanan'}.` : ''}`;
  if (lang === 'ja') return `目的地に到着しました。${side ? `目的地は${side === 'left' ? '左' : '右'}側です。` : ''}`;
  return `You have reached your destination.${side ? ` It is on your ${side}.` : ''}`;
}

/* ------------------------------------------------------------------ tunnels */

/** Spoken warning before a tunnel: distance, name, length, headlights. */
export function tunnelSpeech(t: TunnelState, lang: LangCode, units: Units): string {
  const L = LANGS[lang];
  const d = L.spokenDistance(t.dist, units);
  const len = L.spokenDistance(t.span.length, units);
  const name = tunnelName(t.span, lang);
  const long = t.span.length >= 1000;
  if (lang === 'ms') {
    return `Terowong di hadapan dalam ${d}${name ? `: ${name}` : ''}, sepanjang ${len}. Sila pasang lampu kenderaan.${long ? ' Isyarat GPS mungkin hilang di dalam terowong, panduan akan diteruskan.' : ''}`;
  }
  if (lang === 'ja') {
    return `${d}先、${name ?? 'トンネル'}です。長さは${len}です。ライトを点灯してください。${long ? 'トンネル内ではGPSが途切れることがありますが、案内は続きます。' : ''}`;
  }
  return `Tunnel ahead in ${d}${name ? `: ${name}` : ''}, ${len} long. Turn on your headlights.${long ? ' GPS may drop out inside; guidance will continue.' : ''}`;
}

export interface TunnelLabels {
  /** Generic word, used when the tunnel has no name. */
  tunnel: string;
  toTunnel: string;
  toExit: string;
  inside: string;
  noGps: string;
  lights: string;
  /** Length line on the sign plate. */
  length: (d: string) => string;
}

export function tunnelLabels(lang: LangCode): TunnelLabels {
  if (lang === 'ms') {
    return { tunnel: 'Terowong', toTunnel: 'ke terowong', toExit: 'ke pintu keluar', inside: 'Dalam terowong', noGps: 'Tiada GPS · kedudukan dianggar', lights: 'PASANG LAMPU', length: (d) => `Panjang ${d}` };
  }
  if (lang === 'ja') {
    return { tunnel: 'トンネル', toTunnel: 'トンネルまで', toExit: '出口まで', inside: 'トンネル内', noGps: 'GPS受信なし・推定位置', lights: 'ライト点灯', length: (d) => `延長 ${d}` };
  }
  return { tunnel: 'Tunnel', toTunnel: 'to tunnel', toExit: 'to exit', inside: 'In tunnel', noGps: 'No GPS · position estimated', lights: 'LIGHTS ON', length: (d) => `Length ${d}` };
}

/** Name for the sign plate: the tunnel's own name, or the generic word. */
export function tunnelTitle(span: TunnelSpan, lang: LangCode): string {
  return tunnelName(span, lang) ?? tunnelLabels(lang).tunnel;
}
