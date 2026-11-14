/**
 * Staying alert on long drives: how long you have been driving without a break, the reminders
 * to rest once that passes your focus limit, jokes and facts to keep you awake, and signs of
 * tiredness read from the driving itself.
 *
 *  - The driving clock runs while navigating. A stop of 15 minutes or more is a break and starts
 *    it again (shorter stops, a jam or a red light, do not). Ending navigation and starting again
 *    within 15 minutes carries on the same clock.
 *  - At the focus limit (2 hours by default, a quarter less between midnight and 6 am, when the
 *    body is at its sleepiest): "Time for a break", then again every 15 minutes (10 at night),
 *    more firmly each time, until a break is taken.
 *  - Signs of tiredness: drowsy drivers drift in the lane and correct sharply, and let the speed
 *    wander. On a highway, cruising away from turns, junctions, toll plazas and traffic, each
 *    minute of driving is compared with the same driver's first minutes on that drive (so a
 *    phone's GPS and a driver's own style count as normal): the drift from the lane's line, the
 *    weave of the heading against the road and the swing of the speed. Three unsteady minutes
 *    out of the last five (two of four at night) is a warning. GPS is not a lane sensor, so this
 *    adds to the clock rather than replacing it.
 *  - Talking: when the break is due or the driving looks tired, a joke, a fact or a riddle every
 *    few minutes at a quiet moment; with "often", also every 20 minutes from 45 minutes in.
 */
import type { TalkMode } from '../talk/types';

/** A stop at least this long is a break (ms). */
export const BREAK_MS = 15 * 60_000;
/** Below this speed the car is standing still (m/s, about 7 km/h). */
export const STILL = 2;
/** Between midnight and 6 am the focus limit is this much of the usual. */
export const NIGHT_FACTOR = 0.75;
const MIN = 60_000;
/** After the limit, the reminder comes again this often (ms); at night more often. */
const REMIND = { day: 15 * MIN, night: 10 * MIN };
/** Talking once the break is due, after a tiredness warning, and with "often" before that. */
const TALK_TIRED = 6 * MIN;
const TALK_DROWSY = 4 * MIN;
const TALK_OFTEN = 20 * MIN;
const TALK_OFTEN_FROM = 45 * MIN;
/** How long after a tiredness warning the closer talking goes on. */
const DROWSY_WINDOW = 30 * MIN;
/** A reminder waits for a quiet moment, but not longer than this. */
const MAX_WAIT = 90_000;
/** Nothing to talk about within this long after something was said. */
const TALK_GAP = 45_000;

export interface AlertConfig {
  /** Minutes of driving before the break reminder (0: no reminders). */
  focusMin: number;
  talk: TalkMode;
  /** Read the driving for signs of tiredness. */
  detect: boolean;
}

export interface AlertSample {
  /** The drive's clock (ms): real time, or the simulator's sped-up time. */
  now: number;
  /** The hour of the day where the driver is (0 to 24), for night driving. */
  hour: number;
  /** m/s */
  speed: number;
  /**
   * Good conditions to read the driving: cruising on a fast road on the route, away from turns,
   * junctions, toll plazas, tunnels and traffic, with good GPS.
   */
  steady: boolean;
  /** Distance from the route's line, right positive (m). */
  lateral: number | null;
  /** The GPS heading less the road's direction (degrees). */
  headingDev: number | null;
  /** A good moment to talk: nothing from the guidance due soon. */
  quiet: boolean;
}

export type Sign = 'wander' | 'weave' | 'speed';

export type AlertEvent =
  | { kind: 'limit'; driven: number }
  | { kind: 'remind'; driven: number; level: 1 | 2 | 3 }
  | { kind: 'drowsy'; driven: number; signs: Sign[] }
  | { kind: 'talk'; reason: 'tired' | 'drowsy' | 'often' }
  | { kind: 'rested'; driven: number };

export interface AlertSnapshot {
  driven: number;
  /** Wall clock (ms) when it was taken. */
  at: number;
}

export interface AlertState {
  driven: number;
  /** The focus limit now (ms; Infinity with reminders off). */
  limit: number;
  /** Past the limit. */
  due: boolean;
  /** A tiredness warning in the last 10 minutes. */
  drowsy: boolean;
}

export const isNightHour = (hour: number) => hour >= 0 && hour < 6;

export class AlertWatch {
  config: AlertConfig = { focusMin: 120, talk: 'tired', detect: true };
  /** Driving time since the last break (ms). */
  driven = 0;
  readonly behaviour = new BehaviourWatch();
  private last: number | null = null;
  private stillSince: number | null = null;
  private limitSaid = false;
  private nextRemind = 0;
  private remindCount = 0;
  private nextTalk = 0;
  private lastSaid = -Infinity;
  private drowsyAt = -Infinity;
  /** A reminder waiting for a quiet moment, and since when. */
  private waiting: { ev: AlertEvent; since: number } | null = null;
  private night = false;

  /** The focus limit at this hour (ms). */
  limit(hour: number): number {
    if (!this.config.focusMin) return Infinity;
    return this.config.focusMin * MIN * (isNightHour(hour) ? NIGHT_FACTOR : 1);
  }

  state(now: number, hour: number): AlertState {
    const limit = this.limit(hour);
    return { driven: this.driven, limit, due: this.driven >= limit, drowsy: now - this.drowsyAt < 10 * MIN };
  }

  /** Starts a new drive, carrying on from the last one when it ended less than a break ago. */
  resume(snap: AlertSnapshot | null, wallNow: number) {
    this.last = null;
    this.stillSince = null;
    this.waiting = null;
    this.behaviour.reset();
    const gap = snap ? Math.max(0, wallNow - snap.at) : Infinity;
    if (!snap || gap >= BREAK_MS) return this.rest();
    // Between drives: counted as driving, to be on the safe side.
    this.driven = snap.driven + gap;
  }

  snapshot(wallNow: number): AlertSnapshot {
    return { driven: this.driven, at: wallNow };
  }

  /** A break: the clock starts again. */
  rest() {
    this.driven = 0;
    this.limitSaid = false;
    this.remindCount = 0;
    this.nextRemind = 0;
    this.nextTalk = 0;
    this.drowsyAt = -Infinity;
    this.waiting = null;
  }

  /** Something was said by this watch (or the talk), so the next talk keeps its distance. */
  said(now: number) {
    this.lastSaid = now;
  }

  update(x: AlertSample): AlertEvent[] {
    const out: AlertEvent[] = [];
    const dt = this.last == null ? 0 : Math.max(0, x.now - this.last);
    this.last = x.now;
    this.night = isNightHour(x.hour);
    // A long gap between fixes (the app in the background) is a break when long enough.
    if (dt >= BREAK_MS) {
      out.push({ kind: 'rested', driven: this.driven });
      this.rest();
      this.behaviour.reset();
      return out;
    }
    if (x.speed < STILL) {
      this.stillSince ??= x.now - dt;
      if (x.now - this.stillSince >= BREAK_MS && this.driven > 0) {
        out.push({ kind: 'rested', driven: this.driven });
        this.rest();
        this.behaviour.reset();
        return out;
      }
    } else this.stillSince = null;
    if (this.stillSince == null || x.now - this.stillSince < BREAK_MS) this.driven += dt;

    // Signs of tiredness.
    if (this.config.detect) {
      const signs = this.behaviour.add(x.now, x.speed, x.steady, x.lateral, x.headingDev, this.night);
      if (signs) {
        this.drowsyAt = x.now;
        this.queue({ kind: 'drowsy', driven: this.driven, signs }, x.now);
        this.nextTalk = x.now + TALK_DROWSY;
      }
    }

    // The break reminder.
    const limit = this.limit(x.hour);
    if (Number.isFinite(limit) && this.driven >= limit) {
      if (!this.limitSaid) {
        this.limitSaid = true;
        this.remindCount = 0;
        this.nextRemind = x.now + (this.night ? REMIND.night : REMIND.day);
        this.queue({ kind: 'limit', driven: this.driven }, x.now);
        this.nextTalk = Math.max(this.nextTalk, x.now + TALK_TIRED / 2);
      } else if (x.now >= this.nextRemind) {
        this.remindCount++;
        const over = this.driven - limit;
        const level: 1 | 2 | 3 = over >= 60 * MIN ? 3 : over >= 30 * MIN ? 2 : 1;
        this.nextRemind = x.now + (this.night ? REMIND.night : REMIND.day);
        this.queue({ kind: 'remind', driven: this.driven, level }, x.now);
      }
    }

    // A reminder at the first quiet moment (or after a while regardless).
    if (this.waiting && (x.quiet || x.now - this.waiting.since >= MAX_WAIT)) {
      out.push(this.waiting.ev);
      this.waiting = null;
      this.lastSaid = x.now;
      return out;
    }

    // Something to keep the driver awake.
    const talk = this.talkReason(x.now, limit);
    if (talk && !this.waiting && x.quiet && x.speed >= STILL && x.now - this.lastSaid >= TALK_GAP) {
      if (this.nextTalk === 0) this.nextTalk = x.now;
      if (x.now >= this.nextTalk) {
        out.push({ kind: 'talk', reason: talk });
        this.lastSaid = x.now;
        this.nextTalk = x.now + (talk === 'drowsy' ? TALK_DROWSY : talk === 'tired' ? TALK_TIRED : TALK_OFTEN);
      }
    }
    return out;
  }

  private queue(ev: AlertEvent, now: number) {
    // A tiredness warning goes before a waiting reminder; a reminder does not push out a warning.
    if (this.waiting?.ev.kind === 'drowsy' && ev.kind !== 'drowsy') return;
    this.waiting = { ev, since: now };
  }

  private talkReason(now: number, limit: number): 'tired' | 'drowsy' | 'often' | null {
    const mode = this.config.talk;
    if (mode === 'off') return null;
    if (now - this.drowsyAt < DROWSY_WINDOW) return 'drowsy';
    if (this.driven >= limit) return 'tired';
    if (mode === 'often' && this.driven >= TALK_OFTEN_FROM) return 'often';
    return null;
  }
}

/* ------------------------------------------------------------------ reading the driving */

/** One minute of steady driving, as numbers. */
export interface MinuteStat {
  /** Spread of the distance from the lane's line, its trend taken out (m); null across a lane change. */
  wander: number | null;
  /** Spread of the heading against the road (degrees); null across a lane change. */
  weave: number | null;
  /** Spread of the speed against its mean. */
  speed: number | null;
}

interface Point {
  t: number;
  lat: number | null;
  hd: number | null;
  v: number;
}

/** A minute of steady samples makes one reading. */
export const WINDOW_MS = 60_000;
/** A part-minute cut short by a turn or traffic still counts from this long. */
const WINDOW_MIN = 45_000;
/** Readings from this many minutes make the driver's own normal. */
export const BASELINE_MINUTES = 8;
/** The smallest spreads taken as normal, so a perfectly steady start does not make every wobble look tired. */
const FLOOR = { wander: 0.4, weave: 0.8, speed: 0.02 };
/** A reading is unsteady when it is this many times the driver's normal, and at least the absolute value. */
const RATIO = { wander: 1.8, weave: 1.8, speed: 2 };
const ABS = { wander: 0.9, weave: 1.6, speed: 0.05 };
/** No second warning within this long (ms of driving). */
const COOLDOWN = 10 * MIN;

function sd(xs: number[]): number {
  if (xs.length < 2) return 0;
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  return Math.sqrt(xs.reduce((a, b) => a + (b - m) * (b - m), 0) / (xs.length - 1));
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b);
  const n = s.length;
  return n % 2 ? s[(n - 1) >> 1] : (s[n / 2 - 1] + s[n / 2]) / 2;
}

/** The spread of values around their straight-line trend over time. */
function detrendedSd(ts: number[], xs: number[]): number {
  const n = xs.length;
  if (n < 3) return 0;
  const mt = ts.reduce((a, b) => a + b, 0) / n;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (ts[i] - mt) * (xs[i] - mx);
    den += (ts[i] - mt) ** 2;
  }
  const k = den > 0 ? num / den : 0;
  const res = xs.map((x, i) => x - (mx + k * (ts[i] - mt)));
  return sd(res);
}

/** The numbers for a minute of driving. */
export function minuteStat(pts: { t: number; lat: number | null; hd: number | null; v: number }[]): MinuteStat {
  const t0 = pts[0].t;
  const lat = pts.filter((p) => p.lat != null) as (Point & { lat: number })[];
  // A lane change (or a GPS jump): the line moves by most of a lane between the start and the end.
  let laneChange = false;
  if (lat.length >= 10) {
    const span = (lat[lat.length - 1].t - lat[0].t) / 1000;
    const head = lat.filter((p) => (p.t - lat[0].t) / 1000 <= Math.min(15, span / 4)).map((p) => p.lat);
    const tail = lat.filter((p) => (lat[lat.length - 1].t - p.t) / 1000 <= Math.min(15, span / 4)).map((p) => p.lat);
    const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
    const all = lat.map((p) => p.lat);
    laneChange = Math.abs(mean(head) - mean(tail)) > 2 || Math.max(...all) - Math.min(...all) > 6;
  }
  const wander = !laneChange && lat.length >= 10 ? detrendedSd(lat.map((p) => (p.t - t0) / 1000), lat.map((p) => p.lat)) : null;
  const hds = pts.filter((p) => p.hd != null && Math.abs(p.hd) <= 12).map((p) => p.hd!);
  const weave = !laneChange && hds.length >= 10 ? sd(hds) : null;
  const vs = pts.map((p) => p.v);
  const mv = vs.reduce((a, b) => a + b, 0) / vs.length;
  const speed = mv >= 16 && vs.length >= 10 ? sd(vs) / mv : null;
  return { wander, weave, speed };
}

/** Which signs a minute shows against the driver's normal. */
export function unsteadySigns(m: MinuteStat, base: { wander: number; weave: number; speed: number }): Sign[] {
  const out: Sign[] = [];
  if (m.wander != null && m.wander >= Math.max(ABS.wander, RATIO.wander * base.wander)) out.push('wander');
  if (m.weave != null && m.weave >= Math.max(ABS.weave, RATIO.weave * base.weave)) out.push('weave');
  if (m.speed != null && m.speed >= Math.max(ABS.speed, RATIO.speed * base.speed)) out.push('speed');
  return out;
}

export class BehaviourWatch {
  private buf: Point[] = [];
  private lastT = -Infinity;
  /** Minutes for the driver's normal, then the normal itself. */
  private early: MinuteStat[] = [];
  base: { wander: number; weave: number; speed: number } | null = null;
  /** The signs of the most recent minutes (empty: steady). */
  recent: Sign[][] = [];
  private quietUntil = -Infinity;

  reset() {
    this.buf = [];
    this.lastT = -Infinity;
    this.early = [];
    this.base = null;
    this.recent = [];
    this.quietUntil = -Infinity;
  }

  /** Adds a sample; returns the signs when they add up to tiredness. */
  add(t: number, v: number, steady: boolean, lat: number | null, hd: number | null, night: boolean): Sign[] | null {
    if (!steady) {
      if (this.buf.length && this.buf[this.buf.length - 1].t - this.buf[0].t >= WINDOW_MIN) return this.close(night);
      this.buf = [];
      return null;
    }
    // About one sample a second is plenty (the simulator sends ten).
    if (t - this.lastT < 900) return null;
    this.lastT = t;
    this.buf.push({ t, lat, hd, v });
    if (t - this.buf[0].t >= WINDOW_MS) return this.close(night);
    return null;
  }

  private close(night: boolean): Sign[] | null {
    const pts = this.buf;
    this.buf = [];
    if (pts.length < 20) return null;
    const m = minuteStat(pts);
    const t = pts[pts.length - 1].t;
    if (!this.base) {
      this.early.push(m);
      if (this.early.length >= BASELINE_MINUTES) {
        const pick = (k: keyof MinuteStat) => {
          const xs = this.early.map((e) => e[k]).filter((x): x is number => x != null);
          return xs.length ? median(xs) : 0;
        };
        this.base = { wander: Math.max(FLOOR.wander, pick('wander')), weave: Math.max(FLOOR.weave, pick('weave')), speed: Math.max(FLOOR.speed, pick('speed')) };
      }
      return null;
    }
    this.recent.push(unsteadySigns(m, this.base));
    const span = night ? 4 : 5;
    const need = night ? 2 : 3;
    if (this.recent.length > 6) this.recent.shift();
    const last = this.recent.slice(-span);
    if (t < this.quietUntil || last.filter((s) => s.length).length < need) return null;
    this.quietUntil = t + COOLDOWN;
    this.recent = [];
    return [...new Set(last.flat())];
  }
}
