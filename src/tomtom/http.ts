/**
 * Calls to TomTom with the user's key. TomTom serves each service twice: the long-standing
 * ("classic") APIs and the newer Orbis ones, which answer in the same shape. A key is not always
 * set up for both, so a family that refuses (403/404) is set aside and the other one is tried,
 * and the one that answered is remembered for next time.
 */
export const TT_BASE = 'https://api.tomtom.com';

export class TomTomError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** TomTom's own error code, e.g. NO_ROUTE_FOUND. */
    readonly code = '',
  ) {
    super(message);
    this.name = 'TomTomError';
  }
}

/** The JSON of a TomTom answer, or a TomTomError with what TomTom said. */
export async function ttJson<T>(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, { ...init, signal });
  const text = await res.text();
  let json: unknown = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    /* not JSON (a proxy page, an HTML error) */
  }
  if (!res.ok) {
    const j = (json ?? {}) as { error?: { description?: string } | string; detailedError?: { code?: string; message?: string }; errorText?: string; message?: string };
    const desc = (typeof j.error === 'string' ? j.error : j.error?.description) || j.detailedError?.message || j.errorText || j.message || '';
    const code = j.detailedError?.code ?? '';
    const what =
      res.status === 403 ? 'TomTom refused the key (or its allowance for today is used up)' : res.status === 429 ? 'TomTom is busy (too many requests)' : `TomTom answered ${res.status}`;
    throw new TomTomError(desc ? `${what}: ${desc}` : `${what}.`, res.status, code);
  }
  return json as T;
}

export type Family = 'classic' | 'orbis';

/** Which family answered last, per service. */
const preferred: Record<string, Family> = {};

/**
 * Ask one family, then the other if the first refuses the key or does not know the service.
 * `url(family)` builds the request for each.
 */
export async function ttEither<T>(service: string, url: (f: Family) => string, init: RequestInit = {}, signal?: AbortSignal): Promise<T> {
  const first = preferred[service] ?? 'classic';
  const second: Family = first === 'classic' ? 'orbis' : 'classic';
  try {
    const r = await ttJson<T>(url(first), init, signal);
    preferred[service] = first;
    return r;
  } catch (e) {
    if (!(e instanceof TomTomError) || (e.status !== 403 && e.status !== 404 && e.status !== 405)) throw e;
    const r = await ttJson<T>(url(second), init, signal);
    preferred[service] = second;
    return r;
  }
}

/** Forget which family answered (a new key). */
export function resetFamilies() {
  for (const k of Object.keys(preferred)) delete preferred[k];
}
