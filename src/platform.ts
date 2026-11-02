/**
 * Where the app runs: a browser (the GitHub Pages site, the preview) or the Android app, which
 * packs this same web app with Capacitor (`npm run build:android`, see android/ and README).
 * Read straight from import.meta.env so each build keeps only its own code.
 */

/** Built into the Android app. Set at build time (`.env.android`), so browser builds drop the native code. */
export const NATIVE: boolean = import.meta.env.VITE_NATIVE === 'android';

/** The offline maps' manifest when the app is not served next to them (the Android app downloads from the site). */
export const PACK_URL: string | undefined = import.meta.env.VITE_PACK_URL || undefined;

/** The Android installer, offered in the site's Settings (set by the Pages build). */
export const APK_URL: string | undefined = NATIVE ? undefined : import.meta.env.VITE_APK_URL || undefined;
