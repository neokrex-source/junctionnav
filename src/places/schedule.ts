/**
 * When the places around you are brought up to date: on the schedule chosen in Settings (monthly
 * by default), as soon as you are in a new area (half the chosen distance from where they were
 * last fetched), when the distance setting changes, and never while a download would not suit
 * (no position yet, a failed try less than six hours ago, mobile data when Wi-Fi only is on).
 */
import { metres } from './format';

export type PlacesUpdate = 'weekly' | 'biweekly' | 'monthly' | 'quarterly' | 'manual';

export const UPDATE_DAYS: Record<PlacesUpdate, number> = { weekly: 7, biweekly: 14, monthly: 30, quarterly: 91, manual: Infinity };

export const UPDATE_LABELS: [PlacesUpdate, string][] = [
  ['weekly', 'Every week'],
  ['biweekly', 'Every 2 weeks'],
  ['monthly', 'Every month'],
  ['quarterly', 'Every 3 months'],
  ['manual', 'Only when I tap Update now'],
];

/** What is on the device. */
export interface PlacesState {
  center: [number, number];
  radiusKm: number;
  /** When the last update finished (ms). */
  updatedAt: number;
  /** When the data itself was built on the server. */
  built: string;
  sources: { overture?: string; osm?: string };
  count: number;
  cells: number;
  bytes: number;
  /** The town the area is around, when the data names one. */
  area: string | null;
}

export type DueReason = 'first' | 'schedule' | 'moved' | 'radius';

export const RETRY_AFTER = 6 * 3600_000;

export function updateDue(
  st: PlacesState | null,
  o: { now: number; every: PlacesUpdate; radiusKm: number; pos: [number, number] | null; lastTry: number },
): DueReason | null {
  if (o.every === 'manual' || !o.pos) return null;
  if (o.lastTry && o.now - o.lastTry < RETRY_AFTER) return null;
  if (!st) return 'first';
  if (st.radiusKm !== o.radiusKm) return 'radius';
  if (metres(st.center, o.pos) > o.radiusKm * 500) return 'moved';
  if (o.now - st.updatedAt >= UPDATE_DAYS[o.every] * 86_400_000) return 'schedule';
  return null;
}

interface NetInfo {
  type?: string;
  saveData?: boolean;
}

/**
 * Whether the connection suits an automatic update: Wi-Fi or a wired connection when Wi-Fi only
 * is on (browsers that do not say which, such as computers, count as fine), and not with the
 * phone's data saver on.
 */
export function connectionOk(wifiOnly: boolean, net: NetInfo | undefined = (globalThis.navigator as { connection?: NetInfo } | undefined)?.connection): boolean {
  if (net?.saveData) return false;
  if (!wifiOnly || !net?.type) return true;
  return net.type === 'wifi' || net.type === 'ethernet' || net.type === 'wimax' || net.type === 'unknown';
}
