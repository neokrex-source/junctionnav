import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import { detectJunctions } from '../src/junction/detect';
import { buildScene, type JunctionScene } from '../src/junction/scene';
import { tunnelsFromRoute } from '../src/nav/tunnels';
import { normalizeOsrm } from '../src/routing/osrm';
import { KL_DRIVES, type TestDrive } from '../src/sim/drives';
import { replayDrive } from '../src/sim/replay';
import { CHECKS, TestRun, type CheckId } from '../src/sim/testRun';
import { parseTripLink } from '../src/trip/tripLink';

const demo = buildDemo();
const route = () => normalizeOsrm(structuredClone(demo.osrm), 'Demo')[0];
const ALL = Object.keys(CHECKS) as CheckId[];
const probe = (checks: CheckId[] = ALL): TestDrive => ({ id: 'demo', title: 'Demo', summary: '', link: '', checks, km: 6 });

/** Replays the demo drive with the checklist watching, as the drive report does on real data. */
function replayDemo(drive: TestDrive) {
  const r = route();
  const js = detectJunctions(r);
  const scenes = new Map<string, JunctionScene>(js.map((j) => [j.id, buildScene(r, j, demo.osm)]));
  const ticks: CheckId[] = [];
  const run = new TestRun(drive, (id) => ticks.push(id));
  run.routePlanned(r.provider, r.distance);
  const rep = replayDrive(r, {
    junctions: js,
    tunnels: tunnelsFromRoute(r),
    onProgress: (p, prompts) => run.progress(p, prompts),
    onJunction: (cand) => {
      run.junctionShown(cand, scenes.get(cand.id)!);
      run.map3dShown(scenes.get(cand.id)!);
    },
  });
  return { run, rep, ticks };
}

describe('test drive checklist', () => {
  it('ticks the functions the demo drive shows, in the order they come up', () => {
    const { run, rep, ticks } = replayDemo(probe());
    expect(rep.offRoute).toBe(0);
    expect(rep.estimated).toBeGreaterThan(0);
    for (const id of ['route', 'junction', 'flyover', 'tunnel', 'map3d', 'tunnelSign', 'dr', 'exitNumber', 'lanes', 'arrival'] as CheckId[]) {
      expect(run.done.has(id), id).toBe(true);
    }
    expect(run.done.get('exitNumber')).toBe('Exit 114');
    expect(run.done.get('flyover')).toMatch(/^\+\d+\.\d m, steepest \d/);
    expect(ticks[0]).toBe('route');
    expect(ticks[ticks.length - 1]).toBe('arrival');
    expect(ticks.indexOf('tunnelSign')).toBeLessThan(ticks.indexOf('dr'));
    expect(run.views.length).toBeGreaterThan(2);
  });

  it('only counts the checks a drive lists, once each', () => {
    const changes: CheckId[] = [];
    const run = new TestRun(probe(['route', 'arrival']), (id) => changes.push(id));
    expect(run.mark('dr')).toBe(false);
    expect(run.mark('route', 'Demo')).toBe(true);
    expect(run.mark('route', 'again')).toBe(false);
    expect(run.done.get('route')).toBe('Demo');
    expect(changes).toEqual(['route']);
    expect(run.missing).toEqual(['arrival']);
    expect(`${run.passed}/${run.total}`).toBe('1/2');
  });

  it('defines every KL drive as a valid trip link with known checks', () => {
    expect(KL_DRIVES.length).toBeGreaterThanOrEqual(5);
    for (const d of KL_DRIVES) {
      const spec = parseTripLink(`?${d.link}`);
      expect(spec, d.id).not.toBeNull();
      expect(spec!.sim, d.id).toBeGreaterThan(0);
      for (const c of d.checks) expect(CHECKS[c], `${d.id}: ${c}`).toBeDefined();
      expect(d.checks.slice(0, 1)).toEqual(['route']);
      expect(d.checks[d.checks.length - 1]).toBe('arrival');
      if (d.checks.includes('toll')) expect(d.tollStop, d.id).toBeGreaterThan(0);
      if (d.tollStop) expect(spec!.via.length, d.id).toBeGreaterThanOrEqual(d.tollStop);
    }
    expect(new Set(KL_DRIVES.map((d) => d.id)).size).toBe(KL_DRIVES.length);
  });
});
