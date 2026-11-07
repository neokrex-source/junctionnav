/**
 * In the Android app: where a short Google Maps link (maps.app.goo.gl) leads. The app's own HTTP
 * client (Capacitor's) can read a redirect without following it; a web page cannot.
 */
import { resolveShortLink } from '../search/googleLinks';

export async function resolveMapsLink(url: string): Promise<string> {
  const { CapacitorHttp } = await import('@capacitor/core');
  return resolveShortLink(url, async (u) => {
    const r = await CapacitorHttp.request({ url: u, method: 'GET', disableRedirects: true, connectTimeout: 10_000, readTimeout: 10_000, responseType: 'text' });
    return { status: r.status, headers: (r.headers ?? {}) as Record<string, string>, url: r.url, body: typeof r.data === 'string' ? r.data : '' };
  });
}
