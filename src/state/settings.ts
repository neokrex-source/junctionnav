import type { SignThemeId } from '../junction/signs';
import type { LangCode, Units } from '../routing/instructions';
import type { Avoid } from '../routing/types';
import type { JvMode } from '../ui/junctionPanel';

export interface Settings {
  mapStyle: string;
  customStyleUrl: string;
  maptilerKey: string;
  signTheme: 'auto' | SignThemeId;
  lang: LangCode;
  units: Units;
  voice: boolean;
  jvMode: JvMode;
  appearance: 'auto' | 'day' | 'night';
  routerUrl: string;
  overpassUrls: string;
  photonUrl: string;
  avoid: Avoid;
  simSpeed: number;
  /** Draw buildings, land use and place names around junctions (extra download per junction). */
  jvSurround: boolean;
  /** Lane advice before exits, entrances, junctions and turns; 'gps' also checks the current lane. */
  laneAlerts: 'gps' | 'advice' | 'off';
  /** Tunnel sign card and voice warning before tunnels. */
  tunnelAlerts: boolean;
}

const env = import.meta.env;

/** True in the self-contained build that runs inside a hosted preview page (no network, no GPS). */
export const ARTIFACT = env.VITE_ARTIFACT === '1';

/** Deployment defaults; override with VITE_* variables at build time (see README). */
export const DEFAULTS: Settings = {
  mapStyle: env.VITE_MAP_STYLE || 'ofm-liberty',
  customStyleUrl: env.VITE_CUSTOM_STYLE_URL || '',
  maptilerKey: env.VITE_MAPTILER_KEY || '',
  signTheme: 'auto',
  lang: 'en',
  units: 'metric',
  voice: true,
  jvMode: 'illustration',
  appearance: 'auto',
  routerUrl: env.VITE_ROUTER_URL || 'https://routing.openstreetmap.de/routed-car/route/v1/driving',
  overpassUrls:
    env.VITE_OVERPASS_URLS || 'https://overpass-api.de/api/interpreter\nhttps://overpass.kumi.systems/api/interpreter',
  photonUrl: env.VITE_PHOTON_URL || 'https://photon.komoot.io',
  avoid: { tolls: false, motorways: false, ferries: false },
  simSpeed: 1,
  jvSurround: true,
  laneAlerts: 'gps',
  tunnelAlerts: true,
};

const KEY = 'junctionnav.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings> & { avoidTolls?: boolean };
      const merged = { ...DEFAULTS, ...saved, avoid: { ...DEFAULTS.avoid, ...(saved.avoid ?? {}) } };
      if (saved.avoidTolls) merged.avoid.tolls = true; // older versions
      return merged;
    }
  } catch {
    /* storage unavailable */
  }
  return { ...DEFAULTS, avoid: { ...DEFAULTS.avoid } };
}

export function saveSettings(s: Settings) {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable */
  }
}

export function overpassList(s: Settings): string[] {
  return s.overpassUrls
    .split(/[\s,]+/)
    .map((u) => u.trim())
    .filter(Boolean);
}

export function isNight(s: Settings, now = new Date()): boolean {
  if (s.appearance === 'day') return false;
  if (s.appearance === 'night') return true;
  if (ARTIFACT) {
    // Follow the viewer's theme in the hosted preview.
    const t = document.documentElement.dataset.theme;
    if (t === 'dark' || t === 'light') return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  const h = now.getHours();
  return h >= 19 || h < 7;
}

const POS_KEY = 'junctionnav.lastpos';
export function lastPosition(): [number, number] | null {
  try {
    const v = JSON.parse(localStorage.getItem(POS_KEY) || 'null');
    return Array.isArray(v) && v.length === 2 ? (v as [number, number]) : null;
  } catch {
    return null;
  }
}
export function rememberPosition(p: [number, number]) {
  try {
    localStorage.setItem(POS_KEY, JSON.stringify(p.map((v) => Math.round(v * 1e4) / 1e4)));
  } catch {
    /* storage unavailable */
  }
}
