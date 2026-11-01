import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { detectJunctions } from '../src/junction/detect';
import { buildScene } from '../src/junction/scene';
import { JunctionLayer3D, mercator } from '../src/junction/zoom3d';
import { normalizeOsrm } from '../src/routing/osrm';

const demo = buildDemo();
const route = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
const js = detectJunctions(route);

describe('3D roads in the zoomed map', () => {
  it('matches MapLibre mercator units', () => {
    const [x, y, m] = mercator([0, 0]);
    expect(x).toBeCloseTo(0.5, 9);
    expect(y).toBeCloseTo(0.5, 9);
    expect(1 / m).toBeCloseTo(2 * Math.PI * 6371008.8, 0);
    expect(mercator([101.7, 3.15])[1]).toBeLessThan(0.5); // north of the equator is up
  });

  it('stands up the flyover and the exit underpass, and puts the car on the route', () => {
    const layer = new JunctionLayer3D();
    layer.setScene(buildScene(route, js[0], demo.osm), false);
    expect(layer.meshCount).toBeGreaterThanOrEqual(5); // shadow, walls, pillars, deck, route
    expect(layer.active).toBe(true);
    // On the route near the split, the car is placed; far away it is not.
    expect(layer.setCar(js[0].location, 0)).toBe(true);
    expect(layer.setCar([js[0].location[0] + 0.05, js[0].location[1]], 0)).toBe(false);
    layer.setScene(buildScene(route, js[4], demo.osm), true);
    expect(layer.meshCount).toBeGreaterThanOrEqual(5);
    layer.setScene(null, false);
    expect(layer.active).toBe(false);
  });
});
