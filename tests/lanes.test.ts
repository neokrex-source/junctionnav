import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { destination } from '../src/geo/geo';
import { NavEngine, type LaneMode, type Prompt } from '../src/nav/engine';
import { LANE_W, laneFromOffset, laneState, laneTarget, LaneTracker, signedOffset, upcomingTarget } from '../src/nav/lanes';
import { lanePhrase } from '../src/routing/instructions';
import { normalizeOsrm } from '../src/routing/osrm';

const demo = buildDemo();
const route = () => normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];

const exitS = route().steps.find((s) => s.type === 'off ramp')!.s;

/** Drives from `fromS` past the exit with the car held `offset` metres right of the road line, one fix a second. */
function drive(offset: number, mode: LaneMode = 'gps', fromS = exitS - 1232, toS = exitS + 140, speed = 25) {
  const r = route();
  const eng = new NavEngine();
  eng.setRoute(r, []);
  eng.laneMode = mode;
  const prompts: Prompt[] = [];
  const states = [];
  let time = 1_000_000;
  for (let s = fromS; s <= toS; s += speed) {
    const brg = r.line.bearingAt(s, 15);
    const p = eng.update({ lngLat: destination(r.line.pointAt(s), brg + 90, offset), accuracy: 4, heading: brg, speed, time })!;
    expect(p.onRoute).toBe(true);
    if (p.lane) states.push({ s, ...p.lane });
    prompts.push(...eng.prompts(p));
    time += 1000;
  }
  return { r, prompts, states };
}

describe('lane advisor', () => {
  it('finds the lanes for each decision on the demo route', () => {
    const r = route();
    const exit = r.steps.find((s) => s.type === 'off ramp')!;
    const t = laneTarget(r, exit, 25)!;
    expect(t).toMatchObject({ count: 3, from: 0, to: 0, side: 'left', worst: 2, known: true, label: 'exit', fast: true });
    expect(t.adviseAt).toBeGreaterThanOrEqual(900);
    expect(t.fromS).toBeCloseTo(exit.s - t.adviseAt, 0);
    const fork = laneTarget(r, r.steps[4], 25)!;
    expect(fork).toMatchObject({ count: 4, from: 2, to: 3, side: 'right', worst: 2, label: 'junction' });
    // A merge needs no lane; the end-of-road turn off the ramp has no lane data and is slow.
    expect(laneTarget(r, r.steps[3], 25)).toBeNull();
    expect(laneTarget(r, r.steps[6], 10)).toBeNull();
    // Advice only once the window opens, and it looks past the merge to the next fork.
    expect(upcomingTarget(r, 5, exit.s - t.adviseAt - 50, 25)).toBeNull();
    expect(upcomingTarget(r, 5, exit.s - 500, 25)?.step).toBe(exit);
    expect(upcomingTarget(r, 3, r.steps[4].s - 800, 25)?.step).toBe(r.steps[4]);
  });

  it('turns a lateral offset into a lane', () => {
    expect(laneFromOffset(0, 3)).toBe(1);
    expect(laneFromOffset(-LANE_W, 3)).toBe(0);
    expect(laneFromOffset(LANE_W, 3)).toBe(2);
    expect(laneFromOffset(0, 4)).toBe(1.5);
    const r = route();
    const s = exitS - 560;
    const brg = r.line.bearingAt(s, 15);
    const right = destination(r.line.pointAt(s), brg + 90, 5);
    const left = destination(r.line.pointAt(s), brg - 90, 5);
    expect(signedOffset(r.line, r.line.project(right), right)).toBeCloseTo(5, 0);
    expect(signedOffset(r.line, r.line.project(left), left)).toBeCloseTo(-5, 0);
  });

  it('only calls a lane when GPS is good and the position is clearly in it', () => {
    const r = route();
    const t = laneTarget(r, r.steps[5], 25)!;
    const tr = new LaneTracker();
    for (let i = 0; i < 5; i++) tr.update(LANE_W, 4, i * 1000, true);
    expect(laneState(t, 900, tr, 25)).toMatchObject({ status: 'wrong', current: 2, move: 'left', changes: 2 });
    expect(laneState(t, 120, tr, 25).status).toBe('late');
    const fuzzy = new LaneTracker();
    for (let i = 0; i < 5; i++) fuzzy.update(LANE_W, 12, i * 1000, true);
    expect(laneState(t, 900, fuzzy, 25)).toMatchObject({ status: 'advise', current: null, move: 'left', changes: 2 });
    const between = new LaneTracker();
    for (let i = 0; i < 5; i++) between.update(-LANE_W * 0.25, 4, i * 1000, true);
    expect(laneState(t, 900, between, 25).current).toBeNull();
  });

  it('warns a driver who stays in the right lane before a left exit, then backs off near the split', () => {
    const { prompts } = drive(LANE_W);
    const kinds = prompts.map((p) => p.kind);
    const early = prompts.some((p) => p.kind === 'laneEarly' || (p.kind === 'maneuver' && p.lane && p.lane.target.label === 'exit'));
    expect(early).toBe(true);
    const wrong = prompts.filter((p) => p.kind === 'laneWrong');
    expect(wrong.length).toBeGreaterThanOrEqual(1);
    expect(wrong.length).toBeLessThanOrEqual(3);
    expect(wrong[0].lane).toMatchObject({ move: 'left', changes: 2, current: 2 });
    expect(kinds.filter((k) => k === 'laneLate').length).toBe(1);
    // Never two lane alerts in the same second, and no wrong-lane alert once it is too late.
    const late = prompts.findIndex((p) => p.kind === 'laneLate');
    expect(prompts.slice(late).some((p) => p.kind === 'laneWrong')).toBe(false);
    expect(lanePhrase('wrong', wrong[0].lane!, 'en', 'metric')).toBe("You're not in a lane for exit 114. Move 2 lanes to the left.");
  });

  it('confirms the lane and stays quiet when already in the exit lane', () => {
    const { prompts, states } = drive(-LANE_W);
    expect(prompts.some((p) => p.kind === 'laneWrong' || p.kind === 'laneLate' || p.kind === 'laneEarly')).toBe(false);
    const exitStates = states.filter((st) => st.target.label === 'exit');
    expect(exitStates.length).toBeGreaterThan(20);
    expect(exitStates.slice(5).every((st) => st.status === 'ok' && st.current === 0)).toBe(true);
    expect(lanePhrase('cue', exitStates[10], 'en', 'metric')).toBe("You're in a correct lane");
  });

  it('gives early advice only, without a lane check, in advice mode', () => {
    const { prompts, states } = drive(LANE_W, 'advice');
    expect(prompts.some((p) => p.kind === 'laneWrong' || p.kind === 'laneLate')).toBe(false);
    expect(states.every((st) => st.current === null)).toBe(true);
    const adv = states.find((st) => st.target.label === 'exit')!;
    expect(lanePhrase('early', { ...adv, dist: 1200 }, 'en', 'metric')).toBe('Exit 114 in 1.2 kilometres. Move to the left lane.');
    expect(lanePhrase('early', { ...adv, dist: 1000 }, 'ms', 'metric')).toContain('lorong kiri');
    expect(lanePhrase('wrong', { ...adv, status: 'wrong', move: 'left', changes: 1 }, 'ja', 'metric')).toBe('出口の車線ではありません。左へ1車線移動してください。');
  });

  it('is silent when lane alerts are off', () => {
    const { prompts, states } = drive(LANE_W, 'off');
    expect(states.length).toBe(0);
    expect(prompts.every((p) => p.kind === 'maneuver' && !p.lane)).toBe(true);
  });
});
