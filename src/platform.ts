/**
 * Where the app runs: a browser (the GitHub Pages site, the preview) or the Android app, which
 * packs this same web app with Capacitor (`npm run build:android`, see android/ and README).
 *
 * Inside the Android app the code is either the copy built into the APK, or (website mode, see
 * src/native/appMode.ts) the latest website build downloaded into the app. The website build
 * knows it is in the app from Capacitor's bridge, which the app injects before any script runs.
 */
const BUILD_NATIVE = import.meta.env.VITE_NATIVE === 'android';
const bridge = typeof window !== 'undefined' ? (window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }).Capacitor : undefined;

/** Running in the Android app (built-in copy or a website build downloaded into it). */
export const NATIVE: boolean = BUILD_NATIVE || !!bridge?.isNativePlatform?.();

/** The copy built into the APK is running (as opposed to a website build downloaded into the app). */
export const BUILT_IN: boolean = BUILD_NATIVE;

/** The published website, where the Android app gets the latest version and the offline maps. */
export const WEB_APP_URL: string | undefined = import.meta.env.VITE_WEB_APP_URL || undefined;

/** The offline maps' manifest when the app is not served next to them (inside the Android app). */
export const PACK_URL: string | undefined =
  import.meta.env.VITE_PACK_URL || (NATIVE && WEB_APP_URL ? new URL('offline/manifest.json', WEB_APP_URL).href : undefined);

/** The Android installer, offered in the website's Settings (set by the Pages build). */
export const APK_URL: string | undefined = NATIVE ? undefined : import.meta.env.VITE_APK_URL || undefined;

/** The app version built into the APK (set by the Android workflow). */
export const APP_VERSION: string = import.meta.env.VITE_APP_VERSION || 'dev';

/** Traffic headlines collected by the Traffic news workflow (set by the Pages and Android builds). */
export const TRAFFIC_NEWS_URL: string = import.meta.env.VITE_TRAFFIC_NEWS_URL || '';
