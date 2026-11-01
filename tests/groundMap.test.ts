import { describe, expect, it } from 'vitest';
import { layers, namedFlavor } from '@protomaps/basemaps';
import type { StyleSpecification } from 'maplibre-gl';
import { analyse, groundLayers, isGreen, toneDay } from '../src/junction/groundMap';
import { buildOverpassQuery } from '../src/junction/osmdata';
import { buildDemo } from '../src/demo/network';
import { demoStyle } from '../src/map/styles';

const protomaps = (): StyleSpecification =>
  ({
    version: 8,
    glyphs: 'offline://fonts/{fontstack}/{range}.pbf',
    sources: { protomaps: { type: 'vector', url: 'pmtiles://x' } },
    layers: layers('protomaps', namedFlavor('light'), { lang: 'en' }),
  }) as StyleSpecification;

describe('map under the 3D junction view', () => {
  it('keeps what lies on the ground and drops labels, bridges and tunnels', () => {
    const src = protomaps();
    const out = groundLayers(src);
    const ids = out.layers.map((l) => l.id);
    expect(ids).toContain('earth');
    expect(ids).toContain('water');
    expect(ids).toContain('buildings');
    expect(ids).toContain('roads_minor');
    expect(ids).toContain('roads_highway');
    expect(out.layers.some((l) => l.type === 'symbol')).toBe(false);
    expect(ids.some((id) => /bridge|tunnel|boundar/.test(id))).toBe(false);
    // The source style is left alone.
    expect(src.layers.some((l) => l.id === 'roads_bridges_highway')).toBe(true);
  });

  it('lays building extrusions flat and filters bridges out of GeoJSON roads', () => {
    const style: StyleSpecification = {
      version: 8,
      sources: { omt: { type: 'vector', url: 'x' } },
      layers: [
        { id: 'building-3d', type: 'fill-extrusion', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-extrusion-color': '#e0d5c8', 'fill-extrusion-height': 10 } },
        { id: 'bridge_motorway', type: 'line', source: 'omt', 'source-layer': 'transportation' },
      ],
      terrain: { source: 'omt' },
    };
    const out = groundLayers(style);
    expect(out.layers).toEqual([{ id: 'building-3d', type: 'fill', source: 'omt', 'source-layer': 'building', minzoom: 14, paint: { 'fill-color': '#e0d5c8', 'fill-opacity': 1 } }]);
    expect(out.terrain).toBeUndefined();
    const demo = groundLayers(demoStyle(buildDemo().geojson, false));
    const roads = demo.layers.find((l) => l.id === 'roads') as { filter: unknown[] };
    expect(JSON.stringify(roads.filter)).toContain('bridge');
    expect(demo.layers.some((l) => l.id === 'roads-tunnel')).toBe(false);
  });

  it('finds the plain land colour and the green parts of the image', () => {
    const n = 4;
    const px = new Uint8ClampedArray(n * n * 4);
    for (let i = 0; i < n * n; i++) px.set(i < 4 ? [156, 211, 160, 255] : [226, 223, 218, 255], i * 4);
    const { land, mask, usable } = analyse(px, n);
    expect(land).toBe('#e4dcdc');
    expect(usable).toBe(true);
    expect(analyse(new Uint8ClampedArray(n * n * 4), n).usable).toBe(false);
    expect(analyse(new Uint8ClampedArray(n * n * 4).fill(200), n).usable).toBe(false);
    expect([...mask].slice(0, 5)).toEqual([1, 1, 1, 1, 0]);
    expect(isGreen(40, 70, 45)).toBe(true); // night park
    expect(isGreen(170, 210, 240)).toBe(false); // water
    expect(isGreen(200, 200, 200)).toBe(false);
  });

  it('adds contrast to day maps only', () => {
    const day = new Uint8ClampedArray([226, 223, 218, 255, 255, 255, 255, 255]);
    toneDay(day);
    expect(day[0]).toBeLessThan(205);
    expect(day[4]).toBe(240);
    const night = new Uint8ClampedArray([28, 28, 30, 255, 60, 60, 64, 255]);
    toneDay(night);
    expect([...night]).toEqual([28, 28, 30, 255, 60, 60, 64, 255]);
  });

  it('asks Overpass for main roads and bridges further out than side streets', () => {
    const q = buildOverpassQuery([[101.7, 3.1]], 450);
    expect(q).toContain('way(around:450,3.100000,101.700000)["highway"~"^(motorway|trunk|primary|secondary|tertiary|unclassified');
    expect(q).toContain('way(around:900,3.100000,101.700000)["highway"~"^(motorway|trunk|primary|secondary|tertiary)(_link)?$"];');
    expect(q).toContain('["bridge"]["bridge"!="no"];');
    expect(q).toContain('["tunnel"]["tunnel"!="no"];');
    expect(buildOverpassQuery([[101.7, 3.1]], 450, 450)).not.toContain('around:900');
  });
});
