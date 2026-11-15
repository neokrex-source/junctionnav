import { describe, expect, it } from 'vitest';
import { countryAt, KNOWN_COUNTRIES } from '../src/geo/countries';

describe('which country a point is in', () => {
  it('knows the capitals and big cities of Asia', () => {
    const cities: [string, [number, number]][] = [
      ['MY', [101.6869, 3.139]],
      ['SG', [103.8198, 1.3521]],
      ['BN', [114.9398, 4.9031]],
      ['TH', [100.5018, 13.7563]],
      ['ID', [106.8456, -6.2088]],
      ['PH', [120.9842, 14.5995]],
      ['VN', [106.6297, 10.8231]],
      ['KH', [104.9282, 11.5564]],
      ['LA', [102.6331, 17.9757]],
      ['MM', [96.1951, 16.8661]],
      ['JP', [139.6917, 35.6895]],
      ['KR', [126.978, 37.5665]],
      ['TW', [121.5654, 25.033]],
      ['CN', [121.4737, 31.2304]],
      ['HK', [114.1694, 22.3193]],
      ['IN', [72.8777, 19.076]],
      ['PK', [67.0011, 24.8607]],
      ['BD', [90.4125, 23.8103]],
      ['LK', [79.8612, 6.9271]],
      ['NP', [85.324, 27.7172]],
      ['AE', [55.2708, 25.2048]],
      ['SA', [46.6753, 24.7136]],
      ['KZ', [76.8512, 43.222]],
    ];
    for (const [code, p] of cities) expect([code, countryAt(p)]).toEqual([code, code]);
  });

  it('nothing far out at sea or outside Asia', () => {
    expect(countryAt([90, -10])).toBeNull();
    expect(countryAt([-0.1276, 51.5072])).toBeNull();
    expect(KNOWN_COUNTRIES).toContain('MV');
  });
});
