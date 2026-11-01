/**
 * Supabase Auth over its REST API (no SDK): email + password accounts that work on every
 * device. Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY at build time to use it.
 */
import { AuthError, normalizeEmail, validateEmail, validateName, validatePassword, type AuthProvider, type KV, type SignUpResult, type User } from './types';

interface StoredSession {
  access_token: string;
  refresh_token: string;
  /** Unix seconds. */
  expires_at: number;
  user: User;
}

interface GoTrueUser {
  id: string;
  email?: string;
  user_metadata?: { name?: string; full_name?: string };
}

interface GoTrueSession {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  expires_at?: number;
  user?: GoTrueUser;
}

const KEY = 'junctionnav.supabase.session.v1';

function toUser(u: GoTrueUser): User {
  const email = u.email ?? '';
  return { id: u.id, email, name: u.user_metadata?.name || u.user_metadata?.full_name || email.split('@')[0] };
}

/** Friendlier wording for the common GoTrue errors. */
function explain(status: number, body: Record<string, unknown>): AuthError {
  const raw = String(body.error_description ?? body.msg ?? body.message ?? body.error ?? '');
  const code = String(body.error_code ?? body.code ?? '');
  if (/invalid login credentials|invalid_grant/i.test(raw + code)) return new AuthError('That email and password do not match an account.', 'password');
  if (/email not confirmed/i.test(raw + code)) return new AuthError('Confirm your email first: open the link we sent you, then sign in.', 'email');
  if (/already registered|user_already_exists/i.test(raw + code)) return new AuthError('There is already an account for this email. Sign in instead.', 'email');
  if (/password/i.test(raw) && status === 422) return new AuthError(raw, 'password');
  if (status === 429) return new AuthError('Too many attempts. Wait a minute and try again.');
  return new AuthError(raw || `Sign-in service error (${status}).`);
}

export class SupabaseAuth implements AuthProvider {
  readonly kind = 'supabase' as const;
  private recovery: StoredSession | null = null;

  constructor(
    private url: string,
    private anonKey: string,
    private local: KV,
    private session: KV,
    private opts: { fetch?: typeof fetch; now?: () => number; hash?: () => string; clearHash?: () => void; redirectTo?: string } = {},
  ) {
    this.url = url.replace(/\/$/, '');
    this.readRedirect();
  }

  private nowS() {
    return Math.floor((this.opts.now?.() ?? Date.now()) / 1000);
  }

  private async call<T = Record<string, unknown>>(path: string, init: { method?: string; body?: unknown; token?: string } = {}): Promise<T> {
    const f = this.opts.fetch ?? fetch.bind(globalThis);
    let res: Response;
    try {
      res = await f(`${this.url}/auth/v1/${path}`, {
        method: init.method ?? (init.body ? 'POST' : 'GET'),
        headers: {
          apikey: this.anonKey,
          'Content-Type': 'application/json',
          Authorization: `Bearer ${init.token ?? this.anonKey}`,
        },
        body: init.body ? JSON.stringify(init.body) : undefined,
      });
    } catch {
      throw new AuthError('Cannot reach the sign-in service. Check your internet connection.');
    }
    const text = await res.text();
    let body: Record<string, unknown> = {};
    try {
      body = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* not JSON */
    }
    if (!res.ok) throw explain(res.status, body);
    return body as T;
  }

  private store(s: StoredSession, remember: boolean) {
    (remember ? this.local : this.session).set(KEY, JSON.stringify(s));
    (remember ? this.session : this.local).remove(KEY);
  }

  private load(): { s: StoredSession; remember: boolean } | null {
    for (const [kv, remember] of [[this.session, false], [this.local, true]] as const) {
      const raw = kv.get(KEY);
      if (!raw) continue;
      try {
        return { s: JSON.parse(raw) as StoredSession, remember };
      } catch {
        kv.remove(KEY);
      }
    }
    return null;
  }

  private fromGoTrue(g: GoTrueSession): StoredSession | null {
    if (!g.access_token || !g.refresh_token || !g.user) return null;
    return {
      access_token: g.access_token,
      refresh_token: g.refresh_token,
      expires_at: g.expires_at ?? this.nowS() + (g.expires_in ?? 3600),
      user: toUser(g.user),
    };
  }

  /** Links from confirmation and reset emails land with tokens in the URL hash. */
  private readRedirect() {
    const hash = this.opts.hash?.() ?? (typeof location !== 'undefined' ? location.hash : '');
    if (!hash || !hash.includes('access_token=')) return;
    const p = new URLSearchParams(hash.replace(/^#/, ''));
    const access = p.get('access_token');
    const refresh = p.get('refresh_token');
    if (!access || !refresh) return;
    const pending: StoredSession = {
      access_token: access,
      refresh_token: refresh,
      expires_at: Number(p.get('expires_at')) || this.nowS() + Number(p.get('expires_in') || 3600),
      user: { id: '', name: '', email: '' },
    };
    if (p.get('type') === 'recovery') this.recovery = pending;
    else this.local.set(KEY, JSON.stringify(pending));
    if (this.opts.clearHash) this.opts.clearHash();
    else if (typeof history !== 'undefined') history.replaceState(null, '', location.pathname + location.search);
  }

  async current(): Promise<User | null> {
    const got = this.load();
    if (!got) return null;
    let { s } = got;
    try {
      if (s.expires_at - 60 < this.nowS()) {
        const g = await this.call<GoTrueSession>('token?grant_type=refresh_token', { body: { refresh_token: s.refresh_token } });
        const next = this.fromGoTrue(g);
        if (!next) throw new AuthError('Session expired.');
        s = next;
      }
      if (!s.user.id) s.user = toUser(await this.call<GoTrueUser>('user', { token: s.access_token }));
      this.store(s, got.remember);
      return s.user;
    } catch (e) {
      // Offline: keep the saved user rather than locking the driver out of navigation.
      if (e instanceof AuthError && /Cannot reach/.test(e.message) && s.user.id) return s.user;
      this.local.remove(KEY);
      this.session.remove(KEY);
      return null;
    }
  }

  async signIn(email: string, password: string, remember: boolean): Promise<User> {
    validateEmail(email);
    if (!password) throw new AuthError('Enter your password.', 'password');
    const g = await this.call<GoTrueSession>('token?grant_type=password', { body: { email: normalizeEmail(email), password } });
    const s = this.fromGoTrue(g);
    if (!s) throw new AuthError('The sign-in service returned no session.');
    this.store(s, remember);
    return s.user;
  }

  async signUp(name: string, email: string, password: string, remember: boolean): Promise<SignUpResult> {
    validateName(name);
    validateEmail(email);
    validatePassword(password);
    const g = await this.call<GoTrueSession>('signup', { body: { email: normalizeEmail(email), password, data: { name: name.trim() } } });
    const s = this.fromGoTrue(g);
    if (s) {
      this.store(s, remember);
      return { user: s.user };
    }
    return { user: null, message: `We sent a confirmation link to ${normalizeEmail(email)}. Open it on this device, then sign in.` };
  }

  async signOut(): Promise<void> {
    const got = this.load();
    this.local.remove(KEY);
    this.session.remove(KEY);
    if (got) await this.call('logout', { method: 'POST', token: got.s.access_token }).catch(() => undefined);
  }

  async requestPasswordReset(email: string): Promise<string> {
    validateEmail(email);
    const to = this.opts.redirectTo ?? (typeof location !== 'undefined' ? location.origin + location.pathname : '');
    await this.call(`recover${to ? `?redirect_to=${encodeURIComponent(to)}` : ''}`, { body: { email: normalizeEmail(email) } });
    return `If there is an account for ${normalizeEmail(email)}, a reset link is on its way. Open it on this device to choose a new password.`;
  }

  pendingRecovery(): boolean {
    return !!this.recovery;
  }

  async completePasswordReset(password: string): Promise<User> {
    validatePassword(password);
    const r = this.recovery;
    if (!r) throw new AuthError('This reset link has expired. Ask for a new one.');
    const u = toUser(await this.call<GoTrueUser>('user', { method: 'PUT', token: r.access_token, body: { password } }));
    this.store({ ...r, user: u }, true);
    this.recovery = null;
    return u;
  }
}
