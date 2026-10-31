import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { detectJunctions } from '../src/junction/detect';
import { buildScene } from '../src/junction/scene';
import { normalizeOsrm } from '../src/routing/osrm';

const demo = buildDemo();
const route = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
const js = detectJunctions(route);

describe('demo junction scenes', () => {
  it('detects the five decision points', () => {
    expect(js.map((j) => j.kind)).toEqual(['fork', 'entry', 'merge', 'fork', 'exit']);
  });

  it('builds the flyover split from OSM with the route climbing', () => {
    const sc = buildScene(route, js[0], demo.osm);
    const taken = sc.roads.find((r) => r.role === 'taken')!;
    expect(sc.source).toBe('osm');
    expect(Math.max(...taken.h)).toBeGreaterThan(5);
    expect(sc.vertical).toBe('up');
  });

  it('builds the exit with the ramp dropping into a tunnel', () => {
    const sc = buildScene(route, js[4], demo.osm);
    const taken = sc.roads.find((r) => r.role === 'taken')!;
    expect(sc.source).toBe('osm');
    expect(Math.min(...taken.h)).toBeLessThan(-5);
    expect(sc.vertical).toBe('down');
    expect(sc.exitRef).toBe('114');
    expect(sc.junctionName).toBe('Sungai Buloh');
    const signs = [...sc.signs].sort((a, b) => a.order - b.order);
    expect(signs[0].taken).toBe(true); // left exit in left-hand traffic
    expect(signs[0].places).toContain('Sungai Buloh');
  });

  it('lines lane groups up with the router lanes at a fork', () => {
    const sc = buildScene(route, js[3], demo.osm);
    const taken = sc.signs.find((s) => s.taken)!;
    const other = sc.signs.find((s) => !s.taken)!;
    expect(taken.laneCount).toBe(2);
    expect(other.laneCount).toBe(2);
    expect(taken.lateral).toBeGreaterThan(other.lateral);
  });

  it('falls back to a schematic scene without OSM data', () => {
    for (const j of js) {
      const sc = buildScene(route, j, null);
      expect(sc.source).toBe('schematic');
      expect(sc.roads.length).toBeGreaterThanOrEqual(2);
      expect(sc.signs.some((s) => s.taken)).toBe(true);
    }
  });
});
