import { describe, expect, it } from 'vitest';
import { destination, type LngLat } from '../src/geo/geo';
import type { OsmWay } from '../src/junction/osmdata';
import { OsrmRouter } from '../src/routing/osrm';
import { buildRoadQuery, parsePlaceRef, parseTripLink, pickRoadPoint, resolveTrip, TripLinkError } from '../src/trip/tripLink';

let wid = 1;
function way(pts: LngLat[], tags: Record<string, string>): OsmWay {
  return { id: wid++, nodes: pts.map((_, i) => i), geometry: pts.map(([lon, lat]) => ({ lat, lon })), tags };
}
/** A straight line of points from `a` heading `brg` for `len` metres. */
function line(a: LngLat, brg: number, len: number): LngLat[] {
  const out: LngLat[] = [a];
  for (let d = 200; d <= len; d += 200) out.push(destination(a, brg, d));
  return out;
}

describe('trip links', () => {
  it('parses places, road points, simulator speed and avoid options', () => {
    const spec = parseTripLink('?from=road:E2~3&via=Plaza%20Tol%20Sungai%20Besi@0&via=road:E19|SUKE&to=KLCC&sim=2&avoid=ferries')!;
    expect(spec.from).toEqual({ kind: 'road', names: ['E2'], km: 3 });
    expect(spec.via[0]).toEqual({ kind: 'text', q: 'Plaza Tol Sungai Besi', bearing: 0 });
    expect(spec.via[1]).toEqual({ kind: 'road', names: ['E19', 'SUKE'], km: undefined });
    expect(spec.to).toEqual({ kind: 'text', q: 'KLCC', bearing: undefined });
    expect(spec.sim).toBe(2);
    expect(spec.avoid).toEqual({ ferries: true });
    expect(parsePlaceRef('3.139, 101.6869@350')).toEqual({ kind: 'coord', lngLat: [101.6869, 3.139], bearing: 350 });
    expect(parsePlaceRef('here')).toEqual({ kind: 'here' });
    expect(parseTripLink('?from=KL')).toBeNull(); // no destination
    expect(parseTripLink('?to=KLCC')!.from).toEqual({ kind: 'here' });
    expect(parseTripLink('?to=KLCC&sim')!.sim).toBe(1);
  });

  it('queries mainline ways by ref or by name', () => {
    const q = buildRoadQuery(['E19', 'SUKE'], [101.7, 3.1], 9000);
    expect(q).toContain('way(around:9000,3.10000,101.70000)["highway"~"^(motorway|trunk|primary|secondary)$"]["ref"~"(^|;)\\\\s*E19\\\\s*(;|$)",i];');
    expect(q).toContain('["name"~"SUKE",i]');
    expect(q).toContain('out body geom;');
    expect(buildRoadQuery(['Jln. Tun Razak'], [101.7, 3.1], 1000)).toContain('["name"~"Jln\\\\. Tun Razak",i]');
  });

  // A dual carriageway running north (east tube) and south (west tube), and an east-west road.
  const nb = way(line([101.70, 3.00], 0, 12000), { highway: 'motorway', ref: 'E19', oneway: 'yes' });
  const sb = way(line(destination([101.70, 3.00], 0, 12000), 180, 12000).map(([x, y]) => [x - 0.0003, y] as LngLat), { highway: 'motorway', ref: 'E19', oneway: 'yes' });
  const ew = way(line([101.66, 3.05], 90, 6000), { highway: 'motorway', ref: 'E19', oneway: 'yes' });

  it('picks a point on the carriageway that leads toward the next place', () => {
    const prev: LngLat = [101.69, 2.99];
    const next: LngLat = [101.705, 3.12];
    const p = pickRoadPoint([nb, sb, ew], prev, next)!;
    expect(p).not.toBeNull();
    expect(Math.abs(p.bearing)).toBeLessThan(5); // northbound
    expect(p.lngLat[0]).toBeCloseTo(101.70, 3); // the east (northbound) tube
    // Heading south instead: the other tube.
    const back = pickRoadPoint([nb, sb, ew], next, prev)!;
    expect(Math.abs(back.bearing - 180)).toBeLessThan(5);
    expect(back.lngLat[0]).toBeCloseTo(101.6997, 3);
  });

  it('puts the trip start about the given distance before the next place', () => {
    const next = destination([101.70, 3.00], 0, 9000);
    const p = pickRoadPoint([nb, sb], null, next, 3)!;
    expect(Math.abs(p.bearing)).toBeLessThan(5);
    const dy = (next[1] - p.lngLat[1]) * 111_320;
    expect(dy).toBeGreaterThan(2900);
    expect(dy).toBeLessThan(3100);
  });

  it('resolves a whole trip with geocoded places and road points', async () => {
    const spec = parseTripLink('?from=road:E19~3&via=Toll@0&via=road:E19&to=Tower')!;
    const toll = destination([101.70, 3.00], 0, 4000);
    const tower: LngLat = [101.705, 3.14];
    const queries: string[] = [];
    const pts = await resolveTrip(spec, {
      geocode: async (q) => (q === 'Toll' ? { lngLat: toll, label: 'Toll plaza' } : q === 'Tower' ? { lngLat: tower, label: 'Tower' } : null),
      overpass: async (q) => {
        queries.push(q);
        return [nb, sb, ew];
      },
      here: async () => null,
      near: null,
    });
    expect(pts.map((p) => p.label)).toEqual(['E19', 'Toll plaza', 'E19', 'Tower']);
    const auto = await resolveTrip(parseTripLink('?from=road:E19~3&via=Toll@auto&to=Tower')!, {
      geocode: async (q) => (q === 'Toll' ? { lngLat: toll, label: 'Toll plaza' } : { lngLat: tower, label: 'Tower' }),
      overpass: async () => [nb, sb],
      here: async () => null,
      near: null,
    });
    expect(Math.min(auto[1].bearing!, 360 - auto[1].bearing!)).toBeLessThan(3); // arriving from the south
    expect(pts[1].bearing).toBe(0);
    expect(pts[0].lngLat[1]).toBeLessThan(toll[1]);
    expect(pts[2].lngLat[1]).toBeGreaterThan(toll[1]);
    expect(pts[2].lngLat[1]).toBeLessThan(tower[1]);
    expect(queries.length).toBe(2);
    await expect(
      resolveTrip(parseTripLink('?from=road:E1&via=road:E2&to=X')!, {
        geocode: async () => ({ lngLat: tower, label: 'X' }),
        overpass: async () => [],
        here: async () => null,
        near: null,
      }),
    ).rejects.toBeInstanceOf(TripLinkError);
  });

  it('sends stop bearings to OSRM so stops snap to the right carriageway', () => {
    const r = new OsrmRouter('https://example.org/route/v1/driving');
    const url = decodeURIComponent(
      r.buildUrl({ origin: [101.7, 3.0], via: [[101.71, 3.05], [101.72, 3.1]], viaBearings: [5, null], destination: [101.71, 3.15], bearing: 350 }, []),
    );
    expect(url).toContain('bearings=350,60;5,60;;');
    const noOrigin = decodeURIComponent(r.buildUrl({ origin: [101.7, 3.0], via: [[101.71, 3.05]], viaBearings: [90], destination: [101.71, 3.15] }, []));
    expect(noOrigin).toContain('bearings=;90,60;');
    expect(noOrigin).not.toContain('radiuses');
  });
});
