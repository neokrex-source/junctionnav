/** Main map: routes, progress, maneuver arrow, position puck and follow camera. */
import maplibregl, { type GeoJSONSource, type LngLatBoundsLike, type StyleSpecification } from 'maplibre-gl';
import type { Feature, FeatureCollection, LineString } from 'geojson';
import type { LngLat } from '../geo/geo';
import type { Route, Step } from '../routing/types';
import { FALLBACK_STYLE } from './styles';
import { tunnelsFromRoute, type TunnelSpan } from '../nav/tunnels';

const ROUTE_COLOR = '#1f78ff';
const ROUTE_CASING = '#0b3f99';
const PASSED_COLOR = '#8a96a3';

const PUCK_SVG = `<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="#fff"/><circle cx="20" cy="20" r="14" fill="${ROUTE_COLOR}"/><path d="M20 8 L28.5 28 L20 23.5 L11.5 28 Z" fill="#fff"/></svg>`;
const PIN_SVG = `<svg viewBox="0 0 30 40" aria-hidden="true"><path d="M15 39s13-12.3 13-23A13 13 0 0 0 2 16c0 10.7 13 23 13 23z" fill="#d93a3a" stroke="#fff" stroke-width="2"/><circle cx="15" cy="15.5" r="5" fill="#fff"/></svg>`;

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
  private suppressUserEvent = false;
  private userPanCb: (() => void) | null = null;
  private routeClickCb: ((idx: number) => void) | null = null;
  private resultMarkers: maplibregl.Marker[] = [];

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
    this.map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left');
    const puckEl = document.createElement('div');
    puckEl.className = 'puck';
    puckEl.innerHTML = PUCK_SVG;
    this.puck = new maplibregl.Marker({ element: puckEl, rotationAlignment: 'map', pitchAlignment: 'map' });
    const pinEl = document.createElement('div');
    pinEl.className = 'dest-pin';
    pinEl.innerHTML = PIN_SVG;
    this.dest = new maplibregl.Marker({ element: pinEl, anchor: 'bottom' });

    this.map.on('style.load', () => this.installLayers());
    this.map.on('error', (e) => {
      const msg = String((e as { error?: Error }).error?.message ?? '');
      if (typeof this.currentStyle !== 'string') console.warn('[map]', msg);
      // Only fall back when the style we asked for is a remote URL that failed to load.
      const wanted = this.currentStyle;
      if (
        typeof wanted === 'string' &&
        wanted !== FALLBACK_STYLE &&
        !this.styleFailed &&
        !this.map.isStyleLoaded() &&
        /style|404|Failed to fetch|NetworkError/i.test(msg)
      ) {
        this.styleFailed = true;
        console.warn('[map] style failed, falling back', msg);
        this.setStyle(FALLBACK_STYLE, true);
      }
    });
    const userMove = (e: { originalEvent?: unknown }) => {
      if (e.originalEvent && !this.suppressUserEvent) {
        this.following = false;
        this.userPanCb?.();
      }
    };
    this.map.on('dragstart', userMove);
    this.map.on('rotatestart', userMove);
    this.map.on('pitchstart', userMove);
    this.map.on('zoomstart', userMove);
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
    if (!keepFailed) this.styleFailed = false;
    this.currentStyle = style;
    this.map.setStyle(style, { diff: false });
  }

  get isFollowing() {
    return this.following;
  }

  private beforeId(): string | undefined {
    const layers = this.map.getStyle()?.layers ?? [];
    return layers.find((l) => l.type === 'symbol')?.id;
  }

  private installLayers() {
    const m = this.map;
    if (m.getSource('routes')) return;
    m.addSource('routes', { type: 'geojson', data: this.routesFC(false) });
    m.addSource('route-main', { type: 'geojson', data: this.routesFC(true), lineMetrics: true });
    m.addSource('maneuver', { type: 'geojson', data: this.arrow });
    m.addSource('tunnels', { type: 'geojson', data: this.tunnelFC() });
    const before = this.beforeId();
    m.addLayer(
      {
        id: 'route-alt',
        type: 'line',
        source: 'routes',
        filter: ['!=', ['get', 'selected'], true],
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#9aa8b5', 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 4, 16, 10] },
      },
      before,
    );
    m.addLayer(
      {
        id: 'route-casing',
        type: 'line',
        source: 'route-main',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': ROUTE_CASING, 'line-width': ['interpolate', ['linear'], ['zoom'], 10, 6, 16, 14, 19, 26] },
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
    m.addLayer({
      id: 'maneuver-casing',
      type: 'line',
      source: 'maneuver',
      layout: { 'line-cap': 'butt', 'line-join': 'round' },
      paint: { 'line-color': '#0b2f6b', 'line-width': ['interpolate', ['linear'], ['zoom'], 14, 6, 18, 18] },
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
    return ['step', ['line-progress'], PASSED_COLOR, f, ROUTE_COLOR] as unknown as maplibregl.ExpressionSpecification;
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
    this.suppressUserEvent = true;
    this.map.easeTo({ center: p, zoom, bearing, pitch: 45, duration: 600 });
    window.setTimeout(() => (this.suppressUserEvent = false), 700);
  }

  startFollowing() {
    this.following = true;
  }

  private lastFollow = 0;

  follow(p: LngLat, heading: number, o: FollowOptions) {
    if (!this.following) return;
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
    this.lastFollow = now;
    let zoom = o.speed > 24 ? 15.6 : o.speed > 14 ? 16.3 : 16.9;
    if (o.wide) zoom -= 0.9;
    else if (o.distToNext < 250) zoom += 0.5;
    this.suppressUserEvent = true;
    const c = this.map.getCenter();
    const far = Math.abs(c.lng - p[0]) + Math.abs(c.lat - p[1]) > 0.03;
    const opts = { center: p, bearing: heading, pitch: 55, zoom, padding: o.padding };
    if (far) this.map.jumpTo(opts);
    else this.map.easeTo({ ...opts, duration: Math.min(1100, since * 1.05), easing: (t: number) => t });
    window.clearTimeout(this.unsuppress);
    this.unsuppress = window.setTimeout(() => (this.suppressUserEvent = false), Math.min(1200, since * 1.1) + 50);
  }
  private unsuppress = 0;
  private followTimer = 0;
  private pendingFollow: [LngLat, number, FollowOptions] | null = null;

  fit(bounds: LngLatBoundsLike, padding: { top: number; bottom: number; left: number; right: number }) {
    this.suppressUserEvent = true;
    this.following = false;
    this.map.fitBounds(bounds, { padding, duration: 700, bearing: 0, pitch: 0, maxZoom: 16 });
    window.setTimeout(() => (this.suppressUserEvent = false), 800);
  }

  flyTo(p: LngLat, zoom = 14) {
    this.suppressUserEvent = true;
    this.map.jumpTo({ center: p, zoom });
    this.suppressUserEvent = false;
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
