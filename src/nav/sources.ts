/** Location sources: real GPS and a route simulator for testing. Plus voice and wake lock helpers. */
import { NATIVE } from '../platform';
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

/** Simulated speed at along-route position s: the router's speed for the step, slowing for turns. */
export function simSpeedAt(route: Route, s: number): number {
  const steps = route.steps;
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
    return simSpeedAt(this.route, s);
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

/**
 * Android's own text to speech, in the Android app (its WebView has no speech synthesis).
 * The module is kept, not the plugin: a Capacitor plugin answers every property, `then` too, so
 * a promise resolved with one would try to call a native "then" method.
 */
type TtsModule = typeof import('@capacitor-community/text-to-speech');
let nativeTts: Promise<TtsModule> | null = null;
const ttsModule = () => (nativeTts ??= import('@capacitor-community/text-to-speech'));

export type VoiceGender = 'female' | 'male';

/** A voice the phone or browser can speak with. */
export interface VoiceInfo {
  /** Its own name (Android's voice name such as en-gb-x-gbd-local, or the browser voice's name). */
  id: string;
  /** What to show: the browser's name for it, or Android's language and country. */
  label: string;
  lang: string;
  gender: VoiceGender | null;
  /** Its number for Android's speech (the plugin's list order) or the browser's list. */
  index: number;
  /** Works without internet. */
  local: boolean;
}

/** Google's Android voices by their code (en-US, en-GB, en-AU, en-IN, ja-JP, id-ID). */
const MALE_CODES = /-x-(iol|iom|tpd|gbb|gbd|rjs|aub|aud|end|jac|jad|idd|ide)(-|#|$)/i;
const FEMALE_CODES = /-x-(iob|iog|sfg|tpc|tpf|gba|gbc|gbg|afh|aua|auc|ahp|cxx|ene|htm|jab|dfz|idc)(-|#|$)/i;
/** Voices named after people (Windows, Edge, Apple, Chrome). */
const MALE_NAMES = /\b(male|man|david|mark|george|james|guy|ryan|william|christopher|eric|brian|andrew|roger|thomas|liam|connor|daniel|alex|fred|aaron|arthur|gordon|oliver|rishi|ravi|prabhat|ichiro|keita|otoya|hattori|daichi|naoki|osman|rizwan|ardi|kenji|takumi)\b/i;
const FEMALE_NAMES = /\b(female|woman|zira|hazel|susan|heera|haruka|ayumi|sayaka|nanami|aoi|mayu|shiori|aria|jenny|sonia|libby|natasha|samantha|karen|moira|tessa|kyoko|o-ren|amira|yasmin|victoria|fiona|veena|catherine|serena|nicky|allison|ava|neerja|gadis)\b/i;

/** Whether a voice is a man's or a woman's, from its name (null when the name does not say). */
export function voiceGender(name: string): VoiceGender | null {
  // Older Google voices say it in the name (en-us-x-sfg#male_1-local), before the code does.
  if (/#female/i.test(name)) return 'female';
  if (/#male/i.test(name)) return 'male';
  if (FEMALE_CODES.test(name)) return 'female';
  if (MALE_CODES.test(name)) return 'male';
  if (FEMALE_NAMES.test(name)) return 'female';
  if (MALE_NAMES.test(name)) return 'male';
  return null;
}

/** What the voice setting asks for: a man's or a woman's voice, or one voice by its id. */
export interface VoiceChoice {
  gender: VoiceGender;
  id: string;
}

const normLang = (l: string) => l.toLowerCase().replace('_', '-');

/** The voices for a language: its own region first, then the same language elsewhere; offline ones first. */
export function voicesFor(voices: VoiceInfo[], lang: string): VoiceInfo[] {
  const want = normLang(lang);
  const base = want.slice(0, 2);
  const rank = (v: VoiceInfo) => (normLang(v.lang) === want ? 0 : 2) + (v.local ? 0 : 1);
  return voices.filter((v) => normLang(v.lang).startsWith(base)).sort((a, b) => rank(a) - rank(b));
}

/**
 * The voice to speak a language with: the one chosen by id (when it speaks the language), else
 * one of the gender asked for. With no man's voice for the language, the usual voice speaks a
 * little lower (pitch below 1).
 */
export function pickVoice(voices: VoiceInfo[], lang: string, choice: VoiceChoice): { voice: VoiceInfo | null; pitch: number } {
  const list = voicesFor(voices, lang);
  if (choice.id) {
    const v = list.find((x) => x.id === choice.id);
    if (v) return { voice: v, pitch: 1 };
  }
  const g = list.find((x) => x.gender === choice.gender);
  if (g) return { voice: g, pitch: 1 };
  if (choice.gender === 'female') return { voice: list.find((x) => x.gender !== 'male') ?? null, pitch: 1 };
  return { voice: null, pitch: 0.8 };
}

export class Voice {
  enabled = true;
  /** Which voice to speak with (from Settings). */
  choice: VoiceChoice = { gender: 'female', id: '' };
  private unlocked = false;
  private audio: AudioContext | null = null;
  private nativeVoices: Promise<VoiceInfo[]> | null = null;

  /** The voices this phone or browser has (the browser may need a moment to list them). */
  voices(): Promise<VoiceInfo[]> {
    if (NATIVE) {
      this.nativeVoices ??= ttsModule()
        .then((m) => m.TextToSpeech.getSupportedVoices())
        .then(({ voices }) =>
          voices.map((v, index) => ({ id: v.voiceURI || v.name, label: v.name, lang: v.lang, gender: voiceGender(v.voiceURI || v.name), index, local: v.localService !== false })),
        )
        .catch(() => {
          this.nativeVoices = null;
          return [];
        });
      return this.nativeVoices;
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve([]);
    const synth = window.speechSynthesis;
    const read = () => synth.getVoices().map((v, index) => ({ id: v.voiceURI || v.name, label: v.name, lang: v.lang, gender: voiceGender(`${v.name} ${v.voiceURI}`), index, local: v.localService }));
    const now = read();
    if (now.length) return Promise.resolve(now);
    return new Promise((ok) => {
      const done = () => ok(read());
      synth.addEventListener('voiceschanged', done, { once: true });
      setTimeout(done, 1500);
    });
  }

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
    if (NATIVE) {
      void ttsModule().catch(() => {});
      return;
    }
    if (this.unlocked || !('speechSynthesis' in window)) return;
    const u = new SpeechSynthesisUtterance('');
    u.volume = 0;
    window.speechSynthesis.speak(u);
    this.unlocked = true;
  }

  /** Urgent prompts cut off whatever is playing; others wait their turn. */
  speak(text: string, lang: string, urgent = true, choice: VoiceChoice = this.choice) {
    if (!this.enabled) return;
    if (NATIVE) {
      // Flush (0) cuts off what is playing, Add (1) queues.
      void Promise.all([ttsModule(), this.voices()])
        .then(([m, voices]) => {
          const { voice, pitch } = pickVoice(voices, lang, choice);
          return m.TextToSpeech.speak({ text, lang, rate: 1.0, pitch, ...(voice ? { voice: voice.index } : {}), queueStrategy: urgent ? 0 : 1 });
        })
        .catch((e) => console.warn('[voice]', e));
      return;
    }
    if (!('speechSynthesis' in window)) return;
    const synth = window.speechSynthesis;
    if (urgent) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const all = synth.getVoices();
    const infos = all.map((v, index) => ({ id: v.voiceURI || v.name, label: v.name, lang: v.lang, gender: voiceGender(`${v.name} ${v.voiceURI}`), index, local: v.localService }));
    const { voice, pitch } = pickVoice(infos, lang, choice);
    if (voice) u.voice = all[voice.index];
    u.pitch = pitch;
    u.rate = 1.02;
    synth.speak(u);
  }

  /** Stops speaking at once (voice turned off, navigation ended). */
  stop() {
    if (NATIVE) {
      if (nativeTts) void nativeTts.then((m) => m.TextToSpeech.stop()).catch(() => {});
      return;
    }
    window.speechSynthesis?.cancel();
  }
}

const keepAwake = () => import('@capacitor-community/keep-awake');

export class ScreenWake {
  private lock: { release(): Promise<void> } | null = null;
  async on() {
    if (NATIVE) {
      // The Android WebView has no Screen Wake Lock; the plugin keeps the screen on instead.
      await keepAwake()
        .then((m) => m.KeepAwake.keepAwake())
        .catch(() => {});
      return;
    }
    try {
      const wl = (navigator as unknown as { wakeLock?: { request(t: 'screen'): Promise<{ release(): Promise<void> }> } }).wakeLock;
      if (wl) this.lock = await wl.request('screen');
    } catch {
      /* not granted */
    }
  }
  async off() {
    if (NATIVE) {
      await keepAwake()
        .then((m) => m.KeepAwake.allowSleep())
        .catch(() => {});
      return;
    }
    try {
      await this.lock?.release();
    } catch {
      /* ignore */
    }
    this.lock = null;
  }
}
