/** The junction view panel: 3D split view, sign strip, lanes, distance countdown. */
import { JunctionRenderer } from '../junction/render3d';
import type { JunctionScene } from '../junction/scene';
import { signCanvas, signHeight, type SignTheme } from '../junction/signs';
import { formatDistance, type LangCode, type Units } from '../routing/instructions';
import { h } from './dom';
import { laneIcon } from './icons';
import { profilePhrase, ProfileView } from './profileView';

export type JvMode = 'illustration' | 'map' | 'both';

const KIND: Record<LangCode, Record<string, string>> = {
  en: { exit: 'Exit', entry: 'Entrance ramp', fork: 'Junction', merge: 'Merge', split: 'Road splits' },
  ms: { exit: 'Susur keluar', entry: 'Susur masuk', fork: 'Persimpangan', merge: 'Bergabung', split: 'Jalan berpecah' },
  ja: { exit: '出口', entry: '入口', fork: '分岐', merge: '合流', split: '分岐' },
};

export interface PanelShowOptions {
  night: boolean;
  lang: LangCode;
  units: Units;
  mode: JvMode;
  /** Distance at which the view appeared (for the countdown bar). */
  total: number;
  accent?: string;
  /** Draw lane arrows inside the view (off when the banner already shows them). */
  showLanes?: boolean;
}

export class JunctionPanel {
  readonly el: HTMLElement;
  readonly mapSlot: HTMLElement;
  private stage: HTMLElement;
  private renderer: JunctionRenderer;
  private signsEl: HTMLElement;
  private lanesEl: HTMLElement;
  private chipEl: HTMLElement;
  private distLabel: HTMLElement;
  private distFill: HTMLElement;
  private modeBtn: HTMLButtonElement;
  private fallback: HTMLElement;
  private profileView = new ProfileView();
  private scene: JunctionScene | null = null;
  private theme: SignTheme | null = null;
  private opts: PanelShowOptions | null = null;
  private ro: ResizeObserver;
  private lastSignWidth = 0;
  private mode: JvMode = 'illustration';

  constructor(
    parent: HTMLElement,
    private cb: { onClose?: () => void; onModeChange?: (m: JvMode) => void } = {},
  ) {
    this.stage = h('div', { class: 'jv-stage' });
    this.mapSlot = h('div', { class: 'jv-map', hidden: true });
    this.signsEl = h('div', { class: 'jv-signs' });
    this.lanesEl = h('div', { class: 'jv-lanes', hidden: true });
    this.chipEl = h('div', { class: 'jv-chip' });
    this.distLabel = h('div', { class: 'jv-dist-label' });
    this.distFill = h('div', { class: 'jv-dist-fill' });
    this.fallback = h('div', { class: 'jv-fallback', hidden: true }, '3D view needs WebGL');
    this.modeBtn = h('button', { class: 'jv-btn', type: 'button', title: 'Switch view', 'aria-label': 'Switch junction view' }) as HTMLButtonElement;
    this.modeBtn.addEventListener('click', () => this.cycleMode());
    const close = h('button', { class: 'jv-btn', type: 'button', title: 'Hide', 'aria-label': 'Hide junction view', html: '&times;' });
    close.addEventListener('click', () => {
      this.hide();
      this.cb.onClose?.();
    });
    this.stage.append(
      this.signsEl,
      h('div', { class: 'jv-dist' }, this.distLabel, h('div', { class: 'jv-dist-track' }, this.distFill)),
      this.lanesEl,
      this.fallback,
    );
    // Tools sit on the panel, not the 3D stage, so they stay reachable in Map mode.
    const tools = h('div', { class: 'jv-tools' }, this.modeBtn, close);
    // The chip (kind, exit, height pill) sits on the panel so it shows in map mode as well.
    this.el = h('section', { class: 'jv', hidden: true, 'aria-label': 'Junction view' }, this.stage, this.mapSlot, this.chipEl, tools);
    parent.append(this.el);
    this.renderer = new JunctionRenderer(this.stage);
    this.stage.prepend(this.renderer.canvas, this.renderer.labelLayer);
    if (!this.renderer.available) this.fallback.hidden = false;
    this.ro = new ResizeObserver(() => {
      if (this.el.hidden) return;
      this.renderer.resize();
      this.renderSigns();
    });
    this.ro.observe(this.el);
  }

  get visible(): boolean {
    return !this.el.hidden;
  }
  get current(): JunctionScene | null {
    return this.visible ? this.scene : null;
  }

  show(scene: JunctionScene, theme: SignTheme, opts: PanelShowOptions) {
    const sameScene = this.scene === scene && this.theme === theme && this.opts?.night === opts.night;
    this.scene = scene;
    this.theme = theme;
    this.opts = opts;
    this.el.hidden = false;
    this.el.classList.toggle('is-night', opts.night);
    this.setMode(opts.mode, false);
    if (!sameScene) {
      this.renderer.setScene(scene, theme, opts.night);
      this.lastSignWidth = 0;
    }
    this.renderer.resize();
    this.renderSigns();
    this.renderLanes();
    const kind = KIND[opts.lang][scene.kind] ?? '';
    const name = [scene.exitRef ? `${theme.exitLabel || '#'} ${scene.exitRef}`.trim() : '', scene.junctionName].filter(Boolean).join(' · ');
    // What the road does here, from the height model: up onto a flyover, down to street level...
    this.profileView.show(scene, opts.lang, opts.units);
    const vert = scene.vertical && this.profileView.el.hidden ? profilePhrase(scene.profile.kind, opts.lang) : '';
    this.chipEl.replaceChildren(
      h('span', { class: 'jv-kind' }, kind),
      name ? h('span', { class: 'jv-name' }, name) : '',
      this.profileView.el,
      vert ? h('span', { class: `jv-vert is-${scene.vertical}` }, vert) : '',
    );
    this.profileView.el.classList.toggle('is-up', scene.vertical === 'up');
    this.profileView.el.classList.toggle('is-down', scene.vertical === 'down');
  }

  setDistance(d: number) {
    if (!this.opts || !this.scene) return;
    this.renderer.setDistance(d);
    this.profileView.setDistance(d);
    const frac = Math.max(0, Math.min(1, d / Math.max(1, this.opts.total)));
    this.distFill.style.transform = `scaleY(${frac})`;
    this.distLabel.textContent = formatDistance(Math.max(0, d), this.opts.units);
  }

  hide() {
    this.el.hidden = true;
  }

  /** Render immediately (used by the lab and by tests). */
  renderNow() {
    this.renderer.render();
  }

  get canvas(): HTMLCanvasElement {
    return this.renderer.canvas;
  }

  private cycleMode() {
    const next: JvMode = this.mode === 'illustration' ? 'map' : this.mode === 'map' ? 'both' : 'illustration';
    this.setMode(next, true);
  }

  setMode(m: JvMode, notify: boolean) {
    this.mode = m;
    this.el.dataset.mode = m;
    this.stage.hidden = m === 'map';
    this.mapSlot.hidden = m === 'illustration';
    this.modeBtn.innerHTML = m === 'illustration' ? '3D' : m === 'map' ? 'Map' : 'Both';
    if (notify) this.cb.onModeChange?.(m);
    requestAnimationFrame(() => {
      this.renderer.resize();
      this.renderSigns();
    });
  }

  private renderSigns() {
    const scene = this.scene;
    const theme = this.theme;
    if (!scene || !theme || this.stage.hidden) return;
    const box = this.stage.getBoundingClientRect();
    if (box.width < 10) return;
    const signs = [...scene.signs].sort((a, b) => a.order - b.order);
    const count = Math.max(1, signs.length);
    const compact = this.el.dataset.compact === 'true';
    const gap = compact ? 6 : 10;
    // Keep signs inside the sky band so the split itself stays visible: the tallest sign may use
    // about half the view's height. A short, wide view keeps them to the sides of the split.
    const ratio = Math.max(0.3, ...signs.map((sp) => signHeight(sp, theme, 200, { highlight: sp.taken && count > 1 }) / 200));
    const maxByHeight = (box.height * (compact ? 0.5 : 0.46)) / ratio;
    const share = count === 1 ? (compact ? 0.4 : 0.46) : compact ? 0.33 : 0.45;
    const w = Math.round(Math.max(90, Math.min(300, maxByHeight, (box.width - (compact ? 44 : 60) - gap * (count - 1)) / count, box.width * share)));
    if (w === this.lastSignWidth && this.signsEl.childElementCount === signs.length) return;
    this.lastSignWidth = w;
    this.signsEl.innerHTML = '';
    this.signsEl.dataset.count = String(signs.length);
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    signs.forEach((sp, i) => {
      const c = signCanvas(sp, theme, w, dpr, {
        highlight: sp.taken && signs.length > 1,
        accent: this.opts?.accent,
        arrowLeft: signs.length > 1 ? i === 0 : undefined,
      });
      c.className = `jv-sign${sp.taken ? ' is-taken' : ''}`;
      c.setAttribute('role', 'img');
      c.setAttribute('aria-label', [sp.exitRef ? `Exit ${sp.exitRef}` : '', ...sp.refs, ...sp.places].filter(Boolean).join(', '));
      this.signsEl.append(c);
    });
    requestAnimationFrame(() => {
      this.renderer.topInset = this.signsEl.getBoundingClientRect().height + 14;
      this.renderer.requestRender();
    });
    if (signs.length === 1) {
      const sp = signs[0];
      this.signsEl.dataset.align = sp.arrow.includes('left') ? 'left' : sp.arrow.includes('right') ? 'right' : 'center';
    } else {
      delete this.signsEl.dataset.align;
    }
  }

  private renderLanes() {
    const lanes = this.scene?.lanes;
    if (!this.opts?.showLanes || !lanes || lanes.length < 2) {
      this.lanesEl.hidden = true;
      return;
    }
    this.lanesEl.hidden = false;
    this.lanesEl.innerHTML = lanes.map((l) => laneIcon(l.indications, l.valid, this.scene!.drivingSide)).join('');
  }
}
