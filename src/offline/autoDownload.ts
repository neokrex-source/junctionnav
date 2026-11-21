/**
 * Getting the offline map for where you are without having to think of it: with it on the phone,
 * routes are planned on the phone when TomTom cannot answer, and everything keeps working with no
 * signal. In the Android app on Wi-Fi it downloads by itself; on mobile data, or in the browser,
 * the app asks once first ("Later" in the app waits for Wi-Fi).
 */
import { countryAt } from '../geo/countries';
import type { LngLat } from '../geo/geo';
import { packAt, type Catalog, type CatalogEntry, type JobState } from './store';

export type Connection = 'wifi' | 'cellular' | 'unknown';

export interface ConnectionInfo {
  type: Connection;
  /** The user asked the browser to save data. */
  saveData: boolean;
}

/** What the device says about its connection (the Network Information API, where it has one). */
export function connectionNow(): ConnectionInfo {
  const c = (typeof navigator !== 'undefined' ? (navigator as Navigator & { connection?: { type?: string; saveData?: boolean } }).connection : undefined) ?? undefined;
  const t = c?.type;
  const type: Connection = t === 'wifi' || t === 'ethernet' ? 'wifi' : t === 'cellular' || t === 'wimax' || t === 'bluetooth' ? 'cellular' : 'unknown';
  return { type, saveData: !!c?.saveData };
}

/** The download that covers a point: one for its country (the region it is in, for big ones). */
export function packHere(catalog: Catalog, p: LngLat): CatalogEntry | null {
  const c = countryAt(p);
  const mine = c ? catalog.packs.filter((e) => !e.countries?.length || e.countries.includes(c)) : catalog.packs;
  return packAt(mine, p) ?? (c ? null : packAt(catalog.packs, p));
}

/**
 * What happened before with a pack: started by itself on Wi-Fi ('auto', so it pauses on mobile
 * data and carries on back on Wi-Fi), downloaded because the user said so ('yes'), "Later, on
 * Wi-Fi" ('wifi') or "Not now" ('no'), and when.
 */
export interface AutoAnswer {
  answer: 'auto' | 'yes' | 'wifi' | 'no';
  at: number;
}

/** "Not now" holds for this long before the app asks again (ms). */
export const ASK_AGAIN = 30 * 24 * 3600_000;

export interface AutoInput {
  enabled: boolean;
  /** The device can keep offline maps. */
  supported: boolean;
  /** The Android app (downloads every pack; the browser only those published with the site). */
  native: boolean;
  position: LngLat | null;
  catalog: Catalog | null;
  installed: string[];
  jobs: Map<string, JobState>;
  answers: Record<string, AutoAnswer>;
  connection: ConnectionInfo;
  now: number;
}

export type AutoDecision =
  | { kind: 'none'; why: string }
  | { kind: 'download'; pack: CatalogEntry }
  | { kind: 'ask'; pack: CatalogEntry }
  /** A download the app started by itself, on mobile data now: wait for Wi-Fi. */
  | { kind: 'pause'; pack: CatalogEntry }
  /** That download, paused (mobile data, or the app was closed), back on Wi-Fi. */
  | { kind: 'resume'; pack: CatalogEntry };

export function autoDecision(x: AutoInput): AutoDecision {
  if (!x.enabled) return { kind: 'none', why: 'off' };
  if (!x.supported) return { kind: 'none', why: 'unsupported' };
  if (!x.position) return { kind: 'none', why: 'no position' };
  if (!x.catalog) return { kind: 'none', why: 'no catalog' };
  const pack = packHere(x.catalog, x.position);
  if (!pack) return { kind: 'none', why: 'no pack here' };
  if (x.installed.includes(pack.id)) return { kind: 'none', why: 'installed' };
  const said = x.answers[pack.id];
  const wifi = x.connection.type === 'wifi' && !x.connection.saveData;
  const job = x.jobs.get(pack.id);
  if (job) {
    // Started by hand, or failed: the Downloads list has it, and the user decides.
    if (said?.answer !== 'auto' || !x.native) return { kind: 'none', why: 'job' };
    const metered = x.connection.type === 'cellular' || x.connection.saveData;
    if (metered && (job.status === 'downloading' || job.status === 'queued')) return { kind: 'pause', pack };
    if (wifi && job.status === 'paused') return { kind: 'resume', pack };
    return { kind: 'none', why: 'job' };
  }
  if (!pack.web && !x.native) return { kind: 'none', why: 'app only' };
  if (x.native && wifi && said?.answer !== 'no') return { kind: 'download', pack };
  if (said?.answer === 'wifi') return { kind: 'none', why: 'waiting for wifi' };
  if (said?.answer === 'no' && x.now - said.at < ASK_AGAIN) return { kind: 'none', why: 'not now' };
  return { kind: 'ask', pack };
}
