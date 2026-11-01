import type { StyleSpecification } from 'maplibre-gl';
import type { FeatureCollection } from 'geojson';
import type { Settings } from '../state/settings';
import { themeFor } from '../theme/palette';
import { techStyle } from './techStyle';

export interface StyleDef {
  id: string;
  label: string;
  needsKey?: boolean;
  /** Style to use at night, if different. */
  night?: string;
  url: (s: Settings) => string;
  /** Inline style instead of a URL. */
  spec?: (night: boolean, s: Settings) => StyleSpecification;
}

const CARTO_ATTRIBUTION =
  '© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap</a> contributors © <a href="https://carto.com/attributions" target="_blank" rel="noopener">CARTO</a>';

function cartoRaster(night: boolean): StyleSpecification {
  const path = night ? 'dark_all' : 'rastertiles/voyager';
  return {
    version: 8,
    sources: {
      carto: {
        type: 'raster',
        tiles: ['a', 'b', 'c', 'd'].map((s) => `https://${s}.basemaps.cartocdn.com/${path}/{z}/{x}/{y}@2x.png`),
        tileSize: 256,
        maxzoom: 20,
        attribution: CARTO_ATTRIBUTION,
      },
    },
    layers: [
      { id: 'bg', type: 'background', paint: { 'background-color': night ? '#1b1d21' : '#f2efe9' } },
      { id: 'carto', type: 'raster', source: 'carto' },
    ],
  };
}

/** One object per mode, so style comparisons by identity stay stable. */
const RASTER = { day: cartoRaster(false), night: cartoRaster(true) };

/**
 * A different provider (CARTO raster tiles, labels drawn into the images) for when the
 * vector style or its tiles cannot load. Needs no fonts or sprites.
 */
export function fallbackStyle(night: boolean): StyleSpecification {
  return night ? RASTER.night : RASTER.day;
}

export const STYLES: StyleDef[] = [
  { id: 'tech', label: 'JunctionNav (day and night)', url: () => '', spec: (night, s) => techStyle(night, s.lang) },
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
  { id: 'carto', label: 'Simple map (CARTO, works on slow connections)', url: () => '', spec: fallbackStyle },
  { id: 'custom', label: 'Custom style URL', url: (s) => s.customStyleUrl },
];

export function resolveStyle(s: Settings, night: boolean): string | StyleSpecification {
  let def = STYLES.find((d) => d.id === s.mapStyle) ?? STYLES[0];
  if (def.needsKey && !s.maptilerKey) def = STYLES[0];
  if (def.id === 'custom' && !s.customStyleUrl) def = STYLES[0];
  if (def.spec) return def.spec(night, s);
  if (night && def.night) def = STYLES.find((d) => d.id === def.night) ?? def;
  return def.url(s);
}

/** Plain style for the offline demo network. */
export function demoStyle(geojson: FeatureCollection, night: boolean): StyleSpecification {
  // The JunctionNav map palette, so the demo looks like the real map.
  const m = themeFor(night).map;
  const c = { land: m.land, minor: m.minor, major: m.major, motorway: m.highway, casing: m.highwayCase, label: m.label, wood: m.wood, tunnel: m.tunnel };
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
        paint: { 'line-color': c.tunnel, 'line-width': zw(2), 'line-dasharray': [1, 1] },
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
