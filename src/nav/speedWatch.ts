/**
 * Watching the speed against the limit, the speed cameras and the average speed checks ahead,
 * for the speed sign beside the speed and the warnings.
 *
 *  - Near the limit (within the margin, 5 km/h by default): the speed turns amber, and once per
 *    stretch a short tone and "Approaching the speed limit of 110".
 *  - Over it for more than a moment: red, a tone and "Slow down. The speed limit is 110", again
 *    every 30 s while it lasts (up to four times on one limit).
 *  - A speed camera 800 m ahead on fast roads (300 m in town): "Speed camera in 800 metres.
 *    Speed limit 110", and "Slow down" with it when over the limit; if the car is still over the
 *    limit 300 m before it, once more.
 *  - An average speed check: when it starts ("Average speed check for 12 kilometres") with the
 *    average so far on the screen, and when it ends.
 */
import { cameraAhead, checkAt, limitAt, lowerLimitAhead, type LimitSource, type SpeedCamera, type SpeedCheck, type SpeedInfo } from './speed';

/** voice: tone and words; tone: the tone only; sign: shown only; off: no speed limit at all. */
export type SpeedAlertMode = 'voice' | 'tone' | 'sign' | 'off';
export type Speeding = 'ok' | 'near' | 'over';

export interface SpeedState {
  /** The speed (km/h). */
  kmh: number;
  /** The limit here (km/h) and where it comes from. */
  limit: { kmh: number; src: LimitSource } | null;
  /** A lower limit coming up (to slow down for). */
  ahead: { kmh: number; dist: number } | null;
  speeding: Speeding;
  /** The next speed camera, from where it is announced until it is passed. */
  camera: { cam: SpeedCamera; dist: number } | null;
  /** The average speed check we are in (with the average so far, km/h) or the next one close ahead. */
  check: { check: SpeedCheck; inside: boolean; dist: number; average: number | null } | null;
}

export type SpeedPromptKind = 'speedNear' | 'speedOver' | 'camera' | 'cameraOver' | 'checkStart' | 'checkEnd';

export interface SpeedPrompt {
  kind: SpeedPromptKind;
  key: string;
  /** The limit to say (km/h), if known. */
  limit: number | null;
  /** Distance to the camera, or the length of the check (metres). */
  dist?: number;
  /** Over the limit when said (the camera warning adds "Slow down"). */
  over?: boolean;
}

export const CAMERA_AHEAD = { fast: 800, town: 300 };
/** The second camera warning when still over the limit. */
export const CAMERA_NEAR = 300;
/** Over the limit for this long (ms) before it counts. */
const OVER_AFTER = 1500;
const OVER_REPEAT = 30_000;
const OVER_MAX = 4;
/** Below the near band for this long (ms) before the near warning may come again. */
const NEAR_REARM = 20_000;

export class SpeedWatch {
  info: SpeedInfo = { limits: [], cameras: [], checks: [] };
  mode: SpeedAlertMode = 'voice';
  /** Warn this many km/h below the limit. */
  margin = 5;
  /** Speed camera and average speed check warnings. */
  cameras = true;
  private status: Speeding = 'ok';
  private overSince = 0;
  private okSince = 0;
  private nearArmed = true;
  private overSaid = 0;
  private overCount = 0;
  private limitNow: number | null = null;
  private said = new Set<string>();
  /** The check being driven through: metres and seconds inside it so far. */
  private avg: { id: string; dist: number; time: number; s: number; at: number } | null = null;
  private lastCheck: SpeedCheck | null = null;

  reset() {
    this.info = { limits: [], cameras: [], checks: [] };
    this.status = 'ok';
    this.overSince = 0;
    this.okSince = 0;
    this.nearArmed = true;
    this.overSaid = 0;
    this.overCount = 0;
    this.limitNow = null;
    this.said.clear();
    this.avg = null;
    this.lastCheck = null;
  }

  /** The state at position s, at speed (m/s), at time `now` (ms); `fast`: on a fast road. */
  update(s: number, speed: number, now: number, fast: boolean): SpeedState {
    const kmh = speed * 3.6;
    const span = this.mode === 'off' ? null : limitAt(this.info.limits, s);
    const limit = span ? { kmh: span.kmh, src: span.src } : null;
    if ((limit?.kmh ?? null) !== this.limitNow) {
      // A new limit: a new stretch for the warnings.
      this.limitNow = limit?.kmh ?? null;
      this.nearArmed = true;
      this.overCount = 0;
    }
    let status: Speeding = 'ok';
    if (limit) {
      const L = limit.kmh;
      if (kmh >= L + 1) this.overSince ||= now;
      else this.overSince = 0;
      if (this.overSince && now - this.overSince >= OVER_AFTER) status = 'over';
      else if (kmh >= L - this.margin || (this.status !== 'ok' && kmh >= L - this.margin - 2)) status = 'near';
    } else this.overSince = 0;
    if (status === 'ok') {
      this.okSince ||= now;
      if (now - this.okSince >= NEAR_REARM) {
        this.nearArmed = true;
        this.overCount = 0;
      }
    } else this.okSince = 0;
    this.status = status;

    const ahead = limit ? lowerLimitAhead(this.info.limits, s, fast ? 500 : 200) : null;
    const camera = this.cameras ? cameraAhead(this.info.cameras, s, fast ? CAMERA_AHEAD.fast + 200 : CAMERA_AHEAD.town + 100) : null;
    const c = this.cameras ? checkAt(this.info.checks, s, 1000) : null;
    let check: SpeedState['check'] = null;
    if (c) {
      let average: number | null = null;
      if (c.inside) {
        if (this.avg?.id !== c.check.id) this.avg = { id: c.check.id, dist: 0, time: 0, s, at: now };
        const a = this.avg;
        const ds = Math.max(0, s - a.s);
        // The time each stretch took at the speed it was driven (so a speeded-up simulated drive
        // counts as the drive it stands for); standing still, the clock counts.
        a.time += speed > 1 ? ds / speed : Math.max(0, (now - a.at) / 1000);
        a.dist += ds;
        a.s = s;
        a.at = now;
        if (a.time >= 5) average = (a.dist / a.time) * 3.6;
      }
      check = { ...c, average };
    }
    return { kmh, limit, ahead, speeding: status, camera, check };
  }

  /** The warnings due now (each once, the over-speed one repeating while it lasts). */
  prompts(st: SpeedState, s: number, now: number, fast: boolean): SpeedPrompt[] {
    const out: SpeedPrompt[] = [];
    const limit = st.limit?.kmh ?? null;
    const alerts = this.mode !== 'off' && this.mode !== 'sign';
    if (alerts && limit != null) {
      if (st.speeding === 'over') {
        if (this.overCount === 0 || (now - this.overSaid >= OVER_REPEAT && this.overCount < OVER_MAX)) {
          this.overSaid = now;
          this.overCount++;
          this.nearArmed = false;
          out.push({ kind: 'speedOver', key: `over:${limit}:${this.overCount}`, limit });
        }
      } else if (st.speeding === 'near' && this.nearArmed && st.kmh < limit + 1) {
        // (Already over it, about to count as over: that warning comes instead.)
        this.nearArmed = false;
        out.push({ kind: 'speedNear', key: `near:${limit}:${Math.round(s)}`, limit });
      }
    }
    if (this.cameras && st.camera) {
      const { cam, dist } = st.camera;
      const lead = fast ? CAMERA_AHEAD.fast : CAMERA_AHEAD.town;
      const key = `cam:${cam.id}`;
      if (!this.said.has(key) && dist <= lead) {
        this.said.add(key);
        // Too close to be any use: the screen shows it.
        if (dist > 120) out.push({ kind: 'camera', key, limit: cam.limit ?? limit, dist, over: st.speeding === 'over' });
        if (st.speeding === 'over') this.said.add(`${key}:over`);
      }
      const overKey = `${key}:over`;
      if (this.said.has(key) && !this.said.has(overKey) && st.speeding === 'over' && dist <= CAMERA_NEAR && dist > 60) {
        this.said.add(overKey);
        out.push({ kind: 'cameraOver', key: overKey, limit: cam.limit ?? limit, dist });
      }
    }
    if (this.cameras && st.check) {
      const { check, inside } = st.check;
      const key = `check:${check.id}`;
      if (inside && !this.said.has(key)) {
        this.said.add(key);
        out.push({ kind: 'checkStart', key, limit: check.limit ?? limit, dist: check.s1 - check.s0 });
      }
      this.lastCheck = check;
    }
    const done = this.lastCheck;
    if (done && s > done.s1 && this.said.has(`check:${done.id}`) && !this.said.has(`check:${done.id}:end`)) {
      this.said.add(`check:${done.id}:end`);
      out.push({ kind: 'checkEnd', key: `check:${done.id}:end`, limit: null });
      this.lastCheck = null;
    }
    // A camera warning that already says "slow down" stands for the over-speed one.
    if (out.some((p) => p.kind === 'cameraOver' || (p.kind === 'camera' && p.over))) return out.filter((p) => p.kind !== 'speedOver');
    return out;
  }
}
