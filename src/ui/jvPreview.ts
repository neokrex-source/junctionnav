/** Modal that previews a junction view before driving, with a drive-up slider. */
import type { JunctionScene } from '../junction/scene';
import type { SignTheme } from '../junction/signs';
import { t, type LangCode, type Units } from '../routing/instructions';
import { h } from './dom';
import { JunctionPanel } from './junctionPanel';

export class JvPreview {
  readonly el: HTMLElement;
  private panel: JunctionPanel;
  private title = h('h2', { class: 'jvm-title' });
  private sub = h('p', { class: 'jvm-sub' });
  private range = h('input', { id: 'jvm-dist', type: 'range', min: '0', max: '1000', step: '5', value: '600' }) as HTMLInputElement;
  private out = h('output', { for: 'jvm-dist' });
  private closeBtn: HTMLButtonElement;
  private onKey = (e: KeyboardEvent) => e.key === 'Escape' && this.close();

  constructor() {
    this.closeBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Close', html: '&times;' }) as HTMLButtonElement;
    this.closeBtn.addEventListener('click', () => this.close());
    const stage = h('div', { class: 'jvm-stage' });
    const card = h(
      'div',
      { class: 'jvm card', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Junction preview' },
      h('div', { class: 'jvm-head' }, h('div', { style: 'min-width:0' }, this.title, this.sub), this.closeBtn),
      stage,
      h('div', { class: 'jvm-drive' }, this.range, this.out),
    );
    this.el = h('div', { class: 'jvm-scrim', hidden: true }, card);
    this.el.addEventListener('click', (e) => e.target === this.el && this.close());
    document.body.append(this.el);
    this.panel = new JunctionPanel(stage);
    this.range.addEventListener('input', () => this.setDistance(Number(this.range.value)));
  }

  get isOpen() {
    return !this.el.hidden;
  }

  open(scene: JunctionScene, theme: SignTheme, o: { night: boolean; lang: LangCode; units: Units; title: string; sub: string }) {
    this.el.hidden = false;
    this.title.textContent = o.title;
    this.sub.textContent = o.sub;
    this.closeBtn.setAttribute('aria-label', t(o.lang, 'close'));
    this.panel.show(scene, theme, { night: o.night, lang: o.lang, units: o.units, mode: 'illustration', total: 1000 });
    this.unitsLabel = o.units;
    this.setDistance(Number(this.range.value));
    document.addEventListener('keydown', this.onKey);
    this.closeBtn.focus();
  }

  /** Swap in a better scene (e.g. once OSM detail arrives) without resetting the slider. */
  update(scene: JunctionScene, theme: SignTheme, o: { night: boolean; lang: LangCode; units: Units }) {
    if (!this.isOpen) return;
    this.panel.show(scene, theme, { ...o, mode: 'illustration', total: 1000 });
    this.setDistance(Number(this.range.value));
  }

  private unitsLabel: Units = 'metric';
  private setDistance(d: number) {
    this.panel.setDistance(d);
    this.out.textContent = this.unitsLabel === 'imperial' ? `${Math.round(d * 3.28084)} ft` : `${d} m`;
  }

  close() {
    this.el.hidden = true;
    this.panel.hide();
    document.removeEventListener('keydown', this.onKey);
  }
}
