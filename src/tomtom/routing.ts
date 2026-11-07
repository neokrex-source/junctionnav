/**
 * Routes from TomTom's Calculate Route service, with today's traffic in the times, up to two
 * alternatives, avoid options, lane guidance and the toll, motorway, tunnel and ferry stretches,
 * turned into the app's own route shape so guidance, junction views, lane advice and tunnel signs
 * work on them as on OSRM's.
 *
 * TomTom gives one instruction per maneuver (a point, a maneuver code, the street, road numbers,
 * exit number and signpost text) and separate sections over the route's points; this file finds
 * each maneuver on the line, works out its OSRM-style type and direction, and puts the section
 * information where the rest of the app looks for it (intersection classes and lanes).
 */
import { angleDiff, Polyline, type LngLat } from '../geo/geo';
import { avoidList, labelRoutes, sameRoute } from '../routing/osrm';
import type { Avoid, Intersection, Lane, Leg, ManeuverType, Modifier, Route, RouteRequest, RouteResult, Router, Step } from '../routing/types';
import { TomTomError, ttEither, TT_BASE } from './http';

/* ------------------------------------------------------------------ TomTom's answer */

export interface TtPoint {
  latitude: number;
  longitude: number;
}

export interface TtInstruction {
  routeOffsetInMeters?: number;
  travelTimeInSeconds?: number;
  point?: TtPoint;
  /** Newer guidance names the point this way. */
  maneuverPoint?: TtPoint;
  pointIndex?: number;
  instructionType?: string;
  maneuver?: string;
  street?: string;
  roadNumbers?: string[];
  exitNumber?: string;
  signpostText?: string;
  junctionType?: string;
  turnAngleInDecimalDegrees?: number;
  changeOfAngleInDegrees?: number;
  roundaboutExitNumber?: number;
  drivingSide?: 'LEFT' | 'RIGHT';
  message?: string;
}

export interface TtSection {
  startPointIndex: number;
  endPointIndex: number;
  sectionType: string;
  lanes?: { directions?: string[]; follow?: string }[];
  delayInSeconds?: number;
}

export interface TtRoute {
  summary: { lengthInMeters: number; travelTimeInSeconds: number; trafficDelayInSeconds?: number; noTrafficTravelTimeInSeconds?: number };
  legs: { summary: { lengthInMeters: number; travelTimeInSeconds: number }; points: TtPoint[] }[];
  sections?: TtSection[];
  guidance?: { instructions?: TtInstruction[] };
}

export interface TtRouteResponse {
  routes?: TtRoute[];
}

/* ------------------------------------------------------------------ maneuvers */

const ll = (p: TtPoint): LngLat => [p.longitude, p.latitude];

/** Direction from a turn angle (negative = left), OSRM style. */
export function modifierFromAngle(a: number | undefined, fallback: Modifier = 'straight'): Modifier {
  if (a == null || !Number.isFinite(a)) return fallback;
  const m = Math.abs(a);
  if (m < 10) return 'straight';
  if (m >= 170) return 'uturn';
  const side = a < 0 ? 'left' : 'right';
  if (m < 45) return `slight ${side}` as Modifier;
  if (m < 135) return side;
  return `sharp ${side}` as Modifier;
}

const slight = (side: 'left' | 'right'): Modifier => `slight ${side}`;

/**
 * The app's maneuver type and direction for a TomTom instruction, or null for an instruction that
 * is not a maneuver (a toll gate, a border crossing).
 */
export function maneuverOf(ins: TtInstruction): { type: ManeuverType; modifier?: Modifier } | null {
  const angle = ins.turnAngleInDecimalDegrees ?? ins.changeOfAngleInDegrees;
  const exitSide: 'left' | 'right' = angle != null && angle !== 0 ? (angle < 0 ? 'left' : 'right') : ins.drivingSide === 'RIGHT' ? 'right' : 'left';
  const m = (ins.maneuver ?? '').toUpperCase();
  const lr = m.endsWith('_LEFT') || m.endsWith('LEFT_LANE') ? 'left' : m.endsWith('_RIGHT') || m.endsWith('RIGHT_LANE') ? 'right' : null;
  switch (m) {
    case 'DEPART':
      return { type: 'depart' };
    case 'ARRIVE':
    case 'ARRIVE_AHEAD':
      return { type: 'arrive' };
    case 'ARRIVE_LEFT':
    case 'ARRIVE_RIGHT':
      return { type: 'arrive', modifier: lr ?? undefined };
    case 'WAYPOINT_REACHED':
    case 'WAYPOINT_AHEAD':
    case 'WAYPOINT_LEFT':
    case 'WAYPOINT_RIGHT':
      return { type: 'arrive', modifier: lr ?? undefined };
    case 'STRAIGHT':
      // TomTom says "keep straight on" only where the road splits (a fork, an interchange).
      return ins.junctionType === 'BIFURCATION' || ins.signpostText || ins.exitNumber ? { type: 'fork', modifier: 'straight' } : { type: 'continue', modifier: 'straight' };
    case 'KEEP_LEFT':
    case 'KEEP_RIGHT':
      return { type: 'fork', modifier: slight(lr!) };
    case 'BEAR_LEFT':
    case 'BEAR_RIGHT':
    case 'SLIGHT_LEFT':
    case 'SLIGHT_RIGHT':
      return { type: 'turn', modifier: slight(lr!) };
    case 'TURN_LEFT':
    case 'TURN_RIGHT':
      return { type: 'turn', modifier: lr! };
    case 'SHARP_LEFT':
    case 'SHARP_RIGHT':
      return { type: 'turn', modifier: `sharp ${lr!}` as Modifier };
    case 'MAKE_UTURN':
    case 'TRY_MAKE_UTURN':
      return { type: 'turn', modifier: 'uturn' };
    case 'ENTER_MOTORWAY':
    case 'ENTER_FREEWAY':
    case 'ENTER_HIGHWAY':
    case 'ENTRANCE_RAMP':
      return { type: 'on ramp', modifier: modifierFromAngle(angle, 'straight') };
    case 'TAKE_EXIT':
    case 'MOTORWAY_EXIT_LEFT':
    case 'MOTORWAY_EXIT_RIGHT':
    case 'EXIT_MOTORWAY_LEFT':
    case 'EXIT_MOTORWAY_RIGHT':
    case 'SWITCH_MOTORWAY_LEFT':
    case 'SWITCH_MOTORWAY_RIGHT':
      return { type: 'off ramp', modifier: slight(lr ?? exitSide) };
    case 'SWITCH_PARALLEL_ROAD':
    case 'SWITCH_MAIN_ROAD':
      return { type: 'fork', modifier: modifierFromAngle(angle, 'straight') };
    case 'MERGE_LEFT_LANE':
    case 'MERGE_RIGHT_LANE':
      return { type: 'merge', modifier: slight(lr!) };
    case 'ROUNDABOUT_CROSS':
    case 'ROUNDABOUT_STRAIGHT':
      return { type: 'roundabout', modifier: 'straight' };
    case 'ROUNDABOUT_LEFT':
    case 'ROUNDABOUT_RIGHT':
      return { type: 'roundabout', modifier: lr! };
    case 'ROUNDABOUT_SLIGHT_LEFT':
    case 'ROUNDABOUT_SLIGHT_RIGHT':
      return { type: 'roundabout', modifier: slight(lr!) };
    case 'ROUNDABOUT_SHARP_LEFT':
    case 'ROUNDABOUT_SHARP_RIGHT':
      return { type: 'roundabout', modifier: `sharp ${lr!}` as Modifier };
    case 'ROUNDABOUT_BACK':
      return { type: 'roundabout', modifier: 'uturn' };
    case 'EXIT_ROUNDABOUT':
      return { type: 'exit roundabout', modifier: modifierFromAngle(angle, 'straight') };
    case 'FOLLOW':
      return { type: 'new name', modifier: 'straight' };
    case 'TAKE_FERRY':
    case 'TAKE_SHIP_FERRY':
    case 'LEAVE_SHIP_FERRY':
    case 'CAR_TRAIN':
    case 'TAKE_CAR_TRAIN':
    case 'LEAVE_CAR_TRAIN':
      return { type: 'continue', modifier: 'straight' };
    case 'TOLLGATE':
    case 'CROSS_BORDER':
    case 'ENTER_CARPOOL_LANE_LEFT':
    case 'ENTER_CARPOOL_LANE_RIGHT':
    case 'EXIT_CARPOOL_LANE_LEFT':
    case 'EXIT_CARPOOL_LANE_RIGHT':
      return null;
    default:
      // A code added after this was written: turn by the angle, when there is one.
      return angle != null ? { type: 'turn', modifier: modifierFromAngle(angle) } : { type: 'continue', modifier: 'straight' };
  }
}

/** TomTom lane directions in OSRM's words. */
const LANE_DIR: Record<string, string> = {
  STRAIGHT: 'straight',
  SLIGHT_RIGHT: 'slight right',
  RIGHT: 'right',
  SHARP_RIGHT: 'sharp right',
  RIGHT_U_TURN: 'uturn',
  SLIGHT_LEFT: 'slight left',
  LEFT: 'left',
  SHARP_LEFT: 'sharp left',
  LEFT_U_TURN: 'uturn',
};

/** Lanes left to right; the ones TomTom says to follow are the valid ones. */
export function lanesOf(sec: TtSection, modifier: Modifier | undefined): Lane[] | undefined {
  const raw = sec.lanes ?? [];
  if (raw.length < 2) return undefined;
  const anyFollow = raw.some((l) => l.follow);
  const want = modifier === 'straight' || !modifier ? 'straight' : modifier;
  return raw.map((l) => {
    const indications = (l.directions ?? []).map((d) => LANE_DIR[d] ?? 'none');
    const valid = anyFollow ? !!l.follow : indications.some((d) => d === want || (want.includes('left') && d.includes('left')) || (want.includes('right') && d.includes('right')));
    return { indications: indications.length ? indications : ['none'], valid };
  });
}

/** Section types that become road classes on the app's intersections. */
const SECTION_CLASS: Record<string, string> = { MOTORWAY: 'motorway', TOLL: 'toll', TOLL_ROAD: 'toll', TUNNEL: 'tunnel', FERRY: 'ferry' };

let routeSeq = 0;

/** Display text for a road: its number, else its name. */
const roadLabel = (ins: TtInstruction) => ins.roadNumbers?.[0] || ins.street || '';

/* ------------------------------------------------------------------ TomTom route to app route */

export function normalizeTomTom(json: TtRouteResponse, provider = 'TomTom'): Route[] {
  if (!json?.routes?.length) throw new TomTomError('No route found between these places.', 400, 'NO_ROUTE_FOUND');
  // An answer without the route itself (a different shape than expected) is no route at all.
  const ok = json.routes.filter((r) => r?.summary && r.legs?.some((l) => l.points?.length >= 2));
  if (!ok.length) throw new TomTomError('TomTom sent a route this app cannot read.', 502);
  return ok.map((r) => toRoute(r, provider));
}

function toRoute(r: TtRoute, provider: string): Route {
  // All legs' points one after the other: instruction and section indices count through them.
  const geometry: LngLat[] = [];
  const legEnds: number[] = [];
  for (const leg of r.legs) {
    for (const p of leg.points) geometry.push(ll(p));
    legEnds.push(geometry.length - 1);
  }
  const line = new Polyline(geometry);
  const sAt = (i: number) => line.cum[Math.max(0, Math.min(geometry.length - 1, i))];

  // Road classes along the route, from the sections.
  const runs: { a: number; b: number; cls: string }[] = [];
  for (const sec of r.sections ?? []) {
    const cls = SECTION_CLASS[sec.sectionType];
    if (cls) runs.push({ a: sAt(sec.startPointIndex), b: sAt(sec.endPointIndex), cls });
  }
  const classesAt = (s: number) => [...new Set(runs.filter((x) => s >= x.a - 0.5 && s < x.b - 0.5).map((x) => x.cls))];
  const lengthOf = (cls: string) => {
    const parts = runs.filter((x) => x.cls === cls).sort((x, y) => x.a - y.a);
    let total = 0;
    let end = -Infinity;
    for (const p of parts) {
      total += Math.max(0, p.b - Math.max(p.a, end));
      end = Math.max(end, p.b);
    }
    return total;
  };
  const lanesSections = (r.sections ?? []).filter((x) => x.sectionType === 'LANES' && x.lanes?.length);

  // Each instruction located on the line.
  const raw = (r.guidance?.instructions ?? [])
    .map((ins) => ({ ins, m: maneuverOf(ins), p: ins.point ?? ins.maneuverPoint }))
    .filter((x): x is { ins: TtInstruction; m: NonNullable<ReturnType<typeof maneuverOf>>; p: TtPoint } => !!x.m && !!x.p);
  const scale = r.summary.lengthInMeters > 0 ? line.length / r.summary.lengthInMeters : 1;
  let sPrev = 0;
  const located = raw.map((x, k) => {
    const loc = ll(x.p);
    let s: number;
    if (k === 0) s = 0;
    else {
      const guess = x.ins.pointIndex != null ? sAt(x.ins.pointIndex) : (x.ins.routeOffsetInMeters ?? 0) * scale;
      const pr = line.project(loc, Math.max(sPrev, guess - 150), guess + 250);
      s = pr.dist < 40 ? pr.s : Math.max(sPrev, guess);
    }
    if (x.m.type === 'arrive' && k === raw.length - 1) s = line.length;
    s = Math.max(sPrev, Math.min(s, line.length));
    sPrev = s;
    return { ...x, loc, s };
  });

  const steps: Step[] = [];
  let waypoints = 0;
  const label = new Map<string, number>();
  located.forEach((x, k) => {
    const next = located[k + 1];
    const s1 = next ? next.s : line.length;
    const ins = x.ins;
    const bearingBefore = line.bearingAt(Math.max(0, x.s - 15), 15);
    const bearingAfter = line.bearingAt(Math.min(line.length, x.s), 15);
    const { type, modifier } = x.m;
    const isWaypoint = type === 'arrive' && (ins.instructionType === 'LOCATION_WAYPOINT' || /^WAYPOINT/.test(ins.maneuver ?? '')) && k < located.length - 1;
    // The junction as an intersection: where we come from, where we go, and the other branch at
    // splits (from the side we do not take), which the junction view falls back on without OSM.
    const bearings = [(bearingBefore + 180) % 360, bearingAfter];
    const entry = [false, true];
    if (type === 'fork' || type === 'off ramp') {
      const turn = angleDiff(bearingAfter, bearingBefore);
      const other = type === 'off ramp' ? bearingBefore : bearingBefore - Math.sign(turn || (modifier?.includes('left') ? -1 : 1)) * Math.max(18, Math.abs(turn));
      bearings.push((other + 360) % 360);
      entry.push(true);
    }
    // Lane guidance: the lanes section that ends at (or runs up to) this maneuver.
    const pi = ins.pointIndex;
    const lanesSec =
      pi != null
        ? lanesSections.find((sec) => sec.endPointIndex >= pi - 1 && sec.startPointIndex <= pi + 1)
        : lanesSections.find((sec) => Math.abs(sAt(sec.endPointIndex) - x.s) < 40);
    const first: Intersection = {
      location: x.loc,
      bearings,
      entry,
      in: 0,
      out: 1,
      lanes: lanesSec && type !== 'depart' && type !== 'arrive' ? lanesOf(lanesSec, modifier) : undefined,
      classes: classesAt(x.s + 1),
    };
    // Where road classes change before the next maneuver (into a tunnel, onto a toll road), as
    // further intersections, the way OSRM lists them.
    const intersections: Intersection[] = [first];
    const cuts = [...new Set(runs.flatMap((run) => [run.a, run.b]))].filter((c) => c > x.s + 1 && c < s1 - 1).sort((a, b) => a - b);
    for (const c of cuts) intersections.push({ location: line.pointAt(c), bearings: [], entry: [], classes: classesAt(c + 0.5) });
    const name = ins.street ?? '';
    const ref = ins.roadNumbers?.length ? ins.roadNumbers.join(';') : undefined;
    const sign = ins.signpostText?.replace(/\s*\/\s*/g, ', ');
    const destinations = sign && type !== 'depart' && type !== 'arrive' ? `${ins.roadNumbers?.length ? `${ins.roadNumbers.join(', ')}: ` : ''}${sign}` : undefined;
    const nextT = next?.ins.travelTimeInSeconds;
    const step: Step = {
      index: steps.length,
      type,
      modifier,
      location: x.loc,
      bearingBefore,
      bearingAfter,
      exit: type === 'roundabout' ? ins.roundaboutExitNumber : undefined,
      name,
      ref,
      destinations,
      exits: ins.exitNumber ? ins.exitNumber.split(/\s*,\s*/).join(';') : undefined,
      drivingSide: ins.drivingSide === 'RIGHT' ? 'right' : ins.drivingSide === 'LEFT' ? 'left' : 'right',
      distance: Math.max(0, s1 - x.s),
      duration: next && nextT != null && ins.travelTimeInSeconds != null ? Math.max(0, nextT - ins.travelTimeInSeconds) : next ? Math.max(0, s1 - x.s) / 14 : 0,
      intersections,
      s: x.s,
    };
    if (isWaypoint) step.waypoint = ++waypoints;
    steps.push(step);
    const road = roadLabel(ins);
    if (road && type !== 'arrive') label.set(road, (label.get(road) ?? 0) + step.distance);
  });
  // The last instruction's duration is the rest of the route's time.
  if (steps.length && !steps[steps.length - 1].duration && steps.length > 1) {
    const used = steps.reduce((a, st) => a + st.duration, 0);
    steps[steps.length - 2].duration += Math.max(0, r.summary.travelTimeInSeconds - used);
  }

  const legs: Leg[] = r.legs.map((leg, i) => ({ distance: leg.summary.lengthInMeters, duration: leg.summary.travelTimeInSeconds, endS: i === r.legs.length - 1 ? line.length : sAt(legEnds[i]) }));
  const tollDistance = lengthOf('toll');
  const motorwayDistance = lengthOf('motorway');
  const ferryDistance = lengthOf('ferry');
  const summary = [...label.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([k]) => k)
    .join(', ');
  return {
    id: `t${++routeSeq}`,
    geometry,
    line,
    distance: r.summary.lengthInMeters,
    duration: r.summary.travelTimeInSeconds,
    steps,
    summary,
    hasToll: tollDistance > 0,
    hasMotorway: motorwayDistance > 0,
    hasFerry: ferryDistance > 0,
    tollDistance,
    motorwayDistance,
    ferryDistance,
    legs,
    label: 'alternative',
    avoidApplied: [],
    provider,
    trafficAware: true,
    trafficDelay: Math.max(0, r.summary.trafficDelayInSeconds ?? 0),
  };
}

/* ------------------------------------------------------------------ the router */

const AVOID_TT: Record<keyof Avoid, string> = { tolls: 'tollRoads', motorways: 'motorways', ferries: 'ferries' };
const AVOID_NAME: Record<keyof Avoid, string> = { tolls: 'toll roads', motorways: 'highways', ferries: 'ferries' };

/** The request's address for either TomTom family. */
export function routeUrl(family: 'classic' | 'orbis', key: string, req: RouteRequest, opts: { avoid: (keyof Avoid)[]; alternatives: number; lang: string }): string {
  const pts = [req.origin, ...(req.via ?? []), req.destination];
  const locs = pts.map((p) => `${p[1].toFixed(6)},${p[0].toFixed(6)}`).join(':');
  const q = new URLSearchParams({ key, travelMode: 'car', routeType: 'fastest', instructionsType: 'coded', computeTravelTimeFor: 'all', language: opts.lang });
  if (family === 'orbis') {
    q.set('apiVersion', '2');
    q.set('traffic', 'live');
  } else q.set('traffic', 'true');
  for (const t of ['lanes', 'motorway', 'toll', 'tunnel', 'ferry', 'traffic']) q.append('sectionType', t);
  if (opts.alternatives > 0 && pts.length === 2) q.set('maxAlternatives', String(opts.alternatives));
  if (req.bearing != null && Number.isFinite(req.bearing)) q.set('vehicleHeading', String(((Math.round(req.bearing) % 360) + 360) % 360));
  for (const a of opts.avoid) q.append('avoid', AVOID_TT[a]);
  const path = family === 'orbis' ? '/maps/orbis/routing/calculateRoute' : '/routing/1/calculateRoute';
  return `${TT_BASE}${path}/${locs}/json?${q.toString()}`;
}

export class TomTomRouter implements Router {
  readonly name = 'TomTom';

  constructor(
    private key: () => string,
    private lang: () => string = () => 'en',
  ) {}

  /** TomTom's routing speaks Malay and English, not Japanese (an unknown language is refused). */
  private langTag(): string {
    return this.lang() === 'ms' ? 'ms-MY' : 'en-GB';
  }

  private async fetch(req: RouteRequest, avoid: (keyof Avoid)[], alternatives: number, signal?: AbortSignal): Promise<Route[]> {
    const key = this.key().trim();
    if (!key) throw new TomTomError('No TomTom key.', 401);
    const json = await ttEither<TtRouteResponse>('routing', (f) => routeUrl(f, key, req, { avoid, alternatives, lang: this.langTag() }), {}, signal);
    return normalizeTomTom(json, this.name);
  }

  async route(req: RouteRequest, signal?: AbortSignal): Promise<RouteResult> {
    const wanted = avoidList(req.avoid);
    const warnings: string[] = [];
    // A toll-free option alongside, when tolls are allowed, so it can be offered.
    const tollFree =
      req.offerTollFree && !wanted.includes('tolls') ? this.fetch(req, ['tolls', ...wanted], 0, signal).catch(() => null) : null;
    const routes = await this.fetch(req, wanted, req.alternatives ? 2 : 0, signal);
    // TomTom avoids where it can; say so when a route still has to use what was to be avoided.
    for (const r of routes) r.avoidApplied = wanted.filter((k) => (k === 'tolls' ? !r.hasToll : k === 'motorways' ? !r.hasMotorway : !r.hasFerry));
    const missed = wanted.filter((k) => routes.every((r) => !r.avoidApplied.includes(k)));
    if (missed.length) warnings.push(`No route avoids ${missed.map((k) => AVOID_NAME[k]).join(' and ')}. Showing routes that use them.`);
    const tf = tollFree ? await tollFree : null;
    if (tf?.[0] && !tf[0].hasToll && routes.every((r) => r.hasToll) && !routes.some((r) => sameRoute(r, tf[0]))) {
      tf[0].avoidApplied = ['tolls', ...wanted.filter((k) => k !== 'tolls')];
      routes.push(tf[0]);
    }
    labelRoutes(routes);
    return { routes, warnings };
  }
}
