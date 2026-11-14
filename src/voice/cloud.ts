/**
 * Google's natural voices (Cloud Text-to-Speech), as an option beside the phone's own voices.
 * Uses the Google key from Settings (the Cloud Text-to-Speech API has to be enabled for it).
 * Each spoken text is fetched once and kept on the phone, so prompts heard before play at once
 * and work offline; anything not ready in time, or any error, falls back to the phone's voice.
 */

const API = 'https://texttospeech.googleapis.com/v1';
const CACHE = 'jn-voice-v1';

export interface CloudVoice {
  name: string;
  languageCodes: string[];
  ssmlGender: 'MALE' | 'FEMALE' | 'NEUTRAL' | 'SSML_VOICE_GENDER_UNSPECIFIED';
}

/** How natural a Google voice sounds: Chirp 3 HD best, then Neural2, WaveNet, Standard. 0: not for us. */
export function cloudTier(name: string): number {
  if (/-Chirp3-HD-/i.test(name)) return 5;
  if (/-Chirp-HD-/i.test(name)) return 4;
  if (/-Neural2-/i.test(name)) return 3;
  if (/-Wavenet-/i.test(name)) return 2;
  if (/-Standard-/i.test(name)) return 1;
  // Studio, News, Polyglot and Casual voices: priced or shaped for other uses.
  return 0;
}

/** Calm, clear voices first, for a composed assistant's manner (the Chirp 3 HD names). */
const CALM: Record<'male' | 'female', string[]> = {
  male: ['Charon', 'Iapetus', 'Algieba', 'Schedar', 'Rasalgethi', 'Orus'],
  female: ['Sulafat', 'Erinome', 'Kore', 'Achernar', 'Vindemiatrix', 'Aoede'],
};

/** The voices for a language, the most natural first, own region first within each kind. */
export function cloudVoicesFor(voices: CloudVoice[], lang: string): CloudVoice[] {
  const want = lang.toLowerCase();
  const base = want.slice(0, 2);
  const own = (v: CloudVoice) => v.languageCodes.some((c) => c.toLowerCase() === want);
  return voices
    .filter((v) => cloudTier(v.name) > 0 && v.languageCodes.some((c) => c.toLowerCase().startsWith(base)))
    .sort((a, b) => cloudTier(b.name) - cloudTier(a.name) || Number(own(b)) - Number(own(a)) || a.name.localeCompare(b.name));
}

/** The voice to use: the one chosen by name, else the most natural one of the gender asked for. */
export function pickCloudVoice(voices: CloudVoice[], lang: string, gender: 'male' | 'female', name = ''): CloudVoice | null {
  const list = cloudVoicesFor(voices, lang);
  if (name) {
    const v = list.find((x) => x.name === name);
    if (v) return v;
  }
  const g = gender === 'male' ? 'MALE' : 'FEMALE';
  const best = list.filter((v) => v.ssmlGender === g);
  if (!best.length) return list[0] ?? null;
  const top = cloudTier(best[0].name);
  const sameTier = best.filter((v) => cloudTier(v.name) === top);
  for (const calm of CALM[gender]) {
    const want = (lang.toLowerCase());
    const v = sameTier.find((x) => x.name.endsWith(`-${calm}`) && x.languageCodes.some((c) => c.toLowerCase() === want)) ?? sameTier.find((x) => x.name.endsWith(`-${calm}`));
    if (v) return v;
  }
  return sameTier[0];
}

/** Why Google's voice is not speaking. */
export type CloudProblem = 'key' | 'api' | 'billing' | 'network';

export class CloudError extends Error {
  constructor(
    readonly problem: CloudProblem,
    message: string,
  ) {
    super(message);
  }
}

function problemOf(status: number, body: string): CloudProblem {
  if (/SERVICE_DISABLED|has not been used|is disabled/i.test(body)) return 'api';
  if (/BILLING/i.test(body)) return 'billing';
  if (status === 400 || status === 401 || status === 403) return 'key';
  return 'network';
}

function hash(s: string): string {
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 16777619);
    h2 = Math.imul(h2 ^ c, 2246822519);
  }
  return (h1 >>> 0).toString(36) + (h2 >>> 0).toString(36);
}

function readKept(k: string): CloudVoice[] | null {
  try {
    const v = JSON.parse(localStorage.getItem(k) ?? 'null') as CloudVoice[] | null;
    return Array.isArray(v) && v.length ? v : null;
  } catch {
    return null;
  }
}

function base64ToBytes(b64: string): ArrayBuffer {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

export class CloudTts {
  private lists = new Map<string, Promise<CloudVoice[]>>();
  /** Recently spoken audio, kept in memory as well. */
  private recent = new Map<string, ArrayBuffer>();
  private pending = new Map<string, Promise<ArrayBuffer>>();

  constructor(
    private key: () => string,
    private fetchFn: typeof fetch = (...a) => fetch(...a),
  ) {}

  get hasKey(): boolean {
    return !!this.key();
  }

  /** Google's voices for a language (asked once per language and key). */
  voices(lang: string): Promise<CloudVoice[]> {
    const key = this.key();
    const id = `${key}|${lang.slice(0, 2)}`;
    let p = this.lists.get(id);
    if (!p) {
      p = (async () => {
        if (!key) throw new CloudError('key', 'No Google key');
        const kept = `jn-cloud-voices:${lang.slice(0, 2)}`;
        let res: Response;
        try {
          res = await this.fetchFn(`${API}/voices?languageCode=${encodeURIComponent(lang)}&key=${encodeURIComponent(key)}`);
        } catch (e) {
          // Offline: the list from last time, so audio fetched before still plays.
          const old = readKept(kept);
          if (old) return old;
          throw new CloudError('network', String(e));
        }
        const body = await res.text();
        if (!res.ok) throw new CloudError(problemOf(res.status, body), `Google voices ${res.status}`);
        const list = ((JSON.parse(body) as { voices?: CloudVoice[] }).voices ?? []).map((v) => ({ name: v.name, languageCodes: v.languageCodes, ssmlGender: v.ssmlGender }));
        try {
          localStorage.setItem(kept, JSON.stringify(list));
        } catch {
          /* not kept */
        }
        return list;
      })();
      this.lists.set(id, p);
      p.catch(() => this.lists.delete(id));
    }
    return p;
  }

  private cacheKey(voice: string, text: string): string {
    return `https://voice.cache/${voice}/${hash(text)}.mp3`;
  }

  /** Audio already on the phone for this text and voice (memory, then the phone's cache). */
  async cached(text: string, voice: string): Promise<ArrayBuffer | null> {
    const k = this.cacheKey(voice, text);
    const mem = this.recent.get(k);
    if (mem) return mem;
    try {
      if (typeof caches === 'undefined') return null;
      const hit = await (await caches.open(CACHE)).match(k);
      if (!hit) return null;
      const buf = await hit.arrayBuffer();
      this.remember(k, buf);
      return buf;
    } catch {
      return null;
    }
  }

  private remember(k: string, buf: ArrayBuffer) {
    this.recent.delete(k);
    this.recent.set(k, buf);
    while (this.recent.size > 80) this.recent.delete(this.recent.keys().next().value as string);
  }

  /** The text spoken in this voice, as MP3 (from the phone if it was fetched before). */
  synth(text: string, voice: CloudVoice, lang: string): Promise<ArrayBuffer> {
    const k = this.cacheKey(voice.name, text);
    const already = this.pending.get(k);
    if (already) return already;
    const p = (async () => {
      const hit = await this.cached(text, voice.name);
      if (hit) return hit;
      const key = this.key();
      if (!key) throw new CloudError('key', 'No Google key');
      let res: Response;
      try {
        res = await this.fetchFn(`${API}/text:synthesize?key=${encodeURIComponent(key)}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            input: { text },
            voice: { languageCode: voice.languageCodes.find((c) => c.toLowerCase() === lang.toLowerCase()) ?? voice.languageCodes[0] ?? lang, name: voice.name },
            audioConfig: { audioEncoding: 'MP3' },
          }),
        });
      } catch (e) {
        throw new CloudError('network', String(e));
      }
      const body = await res.text();
      if (!res.ok) throw new CloudError(problemOf(res.status, body), `Google voice ${res.status}`);
      const audio = (JSON.parse(body) as { audioContent?: string }).audioContent;
      if (!audio) throw new CloudError('network', 'No audio');
      const buf = base64ToBytes(audio);
      this.remember(k, buf);
      try {
        if (typeof caches !== 'undefined') await (await caches.open(CACHE)).put(k, new Response(buf.slice(0), { headers: { 'Content-Type': 'audio/mpeg' } }));
      } catch {
        /* kept in memory only */
      }
      return buf;
    })();
    this.pending.set(k, p);
    void p.then(
      () => this.pending.delete(k),
      () => this.pending.delete(k),
    );
    return p;
  }
}
