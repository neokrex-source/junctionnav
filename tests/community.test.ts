import { describe, expect, it } from 'vitest';
import { SupabaseAuth } from '../src/auth/supabaseAuth';
import { memoryStorage } from '../src/auth/types';
import { fromRow, SupabasePlaces, toRow, type SharedPlacesApi } from '../src/community/remote';
import { MyPlacesStore, PublicPlaces } from '../src/community/store';
import { CommunityPois, CommunitySearch, mergeRegistered, sharedToPlace } from '../src/community/search';
import { parsePlaceLink, placeLink } from '../src/community/links';
import { cleanFields, type SharedPlace } from '../src/community/types';
import { CATEGORIES, type PoiProvider, type RawPoi } from '../src/search/categories';
import type { Place, PlaceSearchEngine } from '../src/search/places';
import type { LngLat } from '../src/geo/geo';

const KLCC: LngLat = [101.7119, 3.1578];

function shared(over: Partial<SharedPlace> = {}): SharedPlace {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    name: 'Kopitiam Lama',
    category: 'food',
    note: '',
    phone: '',
    website: '',
    lngLat: KLCC,
    heading: null,
    visibility: 'public',
    ownerName: 'Aina',
    owner: 'u2',
    updated: 1,
    ...over,
  };
}

/** The shared places service in memory, checking ownership as the database does. */
class FakeApi implements SharedPlacesApi {
  rows = new Map<string, SharedPlace>();
  calls: string[] = [];
  me = 'u1';
  down = false;
  private n = 0;
  private check() {
    if (this.down) throw new Error('Cannot reach the shared places service.');
  }
  async inBox([w, s, e, n]: [number, number, number, number]) {
    this.check();
    this.calls.push('inBox');
    return [...this.rows.values()].filter((p) => (p.visibility === 'public' || p.owner === this.me) && p.lngLat[0] >= w && p.lngLat[0] <= e && p.lngLat[1] >= s && p.lngLat[1] <= n);
  }
  async search(text: string) {
    this.check();
    this.calls.push(`search:${text}`);
    return [...this.rows.values()].filter((p) => (p.visibility === 'public' || p.owner === this.me) && p.name.toLowerCase().includes(text.toLowerCase()));
  }
  async get(id: string) {
    this.check();
    return this.rows.get(id) ?? null;
  }
  async mine(owner: string) {
    this.check();
    this.calls.push('mine');
    return [...this.rows.values()].filter((p) => p.owner === owner).map((p) => ({ ...p }));
  }
  async create(p: SharedPlace) {
    this.check();
    this.calls.push(`create:${p.name}`);
    const row = { ...p, owner: this.me, updated: 1000 + ++this.n };
    this.rows.set(p.id, row);
    return { ...row };
  }
  async update(p: SharedPlace) {
    this.check();
    this.calls.push(`update:${p.name}`);
    const was = this.rows.get(p.id);
    if (!was || was.owner !== this.me) return null;
    const row = { ...p, owner: this.me, updated: 1000 + ++this.n };
    this.rows.set(p.id, row);
    return { ...row };
  }
  async remove(id: string) {
    this.check();
    this.calls.push(`remove:${id}`);
    if (this.rows.get(id)?.owner === this.me) this.rows.delete(id);
  }
  async report(id: string) {
    this.check();
    this.calls.push(`report:${id}`);
  }
}

function storage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
}

const fields = (over: Partial<SharedPlace> = {}) => {
  const p = shared(over);
  return { name: p.name, category: p.category, note: p.note, phone: p.phone, website: p.website, lngLat: p.lngLat, heading: p.heading, visibility: p.visibility };
};

describe('signing in with Google and Apple (Supabase)', () => {
  function mock(routes: Record<string, () => [number, unknown]>) {
    const calls: string[] = [];
    const f = (async (url: string) => {
      calls.push(url);
      const path = url.replace('https://x.supabase.co/auth/v1/', '');
      const key = Object.keys(routes).find((k) => path.startsWith(k));
      const [status, body] = key ? routes[key]() : [404, {}];
      return new Response(JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  }
  const user = { id: 'g1', email: 'aina@gmail.com', user_metadata: { full_name: 'Aina Rahman' } };

  it('offers only the providers the project has turned on, and builds their sign-in link', async () => {
    const { f } = mock({ settings: () => [200, { external: { google: true, apple: false, github: true, email: true } }] });
    const ls = memoryStorage();
    const auth = new SupabaseAuth('https://x.supabase.co', 'anon', ls, memoryStorage(), { fetch: f, hash: () => '', search: () => '' });
    expect(await auth.socialProviders()).toEqual(['google']);
    const url = auth.socialUrl('google', 'https://site.example/junctionnav/', false);
    expect(url).toBe('https://x.supabase.co/auth/v1/authorize?provider=google&redirect_to=https%3A%2F%2Fsite.example%2Fjunctionnav%2F');
    expect(ls.get('junctionnav.supabase.social')).toBe('0');
  });

  it('shows no providers when the settings cannot be read', async () => {
    const { f } = mock({});
    const auth = new SupabaseAuth('https://x.supabase.co', 'anon', memoryStorage(), memoryStorage(), { fetch: f, hash: () => '', search: () => '' });
    expect(await auth.socialProviders()).toEqual([]);
  });

  it('takes the session the sign-in page comes back with, kept for this tab when asked', async () => {
    const { f } = mock({ user: () => [200, user] });
    const ls = memoryStorage();
    const ss = memoryStorage();
    ls.set('junctionnav.supabase.social', '0');
    let cleared = false;
    const auth = new SupabaseAuth('https://x.supabase.co', 'anon', ls, ss, {
      fetch: f,
      hash: () => '#access_token=at&expires_in=3600&provider_token=pt&refresh_token=rt&token_type=bearer',
      search: () => '',
      clearHash: () => (cleared = true),
    });
    expect(cleared).toBe(true);
    expect(ls.get('junctionnav.supabase.session.v1')).toBeNull();
    expect(ls.get('junctionnav.supabase.social')).toBeNull();
    expect(await auth.current()).toEqual({ id: 'g1', email: 'aina@gmail.com', name: 'Aina Rahman' });
    expect(JSON.parse(ss.get('junctionnav.supabase.session.v1')!).access_token).toBe('at');
    expect(await auth.accessToken()).toBe('at');
  });

  it('says why when the sign-in page comes back with an error', () => {
    const { f } = mock({});
    const auth = new SupabaseAuth('https://x.supabase.co', 'anon', memoryStorage(), memoryStorage(), {
      fetch: f,
      hash: () => '',
      search: () => '?error=bad_oauth_request&error_code=validation_failed&error_description=Unsupported+provider%3A+provider+is+not+enabled',
      clearHash: () => {},
    });
    expect(auth.takeRedirectError()).toBe('That way of signing in is not turned on for this site yet.');
    expect(auth.takeRedirectError()).toBeNull();
  });

  it('finishes from the app link in the Android app', async () => {
    const { f } = mock({ user: () => [200, user] });
    const ls = memoryStorage();
    const auth = new SupabaseAuth('https://x.supabase.co', 'anon', ls, memoryStorage(), { fetch: f, hash: () => '', search: () => '' });
    auth.socialUrl('apple', 'io.github.neokrexsource.junctionnav://auth-callback', true);
    await expect(auth.completeSocial('io.github.neokrexsource.junctionnav://auth-callback#error=access_denied&error_description=User+cancelled')).rejects.toMatchObject({ message: 'Sign-in was cancelled.' });
    auth.socialUrl('apple', 'io.github.neokrexsource.junctionnav://auth-callback', true);
    const u = await auth.completeSocial('io.github.neokrexsource.junctionnav://auth-callback#access_token=a2&refresh_token=r2&expires_in=3600');
    expect(u.id).toBe('g1');
    expect(JSON.parse(ls.get('junctionnav.supabase.session.v1')!).refresh_token).toBe('r2');
  });

  it('has no token without a session', async () => {
    const { f } = mock({});
    const auth = new SupabaseAuth('https://x.supabase.co', 'anon', memoryStorage(), memoryStorage(), { fetch: f, hash: () => '', search: () => '' });
    expect(await auth.accessToken()).toBeNull();
  });
});

describe('the shared places service (REST)', () => {
  function mock(reply: (url: string, init: RequestInit) => [number, unknown]) {
    const calls: { url: string; init: RequestInit }[] = [];
    const f = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      const [status, body] = reply(url, init);
      return new Response(body == null ? '' : JSON.stringify(body), { status });
    }) as unknown as typeof fetch;
    return { f, calls };
  }
  const row = { ...toRow(shared()), owner: 'u2', hidden: false, updated_at: '2026-11-01T00:00:00Z' };

  it('reads public places in a box with the anon key, and by name near a point', async () => {
    const { f, calls } = mock(() => [200, [row]]);
    const api = new SupabasePlaces('https://x.supabase.co/', 'anon', async () => null, f);
    const list = await api.inBox([101.6, 3.1, 101.8, 3.2]);
    expect(list[0]).toMatchObject({ name: 'Kopitiam Lama', lngLat: KLCC, ownerName: 'Aina', category: 'food' });
    const u = new URL(calls[0].url);
    expect(u.pathname).toBe('/rest/v1/shared_places');
    expect(u.searchParams.getAll('lon')).toEqual(['gte.101.60000', 'lte.101.80000']);
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer anon');
    await api.search('kopitiam lama', KLCC);
    const s = new URL(calls[1].url);
    expect(s.searchParams.getAll('name')).toEqual(['ilike.*kopitiam*', 'ilike.*lama*']);
  });

  it('needs a signed-in person to change places, and sends their token', async () => {
    let token: string | null = null;
    const { f, calls } = mock((_u, init) => (init.method === 'POST' ? [201, [row]] : [200, []]));
    const api = new SupabasePlaces('https://x.supabase.co', 'anon', async () => token, f);
    await expect(api.create(shared())).rejects.toMatchObject({ status: 401 });
    expect(calls.length).toBe(0);
    token = 'user-token';
    await api.create(shared());
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer user-token');
    expect(JSON.parse(String(calls[0].init.body))).not.toHaveProperty('owner');
    // Changing a place that is gone (or not yours) answers nothing.
    expect(await api.update(shared())).toBeNull();
  });

  it('explains a missing table, and takes a second report as done', async () => {
    const missing = new SupabasePlaces('https://x.supabase.co', 'anon', async () => 't', mock(() => [404, { message: 'relation does not exist' }]).f);
    await expect(missing.inBox([0, 0, 1, 1])).rejects.toMatchObject({ message: expect.stringContaining('supabase/shared-places.sql') });
    const again = new SupabasePlaces('https://x.supabase.co', 'anon', async () => 't', mock(() => [409, { message: 'duplicate key' }]).f);
    await expect(again.report(row.id, 'Closed')).resolves.toBeUndefined();
  });

  it('keeps the name of whoever added a place off private places', () => {
    expect(toRow(shared({ visibility: 'private' })).owner_name).toBe('');
    expect(toRow(shared({ heading: -90 })).heading).toBe(270);
    expect(fromRow({ ...row, category: 'nonsense' }).category).toBe('other');
  });
});

describe('my places', () => {
  it('keeps places in this browser per account, private without the service', () => {
    const st = storage();
    const store = new MyPlacesStore(st);
    store.useScope('local-user', null, null);
    const p = store.add(fields({ visibility: 'public' }));
    expect(p.visibility).toBe('private');
    expect(store.list().map((x) => x.name)).toEqual(['Kopitiam Lama']);
    expect(st.m.has('junctionnav.myplaces.v1.local-user')).toBe(true);
    store.useScope('someone-else', null, null);
    expect(store.list()).toEqual([]);
    store.useScope('local-user', null, null);
    expect(store.get(p.id)?.name).toBe('Kopitiam Lama');
  });

  it('sends new, changed and deleted places to the service, and fetches those from other devices', async () => {
    const api = new FakeApi();
    const store = new MyPlacesStore(storage());
    store.useScope('u1', { owner: 'u1', name: 'Anuar Ahmadon' }, api);
    await store.sync();
    const p = store.add(fields({ visibility: 'public', owner: '' }));
    await store.sync();
    expect(api.calls).toContain('create:Kopitiam Lama');
    expect(store.get(p.id)).toMatchObject({ synced: true, remote: true, ownerName: 'Anuar' });
    expect(store.pending).toBe(0);

    store.update(p.id, { name: 'Kopitiam Lama SS2' });
    await store.sync();
    expect(api.rows.get(p.id)?.name).toBe('Kopitiam Lama SS2');

    // Added on another device.
    api.rows.set('22222222-2222-4222-8222-222222222222', shared({ id: '22222222-2222-4222-8222-222222222222', name: 'Bengkel Ah Seng', owner: 'u1', category: 'car' }));
    await store.sync();
    expect(store.list().map((x) => x.name).sort()).toEqual(['Bengkel Ah Seng', 'Kopitiam Lama SS2']);

    // Deleted on another device.
    api.rows.delete('22222222-2222-4222-8222-222222222222');
    await store.sync();
    expect(store.list().map((x) => x.name)).toEqual(['Kopitiam Lama SS2']);

    store.remove(p.id);
    await store.sync();
    expect(api.rows.size).toBe(0);
    expect(store.list()).toEqual([]);
  });

  it('keeps changes made without signal and sends them later', async () => {
    const api = new FakeApi();
    const store = new MyPlacesStore(storage());
    store.useScope('u1', { owner: 'u1', name: 'Anuar' }, api);
    await store.sync();
    api.down = true;
    const p = store.add(fields({ visibility: 'private' }));
    await store.sync();
    expect(store.lastError).toMatch(/Cannot reach/);
    expect(store.get(p.id)?.synced).toBe(false);
    api.down = false;
    await store.sync();
    expect(store.get(p.id)?.synced).toBe(true);
    expect(store.lastError).toBeNull();
  });

  it('puts back a place whose row was removed by the service before the change arrived', async () => {
    const api = new FakeApi();
    const store = new MyPlacesStore(storage());
    store.useScope('u1', { owner: 'u1', name: 'Anuar' }, api);
    const p = store.add(fields());
    await store.sync();
    api.rows.delete(p.id);
    store.update(p.id, { note: 'Parking at the back' });
    await store.sync();
    expect(api.rows.get(p.id)?.note).toBe('Parking at the back');
  });

  it('finds your places by name, nearest first', () => {
    const store = new MyPlacesStore(storage());
    store.useScope('u', null, null);
    store.add(fields({ name: 'Nasi Kandar Pelita', lngLat: [101.7, 3.16] }));
    store.add(fields({ name: 'Nasi Kandar Pelita', lngLat: [100.3, 5.4] }));
    store.add(fields({ name: 'Petronas Jalan Ampang', category: 'fuel' }));
    const m = store.matches('nasi kandar', [100.31, 5.41]);
    expect(m.map((x) => x.lngLat[0])).toEqual([100.3, 101.7]);
    expect(store.near([KLCC], 500, ['fuel']).map((x) => x.name)).toEqual(['Petronas Jalan Ampang']);
  });
});

describe('public places around the map', () => {
  it('fetches each tile once in ten minutes', async () => {
    const api = new FakeApi();
    api.rows.set('a', shared({ id: 'a' }));
    let now = 0;
    const pub = new PublicPlaces(() => api, () => now);
    await pub.load([101.65, 3.1, 101.75, 3.2]);
    const first = api.calls.filter((c) => c === 'inBox').length;
    expect(first).toBeGreaterThan(0);
    expect(pub.inBox([101.7, 3.15, 101.72, 3.16]).map((p) => p.id)).toEqual(['a']);
    await pub.load([101.65, 3.1, 101.75, 3.2]);
    expect(api.calls.filter((c) => c === 'inBox').length).toBe(first);
    now += 11 * 60_000;
    await pub.load([101.65, 3.1, 101.75, 3.2]);
    expect(api.calls.filter((c) => c === 'inBox').length).toBe(first * 2);
  });

  it('asks nothing for a view too big', async () => {
    const api = new FakeApi();
    const pub = new PublicPlaces(() => api);
    await pub.load([99, 1, 105, 7]);
    expect(api.calls).toEqual([]);
  });
});

describe('registered places in search', () => {
  const other = (name: string, at: LngLat, sub = 'Restaurant'): Place => ({ name, sub, lngLat: at });
  const engine = (list: Place[]): PlaceSearchEngine => ({ search: async () => list, reverse: async () => other('Jalan Ampang', KLCC, 'Kuala Lumpur') });

  it('come first and stand in for the same place nearby', () => {
    const reg = [sharedToPlace(shared(), 'en', false)];
    const merged = mergeRegistered(reg, [other('Kopitiam Lama', [101.7125, 3.158]), other('Kopitiam Lama', [101.9, 3.3]), other('Kedai Lain', KLCC)]);
    expect(merged.map((p) => [p.name, !!p.shared])).toEqual([
      ['Kopitiam Lama', true],
      ['Kopitiam Lama', false],
      ['Kedai Lain', false],
    ]);
    expect(merged[1].lngLat[0]).toBe(101.9);
  });

  it('search finds yours and everyone public, and names a pressed point after a place right there', async () => {
    const api = new FakeApi();
    api.rows.set('pub', shared({ id: 'pub', name: 'Kopitiam Lama' }));
    api.rows.set('priv', shared({ id: 'priv', name: 'Kopitiam Rahsia', visibility: 'private', owner: 'u9' }));
    const mine = new MyPlacesStore(storage());
    mine.useScope('u1', null, null);
    const own = mine.add(fields({ name: 'Kopitiam Saya', lngLat: [101.72, 3.16] }));
    const s = new CommunitySearch(engine([other('Kopitiam Lama', [101.712, 3.1579])]), mine, new PublicPlaces(() => api), () => 'en');
    const r = await s.search('kopitiam', KLCC, 'en');
    expect(r.map((p) => p.name)).toEqual(['Kopitiam Saya', 'Kopitiam Lama']);
    expect(r[0].shared).toMatchObject({ own: true, id: own.id });
    expect(r[1].shared).toMatchObject({ own: false, ownerName: 'Aina' });
    expect(r[1].sub).toBe('Food and drink · Added by Aina');
    expect((await s.reverse([101.72001, 3.16001]))?.shared?.id).toBe(own.id);
    expect((await s.reverse([101.73, 3.17]))?.name).toBe('Jalan Ampang');
  });

  it('still answers when the other sources fail, and fails when nothing answers', async () => {
    const broken: PlaceSearchEngine = { search: async () => Promise.reject(new Error('offline')), reverse: async () => null };
    const mine = new MyPlacesStore(storage());
    mine.useScope('u1', null, null);
    const s = new CommunitySearch(broken, mine, new PublicPlaces(() => null), () => 'en');
    await expect(s.search('kopitiam', KLCC, 'en')).rejects.toThrow('offline');
    mine.add(fields({ name: 'Kopitiam Saya' }));
    expect((await s.search('kopitiam', KLCC, 'en')).map((p) => p.name)).toEqual(['Kopitiam Saya']);
  });

  it('the category buttons list registered places of that kind', async () => {
    const mine = new MyPlacesStore(storage());
    mine.useScope('u1', null, null);
    mine.add(fields({ name: 'Petronas Ampang', category: 'fuel', lngLat: [101.713, 3.158] }));
    mine.add(fields({ name: 'Kedai Kopi', category: 'cafe' }));
    const inner: PoiProvider = { query: async (): Promise<RawPoi[]> => [{ id: 'node/1', lngLat: [101.7131, 3.1581], tags: { name: 'Petronas Ampang' } }, { id: 'node/2', lngLat: [101.75, 3.16], tags: { name: 'Shell' } }] };
    const pois = new CommunityPois(inner, mine, new PublicPlaces(() => null), () => 'en');
    const fuel = CATEGORIES.find((c) => c.id === 'fuel')!;
    const out = await pois.query(fuel, [KLCC], 5000);
    expect(out.map((p) => p.tags.name)).toEqual(['Petronas Ampang', 'Shell']);
    expect(out[0].place?.shared?.own).toBe(true);
    const food = CATEGORIES.find((c) => c.id === 'food')!;
    expect((await pois.query(food, [KLCC], 5000)).map((p) => p.tags.name)).toContain('Kedai Kopi');
  });
});

describe('place links', () => {
  it('links a public place by its id, and any other place with its details', () => {
    const base = 'https://neokrex-source.github.io/junctionnav/?demo#x';
    expect(placeLink(base, shared(), true)).toBe('https://neokrex-source.github.io/junctionnav/?sp=11111111-1111-4111-8111-111111111111');
    const url = placeLink(base, shared({ visibility: 'private', heading: 92, note: 'Gate B, ask the guard', phone: '+60 3-1234 5678' }), true);
    const back = parsePlaceLink(new URL(url).search);
    expect(back?.kind).toBe('inline');
    if (back?.kind !== 'inline') return;
    expect(back.place).toMatchObject({ name: 'Kopitiam Lama', category: 'food', heading: 92, note: 'Gate B, ask the guard', phone: '+60 3-1234 5678', visibility: 'private' });
    expect(back.place.lngLat[0]).toBeCloseTo(KLCC[0], 6);
  });

  it('turns down links that do not make sense', () => {
    expect(parsePlaceLink('?sp=not-a-uuid')).toBeNull();
    expect(parsePlaceLink('?place=95,10&name=x')).toBeNull();
    expect(parsePlaceLink('?place=3.1,101.7')).toBeNull();
    const odd = parsePlaceLink('?place=3.1,101.7&name=X&kind=lasers&web=javascript:alert(1)');
    expect(odd?.kind === 'inline' && odd.place.category).toBe('other');
    expect(odd?.kind === 'inline' && odd.place.website).toBe('');
    expect(parsePlaceLink('?to=KLCC')).toBeNull();
  });

  it('cleans what the form gives', () => {
    expect(cleanFields({ name: '  Kedai   Ali  ', note: ' a\r\nb ', phone: ' 012 ', website: 'kedai.my' })).toEqual({ name: 'Kedai Ali', note: 'a\nb', phone: '012', website: 'https://kedai.my' });
  });
});
