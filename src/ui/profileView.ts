/**
 * Height strip for the junction view: the route's height through the junction (blue), the
 * other road (grey, dashed), the ground (green) and the car. Shown in both 3D and map modes,
 * so it is clear where a ramp leaves the road, how high it climbs and how steep it is.
 */
import type { JunctionScene, ProfileKind, VerticalProfile } from '../junction/scene';
import type { LangCode, Units } from '../routing/instructions';
import { h } from './dom';

const W = 78;
const H = 22;
const PAD_X = 3;
const PAD_TOP = 3;
const PAD_BOT = 2;
const NS = 'http://www.w3.org/2000/svg';

const WORDS: Record<LangCode, Record<ProfileKind | 'm' | 'ft', string>> = {
  en: {
    flyover: 'Up onto the flyover',
    ascend: 'Up to street level',
    underpass: 'Down into the underpass',
    tunnel: 'Down into the tunnel',
    descend: 'Down to street level',
    level: 'Stays at this level',
    uphill: 'Uphill',
    downhill: 'Downhill',
    flat: 'Level',
    m: 'm',
    ft: 'ft',
  },
  ms: {
    flyover: 'Naik ke jejantas',
    ascend: 'Naik ke aras jalan',
    underpass: 'Turun ke lorong bawah',
    tunnel: 'Turun ke terowong',
    descend: 'Turun ke aras jalan',
    level: 'Kekal di aras ini',
    uphill: 'Mendaki',
    downhill: 'Menurun',
    flat: 'Rata',
    m: 'm',
    ft: 'ka',
  },
  ja: {
    flyover: '高架へ上がります',
    ascend: '地上へ上がります',
    underpass: 'アンダーパスへ下ります',
    tunnel: 'トンネルへ下ります',
    descend: '地上へ下ります',
    level: 'この高さのまま',
    uphill: '上り坂',
    downhill: '下り坂',
    flat: '平坦',
    m: 'm',
    ft: 'ft',
  },
};

/** Short phrase for the junction chip. */
export function profilePhrase(kind: ProfileKind, lang: LangCode): string {
  return WORDS[lang][kind];
}

/** Is there anything worth showing (a structure, or a noticeable slope)? */
export function profileWorthShowing(p: VerticalProfile): boolean {
  if (p.kind !== 'flat') return true;
  const all = [...p.h, ...(p.other?.h ?? [])];
  return Math.max(...all) - Math.min(...all) > 4;
}

function svg(tag: string, attrs: Record<string, string | number>): SVGElement {
  const el = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  return el;
}

/**
 * A pill for the junction chip: a small height strip, the climb or drop with the grade, and
 * (when there is room) what it means: "Up onto the flyover · +6.8 m · 5%".
 */
export class ProfileView {
  readonly el: HTMLElement;
  private root: SVGSVGElement;
  private car: SVGElement;
  private label: HTMLElement;
  private phrase: HTMLElement;
  private profile: VerticalProfile | null = null;
  private sx = (s: number) => s;
  private sy = (v: number) => v;

  constructor() {
    this.root = svg('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, 'aria-hidden': 'true' }) as SVGSVGElement;
    this.car = svg('circle', { r: 2.6, class: 'pv-car' });
    this.label = h('span', { class: 'pv-label' });
    this.phrase = h('span', { class: 'pv-phrase' });
    this.el = h('span', { class: 'jv-profile', role: 'img', hidden: true }, this.phrase, this.label);
    this.el.prepend(this.root);
  }

  show(scene: JunctionScene, lang: LangCode, units: Units) {
    const p = scene.profile;
    this.profile = p;
    if (!p || p.s.length < 2 || !profileWorthShowing(p)) {
      this.el.hidden = true;
      return;
    }
    this.el.hidden = false;
    const s0 = p.s[0];
    const s1 = p.s[p.s.length - 1];
    const vals = [...p.h, ...p.ground, ...(p.other?.h ?? [])];
    let lo = Math.min(...vals);
    let hi = Math.max(...vals);
    // At least 10 m tall so a flat road looks flat and a 1 m hump looks small.
    if (hi - lo < 10) {
      const mid = (hi + lo) / 2;
      lo = mid - 5;
      hi = mid + 5;
    }
    this.sx = (s) => PAD_X + ((s - s0) / (s1 - s0)) * (W - 2 * PAD_X);
    this.sy = (v) => PAD_TOP + (1 - (v - lo) / (hi - lo)) * (H - PAD_TOP - PAD_BOT);
    const line = (ss: number[], vv: number[]) => ss.map((s, i) => `${i ? 'L' : 'M'}${this.sx(s).toFixed(1)},${this.sy(vv[i]).toFixed(1)}`).join('');
    const groundPath = `${line(p.s, p.ground)}L${this.sx(s1).toFixed(1)},${H}L${this.sx(s0).toFixed(1)},${H}Z`;
    this.root.replaceChildren(
      svg('path', { d: groundPath, class: 'pv-ground' }),
      svg('line', { x1: this.sx(0), x2: this.sx(0), y1: PAD_TOP - 3, y2: H, class: 'pv-split' }),
      ...(p.other ? [svg('path', { d: line(p.other.s, p.other.h), class: 'pv-other' })] : []),
      svg('path', { d: line(p.s, p.h), class: 'pv-route' }),
      this.car,
    );
    const w = WORDS[lang];
    const big = Math.abs(p.peak.h) >= 1.5 ? p.peak.h : null;
    const amount = big == null ? '' : units === 'imperial' ? `${big > 0 ? '+' : '−'}${Math.round(Math.abs(big) * 3.281)} ${w.ft}` : `${big > 0 ? '+' : '−'}${Math.abs(big).toFixed(1)} ${w.m}`;
    const grade = p.grade >= 2 ? `${Math.round(p.grade)}%` : '';
    const numbers = [amount, grade].filter(Boolean).join(' · ');
    this.label.textContent = numbers || w[p.kind];
    this.phrase.textContent = numbers ? w[p.kind] : '';
    this.phrase.hidden = !numbers;
    this.el.setAttribute('aria-label', [w[p.kind], amount, grade].filter(Boolean).join(', '));
    this.el.title = this.el.getAttribute('aria-label') ?? '';
    this.setDistance(Math.max(0, -s0));
  }

  /** Real distance to the split in metres; moves the car along the strip. */
  setDistance(d: number) {
    const p = this.profile;
    if (!p || this.el.hidden) return;
    const s = Math.max(p.s[0], Math.min(p.s[p.s.length - 1], -d));
    let i = 0;
    while (i < p.s.length - 2 && p.s[i + 1] < s) i++;
    const t = p.s[i + 1] > p.s[i] ? (s - p.s[i]) / (p.s[i + 1] - p.s[i]) : 0;
    const v = p.h[i] + (p.h[i + 1] - p.h[i]) * Math.max(0, Math.min(1, t));
    this.car.setAttribute('cx', this.sx(s).toFixed(1));
    this.car.setAttribute('cy', this.sy(v).toFixed(1));
  }
}
