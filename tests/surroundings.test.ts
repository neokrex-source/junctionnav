import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { DemoSurroundProvider } from '../src/demo/providers';
import { LocalFrame } from '../src/geo/geo';
import { detectJunctions } from '../src/junction/detect';
import { buildScene } from '../src/junction/scene';
import { buildingInfo, buildSurroundQuery, inRing, parseSurround, surroundScene } from '../src/junction/surroundings';
import { normalizeOsrm } from '../src/routing/osrm';

describe('surroundings data', () => {
  it('asks Overpass for buildings, land use and places around one point', () => {
    const q = buildSurroundQuery([101.6, 3.1]);
    expect(q).toContain('way(around:450,3.100000,101.600000)["building"]');
    expect(q).toContain('"landuse"~');
    expect(q).toContain('"place"~');
    expect(q).toContain('out tags geom 4000;');
  });

  it('reads heights from tags with sensible defaults', () => {
    expect(buildingInfo({ building: 'yes', height: '24 m' })).toEqual({ height: 24, kind: 'block' });
    expect(buildingInfo({ building: 'apartments', 'building:levels': '20' }).kind).toBe('tower');
    expect(buildingInfo({ building: 'house' })).toEqual({ height: 7, kind: 'house' });
    expect(buildingInfo({ building: 'warehouse' }).kind).toBe('industrial');
    expect(buildingInfo({ building: 'roof' }).kind).toBe('roof');
  });

  it('splits Overpass output into ways, relations and points of interest', () => {
    const d = parseSurround({
      elements: [
        { type: 'way', id: 1, tags: { building: 'yes' }, geometry: [{ lat: 0, lon: 0 }, { lat: 0, lon: 0.001 }, { lat: 0.001, lon: 0.001 }, { lat: 0, lon: 0 }] },
        { type: 'relation', id: 2, tags: { type: 'multipolygon', natural: 'water' }, members: [{ role: 'outer', geometry: [{ lat: 0, lon: 0 }] }] },
        { type: 'node', id: 3, lat: 0.001, lon: 0.002, tags: { amenity: 'fuel', name: 'Station' } },
        { type: 'way', id: 4, center: { lat: 0.002, lon: 0.002 }, tags: { highway: 'services', name: 'R&R' } },
      ],
    });
    expect(d.ways.length).toBe(1);
    expect(d.rels.length).toBe(1);
    expect(d.pois.map((p) => p.tags.name)).toEqual(['Station', 'R&R']);
  });

  it('drops buildings that sit on a drawn road and keeps the rest', () => {
    const frame = new LocalFrame([101, 3]);
    const g = (pts: [number, number][]) => pts.map(([x, y]) => {
      const [lon, lat] = frame.toLngLat(x, y);
      return { lat, lon };
    });
    const square = (cx: number, cy: number) => g([[cx - 5, cy - 5], [cx + 5, cy - 5], [cx + 5, cy + 5], [cx - 5, cy + 5], [cx - 5, cy - 5]]);
    const road = {
      id: 'r', role: 'context' as const, cls: 'major' as const, pts: [[0, -200], [0, 200]] as [number, number][], h: [0, 0], width: [7, 7], lanes: [2, 2],
      laneWidth: 3.5, shoulder: 0.5, oneway: false, guardrail: false, tunnel: [false, false], s: [0, 400], name: 'Jalan Ujian',
    };
    const sc = surroundScene(
      { ways: [{ id: 1, tags: { building: 'yes' }, geometry: square(0, 50) }, { id: 2, tags: { building: 'yes' }, geometry: square(40, 50) }], rels: [], pois: [] },
      frame,
      [road],
    );
    expect(sc.buildings.length).toBe(1);
    expect(sc.labels[0].text).toBe('Jalan Ujian');
  });

  it('tests points against rings', () => {
    const ring: [number, number][] = [[0, 0], [10, 0], [10, 10], [0, 10]];
    expect(inRing([5, 5], ring)).toBe(true);
    expect(inRing([15, 5], ring)).toBe(false);
  });
});

describe('demo surroundings in junction scenes', () => {
  it('puts buildings, land use and labels around the demo junctions', async () => {
    const demo = buildDemo();
    const route = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
    const surround = await new DemoSurroundProvider().fetch();
    const js = detectJunctions(route);
    const flyover = buildScene(route, js[0], demo.osm, { surround }).surround!;
    expect(flyover.buildings.length).toBeGreaterThan(20);
    expect(flyover.labels.some((l) => l.text === 'Jalan Kampung')).toBe(true);
    const merge = buildScene(route, js[2], demo.osm, { surround }).surround!;
    expect(merge.areas.some((a) => a.kind === 'palm')).toBe(true);
    const exit = buildScene(route, js[4], demo.osm, { surround }).surround!;
    expect(exit.labels.some((l) => l.text === 'Jalan Atas')).toBe(true);
    expect(exit.buildings.some((b) => b.kind === 'industrial')).toBe(true);
    // Without surroundings the scene is unchanged apart from the missing layer.
    expect(buildScene(route, js[4], demo.osm).surround).toBeUndefined();
  });
});
