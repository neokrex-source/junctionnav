/// <reference lib="webworker" />
/**
 * Places worker: keeps the places around you in browser storage (IndexedDB) and in memory, brings
 * them up to date from the website's places/ folder, and answers the map, search and category
 * questions without blocking the map.
 *
 * An update reads places/manifest.json, works out the cells within the chosen distance, downloads
 * the ones that are new or changed (a few at a time; each is stored as soon as it arrives, so an
 * interrupted update keeps what it got), and drops cells that are now out of reach.
 */
import { cellsInCircle, PLACES_VERSION, type CellFile, type PlacesManifest } from './format';
import { PlacesIndex, type PlaceCategory } from './placesIndex';
import type { PlacesState } from './schedule';

export type PlacesRequest =
  | { type: 'init' }
  | { type: 'update'; base: string; center: [number, number]; radiusKm: number; force?: boolean }
  | { type: 'clear' }
  | { type: 'box'; bbox: [number, number, number, number]; zoom: number; limit: number; driving?: boolean }
  | { type: 'search'; q: string; near: [number, number] | null; limit: number }
  | { type: 'near'; points: [number, number][]; radius: number; cat: PlaceCategory; limit: number }
  | { type: 'get'; id: string }
  | { type: 'nearest'; p: [number, number]; maxDist: number };

const index = new PlacesIndex();
let state: PlacesState | null = null;
let ready: Promise<void> | null = null;

/* ---------------------------------------------------------------- storage */

interface StoredCell {
  id: string;
  h: string;
  built: string;
  text: string;
}

const DB_NAME = 'junctionnav-places';
let dbp: Promise<IDBDatabase> | null = null;

function db(): Promise<IDBDatabase> {
  if (dbp) return dbp;
  dbp = new Promise<IDBDatabase>((resolve, reject) => {
    const r = indexedDB.open(DB_NAME, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      if (!d.objectStoreNames.contains('cells')) d.createObjectStore('cells', { keyPath: 'id' });
      if (!d.objectStoreNames.contains('meta')) d.createObjectStore('meta');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('Browser storage is not available'));
  });
  dbp.catch(() => (dbp = null));
  return dbp;
}

function req<T>(r: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error ?? new Error('Browser storage failed'));
  });
}

async function store(name: 'cells' | 'meta', mode: IDBTransactionMode) {
  return (await db()).transaction(name, mode).objectStore(name);
}

/** Each stored cell in turn (one at a time, so a big area never sits in memory twice). */
async function eachCell(fn: (c: StoredCell) => void): Promise<void> {
  const s = await store('cells', 'readonly');
  await new Promise<void>((resolve, reject) => {
    const c = s.openCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return resolve();
      fn(cur.value as StoredCell);
      cur.continue();
    };
    c.onerror = () => reject(c.error);
  });
}

async function cellHashes(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  const s = await store('cells', 'readonly');
  await new Promise<void>((resolve, reject) => {
    const c = s.openCursor();
    c.onsuccess = () => {
      const cur = c.result;
      if (!cur) return resolve();
      const v = cur.value as StoredCell;
      out.set(v.id, v.h);
      cur.continue();
    };
    c.onerror = () => reject(c.error);
  });
  return out;
}

/* ---------------------------------------------------------------- network */

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function fetchText(url: string, bytes?: number): Promise<string> {
  let last: Error = new Error(`Could not download ${url}`);
  for (let i = 0; i < 3; i++) {
    if (i) await pause(1200 * i);
    try {
      const r = await fetch(url, { cache: i ? 'reload' : 'default' });
      if (!r.ok) {
        last = new Error(`The places data did not answer (${r.status}).`);
        if (r.status === 404) break;
        continue;
      }
      const text = await r.text();
      if (bytes != null && new TextEncoder().encode(text).length !== bytes) {
        last = new Error('A places file arrived incomplete.');
        continue;
      }
      return text;
    } catch (e) {
      last = new Error(`Could not reach the places data (${(e as Error).message}).`);
    }
  }
  throw last;
}

/* ---------------------------------------------------------------- work */

async function load(): Promise<void> {
  try {
    await eachCell((c) => {
      try {
        index.add(JSON.parse(c.text) as CellFile);
      } catch {
        /* a damaged cell: the next update downloads it again */
      }
    });
    state = ((await req((await store('meta', 'readonly')).get('state'))) as PlacesState | undefined) ?? null;
  } catch (e) {
    console.warn('[places] storage', (e as Error).message);
  }
}

function stats(): PlacesState | null {
  return state ? { ...state, count: index.count } : null;
}

async function update(base: string, center: [number, number], radiusKm: number, force: boolean): Promise<PlacesState> {
  await ready;
  const manifest = JSON.parse(await fetchText(new URL('manifest.json', base).href)) as PlacesManifest;
  if (manifest.v !== PLACES_VERSION) throw new Error('The places data is in a newer format; update the app to use it.');
  const want = cellsInCircle(center, radiusKm).filter((id) => manifest.cells[id]);
  const have = await cellHashes();
  const get = want.filter((id) => force || have.get(id) !== manifest.cells[id].h || !index.has(id));
  const total = get.reduce((a, id) => a + manifest.cells[id].b, 0);
  let done = 0;
  self.postMessage({ progress: { done, total, cells: get.length } });
  // A few downloads at a time; each cell is stored and searchable as soon as it arrives.
  const queue = [...get];
  const worker = async () => {
    for (let id = queue.shift(); id; id = queue.shift()) {
      const meta = manifest.cells[id];
      const text = await fetchText(new URL(`cells/${id}.json?h=${meta.h}`, base).href, meta.b);
      const file = JSON.parse(text) as CellFile;
      await req((await store('cells', 'readwrite')).put({ id, h: meta.h, built: manifest.built, text } satisfies StoredCell));
      index.add(file);
      done += meta.b;
      self.postMessage({ progress: { done, total, cells: get.length } });
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, Math.max(1, get.length)) }, worker));
  // Out of reach now (moved, or a smaller distance chosen).
  const keep = new Set(want);
  for (const id of have.keys()) {
    if (keep.has(id)) continue;
    await req((await store('cells', 'readwrite')).delete(id));
    index.remove(id);
  }
  for (const id of index.cellIds) if (!keep.has(id)) index.remove(id);
  state = {
    center,
    radiusKm,
    updatedAt: Date.now(),
    built: manifest.built,
    sources: manifest.sources,
    count: index.count,
    cells: want.length,
    bytes: want.reduce((a, id) => a + manifest.cells[id].b, 0),
    area: index.areaName(center),
  };
  await req((await store('meta', 'readwrite')).put(state, 'state'));
  return state;
}

async function clear(): Promise<void> {
  await ready;
  index.clear();
  state = null;
  await req((await store('cells', 'readwrite')).clear());
  await req((await store('meta', 'readwrite')).clear());
}

async function handle(msg: PlacesRequest): Promise<unknown> {
  switch (msg.type) {
    case 'init':
      ready ??= load();
      await ready;
      return stats();
    case 'update':
      return update(msg.base, msg.center, msg.radiusKm, !!msg.force);
    case 'clear':
      return clear();
    case 'box':
      return index.box(msg.bbox, msg.zoom, msg.limit, msg.driving);
    case 'search':
      return index.search(msg.q, msg.near, msg.limit);
    case 'near':
      return index.near(msg.points, msg.radius, msg.cat, msg.limit);
    case 'get':
      return index.get(msg.id);
    case 'nearest':
      return index.nearest(msg.p, msg.maxDist);
  }
}

self.onmessage = async (e: MessageEvent<{ id: number; msg: PlacesRequest }>) => {
  const { id, msg } = e.data;
  try {
    self.postMessage({ id, ok: true, value: await handle(msg) });
  } catch (err) {
    self.postMessage({ id, ok: false, error: (err as Error)?.message ?? String(err) });
  }
};
