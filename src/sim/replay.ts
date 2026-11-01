/**
 * Headless replay of a simulated drive: the same speeds as the simulator, GPS cut inside longer
 * tunnels with dead reckoning filling in, and the navigation engine's progress and prompts for
 * every fix. Used by the drive report on GitHub Actions to check the test drives without a
 * browser; the app itself drives with the Simulator in src/nav/sources.ts.
 */
import type { JunctionCandidate } from '../junction/detect';
import { NavEngine, type Fix, type Progress, type Prompt } from '../nav/engine';
import { simSpeedAt } from '../nav/sources';
import { isMajor, type TunnelSpan } from '../nav/tunnels';
import type { Route } from '../routing/types';

export interface ReplayOptions {
  junctions: JunctionCandidate[];
  tunnels?: TunnelSpan[];
  /** Seconds per tick of simulated time. */
  dt?: number;
  onProgress?: (p: Progress, prompts: Prompt[]) => void;
  /** A junction view comes up (the engine's junction changed to this one). */
  onJunction?: (cand: JunctionCandidate, p: Progress) => void;
}

export interface ReplayResult {
  fixes: number;
  estimated: number;
  offRoute: number;
  /** Simulated seconds. */
  seconds: number;
}

/** GPS outages the simulator applies: inside tunnels long enough for a sign (as in main.ts). */
export function outagesFor(spans: TunnelSpan[]): [number, number][] {
  return spans.filter(isMajor).map((t) => [t.fromS + 15, t.toS - 10]);
}

export function replayDrive(route: Route, o: ReplayOptions): ReplayResult {
  const engine = new NavEngine();
  engine.setRoute(route, o.junctions);
  engine.setTunnels(o.tunnels ?? []);
  const outages = outagesFor(o.tunnels ?? []);
  const line = route.line;
  const dt = o.dt ?? 0.25;
  let s = 0;
  let t = 0;
  let active: string | null = null;
  const res: ReplayResult = { fixes: 0, estimated: 0, offRoute: 0, seconds: 0 };
  const feed = (fix: Fix) => {
    const p = engine.update(fix);
    if (!p) return;
    res.fixes++;
    if (p.dr) res.estimated++;
    if (p.offRoute) res.offRoute++;
    const prompts = engine.prompts(p);
    o.onProgress?.(p, prompts);
    const cand = p.junction?.cand ?? null;
    if (cand && cand.id !== active) o.onJunction?.(cand, p);
    active = cand?.id ?? null;
  };
  for (let guard = 0; guard < 200_000; guard++) {
    const v = simSpeedAt(route, s);
    s = Math.min(line.length, s + v * dt);
    t += dt * 1000;
    if (outages.some(([a, b]) => s >= a && s <= b)) {
      // No GPS: the app's dead reckoning timer runs every 300 ms.
      const est = engine.deadReckon(t);
      if (est) feed(est);
    } else {
      feed({ lngLat: line.pointAt(s), accuracy: 3, heading: line.bearingAt(s, 15), speed: v, time: t });
    }
    if (s >= line.length) break;
  }
  res.seconds = t / 1000;
  return res;
}
