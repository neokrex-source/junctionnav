/** Tunnel card under the guidance banner: the advance sign, distance to the tunnel, then progress inside. */
import { tunnelSignCanvas, type SignTheme } from '../junction/signs';
import { onExpressway, type TunnelState } from '../nav/tunnels';
import { formatDistance, tunnelLabels, tunnelTitle, type LangCode, type Units } from '../routing/instructions';
import { h } from './dom';

export interface TunnelCardOptions {
  lang: LangCode;
  units: Units;
  theme: SignTheme;
  /** Position is estimated (no GPS). */
  dr: boolean;
}

export class TunnelCard {
  readonly el = h('div', { class: 'tcard', hidden: true, role: 'status', 'aria-live': 'polite' });
  private sign = h('div', { class: 'tcard-sign' });
  private dist = h('div', { class: 'tcard-dist' });
  private label = h('div', { class: 'tcard-label' });
  private fill = h('span');
  private bar = h('div', { class: 'tcard-bar', hidden: true }, this.fill);
  private note = h('div', { class: 'tcard-note', hidden: true });
  private signKey = '';
  private current: string | null = null;
  private dismissed: string | null = null;

  constructor() {
    this.el.append(this.sign, h('div', { class: 'tcard-side' }, this.dist, this.label), this.bar, this.note);
    this.el.title = 'Tap to hide';
    // Tap hides the card for this tunnel.
    this.el.addEventListener('click', () => {
      this.dismissed = this.current;
      this.el.hidden = true;
    });
  }

  update(t: TunnelState | null, o: TunnelCardOptions) {
    if (!t || t.span.id === this.dismissed) {
      this.el.hidden = true;
      this.current = t?.span.id ?? null;
      return;
    }
    this.current = t.span.id;
    const L = tunnelLabels(o.lang);
    const width = Math.round(Math.min(230, Math.max(170, window.innerWidth - 150)));
    const key = `${t.span.id}|${t.span.name}|${Math.round(t.span.length)}|${o.lang}|${o.units}|${o.theme.id}|${width}`;
    if (key !== this.signKey) {
      this.signKey = key;
      const canvas = tunnelSignCanvas(
        {
          theme: o.theme,
          title: tunnelTitle(t.span, o.lang),
          lengthText: L.length(formatDistance(t.span.length, o.units)),
          lightsText: L.lights,
          expressway: onExpressway(t.span),
        },
        width,
        Math.min(3, window.devicePixelRatio || 1),
      );
      canvas.setAttribute('role', 'img');
      canvas.setAttribute('aria-label', `${tunnelTitle(t.span, o.lang)}, ${L.length(formatDistance(t.span.length, o.units))}. ${L.lights}`);
      this.sign.replaceChildren(canvas);
    }
    this.el.dataset.phase = t.phase;
    if (t.phase === 'ahead') {
      this.dist.textContent = formatDistance(t.dist, o.units);
      this.label.textContent = L.toTunnel;
      this.bar.hidden = true;
    } else {
      this.dist.textContent = formatDistance(t.toExit, o.units);
      this.label.textContent = L.toExit;
      this.bar.hidden = false;
      this.fill.style.width = `${Math.round(Math.min(1, Math.max(0, t.progress)) * 100)}%`;
    }
    this.note.hidden = !o.dr;
    this.note.textContent = o.dr ? L.noGps : '';
    this.el.hidden = false;
  }

  hide() {
    this.el.hidden = true;
    this.current = null;
    this.dismissed = null;
  }
}
