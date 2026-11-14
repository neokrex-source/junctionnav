import { describe, expect, it } from 'vitest';
import { AlertWatch, BehaviourWatch, BREAK_MS, minuteStat, type AlertEvent, type AlertSample } from '../src/nav/alert';
import { tiredDrift } from '../src/nav/sources';
import { TalkDeck, shuffled } from '../src/talk/deck';
import { drivenWords, drowsySpeech, limitSpeech, remindSpeech, talkLead } from '../src/talk/speech';
import { EN_TALK } from '../src/talk/en';
import { MS_TALK } from '../src/talk/ms';
import { JA_TALK } from '../src/talk/ja';
import { TALK_TOPICS, type TalkSet } from '../src/talk/types';
import { SpeedWatch } from '../src/nav/speedWatch';

const MIN = 60_000;

/** A seeded random number generator, so the noise is the same every run. */
function rand(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), a | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-9)) * Math.cos(2 * Math.PI * r());

/** Drives for `ms` from `from`, a sample a second, collecting the events with their time. */
function drive(w: AlertWatch, from: number, ms: number, x: Partial<AlertSample> = {}, step = 1000) {
  const out: { t: number; ev: AlertEvent }[] = [];
  for (let t = from; t < from + ms; t += step) {
    for (const ev of w.update({ now: t, hour: 14, speed: 30, steady: false, lateral: null, headingDev: null, quiet: true, ...x })) out.push({ t, ev });
  }
  return out;
}

describe('the driving clock and break reminders', () => {
  it('says it is time for a break at the focus limit, then again every 15 minutes, more firmly', () => {
    const w = new AlertWatch();
    w.config = { focusMin: 120, talk: 'off', detect: false };
    const evs = drive(w, 0, 200 * MIN);
    const reminders = evs.filter((e) => e.ev.kind === 'limit' || e.ev.kind === 'remind');
    expect(reminders[0].ev.kind).toBe('limit');
    expect(reminders[0].t / MIN).toBeCloseTo(120, 0);
    const later = reminders.slice(1);
    expect(later.map((e) => Math.round(e.t / MIN))).toEqual([135, 150, 165, 180, 195]);
    expect(later.map((e) => (e.ev as { level: number }).level)).toEqual([1, 2, 2, 3, 3]);
  });

  it('comes a quarter sooner between midnight and 6 am, and every 10 minutes after', () => {
    const w = new AlertWatch();
    w.config = { focusMin: 120, talk: 'off', detect: false };
    const evs = drive(w, 0, 115 * MIN, { hour: 3 }).filter((e) => e.ev.kind === 'limit' || e.ev.kind === 'remind');
    expect(Math.round(evs[0].t / MIN)).toBe(90);
    expect(Math.round(evs[1].t / MIN)).toBe(100);
  });

  it('a stop of 15 minutes is a break; a shorter one is not', () => {
    const w = new AlertWatch();
    w.config = { focusMin: 120, talk: 'off', detect: false };
    drive(w, 0, 60 * MIN);
    // Ten minutes in a jam: still counting.
    drive(w, 60 * MIN, 10 * MIN, { speed: 0 });
    expect(w.driven / MIN).toBeCloseTo(70, 0);
    drive(w, 70 * MIN, 30 * MIN);
    // A proper break.
    const rest = drive(w, 100 * MIN, 16 * MIN, { speed: 0 });
    expect(rest.some((e) => e.ev.kind === 'rested')).toBe(true);
    expect(w.driven).toBe(0);
    const evs = drive(w, 116 * MIN, 130 * MIN).filter((e) => e.ev.kind === 'limit');
    expect(Math.round(evs[0].t / MIN)).toBe(116 + 120);
  });

  it('carries on across drives less than a break apart, and starts again after a break', () => {
    const w = new AlertWatch();
    drive(w, 0, 50 * MIN);
    const snap = w.snapshot(1_000_000);
    w.resume(snap, 1_000_000 + 5 * MIN);
    expect(w.driven / MIN).toBeCloseTo(55, 0);
    w.resume(snap, 1_000_000 + BREAK_MS + 1000);
    expect(w.driven).toBe(0);
    w.resume(null, 0);
    expect(w.driven).toBe(0);
  });

  it('waits for a quiet moment to say it, but not longer than a minute and a half', () => {
    const w = new AlertWatch();
    w.config = { focusMin: 60, talk: 'off', detect: false };
    drive(w, 0, 60 * MIN - 1000, { quiet: true });
    const busy = drive(w, 60 * MIN, 30_000, { quiet: false });
    expect(busy.length).toBe(0);
    const now = drive(w, 60 * MIN + 30_000, 5000, { quiet: true });
    expect(now.map((e) => e.ev.kind)).toEqual(['limit']);
    const w2 = new AlertWatch();
    w2.config = { focusMin: 60, talk: 'off', detect: false };
    const never = drive(w2, 0, 62 * MIN, { quiet: false }).filter((e) => e.ev.kind === 'limit');
    expect(Math.round((never[0].t - 60 * MIN) / 1000)).toBeLessThanOrEqual(91);
  });

  it('has no reminders with the limit off', () => {
    const w = new AlertWatch();
    w.config = { focusMin: 0, talk: 'tired', detect: false };
    expect(drive(w, 0, 300 * MIN, {}, 5000).length).toBe(0);
  });
});

describe('talking to keep the driver awake', () => {
  it('when tired: after the break is due, every 6 minutes or so between the reminders', () => {
    const w = new AlertWatch();
    w.config = { focusMin: 60, talk: 'tired', detect: false };
    const evs = drive(w, 0, 100 * MIN);
    const talk = evs.filter((e) => e.ev.kind === 'talk');
    expect(talk.every((e) => e.t >= 60 * MIN)).toBe(true);
    expect(talk.length).toBeGreaterThanOrEqual(5);
    expect(talk.length).toBeLessThanOrEqual(8);
    // Never on top of a reminder.
    const said = evs.map((e) => e.t);
    for (let i = 1; i < said.length; i++) expect(said[i] - said[i - 1]).toBeGreaterThanOrEqual(45_000);
  });

  it('often: also every 20 minutes from 45 minutes in', () => {
    const w = new AlertWatch();
    w.config = { focusMin: 120, talk: 'often', detect: false };
    const talk = drive(w, 0, 110 * MIN).filter((e) => e.ev.kind === 'talk');
    expect(talk.map((e) => Math.round(e.t / MIN))).toEqual([45, 65, 85, 105]);
  });

  it('off: never', () => {
    const w = new AlertWatch();
    w.config = { focusMin: 30, talk: 'off', detect: false };
    expect(drive(w, 0, 120 * MIN, {}, 2000).some((e) => e.ev.kind === 'talk')).toBe(false);
  });

  it('only when quiet and moving', () => {
    const w = new AlertWatch();
    w.config = { focusMin: 30, talk: 'tired', detect: false };
    drive(w, 0, 32 * MIN);
    expect(drive(w, 32 * MIN, 20 * MIN, { quiet: false }).some((e) => e.ev.kind === 'talk')).toBe(false);
    expect(drive(w, 52 * MIN, 5 * MIN, { speed: 0 }).some((e) => e.ev.kind === 'talk')).toBe(false);
  });
});

describe('signs of tiredness from the driving', () => {
  /** Highway driving with phone-like GPS noise; tired from `tiredFrom` minutes, lane changes every `laneEvery` minutes. */
  function highway(minutes: number, opts: { tiredFrom?: number; laneEvery?: number; seed?: number; night?: boolean } = {}) {
    const w = new AlertWatch();
    w.config = { focusMin: 0, talk: 'off', detect: true };
    const r = rand(opts.seed ?? 7);
    let gpsDrift = 0;
    let lane = 0;
    const events: { t: number; ev: AlertEvent }[] = [];
    for (let t = 0; t < minutes * MIN; t += 1000) {
      const m = t / MIN;
      if (opts.laneEvery && Math.floor(m) % opts.laneEvery === 0 && t % MIN === 20_000) lane = lane ? 0 : 3.5;
      // GPS error wanders slowly (about a metre), plus a little jitter.
      gpsDrift += -gpsDrift * 0.02 + gauss(r) * 0.12;
      const tired = opts.tiredFrom != null && m >= opts.tiredFrom ? 1 : 0;
      const [drift, rate] = tired ? tiredDrift(t / 1000, 1) : [0, 0];
      const v = 30 * (1 + (tired ? 0.08 * Math.sin((2 * Math.PI * t) / 40_000) : 0)) + gauss(r) * 0.25;
      const lat = lane + drift + gpsDrift + gauss(r) * 0.25;
      const hd = (Math.atan2(rate, v) * 180) / Math.PI + gauss(r) * 0.5;
      for (const ev of w.update({ now: t, hour: opts.night ? 3 : 14, speed: v, steady: true, lateral: lat, headingDev: hd, quiet: true })) events.push({ t, ev });
    }
    return { w, events: events.filter((e) => e.ev.kind === 'drowsy') };
  }

  it('learns the driver’s normal from the first minutes, and stays quiet on a steady drive', () => {
    for (const seed of [1, 2, 3, 4, 5]) {
      const { w, events } = highway(90, { seed });
      expect(w.behaviour.base).not.toBeNull();
      expect(events).toEqual([]);
    }
  });

  it('stays quiet through ordinary lane changes', () => {
    const { events } = highway(90, { laneEvery: 3 });
    expect(events).toEqual([]);
  });

  it('warns within a few minutes of drifting and correcting, with an unsteady speed', () => {
    const { events } = highway(40, { tiredFrom: 20 });
    expect(events.length).toBeGreaterThanOrEqual(1);
    const first = events[0];
    expect(first.t / MIN).toBeGreaterThan(20);
    expect(first.t / MIN).toBeLessThan(26);
    const signs = (first.ev as { signs: string[] }).signs;
    expect(signs).toContain('wander');
  });

  it('waits ten minutes before warning again', () => {
    const { events } = highway(60, { tiredFrom: 20 });
    for (let i = 1; i < events.length; i++) expect(events[i].t - events[i - 1].t).toBeGreaterThanOrEqual(10 * MIN);
  });

  it('needs its baseline first: tired from the start is caught by the clock, not by this', () => {
    const { events } = highway(6, { tiredFrom: 0 });
    expect(events).toEqual([]);
  });

  it('reads a minute of driving: drift taken out, a lane change left out', () => {
    const pts = Array.from({ length: 60 }, (_, i) => ({ t: i * 1000, lat: i * 0.02, hd: 0, v: 30 }));
    expect(minuteStat(pts).wander).toBeCloseTo(0, 5);
    const change = Array.from({ length: 60 }, (_, i) => ({ t: i * 1000, lat: i < 30 ? 0 : 3.5, hd: 0, v: 30 }));
    expect(minuteStat(change).wander).toBeNull();
    const slow = Array.from({ length: 60 }, (_, i) => ({ t: i * 1000, lat: 0, hd: 0, v: 10 }));
    expect(minuteStat(slow).speed).toBeNull();
  });

  it('a non-steady stretch (a turn, traffic) cuts the minute short', () => {
    const b = new BehaviourWatch();
    for (let t = 0; t < 30_000; t += 1000) b.add(t, 30, true, 0, 0, false);
    b.add(31_000, 30, false, null, null, false);
    expect(b.recent.length).toBe(0);
  });
});

describe('the talk', () => {
  it('has 1,000 things to say in English and 200 each in Malay and Japanese, none twice', () => {
    const count = (s: TalkSet) => TALK_TOPICS.reduce((a, t) => a + s[t].length, 0);
    expect(count(EN_TALK)).toBe(1000);
    expect(count(MS_TALK)).toBe(200);
    expect(count(JA_TALK)).toBe(200);
    for (const set of [EN_TALK, MS_TALK, JA_TALK]) {
      const all = TALK_TOPICS.flatMap((t) => set[t].map((x) => (typeof x === 'string' ? x : x[0])));
      expect(new Set(all).size).toBe(all.length);
      // Short enough to say at a quiet moment, and no em dashes for the voice to stumble on.
      for (const x of all) {
        expect(x.length).toBeLessThan(260);
        expect(x).not.toContain('—');
      }
    }
  });

  it('says every item once before any comes again, and remembers where it was', () => {
    const store = new Map<string, string>();
    const st = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => void store.set(k, v) };
    const set: TalkSet = { ...EN_TALK, jokes: ['a', 'b', 'c'], riddles: [['q1', 'a1']], malaysia: [], world: [], cars: [], animals: [], lifehacks: [], science: [] };
    const deck = new TalkDeck({ en: set }, st, rand(3));
    const first = [0, 1, 2, 3].map(() => deck.next('en', TALK_TOPICS)!);
    const texts = first.map((p) => (typeof p.item === 'string' ? p.item : p.item[0]));
    expect(new Set(texts).size).toBe(4);
    // A new deck on the same storage carries on: the fifth is the start of a new round.
    const again = new TalkDeck({ en: set }, st, rand(4));
    expect(again.next('en', TALK_TOPICS)).not.toBeNull();
    // Only the chosen topics.
    for (let i = 0; i < 6; i++) expect(deck.next('en', ['riddles'])!.topic).toBe('riddles');
    expect(deck.next('en', [])).toBeNull();
  });

  it('falls back to English for a language it has no set for', () => {
    const deck = new TalkDeck({ en: EN_TALK }, null, rand(1));
    expect(deck.next('ms', ['jokes'])!.topic).toBe('jokes');
  });

  it('shuffles the same way from the same seed', () => {
    expect(shuffled(10, 42)).toEqual(shuffled(10, 42));
    expect(shuffled(10, 42).sort((a, b) => a - b)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
  });

  it('words the reminders in English, Malay and Japanese', () => {
    expect(drivenWords(125 * MIN, 'en')).toBe('2 hours 5 minutes');
    expect(drivenWords(60 * MIN, 'en')).toBe('1 hour');
    expect(drivenWords(152 * MIN, 'ms')).toBe('2 jam 30 minit');
    expect(drivenWords(90 * MIN, 'ja')).toBe('1時間30分');
    const rest = { name: 'R&R Ayer Keroh', dist: 14_000 };
    expect(limitSpeech(120 * MIN, rest, 'en', 'metric')).toBe('You have been driving for 2 hours. Time for a break of at least 15 minutes. The next rest area, R&R Ayer Keroh, is in 14 kilometres.');
    expect(limitSpeech(120 * MIN, null, 'ms', 'metric')).toBe('Anda telah memandu selama 2 jam. Masa untuk berehat sekurang-kurangnya 15 minit. Berhenti di kawasan rehat seterusnya atau tempat yang selamat.');
    expect(remindSpeech(185 * MIN, 3, null, 'en', 'metric')).toContain('Please stop and rest now');
    expect(drowsySpeech(['wander'], 'ja', null, 'metric')).toContain('ふらついて');
    expect(talkLead('jokes', 'en', 6)).toBe('A quick one for you.');
  });
});

describe('the speed limit guide on highways and other roads', () => {
  const info = { limits: [{ s0: 0, s1: 1000, kmh: 110, src: 'osm' as const }, { s0: 1000, s1: 2000, kmh: 60, src: 'osm' as const }], cameras: [], checks: [] };

  it('can be on for highways only, or for other roads only', () => {
    const w = new SpeedWatch();
    w.info = info;
    w.highway = false;
    expect(w.update(500, 31, 0, true).limit).toBeNull();
    expect(w.update(1500, 17, 1000, false).limit?.kmh).toBe(60);
    w.highway = true;
    w.town = false;
    expect(w.update(500, 31, 2000, true).limit?.kmh).toBe(110);
    expect(w.update(1500, 17, 3000, false).limit).toBeNull();
    expect(w.prompts(w.update(1500, 25, 4000, false), 1500, 6000, false)).toEqual([]);
  });

  it('counts a road as a highway from the router’s motorway class too', () => {
    const w = new SpeedWatch();
    w.info = { limits: [{ s0: 0, s1: 1000, kmh: 80, src: 'osm' }], cameras: [], checks: [] };
    w.town = false;
    expect(w.update(500, 20, 0, true).limit).toBeNull();
    w.highwayAt = () => true;
    expect(w.update(500, 20, 1000, true).limit?.kmh).toBe(80);
  });
});
