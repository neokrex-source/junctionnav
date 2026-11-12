/**
 * The speed while driving, with the speed limit, drawn the way the chosen look draws its
 * instruments:
 *
 *  - JunctionNav: the speed in a round bubble, the limit as a round road sign on its corner;
 *    the bubble's ring turns amber near the limit and the bubble red over it.
 *  - Fighter jet: a head-up display speed tape. The scale runs past a boxed readout, the limit
 *    is the red and white "barber pole" band an aircraft's speed tape has above its maximum
 *    speed, with an amber band below it for the warning margin; LIM and the heading are
 *    printed above and below.
 *  - Casual: a round dial with green, amber and red zones up to and past the limit, the speed in
 *    the middle and the limit as a round sign stuck on its corner.
 */
import type { Units } from '../routing/instructions';
import type { SpeedState } from '../nav/speedWatch';
import type { ThemeId } from '../theme/palette';
import { h } from './dom';

export interface MeterInput {
  /** Speed in km/h. */
  kmh: number;
  units: Units;
  state: SpeedState | null;
  theme: ThemeId;
  /** The warning margin below the limit (km/h). */
  margin: number;
  /** Heading of travel (degrees), for the jet's HDG readout. */
  heading: number;
  /** Words for the screen reader. */
  label: { limit: string };
}

const toUnits = (kmh: number, units: Units) => (units === 'imperial' ? kmh / 1.609344 : kmh);

/** The jet's speed tape: 84 by 150, the readout box at the middle. */
function tapeSvg(v: number, limit: number | null, margin: number, unit: string, heading: number, state: string): string {
  const W = 84;
  const H = 150;
  const top = 20;
  const bottom = 128;
  const mid = (top + bottom) / 2;
  const px = 2.3; // pixels per unit of speed
  const y = (x: number) => mid - (x - v) * px;
  const lo = Math.floor((v - (mid - top) / px) / 5) * 5;
  const hi = Math.ceil((v + (bottom - mid) / px) / 5) * 5;
  let ticks = '';
  let labels = '';
  for (let x = Math.max(0, lo); x <= hi; x += 5) {
    const yy = y(x);
    if (yy < top - 0.5 || yy > bottom + 0.5) continue;
    const major = x % 10 === 0;
    ticks += `<path d="M${W - 14} ${yy.toFixed(1)}h${major ? 9 : 5}"/>`;
    if (x % 20 === 0 && Math.abs(yy - mid) > 14) labels += `<text x="${W - 18}" y="${(yy + 3.5).toFixed(1)}" text-anchor="end">${x}</text>`;
  }
  let bands = '';
  if (limit != null) {
    const yl = Math.max(top, Math.min(bottom, y(limit)));
    const ym = Math.max(top, Math.min(bottom, y(limit - margin)));
    if (yl > top) bands += `<rect class="tp-pole" x="${W - 4}" y="${top}" width="4" height="${(yl - top).toFixed(1)}"/>`;
    if (ym > yl) bands += `<rect class="tp-amber" x="${W - 4}" y="${yl.toFixed(1)}" width="4" height="${(ym - yl).toFixed(1)}"/>`;
  }
  const box = `<path class="tp-box" d="M3 ${mid - 12}h42l7 12l-7 12H3z"/>`;
  const num = `<text class="tp-num" x="25" y="${mid + 7}" text-anchor="middle">${Math.round(v)}</text>`;
  const lim = limit != null ? `<text class="tp-lim" x="5" y="14">LIM ${Math.round(limit)}</text>` : `<text class="tp-lim tp-dim" x="5" y="14">LIM ---</text>`;
  const hdg = `<text class="tp-hdg" x="5" y="${H - 6}">HDG ${String(Math.round(((heading % 360) + 360) % 360) || 360).padStart(3, '0')}</text>`;
  const unitT = `<text class="tp-unit" x="${W - 5}" y="${H - 6}" text-anchor="end">${unit}</text>`;
  const frame = `<path class="tp-frame" d="M1 7V1h6M${W - 1} 7V1h-6M1 ${H - 7}v6h6M${W - 1} ${H - 7}v6h-6"/>`;
  return `<svg class="spd-tape" data-state="${state}" viewBox="0 0 ${W} ${H}" aria-hidden="true"><defs><pattern id="tp-stripes" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><rect width="3" height="6" fill="#ff3b3b"/><rect x="3" width="3" height="6" fill="#ffffff"/></pattern></defs>${frame}<g class="tp-scale"><path d="M${W - 14} ${top}V${bottom}"/>${ticks}</g><g class="tp-labels">${labels}</g>${bands}${box}${num}${lim}${unitT}${hdg}</svg>`;
}

/** The casual dial: a 270 degree arc with the zones, filled up to the speed. */
function dialSvg(v: number, limit: number | null, margin: number, state: string): string {
  const max = Math.max(120, Math.ceil(((limit ?? 90) * 1.3) / 10) * 10);
  const R = 30;
  const c = 36;
  const a0 = 135;
  const sweep = 270;
  const at = (x: number) => a0 + (sweep * Math.max(0, Math.min(max, x))) / max;
  const pt = (deg: number, r = R) => {
    const t = (deg * Math.PI) / 180;
    return `${(c + r * Math.cos(t)).toFixed(2)} ${(c + r * Math.sin(t)).toFixed(2)}`;
  };
  const arc = (x0: number, x1: number, r = R) => {
    const d0 = at(x0);
    const d1 = at(x1);
    if (d1 - d0 < 0.5) return '';
    return `M${pt(d0, r)}A${r} ${r} 0 ${d1 - d0 > 180 ? 1 : 0} 1 ${pt(d1, r)}`;
  };
  let zones = '';
  if (limit != null) {
    zones += `<path class="dl-z-ok" d="${arc(0, limit - margin, R + 4.5)}"/>`;
    zones += `<path class="dl-z-near" d="${arc(limit - margin, limit, R + 4.5)}"/>`;
    zones += `<path class="dl-z-over" d="${arc(limit, max, R + 4.5)}"/>`;
  }
  return `<svg class="spd-dial" data-state="${state}" viewBox="0 0 72 72" aria-hidden="true"><path class="dl-track" d="${arc(0, max)}"/>${zones}<path class="dl-fill" d="${arc(0, v)}"/></svg>`;
}

export class SpeedMeter {
  readonly el = h('div', { class: 'speed card', role: 'img' });
  private sign = h('div', { class: 'spd-sign', hidden: true });
  private gauge = h('div', { class: 'spd-gauge' });
  private num = h('div', { class: 'spd-num' });
  private key = '';

  constructor() {
    this.el.append(this.gauge, this.num, this.sign);
  }

  update(o: MeterInput) {
    const unit = o.units === 'imperial' ? 'mph' : 'km/h';
    const v = Math.max(0, toUnits(o.kmh, o.units));
    const st = o.state;
    const limitKmh = st?.limit?.kmh ?? null;
    const limit = limitKmh != null ? toUnits(limitKmh, o.units) : null;
    const margin = toUnits(o.margin, o.units);
    const state = st?.speeding ?? 'ok';
    const heading = Math.round(o.heading / 2) * 2;
    const key = `${o.theme}|${Math.round(v * (o.theme === 'jet' ? 2 : 1))}|${limit != null ? Math.round(limit) : '-'}|${state}|${unit}|${o.theme === 'jet' ? heading : ''}`;
    if (key === this.key) return;
    this.key = key;
    this.el.dataset.state = state;
    this.el.dataset.skin = o.theme;
    this.num.innerHTML = `<b>${Math.round(v)}</b><small>${unit}</small>`;
    this.gauge.innerHTML = o.theme === 'jet' ? tapeSvg(v, limit, margin, unit.toUpperCase(), heading, state) : o.theme === 'casual' ? dialSvg(v, limit, margin, state) : '';
    if (limit != null) {
      this.sign.textContent = String(Math.round(limit));
      this.sign.dataset.digits = String(String(Math.round(limit)).length);
      this.sign.hidden = false;
    } else this.sign.hidden = true;
    this.el.setAttribute('aria-label', `${Math.round(v)} ${unit}${limit != null ? `, ${o.label.limit} ${Math.round(limit)}` : ''}`);
  }
}
