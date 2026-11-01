import { describe, expect, it } from 'vitest';
import { validateStyleMin } from '@maplibre/maplibre-gl-style-spec';
import { layers } from '@protomaps/basemaps';
import { isDaylight, nextSunChange, sunAltitude } from '../src/state/daylight';
import { techFlavor, techOnlineStyle, techStyle } from '../src/map/techStyle';
import { resolveStyle, STYLES } from '../src/map/styles';
import { DAY, NIGHT, themeFor } from '../src/theme/palette';
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
