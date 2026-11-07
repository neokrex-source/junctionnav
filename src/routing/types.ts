import type { LngLat, Polyline } from '../geo/geo';

export type ManeuverType =
  | 'depart'
  | 'arrive'
  | 'turn'
  | 'new name'
  | 'continue'
  | 'merge'
  | 'on ramp'
  | 'off ramp'
  | 'fork'
  | 'end of road'
  | 'use lane'
  | 'roundabout'
  | 'rotary'
  | 'roundabout turn'
  | 'exit roundabout'
  | 'exit rotary'
  | 'notification';

export type Modifier =
  | 'uturn'
  | 'sharp right'
  | 'right'
  | 'slight right'
  | 'straight'
  | 'slight left'
  | 'left'
  | 'sharp left';

/** Lane at an intersection, ordered left to right as the driver sees them. */
export interface Lane {
  indications: string[];
  valid: boolean;
}

export interface Intersection {
  location: LngLat;
  bearings: number[];
  entry: boolean[];
  in?: number;
  out?: number;
  lanes?: Lane[];
  classes?: string[];
}

export interface Step {
  index: number;
  type: ManeuverType;
  modifier?: Modifier;
  location: LngLat;
  bearingBefore: number;
  bearingAfter: number;
  /** Roundabout exit number. */
  exit?: number;
  name: string;
  ref?: string;
  destinations?: string;
  exits?: string;
  rotaryName?: string;
  drivingSide: 'left' | 'right';
  /** Distance and duration of the stretch that follows this maneuver. */
  distance: number;
  duration: number;
  intersections: Intersection[];
  /** Along-route position of the maneuver, metres from route start. */
  s: number;
  /** For an arrival at an intermediate stop: its 1-based number. */
  waypoint?: number;
}

export interface Avoid {
  tolls: boolean;
  motorways: boolean;
  ferries: boolean;
}

export const NO_AVOID: Avoid = { tolls: false, motorways: false, ferries: false };

export type RouteLabel = 'fastest' | 'shortest' | 'tollFree' | 'alternative';

export interface Leg {
  distance: number;
  duration: number;
  /** Along-route position where this leg ends (a stop or the destination). */
  endS: number;
}

export interface Route {
  id: string;
  geometry: LngLat[];
  line: Polyline;
  distance: number;
  duration: number;
  steps: Step[];
  summary: string;
  hasToll: boolean;
  hasMotorway: boolean;
  hasFerry: boolean;
  /** Metres driven on toll roads, motorways and ferries. */
  tollDistance: number;
  motorwayDistance: number;
  ferryDistance: number;
  legs: Leg[];
  label: RouteLabel;
  /** Which avoid options the server actually applied to this route. */
  avoidApplied: (keyof Avoid)[];
  /** Provider label for attribution/debug. */
  provider: string;
  /** The times already count today's traffic (TomTom routes), and what traffic adds (seconds). */
  trafficAware?: boolean;
  trafficDelay?: number;
  /** Toll gates the router itself reported on the route (TomTom does), by position along it. */
  tollGates?: { s: number; at: LngLat; name?: string }[];
}

export interface RouteRequest {
  origin: LngLat;
  destination: LngLat;
  /** Intermediate stops, in order. */
  via?: LngLat[];
  /** Current heading at the origin (helps reroutes pick the right carriageway). */
  bearing?: number | null;
  /** Direction of travel through each stop, when known (trip links), for the right carriageway. */
  viaBearings?: (number | null)[];
  alternatives?: boolean;
  avoid?: Partial<Avoid>;
  /** Also look for a toll-free option when the best routes use tolls. */
  offerTollFree?: boolean;
}

export interface RouteResult {
  routes: Route[];
  /** Things the user should know, e.g. an avoid option the server could not apply. */
  warnings: string[];
  /** A quiet line about where the routes came from (e.g. TomTom did not answer, so OSRM did). */
  note?: string;
}

export interface Router {
  readonly name: string;
  route(req: RouteRequest, signal?: AbortSignal): Promise<RouteResult>;
}

export interface Destinations {
  refs: string[];
  places: string[];
}

/** Parse OSRM's destinations string ("E1, AH2: Ipoh, Kuala Lumpur"). */
export function parseDestinations(raw?: string): Destinations {
  if (!raw) return { refs: [], places: [] };
  const colon = raw.indexOf(':');
  const split = (s: string) =>
    s
      .split(/[,;]/)
      .map((x) => x.trim())
      .filter(Boolean);
  if (colon >= 0) {
    return { refs: split(raw.slice(0, colon)), places: split(raw.slice(colon + 1)) };
  }
  return { refs: [], places: split(raw) };
}

export function splitRefs(ref?: string): string[] {
  if (!ref) return [];
  return ref
    .split(/[;,]/)
    .map((r) => r.trim())
    .filter(Boolean);
}
