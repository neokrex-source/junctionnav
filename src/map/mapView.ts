/** Main map: routes, progress, maneuver arrow, position puck and follow camera. */
import { DAY, type Theme } from '../theme/palette';
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { LngLat } from '../geo/geo';
import type { Route, Step } from '../routing/types';
import { fallbackStyle } from './styles';
import { tunnelsFromRoute, type TunnelSpan } from '../nav/tunnels';

/** Puck and pin take their colours from the CSS theme (--route, --pin). */

export const PUCK_SVG = '<svg viewBox="0 0 40 40" aria-hidden="true"><circle class="p-ring" cx="20" cy="20" r="17"/><circle class="p-core" cx="20" cy="20" r="14"/><path class="p-arrow" d="M20 8 L28.5 28 L20 23.5 L11.5 28 Z"/></svg>';
const PIN_SVG = `<svg viewBox="0 0 30 40" aria-hidden="true"><path class="pin-body" d="M15 39s13-12.3 13-23A13 13 0 0 0 2 16c0 10.7 13 23 13 23z" stroke-width="2"/><circle class="pin-dot" cx="15" cy="15.5" r="5"/></svg>`;

/**
 * How much map the follow camera shows, the way a car navigation unit states it: the length the
 * scale bar stands for at the car (SCALE_PX screen pixels), from 100 m (streets close up) to 1 km
 * (the area around), or 'auto' (wider at speed, closing in to 100 m as the next turn comes up).
 */
export type FollowScale = 'auto' | number;
export const SCALE_MIN = 100;
export const SCALE_MAX = 1000;
/** What the recenter button steps through. */
export const SCALE_STEPS: FollowScale[] = ['auto', 1000, 500, 200, 100];
/** The scale bar's full length on screen; a scale of 200 m means this many pixels cover 200 m at the car. */
export const SCALE_PX = 100;
/** Scales a pinch or the mouse wheel settles on, like the detents of a car unit's zoom. */
export const SCALE_DETENTS = [100, 150, 200, 300, 500, 700, 1000];

const clampSpan = (m: number) => Math.min(SCALE_MAX, Math.max(SCALE_MIN, m));

/** The detent nearest to a scale (by ratio, so 120 m goes to 100 m and 130 m to 150 m). */
export function nearestDetent(m: number): number {
  let best = SCALE_DETENTS[0];
  for (const d of SCALE_DETENTS) if (Math.abs(Math.log(d / m)) < Math.abs(Math.log(best / m))) best = d;
  return best;
}

/** The round length a scale bar shows for at most `m` metres: 1, 1.5, 2, 3, 5 or 7 times a power of ten. */
export function roundScale(m: number): number {
  const p = 10 ** Math.floor(Math.log10(m));
  const f = m / p;
  // A hair of tolerance so 199.99 m reads as 200 m.
  const step = [10, 7, 5, 3, 2, 1.5, 1].find((x) => f >= x * 0.999) ?? 1;
  return step * p;
}

/** Automatic scale: wider on fast roads, closer in town, and down to 100 m as the next turn comes up. */
export function autoSpan(speed: number, distToNext: number, wide = false): number {
  let span = speed > 24 ? 300 : speed > 14 ? 200 : speed > 7 ? 150 : 120;
  // Close in for the turn: the scale bar about a third of the distance left.
  if (distToNext < span * 3) span = Math.min(span, distToNext / 3 + 40);
  // The junction view shows the close-up, so the map steps back to show the area around it.
  if (wide) span = Math.max(span * 1.5, 200);
  return clampSpan(span);
}

/** Zoom at which `widthPx` screen pixels cover `span` metres at latitude `lat`. */
export function zoomForSpan(span: number, lat: number, widthPx: number): number {
  return Math.log2((40075016.686 * Math.cos((lat * Math.PI) / 180) * widthPx) / (512 * span));
}

export function spanAtZoom(zoom: number, lat: number, widthPx: number): number {
  return (40075016.686 * Math.cos((lat * Math.PI) / 180) * widthPx) / (512 * 2 ** zoom);
}

/**
 * The impulses on the route at time `t` (seconds): three streaks travelling from the car (at `s`)
 * over the next stretch of road, each crossing it in 2.2 s and fading in and out at its ends. The
 * stretch and the streaks scale with the map (`scale`: what the scale bar stands for, metres).
 */
export function pulseFeatures(line: { length: number; slice(a: number, b: number): LngLat[] }, s: number, scale: number, t: number): Feature<LineString, { a: number }>[] {
  const left = line.length - s;
  if (left < 30) return [];
  const range = Math.min(left, Math.max(600, Math.min(4000, scale * 8)));
  const len = Math.max(30, Math.min(400, scale * 0.45));
  const speed = range / 2.2;
  const out: Feature<LineString, { a: number }>[] = [];
  for (let k = 0; k < 3; k++) {
    const d = (t * speed + (k * range) / 3) % range;
    const from = s + d;
    const to = Math.min(line.length, from + len);
    if (to - from < 2) continue;
    const coordinates = line.slice(from, to);
    if (coordinates.length < 2) continue;
    out.push({ type: 'Feature', properties: { a: Math.pow(Math.sin((Math.PI * d) / range), 0.7) }, geometry: { type: 'LineString', coordinates } });
  }
  return out;
}

export interface FollowOptions {
  speed: number;
  distToNext: number;
  /** Screen padding so the puck sits below/beside the guidance panels. */
  padding: { top: number; bottom: number; left: number; right: number };
  /** Zoom out to show the area around a junction (the junction view shows the close-up). */
  wide?: boolean;
}

export class MapView {
  readonly map: maplibregl.Map;
  private puck: maplibregl.Marker;
  private dest: maplibregl.Marker;
  private routes: Route[] = [];
  private selected = 0;
  private progressFrac = 0;
  private arrow: FeatureCollection = { type: 'FeatureCollection', features: [] };
  private styleFailed = false;
  private currentStyle: string | StyleSpecification;
  private following = false;
  private userPanCb: (() => void) | null = null;
  private routeClickCb: ((idx: number) => void) | null = null;
  private resultMarkers: maplibregl.Marker[] = [];
  /** Style to switch to when the chosen one cannot load (set by the app for day/night). */
  fallback: () => StyleSpecification = () => fallbackStyle(false);
  /** Called when the map switches to the fallback, so other maps can follow. */
  onFallback: (() => void) | null = null;
  /** Shown over the map when tiles cannot load. */
  private notice: HTMLElement;
  private tilesOk = 0;
  private tileErrors = 0;
  private lastError = '';
  private watchdog: number[] = [];

  constructor(container: HTMLElement, style: string | StyleSpecification, center: LngLat, zoom = 13) {
    this.currentStyle = style;
    this.map = new maplibregl.Map({
      container,
      style,
      center,
      zoom,
      attributionControl: { compact: true },
      maxPitch: 70,
      fadeDuration: 0,
    });
    // Scale bar of our own: measured at the car while following (MapLibre's measures across the
    // middle of the screen, which on a tilted map is much further away than the car).
    this.scaleEl = document.createElement('div');
    this.scaleEl.className = 'scale-bar';
    this.scaleEl.setAttribute('aria-hidden', 'true');
    this.scaleEl.innerHTML = '<span class="sb-label"></span><span class="sb-line"></span>';
    container.append(this.scaleEl);
    this.map.on('move', () => this.queueScale());
    this.map.on('resize', () => this.queueScale());
    this.map.once('load', () => this.queueScale());
    const puckEl = document.createElement('div');
    puckEl.className = 'puck';
    puckEl.innerHTML = PUCK_SVG;
    this.puck = new maplibregl.Marker({ element: puckEl, rotationAlignment: 'map', pitchAlignment: 'map' });
    const pinEl = document.createElement('div');
    pinEl.className = 'dest-pin';
    pinEl.innerHTML = PIN_SVG;
    this.dest = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' });

    this.notice = document.createElement('div');
    this.notice.className = 'map-notice';
    this.notice.hidden = true;
    this.notice.setAttribute('role', 'status');
    container.append(this.notice);

    this.map.on('style.load', () => {
      this.installLayers();
      this.watchTiles();
    });
    this.map.on('data', (e) => {
      // Count only tiles that really arrived; failed tiles also fire data events.
      // Our own GeoJSON layers (route, arrow) are tiled too; they say nothing about the network.
      const d = e as { dataType?: string; sourceId?: string; tile?: { state?: string } };
      if (d.dataType === 'source' && d.tile && d.tile.state === 'loaded' && this.map.getSource(d.sourceId ?? '')?.type !== 'geojson') {
        this.tilesOk++;
        if (!this.notice.hidden && this.notice.dataset.kind === 'error') this.notice.hidden = true;
      }
    });
    this.map.on('error', (e) => {
      const ev = e as { error?: Error; sourceId?: string; tile?: unknown };
      const msg = String(ev.error?.message ?? '');
      this.lastError = msg;
      console.warn('[map]', msg);
      if (ev.sourceId || ev.tile) {
        this.tileErrors++;
        return;
      }
      // The style document itself failed (blocked, offline, wrong URL).
      if (this.isRemote() && !this.map.isStyleLoaded() && /style|404|403|Failed to fetch|NetworkError|Load failed|AJAXError/i.test(msg)) this.fail(msg);
    });
    // Only gestures carry an originalEvent; the follow camera's own moves do not.
    const userMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && this.following) {
        this.following = false;
        this.userZooming = false;
        this.userPanCb?.();
      }
    };
    this.map.on('dragstart', userMove);
    this.map.on('rotatestart', userMove);
    this.map.on('pitchstart', userMove);
    // Zooming while following keeps following: the new zoom becomes the scale (100 m to 1 km).
    this.map.on('zoomstart', (e) => {
      if (e.originalEvent && this.following) this.userZooming = true;
    });
    this.map.on('zoomend', () => {
      if (this.userZooming && !this.holding) this.finishUserZoom();
    });
    // The follow camera moves several times a second, and each move would cut a gesture short:
    // while a finger or the mouse button is down, or the wheel is turning, it holds still.
    const canvas = this.map.getCanvasContainer();
    const pointers = new Set<number>();
    canvas.addEventListener('pointerdown', (e) => {
      pointers.add(e.pointerId);
      this.holding = true;
      // End the follow camera's move in flight so the gesture starts from a still map.
      if (this.following) this.map.stop();
    });
    const release = (e: PointerEvent) => {
      if (!pointers.delete(e.pointerId) || pointers.size) return;
      this.holding = false;
      if (this.userZooming && !this.map.isZooming()) this.finishUserZoom();
      else this.flushFollow();
    };
    window.addEventListener('pointerup', release);
    window.addEventListener('pointercancel', release);
    // The mouse wheel while following steps the scale itself (the map's own wheel zoom would be
    // cut short by the next camera move): up closer, down wider, within 100 m and 1 km.
    canvas.addEventListener(
      'wheel',
      (e) => {
        if (!this.following) return;
        e.preventDefault();
        e.stopPropagation();
        // One detent per notch (a trackpad's small deltas add up to one).
        const px = e.deltaMode === 1 ? e.deltaY * 33 : e.deltaMode === 2 ? e.deltaY * 400 : e.deltaY;
        this.wheelAcc += px;
        if (Math.abs(this.wheelAcc) < 60) return;
        const dir = Math.sign(this.wheelAcc);
        this.wheelAcc = 0;
        const cur = nearestDetent(this.scale === 'auto' ? this.spanNow : this.scale);
        const i = SCALE_DETENTS.indexOf(cur);
        this.setFollowScale(SCALE_DETENTS[Math.max(0, Math.min(SCALE_DETENTS.length - 1, i + dir))]);
        this.refollow();
      },
      { passive: false, capture: true },
    );
    this.map.on('click', (e) => {
      if (!this.routes.length || !this.map.getLayer('route-alt')) return;
      const hit = this.map.queryRenderedFeatures(e.point, { layers: ['route-alt'] })[0];
      if (hit) this.routeClickCb?.(Number(hit.properties?.idx));
    });
  }

  onUserPan(cb: () => void) {
    this.userPanCb = cb;
  }
  onRouteClick(cb: (idx: number) => void) {
    this.routeClickCb = cb;
  }

  /** Long-press (touch) or right-click (mouse) on the map. */
  onLongPress(cb: (p: LngLat) => void) {
    this.map.on('contextmenu', (e) => cb([e.lngLat.lng, e.lngLat.lat]));
    let timer = 0;
    let start: { x: number; y: number } | null = null;
    this.map.on('touchstart', (e) => {
      if (e.originalEvent.touches.length !== 1) return;
      start = { x: e.point.x, y: e.point.y };
      const ll = e.lngLat;
      timer = window.setTimeout(() => cb([ll.lng, ll.lat]), 600);
    });
    const cancel = () => clearTimeout(timer);
    this.map.on('touchend', cancel);
    this.map.on('touchcancel', cancel);
    this.map.on('touchmove', (e) => {
      if (start && Math.hypot(e.point.x - start.x, e.point.y - start.y) > 10) cancel();
    });
  }

  setStyle(style: string | StyleSpecification, keepFailed = false) {
    if (!keepFailed) {
      this.styleFailed = false;
      this.notice.hidden = true;
    }
    this.currentStyle = style;
    this.map.setStyle(style, { diff: false });
  }

  /** A style that loads from the network (as opposed to the demo style or the offline maps). */
  private isRemote(): boolean {
    const s = this.currentStyle;
    const local = (u: string) => /^(pmtiles|offline):\/\//.test(u);
    return (
      typeof s === 'string' ||
      Object.values(s.sources ?? {}).some((src) => ('tiles' in src && !!src.tiles?.some((u) => !local(u))) || ('url' in src && !!src.url && !local(src.url)))
    );
  }

  /**
   * After a style loads, make sure tiles actually arrive. If they fail (or nothing at all
   * arrives for a long time), switch to the fallback provider; if that fails too, say so.
   */
  private watchTiles() {
    this.watchdog.forEach(clearTimeout);
    this.tilesOk = 0;
    this.tileErrors = 0;
    if (!this.isRemote()) return;
    const check = (needErrors: boolean) => {
      if (this.tilesOk > 0) return;
      if (needErrors && this.tileErrors === 0) return;
      this.fail(this.lastError || 'no map tiles arrived');
    };
    this.watchdog = [window.setTimeout(() => check(true), 9000), window.setTimeout(() => check(false), 25000)];
  }

  private fail(reason: string) {
    const onFallback = this.currentStyle === this.fallback();
    if (!onFallback && !this.styleFailed) {
      this.styleFailed = true;
      console.warn('[map] map style failed, using the fallback map', reason);
      this.showNotice('info', 'The usual map could not load, so a simpler map is shown. You can pick a map style in Settings.');
      this.setStyle(this.fallback(), true);
      this.onFallback?.();
      return;
    }
    this.showNotice('error', 'The map cannot load right now. Check your internet connection, then try again.', () => {
      this.styleFailed = false;
      this.setStyle(this.currentStyle);
    });
  }

  private showNotice(kind: 'info' | 'error', text: string, retry?: () => void) {
    const n = this.notice;
    n.dataset.kind = kind;
    n.replaceChildren(text);
    if (retry) {
      const b = document.createElement('button');
      b.type = 'button';
      b.textContent = 'Try again';
      b.addEventListener('click', retry);
      n.append(b);
    }
    n.hidden = false;
    if (kind === 'info') window.setTimeout(() => n.dataset.kind === 'info' && (n.hidden = true), 8000);
  }

  get isFollowing() {
    return this.following;
  }

  /* ------------------------------------------------------------ scale bar */

  private scaleEl: HTMLElement;
  private scaleRaf = 0;
  private puckAt: LngLat | null = null;
  private imperial = false;
  /** What the scale bar shows now (metres), for the recenter button. */
  scaleShown = 0;

  setUnits(u: 'metric' | 'imperial') {
    this.imperial = u === 'imperial';
    this.queueScale();
  }

  private queueScale() {
    if (this.scaleRaf) return;
    this.scaleRaf = requestAnimationFrame(() => {
      this.scaleRaf = 0;
      this.paintScale();
    });
  }

  /** The bar: a round length that fits in SCALE_PX pixels, measured across the car (or the middle). */
  private paintScale() {
    const m = this.map;
    const el = m.getContainer();
    const w = el.clientWidth;
    const h = el.clientHeight;
    if (!w || !h) return;
    let y = h / 2;
    let x = w / 2;
    if (this.following && this.puckAt) {
      const pt = m.project(this.puckAt);
      if (pt.y > 0 && pt.y < h) [x, y] = [Math.min(w - SCALE_PX / 2, Math.max(SCALE_PX / 2, pt.x)), pt.y];
    }
    const a = m.unproject([x - SCALE_PX / 2, y]);
    const b = m.unproject([x + SCALE_PX / 2, y]);
    const metres = a.distanceTo(b);
    if (!(metres > 0)) return;
    let len: number;
    let label: string;
    if (this.imperial) {
      const feet = metres * 3.28084;
      const miles = feet / 5280;
      if (miles >= 0.1) {
        const r = roundScale(miles);
        len = r / miles;
        label = `${r} mi`;
      } else {
        const r = roundScale(feet);
        len = r / feet;
        label = `${r} ft`;
      }
      this.scaleShown = metres;
    } else {
      const r = roundScale(metres);
      len = r / metres;
      label = r >= 1000 ? `${r / 1000} km` : `${r} m`;
      this.scaleShown = r;
    }
    const line = this.scaleEl.lastElementChild as HTMLElement;
    const text = this.scaleEl.firstElementChild as HTMLElement;
    line.style.width = `${Math.round(len * SCALE_PX)}px`;
    if (text.textContent !== label) text.textContent = label;
  }

  private beforeId(): string | undefined {
    const layers = this.map.getStyle()?.layers ?? [];
    return layers.find((l) => l.type === 'symbol')?.id;
  }

  private theme: Theme = DAY;

  /** Day or night colours for the route line (the base map changes with its style). */
  setTheme(t: Theme) {
    if (t === this.theme) return;
    this.theme = t;
    const m = this.map;
    if (!m.getLayer('route-line')) return;
    m.setPaintProperty('route-alt', 'line-color', t.alt);
    m.setPaintProperty('route-glow', 'line-color', t.routeGlow);
    m.setPaintProperty('route-casing', 'line-color', t.routeCasing);
    m.setPaintProperty('route-line', 'line-gradient', this.gradient());
    m.setPaintProperty('maneuver-casing', 'line-color', t.routeCasing);
    m.setPaintProperty('route-pulse', 'line-color', t.pulse);
    m.setPaintProperty('route-pulse-glow', 'line-color', t.pulseGlow);
  }

  /* ------------------------------------------------------------ route impulses */

  private pulsing = false;
  private pulseRaf = 0;
  private pulseLast = 0;
  private progressS = 0;

  /**
   * Impulses running along the route ahead of the car while navigating: three short bright streaks
   * in flight at a time, from the car towards the destination, spaced and sized to the map scale.
   */
  setPulsing(on: boolean) {
    if (on === this.pulsing) return;
    this.pulsing = on;
    if (on && !window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) this.pulseRaf = requestAnimationFrame(this.pulseFrame);
    else {
      cancelAnimationFrame(this.pulseRaf);
      this.pulseRaf = 0;
      (this.map.getSource('route-pulse') as GeoJSONSource | undefined)?.setData({ type: 'FeatureCollection', features: [] });
    }
  }

  private pulseFrame = (now: number) => {
    if (!this.pulsing) return;
    this.pulseRaf = requestAnimationFrame(this.pulseFrame);
    // About 30 frames a second is smooth enough, and nothing while the app is in the background.
    if (now - this.pulseLast < 33 || document.hidden) return;
    this.pulseLast = now;
    const src = this.map.getSource('route-pulse') as GeoJSONSource | undefined;
    const r = this.routes[this.selected];
    if (!src || !r) return;
    src.setData({ type: 'FeatureCollection', features: pulseFeatures(r.line, this.progressS, this.scaleShown || 200, now / 1000) });
  };

  private installLayers() {
    const m = this.map;
    if (m.getSource('routes')) return;
    m.addSource('routes', { type: 'geojson', data: this.routesFC(false) });
    m.addSource('route-main', { type: 'geojson', data: this.routesFC(true), lineMetrics: true });
    m.addSource('maneuver', { type: 'geojson', data: this.arrow });
    m.addSource('tunnels', { type: 'geojson', data: this.tunnelFC() });
    m.addSource('route-pulse', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    const before = this.beforeId();
    m.addLayer(
      {
        id: 'route-alt',
        type: 'line',
        source: 'routes',
        filter: ['!=', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': this.theme.alt, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 10] },
      },
      before,
    );
    // A soft light around the route at night, like a lit lane on a dark dashboard.
    m.addLayer(
      {
        id: 'route-glow',
        type: 'line',
        source: 'route-main',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': this.theme.routeGlow, 'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 10], 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 12, 16, 30, 19, 54] },
      },
      before,
    );
    m.addLayer(
      {
        id: 'route-casing',
        type: 'line',
        source: 'route-main',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': this.theme.routeCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 14, 19, 26] },
      },
      before,
    );
    m.addLayer(
      {
        id: 'route-line',
        type: 'line',
        source: 'route-main',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 10, 19, 20],
          'line-gradient': this.gradient(),
        },
      },
      before,
    );
    // Tunnel stretches of the route: a dashed light line over it, like the roads in the base map.
    m.addLayer(
      {
        id: 'route-tunnel',
        type: 'line',
        source: 'tunnels',
        layout: { 'line-cap': 'butt', 'line-join': 'round' },
        paint: {
          'line-color': '#ffffff',
          'line-opacity': 0.9,
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 16, 4, 19, 8],
          'line-dasharray': [1.4, 1.2],
        },
      },
      before,
    );
    // Impulses firing along the route ahead of the car, like signals down a nerve.
    m.addLayer(
      {
        id: 'route-pulse-glow',
        type: 'line',
        source: 'route-pulse',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': this.theme.pulseGlow,
          'line-opacity': ['*', 0.75, ['get', 'a']],
          'line-blur': ['interpolate', ['linear'], ['zoom'], 10, 3, 16, 8],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 9, 16, 22, 19, 40],
        },
      },
      before,
    );
    m.addLayer(
      {
        id: 'route-pulse',
        type: 'line',
        source: 'route-pulse',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': this.theme.pulse,
          'line-opacity': ['get', 'a'],
          'line-width': ['interpolate', ['linear'], ['zoom'], 10, 2, 16, 4.5, 19, 9],
        },
      },
      before,
    );
    m.addLayer({
      id: 'maneuver-casing',
      type: 'line',
      source: 'maneuver',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': this.theme.routeCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 18, 18] },
    });
    m.addLayer({
      id: 'maneuver-line',
      type: 'line',
      source: 'maneuver',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#ffffff', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 11] },
    });
    if (!m.hasImage('arrowhead')) m.addImage('arrowhead', arrowheadImage(), { pixelRatio: 2 });
    m.addLayer({
      id: 'maneuver-head',
      type: 'symbol',
      source: 'maneuver',
      filter: ['==', ['geometry-type'], 'Point'],
      layout: {
        'icon-image': 'arrowhead',
        'icon-rotate': ['get', 'bearing'],
        'icon-rotation-alignment': 'map',
        'icon-pitch-alignment': 'map',
        'icon-allow-overlap': true,
        'icon-ignore-placement': true,
        'icon-size': ['interpolate', ['linear'], ['zoom'], 14, 0.45, 18, 1.4],
      },
    });
  }

  private gradient() {
    const f = Math.min(0.9999, Math.max(0.0001, this.progressFrac));
    return ['step', ['line-progress'], this.theme.passed, f, this.theme.route] as unknown as maplibregl.ExpressionSpecification;
  }

  private routesFC(mainOnly: boolean): FeatureCollection {
    const features: Feature<LineString>[] = this.routes
      .map((r, idx) => ({
        type: 'Feature' as const,
        properties: { idx, selected: idx === this.selected },
        geometry: { type: 'LineString' as const, coordinates: r.geometry },
      }))
      .filter((f) => (mainOnly ? f.properties.selected : true));
    return { type: 'FeatureCollection', features };
  }

  showRoutes(routes: Route[], selected = 0) {
    this.routes = routes;
    this.selected = selected;
    this.progressFrac = 0;
    this.progressS = 0;
    const r = routes[selected];
    this.tunnelSpans = r ? tunnelsFromRoute(r) : [];
    this.refreshRouteData();
  }

  /** Tunnel stretches on the selected route (OSM detail replaces the router's flags during a drive). */
  setTunnels(spans: TunnelSpan[]) {
    this.tunnelSpans = spans;
    (this.map.getSource('tunnels') as GeoJSONSource | undefined)?.setData(this.tunnelFC());
  }

  private tunnelSpans: TunnelSpan[] = [];

  private tunnelFC(): FeatureCollection {
    const r = this.routes[this.selected];
    const features: Feature<LineString>[] = r
      ? this.tunnelSpans.map((t) => ({
          type: 'Feature' as const,
          properties: { id: t.id },
          geometry: { type: 'LineString' as const, coordinates: r.line.slice(t.fromS, t.toS) },
        }))
      : [];
    return { type: 'FeatureCollection', features };
  }

  private refreshRouteData() {
    (this.map.getSource('routes') as GeoJSONSource | undefined)?.setData(this.routesFC(false));
    (this.map.getSource('route-main') as GeoJSONSource | undefined)?.setData(this.routesFC(true));
    (this.map.getSource('tunnels') as GeoJSONSource | undefined)?.setData(this.tunnelFC());
    if (this.map.getLayer('route-line')) this.map.setPaintProperty('route-line', 'line-gradient', this.gradient());
  }

  clearRoutes() {
    this.routes = [];
    this.setManeuver(null, null);
    this.refreshRouteData();
  }

  setProgress(s: number) {
    this.progressS = s;
    const r = this.routes[this.selected];
    if (!r) return;
    const f = s / Math.max(1, r.line.length);
    if (Math.abs(f - this.progressFrac) < 0.0005) return;
    this.progressFrac = f;
    if (this.map.getLayer('route-line')) this.map.setPaintProperty('route-line', 'line-gradient', this.gradient());
  }

  /** White turn arrow drawn on the route around the next maneuver. */
  setManeuver(route: Route | null, step: Step | null) {
    if (!route || !step || step.type === 'arrive' || step.type === 'depart') {
      this.arrow = { type: 'FeatureCollection', features: [] };
    } else {
      const line = route.line;
      const coords = line.slice(Math.max(0, step.s - 35), Math.min(line.length, step.s + 28));
      const endS = Math.min(line.length, step.s + 28);
      this.arrow = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: coords } },
          {
            type: 'Feature',
            properties: { bearing: line.bearingAt(endS - 6, 6) },
            geometry: { type: 'Point', coordinates: line.pointAt(endS) },
          },
        ],
      };
    }
    (this.map.getSource('maneuver') as GeoJSONSource | undefined)?.setData(this.arrow);
  }

  setPuck(p: LngLat | null, heading = 0) {
    this.puckAt = p;
    if (!p) {
      this.puck.remove();
      return;
    }
    this.puck.setLngLat(p).setRotation(heading);
    if (!this.puck.getElement().isConnected) this.puck.addTo(this.map);
  }

  setDestination(p: LngLat | null) {
    if (!p) {
      this.dest.remove();
      return;
    }
    this.dest.setLngLat(p);
    if (!this.dest.getElement().isConnected) this.dest.addTo(this.map);
  }

  /** Numbered pins for search results. */
  setResultMarkers(points: { lngLat: LngLat; label: string; title: string }[], onClick: (i: number) => void) {
    for (const m of this.resultMarkers) m.remove();
    this.resultMarkers = points.map((p, i) => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'result-pin';
      el.textContent = p.label;
      el.title = p.title;
      el.setAttribute('aria-label', p.title);
      el.addEventListener('click', (e) => {
        e.stopPropagation();
        onClick(i);
      });
      return new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat(p.lngLat).addTo(this.map);
    });
  }

  fitPoints(points: LngLat[], padding: { top: number; bottom: number; left: number; right: number }) {
    if (!points.length) return;
    if (points.length === 1) return this.flyTo(points[0], 15);
    const xs = points.map((p) => p[0]);
    const ys = points.map((p) => p[1]);
    this.fit(
      [
        [Math.min(...xs), Math.min(...ys)],
        [Math.max(...xs), Math.max(...ys)],
      ],
      padding,
    );
  }

  /** Centre on a point with the camera flat and north-up (for previewing a maneuver). */
  showPoint(p: LngLat, bearing = 0, zoom = 17) {
    this.following = false;
    this.followCb?.();
    this.map.easeTo({ center: p, zoom, bearing, pitch: 45, duration: 600 });
  }

  startFollowing() {
    this.following = true;
    this.followCb?.();
  }

  /** The follow camera's scale: 'auto' or a fixed width of map in metres (100 m to 1 km). */
  get followScale(): FollowScale {
    return this.scale;
  }
  setFollowScale(s: FollowScale) {
    this.scale = s === 'auto' ? 'auto' : clampSpan(s);
    if (this.scale !== 'auto') this.spanNow = this.scale;
    this.followCb?.();
  }
  /** The scale right now (what the scale bar stands for at the car), metres. */
  get followSpan(): number {
    return this.spanNow;
  }
  /** Called when following starts or stops or the scale changes. */
  onFollowChange(cb: () => void) {
    this.followCb = cb;
  }
  /** A zoom gesture ended: its zoom becomes the follow scale, and the camera catches up. */
  private finishUserZoom() {
    this.userZooming = false;
    if (!this.following) return;
    // Settle on the nearest detent (100, 150, 200, 300, 500, 700 m or 1 km).
    this.scale = nearestDetent(clampSpan(spanAtZoom(this.map.getZoom(), this.map.getCenter().lat, SCALE_PX * 0.98)));
    this.spanNow = this.scale;
    this.followCb?.();
    this.flushFollow();
  }

  private flushFollow() {
    const args = this.pendingFollow;
    this.pendingFollow = null;
    if (args) this.follow(...args);
  }

  /** Move the camera now (recenter), without waiting for the update window. */
  followNow(p: LngLat, heading: number, o: FollowOptions) {
    this.lastFollow = 0;
    this.pendingFollow = null;
    this.follow(p, heading, o);
  }

  /** Apply the camera again at the last position (after the scale changed). */
  refollow() {
    const args = this.pendingFollow ?? this.lastArgs;
    this.pendingFollow = null;
    if (!args) return;
    this.lastFollow = 0;
    this.follow(...args);
  }
  private lastArgs: [LngLat, number, FollowOptions] | null = null;
  private wheelAcc = 0;

  private holding = false;
  private scale: FollowScale = 'auto';
  private spanNow = 200;
  private userZooming = false;
  private followCb: (() => void) | null = null;

  private lastFollow = 0;

  follow(p: LngLat, heading: number, o: FollowOptions) {
    if (!this.following) return;
    // Let a gesture finish before the camera moves again (the latest position waits).
    if (this.userZooming || this.holding) {
      this.pendingFollow = [p, heading, o];
      return;
    }
    const now = performance.now();
    const since = now - this.lastFollow;
    if (since < 180) {
      // Position updates can arrive at 10 Hz and easing that often only lags; keep the latest
      // one and apply it when the window ends, so a final update (pause, jump) is never lost.
      this.pendingFollow = [p, heading, o];
      if (!this.followTimer) {
        this.followTimer = window.setTimeout(() => {
          this.followTimer = 0;
          const args = this.pendingFollow;
          this.pendingFollow = null;
          if (args) this.follow(...args);
        }, 185 - since);
      }
      return;
    }
    this.pendingFollow = null;
    this.lastArgs = [p, heading, o];
    this.lastFollow = now;
    // Scale as the scale bar's length at the car, eased so the camera breathes in and out smoothly
    // instead of jumping when the next turn changes. The zoom puts the scale a hair under the bar's
    // full length, so the bar shows the round number itself.
    const target = this.scale === 'auto' ? autoSpan(o.speed, o.distToNext, o.wide) : this.scale;
    const k = Math.min(1, since / 1500);
    this.spanNow = Math.exp(Math.log(this.spanNow) + (Math.log(target) - Math.log(this.spanNow)) * (this.scale === 'auto' ? k : 1));
    const zoom = zoomForSpan(this.spanNow, p[1], SCALE_PX * 0.98);
    const c = this.map.getCenter();
    const far = Math.abs(c.lng - p[0]) + Math.abs(c.lat - p[1]) > 0.03;
    const opts = { center: p, bearing: heading, pitch: 55, zoom, padding: o.padding };
    if (far) this.map.jumpTo(opts);
    else this.map.easeTo({ ...opts, duration: Math.min(1100, since * 1.05), easing: (t: number) => t });
  }
  private followTimer = 0;
  private pendingFollow: [LngLat, number, FollowOptions] | null = null;

  fit(bounds: LngLatBoundsLike, padding: { top: number; bottom: number; left: number; right: number }) {
    this.following = false;
    this.followCb?.();
    this.map.fitBounds(bounds, { padding, duration: 700, bearing: 0, pitch: 0, maxZoom: 16 });
  }

  flyTo(p: LngLat, zoom = 14) {
    this.map.jumpTo({ center: p, zoom });
  }
}

function arrowheadImage(): ImageData {
  const s = 64;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#ffffff';
  ctx.strokeStyle = '#0b2f6b';
  ctx.lineWidth = 4;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(s / 2, 4);
  ctx.lineTo(s - 6, s - 10);
  ctx.lineTo(6, s - 10);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  return ctx.getImageData(0, 0, s, s);
}

export function routeBounds(routes: Route[]): LngLatBoundsLike {
  let w = Infinity;
  let s = Infinity;
  let e = -Infinity;
  let n = -Infinity;
  for (const r of routes)
    for (const [x, y] of r.geometry) {
      w = Math.min(w, x);
      s = Math.min(s, y);
      e = Math.max(e, x);
      n = Math.max(n, y);
    }
  return [
    [w, s],
    [e, n],
  ];
}
