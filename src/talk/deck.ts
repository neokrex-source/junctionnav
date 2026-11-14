/**
 * Picks the next joke, fact or riddle: every item once, in a shuffled order, before any comes
 * again, remembered between drives (per language), and only from the topics chosen in Settings.
 */
import type { LangCode } from '../routing/instructions';
import type { TalkItem, TalkSet, TalkTopic } from './types';
import { TALK_TOPICS } from './types';

export interface Picked {
  topic: TalkTopic;
  item: TalkItem;
  /** Its place in the whole list (for varying the lead-in). */
  n: number;
}

const KEY = 'junctionnav.talk.v1';

interface Stored {
  seed: number;
  count: number;
  pos: number;
}

/** A small seeded random number generator (mulberry32), so the order can be rebuilt from its seed. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 0..n-1 in an order from the seed, with topics mixed through. */
export function shuffled(n: number, seed: number): number[] {
  const r = rng(seed);
  const out = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export class TalkDeck {
  private flat = new Map<LangCode, { topic: TalkTopic; item: TalkItem }[]>();

  constructor(
    private sets: Partial<Record<LangCode, TalkSet>>,
    private storage: Pick<Storage, 'getItem' | 'setItem'> | null = typeof localStorage !== 'undefined' ? localStorage : null,
    private random: () => number = Math.random,
  ) {}

  /** The items in a language (English where the language has none). */
  private list(lang: LangCode) {
    const have = this.sets[lang] ? lang : 'en';
    let l = this.flat.get(have);
    if (!l) {
      const set = this.sets[have]!;
      l = TALK_TOPICS.flatMap((topic) => (set[topic] ?? []).map((item) => ({ topic, item })));
      this.flat.set(have, l);
    }
    return { lang: have, items: l };
  }

  count(lang: LangCode, topics: TalkTopic[] = TALK_TOPICS): number {
    return this.list(lang).items.filter((x) => topics.includes(x.topic)).length;
  }

  private load(lang: LangCode, count: number): Stored {
    try {
      const raw = this.storage?.getItem(`${KEY}.${lang}`);
      const s = raw ? (JSON.parse(raw) as Stored) : null;
      if (s && s.count === count && Number.isFinite(s.seed) && s.pos >= 0) return s;
    } catch {
      /* storage unavailable or damaged */
    }
    return { seed: Math.floor(this.random() * 2 ** 31), count, pos: 0 };
  }

  private save(lang: LangCode, s: Stored) {
    try {
      this.storage?.setItem(`${KEY}.${lang}`, JSON.stringify(s));
    } catch {
      /* storage unavailable */
    }
  }

  /** The next item from the chosen topics, or null when none are chosen. */
  next(lang: LangCode, topics: TalkTopic[]): Picked | null {
    const { lang: have, items } = this.list(lang);
    if (!items.length || !items.some((x) => topics.includes(x.topic))) return null;
    let st = this.load(have, items.length);
    let order = shuffled(items.length, st.seed);
    for (let tries = 0; tries < items.length * 2; tries++) {
      if (st.pos >= items.length) {
        // All said: a new order.
        st = { seed: Math.floor(this.random() * 2 ** 31), count: items.length, pos: 0 };
        order = shuffled(items.length, st.seed);
      }
      const n = order[st.pos++];
      if (topics.includes(items[n].topic)) {
        this.save(have, st);
        return { topic: items[n].topic, item: items[n].item, n };
      }
    }
    return null;
  }
}
