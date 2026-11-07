import type { SignThemeId } from '../junction/signs';
import type { LangCode, Units } from '../routing/instructions';
import type { Avoid } from '../routing/types';
import type { JvMode, JvSize } from '../ui/junctionPanel';
import type { PlacesUpdate } from '../places/schedule';
import { isDaylight } from './daylight';

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
  /** Lay the map (streets, land use, water) on the ground of the 3D junction view. */
  jvMapGround: boolean;
  /** Lane advice before exits, entrances, junctions and turns; 'gps' also checks the current lane. */
  laneAlerts: 'gps' | 'advice' | 'off';
  /** Tunnel sign card and voice warning before tunnels. */
  tunnelAlerts: boolean;
  /** Voice reminder and a chip before toll plazas (get the Touch 'n Go card ready). */
  tollAlerts: boolean;
  /** With offline maps downloaded: use them only without internet ('auto') or all the time. */
  offlineUse: 'auto' | 'always';
  /** Version of the app's look the settings were saved with (moves old default map styles on). */
  look: number;
  /** How much map the navigation camera shows: 'auto', or what the scale bar stands for (100 to 1000 m). */
  mapScale: 'auto' | number;
  /** Junction view size next to the map: 1:3, 2:3, or full screen while it is up. */
  jvSize: JvSize;
  /** Zoom the map in to 20 m at dividers, ramps, exits, entrances and junctions, with the other roads in colour. */
  closeUp: boolean;
  /** Android app only: run the copy built into the app, or the latest website build downloaded into it. */
  appMode: 'built-in' | 'web';
  /** The user's own TomTom key for live traffic ('' = the one built into the site, if any). */
  tomtomKey: string;
  /**
   * Routing, alternatives, place search and the category buttons: TomTom first (with the usual
   * services taking over whenever TomTom cannot answer), or the OpenStreetMap services only.
   */
  services: 'tomtom' | 'open';
  /** Live traffic on the map and the route (needs a TomTom key). */
  trafficMap: boolean;
  /** Spoken warnings for accidents, closures and slow traffic ahead on the route. */
  trafficAlerts: boolean;
  /** Traffic headlines from Malaysian news (no key needed). */
  trafficNews: boolean;
  /** How often the places around you are brought up to date (src/places). */
  placesUpdate: PlacesUpdate;
  /** How far around you places are kept (km). */
  placesRadius: number;
  /** Automatic places updates only on Wi-Fi. */
  placesWifiOnly: boolean;
  /** The places around you as icons on the map. */
  placesOnMap: boolean;
}

const env = import.meta.env;

/** True in the self-contained build that runs inside a hosted preview page (no network, no GPS). */
export const ARTIFACT = env.VITE_ARTIFACT === '1';

/** Deployment defaults; override with VITE_* variables at build time (see README). */
export const DEFAULTS: Settings = {
  mapStyle: env.VITE_MAP_STYLE || 'tech',
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
  jvMapGround: true,
  laneAlerts: 'gps',
  tunnelAlerts: true,
  tollAlerts: true,
  offlineUse: 'auto',
  look: 2,
  mapScale: 'auto',
  jvSize: '1:3',
  closeUp: true,
  appMode: 'built-in',
  tomtomKey: '',
  services: 'tomtom',
  trafficMap: true,
  trafficAlerts: true,
  trafficNews: true,
  placesUpdate: 'monthly',
  placesRadius: 100,
  placesWifiOnly: true,
  placesOnMap: true,
};

/** A TomTom key for everyone, set by the site's build (optional); a key in Settings takes its place. */
export const BUILT_IN_TOMTOM_KEY: string = env.VITE_TOMTOM_KEY || '';

export function tomtomKey(s: Settings): string {
  return s.tomtomKey.trim() || BUILT_IN_TOMTOM_KEY;
}

const KEY = 'junctionnav.settings.v1';
/** The current look: 2 is the JunctionNav day and night theme (and its map as the default). */
const LOOK = 2;

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw) as Partial<Settings> & { avoidTolls?: boolean };
      const merged = { ...DEFAULTS, ...saved, avoid: { ...DEFAULTS.avoid, ...(saved.avoid ?? {}) } };
      if (saved.avoidTolls) merged.avoid.tolls = true; // older versions
      // The old default map follows the app to its new look; a style picked on purpose stays.
      if ((saved.look ?? 1) < LOOK && (!saved.mapStyle || saved.mapStyle === 'ofm-liberty')) merged.mapStyle = DEFAULTS.mapStyle;
      merged.look = LOOK;
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

/** Where the automatic appearance looks at the sun: the user's position, once known. */
let sunPlace: [number, number] | null = null;
export function setSunPlace(p: [number, number]) {
  sunPlace = p;
}

/** Kuala Lumpur, when nothing better is known yet. */
const SUN_DEFAULT: [number, number] = [101.6869, 3.139];

export function isNight(s: Settings, now = new Date()): boolean {
  if (s.appearance === 'day') return false;
  if (s.appearance === 'night') return true;
  if (ARTIFACT) {
    // Follow the viewer's theme in the hosted preview.
    const t = document.documentElement.dataset.theme;
    if (t === 'dark' || t === 'light') return t === 'dark';
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  }
  // Automatic: dark from sunset to sunrise where the user is.
  const [lng, lat] = sunPlace ?? lastPosition() ?? SUN_DEFAULT;
  return !isDaylight(now, lat, lng);
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
