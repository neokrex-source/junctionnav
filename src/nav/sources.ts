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

/**
 * Simulated speed at along-route position s: the router's speed for the step (or `cruise`, m/s,
 * when given), slowing for turns.
 */
export function simSpeedAt(route: Route, s: number, cruise?: number): number {
  const steps = route.steps;
  let k = 0;
  while (k < steps.length - 1 && steps[k + 1].s <= s) k++;
  const st = steps[k];
  let v = cruise ?? (st.duration > 0 ? st.distance / st.duration : 12);
  v = Math.max(6, Math.min(cruise != null ? 45 : 33, v));
  const next = steps[k + 1];
  if (next) {
    const d = next.s - s;
    const slow = next.type === 'turn' || next.type === 'end of road' || next.type === 'roundabout' || next.type === 'rotary' || next.type === 'arrive';
    if (slow && d < 70) v = Math.min(v, 7 + d * 0.08);
  }
  return v;
}

/** Drives along the route at the router's speeds (times a factor), slowing for turns. */
/**
 * The tired driver's drift across the lane at time t (s): over 7.5 s it creeps from one side to
 * the other (1.8 m each side when clearly tired), then is pulled back in 1.5 s. Returns the
 * offset (m) and how fast it changes (m/s).
 */
export function tiredDrift(t: number, tired: number): [number, number] {
  const A = 1.8 * tired;
  const ph = ((t % 9) + 9) % 9;
  if (ph < 7.5) return [-A + (2 * A * ph) / 7.5, (2 * A) / 7.5];
  return [A - (2 * A * (ph - 7.5)) / 1.5, (-2 * A) / 1.5];
}

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
  /**
   * A driver who drives to the speed limit and now and then creeps over it, to try the speed
   * alerts: below it, then near it, then a little over it, in turn every 2.4 km.
   */
  speeding = false;
  /** The speed limit at a position (km/h), for the speeding driver. */
  limitAt: ((s: number) => number | null) | null = null;
  /**
   * A tired driver, to try the tiredness warning (0: none, 1: clearly tired): drifting slowly
   * across the lane and correcting sharply, and letting the speed swing.
   */
  tired = 0;
  private tiredT = 0;
  /** The speed now (m/s): the speeding driver speeds up and slows down gradually. */
  private v = -1;
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

  private speedAt(s: number, dt = 0): number {
    const v = this.limitedSpeedAt(s, dt);
    // The tired driver's speed swings by about 8 % over 40 seconds.
    return this.tired > 0 ? v * (1 + 0.08 * this.tired * Math.sin((2 * Math.PI * this.tiredT) / 40)) : v;
  }

  private limitedSpeedAt(s: number, dt = 0): number {
    const limit = this.speeding ? this.limitAt?.(s) ?? null : null;
    if (limit == null) {
      this.v = -1;
      return simSpeedAt(this.route, s);
    }
    const phase = (s % 2400) / 2400;
    const target = (limit + (phase < 0.35 ? -12 : phase < 0.6 ? -3 : phase < 0.8 ? 7 : -8)) / 3.6;
    const want = simSpeedAt(this.route, s, target);
    if (this.v < 0) this.v = want;
    // About 2 m/s² either way, faster when braking for a turn.
    const rate = (want < this.v ? 3.5 : 2) * dt * this.factor;
    this.v += Math.max(-rate, Math.min(rate, want - this.v));
    return this.v;
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
    this.tiredT += dt * this.factor;
    const v = this.speedAt(this.s, dt);
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
    const [drift, rate] = this.tired > 0 ? tiredDrift(this.tiredT, this.tired) : [0, 0];
    const offset = (this.laneF - (this.laneCount - 1) / 2) * LANE_W + drift;
    this.onFix?.({
      lngLat: Math.abs(offset) > 0.01 ? destination(line.pointAt(this.s), brg + 90, offset) : line.pointAt(this.s),
      accuracy: 3,
      heading: v > 1 && rate ? (brg + (Math.atan2(rate, v) * 180) / Math.PI + 360) % 360 : brg,
      speed: v,
      time: Date.now(),
    });
  }

  jumpTo(s: number) {
    this.s = Math.max(0, Math.min(this.route.line.length, s));
    this.v = -1;
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
import { CloudError, pickCloudVoice, type CloudProblem, type CloudTts } from '../voice/cloud';

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

/** Names that mark the newer, more human voices (Edge and Windows "Natural", Apple "Enhanced" and "Premium"...). */
const HUMAN = /natural|neural|premium|enhanced|wavenet|studio|journey|chirp/i;
/** Old robotic and novelty voices. */
const ROBOTIC = /\b(compact|espeak|pico|eloquence|albert|bad news|bahh|bells|boing|bubbles|cellos|good news|jester|organ|superstar|trinoids|whisper|wobble|zarvox|fred|ralph|kathy|junior)\b/i;

/** How human a voice sounds, from its name: above 0 for the natural voices, below for robotic ones. */
export function voiceQuality(v: Pick<VoiceInfo, 'id' | 'label'>): number {
  const n = `${v.id} ${v.label}`;
  return (HUMAN.test(n) ? 2 : 0) - (ROBOTIC.test(n) ? 3 : 0);
}

/**
 * The voices for a language: its own region first, then the same language elsewhere; within
 * each, the most human-sounding first. Voices that need internet come after offline ones of the
 * same quality (and last of all without internet). On the phone, offline voices stay first since
 * they start at once even on a weak signal.
 */
export function voicesFor(voices: VoiceInfo[], lang: string, opts: { online?: boolean; native?: boolean } = {}): VoiceInfo[] {
  const want = normLang(lang);
  const base = want.slice(0, 2);
  const online = opts.online ?? (typeof navigator === 'undefined' || navigator.onLine !== false);
  const native = opts.native ?? NATIVE;
  const away = online ? (native ? 2.5 : 0.5) : 8;
  const rank = (v: VoiceInfo) => (normLang(v.lang) === want ? 0 : 20) + (v.local ? 0 : away) - voiceQuality(v);
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
  return { voice: null, pitch: MALE_FALLBACK_PITCH };
}

/** With no man's voice for a language, the usual voice this much lower (lower still sounds processed). */
export const MALE_FALLBACK_PITCH = 0.86;

/** Something waiting to be said in Google's voice. */
interface CloudItem {
  text: string;
  lang: string;
  choice: VoiceChoice;
  audio: Promise<ArrayBuffer | null>;
  gen: number;
}

/** About how long a text takes to say, as a limit on waiting for the phone's voice to finish. */
const sayingTime = (text: string) => Math.min(30_000, 2500 + text.length * 95);

export class Voice {
  enabled = true;
  /** Which voice to speak with (from Settings). */
  choice: VoiceChoice = { gender: 'female', id: '' };
  /** The phone's own voices, or Google's natural voices (Settings). */
  engine: 'phone' | 'google' = 'phone';
  /** Google's voices, when set up. */
  cloud: CloudTts | null = null;
  /** The Google voice chosen in Settings ('' for the best one for the language and gender). */
  cloudName = '';
  /** Told once when Google's voice cannot be used (key, API not enabled, billing). */
  onCloudProblem: ((p: CloudProblem) => void) | null = null;
  /** Google's voice failed for a reason that will not go away by itself: the phone speaks until Settings change. */
  private cloudOff: CloudProblem | null = null;
  private unlocked = false;
  private audio: AudioContext | null = null;
  private nativeVoices: Promise<VoiceInfo[]> | null = null;
  private queue: CloudItem[] = [];
  private busy = false;
  private gen = 0;
  private genSignal = Voice.signal();
  private source: AudioBufferSourceNode | HTMLAudioElement | null = null;

  private static signal(): { done: Promise<'stale'>; fire: () => void } {
    let fire = () => {};
    const done = new Promise<'stale'>((ok) => (fire = () => ok('stale')));
    return { done, fire };
  }

  /** Try Google's voice again (the key or the voice settings changed). */
  resetCloud() {
    this.cloudOff = null;
  }

  /** Google's voice is what speaks now. */
  get usingCloud(): boolean {
    return this.engine === 'google' && !!this.cloud?.hasKey && !this.cloudOff;
  }

  /** Android: opens the phone's speech settings to add voices (Speech Services by Google's voice data). */
  async installVoices(): Promise<boolean> {
    if (!NATIVE) return false;
    try {
      await (await ttsModule()).TextToSpeech.openInstall();
      this.nativeVoices = null;
      return true;
    } catch {
      return false;
    }
  }

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

  /**
   * The speed alert sounds: one soft tone near the limit, three quick high beeps over it, and a
   * falling pair before a speed camera; and to wake a tired driver, a bright rising run, twice.
   */
  alert(kind: 'near' | 'over' | 'camera' | 'wake') {
    if (!this.enabled || !this.audio) return;
    const ctx = this.audio;
    const t0 = ctx.currentTime + 0.02;
    const tones: [number, number, number][] =
      kind === 'near'
        ? [[740, 0, 0.32]]
        : kind === 'over'
          ? [[1320, 0, 0.11], [1320, 0.16, 0.11], [1320, 0.32, 0.11]]
          : kind === 'wake'
            ? [[660, 0, 0.12], [880, 0.14, 0.12], [1320, 0.28, 0.2], [660, 0.62, 0.12], [880, 0.76, 0.12], [1320, 0.9, 0.24]]
            : [[1175, 0, 0.16], [880, 0.2, 0.22]];
    for (const [f, at, len] of tones) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      o.type = kind === 'over' || kind === 'wake' ? 'square' : 'sine';
      const vol = kind === 'over' ? 0.12 : kind === 'wake' ? 0.14 : 0.24;
      g.gain.setValueAtTime(0.0001, t0 + at);
      g.gain.exponentialRampToValueAtTime(vol, t0 + at + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + at + len);
      o.connect(g).connect(ctx.destination);
      o.start(t0 + at);
      o.stop(t0 + at + len + 0.02);
    }
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
    if (!this.enabled || !text) return;
    if (this.usingCloud) return this.cloudSpeak(text, lang, urgent, choice);
    void this.phoneSpeak(text, lang, urgent, choice);
  }

  /**
   * Fetches Google's audio for texts that are about to be said (the next turns' "now" prompts),
   * so they play the moment they are due.
   */
  prefetch(texts: string[], lang: string, choice: VoiceChoice = this.choice) {
    if (!this.usingCloud || (typeof navigator !== 'undefined' && navigator.onLine === false)) return;
    const cloud = this.cloud!;
    void texts
      .filter(Boolean)
      .reduce<Promise<unknown>>(
        (chain, text) =>
          chain.then(() =>
            cloud
              .voices(lang)
              .then((vs) => pickCloudVoice(vs, lang, choice.gender, this.cloudName))
              .then((v) => (v ? cloud.synth(text, v, lang) : null))
              .catch((e) => this.cloudFailed(e)),
          ),
        Promise.resolve(),
      );
  }

  /**
   * Settings' Test voice with Google's voice: says the text and tells which voice spoke, or why
   * Google's voice could not (the phone's voice says it then).
   */
  async testCloud(text: string, lang: string, choice: VoiceChoice): Promise<{ voice: string | null; problem: CloudProblem | null }> {
    this.resetCloud();
    this.stopAll();
    const cloud = this.cloud;
    try {
      if (!cloud?.hasKey) throw new CloudError('key', 'No Google key');
      const v = pickCloudVoice(await cloud.voices(lang), lang, choice.gender, this.cloudName);
      if (!v) throw new CloudError('api', `No Google voice for ${lang}`);
      const buf = await cloud.synth(text, v, lang);
      if (!(await this.play(buf, this.gen))) throw new CloudError('network', 'Could not play');
      return { voice: v.name, problem: null };
    } catch (e) {
      void this.phoneSpeak(text, lang, true, choice);
      return { voice: null, problem: e instanceof CloudError ? e.problem : 'network' };
    }
  }

  private cloudFailed(e: unknown) {
    if (!(e instanceof CloudError) || e.problem === 'network' || this.cloudOff) return;
    this.cloudOff = e.problem;
    console.warn('[voice] Google voice off:', e.message);
    this.onCloudProblem?.(e.problem);
  }

  /** Google's voice: urgent prompts clear the queue and cut in; the rest play in turn. */
  private cloudSpeak(text: string, lang: string, urgent: boolean, choice: VoiceChoice) {
    if (urgent) this.stopAll();
    // Waits this long for the audio (fetching starts now), then the phone's voice says it.
    const wait = urgent ? 1500 : 3500;
    const cloud = this.cloud!;
    const work = cloud
      .voices(lang)
      .then((vs) => {
        const v = pickCloudVoice(vs, lang, choice.gender, this.cloudName);
        if (!v) throw new CloudError('api', `No Google voice for ${lang}`);
        return cloud.synth(text, v, lang);
      })
      .catch((e) => {
        this.cloudFailed(e);
        return null;
      });
    const audio = Promise.race([work, new Promise<null>((ok) => setTimeout(() => ok(null), wait))]);
    this.queue.push({ text, lang, choice, audio, gen: this.gen });
    void this.pump();
  }

  private async pump() {
    if (this.busy) return;
    this.busy = true;
    try {
      while (this.queue.length) {
        const item = this.queue.shift()!;
        if (item.gen !== this.gen) continue;
        const buf = await Promise.race([item.audio, this.genSignal.done]);
        if (buf === 'stale' || item.gen !== this.gen) continue;
        if (buf && (await this.play(buf, item.gen))) continue;
        if (item.gen !== this.gen) continue;
        await this.phoneSpeak(item.text, item.lang, false, item.choice);
      }
    } finally {
      this.busy = false;
    }
  }

  /** Plays MP3 audio to the end (false when it cannot be played). */
  private async play(buf: ArrayBuffer, gen: number): Promise<boolean> {
    try {
      const ctx = this.audio;
      if (ctx) {
        if (ctx.state === 'suspended') await ctx.resume().catch(() => {});
        const decoded = await ctx.decodeAudioData(buf.slice(0));
        if (gen !== this.gen) return true;
        return await new Promise<boolean>((ok) => {
          const src = ctx.createBufferSource();
          src.buffer = decoded;
          src.connect(ctx.destination);
          src.onended = () => {
            if (this.source === src) this.source = null;
            ok(true);
          };
          this.source = src;
          src.start();
        });
      }
      const url = URL.createObjectURL(new Blob([buf], { type: 'audio/mpeg' }));
      const el = new Audio(url);
      this.source = el;
      return await new Promise<boolean>((ok) => {
        const done = (played: boolean) => {
          URL.revokeObjectURL(url);
          if (this.source === el) this.source = null;
          ok(played);
        };
        el.onended = () => done(true);
        el.onerror = () => done(false);
        el.play().catch(() => done(false));
      });
    } catch {
      return false;
    }
  }

  /** The phone's (or browser's) own voice; resolves once it has finished speaking. */
  private phoneSpeak(text: string, lang: string, urgent: boolean, choice: VoiceChoice): Promise<void> {
    const limit = new Promise<void>((ok) => setTimeout(ok, sayingTime(text)));
    if (NATIVE) {
      // Flush (0) cuts off what is playing, Add (1) queues.
      const said = Promise.all([ttsModule(), this.voices()])
        .then(async ([m, voices]) => {
          const { voice, pitch } = pickVoice(voices, lang, choice);
          const opts = { text, lang, rate: 1.0, pitch, queueStrategy: urgent ? 0 : 1 };
          try {
            await m.TextToSpeech.speak({ ...opts, ...(voice ? { voice: voice.index } : {}) });
          } catch (e) {
            // A voice that needs internet without it, or one removed since: the phone's default voice.
            if (!voice) throw e;
            await m.TextToSpeech.speak(opts);
          }
        })
        .catch((e) => console.warn('[voice]', e));
      return Promise.race([said, limit]);
    }
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return Promise.resolve();
    const synth = window.speechSynthesis;
    if (urgent) synth.cancel();
    const u = new SpeechSynthesisUtterance(text);
    u.lang = lang;
    const all = synth.getVoices();
    const infos = all.map((v, index) => ({ id: v.voiceURI || v.name, label: v.name, lang: v.lang, gender: voiceGender(`${v.name} ${v.voiceURI}`), index, local: v.localService }));
    const { voice, pitch } = pickVoice(infos, lang, choice);
    if (voice) u.voice = all[voice.index];
    u.pitch = pitch;
    u.rate = 1.0;
    const said = new Promise<void>((ok) => {
      u.onend = () => ok();
      u.onerror = () => ok();
    });
    synth.speak(u);
    return Promise.race([said, limit]);
  }

  /** Clears what is waiting and cuts off what is playing. */
  private stopAll() {
    this.gen++;
    this.genSignal.fire();
    this.genSignal = Voice.signal();
    this.queue = [];
    const s = this.source;
    this.source = null;
    if (s instanceof HTMLAudioElement) {
      s.pause();
      s.dispatchEvent(new Event('ended'));
    } else if (s) {
      try {
        s.stop();
      } catch {
        /* already stopped */
      }
    }
    this.stopPhone();
  }

  private stopPhone() {
    if (NATIVE) {
      if (nativeTts) void nativeTts.then((m) => m.TextToSpeech.stop()).catch(() => {});
      return;
    }
    if (typeof window !== 'undefined') window.speechSynthesis?.cancel();
  }

  /** Stops speaking at once (voice turned off, navigation ended). */
  stop() {
    this.stopAll();
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
