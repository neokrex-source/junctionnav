import { describe, expect, it } from 'vitest';
import { zoomPulses } from '../src/junction/zoomMap';
import { PULSE_PERIOD, PULSE_SPEED } from '../src/junction/pulse';
import { againLead, sayAgain } from '../src/talk/speech';
import type { LngLat } from '../src/geo/geo';

/** A straight 2 km line going north, metres along it as latitude steps. */
const line = {
  length: 2000,
  slice: (a: number, b: number): LngLat[] => [
    [101.6, 3 + a / 111_000],
    [101.6, 3 + b / 111_000],
  ],
};
const along = (p: LngLat) => (p[1] - 3) * 111_000;

describe('impulses along the route in the junction views', () => {
  it('three streaks run ahead of the car on the flat line, fading in and out', () => {
    const fc = zoomPulses(line as never, 200, null, 1.3);
    expect(fc.features.length).toBe(3);
    for (const f of fc.features) {
      const c = (f.geometry as unknown as { coordinates: LngLat[] }).coordinates;
      expect(along(c[0])).toBeGreaterThanOrEqual(199.9);
      expect(along(c[c.length - 1])).toBeLessThanOrEqual(200 + 450 + 26 + 0.1);
      expect(f.properties!.a).toBeGreaterThanOrEqual(0);
      expect(f.properties!.a).toBeLessThanOrEqual(1);
    }
  });

  it('they move on with time, and keep off the stretch the 3D ribbon covers', () => {
    const a = zoomPulses(line as never, 200, null, 0.5).features.map((f) => along((f.geometry as unknown as { coordinates: LngLat[] }).coordinates[0]));
    const b = zoomPulses(line as never, 200, null, 0.7).features.map((f) => along((f.geometry as unknown as { coordinates: LngLat[] }).coordinates[0]));
    expect(a).not.toEqual(b);
    for (let t = 0; t < 3; t += 0.1) {
      for (const f of zoomPulses(line as never, 200, [350, 550], t).features) {
        const c = (f.geometry as unknown as { coordinates: LngLat[] }).coordinates;
        const [from, to] = [along(c[0]), along(c[c.length - 1])];
        expect(to <= 350.01 || from >= 549.99).toBe(true);
      }
    }
    // Near the end of the route: none.
    expect(zoomPulses(line as never, 1990, null, 1).features).toHaveLength(0);
  });

  it('on the 3D arrow and ribbon: a streak every 36 m, moving faster than the car', () => {
    expect(PULSE_PERIOD).toBe(36);
    expect(PULSE_SPEED).toBeGreaterThan(40);
  });
});

describe('jokes, facts and riddles said twice', () => {
  it('the second time starts "Once more"', () => {
    expect(againLead('en')).toBe('Once more:');
    expect(sayAgain('Why did the scarecrow win an award?', 'en')).toBe('Once more: Why did the scarecrow win an award?');
    expect(sayAgain('Kerana ia hebat.', 'ms')).toBe('Sekali lagi: Kerana ia hebat.');
    expect(sayAgain('タオルです。', 'ja')).toBe('もう一度、タオルです。');
  });
});
