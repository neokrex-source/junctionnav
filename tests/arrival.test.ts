import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import type { LngLat } from '../src/geo/geo';
import { ARRIVAL_RADIUS, ARRIVED_AT, arrivalRadius, NavEngine, type Prompt } from '../src/nav/engine';
import { arrivalNearSpeech, arrivalSpeech, stoppedNearSpeech } from '../src/routing/instructions';
import { normalizeOsrm, type OsrmResponse, type OsrmStep } from '../src/routing/osrm';
import type { Route } from '../src/routing/types';

const route = () => normalizeOsrm(structuredClone(buildDemo().osrm), 'Demo')[0];

const O: LngLat = [101.6, 3.1];
const at = (m: number): LngLat => [O[0] + m / 111_157, O[1]];

/** An eastbound road with maneuvers at the given distances. */
function road(length: number, specs: { m: number; type: string; modifier?: string }[], speed = 12): Route {
  const coords: LngLat[] = [];
  for (let m = 0; m <= length; m += 25) coords.push(at(m));
  if (length % 25) coords.push(at(length));
  const all = [{ m: 0, type: 'depart' }, ...specs];
  const steps: OsrmStep[] = all.map((sp, i) => {
    const dist = (all[i + 1]?.m ?? length) - sp.m;
    return {
      distance: dist,
      duration: dist / speed,
      name: `Jalan ${i}`,
      mode: 'driving',
      driving_side: 'left',
      maneuver: { type: sp.type, modifier: sp.modifier, location: at(sp.m), bearing_before: 90, bearing_after: 90 },
      intersections: [{ location: at(sp.m), bearings: [270, 90], entry: [false, true], in: 0, out: 1 }],
    } as OsrmStep;
  });
  const json = { code: 'Ok', routes: [{ distance: length, duration: length / speed, geometry: { type: 'LineString', coordinates: coords }, legs: [{ steps, summary: '', distance: length, duration: length / speed }] }] } as OsrmResponse;
  return normalizeOsrm(json, 'Test')[0];
}

function drive(r: Route, step = 5, speed = 12) {
  const eng = new NavEngine();
  eng.setRoute(r, []);
  const out: { pr: Prompt; left: number }[] = [];
  let time = 1e6;
  for (let s = 0; s <= r.line.length; s += step, time += (step / speed) * 1000) {
    const p = eng.update({ lngLat: r.line.pointAt(s), accuracy: 4, heading: r.line.bearingAt(s), speed, time })!;
    for (const pr of eng.prompts(p)) out.push({ pr, left: r.line.length - s });
  }
  return { eng, out };
}

describe('arrival', () => {
  it('says the destination is 300 m ahead as the car comes into the zone, and arrives at the end, not before', () => {
    const r = route();
    expect(arrivalRadius(r)).toBe(ARRIVAL_RADIUS);
    const { eng, out } = drive(r, 15, 15);
    const near = out.filter((x) => x.pr.kind === 'arriveNear');
    const arrived = out.filter((x) => x.pr.kind === 'arrived');
    expect(near.length).toBe(1);
    // As the car comes into the zone, or right after the last turn when that is closer.
    const lastTurn = r.steps[r.steps.length - 2].s;
    const from = Math.min(ARRIVAL_RADIUS, r.line.length - lastTurn);
    expect(near[0].left).toBeLessThanOrEqual(from);
    expect(near[0].left).toBeGreaterThan(from - 20);
    expect(arrived.length).toBe(1);
    expect(arrived[0].left).toBeLessThanOrEqual(ARRIVED_AT);
    // No "in 500 metres, you have arrived".
    expect(out.filter((x) => x.pr.step.type === 'arrive' && x.pr.kind === 'maneuver')).toEqual([]);
    expect(eng.progress!.arrived).toBe(true);
  });

  it('still announces a turn inside the last 300 m, then the destination after it', () => {
    const r = road(1500, [
      { m: 1350, type: 'turn', modifier: 'left' },
      { m: 1500, type: 'arrive', modifier: 'right' },
    ]);
    const { out } = drive(r);
    const kinds = out.map((x) => x.pr.kind);
    const turnNow = out.find((x) => x.pr.kind === 'maneuver' && x.pr.step.type === 'turn' && x.pr.distance == null);
    expect(turnNow).toBeDefined();
    const near = out.find((x) => x.pr.kind === 'arriveNear')!;
    expect(near.pr.side).toBe('right');
    expect(kinds.indexOf('arriveNear')).toBeGreaterThan(kinds.indexOf('maneuver'));
    expect(kinds[kinds.length - 1]).toBe('arrived');
  });

  it('leaves out the 300 m heads-up when the last stretch after a turn is too short for it', () => {
    const r = road(1500, [
      { m: 1460, type: 'turn', modifier: 'right' },
      { m: 1500, type: 'arrive' },
    ]);
    const { out } = drive(r);
    expect(out.some((x) => x.pr.kind === 'arriveNear')).toBe(false);
    expect(out.filter((x) => x.pr.kind === 'arrived').length).toBe(1);
  });

  it('says it in each language, with the side when known', () => {
    expect(arrivalSpeech('en')).toBe('You have reached your destination.');
    expect(arrivalSpeech('en', 'left')).toBe('You have reached your destination. It is on your left.');
    expect(arrivalSpeech('ms', 'right')).toBe('Anda telah sampai ke destinasi. Destinasi di sebelah kanan.');
    expect(arrivalSpeech('ja')).toBe('目的地に到着しました。');
    expect(arrivalNearSpeech(300, 'en', 'metric', 'left')).toBe('Your destination is 300 metres ahead, on the left.');
    expect(arrivalNearSpeech(300, 'ms', 'metric')).toBe('Destinasi anda 300 meter di hadapan.');
    expect(stoppedNearSpeech(200, 'en', 'metric')).toBe('Your destination is about 200 metres from here. Guidance ends.');
  });
});
