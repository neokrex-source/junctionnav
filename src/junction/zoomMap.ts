/** Tilted close-up of the real map at the junction (the "zoomed map" junction view). */
import maplibregl, { type GeoJSONSource, type StyleSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { LngLat } from '../geo/geo';
import type { Route } from '../routing/types';
import type { JunctionCandidate } from './detect';

export class ZoomMap {
  private map: maplibregl.Map | null = null;
  private marker: maplibregl.Marker | null = null;
  private data: FeatureCollection = { type: 'FeatureCollection', features: [] };
  private style: string | StyleSpecification;

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
      fadeDuration: 0,
    });
    map.on('style.load', () => {
      map.addSource('jv-route', { type: 'geojson', data: this.data });
      map.addLayer({
        id: 'jv-route-casing',
        type: 'line',
        source: 'jv-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#0b3f99', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 10, 18, 26] },
      });
      map.addLayer({
        id: 'jv-route',
        type: 'line',
        source: 'jv-route',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#1f78ff', 'line-width': ['interpolate', ['linear'], ['zoom'], 15, 6, 18, 18] },
      });
    });
    const el = document.createElement('div');
    el.className = 'puck';
    el.innerHTML =
      '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="17" fill="#fff"/><circle cx="20" cy="20" r="14" fill="#1f78ff"/><path d="M20 8 L28.5 28 L20 23.5 L11.5 28 Z" fill="#fff"/></svg>';
    this.marker = new maplibregl.Marker({ element: el, rotationAlignment: 'map', pitchAlignment: 'map' });
    this.map = map;
    return map;
  }

  setStyle(style: string | StyleSpecification) {
    this.style = style;
    this.map?.setStyle(style);
  }

  show(route: Route, cand: JunctionCandidate) {
    const map = this.ensure();
    const line = route.line;
    this.data = {
      type: 'FeatureCollection',
      features: [
        {
          type: 'Feature',
          properties: {},
          geometry: { type: 'LineString', coordinates: line.slice(Math.max(0, cand.s - 900), Math.min(line.length, cand.s + 500)) },
        },
      ],
    };
    (map.getSource('jv-route') as GeoJSONSource | undefined)?.setData(this.data);
    map.resize();
    map.jumpTo({
      center: line.pointAt(Math.min(line.length, cand.s + 30)),
      bearing: line.bearingAt(Math.max(0, cand.s - 90), 90),
      zoom: 17.2,
      pitch: 58,
    });
  }

  updatePuck(p: LngLat, heading: number) {
    if (!this.map || !this.marker) return;
    this.marker.setLngLat(p).setRotation(heading);
    if (!this.marker.getElement().isConnected) this.marker.addTo(this.map);
  }

  resize() {
    this.map?.resize();
  }
}
