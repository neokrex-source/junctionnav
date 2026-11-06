import { angleDiff, type LngLat } from '../geo/geo';
import type { Route, Step } from '../routing/types';

export type JunctionKind = 'exit' | 'entry' | 'fork' | 'merge' | 'split';

export interface JunctionCandidate {
  id: string;
  stepIndex: number;
  kind: JunctionKind;
  location: LngLat;
  /** Along-route position of the junction. */
  s: number;
  /** Show the junction view once progress passes this distance. */
  showFromS: number;
  /** Hide it again after this distance. */
  hideAtS: number;
  highway: boolean;
  side: 'left' | 'right' | 'straight';
}

const SPLIT_ANGLE = 50; // other roads within this angle of our exit count as a split

function sideOf(step: Step): JunctionCandidate['side'] {
  const m = step.modifier || '';
  if (m.includes('left')) return 'left';
  if (m.includes('right')) return 'right';
  return 'straight';
}

/** True if the maneuver intersection has another enterable road close in angle to the one we take. */
export function hasNearbyBranch(step: Step): boolean {
  const ix = step.intersections[0];
  if (!ix || ix.out == null) return false;
  const outB = ix.bearings[ix.out];
  return ix.bearings.some(
    (b, i) => i !== ix.out && i !== ix.in && ix.entry[i] && Math.abs(angleDiff(outB, b)) < SPLIT_ANGLE,
  );
}

function stepSpeed(step: Step | undefined): number {
  if (!step || step.duration <= 0) return 0;
  return step.distance / step.duration;
}

function isHighwayContext(route: Route, i: number): boolean {
  const step = route.steps[i];
  const prev = route.steps[i - 1];
  const classes = [
    ...(step.intersections[0]?.classes ?? []),
    ...(prev?.intersections[prev.intersections.length - 1]?.classes ?? []),
  ];
  if (classes.includes('motorway')) return true;
  return stepSpeed(prev) > 17 || stepSpeed(step) > 19; // ~60-70 km/h
}

export function classifyStep(route: Route, i: number): JunctionKind | null {
  const step = route.steps[i];
  switch (step.type) {
    case 'off ramp':
      return 'exit';
    case 'on ramp':
      return 'entry';
    case 'fork':
      return 'fork';
    case 'merge':
      return 'merge';
    case 'turn':
    case 'continue':
    case 'new name':
    case 'end of road':
    case 'use lane': {
      const m = step.modifier ?? 'straight';
      const gentle = m === 'straight' || m.startsWith('slight');
      if (gentle && hasNearbyBranch(step)) return 'split';
      const lanes = step.intersections[0]?.lanes;
      if (gentle && lanes && lanes.length >= 2 && lanes.some((l) => !l.valid) && isHighwayContext(route, i)) {
        return 'split';
      }
      return null;
    }
    default:
      return null;
  }
}

/** How far before a split the junction view shows and the route turns orange (metres). */
export const JUNCTION_LEAD = 300;
/** The route is dark orange this far either side of the split (metres), orange before that. */
export const JUNCTION_CORE = 100;

/** Find maneuvers that deserve a junction view: ramps, exits, forks, merges and divider splits. */
export function detectJunctions(route: Route): JunctionCandidate[] {
  const out: JunctionCandidate[] = [];
  for (let i = 1; i < route.steps.length - 1; i++) {
    const kind = classifyStep(route, i);
    if (!kind) continue;
    const step = route.steps[i];
    const highway = isHighwayContext(route, i);
    // The junction view comes up 300 m before the split, as the route turns orange on the map.
    const lead = JUNCTION_LEAD;
    const prevS = route.steps[i - 1].s;
    const showFromS = Math.max(prevS + 25, step.s - lead);
    if (step.s - showFromS < 60) continue; // too close to the previous maneuver to be useful
    out.push({
      id: `${route.id}:${i}`,
      stepIndex: i,
      kind,
      location: step.location,
      s: step.s,
      showFromS,
      hideAtS: step.s + (highway ? 60 : 30),
      highway,
      side: sideOf(step),
    });
  }
  return out;
}
