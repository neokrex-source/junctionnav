import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { destination, haversine, LocalFrame, type LngLat } from '../src/geo/geo';
import { OfflineRouter } from '../src/offline/providers';
import { compass, headingText, normHeading } from '../src/pins/heading';
import { MAX_PINS, PinStore, pinPlace } from '../src/pins/pins';
import { OsrmRouter } from '../src/routing/osrm';
import type { RouteResult, Router } from '../src/routing/types';
import { FallbackRouter } from '../src/tomtom/fallback';
import { TomTomGate } from '../src/tomtom/gate';
import { resetFamilies } from '../src/tomtom/http';
import { arrivesHeading, dropApproach, HeadingNotMet, normalizeTomTom, TomTomRouter, type TtInstruction, type TtRoute } from '../src/tomtom/routing';

/** A browser's storage, for the store. */
function memoryStorage() {
  const m = new Map<string, string>();
  return {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, String(v)),
    removeItem: (k: string) => void m.delete(k),
    clear: () => m.clear(),
    key: (i: number) => [...m.keys()][i] ?? null,
    get length() {
      return m.size;
    },
  };
}

describe('pins', () => {
  beforeEach(() => {
    (globalThis as { localStorage?: unknown }).localStorage = memoryStorage();
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it('keeps pins with their direction of travel, newest first', () => {
    const s = new PinStore();
    const a = s.add([101.6869123456, 3.139], 'Dropped pin', '', -90);
    const b = s.add([101.7, 3.15], 'Jalan Ampang', 'Kuala Lumpur');
    expect(a.lngLat).toEqual([101.686912, 3.139]);
    expect(a.heading).toBe(270);
    expect(b.heading).toBeNull();
    expect(s.list().map((p) => p.id)).toEqual([b.id, a.id].sort((x, y) => (s.get(y)!.at - s.get(x)!.at) || 0));
    // Kept in the browser: a new store reads them back.
    expect(new PinStore().pins.map((p) => p.name).sort()).toEqual(['Dropped pin', 'Jalan Ampang']);
  });

  it('updates, removes and clears, telling the map each time', () => {
    const s = new PinStore();
    const changed = vi.fn();
    s.onChange = changed;
    const p = s.add([101.69, 3.14], 'Dropped pin');
    s.update(p.id, { name: 'Jalan Ujian', sub: 'Kuala Lumpur', heading: 365 });
    expect(s.get(p.id)).toMatchObject({ name: 'Jalan Ujian', sub: 'Kuala Lumpur', heading: 5 });
    s.update(p.id, { heading: null, lngLat: [101.7, 3.15] });
    expect(s.get(p.id)).toMatchObject({ heading: null, lngLat: [101.7, 3.15] });
    expect(s.update('nope', { name: 'x' })).toBeUndefined();
    s.remove(p.id);
    expect(s.pins).toEqual([]);
    s.add([101.69, 3.14], 'a');
    s.clear();
    expect(new PinStore().pins).toEqual([]);
    expect(changed).toHaveBeenCalledTimes(6);
  });

  it('belongs to the signed-in account', () => {
    const s = new PinStore();
    s.useScope('u1');
    s.add([101.69, 3.14], 'Mine');
    s.useScope('u2');
    expect(s.pins).toEqual([]);
    s.useScope('u1');
    expect(s.pins.map((p) => p.name)).toEqual(['Mine']);
  });

  it('keeps at most a hundred, dropping the oldest', () => {
    const s = new PinStore();
    const now = vi.spyOn(Date, 'now');
    for (let i = 0; i < MAX_PINS + 3; i++) {
      now.mockReturnValue(1_000_000 + i);
      s.add([101 + i * 1e-4, 3], `Pin ${i}`);
    }
    now.mockRestore();
    expect(s.pins.length).toBe(MAX_PINS);
    expect(s.pins.some((p) => p.name === 'Pin 0')).toBe(false);
    expect(s.list()[0].name).toBe(`Pin ${MAX_PINS + 2}`);
  });

  it('survives damaged storage', () => {
    localStorage.setItem('junctionnav.pins.v1', '{oops');
    expect(new PinStore().pins).toEqual([]);
    localStorage.setItem('junctionnav.pins.v1', JSON.stringify([{ id: 'x', lngLat: [1, 'a'], name: 'bad' }, { id: 'y', lngLat: [101.6, 3.1], name: 'ok', heading: 400 }]));
    expect(new PinStore().pins).toMatchObject([{ id: 'y', heading: 40, sub: '' }]);
  });

  it('is a place with its heading for the directions', () => {
    const s = new PinStore();
    const p = s.add([101.69, 3.14], 'Jalan Ujian', 'Kuala Lumpur', 90);
    expect(pinPlace(p)).toEqual({ name: 'Jalan Ujian', sub: 'Kuala Lumpur', lngLat: [101.69, 3.14], kind: 'pin', pinId: p.id, bearing: 90 });
    expect(pinPlace(s.add([101.7, 3.15], 'Any'))).not.toHaveProperty('bearing');
  });
});

describe('headings', () => {
  it('names the direction in each language', () => {
    expect(normHeading(-1)).toBe(359);
    expect(normHeading(359.6)).toBe(0);
    expect(compass(47, 'en')).toBe('NE');
    expect(compass(47, 'en', true)).toBe('north-east');
    expect(compass(337, 'en')).toBe('NW');
    expect(compass(338, 'en')).toBe('N');
    expect(headingText(270, 'ms')).toBe('barat (270°)');
    expect(headingText(90, 'ja')).toBe('東 (90°)');
  });
});

describe('arriving in a direction', () => {
  const KL: LngLat = [101.69, 3.14];

  it('asks OSRM to arrive that way, after any stops', () => {
    const r = new OsrmRouter('https://osrm.test/route/v1/driving');
    const url = (req: Parameters<OsrmRouter['buildUrl']>[0]) => new URL(r.buildUrl(req, [])).searchParams.get('bearings');
    expect(url({ origin: KL, destination: [101.7, 3.15], destinationBearing: 270 })).toBe(';270,60');
    expect(url({ origin: KL, destination: [101.7, 3.15], via: [[101.695, 3.145]], destinationBearing: -45 })).toBe(';;315,60');
    expect(url({ origin: KL, destination: [101.7, 3.15], bearing: 10, destinationBearing: 90 })).toBe('10,60;90,60');
    expect(url({ origin: KL, destination: [101.7, 3.15] })).toBeNull();
  });

  it('gives the offline router the direction for the last point', async () => {
    const route = vi.fn(async (_req: { bearings?: (number | null)[] }) => ({ code: 'NoRoute', message: 'x' }));
    const off = new OfflineRouter({ route } as never);
    await off.route({ origin: KL, destination: [101.7, 3.15], via: [[101.695, 3.145]], viaBearings: [null], destinationBearing: 180 }).catch(() => {});
    expect(route.mock.calls[0][0]).toMatchObject({ bearings: [null, null, 180] });
  });

  describe('with TomTom', () => {
    const f = new LocalFrame([101.69, 3.14]);
    const P = (x: number, y: number): LngLat => f.toLngLat(x, y);
    const tt = (p: LngLat) => ({ latitude: p[1], longitude: p[0] });
    const line = (corners: [number, number][]) => {
      const pts: LngLat[] = [];
      for (let i = 0; i < corners.length - 1; i++) {
        const [ax, ay] = corners[i];
        const [bx, by] = corners[i + 1];
        const n = Math.max(1, Math.round(Math.hypot(bx - ax, by - ay) / 20));
        for (let k = 0; k < n; k++) pts.push(P(ax + ((bx - ax) * k) / n, ay + ((by - ay) * k) / n));
      }
      pts.push(P(...corners[corners.length - 1]));
      return pts;
    };
    /** One leg, or two with a stop between them. */
    const ttRoute = (...legs: LngLat[][]): TtRoute => {
      const instructions: TtInstruction[] = [{ point: tt(legs[0][0]), pointIndex: 0, routeOffsetInMeters: 0, travelTimeInSeconds: 0, maneuver: 'DEPART' }];
      let idx = 0;
      let off = 0;
      legs.forEach((pts, i) => {
        idx += pts.length - (i === 0 ? 1 : 0);
        off += 500;
        instructions.push(
          i < legs.length - 1
            ? { point: tt(pts[pts.length - 1]), pointIndex: idx, routeOffsetInMeters: off, travelTimeInSeconds: 50 * (i + 1), maneuver: 'WAYPOINT_REACHED', instructionType: 'LOCATION_WAYPOINT' }
            : { point: tt(pts[pts.length - 1]), pointIndex: idx, routeOffsetInMeters: off, travelTimeInSeconds: 50 * (i + 1), maneuver: 'ARRIVE' },
        );
      });
      return {
        summary: { lengthInMeters: 500 * legs.length, travelTimeInSeconds: 50 * legs.length },
        legs: legs.map((pts) => ({ summary: { lengthInMeters: 500, travelTimeInSeconds: 50 }, points: pts.map(tt) })),
        guidance: { instructions },
      } as TtRoute;
    };
    // Eastbound along a road to the destination at (500, 0).
    const eastbound = ttRoute(line([[0, 0], [500, 0]]));
    // Round the block: past the destination, back westbound to it (stop 45 m east of it first).
    const westbound = ttRoute(line([[0, 0], [0, 60], [600, 60], [600, 0], [545, 0]]), line([[545, 0], [500, 0]]));
    beforeEach(() => resetFamilies());
    afterEach(() => vi.unstubAllGlobals());

    it('knows which way a route arrives', () => {
      const r = normalizeTomTom({ routes: [eastbound] })[0];
      expect(arrivesHeading(r, 90)).toBe(true);
      expect(arrivesHeading(r, 270)).toBe(false);
      expect(arrivesHeading(r, 150)).toBe(true);
    });

    it('folds the approach stop back into one leg', () => {
      const r = dropApproach(normalizeTomTom({ routes: [westbound] })[0]);
      expect(r.legs.length).toBe(1);
      expect(r.steps.some((s) => s.waypoint != null)).toBe(false);
      expect(r.steps.map((s) => s.type)).toEqual(['depart', 'arrive']);
      expect(r.legs[0].distance).toBe(1000);
      expect(arrivesHeading(r, 270)).toBe(true);
    });

    it('keeps routes that already arrive that way', async () => {
      const urls: string[] = [];
      vi.stubGlobal('fetch', vi.fn(async (u: string) => (urls.push(u), new Response(JSON.stringify({ routes: [eastbound] })))));
      const r = await new TomTomRouter(() => 'K').route({ origin: P(0, 0), destination: P(500, 0), destinationBearing: 90 });
      expect(r.routes.length).toBe(1);
      expect(urls.length).toBe(1);
    });

    it('goes through a point just before the destination to arrive the other way', async () => {
      const urls: string[] = [];
      vi.stubGlobal(
        'fetch',
        vi.fn(async (u: string) => {
          urls.push(u);
          const stops = decodeURIComponent(new URL(u).pathname.match(/calculateRoute\/([^/]+)\/json/)![1]).split(':').length;
          return new Response(JSON.stringify({ routes: [stops > 2 ? westbound : eastbound] }));
        }),
      );
      const r = await new TomTomRouter(() => 'K').route({ origin: P(0, 0), destination: P(500, 0), destinationBearing: 270, alternatives: true });
      expect(urls.length).toBe(2);
      const locs = decodeURIComponent(new URL(urls[1]).pathname.match(/calculateRoute\/([^/]+)\/json/)![1])
        .split(':')
        .map((x) => x.split(',').map(Number).reverse() as LngLat);
      expect(locs.length).toBe(3);
      // 45 m behind the destination along the heading: east of it.
      expect(haversine(locs[1], destination(P(500, 0), 90, 45))).toBeLessThan(1);
      expect(new URL(urls[1]).searchParams.get('maxAlternatives')).toBeNull();
      expect(r.routes.length).toBe(1);
      expect(r.routes[0].legs.length).toBe(1);
      expect(arrivesHeading(r.routes[0], 270)).toBe(true);
    });

    it('hands over to OpenStreetMap when TomTom cannot, without resting TomTom', async () => {
      vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ routes: [eastbound] }))));
      await expect(new TomTomRouter(() => 'K').route({ origin: P(0, 0), destination: P(500, 0), destinationBearing: 270 })).rejects.toBeInstanceOf(HeadingNotMet);
      const gate = new TomTomGate(() => 'K', () => true);
      const osrm: Router = { name: 'OSRM', route: vi.fn(async (): Promise<RouteResult> => ({ routes: [{ provider: 'OSRM' } as never], warnings: [] })) };
      const fb = new FallbackRouter(new TomTomRouter(() => 'K'), () => osrm, gate);
      const r = await fb.route({ origin: P(0, 0), destination: P(500, 0), destinationBearing: 270 });
      expect(r.routes[0].provider).toBe('OSRM');
      expect(r.note).toMatch(/arrive in the direction set on the destination/);
      expect(osrm.route).toHaveBeenCalledWith(expect.objectContaining({ destinationBearing: 270 }), undefined);
      expect(gate.status).toBe('ready');
    });
  });
});
