/**
 * Lane advisor: which lanes to be in before an exit, entrance, junction, split or turn,
 * when to start saying so, and a cautious estimate of the current lane from GPS.
 */
import { clamp, lerp, LocalFrame, type LngLat, type Polyline, type Projection } from '../geo/geo';
import type { Route, Step } from '../routing/types';
import { TUNNEL_MIN_SIGN, type TunnelSpan } from './tunnels';

export const LANE_W = 3.5;

export type LaneLabel = 'exit' | 'ramp' | 'junction' | 'turn' | 'split';

export interface LaneTarget {
  step: Step;
  /** Lane count on the approach. */
  count: number;
  /** Lanes to be in, inclusive, counted from the left. */
  from: number;
  to: number;
  /** Where the target lanes are on the carriageway. */
  side: 'left' | 'right' | 'middle';
  /** True when the router gave lane data for this maneuver. */
  known: boolean;
  /** Lane changes needed from the farthest lane. */
  worst: number;
  /** A GPS lane check makes sense here (multi-lane carriageway). */
  checkable: boolean;
  /** Start advising this far before the maneuver. */
  adviseAt: number;
  /** Along-route position where advice starts. */
  fromS: number;
  fast: boolean;
  label: LaneLabel;
  /** A tunnel between the start of the advice and the maneuver: change lanes before it. */
  viaTunnel: TunnelSpan | null;
}

export type LaneStatus = 'advise' | 'ok' | 'wrong' | 'late';

export interface LaneState {
  target: LaneTarget;
  dist: number;
  /** Estimated current lane (from the left), when confident. */
  current: number | null;
  status: LaneStatus;
  /** Direction to move when not in a target lane. */
  move: 'left' | 'right' | null;
  /** Lanes to cross. */
  changes: number;
}

function sideOf(step: Step): 'left' | 'right' | 'middle' {
  const m = step.modifier ?? '';
  if (m.includes('left')) return 'left';
  if (m.includes('right')) return 'right';
  return 'middle';
}

function stepSpeed(step: Step | undefined): number {
  return step && step.duration > 0 ? step.distance / step.duration : 0;
}

/** Steps that do not need a lane of their own; advice looks past them to the next real decision. */
const PASS_THROUGH = new Set(['new name', 'continue', 'notification', 'merge', 'use lane']);

function labelOf(step: Step): LaneLabel | null {
  switch (step.type) {
    case 'off ramp':
      return 'exit';
    case 'on ramp':
      return 'ramp';
    case 'fork':
      return 'junction';
    case 'turn':
    case 'end of road':
      return step.modifier === 'straight' ? null : 'turn';
    case 'continue':
    case 'new name':
    case 'use lane':
      return 'split';
    default:
      return null;
  }
}

/** Lane target for one maneuver, or null if it needs no particular lane. */
export function laneTarget(route: Route, step: Step, speed: number, tunnels: TunnelSpan[] = []): LaneTarget | null {
  const label = labelOf(step);
  if (!label) return null;
  const prev = route.steps[step.index - 1];
  const classes = prev?.intersections.flatMap((ix) => ix.classes ?? []) ?? [];
  const fast = classes.includes('motorway') || stepSpeed(prev) > 16 || speed > 18;
  const lanes = step.intersections[0]?.lanes;
  let side = sideOf(step);
  let count: number;
  let from: number;
  let to: number;
  let known = false;
  if (lanes && lanes.length >= 2 && lanes.some((l) => l.valid) && lanes.some((l) => !l.valid)) {
    known = true;
    count = lanes.length;
    const valid = lanes.map((l, i) => (l.valid ? i : -1)).filter((i) => i >= 0);
    from = Math.min(...valid);
    to = Math.max(...valid);
    if (from === 0 && to < count - 1) side = 'left';
    else if (to === count - 1 && from > 0) side = 'right';
    else if (from > 0 && to < count - 1) side = 'middle';
  } else {
    // No lane data: only advise on fast roads where the side is clear.
    if (!fast || side === 'middle' || label === 'split' || label === 'turn') return null;
    count = 3;
    const k = label === 'junction' ? 2 : 1;
    from = side === 'left' ? 0 : count - k;
    to = side === 'left' ? k - 1 : count - 1;
  }
  const worst = side === 'left' ? count - 1 - to : side === 'right' ? from : Math.max(from, count - 1 - to);
  if (worst <= 0) return null;
  const perLane = Math.max(250, speed * 9);
  let adviseAt = fast ? clamp(700 + worst * perLane, 900, 3000) : clamp(150 + worst * 110, 220, 800);
  const floor = prev ? prev.s + 30 : 0;
  let fromS = Math.max(floor, step.s - adviseAt);
  // Lane changes in tunnels are often banned and always harder: when a tunnel ends inside the
  // advice window, move the advice to before its entrance (walking back through tunnel chains).
  let viaTunnel: TunnelSpan | null = null;
  for (let guard = 0; guard < 4; guard++) {
    const tn = tunnels.find((t) => t.length >= TUNNEL_MIN_SIGN && t.toS > fromS && t.toS <= step.s - 20);
    if (!tn || tn === viaTunnel) break;
    viaTunnel = tn;
    const lead = fast ? 250 + worst * 200 : 60 + worst * 60;
    const next = Math.max(floor, step.s - 4000, Math.min(fromS, tn.fromS - lead));
    if (next >= fromS) break;
    fromS = next;
  }
  // Advice that can only start inside the tunnel is plain advice.
  if (viaTunnel && fromS >= viaTunnel.fromS) viaTunnel = null;
  adviseAt = step.s - fromS;
  return { step, count, from, to, side, known, worst, checkable: known || fast, adviseAt, fromS, fast, label, viaTunnel };
}

/** Next lane target ahead of `s`, looking past steps that are not decisions. */
export function upcomingTarget(route: Route, nextIndex: number, s: number, speed: number, tunnels: TunnelSpan[] = []): LaneTarget | null {
  for (let i = nextIndex; i < route.steps.length; i++) {
    const step = route.steps[i];
    if (step.s - s > 4200) return null;
    const t = laneTarget(route, step, speed, tunnels);
    if (t) return s >= t.fromS ? t : null;
    if (!PASS_THROUGH.has(step.type) || (step.intersections[0]?.lanes?.length ?? 0) > 0) return null;
  }
  return null;
}

/** Signed distance of p from the line at the projection, positive to the right of travel. */
export function signedOffset(line: Polyline, proj: Projection, p: LngLat): number {
  const i = Math.min(proj.idx, line.coords.length - 2);
  if (i < 0) return 0;
  const f = new LocalFrame(proj.point);
  const [ax, ay] = f.toXY(line.coords[i]);
  const [bx, by] = f.toXY(line.coords[i + 1]);
  const [px, py] = f.toXY(p);
  const cross = (bx - ax) * py - (by - ay) * px;
  return cross > 0 ? -proj.dist : proj.dist;
}

/** Fractional lane index (0 = centre of the leftmost lane) for an offset from the carriageway centre. */
export function laneFromOffset(offsetRight: number, count: number, w = LANE_W): number {
  return offsetRight / w + (count - 1) / 2;
}

/** Smooths the lateral offset and accuracy over a few seconds. */
export class LaneTracker {
  private x = 0;
  private acc = 50;
  private t = 0;
  samples = 0;

  update(offsetRight: number, accuracy: number, time: number, onRoute: boolean) {
    if (!onRoute) {
      this.samples = 0;
      return;
    }
    const dt = this.t ? clamp((time - this.t) / 1000, 0, 5) : 1;
    this.t = time;
    const a = 1 - Math.exp(-dt / 2.5);
    this.x = this.samples ? lerp(this.x, offsetRight, a) : offsetRight;
    this.acc = this.samples ? lerp(this.acc, accuracy, a) : accuracy;
    this.samples++;
  }

  reset() {
    this.samples = 0;
    this.t = 0;
  }

  get offset() {
    return this.x;
  }
  get accuracy() {
    return this.acc;
  }
}

/**
 * Lane status from the smoothed GPS offset. Only says "wrong" when the estimate is clearly
 * outside the target lanes (most of a lane beyond their edge) and accuracy is good.
 */
export function laneState(t: LaneTarget, dist: number, tracker: LaneTracker | null, speed: number): LaneState {
  const lateDist = t.fast ? Math.max(160, speed * 6) : 45;
  let current: number | null = null;
  let status: LaneStatus = 'advise';
  let move: LaneState['move'] = t.side === 'middle' ? null : t.side;
  let changes = 0;
  const halfWidth = (t.count * LANE_W) / 2 + 2.5;
  if (tracker && t.checkable && tracker.samples >= 3 && tracker.accuracy <= 6 && Math.abs(tracker.offset) <= halfWidth) {
    const f = laneFromOffset(tracker.offset, t.count);
    const idx = clamp(Math.round(f), 0, t.count - 1);
    current = idx;
    if (f >= t.from - 0.65 && f <= t.to + 0.65) {
      status = 'ok';
      move = null;
    } else if (f < t.from - 0.85 || f > t.to + 0.85) {
      status = 'wrong';
      move = idx < t.from ? 'right' : 'left';
      changes = idx < t.from ? t.from - idx : idx - t.to;
    } else {
      current = null; // between lanes or uncertain
    }
  }
  if (status === 'wrong' && dist < lateDist) status = 'late';
  if (status === 'advise' && t.side !== 'middle') changes = t.worst;
  return { target: t, dist, current, status, move, changes };
}
