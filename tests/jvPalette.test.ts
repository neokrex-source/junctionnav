import { describe, expect, it } from 'vitest';
import { DAY, jvPalette, NIGHT, type JvPalette } from '../src/junction/render3d';
import { setThemeId } from '../src/theme/palette';

/** WCAG contrast ratio of two #rrggbb colours. */
function contrast(a: string, b: string): number {
  const lum = (hex: string) => {
    const [r, g, bl] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

describe('junction view colours: the route’s lanes apart from the other ways', () => {
  for (const [name, P, roadOnGround] of [['day', DAY, 3], ['night', NIGHT, 2]] as [string, JvPalette, number][]) {
    it(`${name}: the route's roads stand out from the ground and from the other roads`, () => {
      expect(contrast(P.asphaltRoute, P.ground)).toBeGreaterThan(roadOnGround);
      expect(contrast(P.asphaltRoute, P.asphalt)).toBeGreaterThan(1.5);
      expect(contrast(P.asphalt, P.ground)).toBeGreaterThan(1.4);
    });

    it(`${name}: every other lane is bright, in contrast with the lanes to be in`, () => {
      expect(contrast(P.lanesOther, P.ground)).toBeGreaterThan(name === 'night' ? 5 : 1.8);
      expect(contrast(P.lanesOther, P.lanes)).toBeGreaterThan(1.5);
      // Blue against orange: far apart in hue too.
      const hue = (c: string) => {
        const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16) / 255);
        const mx = Math.max(r, g, b);
        const mn = Math.min(r, g, b);
        const h = mx === r ? ((g - b) / (mx - mn)) % 6 : mx === g ? (b - r) / (mx - mn) + 2 : (r - g) / (mx - mn) + 4;
        return (h * 60 + 360) % 360;
      };
      const dh = Math.abs(hue(P.lanesOther) - hue(P.lanes));
      expect(Math.min(dh, 360 - dh)).toBeGreaterThan(120);
      // Lane lines show on both.
      expect(contrast(P.marking, P.lanesOther)).toBeGreaterThan(2.5);
      expect(contrast(P.arrow, P.lanes)).toBeGreaterThan(name === 'night' ? 2 : 1.6);
    });

    it(`${name}: the lanes to be in are in the route's colour, edged`, () => {
      expect(P.lanes).not.toBe(P.asphaltRoute);
      expect(contrast(P.laneEdge, P.lanes)).toBeGreaterThan(2);
      expect(contrast(P.marking, P.lanes)).toBeGreaterThan(3);
      // Lane lines on the other roads are quieter than the route's.
      expect(contrast(P.markingDim, P.asphalt)).toBeLessThan(contrast(P.marking, P.asphaltRoute));
    });
  }

  it('in the Fighter jet and Casual looks too', () => {
    try {
      for (const look of ['jet', 'casual'] as const) {
        setThemeId(look);
        for (const night of [false, true]) {
          const P = jvPalette(night);
          expect(contrast(P.asphaltRoute, P.ground)).toBeGreaterThan(2);
          expect(contrast(P.asphaltRoute, P.asphalt)).toBeGreaterThan(1.35);
          expect(contrast(P.laneEdge, P.lanes)).toBeGreaterThan(2);
        }
      }
    } finally {
      setThemeId('junction');
    }
  });
});

describe('the 3D view’s camera and heights', () => {
  it('draws heights taller, and keeps the real ones for the height strip', async () => {
    const { exaggerated, JV_EXAGGERATE, climbView } = await import('../src/junction/render3d');
    const { buildDemo } = await import('../src/demo/network');
    const { detectJunctions } = await import('../src/junction/detect');
    const { buildScene } = await import('../src/junction/scene');
    const { normalizeOsrm } = await import('../src/routing/osrm');
    const demo = buildDemo();
    const route = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
    const sc = buildScene(route, detectJunctions(route)[1], demo.osm);
    const tall = exaggerated(sc);
    const taken = (x: typeof sc) => x.roads.find((r) => r.role === 'taken')!;
    const top = Math.max(...taken(sc).h);
    expect(Math.max(...taken(tall).h)).toBeCloseTo(top * JV_EXAGGERATE, 5);
    expect(tall.ground.level).toBeCloseTo(sc.ground.level * JV_EXAGGERATE, 5);
    expect(tall.profile).toBe(sc.profile);
    // The scene itself is left as it was.
    expect(Math.max(...taken(sc).h)).toBe(top);
    // Up a ramp the camera comes down and turns towards the climb; elsewhere as usual.
    const up = climbView(sc);
    const flat = climbView({ ...sc, vertical: null });
    expect(up.height).toBeLessThan(flat.height);
    expect(up.turn).toBeGreaterThan(0);
    expect(flat.turn).toBe(0);
  });
});
