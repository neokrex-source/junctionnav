/** Picks the sign-in backend from build settings. */
import { LocalAuth } from './localAuth';
import { SupabaseAuth } from './supabaseAuth';
import { safeStorage, type AuthProvider } from './types';

const env = import.meta.env as Record<string, string | undefined>;

/** Whether people must sign in before using the app (VITE_AUTH_REQUIRED=false offers a guest option). */
export const AUTH_REQUIRED = (env.VITE_AUTH_REQUIRED ?? 'true') !== 'false';

export function createAuthProvider(): AuthProvider {
  const local = safeStorage('local');
  const session = safeStorage('session');
  if (env.VITE_SUPABASE_URL && env.VITE_SUPABASE_ANON_KEY) return new SupabaseAuth(env.VITE_SUPABASE_URL, env.VITE_SUPABASE_ANON_KEY, local, session);
  return new LocalAuth(local, session);
}

export type { AuthProvider, User } from './types';
