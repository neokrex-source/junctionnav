import { describe, expect, it } from 'vitest';
import { buildDemo } from '../src/demo/network';
import type { LngLat } from '../src/geo/geo';
import { OfflineGraph } from '../src/offline/graph';
import { OfflineFirstRouter, type OfflineSwitch } from '../src/offline/providers';
import { OfflineRouter as GraphRouter } from '../src/offline/router';
import type { OfflineClient } from '../src/offline/client';
import { autoDecision, packHere, ASK_AGAIN, type AutoInput } from '../src/offline/autoDownload';
import type { Catalog, CatalogEntry, JobState } from '../src/offline/store';
import type { RouteRequest, RouteResult, Router } from '../src/routing/types';
import { FallbackRouter } from '../src/tomtom/fallback';
import { TomTomGate } from '../src/tomtom/gate';
import { demoPack } from './offlineFixture';

const demo = buildDemo();

/** A worker client over the demo pack: covers the demo roads only. */
function fakeClient(opts: { fail?: boolean } = {}): OfflineClient {
  const g = new OfflineGraph(demoPack().graph);
  const box = (p: LngLat) => Math.abs(p[0] - demo.start[0]) < 0.2 && Math.abs(p[1] - demo.start[1]) < 0.2;
  return {
    loaded: true,
    covers: (pts: LngLat[]) => pts.every(box),
    route: async (q: Parameters<OfflineClient['route']>[0]) => (opts.fail ? { code: 'NoRoute', message: 'no road here', routes: [], waypoints: [] } : new GraphRouter(g).route(q)),
  } as unknown as OfflineClient;
}

function sw(client: OfflineClient, available = true): OfflineSwitch {
  return { available: () => available, mode: () => 'auto', client };
}

class StubRouter implements Router {
  calls = 0;
  constructor(readonly name: string, private fail = false) {}
  async route(): Promise<RouteResult> {
    this.calls++;
    if (this.fail) throw new Error('TomTom 403');
    return { routes: [{ provider: this.name } as RouteResult['routes'][number]], warnings: [] };
  }
}

const inDemo: RouteRequest = { origin: demo.start, destination: demo.end, bearing: 0 };
const faraway: RouteRequest = { origin: [100.3, 5.4], destination: [103.8, 1.35] };

describe('offline maps before OSRM when TomTom is out of reach', () => {
  it('plans on the phone where the offline maps cover the trip', async () => {
    const osrm = new StubRouter('OSRM');
    const r = await new OfflineFirstRouter(sw(fakeClient()), () => osrm).route(inDemo);
    expect(r.routes[0].provider).toBe('Offline');
    expect(r.routes[0].distance).toBeGreaterThan(500);
    expect(osrm.calls).toBe(0);
  });

  it('asks OSRM for trips the offline maps do not cover', async () => {
    const osrm = new StubRouter('OSRM');
    const r = await new OfflineFirstRouter(sw(fakeClient()), () => osrm).route(faraway);
    expect(r.routes[0].provider).toBe('OSRM');
  });

  it('asks OSRM with no pack loaded, or with the setting off', async () => {
    const osrm = new StubRouter('OSRM');
    const none = new OfflineFirstRouter(sw(fakeClient(), false), () => osrm);
    expect((await none.route(inDemo)).routes[0].provider).toBe('OSRM');
    expect(none.name).toBe('OSRM');
    const off = new OfflineFirstRouter(sw(fakeClient()), () => osrm, () => false);
    expect((await off.route(inDemo)).routes[0].provider).toBe('OSRM');
    expect(off.name).toBe('OSRM');
  });

  it('falls back to OSRM with a warning when the offline maps find no route', async () => {
    const osrm = new StubRouter('OSRM');
    const r = await new OfflineFirstRouter(sw(fakeClient({ fail: true })), () => osrm).route(inDemo);
    expect(r.routes[0].provider).toBe('OSRM');
    expect(r.warnings[0]).toMatch(/offline maps found no route/);
  });

  it('TomTom failing names the offline maps in the note', async () => {
    const osrm = new StubRouter('OSRM');
    const chain = () => new FallbackRouter(new StubRouter('TomTom', true), () => new OfflineFirstRouter(sw(fakeClient()), () => osrm), new TomTomGate(() => 'K', () => true));
    const r = await chain().route(inDemo);
    expect(r.routes[0].provider).toBe('Offline');
    expect(r.note).toMatch(/offline maps on this device/);
    const far = await chain().route(faraway);
    expect(far.note).toMatch(/OpenStreetMap/);
  });
});

const manifest = (id: string, bbox: CatalogEntry['bbox']) => ({ id, name: id, version: '1', built: '', bbox, drivingSide: 'left' as const, attribution: '', files: [{ name: 'g', size: 1e6, parts: [{ path: 'p', size: 1e6 }] }] });
const entry = (id: string, bbox: CatalogEntry['bbox'], countries: string[], web = false): CatalogEntry => ({ id, name: { en: id }, group: 'asia' as CatalogEntry['group'], countries, bbox, manifest: manifest(id, bbox), web });
const catalog: Catalog = {
  v: 1,
  built: '',
  packs: [entry('peninsular-my', [99.6, 1.2, 104.6, 6.8], ['MY']), entry('my-borneo', [109.5, 0.8, 119.3, 7.4], ['MY', 'BN']), entry('singapore', [103.6, 1.15, 104.1, 1.48], ['SG'], true), entry('southeast-asia', [92, -11, 141, 29], [])],
};
const KL: LngLat = [101.69, 3.14];
const KK: LngLat = [116.07, 5.98];

const base = (o: Partial<AutoInput> = {}): AutoInput => ({
  enabled: true,
  supported: true,
  native: true,
  position: KL,
  catalog,
  installed: [],
  jobs: new Map(),
  answers: {},
  connection: { type: 'wifi', saveData: false },
  now: 1e12,
  ...o,
});

describe('the offline map for where you are', () => {
  it('picks the region you are in, not a bigger box or a neighbour', () => {
    expect(packHere(catalog, KL)?.id).toBe('peninsular-my');
    expect(packHere(catalog, KK)?.id).toBe('my-borneo');
    // Johor Bahru sits inside the Singapore pack's box, but it is in Malaysia.
    expect(packHere(catalog, [103.76, 1.47])?.id).toBe('peninsular-my');
    expect(packHere(catalog, [103.85, 1.3])?.id).toBe('singapore');
  });

  it('downloads by itself in the app on Wi-Fi', () => {
    const d = autoDecision(base());
    expect(d.kind).toBe('download');
    expect(d.kind !== 'none' && d.pack.id).toBe('peninsular-my');
  });

  it('asks on mobile data, with data saver, and in the browser', () => {
    expect(autoDecision(base({ connection: { type: 'cellular', saveData: false } })).kind).toBe('ask');
    expect(autoDecision(base({ connection: { type: 'wifi', saveData: true } })).kind).toBe('ask');
    expect(autoDecision(base({ connection: { type: 'unknown', saveData: false } })).kind).toBe('ask');
    expect(autoDecision(base({ native: false, position: [103.85, 1.3] })).kind).toBe('ask');
  });

  it('leaves app-only packs alone in the browser', () => {
    expect(autoDecision(base({ native: false }))).toEqual({ kind: 'none', why: 'app only' });
  });

  it('does nothing when off, installed, already downloading, or with nowhere known', () => {
    expect(autoDecision(base({ enabled: false })).kind).toBe('none');
    expect(autoDecision(base({ supported: false })).kind).toBe('none');
    expect(autoDecision(base({ position: null })).kind).toBe('none');
    expect(autoDecision(base({ catalog: null })).kind).toBe('none');
    expect(autoDecision(base({ installed: ['peninsular-my'] })).kind).toBe('none');
    const jobs = new Map<string, JobState>([['peninsular-my', { status: 'paused', done: 1, total: 2 }]]);
    expect(autoDecision(base({ jobs }))).toEqual({ kind: 'none', why: 'job' });
    expect(autoDecision(base({ position: [0, 0] })).kind).toBe('none');
  });

  it('"Later, on Wi-Fi" waits for Wi-Fi, then downloads', () => {
    const answers = { 'peninsular-my': { answer: 'wifi' as const, at: 1e12 } };
    expect(autoDecision(base({ answers, connection: { type: 'cellular', saveData: false } }))).toEqual({ kind: 'none', why: 'waiting for wifi' });
    expect(autoDecision(base({ answers })).kind).toBe('download');
  });

  it('"Not now" holds for a month, even on Wi-Fi', () => {
    const answers = { 'peninsular-my': { answer: 'no' as const, at: 1e12 } };
    expect(autoDecision(base({ answers })).kind).toBe('none');
    expect(autoDecision(base({ answers, connection: { type: 'cellular', saveData: false }, now: 1e12 + ASK_AGAIN - 1 })).kind).toBe('none');
    expect(autoDecision(base({ answers, connection: { type: 'cellular', saveData: false }, now: 1e12 + ASK_AGAIN + 1 })).kind).toBe('ask');
  });

  it('a download it started by itself pauses on mobile data and carries on back on Wi-Fi', () => {
    const answers = { 'peninsular-my': { answer: 'auto' as const, at: 1e12 } };
    const running = new Map<string, JobState>([['peninsular-my', { status: 'downloading', done: 1, total: 2 }]]);
    const paused = new Map<string, JobState>([['peninsular-my', { status: 'paused', done: 1, total: 2 }]]);
    expect(autoDecision(base({ answers, jobs: running, connection: { type: 'cellular', saveData: false } })).kind).toBe('pause');
    expect(autoDecision(base({ answers, jobs: running })).kind).toBe('none');
    expect(autoDecision(base({ answers, jobs: paused })).kind).toBe('resume');
    expect(autoDecision(base({ answers, jobs: paused, connection: { type: 'cellular', saveData: false } })).kind).toBe('none');
    // One the user asked for keeps going on mobile data.
    const yes = { 'peninsular-my': { answer: 'yes' as const, at: 1e12 } };
    expect(autoDecision(base({ answers: yes, jobs: running, connection: { type: 'cellular', saveData: false } })).kind).toBe('none');
  });
});
