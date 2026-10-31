import type { StyleSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { Settings } from '../state/settings';

export interface StyleDef {
  id: string;
  label: string;
  needsKey?: boolean;
  /** Style to use at night, if different. */
  night?: string;
  url: (s: Settings) => string;
}

export const STYLES: StyleDef[] = [
  { id: 'ofm-liberty', label: 'OpenFreeMap Liberty', night: 'ofm-dark', url: () => 'https://tiles.openfreemap.org/styles/liberty' },
  { id: 'ofm-bright', label: 'OpenFreeMap Bright', night: 'ofm-dark', url: () => 'https://tiles.openfreemap.org/styles/bright' },
  { id: 'ofm-positron', label: 'OpenFreeMap Positron', night: 'ofm-dark', url: () => 'https://tiles.openfreemap.org/styles/positron' },
  { id: 'ofm-dark', label: 'OpenFreeMap Dark', url: () => 'https://tiles.openfreemap.org/styles/dark' },
  {
    id: 'maptiler-streets',
    label: 'MapTiler Streets (key)',
    needsKey: true,
    night: 'maptiler-dark',
    url: (s) => `https://api.maptiler.com/maps/streets-v2/style.json?key=${encodeURIComponent(s.maptilerKey)}`,
  },
  {
    id: 'maptiler-dark',
    label: 'MapTiler Streets Dark (key)',
    needsKey: true,
    url: (s) => `https://api.maptiler.com/maps/streets-v2-dark/style.json?key=${encodeURIComponent(s.maptilerKey)}`,
  },
  {
    id: 'maptiler-hybrid',
    label: 'MapTiler Satellite + roads (key)',
    needsKey: true,
    url: (s) => `https://api.maptiler.com/maps/hybrid/style.json?key=${encodeURIComponent(s.maptilerKey)}`,
  },
  { id: 'custom', label: 'Custom style URL', url: (s) => s.customStyleUrl },
];

export function resolveStyle(s: Settings, night: boolean): string {
  let def = STYLES.find((d) => d.id === s.mapStyle) ?? STYLES[0];
  if (def.needsKey && !s.maptilerKey) def = STYLES[0];
  if (def.id === 'custom' && !s.customStyleUrl) def = STYLES[0];
  if (night && def.night) def = STYLES.find((d) => d.id === def.night) ?? def;
  return def.url(s);
}

export const FALLBACK_STYLE = 'https://tiles.openfreemap.org/styles/liberty';

/** Plain style for the offline demo network. */
export function demoStyle(geojson: FeatureCollection, night: boolean): StyleSpecification {
  const c = night
    ? { land: '#141b18', minor: '#3a4440', major: '#56605b', motorway: '#6d7a73', casing: '#0b100e', label: '#c9d4ce', wood: '#1d2b22' }
    : { land: '#e4ebe0', minor: '#ffffff', major: '#fff1b8', motorway: '#ffc65c', casing: '#9aa59e', label: '#33403a', wood: '#cbdcc0' };
  // Zoom must be the input of a top-level interpolate; the stops can be data expressions.
  const zw = (wExpr: unknown) => ['interpolate', ['exponential', 1.6], ['zoom'], 12, ['*', wExpr, 0.6], 16, ['*', wExpr, 3.4], 19, ['*', wExpr, 14]];
  const cls = ['match', ['get', 'highway'], ['motorway', 'motorway_link'], 'motorway', ['trunk', 'trunk_link', 'primary', 'primary_link'], 'major', 'minor'];
  const colour = ['match', cls, 'motorway', c.motorway, 'major', c.major, c.minor];
  const w = ['match', cls, 'motorway', 3.2, 'major', 2.6, 1.8];
  return {
    version: 8,
    sources: { demo: { type: 'geojson', data: geojson } },
    layers: [
      { id: 'land', type: 'background', paint: { 'background-color': c.land } },
      {
        id: 'wood',
        type: 'fill',
        source: 'demo',
        filter: ['==', ['geometry-type'], 'Polygon'],
        paint: { 'fill-color': c.wood, 'fill-outline-color': c.wood },
      },
      {
        id: 'roads-tunnel',
        type: 'line',
        source: 'demo',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['==', ['get', 'tunnel'], 'yes']],
        paint: { 'line-color': c.casing, 'line-width': zw(2), 'line-dasharray': [1, 1] },
      },
      {
        id: 'roads-casing',
        type: 'line',
        source: 'demo',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'tunnel'], 'yes']],
        layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'layer'] },
        paint: { 'line-color': c.casing, 'line-width': zw(['+', w, 0.8]) },
      },
      {
        id: 'roads',
        type: 'line',
        source: 'demo',
        filter: ['all', ['==', ['geometry-type'], 'LineString'], ['!=', ['get', 'tunnel'], 'yes']],
        layout: { 'line-cap': 'round', 'line-join': 'round', 'line-sort-key': ['get', 'layer'] },
        paint: { 'line-color': colour, 'line-width': zw(w) },
      },
    ] as StyleSpecification['layers'],
  };
}
