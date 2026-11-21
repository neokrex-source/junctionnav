import { describe, expect, it } from 'vitest';
import { forkInfo, forkSpeech, lanePhrase, lanesFromLeft } from '../src/routing/instructions';
import { markOpposite, type RoadStrip } from '../src/junction/scene';
import type { Lane, Step } from '../src/routing/types';
import type { LaneState } from '../src/nav/lanes';

const lanes = (...valid: boolean[]): Lane[] => valid.map((v) => ({ indications: [], valid: v }));

/** A step at a split: roads going on at `ahead` (degrees off the way we come in), the route on `take`. */
function split(ahead: number[], take: number, over: Partial<Step> = {}, laneData?: Lane[]): Step {
  const bearings = [180, ...ahead.map((d) => (d + 360) % 360)];
  return {
    index: 3,
    type: 'fork',
    modifier: ahead[take] < 0 ? 'slight left' : ahead[take] > 0 ? 'slight right' : 'straight',
    location: [101.6, 3.1],
    bearingBefore: 0,
    bearingAfter: bearings[take + 1],
    name: '',
    destinations: 'E35: Kuala Lumpur, Sungai Buloh',
    drivingSide: 'left',
    distance: 1000,
    duration: 40,
    intersections: [{ location: [101.6, 3.1], bearings, entry: bearings.map((_, i) => i !== 0), in: 0, out: take + 1, ...(laneData ? { lanes: laneData } : {}) }],
    s: 5000,
    ...over,
  } as Step;
}

describe('which fork to take, and its lanes from the left', () => {
  it('tells the forks apart by where they go from the split, left to right', () => {
    expect(forkInfo(split([-20, 20], 1, {}, lanes(false, false, true, true)))).toEqual({ branch: 1, branches: 2, lanes: { from: 2, to: 3, count: 4 } });
    expect(forkInfo(split([-25, 0, 25], 1))).toMatchObject({ branch: 1, branches: 3, lanes: null });
    expect(forkInfo(split([-40, -12, 12, 40], 1))).toMatchObject({ branch: 1, branches: 4 });
    // A road off to the side is not one of the forks.
    expect(forkInfo(split([-90, -15, 15], 2))).toMatchObject({ branch: 1, branches: 2 });
    // Not a fork: a turn, or a keep with no other road going on.
    expect(forkInfo(split([-20, 20], 1, { type: 'turn' }))).toBeNull();
    expect(forkInfo(split([15], 0, { type: 'continue', modifier: 'slight right' }))).toBeNull();
    // A keep right where another road goes on too is a fork.
    expect(forkInfo(split([-15, 15], 1, { type: 'new name', modifier: 'slight right' }))?.branches).toBe(2);
    // Another router's fork without the roads: the side it says.
    expect(forkInfo({ ...split([-20, 20], 0), intersections: [] })).toMatchObject({ branch: 0, branches: 2 });
  });

  it('says it: "take the right fork toward …, in the 3rd and 4th lanes from the left"', () => {
    const st = split([-20, 20], 1, {}, lanes(false, false, true, true));
    expect(forkSpeech(st, 1000, 'en', 'metric')).toBe('In 1 kilometre, take the right fork toward Kuala Lumpur / Sungai Buloh, in the 3rd and 4th lanes from the left');
    // The "now" prompt: which fork, no lanes (too late to change).
    expect(forkSpeech(st, null, 'en', 'metric')).toBe('Take the right fork toward Kuala Lumpur / Sungai Buloh');
    expect(forkSpeech(st, 1000, 'ms', 'metric')).toBe('Dalam 1 kilometer, ambil simpang kanan ke arah Kuala Lumpur / Sungai Buloh, di lorong ke-3 dan ke-4 dari kiri');
    expect(forkSpeech(st, 1000, 'ja', 'metric')).toBe('1キロ先、Kuala Lumpur / Sungai Buloh方面、右側の分岐へ進み、左から3番目と4番目の車線を走行してください');
    const one = split([-25, 0, 25], 1, { destinations: '' , name: 'Jalan Duta' }, lanes(false, true, false, false));
    expect(forkSpeech(one, 500, 'en', 'metric')).toBe('In 500 metres, take the middle fork onto Jalan Duta, in the 2nd lane from the left');
    expect(forkSpeech(split([-40, -12, 12, 40], 1, { destinations: '' }), 400, 'en', 'metric')).toBe('In 400 metres, take the 2nd fork from the left');
    expect(forkSpeech(split([-20, 20], 1, { type: 'turn' }), 400, 'en', 'metric')).toBeNull();
  });

  it('counts lanes from the left (a two-lane road is just left or right)', () => {
    expect(lanesFromLeft({ from: 1, to: 1, count: 4 }, 'en')).toBe('in the 2nd lane from the left');
    expect(lanesFromLeft({ from: 0, to: 1, count: 3 }, 'en')).toBe('in the 1st and 2nd lanes from the left');
    expect(lanesFromLeft({ from: 1, to: 3, count: 5 }, 'en')).toBe('in lanes 2 to 4 from the left');
    expect(lanesFromLeft({ from: 1, to: 1, count: 2 }, 'en')).toBe('in the right lane');
    expect(lanesFromLeft({ from: 1, to: 1, count: 4 }, 'ms')).toBe('di lorong ke-2 dari kiri');
    expect(lanesFromLeft({ from: 1, to: 1, count: 4 }, 'ja')).toBe('左から2番目の車線');
  });

  it('lane advice for lanes in the middle counts from the left too', () => {
    const st = split([-20, 20], 1);
    const l = { target: { step: st, count: 4, from: 1, to: 2, side: 'middle', known: true, worst: 1, checkable: true, adviseAt: 1000, fromS: 4000, fast: true, label: 'junction', viaTunnel: null }, dist: 900, status: 'advise', current: null, move: null, changes: 1 } as unknown as LaneState;
    expect(lanePhrase('hint', l, 'en', 'metric')).toBe('Use the 2nd and 3rd lanes from the left.');
    expect(lanePhrase('hint', l, 'ms', 'metric')).toBe('Gunakan lorong ke-2 dan ke-3 dari kiri.');
  });
});

describe('the other carriageway in the junction view', () => {
  const strip = (id: string, role: RoadStrip['role'], pts: [number, number][], oneway = true): RoadStrip => ({
    id,
    role,
    cls: 'motorway',
    pts,
    h: pts.map(() => 0),
    width: pts.map(() => 10.5),
    lanes: pts.map(() => 3),
    laneWidth: 3.5,
    shoulder: 1,
    oneway,
    guardrail: true,
    tunnel: pts.map(() => false),
    s: pts.map((_, i) => i * 20),
  });
  const line = (x0: number, y0: number, x1: number, y1: number, n = 16): [number, number][] => Array.from({ length: n }, (_, i) => [x0 + ((x1 - x0) * i) / (n - 1), y0 + ((y1 - y0) * i) / (n - 1)]);

  it('leaves out traffic the other way alongside, and its ramps; keeps the rest', () => {
    const approach = strip('a', 'approach', line(0, -300, 0, 0));
    const taken = strip('t', 'taken', line(0, 0, 0, 300));
    const opposite = strip('o', 'context', line(28, 300, 28, -300, 31));
    const sameWay = strip('p', 'context', line(70, -300, 70, 300, 31));
    const crossing = strip('x', 'context', line(-200, 120, 200, 120), false);
    const oppRamp = strip('r', 'context', line(28, 40, 70, -40, 8));
    const ourRamp = strip('q', 'context', line(0, 100, 50, 180, 8));
    markOpposite([opposite, sameWay, crossing, oppRamp, ourRamp], [approach, taken]);
    expect(opposite.opposite).toBe(true);
    expect(oppRamp.opposite).toBe(true);
    expect(sameWay.opposite).toBeUndefined();
    expect(crossing.opposite).toBeUndefined();
    expect(ourRamp.opposite).toBeUndefined();
  });

  it('not a road the other way at another level (a flyover over it)', () => {
    const approach = strip('a', 'approach', line(0, -300, 0, 0));
    const over = { ...strip('o', 'context', line(10, 300, 10, -300, 31)) };
    over.h = over.pts.map(() => 9);
    markOpposite([over], [approach]);
    expect(over.opposite).toBeUndefined();
  });
});
