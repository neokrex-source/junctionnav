/** Route progress tracking: snapping, current maneuver, off-route detection, voice prompts. */
import { angleDiff, type LngLat } from '../geo/geo';
import type { JunctionCandidate } from '../junction/detect';
import type { Route, Step } from '../routing/types';
import { LaneTracker, laneState, signedOffset, upcomingTarget, type LaneState } from './lanes';
import { tollAhead, type TollPlaza, type TollState } from './tolls';
import { TUNNEL_MIN_VOICE, tunnelStateAt, type TunnelSpan, type TunnelState } from './tunnels';

/** "You have reached your destination" is said this far before the end of the route. */
export const ARRIVAL_RADIUS = 300;

/** Short routes (under twice the radius) only announce arrival at the end itself. */
export function arrivalRadius(route: Route): number {
  return route.line.length >= ARRIVAL_RADIUS * 2 ? ARRIVAL_RADIUS : 25;
}

export interface Fix {
  lngLat: LngLat;
  accuracy: number;
  heading: number | null;
  speed: number | null;
  time: number;
  /** Estimated by dead reckoning (no usable GPS, usually in a tunnel). */
  dr?: boolean;
}

export interface Progress {
  s: number;
  snapped: LngLat;
  offset: number;
  heading: number;
  speed: number;
  /** The maneuver we are approaching. */
  next: Step;
  /** The one after it (for "then" hints). */
  after?: Step;
  distToNext: number;
  /** Planned time to the maneuver we are approaching (s), from the route's own times. */
  timeToNext: number;
  remaining: number;
  remainingTime: number;
  eta: Date;
  onRoute: boolean;
  offRoute: boolean;
  arrived: boolean;
  junction: { cand: JunctionCandidate; dist: number } | null;
  /** The next intermediate stop, if any remain. */
  nextStop: { number: number; dist: number; eta: Date } | null;
  /** Intermediate stops already reached. */
  stopsPassed: number;
  /** Lane advice for the next exit, entrance, junction, split or turn, when it matters. */
  lane: LaneState | null;
  /** The tunnel we are in, or the next one close ahead. */
  tunnel: TunnelState | null;
  /** The next toll plaza within about 1.5 km on fast roads (600 m in town). */
  toll: TollState | null;
  /** Position estimated without GPS. */
  dr: boolean;
  /** Within the arrival radius of the final destination: arrival is announced, voice guidance ends. */
  nearDestination: boolean;
}

export type PromptKind = 'maneuver' | 'laneEarly' | 'laneWrong' | 'laneLate' | 'tunnel' | 'toll' | 'tollNear';

export interface Prompt {
  key: string;
  step: Step;
  distance: number | null;
  kind: PromptKind;
  /** Lane state at the time, for lane prompts and lane hints on maneuver prompts. */
  lane?: LaneState;
  /** For tunnel prompts. */
  tunnel?: TunnelState;
  /** For toll prompts: the plaza and how far it is. */
  toll?: TollState;
  /**
   * On the first heads-up for a turn the router gave no lanes for: the side of the road to move
   * to ("Move into the left lane").
   */
  side?: 'left' | 'right';
}

/** Where the early toll reminder comes (at the first quiet moment inside it), and the short one before the plaza. */
export const TOLL_EARLY = { fast: 1000, town: 400 };
export const TOLL_NEAR = { fast: 300, town: 120 };

/**
 * The side of the road to be on for a turn without lane data: the turn's own side (the U-turn
 * lane is by the middle of the road), or none where lane data or lane advice already says it.
 */
export function turnSide(step: Step): 'left' | 'right' | undefined {
  if ((step.intersections[0]?.lanes?.length ?? 0) > 0) return undefined;
  const m = step.modifier ?? '';
  const turnLike = step.type === 'turn' || step.type === 'end of road' || ((step.type === 'continue' || step.type === 'new name') && m.startsWith('slight'));
  if (!turnLike || !m || m === 'straight') return undefined;
  if (m === 'uturn') return step.drivingSide === 'left' ? 'right' : 'left';
  return m.includes('left') ? 'left' : 'right';
}

/** off = no lane alerts; advice = early lane advice only; gps = advice plus a GPS lane check. */
export type LaneMode = 'off' | 'advice' | 'gps';

export class NavEngine {
  route: Route | null = null;
  junctions: JunctionCandidate[] = [];
  private lastS = 0;
  private offCount = 0;
  private wrongWay = 0;
  private announced = new Set<string>();
  private lastHeading = 0;
  private lastProgress: Progress | null = null;
  laneMode: LaneMode = 'gps';
  readonly tracker = new LaneTracker();
  private wrongSince = 0;
  private lastSpeech = 0;
  private wrongCount = new Map<number, number>();
  private now = 0;
  /** Tunnels on the route, sorted by position. */
  tunnels: TunnelSpan[] = [];
  /** Voice prompt before tunnels (signs are the UI's business). */
  tunnelAlerts = true;
  /** Toll plazas on the route, sorted by position. */
  tolls: TollPlaza[] = [];
  /** Voice reminders before toll plazas (get the Touch 'n Go card ready). */
  tollAlerts = true;
  /** When each plaza's early reminder was said (the near one is skipped right after it). */
  private tollSaid = new Map<string, number>();
  /** Last good GPS position on the route, the starting point for dead reckoning. */
  private real: { s: number; speed: number; time: number } | null = null;
  /** The last update used an estimate; the next real fix may correct it backwards. */
  private estimating = false;

  setRoute(route: Route, junctions: JunctionCandidate[], startS = 0) {
    this.route = route;
    this.junctions = junctions;
    this.lastS = startS;
    this.offCount = 0;
    this.wrongWay = 0;
    this.announced.clear();
    this.wrongCount.clear();
    this.wrongSince = 0;
    this.tracker.reset();
    this.tunnels = [];
    this.tolls = [];
    this.tollSaid.clear();
    this.real = null;
    this.estimating = false;
    // The app says the first instruction itself as guidance starts: no short-leg repeat of it.
    const first = route.steps.find((st) => st.s > startS + 5 && st.type !== 'depart');
    if (first) this.announced.add(`${first.index}:short`);
  }

  /**
   * The same route moved onto the map's roads further on (src/routing/align.ts): its maneuvers are
   * the same ones, so what was said and the lane tracking stay; only the line and positions change.
   */
  replaceRoute(route: Route, junctions: JunctionCandidate[], s: number) {
    this.route = route;
    this.junctions = junctions;
    this.lastS = s;
    this.real = null;
    this.estimating = false;
  }

  setTunnels(spans: TunnelSpan[]) {
    this.tunnels = [...spans].sort((a, b) => a.fromS - b.fromS);
  }

  setTolls(plazas: TollPlaza[]) {
    this.tolls = [...plazas].sort((a, b) => a.s - b.s);
  }

  private tunnelNear(s: number, before = 60, after = 30): TunnelSpan | undefined {
    return this.tunnels.find((t) => s >= t.fromS - before && s <= t.toS + after);
  }

  /**
   * Position estimate while GPS is gone in a tunnel: carries on along the route at the last
   * good speed, up to a little past the exit. `rate` scales elapsed time (simulator speed-up).
   */
  deadReckon(now: number, opts: { force?: boolean; rate?: number } = {}): Fix | null {
    const route = this.route;
    const r = this.real;
    if (!route || !r) return null;
    const span = this.tunnelNear(r.s, 60, 0);
    if (!span) return null;
    const dt = ((now - r.time) / 1000) * (opts.rate ?? 1);
    if (!opts.force && now - r.time < 1500) return null;
    if (now - r.time > 10 * 60_000) return null;
    const v = Math.max(2, r.speed);
    const cap = span.toS + 150;
    const s = Math.min(cap, r.s + v * Math.max(0, dt));
    return {
      lngLat: route.line.pointAt(s),
      accuracy: 10,
      heading: route.line.bearingAt(s),
      speed: s >= cap ? 0 : v,
      time: now,
      dr: true,
    };
  }

  get progress(): Progress | null {
    return this.lastProgress;
  }

  update(fix: Fix): Progress | null {
    const route = this.route;
    if (!route || route.steps.length < 2) return null;
    const line = route.line;
    const speed = Math.max(0, fix.speed ?? 0);
    const ahead = Math.max(250, speed * 15);
    // After dead reckoning the estimate may have run ahead (stopped in a tunnel jam): search back
    // to the last real position so the first GPS fix after the tunnel can pull it back.
    const recovering = !fix.dr && this.estimating;
    const lo = recovering ? Math.max(0, (this.real?.s ?? this.lastS) - 60) : Math.max(0, this.lastS - 40);
    let proj = line.project(fix.lngLat, lo, this.lastS + ahead);
    const threshold = Math.max(35, Math.min(80, fix.accuracy * 1.5));
    // In a tunnel a poor or far-off GPS fix is worse than an estimate.
    if (!fix.dr && this.tunnelNear(this.lastS) && (fix.accuracy > 40 || proj.dist > threshold)) {
      const est = this.deadReckon(fix.time, { force: true });
      if (est) return this.update(est);
    }
    if (proj.dist > threshold) {
      // Maybe a GPS jump or tunnel exit: try the whole route.
      const global = line.project(fix.lngLat);
      if (global.dist < threshold && global.s > this.lastS - 200) proj = global;
    }
    const routeBrg = line.bearingAt(proj.s);
    const heading = fix.heading ?? (speed > 1 ? this.lastHeading : routeBrg);
    this.lastHeading = heading;

    const onRoute = proj.dist <= threshold;
    if (!onRoute) this.offCount++;
    else this.offCount = 0;
    if (!fix.dr && onRoute && speed > 4 && fix.heading != null && Math.abs(angleDiff(routeBrg, fix.heading)) > 130) this.wrongWay++;
    else this.wrongWay = 0;
    const offRoute = this.offCount >= 3 || this.wrongWay >= 5;

    if (onRoute) this.lastS = recovering ? proj.s : Math.max(this.lastS - 5, proj.s);
    this.estimating = !!fix.dr;
    const s = onRoute ? proj.s : this.lastS;

    // Current maneuver.
    const steps = route.steps;
    let k = 0;
    while (k < steps.length - 1 && steps[k + 1].s <= s + 3) k++;
    const next = steps[Math.min(k + 1, steps.length - 1)];
    const after = steps[k + 2];
    const distToNext = Math.max(0, next.s - s);

    // Remaining time: rest of current step plus later steps.
    const cur = steps[k];
    const curLen = Math.max(1, next.s - cur.s);
    const timeToNext = (cur.duration * distToNext) / curLen;
    let remainingTime = timeToNext;
    for (let i = k + 1; i < steps.length; i++) remainingTime += steps[i].duration;
    const remaining = Math.max(0, line.length - s);
    const arrived = remaining < 25 || (next.type === 'arrive' && !next.waypoint && distToNext < 20);

    // Intermediate stops (multi-leg routes).
    const stopLegs = route.legs.slice(0, -1);
    const stopsPassed = stopLegs.filter((l) => l.endS <= s + 20).length;
    let nextStop: Progress['nextStop'] = null;
    if (stopsPassed < stopLegs.length) {
      const endS = stopLegs[stopsPassed].endS;
      let tt = (cur.duration * distToNext) / curLen;
      for (let i = k + 1; i < steps.length && steps[i].s < endS - 1; i++) tt += steps[i].duration;
      nextStop = { number: stopsPassed + 1, dist: endS - s, eta: new Date(Date.now() + tt * 1000) };
    }

    const j = this.junctions.find((c) => s >= c.showFromS && s <= c.hideAtS) ?? null;

    // Tunnels: the one we are in, or the next one close ahead.
    const roadSpeed = cur.duration > 0 ? cur.distance / cur.duration : 0;
    const fastRoad = Math.max(speed, roadSpeed) > 16;
    const tunnel = tunnelStateAt(this.tunnels, s, fastRoad ? 1000 : 400);
    const inTunnel = !!this.tunnelNear(s, 0, 0);
    const toll = tollAhead(this.tolls, s, fastRoad ? 1500 : 600);

    // Lane advice: smoothed lateral position against the lanes needed for the next decision.
    // No lane check on estimated positions or inside tunnels, where GPS is unreliable.
    this.now = fix.time;
    const laneGps = !fix.dr && !inTunnel;
    if (laneGps) this.tracker.update(signedOffset(line, proj, fix.lngLat), fix.accuracy, fix.time, onRoute);
    else this.tracker.reset();
    let lane: LaneState | null = null;
    if (this.laneMode !== 'off' && onRoute) {
      const t = upcomingTarget(route, next.index, s, speed, this.tunnels);
      if (t) lane = laneState(t, Math.max(0, t.step.s - s), this.laneMode === 'gps' && laneGps ? this.tracker : null, speed);
    }
    if (lane?.status === 'wrong') {
      if (!this.wrongSince) this.wrongSince = fix.time;
    } else {
      this.wrongSince = 0;
    }
    const p: Progress = {
      s,
      snapped: onRoute ? proj.point : fix.lngLat,
      offset: proj.dist,
      heading: onRoute && speed < 2 ? routeBrg : heading,
      speed,
      next,
      after,
      distToNext,
      remaining,
      timeToNext,
      remainingTime,
      eta: new Date(Date.now() + remainingTime * 1000),
      onRoute,
      offRoute,
      arrived,
      junction: j ? { cand: j, dist: Math.max(0, j.s - s) } : null,
      nextStop,
      stopsPassed,
      lane,
      tunnel,
      toll,
      dr: !!fix.dr,
      nearDestination: remaining <= arrivalRadius(route),
    };
    if (!fix.dr && onRoute && fix.accuracy <= 50) this.real = { s, speed, time: fix.time };
    this.lastProgress = p;
    return p;
  }

  /** Voice prompts due at this progress. Each threshold fires once per maneuver. */
  prompts(p: Progress): Prompt[] {
    const out: Prompt[] = [];
    const step = p.next;
    // In the arrival zone the app says "You have reached your destination" and voice guidance
    // stops; the final arrival step gets no "in 500 metres" prompts of its own either (tunnels
    // and toll plazas on the way there still do).
    if (p.nearDestination) return out;
    const finalLeg = step.type === 'arrive' && !step.waypoint;
    if (!finalLeg) out.push(...this.maneuverPrompts(p));
    if (out.length) this.lastSpeech = this.now;
    if (!finalLeg) out.push(...this.lanePrompts(p, out));
    out.push(...this.tunnelPrompts(p, out));
    out.push(...this.tollPrompts(p, out));
    return out;
  }

  /**
   * "In 500 metres, turn left": at 2 km, 1 km and 400 m on fast roads, 500 m and 180 m in town,
   * where the leg is long enough; on a leg too short for any of those, one heads-up with the real
   * distance as the previous maneuver is passed; and "Turn left" a few seconds before. The first
   * heads-up of a turn with no lane data says which side to move to.
   */
  private maneuverPrompts(p: Progress): Prompt[] {
    const out: Prompt[] = [];
    const route = this.route!;
    const step = p.next;
    const prev = route.steps[step.index - 1];
    const legLen = prev ? step.s - prev.s : step.s;
    const fast = p.speed > 17 || (prev?.intersections[0]?.classes ?? []).includes('motorway') || (prev && prev.duration > 0 && prev.distance / prev.duration > 19);
    const thresholds = fast ? [2000, 1000, 400] : [500, 180];
    const laneFor = p.lane?.target.step === step ? p.lane : undefined;
    for (const t of thresholds) {
      const key = `${step.index}:${t}`;
      if (this.announced.has(key)) continue;
      if (legLen < t + 120) {
        // Leg too short for this prompt; mark it so it never fires late.
        if (p.distToNext < t) this.announced.add(key);
        continue;
      }
      if (p.distToNext <= t && p.distToNext > t * 0.55) {
        out.push({ key, step, distance: t, kind: 'maneuver', lane: laneFor });
        this.announced.add(key);
      } else if (p.distToNext <= t * 0.55) {
        this.announced.add(key);
      }
    }
    const nowDist = Math.max(30, p.speed * 5);
    const shortKey = `${step.index}:short`;
    if (!this.announced.has(shortKey) && legLen < thresholds[thresholds.length - 1] + 120) {
      const d = p.distToNext;
      if (legLen >= 140 && d <= legLen - 20 && d > nowDist + 60) {
        out.push({ key: shortKey, step, distance: d, kind: 'maneuver', lane: laneFor });
        this.announced.add(shortKey);
      } else if (d <= nowDist + 60) this.announced.add(shortKey);
    }
    // Which side to move to, on the first heads-up of a turn without lane data (once per turn).
    const first = out.find((q) => q.distance != null);
    const sideKey = `${step.index}:side`;
    if (first && !this.announced.has(sideKey)) {
      this.announced.add(sideKey);
      if (!first.lane && this.laneMode !== 'off') first.side = turnSide(step);
    }
    const nowKey = `${step.index}:now`;
    if (!this.announced.has(nowKey) && p.distToNext <= nowDist) {
      out.push({ key: nowKey, step, distance: null, kind: 'maneuver' });
      this.announced.add(nowKey);
    }
    return out;
  }

  /**
   * The toll reminder: "Toll plaza in 800 metres. Get your Touch n Go card ready." at the first
   * quiet moment within about 1 km on fast roads (400 m in town), and "Toll plaza ahead. Prepare
   * your Touch n Go." shortly before the plaza, unless the first was only just said.
   */
  private tollPrompts(p: Progress, already: Prompt[]): Prompt[] {
    const t = p.toll;
    if (!this.tollAlerts || !t) return [];
    const cur = this.route?.steps[p.next.index - 1];
    const roadSpeed = cur && cur.duration > 0 ? cur.distance / cur.duration : 0;
    const fast = Math.max(p.speed, roadSpeed) > 16;
    const earlyAt = fast ? TOLL_EARLY.fast : TOLL_EARLY.town;
    const nearAt = fast ? TOLL_NEAR.fast : TOLL_NEAR.town;
    const key = `toll:${t.plaza.id}`;
    const nearKey = `${key}:near`;
    const out: Prompt[] = [];
    if (!this.announced.has(key)) {
      if (t.dist <= nearAt) this.announced.add(key); // too close now: the short reminder covers it
      else if (t.dist <= earlyAt) {
        const quiet = this.now - this.lastSpeech >= 4000;
        const lastChance = t.dist < nearAt + (earlyAt - nearAt) * 0.4;
        if (!already.length && (quiet || lastChance)) {
          this.announced.add(key);
          this.tollSaid.set(t.plaza.id, this.now);
          this.lastSpeech = this.now;
          out.push({ key, step: p.next, distance: t.dist, kind: 'toll', toll: t });
        }
      }
    }
    if (!this.announced.has(nearKey) && t.dist <= nearAt) {
      const said = this.tollSaid.get(t.plaza.id);
      if (t.dist < Math.max(30, p.speed * 2.5) || (said != null && this.now - said < 15000)) this.announced.add(nearKey);
      else if (!already.length && !out.length) {
        this.announced.add(nearKey);
        this.lastSpeech = this.now;
        out.push({ key: nearKey, step: p.next, distance: t.dist, kind: 'tollNear', toll: t });
      }
    }
    return out;
  }

  /**
   * One prompt before each longer tunnel, at the first quiet moment once it is within about
   * 650 m on fast roads (260 m in town), and before the entrance at the latest.
   */
  private tunnelPrompts(p: Progress, already: Prompt[]): Prompt[] {
    const t = p.tunnel;
    if (!this.tunnelAlerts || !t || t.phase !== 'ahead' || t.span.length < TUNNEL_MIN_VOICE) return [];
    const key = `tunnel:${t.span.id}`;
    if (this.announced.has(key)) return [];
    const fast = p.speed > 16 || t.span.highway === 'motorway';
    if (t.dist > (fast ? 650 : 260)) return [];
    // Too close to be useful (a few seconds out): the sign on screen is enough.
    if (t.dist < Math.max(40, p.speed * 4)) {
      this.announced.add(key);
      return [];
    }
    const quiet = this.now - this.lastSpeech >= 4000;
    const lastChance = t.dist < (fast ? 220 : 90);
    if (already.length || !(quiet || lastChance)) return [];
    this.announced.add(key);
    this.lastSpeech = this.now;
    return [{ key, step: p.next, distance: t.dist, kind: 'tunnel', tunnel: t }];
  }

  /**
   * Early "move to the left lane" advice when the advice window opens, a repeat when the GPS
   * estimate says we are still outside the target lanes, and a calm note when it is too late.
   */
  private lanePrompts(p: Progress, already: Prompt[]): Prompt[] {
    const lane = p.lane;
    if (!lane) return [];
    const out: Prompt[] = [];
    const step = lane.target.step;
    const i = step.index;
    const earlyKey = `${i}:lane-early`;
    if (!this.announced.has(earlyKey)) {
      this.announced.add(earlyKey);
      const merged = already.find((q) => q.step === step && q.distance != null);
      if (merged) merged.lane = lane; // the maneuver prompt carries the lane hint instead
      else if (lane.status !== 'ok' && lane.status !== 'late') {
        out.push({ key: earlyKey, step, distance: lane.dist, kind: 'laneEarly', lane });
        this.lastSpeech = this.now;
      }
    }
    if (lane.status === 'wrong') {
      const count = this.wrongCount.get(i) ?? 0;
      const sustained = this.now - this.wrongSince >= 4000;
      const quiet = this.now - this.lastSpeech >= (count === 0 ? 9000 : 22000);
      if (sustained && quiet && count < 3 && !already.length) {
        this.wrongCount.set(i, count + 1);
        this.lastSpeech = this.now;
        out.push({ key: `${i}:lane-wrong-${count}`, step, distance: lane.dist, kind: 'laneWrong', lane });
      }
    }
    const lateKey = `${i}:lane-late`;
    if (lane.status === 'late' && (this.wrongCount.get(i) ?? 0) > 0 && !this.announced.has(lateKey)) {
      this.announced.add(lateKey);
      out.push({ key: lateKey, step, distance: lane.dist, kind: 'laneLate', lane });
    }
    return out;
  }
}
