/** Tilted close-up of the real map at the junction (the "zoomed map" junction view). */
import { PUCK_SVG } from '../map/mapView';
import { themeFor } from '../theme/palette';
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import { clamp, type LngLat } from '../geo/geo';
import type { Route } from '../routing/types';
import type { JunctionCandidate } from './detect';
import type { JunctionScene } from './scene';
import { JunctionLayer3D } from './zoom3d';
import { motionOk } from './pulse';

/**
 * The impulses on the flat route line from the car ahead (three streaks crossing `range` metres
 * in about 2.4 s, each fading in and out), kept off the stretch the 3D ribbon covers (it has its own).
 */
export function zoomPulses(line: Route['line'], s: number, covered: [number, number] | null, t: number): FeatureCollection {
  const left = line.length - s;
  const out: FeatureCollection = { type: 'FeatureCollection', features: [] };
  if (left < 30) return out;
  const range = Math.min(450, left);
  const len = 26;
  const speed = range / 2.4;
  for (let k = 0; k < 3; k++) {
    const d = (t * speed + (k * range) / 3) % range;
    let from = s + d;
    let to = Math.min(line.length, from + len);
    if (covered && from < covered[1] && to > covered[0]) {
      if (from >= covered[0] && to <= covered[1]) continue;
      if (from < covered[0]) to = covered[0];
      else from = covered[1];
    }
    if (to - from < 2) continue;
    const coordinates = line.slice(from, to);
    if (coordinates.length < 2) continue;
    out.features.push({ type: 'Feature', properties: { a: Math.pow(Math.sin((Math.PI * d) / range), 0.7) }, geometry: { type: 'LineString', coordinates } });
  }
  return out;
}

export class ZoomMap {
  private map: maplibregl.Map | null = null;
  private marker: maplibregl.Marker | null = null;
  private data: FeatureCollection = { type: 'FeatureCollection', features: [] };
  private style: string | StyleSpecification;
  /** Flyovers, ramps and underpasses of the current junction, standing up on the map. */
  private layer3d = new JunctionLayer3D();
  private night = false;
  /** For the impulses: the route, the stretch the 3D ribbon covers, and where the car is on it. */
  private route: Route | null = null;
  private covered: [number, number] | null = null;
  private carS: number | null = null;
  private fromS = 0;
  private pulseRaf = 0;
  private pulseLast = 0;

  constructor(
    private slot: HTMLElement,
    style: string | StyleSpecification,
  ) {
    this.style = style;
  }

  private ensure() {
    if (this.map) return this.map;
    const map = new maplibregl.Map({
      container: this.slot,
      style: this.style,
      interactive: false,
      attributionControl: false,
      center: [0, 0],
      zoom: 16,
      pitch: 58,
      maxPitch: 72,
      fadeDuration: 0,
    });
    map.on('style.load', () => {
      map.addSource('jv-route', { type: 'geojson', data: this.data });
      map.addLayer({
        id: 'jv-route-casing',
        type: 'line',
        source: 'jv-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': themeFor(this.night).junctionCasing, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 26] },
      });
      map.addLayer({
        id: 'jv-route',
        type: 'line',
        source: 'jv-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': themeFor(this.night).junction, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 6, 18, 18] },
      });
      // Impulses running along the route ahead of the car.
      map.addSource('jv-pulse', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
      map.addLayer({
        id: 'jv-pulse',
        type: 'line',
        source: 'jv-pulse',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#ffffff', 'line-opacity': ['*', 0.9, ['get', 'a']], 'line-blur': 1, 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 2.5, 18, 7] },
      });
      map.addLayer(this.layer3d);
    });
    const el = document.createElement('div');
    el.className = 'puck';
    el.innerHTML = PUCK_SVG;
    this.marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
    this.map = map;
    return map;
  }

  setStyle(style: string | StyleSpecification) {
    this.style = style;
    this.map?.setStyle(style);
  }

  /**
   * Shows the junction. With a scene, its roads stand up in 3D (elevated decks, sloping ramps,
   * underpasses) and the route rides on them; the flat route line is then kept away from them.
   */
  show(route: Route, cand: JunctionCandidate, scene: JunctionScene | null = null, night = false) {
    const map = this.ensure();
    const line = route.line;
    const from = Math.max(0, cand.s - 900);
    const to = Math.min(line.length, cand.s + 500);
    const covered: [number, number] | null = scene ? [cand.s + scene.route.s[0] + 6, cand.s + scene.route.s[scene.route.s.length - 1] - 6] : null;
    this.route = route;
    this.covered = covered;
    this.fromS = from;
    this.carS = null;
    const parts = covered
      ? [line.slice(from, Math.max(from, covered[0])), line.slice(Math.min(to, covered[1]), to)].filter((c) => c.length > 1)
      : [line.slice(from, to)];
    this.data = {
      type: 'FeatureCollection',
      features: parts.map((coordinates) => ({ type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates } })),
    };
    (map.getSource('jv-route') as GeoJSONSource | undefined)?.setData(this.data);
    if (night !== this.night) {
      this.night = night;
      const t = themeFor(night);
      if (map.getLayer('jv-route')) {
        map.setPaintProperty('jv-route', 'line-color', t.junction);
        map.setPaintProperty('jv-route-casing', 'line-color', t.junctionCasing);
      }
    }
    this.layer3d.setScene(scene, night);
    this.startPulse();
    const lifted = !!scene && Math.abs(scene.profile.peak.h) >= 2.5;
    map.resize();
    if (!lifted || !scene) {
      map.jumpTo({ center: line.pointAt(Math.min(line.length, cand.s + 30)), bearing: line.bearingAt(Math.max(0, cand.s - 90), 90), zoom: 17.2, pitch: 58 });
      return;
    }
    // Frame the climb or drop: look at the stretch between the split and the ramp's highest (or
    // lowest) point, from a little to the side, so the deck edges, pillars and walls show.
    const peakS = scene.profile.peak.s;
    const focus = cand.s + clamp(peakS * 0.55, -120, 180);
    const along = line.bearingAt(Math.max(0, cand.s - 60), 120);
    const towardRamp = Math.sign(scene.signs.find((x) => x.taken)?.lateral ?? 1) || 1;
    // Phones show a short panel: come a little closer there.
    const small = (this.slot.clientWidth || 400) < 560;
    map.jumpTo({
      center: line.pointAt(clamp(focus, 0, line.length)),
      bearing: along + 22 * towardRamp,
      zoom: small ? 17.6 : 17.3,
      pitch: 66,
    });
  }

  /** Runs the impulses while the map is on screen (stops by itself when it is not). */
  private startPulse() {
    if (this.pulseRaf || !this.map || !motionOk()) return;
    this.pulseRaf = requestAnimationFrame(this.pulseFrame);
  }

  private pulseFrame = (now: number) => {
    this.pulseRaf = 0;
    const map = this.map;
    if (!map || !this.route || !this.slot.isConnected || this.slot.offsetParent === null) return;
    this.pulseRaf = requestAnimationFrame(this.pulseFrame);
    if (document.hidden || now - this.pulseLast < 40) return;
    this.pulseLast = now;
    const t = now / 1000;
    (map.getSource('jv-pulse') as GeoJSONSource | undefined)?.setData(zoomPulses(this.route.line, this.carS ?? this.fromS, this.covered, t));
    if (this.layer3d.pulse(t)) map.triggerRepaint();
  };

  /** Moves the car (at `s` metres along the route, when known); true when it rides on the 3D route. */
  updatePuck(p: LngLat, heading: number, s?: number): boolean {
    if (!this.map || !this.marker) return false;
    if (s != null) this.carS = s;
    this.startPulse();
    // Near the junction the car rides on the 3D route at its real height.
    if (this.layer3d.active && this.layer3d.setCar(p, heading)) {
      this.marker.remove();
      return true;
    }
    this.marker.setLngLat(p).setRotation(heading);
    if (!this.marker.getElement().isConnected) this.marker.addTo(this.map);
    return false;
  }

  resize() {
    this.map?.resize();
  }
}
