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

    it(`${name}: the lanes to be in are tinted and edged in the route's colour`, () => {
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
