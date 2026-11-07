import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { DemoTollProvider } from '../src/demo/providers';
import type { LngLat } from '../src/geo/geo';
import { NavEngine, turnSide, type Prompt } from '../src/nav/engine';
import { buildTollQuery, matchTolls, mergeTolls, parseTollAnswer, TollLoader, tollAhead, tollPayment, tollsFromRoute, type TollPlaza } from '../src/nav/tolls';
import { describeStep, joinSpeech, spokenInstruction, tollSpeech, tollTitle, turnSidePhrase } from '../src/routing/instructions';
import { normalizeOsrm, type OsrmResponse, type OsrmStep } from '../src/routing/osrm';
import type { Route } from '../src/routing/types';
import { normalizeTomTom, type TtRouteResponse } from '../src/tomtom/routing';

/* ------------------------------------------------------------------ a straight test road */

const O: LngLat = [101.6, 3.1];
const M_PER_DEG = 111_157; // one degree of longitude at 3.1° N
const at = (m: number): LngLat => [O[0] + m / M_PER_DEG, O[1]];
const north = (m: number, off: number): LngLat => [O[0] + m / M_PER_DEG, O[1] + off / 110_574];

interface StepSpec {
  m: number;
  type: string;
  modifier?: string;
  lanes?: { indications: string[]; valid: boolean }[];
  classes?: string[];
}

/** An eastbound road `length` metres long with maneuvers at the given distances, driven at `speed`. */
function road(length: number, specs: StepSpec[], speed: number, side: 'left' | 'right' = 'left'): Route {
  const coords: LngLat[] = [];
  for (let m = 0; m <= length; m += 50) coords.push(at(m));
  if (length % 50) coords.push(at(length));
  const all: StepSpec[] = [{ m: 0, type: 'depart' }, ...specs, { m: length, type: 'arrive' }];
  const steps: OsrmStep[] = all.map((sp, i) => {
    const dist = (all[i + 1]?.m ?? length) - sp.m;
    return {
      distance: dist,
      duration: dist / speed,
      name: `Jalan ${i}`,
      mode: 'driving',
      driving_side: side,
      maneuver: { type: sp.type, modifier: sp.modifier, location: at(sp.m), bearing_before: 90, bearing_after: 90 },
      intersections: [{ location: at(sp.m), bearings: [270, 90], entry: [false, true], in: 0, out: 1, lanes: sp.lanes, classes: sp.classes }],
    } as OsrmStep;
  });
  const json: OsrmResponse = {
    code: 'Ok',
    routes: [{ distance: length, duration: length / speed, geometry: { type: 'LineString', coordinates: coords }, legs: [{ steps, summary: '', distance: length, duration: length / speed }] }],
  } as OsrmResponse;
  return normalizeOsrm(json, 'Test')[0];
}

/** Drives the engine along the route and returns every prompt with where it came. */
function drive(eng: NavEngine, r: Route, speed: number, from = 0, to = r.line.length): { pr: Prompt; s: number }[] {
  const out: { pr: Prompt; s: number }[] = [];
  let time = 1_000_000;
  for (let s = from; s <= to; s += 10) {
    const p = eng.update({ lngLat: r.line.pointAt(s), accuracy: 5, heading: 90, speed, time });
    time += (10 / speed) * 1000;
    if (!p) continue;
    for (const pr of eng.prompts(p)) out.push({ pr, s });
  }
  return out;
}

const plaza = (s: number, name: string | null = null): TollPlaza => ({ id: `toll:${s}`, s, at: at(s), name });

/* ------------------------------------------------------------------ finding plazas */

describe('toll plazas on the route', () => {
  it('asks Overpass for toll booths near the path and reads the answer', () => {
    const q = buildTollQuery([at(0), at(1000)]);
    expect(q).toContain('node(around:35,');
    expect(q).toContain('["barrier"="toll_booth"]');
    expect(q).toContain('out center tags;');
    const pts = parseTollAnswer({
      elements: [
        { type: 'node', id: 1, lat: 3.1, lon: 101.61, tags: { barrier: 'toll_booth', name: 'Plaza Tol Demo' } },
        { type: 'way', id: 2, center: { lat: 3.1, lon: 101.62 }, tags: { barrier: 'toll_booth' } },
        { type: 'node', id: 3 },
      ],
    });
    expect(pts).toEqual([
      { id: 'node/1', at: [101.61, 3.1], name: 'Plaza Tol Demo' },
      { id: 'way/2', at: [101.62, 3.1] },
    ]);
  });

  it('places booths on the route, one plaza per group, and leaves other roads out', () => {
    const r = road(6000, [], 25);
    const plazas = matchTolls(
      r,
      [
        // One plaza: booths on both carriageways and across the lanes, the named one in the middle.
        { id: 'a', at: north(2000, 8) },
        { id: 'b', at: north(2040, -20), name: 'Plaza Tol Sungai Besi' },
        { id: 'c', at: north(2080, 25), name: 'Booth 7' },
        // Another plaza further on.
        { id: 'd', at: north(4500, 0), name: 'Sungai Besi' },
        // A booth on a road 120 m away: not on the route.
        { id: 'e', at: north(3000, 120) },
      ],
      [0, 6000],
    );
    expect(plazas.length).toBe(2);
    expect(plazas[0].s).toBeGreaterThan(1990);
    expect(plazas[0].s).toBeLessThan(2010);
    expect(plazas[0].name).toBe('Plaza Tol Sungai Besi');
    expect(plazas[1].name).toBe('Sungai Besi');
    // Only the part of the route asked about.
    expect(matchTolls(r, [{ id: 'd', at: north(4500, 0) }], [0, 4000])).toEqual([]);
  });

  it('merges the router’s toll gates with the booths from the map', () => {
    const merged = mergeTolls([plaza(2010, 'Plaza Tol Gombak')], [plaza(2100), plaza(7000)]);
    expect(merged.map((p) => [Math.round(p.s), p.name])).toEqual([
      [2010, 'Plaza Tol Gombak'],
      [7000, null],
    ]);
  });

  it('gives the next plaza within reach, and lets go of it once passed', () => {
    const list = [plaza(1000), plaza(5000)];
    expect(tollAhead(list, 0, 1500)?.dist).toBe(1000);
    expect(tollAhead(list, 0, 900)).toBeNull();
    expect(tollAhead(list, 1010, 1500)?.plaza.s).toBe(1000);
    expect(tollAhead(list, 1020, 1500)).toBeNull();
    expect(tollAhead(list, 1020, 4000)?.plaza.s).toBe(5000);
  });

  it('knows where the toll is paid with Touch n Go, ETC, or nothing at all', () => {
    expect(tollPayment([101.6869, 3.139])).toBe('tng'); // Kuala Lumpur
    expect(tollPayment([101.7257, 3.0606])).toBe('tng'); // Plaza Tol Sungai Besi
    expect(tollPayment([103.7657, 1.4625])).toBe('tng'); // Johor Bahru, at the Causeway
    expect(tollPayment([103.634, 1.385])).toBe('tng'); // Second Link plaza
    expect(tollPayment([100.3745, 5.3601])).toBe('tng'); // Penang Bridge
    expect(tollPayment([101.33, 2.93])).toBe('tng'); // Pulau Indah
    expect(tollPayment([116.0735, 5.9804])).toBe('tng'); // Kota Kinabalu
    expect(tollPayment([103.7692, 1.4452])).toBe('none'); // Woodlands, Singapore
    expect(tollPayment([103.85, 1.29])).toBe('none'); // Singapore city
    expect(tollPayment([101.45, 1.67])).toBe('generic'); // Dumai, Sumatra
    expect(tollPayment([114.94, 4.89])).toBe('generic'); // Brunei
    expect(tollPayment([139.767, 35.681])).toBe('etc'); // Tokyo
    expect(tollPayment([130.4, 33.59])).toBe('etc'); // Fukuoka
    expect(tollPayment([126.978, 37.566])).toBe('generic'); // Seoul
    expect(tollPayment([129.07, 35.18])).toBe('generic'); // Busan
    expect(tollPayment([-0.1276, 51.5072])).toBe('generic'); // London
  });

  it('takes TomTom’s toll gates into the route', () => {
    const pts = Array.from({ length: 41 }, (_, i) => ({ latitude: O[1], longitude: O[0] + (i * 100) / M_PER_DEG }));
    const json: TtRouteResponse = {
      routes: [
        {
          summary: { lengthInMeters: 4000, travelTimeInSeconds: 200 },
          legs: [{ summary: { lengthInMeters: 4000, travelTimeInSeconds: 200 }, points: pts }],
          guidance: {
            instructions: [
              { routeOffsetInMeters: 0, travelTimeInSeconds: 0, point: pts[0], pointIndex: 0, maneuver: 'DEPART' },
              { routeOffsetInMeters: 1500, travelTimeInSeconds: 75, point: pts[15], pointIndex: 15, maneuver: 'TOLLGATE', tollgateName: { text: 'Plaza Tol Jalan Duta' } },
              { routeOffsetInMeters: 2500, travelTimeInSeconds: 125, point: pts[25], pointIndex: 25, maneuver: 'TURN_LEFT', street: 'Jalan Duta' },
              { routeOffsetInMeters: 4000, travelTimeInSeconds: 200, point: pts[40], pointIndex: 40, maneuver: 'ARRIVE' },
            ],
          },
        },
      ],
    };
    const r = normalizeTomTom(json)[0];
    // The gate is not a maneuver, but it is a toll plaza.
    expect(r.steps.map((s) => s.type)).toEqual(['depart', 'turn', 'arrive']);
    expect(r.tollGates?.length).toBe(1);
    expect(r.tollGates![0].s).toBeGreaterThan(1495);
    expect(r.tollGates![0].s).toBeLessThan(1505);
    expect(tollsFromRoute(r)[0].name).toBe('Plaza Tol Jalan Duta');
  });

  it('loads plazas a chunk ahead, on top of the router’s, and starts over for a new route', async () => {
    const r = road(30000, [], 25);
    r.tollGates = [{ s: 1000, at: at(1000) }];
    const asked: number[] = [];
    let seen: TollPlaza[] = [];
    const loader = new TollLoader(
      {
        async fetch(path) {
          asked.push(path.length);
          return [
            { id: 'n1', at: north(1050, 5), name: 'Plaza Tol Satu' },
            { id: 'n2', at: north(26000, 0), name: 'Plaza Tol Dua' },
          ];
        },
      },
      (p) => (seen = p),
    );
    loader.setRoute(r);
    expect(seen.map((p) => p.s)).toEqual([1000]);
    loader.ensure(0);
    await new Promise((res) => setTimeout(res, 0));
    // Two chunks (0-20 km and 20-30 km): the router's gate and the map's booth there are one plaza.
    expect(asked.length).toBe(2);
    expect(seen.map((p) => [Math.round(p.s / 100) * 100, p.name])).toEqual([
      [1000, 'Plaza Tol Satu'],
      [26000, 'Plaza Tol Dua'],
    ]);
    loader.ensure(5000);
    expect(asked.length).toBe(2);
    loader.setRoute(road(5000, [], 25));
    expect(seen).toEqual([]);
  });

  it('has a plaza on the demo expressway ramp', async () => {
    const pts = await new DemoTollProvider().fetch();
    const r = normalizeOsrm(structuredClone(buildDemo().osrm), 'Demo')[0];
    const found = matchTolls(r, pts, [0, r.line.length]);
    expect(found.length).toBe(1);
    expect(found[0].name).toBe('Plaza Tol Demo');
    const ramp = r.steps.find((s) => s.type === 'on ramp')!;
    expect(found[0].s - ramp.s).toBeGreaterThan(300);
    expect(found[0].s - ramp.s).toBeLessThan(450);
  });
});

/* ------------------------------------------------------------------ the toll voice reminder */

describe('toll plaza reminders', () => {
  it('says "get your Touch n Go card ready" about 1 km out on an expressway, and "prepare" just before', () => {
    const r = road(5000, [], 25);
    const eng = new NavEngine();
    eng.setRoute(r, []);
    eng.setTolls([plaza(3000, 'Plaza Tol Sungai Besi')]);
    const said = drive(eng, r, 25).filter(({ pr }) => pr.kind === 'toll' || pr.kind === 'tollNear');
    expect(said.map(({ pr }) => pr.kind)).toEqual(['toll', 'tollNear']);
    const [early, near] = said;
    expect(early.s).toBeGreaterThanOrEqual(2000);
    expect(early.s).toBeLessThan(2100);
    expect(near.s).toBeGreaterThanOrEqual(2700);
    expect(near.s).toBeLessThan(2750);
    expect(tollSpeech('early', early.pr.toll!, 'tng', 'en', 'metric')).toBe('Plaza Tol Sungai Besi in 1 kilometre. Get your Touch n Go card ready.');
  });

  it('skips the short reminder when the early one came late (right before it)', () => {
    const r = road(5000, [], 25);
    const eng = new NavEngine();
    eng.setRoute(r, [], 2400);
    eng.setTolls([plaza(3000)]);
    const said = drive(eng, r, 25, 2400).filter(({ pr }) => pr.kind === 'toll' || pr.kind === 'tollNear');
    // Started 600 m out: the early reminder at once, and the plaza is under 15 s further on.
    expect(said.map(({ pr }) => pr.kind)).toEqual(['toll']);
  });

  it('adds the short reminder before the plaza when the early one was a while back', () => {
    const r = road(3000, [], 10);
    const eng = new NavEngine();
    eng.setRoute(r, []);
    eng.setTolls([plaza(2000)]);
    const said = drive(eng, r, 10).filter(({ pr }) => pr.kind === 'toll' || pr.kind === 'tollNear');
    // Town speed: early within 400 m, near within 120 m (28 s later at 10 m/s).
    expect(said.map(({ pr }) => pr.kind)).toEqual(['toll', 'tollNear']);
    expect(said[0].s).toBeGreaterThanOrEqual(1600);
    expect(said[1].s).toBeGreaterThanOrEqual(1880);
    expect(tollSpeech('near', said[1].pr.toll!, 'tng', 'en', 'metric')).toBe('Toll plaza ahead. Prepare your Touch n Go.');
  });

  it('only gives the short reminder when guidance starts close to the plaza', () => {
    const r = road(3000, [], 25);
    const eng = new NavEngine();
    eng.setRoute(r, [], 1750);
    eng.setTolls([plaza(2000)]);
    const said = drive(eng, r, 25, 1750).filter(({ pr }) => pr.kind === 'toll' || pr.kind === 'tollNear');
    expect(said.map(({ pr }) => pr.kind)).toEqual(['tollNear']);
  });

  it('waits for the turn prompts to finish before the toll reminder', () => {
    const r = road(5000, [{ m: 2600, type: 'fork', modifier: 'slight left' }], 25);
    const eng = new NavEngine();
    eng.setRoute(r, []);
    eng.setTolls([plaza(3000)]);
    const all = drive(eng, r, 25);
    const ticks = new Map<number, string[]>();
    for (const { pr, s } of all) ticks.set(s, [...(ticks.get(s) ?? []), pr.kind]);
    for (const kinds of ticks.values()) if (kinds.includes('toll')) expect(kinds).toEqual(['toll']);
    expect(all.some(({ pr }) => pr.kind === 'toll')).toBe(true);
  });

  it('stays quiet with the reminders turned off, and still speaks on the last stretch', () => {
    const r = road(5000, [], 25);
    const off = new NavEngine();
    off.setRoute(r, []);
    off.tollAlerts = false;
    off.setTolls([plaza(3000)]);
    expect(drive(off, r, 25).some(({ pr }) => pr.kind.startsWith('toll'))).toBe(false);
    // No maneuver before the destination: the last stretch still gets the reminder.
    const on = new NavEngine();
    on.setRoute(r, []);
    on.setTolls([plaza(3000)]);
    expect(drive(on, r, 25).some(({ pr }) => pr.kind === 'toll')).toBe(true);
  });

  it('speaks Malay and Japanese, and asks for ETC in Japan', () => {
    const t = { plaza: plaza(0, 'Sungai Besi'), dist: 800 };
    expect(tollSpeech('early', t, 'tng', 'ms', 'metric')).toBe('Plaza Tol Sungai Besi dalam 800 meter. Sediakan kad Touch n Go anda.');
    expect(tollSpeech('near', t, 'tng', 'ms', 'metric')).toBe('Plaza tol di hadapan. Sediakan Touch n Go.');
    expect(tollSpeech('early', t, 'tng', 'ja', 'metric')).toBe('800メートル先、Sungai Besi料金所です。Touch n Goカードをご用意ください。');
    const jp = { plaza: plaza(0, '東京料金所'), dist: 1000 };
    expect(tollSpeech('early', jp, 'etc', 'ja', 'metric')).toBe('1キロ先、東京料金所です。ETCカードをご確認ください。');
    expect(tollSpeech('near', jp, 'etc', 'ja', 'metric')).toBe('まもなく東京料金所です。');
    expect(tollSpeech('early', { plaza: plaza(0), dist: 800 }, 'generic', 'en', 'metric')).toBe('Toll plaza in 800 metres. Have your toll payment ready.');
    expect(tollSpeech('near', { plaza: plaza(0), dist: 200 }, 'generic', 'en', 'metric')).toBe('Toll plaza ahead.');
    expect(tollTitle('Toll Plaza Batu Tiga', 'en')).toBe('Toll Plaza Batu Tiga');
    expect(tollTitle(null, 'ms')).toBe('Plaza tol');
  });
});

/* ------------------------------------------------------------------ turns */

describe('turn guidance', () => {
  it('says "bear" for slight turns in English', () => {
    const r = road(2000, [{ m: 800, type: 'turn', modifier: 'slight right' }], 12);
    const step = r.steps[1];
    expect(describeStep(step, 'en').action).toBe('Bear right onto Jalan 1');
    expect(spokenInstruction(step, 500, 'en', 'metric')).toBe('In 500 metres, bear right onto Jalan 1');
    expect(describeStep(step, 'ms').action).toBe('Belok serong ke kanan ke Jalan 1');
  });

  it('says which lane to move into on the first notice of a turn without lane data', () => {
    const r = road(2000, [{ m: 1200, type: 'turn', modifier: 'right' }], 12);
    const eng = new NavEngine();
    eng.setRoute(r, []);
    const turn = drive(eng, r, 12).filter(({ pr }) => pr.kind === 'maneuver' && pr.step.index === 1);
    expect(turn.map(({ pr }) => [pr.distance, pr.side])).toEqual([
      [500, 'right'],
      [180, undefined],
      [null, undefined],
    ]);
    expect(joinSpeech(spokenInstruction(turn[0].pr.step, 500, 'en', 'metric'), turnSidePhrase('right', 'en'), 'en')).toBe('In 500 metres, turn right onto Jalan 1. Move into the right lane.');
    expect(turnSidePhrase('left', 'ms')).toBe('Masuk ke lorong kiri.');
    expect(joinSpeech('500メートル先、右折です', turnSidePhrase('right', 'ja'), 'ja')).toBe('500メートル先、右折です。右車線に寄ってください。');
  });

  it('picks the side for each kind of turn, and none where lanes are known or it is not a turn', () => {
    const mk = (type: string, modifier?: string, lanes?: StepSpec['lanes'], side: 'left' | 'right' = 'left') => road(2000, [{ m: 1000, type, modifier, lanes }], 12, side).steps[1];
    expect(turnSide(mk('turn', 'sharp left'))).toBe('left');
    expect(turnSide(mk('turn', 'slight right'))).toBe('right');
    expect(turnSide(mk('end of road', 'left'))).toBe('left');
    expect(turnSide(mk('new name', 'slight left'))).toBe('left');
    // U-turns go from the lane by the middle of the road: the right one where traffic keeps left.
    expect(turnSide(mk('turn', 'uturn'))).toBe('right');
    expect(turnSide(mk('turn', 'uturn', undefined, 'right'))).toBe('left');
    expect(turnSide(mk('turn', 'straight'))).toBeUndefined();
    expect(turnSide(mk('fork', 'slight left'))).toBeUndefined();
    expect(turnSide(mk('new name', 'straight'))).toBeUndefined();
    expect(turnSide(mk('turn', 'left', [{ indications: ['left'], valid: true }, { indications: ['straight'], valid: false }]))).toBeUndefined();
  });

  it('leaves the lane out with lane alerts off', () => {
    const r = road(2000, [{ m: 1200, type: 'turn', modifier: 'left' }], 12);
    const eng = new NavEngine();
    eng.setRoute(r, []);
    eng.laneMode = 'off';
    expect(drive(eng, r, 12).some(({ pr }) => pr.side)).toBe(false);
  });

  it('gives a turn on a short block one heads-up with the real distance', () => {
    const r = road(1400, [
      { m: 700, type: 'turn', modifier: 'left' },
      { m: 950, type: 'turn', modifier: 'right' },
    ], 10);
    const eng = new NavEngine();
    eng.setRoute(r, []);
    const second = drive(eng, r, 10).filter(({ pr }) => pr.kind === 'maneuver' && pr.step.index === 2);
    // 250 m is too short for the 500 m and 180 m notices: one as the first turn is passed, then the turn itself.
    expect(second.length).toBe(2);
    expect(second[0].s).toBeGreaterThanOrEqual(700);
    expect(second[0].s).toBeLessThan(740);
    expect(second[0].pr.distance).toBeGreaterThan(200);
    expect(second[0].pr.side).toBe('right');
    expect(spokenInstruction(second[0].pr.step, second[0].pr.distance, 'en', 'metric')).toMatch(/^In (200|250) metres, turn right onto Jalan 2$/);
    expect(second[1].pr.distance).toBeNull();
  });

  it('does not repeat the first instruction the app says as guidance starts', () => {
    const r = road(1000, [{ m: 250, type: 'turn', modifier: 'left' }], 10);
    const eng = new NavEngine();
    eng.setRoute(r, []);
    const first = drive(eng, r, 10).filter(({ pr }) => pr.kind === 'maneuver' && pr.step.index === 1);
    expect(first.map(({ pr }) => pr.distance)).toEqual([null]);
  });
});
