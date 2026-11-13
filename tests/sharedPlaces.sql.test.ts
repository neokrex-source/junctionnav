/**
 * The shared places schema (supabase/shared-places.sql) in a real Postgres (PGlite), with
 * Supabase's roles and auth.uid() set up the way Supabase has them: who can read, add, change,
 * delete and report what.
 */
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const ANUAR = '11111111-1111-1111-1111-111111111111';
const BETTY = '22222222-2222-2222-2222-222222222222';
const CHONG = '33333333-3333-3333-3333-333333333333';
const DAVID = '44444444-4444-4444-4444-444444444444';

let db: PGlite;

/** Runs `sql` as a signed-in person (or anonymously with null), as PostgREST does. */
async function as<T = Record<string, unknown>>(who: string | null, sql: string, params: unknown[] = []): Promise<T[]> {
  await db.exec('reset role');
  await db.exec(`select set_config('request.jwt.claim.sub', '${who ?? ''}', false)`);
  await db.exec(`set role ${who ? 'authenticated' : 'anon'}`);
  try {
    return (await db.query<T>(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

const add = (who: string, name: string, visibility: 'private' | 'public', extra = '') =>
  as<{ id: string }>(who, `insert into public.shared_places (name, lon, lat, visibility${extra ? ', note' : ''}) values ($1, 101.7, 3.15, $2${extra ? ', $3' : ''}) returning id`, extra ? [name, visibility, extra] : [name, visibility]).then((r) => r[0].id);

beforeAll(async () => {
  db = new PGlite();
  // What Supabase has before any project SQL runs.
  await db.exec(`
    create role anon nologin;
    create role authenticated nologin;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant execute on function auth.uid() to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    insert into auth.users values ('${ANUAR}'), ('${BETTY}'), ('${CHONG}'), ('${DAVID}');
  `);
  const sql = readFileSync('supabase/shared-places.sql', 'utf8');
  await db.exec(sql);
  // Safe to run twice.
  await db.exec(sql);
}, 60_000);

describe('shared places in the database', () => {
  it('lets a signed-in person add places, and owns them to that person', async () => {
    const id = await add(ANUAR, 'Kedai Kopi Pak Lah', 'public');
    const [row] = await as<{ owner: string; visibility: string; hidden: boolean }>(ANUAR, 'select owner, visibility, hidden from public.shared_places where id = $1', [id]);
    expect(row).toEqual({ owner: ANUAR, visibility: 'public', hidden: false });
  });

  it('shows public places to everyone, private ones only to their owner', async () => {
    await add(ANUAR, 'Rumah Mak', 'private');
    await add(BETTY, 'Betty secret spot', 'private');
    const names = async (who: string | null) => (await as<{ name: string }>(who, 'select name from public.shared_places order by name')).map((r) => r.name);
    expect(await names(null)).toEqual(['Kedai Kopi Pak Lah']);
    expect(await names(ANUAR)).toEqual(['Kedai Kopi Pak Lah', 'Rumah Mak']);
    expect(await names(BETTY)).toEqual(['Betty secret spot', 'Kedai Kopi Pak Lah']);
  });

  it('does not let anyone add a place as someone else, or without signing in', async () => {
    await expect(as(BETTY, `insert into public.shared_places (owner, name, lon, lat) values ('${ANUAR}', 'Fake', 101, 3)`)).rejects.toThrow(/permission denied|row-level security/);
    await expect(as(null, `insert into public.shared_places (name, lon, lat) values ('Anon', 101, 3)`)).rejects.toThrow(/permission denied/);
  });

  it('lets only the owner change or delete a place, and never its owner, reports or hidden flag', async () => {
    const id = await add(ANUAR, 'Gerai Nasi Lemak', 'public');
    // Someone else: nothing changes (no row is theirs to update).
    await as(BETTY, `update public.shared_places set name = 'Hacked' where id = $1`, [id]);
    await as(BETTY, 'delete from public.shared_places where id = $1', [id]);
    const [still] = await as<{ name: string }>(ANUAR, 'select name from public.shared_places where id = $1', [id]);
    expect(still.name).toBe('Gerai Nasi Lemak');
    // The owner can move it, rename it and make it private.
    await as(ANUAR, `update public.shared_places set name = 'Gerai Nasi Lemak Kak Ros', lon = 101.71, visibility = 'private' where id = $1`, [id]);
    const [moved] = await as<{ name: string; lon: number; visibility: string; updated_at: Date; created_at: Date }>(ANUAR, 'select name, lon, visibility, updated_at, created_at from public.shared_places where id = $1', [id]);
    expect(moved).toMatchObject({ name: 'Gerai Nasi Lemak Kak Ros', lon: 101.71, visibility: 'private' });
    expect(moved.updated_at.getTime()).toBeGreaterThanOrEqual(moved.created_at.getTime());
    // But not hand it to someone else, or unhide it.
    await expect(as(ANUAR, `update public.shared_places set owner = '${BETTY}' where id = $1`, [id])).rejects.toThrow(/permission denied/);
    await expect(as(ANUAR, 'update public.shared_places set hidden = false, reports = 0 where id = $1', [id])).rejects.toThrow(/permission denied/);
    await as(ANUAR, 'delete from public.shared_places where id = $1', [id]);
    expect(await as(ANUAR, 'select 1 from public.shared_places where id = $1', [id])).toEqual([]);
  });

  it('checks what is written: a name, a real position, a known visibility', async () => {
    await expect(as(ANUAR, `insert into public.shared_places (name, lon, lat) values ('   ', 101, 3)`)).rejects.toThrow(/check/);
    await expect(as(ANUAR, `insert into public.shared_places (name, lon, lat) values ('Far away', 200, 3)`)).rejects.toThrow(/check/);
    await expect(as(ANUAR, `insert into public.shared_places (name, lon, lat, visibility) values ('X', 101, 3, 'friends')`)).rejects.toThrow(/check/);
    await expect(as(ANUAR, `insert into public.shared_places (name, lon, lat, heading) values ('X', 101, 3, 400)`)).rejects.toThrow(/check/);
  });

  it('hides a public place after three people report it, but not from its owner', async () => {
    const id = await add(ANUAR, 'Wrong place', 'public');
    // Not your own, and once each.
    await expect(as(ANUAR, 'insert into public.shared_place_reports (place_id, reason) values ($1, $2)', [id, 'mine'])).rejects.toThrow(/row-level security/);
    await as(BETTY, 'insert into public.shared_place_reports (place_id, reason) values ($1, $2)', [id, 'Closed down']);
    await expect(as(BETTY, 'insert into public.shared_place_reports (place_id) values ($1)', [id])).rejects.toThrow(/duplicate key/);
    await as(CHONG, 'insert into public.shared_place_reports (place_id) values ($1)', [id]);
    const seen = async (who: string | null) => (await as(who, 'select 1 from public.shared_places where id = $1', [id])).length;
    expect(await seen(null)).toBe(1);
    await as(DAVID, 'insert into public.shared_place_reports (place_id) values ($1)', [id]);
    expect(await seen(null)).toBe(0);
    expect(await seen(BETTY)).toBe(0);
    const [own] = await as<{ hidden: boolean; reports: number }>(ANUAR, 'select hidden, reports from public.shared_places where id = $1', [id]);
    expect(own).toEqual({ hidden: true, reports: 3 });
    // People see their own reports only.
    expect(await as(BETTY, 'select place_id from public.shared_place_reports')).toHaveLength(1);
    expect(await as(null, 'select 1 from public.shared_places where hidden')).toEqual([]);
  });

  it('cannot report a private place (it cannot even be seen)', async () => {
    const id = await add(ANUAR, 'Private', 'private');
    await expect(as(BETTY, 'insert into public.shared_place_reports (place_id) values ($1)', [id])).rejects.toThrow(/row-level security/);
  });
});
