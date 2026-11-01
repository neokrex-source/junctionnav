/** Accounts: the shape every sign-in backend implements. */

export interface User {
  id: string;
  name: string;
  email: string;
}

export interface SignUpResult {
  /** Signed in straight away, or null when the backend wants the email confirmed first. */
  user: User | null;
  /** Shown to the user when there is no session yet (e.g. "Check your email"). */
  message?: string;
}

export interface AuthProvider {
  /** 'local' keeps accounts in this browser; 'supabase' uses a Supabase project. */
  readonly kind: 'local' | 'supabase';
  /** The signed-in user from a saved session, if any. */
  current(): Promise<User | null>;
  signIn(email: string, password: string, remember: boolean): Promise<User>;
  signUp(name: string, email: string, password: string, remember: boolean): Promise<SignUpResult>;
  signOut(): Promise<void>;
  /** Starts a password reset; resolves with what to tell the user. */
  requestPasswordReset(email: string): Promise<string>;
  /** True when the page was opened from a password-reset link and a new password can be set. */
  pendingRecovery(): boolean;
  completePasswordReset(password: string): Promise<User>;
  /** Local accounts only. */
  deleteAccount?(email: string, password: string): Promise<void>;
}

/** A problem the user can act on; `field` points at the input to fix. */
export class AuthError extends Error {
  constructor(
    message: string,
    public field?: 'name' | 'email' | 'password' | 'confirm',
  ) {
    super(message);
  }
}

export const MIN_PASSWORD = 8;

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function validateEmail(email: string): void {
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizeEmail(email))) throw new AuthError('Enter an email address like name@example.com.', 'email');
}

export function validatePassword(password: string): void {
  if (password.length < MIN_PASSWORD) throw new AuthError(`Use at least ${MIN_PASSWORD} characters for the password.`, 'password');
}

export function validateName(name: string): void {
  const n = name.trim();
  if (!n) throw new AuthError('Enter your name.', 'name');
  if (n.length > 60) throw new AuthError('Keep the name under 60 characters.', 'name');
}

/** Rough strength for the hint under the password field: 0 weak … 3 strong. */
export function passwordStrength(pw: string): 0 | 1 | 2 | 3 {
  if (pw.length < MIN_PASSWORD) return 0;
  let kinds = 0;
  if (/[a-z]/.test(pw)) kinds++;
  if (/[A-Z]/.test(pw)) kinds++;
  if (/\d/.test(pw)) kinds++;
  if (/[^A-Za-z0-9]/.test(pw)) kinds++;
  return (1 + (kinds >= 2 ? 1 : 0) + (pw.length >= 12 || kinds >= 3 ? 1 : 0)) as 1 | 2 | 3;
}

/** localStorage / sessionStorage that never throws (private windows, blocked storage). */
export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function safeStorage(kind: 'local' | 'session'): KV {
  const mem = new Map<string, string>();
  const store = (): Storage | null => {
    try {
      return kind === 'local' ? window.localStorage : window.sessionStorage;
    } catch {
      return null;
    }
  };
  return {
    get(k) {
      try {
        return store()?.getItem(k) ?? mem.get(k) ?? null;
      } catch {
        return mem.get(k) ?? null;
      }
    },
    set(k, v) {
      mem.set(k, v);
      try {
        store()?.setItem(k, v);
      } catch {
        /* memory only */
      }
    },
    remove(k) {
      mem.delete(k);
      try {
        store()?.removeItem(k);
      } catch {
        /* memory only */
      }
    },
  };
}

export function memoryStorage(): KV {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}
