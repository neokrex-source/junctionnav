import { describe, expect, it } from 'vitest';
import { LocalAuth } from '../src/auth/localAuth';
import { SupabaseAuth } from '../src/auth/supabaseAuth';
import { AuthError, memoryStorage, passwordStrength } from '../src/auth/types';

const local = () => {
  const ls = memoryStorage();
  const ss = memoryStorage();
  return { ls, ss, auth: new LocalAuth(ls, ss, { iterations: 1000 }) };
};

describe('accounts in this browser', () => {
  it('registers, keeps the session, signs out and back in', async () => {
    const { ls, auth } = local();
    const r = await auth.signUp('  Anuar Ahmadon ', 'Anuar@Example.com ', 'lanes-and-signs', true);
    expect(r.user).toMatchObject({ name: 'Anuar Ahmadon', email: 'anuar@example.com' });
    expect(await auth.current()).toEqual(r.user);
    // The password itself is never stored.
    expect(ls.get('junctionnav.accounts.v1')).not.toContain('lanes-and-signs');
    await auth.signOut();
    expect(await auth.current()).toBeNull();
    const u = await auth.signIn('anuar@example.com', 'lanes-and-signs', false);
    expect(u.id).toBe(r.user!.id);
  });

  it('rejects bad input, duplicates and wrong passwords with a field to fix', async () => {
    const { auth } = local();
    await expect(auth.signUp('', 'a@b.co', 'longenough', true)).rejects.toMatchObject({ field: 'name' });
    await expect(auth.signUp('A', 'not-an-email', 'longenough', true)).rejects.toMatchObject({ field: 'email' });
    await expect(auth.signUp('A', 'a@b.co', 'short', true)).rejects.toMatchObject({ field: 'password' });
    await auth.signUp('A', 'a@b.co', 'longenough', true);
    await expect(auth.signUp('B', 'A@B.co', 'otherpass1', true)).rejects.toMatchObject({ field: 'email' });
    await expect(auth.signIn('a@b.co', 'wrongpass', true)).rejects.toBeInstanceOf(AuthError);
    await expect(auth.signIn('nobody@b.co', 'longenough', true)).rejects.toMatchObject({ field: 'password' });
  });

  it('remembers the session only when asked, and expires it', async () => {
    let now = 1_000_000;
    const ls = memoryStorage();
    const auth = new LocalAuth(ls, memoryStorage(), { iterations: 1000, now: () => now });
    await auth.signUp('A', 'a@b.co', 'longenough', false);
    expect(ls.get('junctionnav.session.v1')).toBeNull(); // tab session only
    await auth.signIn('a@b.co', 'longenough', true);
    expect(ls.get('junctionnav.session.v1')).not.toBeNull();
    now += 31 * 86_400_000;
    // A fresh instance (new tab) sees the expired remembered session.
    expect(await new LocalAuth(ls, memoryStorage(), { iterations: 1000, now: () => now }).current()).toBeNull();
  });

  it('removes an account and its saved places', async () => {
    const { ls, auth } = local();
    const r = await auth.signUp('A', 'a@b.co', 'longenough', true);
    ls.set(`junctionnav.places.v1.${r.user!.id}`, '{"favourites":[],"recents":[]}');
    await expect(auth.deleteAccount('a@b.co', 'wrongpass')).rejects.toMatchObject({ field: 'password' });
    await auth.deleteAccount('a@b.co', '');
    expect(await auth.current()).toBeNull();
    expect(ls.get(`junctionnav.places.v1.${r.user!.id}`)).toBeNull();
    await expect(auth.signIn('a@b.co', 'longenough', true)).rejects.toBeInstanceOf(AuthError);
  });

  it('rates password strength', () => {
    expect(passwordStrength('short')).toBe(0);
    expect(passwordStrength('abcdefgh')).toBe(1);
    expect(passwordStrength('abcdefg1')).toBe(2);
    expect(passwordStrength('Abcdefgh12!x')).toBe(3);
  });
});

describe('Supabase accounts', () => {
  function mock(routes: Record<string, (body: Record<string, unknown>, init: RequestInit) => [number, unknown]>) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const path = url.replace('https://x.supabase.co/auth/v1/', '');
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      const [status, body] = key ? routes[key](init.body ? JSON.parse(String(init.body)) : {}, init) : [404, {}];
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  }
  const user = { id: 'u1', email: 'a@b.co', user_metadata: { name: 'Anuar' } };
  const session = { access_token: 'at', refresh_token: 'rt', expires_in: 3600, user };

  it('signs in with the anon key and keeps the session', async () => {
    const { f, calls } = mock({ 'token?grant_type=password': () => [200, session], user: () => [200, user] });
    const ls = memoryStorage();
    const auth = new SupabaseAuth('https://x.supabase.co/', 'anon', ls, memoryStorage(), { fetch: f, hash: () => '' });
    expect(await auth.signIn('A@B.co', 'secret123', true)).toEqual({ id: 'u1', email: 'a@b.co', name: 'Anuar' });
    expect((calls[0].init.headers as Record<string, string>).apikey).toBe('anon');
    expect(JSON.parse(String(calls[0].init.body))).toEqual({ email: 'a@b.co', password: 'secret123' });
    expect(await auth.current()).toMatchObject({ id: 'u1' });
  });

  it('explains wrong passwords and email confirmation', async () => {
    const { f } = mock({
      'token?grant_type=password': () => [400, { error: 'invalid_grant', error_description: 'Invalid login credentials' }],
      signup: () => [200, { id: 'u2', email: 'n@b.co' }],
    });
    const auth = new SupabaseAuth('https://x.supabase.co', 'anon', memoryStorage(), memoryStorage(), { fetch: f, hash: () => '' });
    await expect(auth.signIn('a@b.co', 'nope-nope', true)).rejects.toMatchObject({ field: 'password', message: 'That email and password do not match an account.' });
    const r = await auth.signUp('New', 'n@b.co', 'longenough', true);
    expect(r.user).toBeNull();
    expect(r.message).toContain('confirmation link');
  });

  it('refreshes an expired session and finishes a password reset from the email link', async () => {
    let now = 2_000_000_000_000;
    const { f, calls } = mock({
      'token?grant_type=refresh_token': () => [200, { ...session, access_token: 'at2' }],
      user: (_body, init) => (init.method === 'PUT' ? [200, { ...user, email: 'a@b.co' }] : [200, user]),
    });
    const ls = memoryStorage();
    ls.set('junctionnav.supabase.session.v1', JSON.stringify({ access_token: 'old', refresh_token: 'rt', expires_at: Math.floor(now / 1000) - 10, user: { id: 'u1', name: 'Anuar', email: 'a@b.co' } }));
    const auth = new SupabaseAuth('https://x.supabase.co', 'anon', ls, memoryStorage(), { fetch: f, now: () => now, hash: () => '' });
    expect(await auth.current()).toMatchObject({ id: 'u1' });
    expect(calls.some((c) => c.url.includes('grant_type=refresh_token'))).toBe(true);
    expect(JSON.parse(ls.get('junctionnav.supabase.session.v1')!).access_token).toBe('at2');

    let cleared = false;
    const rec = new SupabaseAuth('https://x.supabase.co', 'anon', memoryStorage(), memoryStorage(), {
      fetch: f,
      now: () => now,
      hash: () => '#access_token=rec&refresh_token=rr&expires_in=3600&type=recovery',
      clearHash: () => (cleared = true),
    });
    expect(cleared).toBe(true);
    expect(rec.pendingRecovery()).toBe(true);
    await expect(rec.completePasswordReset('short')).rejects.toMatchObject({ field: 'password' });
    expect(await rec.completePasswordReset('brand-new-pass')).toMatchObject({ id: 'u1' });
    const put = calls.find((c) => c.init.method === 'PUT')!;
    expect((put.init.headers as Record<string, string>).Authorization).toBe('Bearer rec');
  });
});
