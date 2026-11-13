/**
 * Signing in with Google or Apple in the Android app: their sign-in page opens in the phone's
 * browser (Google does not allow it inside an app's web view), and comes back to the app by
 * its own link, which AndroidManifest.xml hands to the app.
 */

/** The app's link the sign-in comes back to (listed in the Supabase project's redirect URLs). */
export const AUTH_CALLBACK = 'io.github.neokrexsource.junctionnav://auth-callback';

function bridge(): { isPluginAvailable?: (name: string) => boolean } | undefined {
  return (window as unknown as { Capacitor?: { isPluginAvailable?: (name: string) => boolean } }).Capacitor;
}

/** This build of the app can open the sign-in page and come back (older installs cannot). */
export function canSignInWithBrowser(): boolean {
  return !!bridge()?.isPluginAvailable?.('Browser');
}

export async function openSignIn(url: string): Promise<void> {
  const { Browser } = await import('@capacitor/browser');
  await Browser.open({ url });
}

export async function closeSignIn(): Promise<void> {
  try {
    const { Browser } = await import('@capacitor/browser');
    await Browser.close();
  } catch {
    /* already closed */
  }
}

export function isAuthCallback(url: string): boolean {
  return url.startsWith(AUTH_CALLBACK);
}
