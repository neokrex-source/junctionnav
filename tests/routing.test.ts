import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { NavEngine } from '../src/nav/engine';
import { describeStep } from '../src/routing/instructions';
import { normalizeOsrm, OsrmRouter, type OsrmResponse } from '../src/routing/osrm';

const demo = buildDemo();
const okBody = () => JSON.stringify(demo.osrm);

function mockFetch(handler: (url: string) => { status: number; body: string }) {
  const calls: string[] = [];
  vi.stubGlobal('fetch', async (url: string) => {
    calls.push(url);
    const r = handler(url);
    return new Response(r.body, { status: r.status, headers: { 'Content-Type': 'application/json' } });
  });
  return calls;
}

afterEach(() => vi.unstubAllGlobals());

describe('route options', () => {
  it('measures toll and motorway distance', () => {
    const r = normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
    expect(r.hasToll).toBe(true);
    expect(r.tollDistance).toBeGreaterThan(2000);
    expect(r.tollDistance).toBeLessThan(r.distance);
    expect(r.motorwayDistance).toBeGreaterThan(2000);
  });

  it('falls back and warns when the server cannot avoid tolls', async () => {
    const calls = mockFetch((url) =>
      url.includes('exclude=')
        ? { status: 400, body: JSON.stringify({ code: 'InvalidValue', message: 'Exclude flag combination is not supported.' }) }
        : { status: 200, body: okBody() },
    );
    const router = new OsrmRouter('https://x.test/route/v1/driving');
    const res = await router.route({ origin: demo.start, destination: demo.end, avoid: { tolls: true }, alternatives: true });
    expect(res.routes.length).toBe(1);
    expect(res.routes[0].avoidApplied).toEqual([]);
    expect(res.warnings[0]).toMatch(/can't avoid toll roads/);
    // Second request skips the known-unsupported exclusion.
    await router.route({ origin: demo.start, destination: demo.end, avoid: { tolls: true } });
    expect(calls.filter((c) => c.includes('exclude=toll')).length).toBe(1);
  });

  it('keeps one exclusion when the server rejects the combination', async () => {
    mockFetch((url) => {
      if (url.includes('exclude=toll%2Cmotorway')) return { status: 400, body: JSON.stringify({ code: 'InvalidValue', message: 'Exclude flag combination is not supported.' }) };
      return { status: 200, body: okBody() };
    });
    const res = await new OsrmRouter('https://x.test/r').route({ origin: demo.start, destination: demo.end, avoid: { tolls: true, motorways: true } });
    expect(res.routes[0].avoidApplied).toEqual(['tolls']);
    expect(res.warnings[0]).toMatch(/also avoid highways/);
  });

  it('adds a toll-free option when the best route uses tolls', async () => {
    // Fake a toll-free alternative: same response with toll classes removed and a different shape.
    const tf = structuredClone(demo.osrm) as OsrmResponse;
    const route = tf.routes![0];
    route.geometry.coordinates = route.geometry.coordinates.map(([x, y]) => [x - 0.01, y]);
    route.duration *= 1.3;
    for (const leg of route.legs) for (const st of leg.steps) for (const ix of st.intersections) ix.classes = [];
    mockFetch((url) => (url.includes('exclude=toll') ? { status: 200, body: JSON.stringify(tf) } : { status: 200, body: okBody() }));
    const res = await new OsrmRouter('https://x.test/r').route({ origin: demo.start, destination: demo.end, alternatives: true, offerTollFree: true });
    expect(res.routes.map((r) => r.label)).toEqual(['fastest', 'tollFree']);
    expect(res.routes[1].hasToll).toBe(false);
  });
});

describe('stops', () => {
  it('keeps intermediate arrivals and tracks the next stop', () => {
    const base = structuredClone(demo.osrm) as OsrmResponse;
    const r0 = base.routes![0];
    const steps = r0.legs[0].steps;
    const cut = 4; // split the trip at the JCT fork
    const arriveAt = { ...structuredClone(steps[cut]), maneuver: { ...steps[cut].maneuver, type: 'arrive', modifier: undefined }, distance: 0, duration: 0 };
    const departAt = { ...structuredClone(steps[cut]), maneuver: { ...steps[cut].maneuver, type: 'depart', modifier: undefined } };
    const leg1 = steps.slice(0, cut).concat([arriveAt]);
    const leg2 = [departAt as typeof steps[number]].concat(steps.slice(cut + 1));
    const sum = (ss: typeof steps) => ss.reduce((a, s) => a + s.distance, 0);
    r0.legs = [
      { steps: leg1, summary: 'A', distance: sum(leg1), duration: 100 },
      { steps: leg2, summary: 'B', distance: sum(leg2), duration: 100 },
    ];
    const route = normalizeOsrm(base, 'Demo')[0];
    const stop = route.steps.find((s) => s.waypoint === 1)!;
    expect(stop.type).toBe('arrive');
    expect(describeStep(stop, 'en').action).toBe('You have reached stop 1');
    expect(route.legs.length).toBe(2);
    expect(route.legs[1].endS).toBeCloseTo(route.line.length, 3);

    const eng = new NavEngine();
    eng.setRoute(route, []);
    const at = (s: number) => eng.update({ lngLat: route.line.pointAt(s), accuracy: 5, heading: route.line.bearingAt(s), speed: 20, time: s })!;
    const p1 = at(500);
    expect(p1.nextStop?.number).toBe(1);
    expect(p1.nextStop!.dist).toBeCloseTo(route.legs[0].endS - 500, 0);
    let p = p1;
    for (let s = 500; s < route.legs[0].endS + 50; s += 10) p = at(s);
    expect(p.arrived).toBe(false);
    expect(p.stopsPassed).toBe(1);
    expect(p.nextStop).toBeNull();
  });
});
