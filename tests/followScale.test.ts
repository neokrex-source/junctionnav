import { describe, expect, it } from 'vitest';
import { autoSpan, CLOSE_SPAN, closeSpan, closeWeight, nearestDetent, pulseFeatures, roundScale, SCALE_DETENTS, SCALE_MAX, SCALE_MIN, SCALE_PX, SCALE_STEPS, spanAtZoom, THIN_BELOW, widthExpr, zoomForSpan } from '../src/map/mapView';

describe('navigation map scale', () => {
  it('is wider at expressway speed and closes in to 100 m at a turn', () => {
    expect(autoSpan(30, 5000)).toBe(300);
    expect(autoSpan(18, 5000)).toBe(200);
    expect(autoSpan(10, 5000)).toBe(150);
    expect(autoSpan(4, 5000)).toBe(120);
    // Approaching the next maneuver: about a third of the distance left.
    expect(autoSpan(30, 600)).toBe(240);
    expect(autoSpan(8, 150)).toBe(SCALE_MIN);
    expect(autoSpan(5, 20)).toBe(SCALE_MIN);
    // With the junction view open the map steps back to show the area around it.
    expect(autoSpan(10, 5000, true)).toBe(225);
    expect(autoSpan(30, 5000, true)).toBe(450);
    for (const [v, d, w] of [[0, 0, false], [40, 99999, true], [12, 300, false]] as const) {
      const s = autoSpan(v, d, w);
      expect(s).toBeGreaterThanOrEqual(SCALE_MIN);
      expect(s).toBeLessThanOrEqual(SCALE_MAX);
    }
  });

  it('means what the scale bar shows at the car', () => {
    // 100 px on screen stand for the scale: 100 m is street level, 1 km the area around.
    const z100 = zoomForSpan(100, 3.14, SCALE_PX);
    const z1k = zoomForSpan(1000, 3.14, SCALE_PX);
    expect(z100).toBeCloseTo(16.25, 1);
    expect(z1k).toBeCloseTo(12.93, 1);
    expect(z100 - z1k).toBeCloseTo(Math.log2(10), 5);
    expect(spanAtZoom(z1k, 3.14, SCALE_PX)).toBeCloseTo(1000, 6);
    // Further from the equator the same scale is a little further zoomed out.
    expect(zoomForSpan(1000, 35.7, SCALE_PX)).toBeLessThan(z1k);
  });

  it('rounds the bar to lengths a scale bar shows', () => {
    expect(roundScale(1020)).toBe(1000);
    expect(roundScale(999.5)).toBe(1000);
    expect(roundScale(520)).toBe(500);
    expect(roundScale(204)).toBe(200);
    expect(roundScale(160)).toBe(150);
    expect(roundScale(102)).toBe(100);
    expect(roundScale(74)).toBe(70);
    expect(roundScale(2600)).toBe(2000);
  });

  it('steps through auto, 1 km, 500 m, 200 m and 100 m, and pinches settle on detents', () => {
    expect(SCALE_STEPS).toEqual(['auto', 1000, 500, 200, 100]);
    expect(SCALE_DETENTS[0]).toBe(SCALE_MIN);
    expect(SCALE_DETENTS[SCALE_DETENTS.length - 1]).toBe(SCALE_MAX);
    expect(nearestDetent(120)).toBe(100);
    expect(nearestDetent(130)).toBe(150);
    expect(nearestDetent(240)).toBe(200);
    expect(nearestDetent(260)).toBe(300);
    expect(nearestDetent(850)).toBe(1000);
  });
});

describe('impulses along the route', () => {
  const line = {
    length: 5000,
    slice: (a: number, b: number) => [
      [101.7 + a / 1e5, 3.1],
      [101.7 + b / 1e5, 3.1],
    ] as [number, number][],
  };
  it('runs three streaks ahead of the car, sized to the map scale', () => {
    const f = pulseFeatures(line, 1000, 200, 0.37);
    expect(f.length).toBe(3);
    // A 200 m scale: a 1.6 km stretch ahead, streaks of 90 m.
    for (const p of f) {
      const [a, b] = p.geometry.coordinates.map((c) => (c[0] - 101.7) * 1e5);
      expect(a).toBeGreaterThanOrEqual(1000);
      expect(a).toBeLessThan(1000 + 1600);
      expect(b - a).toBeCloseTo(90, 5);
      expect(p.properties.a).toBeGreaterThanOrEqual(0);
      expect(p.properties.a).toBeLessThanOrEqual(1);
    }
  });
  it('moves forward over time and stays inside the route near the end', () => {
    const at = (t: number) => (pulseFeatures(line, 0, 200, t)[0].geometry.coordinates[0][0] - 101.7) * 1e5;
    expect(at(0.5)).toBeGreaterThan(at(0.4));
    const end = pulseFeatures(line, 4800, 200, 1.1);
    for (const p of end) expect((p.geometry.coordinates[1][0] - 101.7) * 1e5).toBeLessThanOrEqual(5000 + 1e-6);
    expect(pulseFeatures(line, 4990, 200, 1)).toEqual([]);
  });
});

describe('close-up at splits', () => {
  it('zooms in to 20 m as a split comes up, holds past the gore, then eases back out', () => {
    // Expressway, 25 m/s (90 km/h): in from 245 m out, all in from 70 m (about 3 s) to 40 m past.
    const v = 25;
    expect(closeWeight(400, v)).toBe(0);
    expect(closeWeight(240, v)).toBeGreaterThan(0);
    expect(closeWeight(120, v)).toBeLessThan(1);
    expect(closeWeight(70, v)).toBe(1);
    expect(closeWeight(0, v)).toBe(1);
    expect(closeWeight(-40, v)).toBe(1);
    expect(closeWeight(-90, v)).toBeGreaterThan(0);
    expect(closeWeight(-90, v)).toBeLessThan(1);
    expect(closeWeight(-150, v)).toBe(0);
    // Smooth all the way: no jumps between neighbouring metres.
    for (let d = -160; d < 420; d++) expect(Math.abs(closeWeight(d, v) - closeWeight(d + 1, v))).toBeLessThan(0.03);
    // In town, 8 m/s: starts later in metres (but a similar number of seconds out).
    expect(closeWeight(200, 8)).toBe(0);
    expect(closeWeight(50, 8)).toBe(1);
  });

  it('turns the weight into a scale between the normal one and 20 m', () => {
    expect(CLOSE_SPAN).toBe(20);
    expect(closeSpan(150, 0)).toBe(150);
    expect(closeSpan(150, 1)).toBeCloseTo(20, 6);
    // Half way in zoom levels, not in metres.
    expect(closeSpan(320, 0.5)).toBeCloseTo(80, 6);
    expect(roundScale(closeSpan(200, 1))).toBe(20);
    // At 20 m the route is drawn thin; at the normal scales it is not.
    expect(CLOSE_SPAN).toBeLessThan(THIN_BELOW);
    expect(SCALE_MIN).toBeGreaterThan(THIN_BELOW);
  });

  it('scales line widths by zoom', () => {
    expect(widthExpr([10, 4, 16, 10, 19, 20], 0.5)).toEqual(['interpolate', ['linear'], ['zoom'], 10, 2, 16, 5, 19, 10]);
  });
});
