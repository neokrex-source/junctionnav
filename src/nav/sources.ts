/** Location sources: real GPS and a route simulator for testing. Plus voice and wake lock helpers. */
import { bearing, destination, haversine, type LngLat } from '../geo/geo';
import type { Route } from '../routing/types';
import type { Fix } from './engine';
import { LANE_W } from './lanes';

export interface LocationSource {
  start(onFix: (f: Fix) => void, onError?: (e: Error) => void): void;
  stop(): void;
}

export class GpsSource implements LocationSource {
  private id: number | null = null;
  private prev: Fix | null = null;

  start(onFix: (f: Fix) => void, onError?: (e: Error) => void) {
    if (!('geolocation' in navigator)) {
      onError?.(new Error('This browser has no GPS access.'));
      return;
    }
    this.id = navigator.geolocation.watchPosition(
      (pos) => {
        const c = pos.coords;
        const lngLat: LngLat = [c.longitude, c.latitude];
        let heading = c.heading != null && !Number.isNaN(c.heading) && (c.speed ?? 0) > 0.8 ? c.heading : null;
        let speed = c.speed;
        if (this.prev) {
          const d = haversine(this.prev.lngLat, lngLat);
          const dt = (pos.timestamp - this.prev.time) / 1000;
          if (heading == null && d > 4) heading = bearing(this.prev.lngLat, lngLat);
          if ((speed == null || Number.isNaN(speed)) && dt > 0) speed = d / dt;
        }
        const fix: Fix = { lngLat, accuracy: c.accuracy, heading, speed: speed ?? null, time: pos.timestamp };
        this.prev = fix;
        onFix(fix);
      },
      (err) => onError?.(new Error(err.code === err.PERMISSION_DENIED ? 'Location permission was denied.' : err.message)),
      { enableHighAccuracy: true, maximumAge: 0, timeout: 20000 },
    );
  }

  stop() {
    if (this.id != null) navigator.geolocation.clearWatch(this.id);
    this.id = null;
    this.prev = null;
  }
}

/** One-off position lookup. */
export function currentPosition(timeout = 8000): Promise<LngLat> {
  return new Promise((resolve, reject) => {
    if (!('geolocation' in navigator)) return reject(new Error('No geolocation'));
    navigator.geolocation.getCurrentPosition(
      (p) => resolve([p.coords.longitude, p.coords.latitude]),
      (e) => reject(new Error(e.message)),
      { enableHighAccuracy: true, timeout, maximumAge: 30000 },
    );
  });
}

/** Drives along the route at the router's speeds (times a factor), slowing for turns. */
export class Simulator implements LocationSource {
  s = 0;
  factor = 1;
  paused = false;
  /** Lane the simulated car is in, counted from the left, and the lane count around it. */
  lane = 1;
  laneCount = 3;
  /** Move toward the advised lanes like an attentive driver. Off once lanes are changed by hand. */
  autoLanes = true;
  /** Along-route stretches with no GPS, like inside tunnels. */
  outages: [number, number][] = [];
  private laneF = 1;
  private timer = 0;
  private last = 0;
  private onFix: ((f: Fix) => void) | null = null;

  constructor(
    public route: Route,
    factor = 1,
  ) {
    this.factor = factor;
  }

  private speedAt(s: number): number {
    const steps = this.route.steps;
    let k = 0;
    while (k < steps.length - 1 && steps[k + 1].s <= s) k++;
    const st = steps[k];
    let v = st.duration > 0 ? st.distance / st.duration : 12;
    v = Math.max(6, Math.min(33, v));
    const next = steps[k + 1];
    if (next) {
      const d = next.s - s;
      const slow = next.type === 'turn' || next.type === 'end of road' || next.type === 'roundabout' || next.type === 'rotary' || next.type === 'arrive';
      if (slow && d < 70) v = Math.min(v, 7 + d * 0.08);
    }
    return v;
  }

  start(onFix: (f: Fix) => void) {
    this.onFix = onFix;
    this.last = performance.now();
    this.timer = window.setInterval(() => this.tick(), 100);
    this.emit(0);
  }

  private tick() {
    const now = performance.now();
    const dt = Math.min(0.5, (now - this.last) / 1000);
    this.last = now;
    if (this.paused) return;
    const v = this.speedAt(this.s);
    this.s = Math.min(this.route.line.length, this.s + v * dt * this.factor);
    // Glide sideways to the chosen lane (about 2.5 s per lane at normal speed).
    const step = (dt * this.factor) / 2.5;
    this.laneF += Math.max(-step, Math.min(step, this.lane - this.laneF));
    if (!this.outages.some(([a, b]) => this.s >= a && this.s <= b)) this.emit(v);
    if (this.s >= this.route.line.length) this.stop();
  }

  setLaneCount(n: number) {
    if (n === this.laneCount) return;
    // Keep the same distance from the right edge when lanes are added on the left, and vice versa.
    this.laneCount = n;
    this.lane = Math.max(0, Math.min(n - 1, this.lane));
    this.laneF = Math.max(0, Math.min(n - 1, this.laneF));
  }

  setLane(i: number, instant = false) {
    this.lane = Math.max(0, Math.min(this.laneCount - 1, i));
    if (instant) this.laneF = this.lane;
  }

  get laneChanging(): boolean {
    return Math.abs(this.laneF - this.lane) > 0.05;
  }

  private emit(v: number) {
    const line = this.route.line;
    const brg = line.bearingAt(this.s, 15);
    const offset = (this.laneF - (this.laneCount - 1) / 2) * LANE_W;
    this.onFix?.({
      lngLat: Math.abs(offset) > 0.01 ? destination(line.pointAt(this.s), brg + 90, offset) : line.pointAt(this.s),
      accuracy: 3,
      heading: brg,
      speed: v,
      time: Date.now(),
    });
  }

  jumpTo(s: number) {
    this.s = Math.max(0, Math.min(this.route.line.length, s));
    this.emit(this.speedAt(this.s));
  }

  stop() {
    clearInterval(this.timer);
    this.timer = 0;
  }
}

export class Voice {
  enabled = true;
  private unlocked = false;
  private audio: AudioContext | null = null;

  /** Two short rising tones before an urgent prompt (needs unlock() from a tap first). */
  chime() {
    if (!this.enabled || !this.audio) return;
    const ctx = this.audio;
    const t0 = ctx.currentTime + 0.02;
    [880, 1175].forEach((f, i) => {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = 'sine';
      g.gain.setValueAtTime(0.0001, t0 + i * 0.18);
      g.gain.exponentialRampToValueAtTime(0.25, t0 + i * 0.18 + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + i * 0.18 + 0.16);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + i * 0.18);
      o.stop(t0 + i * 0.18 + 0.18);
    });
  }

  /** Call from a user gesture (iOS needs it before speech works). */
  unlock() {
    const ua = (navigator as unknown as { userActivation?: { isActive: boolean } }).userActivation;
    if (ua && !ua.isActive && !this.audio) {
      // Not inside a tap (for example an auto-started demo): wait for the next one.
      window.addEventListener('click', () => this.unlock(), { once: true, capture: true });
      return;
    }
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!this.audio && AC) this.audio = new AC();
      void this.audio?.resume();
    } catch {
      /* no audio */
    }
    if (this.unlocked || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    this.unlocked = true;
  }

  /** Urgent prompts cut off whatever is playing; others wait their turn. */
  speak(text: string, lang: string, urgent = true) {
    if (!this.enabled || !('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    if (urgent) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const voice = synth.getVoices().find((v) => v.lang.toLowerCase().startsWith(lang.toLowerCase().slice(0, 2)));
    if (voice) u.voice = voice;
    u.rate = 1.02;
    synth.speak(u);
  }
}

export class ScreenWake {
  private lock: { release(): Promise<void> } | null = null;
  async on() {
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl) this.lock = await wl.request('screen');
    } catch {
      /* not granted */
    }
  }
  async off() {
    try {
      await this.lock?.release();
    } catch {
      /* ignore */
    }
    this.lock = null;
  }
}
