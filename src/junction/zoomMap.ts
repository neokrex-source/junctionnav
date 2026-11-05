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

export class ZoomMap {
  private map: maplibregl.Map | null = null;
  private marker: maplibregl.Marker | null = null;
  private data: FeatureCollection = { type: 'FeatureCollection', features: [] };
  private style: string | StyleSpecification;
  /** Flyovers, ramps and underpasses of the current junction, standing up on the map. */
  private layer3d = new JunctionLayer3D();
  private night = false;

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

  /** Moves the car; true when it rides on the 3D route (near a junction drawn in 3D). */
  updatePuck(p: LngLat, heading: number): boolean {
    if (!this.map || !this.marker) return false;
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
