/**
 * How the voice guide speaks. "Butler" is a calm, polite personal assistant that addresses the
 * driver (sir, ma'am, their first name, or not at all) and words things the way a person would:
 * "We're coming up to the speed limit of 110, sir." "Toll plaza just ahead." "We have arrived,
 * sir. Your destination is on your left." "Plain" keeps the short, neutral prompts.
 *
 * Turn instructions keep their exact wording either way, so they stay quick to take in; the
 * butler adds the address now and then on the heads-ups, never on the "now" prompts. Everything
 * spoken goes through speechText(), which reads destinations joined by slashes as a list.
 */
import { LANGS, speedIn, tollTitle, type LangCode, type Units } from '../routing/instructions';
import type { SpeedPrompt } from '../nav/speedWatch';
import type { TollPay, TollState } from '../nav/tolls';
import { tunnelName, type TunnelState } from '../nav/tunnels';

export type VoiceStyle = 'butler' | 'plain';
export type AddressAs = 'sir' | 'maam' | 'name' | 'none';
export type Side = 'left' | 'right';

/** What the destination looks like for the greeting. */
export interface TripInfo {
  dest: string | null;
  /** Seconds. */
  duration: number;
  /** Arrival clock time, already formatted ("9:30 am"). */
  arrival: string;
  /** The route uses toll roads. */
  tolls: boolean;
  /** What pays the tolls there. */
  pay: TollPay;
}

/** Drives longer than this get the check before setting off (seconds). */
export const PRETRIP_MIN = 30 * 60;

/** A stable small number from a string, to vary wording the same way each time. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** "45 minutes", "1 hour 10 minutes"; "45 minit"; "45分", "1時間10分". */
export function spokenDuration(sec: number, lang: LangCode): string {
  const total = Math.max(1, Math.round(sec / 60));
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (lang === 'ms') return [h ? `${h} jam` : '', m ? `${m} minit` : ''].filter(Boolean).join(' ');
  if (lang === 'ja') return `${h ? `${h}時間` : ''}${m ? `${m}分` : ''}`;
  return [h ? `${h} hour${h === 1 ? '' : 's'}` : '', m ? `${m} minute${m === 1 ? '' : 's'}` : ''].filter(Boolean).join(' ');
}

/**
 * Text as it should be spoken: destinations written "Kuala Lumpur / Ipoh" are read as a list
 * ("Kuala Lumpur and Ipoh"), not "slash"; spaces tidied.
 */
export function speechText(text: string, lang: LangCode): string {
  const and = lang === 'ms' ? ' dan ' : lang === 'ja' ? '、' : ' and ';
  return text
    .replace(/\s+\/\s+/g, and)
    .replace(/\bkm\/h\b/g, lang === 'ms' ? 'kilometer sejam' : lang === 'ja' ? 'キロ' : 'kilometres per hour')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** The words on the "Before you go" card. */
export function pretripWords(lang: LangCode): { title: string; tng: string; etc: string; toll: string; fuel: string; car: string } {
  if (lang === 'ms') return { title: 'Sebelum bertolak', tng: 'Baki kad Touch n Go (laluan ini bertol)', etc: 'Kad ETC', toll: 'Bayaran tol', fuel: 'Minyak yang cukup', car: 'Tayar, lampu dan pengelap cermin' };
  if (lang === 'ja') return { title: '出発前の確認', tng: 'Touch n Goカードの残高（有料道路あり）', etc: 'ETCカード', toll: '通行料金の準備', fuel: '燃料', car: 'タイヤ、ライト、ワイパー' };
  return { title: 'Before you go', tng: 'Touch n Go balance (this route has tolls)', etc: 'ETC card', toll: 'Toll payment', fuel: 'Enough fuel', car: 'Tyres, lights and wipers' };
}

export class Persona {
  style: VoiceStyle = 'butler';
  addressAs: AddressAs = 'sir';
  /** The driver's first name, for addressing them by name. */
  name = '';
  lang: LangCode = 'en';
  units: Units = 'metric';

  get butler(): boolean {
    return this.style === 'butler';
  }

  /** How the driver is addressed: "sir", "ma'am", "Anuar"; "tuan", "puan"; "旦那様", "奥様", "Anuar様". */
  word(): string {
    if (!this.butler) return '';
    const a = this.addressAs === 'name' && !this.name.trim() ? 'none' : this.addressAs;
    if (a === 'none') return '';
    if (a === 'name') return this.lang === 'ja' ? `${this.name.trim()}様` : this.name.trim();
    if (this.lang === 'ms') return a === 'sir' ? 'tuan' : 'puan';
    if (this.lang === 'ja') return a === 'sir' ? '旦那様' : '奥様';
    return a === 'sir' ? 'sir' : 'ma’am';
  }

  /**
   * Fills a template's address marks: {,w} becomes ", sir" (nothing without an address), {W,}
   * becomes "Sir, " at the start, {w、} becomes "旦那様、" and {、w} becomes "、旦那様".
   */
  private fill(t: string): string {
    const w = this.word();
    const cap = w ? w[0].toUpperCase() + w.slice(1) : '';
    return t
      .replace(/\{,w\}/g, w ? `, ${w}` : '')
      .replace(/\{W,\}/g, w ? `${cap}, ` : '')
      .replace(/\{w、\}/g, w ? `${w}、` : '')
      .replace(/\{、w\}/g, w ? `、${w}` : '');
  }

  /**
   * The address worked into any text: after the first sentence's last word in English and Malay
   * ("Accident ahead in 2 kilometres, sir."), before it in Japanese.
   */
  address(text: string): string {
    const w = this.word();
    if (!w || !text) return text;
    if (this.lang === 'ja') return `${w}、${text}`;
    // The first sentence ends at a stop followed by a space or the end ("2.6 kilometres" goes on).
    const m = /^((?:[^.!?]|[.!?](?=\S))*?)([.!?])(\s|$)/.exec(text);
    const first = m ? m[1] : text.replace(/[.!?]?\s*$/, '');
    // "Traffic news on your route, sir: ..." rather than after the headline.
    const colon = first.indexOf(': ');
    if (colon > 0) return `${text.slice(0, colon)}, ${w}${text.slice(colon)}`;
    if (!m) return `${first}, ${w}.`;
    return `${m[1]}, ${w}${m[2]}${text.slice(m[1].length + 1)}`;
  }

  /** The address on about one heads-up in three (the same ones every time for the same key). */
  sometimes(text: string, key: string): string {
    return this.butler && hash(key) % 3 === 0 ? this.address(text) : text;
  }

  private pick<T>(xs: T[], key: string): T {
    return xs[hash(key) % xs.length];
  }

  private dist(m: number): string {
    return LANGS[this.lang].spokenDistance(m, this.units);
  }

  private sideWord(side: Side): string {
    if (this.lang === 'ms') return side === 'left' ? 'kiri' : 'kanan';
    if (this.lang === 'ja') return side === 'left' ? '左' : '右';
    return side;
  }

  /* ---------------------------------------------------------------- speed */

  speed(p: SpeedPrompt, key: string): string {
    const lim = p.limit != null ? speedIn(p.limit, this.units) : null;
    const d = p.dist != null ? this.dist(p.dist) : '';
    const L = this.lang;
    if (L === 'ms') {
      switch (p.kind) {
        case 'speedNear':
          return this.fill(`Kita hampir mencapai had laju ${lim}{,w}.`);
        case 'speedOver':
          return this.fill(this.pick([`Laju sedikit melebihi had{,w}. Had laju di sini ${lim}.`, `Perlahan sedikit{,w}. Had laju ${lim}.`], key));
        case 'camera':
          return this.fill(`Kamera laju dalam ${d}{,w}.${lim != null ? ` Had laju ${lim}.` : ''}${p.over ? ' Sila perlahankan sekarang.' : ''}`);
        case 'cameraOver':
          return this.fill(`Kamera laju di hadapan{,w}.${lim != null ? ` Sila perlahankan ke ${lim}.` : ' Sila perlahankan.'}`);
        case 'checkStart':
          return this.fill(`Kawalan purata laju bermula di sini{,w}: ${d}${lim != null ? `, had ${lim}` : ''}.`);
        case 'checkEnd':
          return 'Kawalan purata laju telah tamat.';
      }
    }
    if (L === 'ja') {
      const u = this.units === 'imperial' ? 'マイル' : 'キロ';
      switch (p.kind) {
        case 'speedNear':
          return this.fill(`{w、}まもなく制限速度の${lim}${u}です。`);
        case 'speedOver':
          return this.fill(this.pick([`{w、}少し速度が出ています。ここは${lim}${u}です。`, `{w、}速度を少し落としましょう。制限速度は${lim}${u}です。`], key));
        case 'camera':
          return this.fill(`{w、}${d}先に速度取締機があります。${lim != null ? `制限速度は${lim}${u}です。` : ''}${p.over ? '速度を落としてください。' : ''}`);
        case 'cameraOver':
          return this.fill(`{w、}まもなく速度取締機です。${lim != null ? `${lim}${u}まで` : ''}速度を落としてください。`);
        case 'checkStart':
          return this.fill(`{w、}ここから${d}、区間速度取締りです。${lim != null ? `制限速度は${lim}${u}です。` : ''}`);
        case 'checkEnd':
          return '区間速度取締りが終わりました。';
      }
    }
    switch (p.kind) {
      case 'speedNear':
        return this.fill(`We’re coming up to the speed limit of ${lim}{,w}.`);
      case 'speedOver':
        return this.fill(this.pick([`A little over the limit{,w}. It’s ${lim} here.`, `Easy on the accelerator{,w}. The limit is ${lim}.`], key));
      case 'camera':
        return this.fill(`Speed camera in ${d}{,w}.${lim != null ? ` The limit is ${lim}.` : ''}${p.over ? ' I’d ease off now.' : ''}`);
      case 'cameraOver':
        return this.fill(`Speed camera just ahead{,w}.${lim != null ? ` Please slow down to ${lim}.` : ' Please slow down.'}`);
      case 'checkStart':
        return this.fill(`An average speed check starts here{,w}: ${d}${lim != null ? ` at ${lim}` : ''}.`);
      case 'checkEnd':
        return 'That’s the end of the average speed check.';
    }
  }

  /* ---------------------------------------------------------------- tolls and tunnels */

  toll(kind: 'early' | 'mid' | 'near', t: TollState, pay: TollPay): string {
    const d = this.dist(t.dist);
    const title = tollTitle(t.plaza.name, this.lang);
    const L = this.lang;
    if (L === 'ms') {
      const ready = pay === 'tng' ? 'Sila sediakan kad Touch n Go anda.' : pay === 'etc' ? 'Sila pastikan kad ETC anda sedia.' : 'Sila sediakan bayaran tol.';
      if (kind === 'early') return this.fill(`${title} dalam ${d}{,w}. ${ready}`);
      if (kind === 'mid') return this.fill(`Plaza tol dalam ${d}. Sila perlahankan kenderaan{,w}${pay === 'tng' ? ', dan ikut lorong Touch n Go' : pay === 'etc' ? ', dan ikut lorong ETC' : ''}.`);
      return this.fill(`Plaza tol di hadapan{,w}.`);
    }
    if (L === 'ja') {
      const ready = pay === 'tng' ? 'Touch n Goカードのご用意をお願いします。' : pay === 'etc' ? 'ETCカードをご確認ください。' : '通行料金のご準備をお願いします。';
      if (kind === 'early') return this.fill(`{w、}${d}先、${title}です。${ready}`);
      if (kind === 'mid') return this.fill(`${d}先、料金所です。{w、}速度を落として${pay === 'tng' ? '、Touch n Goのレーンにお進みください。' : pay === 'etc' ? '、ETCレーンにお進みください。' : 'ください。'}`);
      return this.fill(`{w、}まもなく料金所です。`);
    }
    const ready = pay === 'tng' ? 'Please have your Touch n Go card ready.' : pay === 'etc' ? 'Please check your ETC card.' : 'Please have the toll payment ready.';
    if (kind === 'early') return this.fill(`${title} in ${d}{,w}. ${ready}`);
    if (kind === 'mid') return this.fill(`Toll plaza in ${d}. Do slow down{,w}${pay === 'tng' ? ', and keep to the Touch n Go lanes' : pay === 'etc' ? ', and keep to the ETC lane' : ''}.`);
    return this.fill(`Toll plaza just ahead{,w}.`);
  }

  tunnel(t: TunnelState): string {
    const d = this.dist(t.dist);
    const len = this.dist(t.span.length);
    const name = tunnelName(t.span, this.lang);
    const long = t.span.length >= 1000;
    const L = this.lang;
    if (L === 'ms') return this.fill(`Terowong dalam ${d}{,w}${name ? `: ${name}` : ''}, sepanjang ${len}. Sila pasang lampu.${long ? ' Jika GPS hilang di dalam, saya akan terus memberi panduan.' : ''}`);
    if (L === 'ja') return this.fill(`{w、}${d}先、${name ?? 'トンネル'}です。長さは${len}です。ライトの点灯をお願いします。${long ? 'トンネル内でGPSが途切れても、案内は続けます。' : ''}`);
    return this.fill(`A tunnel in ${d}{,w}${name ? `: ${name}` : ''}, ${len} long. Headlights on, please.${long ? ' If GPS drops out inside, I’ll keep guiding you.' : ''}`);
  }

  /* ---------------------------------------------------------------- arrival */

  arrivalNear(dist: number, side?: Side): string {
    const d = this.dist(dist);
    const L = this.lang;
    if (L === 'ms') return this.fill(`Destinasi anda ${d} di hadapan${side ? `, di sebelah ${this.sideWord(side)}` : ''}{,w}.`);
    if (L === 'ja') return this.fill(`{w、}目的地は${d}先${side ? `、${this.sideWord(side)}側` : ''}です。`);
    return this.fill(`Your destination is ${d} ahead${side ? `, on the ${side}` : ''}{,w}.`);
  }

  arrived(side?: Side): string {
    const L = this.lang;
    if (L === 'ms') return this.fill(`Kita sudah sampai{,w}.${side ? ` Destinasi di sebelah ${this.sideWord(side)}.` : ''}`);
    if (L === 'ja') return this.fill(`{w、}到着いたしました。${side ? `目的地は${this.sideWord(side)}側です。` : ''}`);
    return this.fill(`We have arrived{,w}.${side ? ` Your destination is on your ${side}.` : ''}`);
  }

  stoppedNear(dist: number): string {
    const d = this.dist(dist);
    const L = this.lang;
    if (L === 'ms') return this.fill(`Kita berhenti kira-kira ${d} dari destinasi{,w}. Saya tamatkan panduan di sini.`);
    if (L === 'ja') return this.fill(`{w、}目的地まであと約${d}の所に停車しました。案内を終了します。`);
    return this.fill(`We’ve stopped about ${d} from your destination{,w}. I’ll end the guidance here.`);
  }

  /* ---------------------------------------------------------------- setting off */

  /** "Good morning, sir. Heading to Suria KLCC: about 45 minutes, arriving around 9:30." */
  greeting(t: TripInfo, hour: number): string {
    const dur = spokenDuration(t.duration, this.lang);
    const hi = this.hello(hour);
    if (this.lang === 'ms') return this.fill(`${hi}{,w}. ${t.dest ? `Menuju ke ${t.dest}: k` : 'K'}ira-kira ${dur}, tiba sekitar ${t.arrival}.`);
    if (this.lang === 'ja') return this.fill(`${hi}{、w}。${t.dest ? `${t.dest}へ向かいます。` : ''}所要時間は約${dur}、${t.arrival}ごろ到着の予定です。`);
    return this.fill(`${hi}{,w}. ${t.dest ? `Heading to ${t.dest}: about` : 'About'} ${dur}, arriving around ${t.arrival}.`);
  }

  /** "Good morning", "Selamat pagi", "おはようございます". */
  hello(hour: number): string {
    if (this.lang === 'ms') return `Selamat ${hour >= 4 && hour < 12 ? 'pagi' : hour >= 12 && hour < 14 ? 'tengah hari' : hour >= 14 && hour < 19 ? 'petang' : 'malam'}`;
    if (this.lang === 'ja') return hour >= 4 && hour < 11 ? 'おはようございます' : hour >= 11 && hour < 18 ? 'こんにちは' : 'こんばんは';
    return `Good ${hour >= 4 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'afternoon' : 'evening'}`;
  }

  /** What Test voice in Settings says: a greeting and a turn in the butler's manner, or the turn alone. */
  sample(turn: string, hour: number): string {
    if (!this.butler) return turn;
    if (this.lang === 'ja') return this.fill(`${this.hello(hour)}{、w}。${turn}`);
    return this.fill(`${this.hello(hour)}{,w}. ${turn}`);
  }

  /** The check before a drive of more than 30 minutes: the toll card (on toll routes), the fuel, the car. */
  pretrip(t: TripInfo): string {
    const L = this.lang;
    const card = t.tolls && t.pay !== 'none';
    if (L === 'ms') {
      const items = [card ? (t.pay === 'etc' ? 'kad ETC' : t.pay === 'tng' ? 'baki kad Touch n Go' : 'bayaran tol') : '', 'minyak yang cukup', 'keadaan kereta: tayar, lampu dan pengelap cermin'].filter(Boolean);
      const list = items.length > 1 ? `${items.slice(0, -1).join(', ')}, serta ${items[items.length - 1]}` : items[0];
      return this.butler ? this.fill(`Sebelum kita memulakan perjalanan jauh ini{,w}, sila semak ${list}.`) : `Perjalanan ini agak jauh. Sebelum bertolak, semak ${list}.`;
    }
    if (L === 'ja') {
      const items = [card ? (t.pay === 'etc' ? 'ETCカード' : t.pay === 'tng' ? 'Touch n Goカードの残高' : '通行料金の準備') : '', '燃料', 'タイヤやライトなど車の状態'].filter(Boolean);
      return this.butler ? this.fill(`{w、}長めのドライブの前に、${items.join('、')}をご確認ください。`) : `長めのドライブです。出発前に${items.join('、')}を確認してください。`;
    }
    const items = [card ? (t.pay === 'etc' ? 'your ETC card' : t.pay === 'tng' ? 'your Touch n Go balance' : 'your toll payment') : '', 'that you have enough fuel', 'the car itself: tyres, lights and wipers'].filter(Boolean);
    const list = items.length > 1 ? `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}` : items[0];
    return this.butler ? this.fill(`Before we set off on a longer drive{,w}, a quick check: ${list}.`) : `This is a longer drive. Before you go, check ${list}.`;
  }

  /** Said before the first instruction of a route found after leaving the planned one. */
  newRoute(): string {
    if (!this.butler) return '';
    if (this.lang === 'ms') return this.fill('Laluan baharu sudah sedia{,w}.');
    if (this.lang === 'ja') return this.fill('{w、}新しいルートをご案内します。');
    return this.fill('New route ready{,w}.');
  }

  /* ---------------------------------------------------------------- the rest */

  /** A turn heads-up (with distance): the address now and then. */
  maneuver(text: string, key: string, now: boolean): string {
    return now ? text : this.sometimes(text, key);
  }

  /** Something the driver must act on (wrong lane, traffic, a break): always addressed. */
  attention(text: string): string {
    return this.butler ? this.address(text) : text;
  }
}
