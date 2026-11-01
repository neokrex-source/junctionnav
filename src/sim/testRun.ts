/**
 * Checklist for a test drive: which app functions the drive should show, ticked off as the app
 * actually does them (a junction view appears, a ramp climbs onto a flyover, lane advice is
 * spoken, the tunnel card appears, arrival is announced...).
 *
 * The app feeds it what it shows; the drive report on GitHub Actions feeds it the same things
 * from a replay of the drive on the real offline maps (see src/sim/replay.ts), so a drive that
 * passes there should pass in the app too.
 */
import type { JunctionCandidate } from '../junction/detect';
import type { JunctionScene, ProfileKind } from '../junction/scene';
import type { Progress, Prompt } from '../nav/engine';
import type { LaneState } from '../nav/lanes';
import type { TestDrive } from './drives';

export type CheckId =
  | 'route'
  | 'junction'
  | 'exitNumber'
  | 'lanes'
  | 'flyover'
  | 'descend'
  | 'underpass'
  | 'tunnel'
  | 'ascend'
  | 'map3d'
  | 'toll'
  | 'tunnelSign'
  | 'dr'
  | 'arrival';

export const CHECKS: Record<CheckId, { title: string; how: string }> = {
  route: { title: 'Route planned', how: 'With the online router, or the offline maps without internet.' },
  junction: { title: 'Junction view appears', how: 'About 1 km before each exit, entrance or split on expressways.' },
  exitNumber: { title: 'Exit number on the sign', how: 'The exit tab on the junction view sign.' },
  lanes: { title: 'Lane advice', how: 'Voice and banner say which lanes to use before the exit or split. Needs lane alerts on in Settings.' },
  flyover: { title: 'Ramp climbs onto a flyover', how: 'The height pill on the junction view shows the climb.' },
  descend: { title: 'Ramp drops to street level', how: 'The height pill shows the drop from the elevated road.' },
  underpass: { title: 'Road dips into an underpass', how: 'The height pill shows the drop below the crossing road.' },
  tunnel: { title: 'Junction leads into a tunnel', how: 'The height pill shows the road going under.' },
  ascend: { title: 'Road climbs back to street level', how: 'The height pill shows the climb out.' },
  map3d: { title: '3D ramps on the map view', how: 'Junction view in Map or Both mode at a ramp that climbs or drops: the ramp stands up in 3D and the car rides on it.' },
  toll: { title: 'Through the toll plaza', how: 'The stop at the toll plaza is passed on the right side of the road.' },
  tunnelSign: { title: 'Tunnel sign', how: 'Tunnel name and length before the entrance, then distance to the exit. Needs tunnel alerts on in Settings.' },
  dr: { title: 'Guidance without GPS in the tunnel', how: 'The simulator cuts GPS inside the tunnel: "position estimated" on the tunnel card, and no reroute.' },
  arrival: { title: 'Arrival announced', how: '"You have reached your destination" within 300 m of the end.' },
};

/** Junction height kinds that are checks of their own. */
const HEIGHT_CHECKS: Partial<Record<ProfileKind, CheckId>> = {
  flyover: 'flyover',
  descend: 'descend',
  underpass: 'underpass',
  tunnel: 'tunnel',
  ascend: 'ascend',
};

/** The 3D map view frames a ramp when it climbs or drops at least this much (see zoomMap.ts). */
export const LIFTED = 2.5;

export function heightText(scene: JunctionScene): string {
  const p = scene.profile;
  const h = p.peak.h;
  return `${h >= 0 ? '+' : '−'}${Math.abs(h).toFixed(1)} m, steepest ${p.grade}%`;
}

function laneText(l: LaneState): string {
  const t = l.target;
  const n = t.to - t.from + 1;
  const which = n >= t.count ? 'any lane' : t.side === 'middle' ? `middle ${n}` : `${t.side} ${n}`;
  return `${which} of ${t.count} for the ${t.label}`;
}

export class TestRun {
  readonly done = new Map<CheckId, string>();
  readonly started = Date.now();
  /** Junction views seen, with what they showed, for the result. */
  readonly views: string[] = [];
  private seenViews = new Set<string>();

  constructor(
    readonly drive: TestDrive,
    private onChange: (id: CheckId, detail: string) => void = () => {},
  ) {}

  get checks(): CheckId[] {
    return this.drive.checks;
  }

  /** Ticks a check (once); checks the drive does not list are ignored. */
  mark(id: CheckId, detail = ''): boolean {
    if (!this.drive.checks.includes(id) || this.done.has(id)) return false;
    this.done.set(id, detail);
    this.onChange(id, detail);
    return true;
  }

  get passed(): number {
    return this.done.size;
  }

  get total(): number {
    return this.drive.checks.length;
  }

  get missing(): CheckId[] {
    return this.drive.checks.filter((c) => !this.done.has(c));
  }

  /* ------------------------------------------------------------ what the app shows */

  routePlanned(provider: string, metres: number) {
    this.mark('route', `${provider}, ${(metres / 1000).toFixed(1)} km`);
  }

  /** Every position update with the prompts it produced; `tunnelCard` when tunnel signs are on. */
  progress(p: Progress, prompts: Prompt[], tunnelCard = true) {
    for (const pr of prompts) {
      if (pr.lane && (pr.kind === 'laneEarly' || (pr.kind === 'maneuver' && pr.lane.status !== 'ok'))) this.mark('lanes', laneText(pr.lane));
    }
    if (tunnelCard && p.tunnel) {
      const sp = p.tunnel.span;
      this.mark('tunnelSign', `${sp.name ?? 'Tunnel'}, ${Math.round(sp.length)} m`);
    }
    if (p.dr) this.mark('dr', p.tunnel ? `${Math.round(p.tunnel.toExit)} m to the exit, estimated` : 'Position estimated');
    const toll = this.drive.tollStop;
    if (toll && p.stopsPassed >= toll) this.mark('toll', `Stop ${toll} passed`);
    if (p.nearDestination) this.mark('arrival', `${Math.round(p.remaining)} m before the end`);
  }

  /** A junction view is on screen (called again when OSM detail or terrain arrives). */
  junctionShown(cand: JunctionCandidate, scene: JunctionScene) {
    const key = `${cand.id}|${scene.source}|${scene.profile.kind}`;
    if (!this.seenViews.has(key)) {
      this.seenViews.add(key);
      this.views.push(`${(cand.s / 1000).toFixed(1)} km ${cand.kind}: ${scene.profile.kind}${scene.profile.kind !== 'flat' ? ` ${heightText(scene)}` : ''}`);
    }
    this.mark('junction', `${cand.kind} at ${(cand.s / 1000).toFixed(1)} km`);
    const ref = scene.exitRef ?? scene.signs.find((s) => s.taken)?.exitRef;
    if (ref) this.mark('exitNumber', `Exit ${ref}`);
    const id = HEIGHT_CHECKS[scene.profile.kind];
    if (id) this.mark(id, heightText(scene));
  }

  /** The car is riding the 3D route on the map view at a ramp that climbs or drops. */
  map3dShown(scene: JunctionScene) {
    if (Math.abs(scene.profile.peak.h) >= LIFTED) this.mark('map3d', `${scene.profile.kind} ${heightText(scene)}`);
  }
}
