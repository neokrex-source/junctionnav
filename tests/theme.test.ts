import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { layers } from '@protomaps/basemaps';
import { isDaylight, nextSunChange, sunAltitude } from '../src/state/daylight';
import { techFlavor, techOnlineStyle, techStyle } from '../src/map/techStyle';
import { resolveStyle, STYLES } from '../src/map/styles';
import { DAY, NIGHT, setThemeId, themeFor, themeId, THEMES, type ThemeId } from '../src/theme/palette';
import { inTheme, retint } from '../src/theme/tint';
import { jvPalette, DAY as JV_DAY, NIGHT as JV_NIGHT } from '../src/junction/render3d';
import { tomtomStyle } from '../src/map/tomtomStyle';
import { loadSettings } from '../src/state/settings';

const KL: [number, number] = [101.6869, 3.139];
const TOKYO: [number, number] = [139.6917, 35.6895];
/** Local time in Kuala Lumpur (UTC+8) as a Date. */
const kl = (iso: string) => new Date(`${iso}+08:00`);

describe('automatic day and night', () => {
  it('follows the sun in Kuala Lumpur', () => {
    expect(isDaylight(kl('2026-11-01T12:00:00'), KL[1], KL[0])).toBe(true);
    expect(isDaylight(kl('2026-11-01T23:00:00'), KL[1], KL[0])).toBe(false);
    // Sunset in KL early November is a little after 19:00, sunrise a little after 07:00.
    expect(isDaylight(kl('2026-11-01T18:50:00'), KL[1], KL[0])).toBe(true);
    expect(isDaylight(kl('2026-11-01T19:30:00'), KL[1], KL[0])).toBe(false);
    expect(isDaylight(kl('2026-11-02T06:50:00'), KL[1], KL[0])).toBe(false);
    expect(isDaylight(kl('2026-11-02T07:20:00'), KL[1], KL[0])).toBe(true);
    const sunset = nextSunChange(kl('2026-11-01T15:00:00'), KL[1], KL[0])!;
    const local = new Date(sunset.getTime() + 8 * 3600_000);
    const minutes = local.getUTCHours() * 60 + local.getUTCMinutes();
    // Published sunset for 1 November 2026 is 19:00.
    expect(minutes).toBeGreaterThanOrEqual(18 * 60 + 55);
    expect(minutes).toBeLessThanOrEqual(19 * 60 + 5);
  });

  it('knows that Tokyo gets dark much earlier in winter', () => {
    // 17:00 in Tokyo (UTC+9) on 21 December is after sunset; on 21 June it is broad daylight.
    expect(isDaylight(new Date('2026-12-21T17:00:00+09:00'), TOKYO[1], TOKYO[0])).toBe(false);
    expect(isDaylight(new Date('2026-06-21T17:00:00+09:00'), TOKYO[1], TOKYO[0])).toBe(true);
    // Noon sun at the June solstice: 90 - (35.7 - 23.44) ≈ 77.7°.
    const noon = sunAltitude(new Date('2026-06-21T11:40:00+09:00'), TOKYO[1], TOKYO[0]);
    expect(noon).toBeGreaterThan(76.5);
    expect(noon).toBeLessThan(78.5);
  });
});

describe('the day and night map', () => {
  it('builds valid map styles for both modes, online and offline', () => {
    for (const night of [false, true]) {
      expect(validateStyleMin(techOnlineStyle(night, 'en') as never)).toEqual([]);
      const offline = { version: 8, glyphs: 'x/{fontstack}/{range}', sprite: 'x', sources: { protomaps: { type: 'vector', url: 'pmtiles://x' } }, layers: layers('protomaps', techFlavor(night), { lang: 'en' }) };
      expect(validateStyleMin(offline as never)).toEqual([]);
    }
  });

  it('paints the map from the palette', () => {
    const day = techOnlineStyle(false, 'en');
    const night = techOnlineStyle(true, 'en');
    const bg = (s: typeof day) => (s.layers[0] as unknown as { paint: Record<string, string> }).paint['background-color'];
    expect(bg(day)).toBe(DAY.map.land);
    expect(bg(night)).toBe(NIGHT.map.land);
    expect(techFlavor(true).highway).toBe(NIGHT.map.highway);
    expect(themeFor(true).route).not.toBe(themeFor(false).route);
    // Same object per mode and language, so comparing styles does not reload the map.
    expect(techStyle(true, 'en')).toBe(techStyle(true, 'en'));
    expect(techStyle(true, 'ms')).not.toBe(techStyle(true, 'en'));
  });

  it('makes the JunctionNav map the default, and moves the old default over', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(STYLES[0].id).toBe('tech');
    const s = loadSettings();
    expect(s.mapStyle).toBe('tech');
    expect(resolveStyle(s, true)).toBe(techStyle(true, s.lang));
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ mapStyle: 'ofm-liberty', appearance: 'auto' }));
    expect(loadSettings().mapStyle).toBe('tech');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ mapStyle: 'ofm-positron' }));
    expect(loadSettings().mapStyle).toBe('ofm-positron');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ mapStyle: 'ofm-liberty', look: 2 }));
    expect(loadSettings().mapStyle).toBe('ofm-liberty');
    localStorage.removeItem('junctionnav.settings.v1');
  });
});

describe('the three looks', () => {
  const ids = Object.keys(THEMES) as ThemeId[];
  const hex = /^#[0-9a-f]{6}$/i;
  /** Relative luminance of a colour (0 black to 1 white). */
  const lum = (c: string) => {
    const n = parseInt(c.slice(1), 16);
    const f = (v: number) => (v / 255 <= 0.03928 ? v / 255 / 12.92 : ((v / 255 + 0.055) / 1.055) ** 2.4);
    return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
  };
  const contrast = (a: string, b: string) => (Math.max(lum(a), lum(b)) + 0.05) / (Math.min(lum(a), lum(b)) + 0.05);
  /** How far apart two colours are (0 to 441). */
  const apart = (a: string, b: string) => {
    const [x, y] = [parseInt(a.slice(1), 16), parseInt(b.slice(1), 16)];
    return Math.hypot(((x >> 16) & 255) - ((y >> 16) & 255), ((x >> 8) & 255) - ((y >> 8) & 255), (x & 255) - (y & 255));
  };

  it('are JunctionNav, Fighter jet and Casual, each with a day and a night', () => {
    expect(ids).toEqual(['junction', 'jet', 'casual']);
    for (const id of ids) {
      const t = THEMES[id];
      expect(t.day.night).toBe(false);
      expect(t.night.night).toBe(true);
      for (const th of [t.day, t.night]) {
        for (const k of Object.keys(DAY.map) as (keyof typeof DAY.map)[]) expect(th.map[k], `${id} ${k}`).toMatch(hex);
        // Night maps are dark, day maps bright.
        if (th.night) expect(lum(th.map.land)).toBeLessThan(0.02);
        else expect(lum(th.map.land)).toBeGreaterThan(0.7);
        // The route stands out from the ground and is a different colour from every road, and so is the junction orange.
        expect(contrast(th.route, th.map.land), `${id} route on land`).toBeGreaterThan(2.2);
        for (const road of [th.map.minor, th.map.major, th.map.highway, th.map.link]) {
          expect(apart(th.route, road), `${id} ${th.night ? 'night' : 'day'} route on ${road}`).toBeGreaterThan(70);
          expect(apart(th.junction, road), `${id} ${th.night ? 'night' : 'day'} junction on ${road}`).toBeGreaterThan(70);
        }
        expect(contrast(th.junction, th.map.land)).toBeGreaterThan(2.2);
        expect(th.junction).not.toBe(th.route);
        // Labels read on the map.
        expect(contrast(th.map.labelMajor, th.map.land)).toBeGreaterThan(7);
        expect(contrast(th.map.label, th.map.land)).toBeGreaterThan(4.5);
      }
      expect(t.bar.day).toMatch(hex);
      expect(t.bar.night).toMatch(hex);
    }
  });

  it('switch the map, the route and the junction view together', () => {
    try {
      const seen = new Set<string>();
      for (const id of ids) {
        setThemeId(id);
        expect(themeId()).toBe(id);
        for (const night of [false, true]) {
          const th = themeFor(night);
          expect(th).toBe(night ? THEMES[id].night : THEMES[id].day);
          const style = techStyle(night, 'en');
          const bg = (style.layers[0] as unknown as { paint: Record<string, string> }).paint['background-color'];
          expect(bg).toBe(th.map.land);
          expect(validateStyleMin(style as never)).toEqual([]);
          // One style object per look, mode and language: changing the look changes the map.
          expect(techStyle(night, 'en')).toBe(style);
          seen.add(JSON.stringify(style.layers[0]));
          const tt = tomtomStyle(night, 'en', 'https://example.test/{z}/{x}/{y}.pbf');
          expect((tt.layers[0] as unknown as { paint: Record<string, string> }).paint['background-color']).toBe(th.map.land);
          seen.add(`${jvPalette(night).skyTop}|${night}`);
        }
      }
      expect(seen.size).toBe(12);
      // An unknown look is JunctionNav.
      setThemeId('retro' as ThemeId);
      expect(themeId()).toBe('junction');
    } finally {
      setThemeId('junction');
    }
  });

  it('turn the junction view’s purple cast to the look’s own, leaving greens and the orange route', () => {
    expect(retint('#4c4855', 140, 1)).not.toBe('#4c4855'); // purple-grey asphalt
    expect(retint('#4f7a5c', 140, 1)).toBe('#4f7a5c'); // a tree
    expect(retint('#ea580c', 140, 1)).toBe('#ea580c'); // the route
    expect(retint('#ffffff', 140, 1)).toBe('#ffffff');
    try {
      setThemeId('junction');
      expect(jvPalette(false)).toBe(JV_DAY);
      expect(jvPalette(true)).toBe(JV_NIGHT);
      setThemeId('jet');
      const jet = jvPalette(true);
      expect(jet).not.toBe(JV_NIGHT);
      expect(jvPalette(true)).toBe(jet);
      expect(jet.tree).toBe(JV_NIGHT.tree);
      expect(jet.asphalt).not.toBe(JV_NIGHT.asphalt);
      // Same lightness: only the cast moved.
      expect(Math.abs(lum(jet.asphalt) - lum(JV_NIGHT.asphalt))).toBeLessThan(0.01);
      expect(jet.arrow).toBe('#ffb020');
      setThemeId('casual');
      expect(jvPalette(false).skyTop).toBe('#7cc4f2');
      expect(inTheme(JV_DAY, false)).not.toBe(JV_DAY);
    } finally {
      setThemeId('junction');
    }
  });

  it('are remembered in the settings, and an unknown one falls back to JunctionNav', () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    expect(loadSettings().theme).toBe('junction');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ theme: 'jet' }));
    expect(loadSettings().theme).toBe('jet');
    localStorage.setItem('junctionnav.settings.v1', JSON.stringify({ theme: 'disco' }));
    expect(loadSettings().theme).toBe('junction');
    // Speed alerts are on by default: tone and voice, 5 km/h before the limit, cameras too.
    expect(loadSettings()).toMatchObject({ speedAlerts: 'voice', speedMargin: 5, speedCams: true });
  });
});
