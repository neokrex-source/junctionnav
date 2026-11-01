/**
 * Accounts kept in this browser. Passwords are never stored: only a PBKDF2-SHA256 hash with a
 * random salt. Good for a static site with no server (GitHub Pages); accounts do not follow
 * the user to other devices or browsers.
 */
import { AuthError, normalizeEmail, validateEmail, validateName, validatePassword, type AuthProvider, type KV, type SignUpResult, type User } from './types';

interface Account {
  id: string;
  name: string;
  email: string;
  salt: string;
  hash: string;
  iter: number;
  created: number;
}

interface Session {
  uid: string;
  exp: number;
}

const ACCOUNTS = 'junctionnav.accounts.v1';
const SESSION = 'junctionnav.session.v1';
const ITERATIONS = 310_000;
const REMEMBER_DAYS = 30;

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf as ArrayBuffer)));
const unb64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

function subtle(): SubtleCrypto {
  const s = globalThis.crypto?.subtle;
  if (!s) throw new AuthError('Signing in needs a secure connection. Open the app over https.');
  return s;
}

export async function hashPassword(password: string, salt: Uint8Array, iter = ITERATIONS): Promise<string> {
  const key = await subtle().importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits']);
  const bits = await subtle().deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt: salt as BufferSource, iterations: iter }, key, 256);
  return b64(bits);
}

/** Compares without stopping at the first difference. */
function sameHash(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export class LocalAuth implements AuthProvider {
  readonly kind = 'local' as const;
  private fails = new Map<string, number>();

  constructor(
    private local: KV,
    private session: KV,
    private opts: { iterations?: number; now?: () => number } = {},
  ) {}

  private now() {
    return this.opts.now?.() ?? Date.now();
  }

  private accounts(): Account[] {
    try {
      return JSON.parse(this.local.get(ACCOUNTS) || '[]') as Account[];
    } catch {
      return [];
    }
  }

  private saveAccounts(list: Account[]) {
    this.local.set(ACCOUNTS, JSON.stringify(list));
  }

  private toUser(a: Account): User {
    return { id: a.id, name: a.name, email: a.email };
  }

  private startSession(a: Account, remember: boolean) {
    const s: Session = { uid: a.id, exp: remember ? this.now() + REMEMBER_DAYS * 86_400_000 : 0 };
    (remember ? this.local : this.session).set(SESSION, JSON.stringify(s));
    (remember ? this.session : this.local).remove(SESSION);
  }

  async current(): Promise<User | null> {
    for (const store of [this.session, this.local]) {
      const raw = store.get(SESSION);
      if (!raw) continue;
      try {
        const s = JSON.parse(raw) as Session;
        if (s.exp && s.exp < this.now()) {
          store.remove(SESSION);
          continue;
        }
        const a = this.accounts().find((x) => x.id === s.uid);
        if (a) return this.toUser(a);
      } catch {
        store.remove(SESSION);
      }
    }
    return null;
  }

  async signUp(name: string, email: string, password: string, remember: boolean): Promise<SignUpResult> {
    validateName(name);
    validateEmail(email);
    validatePassword(password);
    const e = normalizeEmail(email);
    const list = this.accounts();
    if (list.some((a) => a.email === e)) throw new AuthError('There is already an account for this email in this browser. Sign in instead.', 'email');
    const salt = crypto.getRandomValues(new Uint8Array(16));
    const iter = this.opts.iterations ?? ITERATIONS;
    const a: Account = {
      id: crypto.randomUUID(),
      name: name.trim(),
      email: e,
      salt: b64(salt),
      hash: await hashPassword(password, salt, iter),
      iter,
      created: this.now(),
    };
    this.saveAccounts([...list, a]);
    this.startSession(a, remember);
    return { user: this.toUser(a) };
  }

  async signIn(email: string, password: string, remember: boolean): Promise<User> {
    validateEmail(email);
    if (!password) throw new AuthError('Enter your password.', 'password');
    const e = normalizeEmail(email);
    // Slow down repeated guesses.
    const fails = this.fails.get(e) ?? 0;
    if (fails >= 3) await sleep(Math.min(8000, 500 * 2 ** (fails - 3)));
    const a = this.accounts().find((x) => x.email === e);
    // Hash even for unknown emails so both cases take the same time.
    const hash = await hashPassword(password, a ? unb64(a.salt) : new Uint8Array(16), a?.iter ?? this.opts.iterations ?? ITERATIONS);
    if (!a || !sameHash(hash, a.hash)) {
      this.fails.set(e, fails + 1);
      throw new AuthError('That email and password do not match an account in this browser.', 'password');
    }
    this.fails.delete(e);
    this.startSession(a, remember);
    return this.toUser(a);
  }

  async signOut(): Promise<void> {
    this.local.remove(SESSION);
    this.session.remove(SESSION);
  }

  async requestPasswordReset(): Promise<string> {
    return 'Accounts kept in this browser cannot be recovered by email. Remove the account below and register again; your saved places for it are removed too.';
  }

  pendingRecovery(): boolean {
    return false;
  }

  async completePasswordReset(): Promise<User> {
    throw new AuthError('Password reset by email is not available for accounts kept in this browser.');
  }

  /** Removes an account. With a password it must match; without one (forgotten) it is removed anyway. */
  async deleteAccount(email: string, password: string): Promise<void> {
    const e = normalizeEmail(email);
    const list = this.accounts();
    const a = list.find((x) => x.email === e);
    if (!a) throw new AuthError('There is no account for this email in this browser.', 'email');
    if (password) {
      const hash = await hashPassword(password, unb64(a.salt), a.iter);
      if (!sameHash(hash, a.hash)) throw new AuthError('The password does not match this account.', 'password');
    }
    this.saveAccounts(list.filter((x) => x.id !== a.id));
    const cur = await this.current();
    if (!cur || cur.id === a.id) await this.signOut();
    this.local.remove(`junctionnav.places.v1.${a.id}`);
  }
}
