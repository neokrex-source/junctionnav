/**
 * Offline maps by country in browser storage (Origin Private File System): the list of countries
 * and regions on offer (the catalog), downloads one at a time with progress, pause and resume
 * (also after closing the app), updates, deleting, and file access for the map and the worker.
 *
 * Layout: packs/<id>-<version>/ holds manifest.json, the decompressed gzip files (graph.bin,
 * places.bin, assets.bin, assets.json) and raw files kept as their published parts
 * (tiles.pmtiles.0, .1, ...), which are joined into one Blob for reading. Keeping parts separate
 * means a resumed or interrupted download never rewrites what is already stored.
 *
 * Packs published with the site download in any browser. Packs published as GitHub release files
 * (most countries: the site has room for one) cannot be read by a web page (GitHub sends no CORS
 * headers for them), so the Android app downloads those with its own HTTP client.
 */
import { safeStorage } from '../auth/types';
import { NATIVE, PACK_URL } from '../platform';
import type { PackManifest } from './graphLayout';

export type PackGroup = 'sea' | 'east' | 'south' | 'central' | 'west';

/** One country or region on offer. */
export interface CatalogEntry {
  id: string;
  /** Its name in the app's languages. */
  name: { en: string; ms?: string; ja?: string };
  group: PackGroup;
  /** ISO country code(s) it covers. */
  countries?: string[];
  bbox: [number, number, number, number];
  manifest: PackManifest;
  /** The browser can download it (published with the site); otherwise only the Android app can. */
  web: boolean;
}

export interface Catalog {
  v: number;
  built: string;
  packs: CatalogEntry[];
}

export type JobState =
  | { status: 'queued'; done: number; total: number }
  | { status: 'downloading'; done: number; total: number }
  | { status: 'paused'; done: number; total: number }
  | { status: 'error'; message: string; done: number; total: number };

/** Whether this browser can keep offline maps at all. */
export type PackState = { status: 'unsupported' } | { status: 'idle' } | { status: 'busy' };

export interface InstalledPack {
  id: string;
  manifest: PackManifest;
  bytes: number;
  /** Folder path inside browser storage, for the worker. */
  dir: string[];
}

const PACKS_KEY = 'junctionnav.offline.packs';
const LEGACY_PACK_KEY = 'junctionnav.offline.pack';
const LEGACY_PROGRESS_KEY = 'junctionnav.offline.progress';
const progressKey = (id: string) => `junctionnav.offline.progress.${id}`;

interface Progress {
  id: string;
  version: string;
  /** Finished parts per file. */
  files: Record<string, number>;
}

export const folderOf = (m: { id: string; version: string }) => `${m.id}-${m.version}`.replace(/[^\w.-]+/g, '_');
export const downloadSize = (m: PackManifest) => m.files.reduce((a, f) => a + f.parts.reduce((b, p) => b + p.size, 0), 0);
export const deviceSize = (m: PackManifest) => m.files.reduce((a, f) => a + f.size, 0);

/** The name of a pack in a language. */
export function packName(e: { name: CatalogEntry['name'] | string }, lang: string): string {
  if (typeof e.name === 'string') return e.name;
  return (e.name as Record<string, string | undefined>)[lang] ?? e.name.en;
}

const area = (b: [number, number, number, number]) => Math.max(1e-9, (b[2] - b[0]) * (b[3] - b[1]));
const inBox = (b: [number, number, number, number], p: [number, number]) => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3];

/** Of these packs, the one with the point inside (the smallest, where boxes overlap). */
export function packAt<T extends { manifest: PackManifest }>(packs: T[], p: [number, number]): T | null {
  return packs.filter((x) => inBox(x.manifest.bbox, p)).sort((a, b) => area(a.manifest.bbox) - area(b.manifest.bbox))[0] ?? null;
}

/** The pack with every point inside, else the one with the first point (a route out of the pack fails there). */
export function packFor<T extends { manifest: PackManifest }>(packs: T[], points: [number, number][]): T | null {
  if (!points.length) return packs[0] ?? null;
  const all = packs.filter((x) => points.every((p) => inBox(x.manifest.bbox, p))).sort((a, b) => area(a.manifest.bbox) - area(b.manifest.bbox));
  return all[0] ?? packAt(packs, points[0]);
}

/**
 * Before any catalog is published: the one pack published with the site, as a catalog of one.
 */
export function catalogFromManifest(m: PackManifest, base: string): Catalog {
  const abs = { ...m, files: m.files.map((f) => ({ ...f, parts: f.parts.map((p) => ({ ...p, path: new URL(p.path, base).href })) })) };
  return { v: 1, built: m.built, packs: [{ id: m.id, name: { en: m.name }, group: 'sea', bbox: m.bbox, manifest: abs, web: true }] };
}

/**
 * Downloads one part with the phone's own HTTP client (no CORS) into the app's cache, and
 * returns it as a stream read from there (then deleted).
 */
async function nativePart(url: string, onBytes: (n: number) => void): Promise<ReadableStream<Uint8Array>> {
  const [{ Filesystem, Directory }, { Capacitor }] = await Promise.all([import('@capacitor/filesystem'), import('@capacitor/core')]);
  const path = `jn-pack-${Math.random().toString(36).slice(2)}.part`;
  let seen = 0;
  const listener = await Filesystem.addListener('progress', (p) => {
    if (p.url !== url) return;
    onBytes(p.bytes - seen);
    seen = p.bytes;
  });
  try {
    await Filesystem.downloadFile({ url, path, directory: Directory.Cache, progress: true, connectTimeout: 30_000, readTimeout: 60_000 });
  } finally {
    void listener.remove();
  }
  const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
  const res = await fetch(Capacitor.convertFileSrc(uri));
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
  const reader = res.body.getReader();
  const done = () => void Filesystem.deleteFile({ path, directory: Directory.Cache }).catch(() => {});
  return new ReadableStream<Uint8Array>({
    async pull(c) {
      const r = await reader.read();
      if (r.done) {
        done();
        return c.close();
      }
      c.enqueue(r.value);
    },
    cancel() {
      void reader.cancel();
      done();
    },
  });
}

export class OfflineStore {
  state: PackState = { status: 'idle' };
  installed: InstalledPack[] = [];
  /** Downloads under way, waiting, paused or failed, by pack id. */
  jobs = new Map<string, JobState>();
  private queue: string[] = [];
  private active: string | null = null;
  private kv = safeStorage('local');
  private listeners = new Set<(s: PackState) => void>();
  private ctrl: AbortController | null = null;
  private assetsIndex: Record<string, [number, number]> | null = null;
  private assetsFile: File | null = null;
  private catalogCache: Catalog | null = null;
  private catalogAt = 0;
  readonly catalogUrl: string;

  constructor(public manifestUrl = PACK_URL ?? new URL('offline/manifest.json', document.baseURI).href) {
    this.catalogUrl = new URL('catalog.json', this.manifestUrl).href;
    const fs = (navigator as Navigator & { storage?: StorageManager }).storage;
    const writable = typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype;
    if (!fs?.getDirectory || !writable) this.state = { status: 'unsupported' };
  }

  get supported(): boolean {
    return this.state.status !== 'unsupported';
  }

  /** Any pack is on this device. */
  get ready(): boolean {
    return this.installed.length > 0;
  }

  onChange(fn: (s: PackState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit() {
    if (this.state.status !== 'unsupported') this.state = this.active || this.queue.length ? { status: 'busy' } : { status: 'idle' };
    for (const fn of this.listeners) fn(this.state);
  }

  private setJob(id: string, j: JobState | null) {
    if (j) this.jobs.set(id, j);
    else this.jobs.delete(id);
  }

  private async folder(name: string, create = false): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    const packs = await root.getDirectoryHandle('packs', { create });
    return packs.getDirectoryHandle(name, { create });
  }

  private names(): string[] {
    try {
      const v = JSON.parse(this.kv.get(PACKS_KEY) || '[]') as unknown;
      return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
    } catch {
      return [];
    }
  }

  private saveNames() {
    this.kv.set(PACKS_KEY, JSON.stringify(this.installed.map((p) => p.dir[1])));
  }

  /** Finds the packs on this device and any unfinished downloads. */
  async init(): Promise<void> {
    if (!this.supported) return;
    // From the time there was one pack: it joins the list, its unfinished update keeps going.
    const legacy = this.kv.get(LEGACY_PACK_KEY);
    if (legacy) {
      const list = this.names();
      if (!list.includes(legacy)) list.push(legacy);
      this.kv.set(PACKS_KEY, JSON.stringify(list));
      this.kv.remove(LEGACY_PACK_KEY);
    }
    const oldProgress = this.kv.get(LEGACY_PROGRESS_KEY);
    if (oldProgress) {
      try {
        const p = JSON.parse(oldProgress) as Progress;
        if (p?.id) this.kv.set(progressKey(p.id), oldProgress);
      } catch {
        /* dropped */
      }
      this.kv.remove(LEGACY_PROGRESS_KEY);
    }
    const found: InstalledPack[] = [];
    for (const name of this.names()) {
      try {
        const dir = await this.folder(name);
        const m = JSON.parse(await (await (await dir.getFileHandle('manifest.json')).getFile()).text()) as PackManifest;
        found.push({ id: m.id, manifest: m, bytes: deviceSize(m), dir: ['packs', name] });
      } catch {
        /* gone: dropped from the list */
      }
    }
    this.installed = found;
    this.saveNames();
    // Unfinished downloads from an earlier visit show as paused once the catalog gives their sizes.
    const pending: string[] = [];
    try {
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith('junctionnav.offline.progress.')) pending.push(k);
      }
    } catch {
      /* storage unavailable */
    }
    if (pending.length) {
      try {
        const cat = await this.catalog();
        for (const k of pending) {
          const p = this.progress(k.slice('junctionnav.offline.progress.'.length));
          const e = p && cat.packs.find((x) => x.id === p.id);
          if (e && p && e.manifest.version === p.version) this.setJob(e.id, { status: 'paused', ...this.counts(e.manifest, p) });
        }
      } catch {
        /* offline or no catalog yet */
      }
    }
    this.emit();
  }

  /** The countries and regions on offer (kept for ten minutes unless `force`). */
  async catalog(force = false): Promise<Catalog> {
    if (this.catalogCache && !force && Date.now() - this.catalogAt < 10 * 60_000) return this.catalogCache;
    const notYet = 'The offline maps are still being prepared on the server (this takes a while after an update). Try again in a few minutes.';
    let cat: Catalog | null = null;
    try {
      const res = await fetch(this.catalogUrl, { cache: 'no-cache' });
      if (res.ok) cat = JSON.parse(await res.text()) as Catalog;
    } catch {
      /* the single pack below, or the error */
    }
    if (!cat?.packs?.length) {
      // Before the first catalog: the pack published with the site.
      const res = await fetch(this.manifestUrl, { cache: 'no-cache' }).catch(() => null);
      if (!res) throw new Error('Could not get the offline map list. Check your connection and try again.');
      if (!res.ok) throw new Error(res.status === 404 ? notYet : `Could not get the offline map list (${res.status}). Try again.`);
      try {
        cat = catalogFromManifest(JSON.parse(await res.text()) as PackManifest, this.manifestUrl);
      } catch {
        throw new Error(notYet);
      }
    }
    // Part addresses relative to the catalog become absolute.
    for (const e of cat.packs) for (const f of e.manifest.files) for (const p of f.parts) p.path = new URL(p.path, this.catalogUrl).href;
    this.catalogCache = cat;
    this.catalogAt = Date.now();
    return cat;
  }

  /** The published pack that is newer than an installed one (by id), if any. */
  async updateFor(id: string): Promise<CatalogEntry | null> {
    const inst = this.installed.find((p) => p.id === id);
    if (!inst) return null;
    const e = (await this.catalog()).packs.find((x) => x.id === id);
    return e && e.manifest.version !== inst.manifest.version ? e : null;
  }

  /** Can this device download the pack here (the browser only the ones published with the site)? */
  canDownload(e: CatalogEntry): boolean {
    return this.supported && (e.web || NATIVE);
  }

  private progress(id: string): Progress | null {
    try {
      return JSON.parse(this.kv.get(progressKey(id)) || 'null') as Progress | null;
    } catch {
      return null;
    }
  }

  private counts(m: PackManifest, p: Progress) {
    let done = 0;
    let total = 0;
    for (const f of m.files) {
      const sizes = f.parts.map((x) => x.size);
      total += sizes.reduce((a, b) => a + b, 0);
      // Compressed files restart from the beginning, so only finished ones count.
      const n = p.files[f.name] ?? 0;
      done += f.gzip && n < f.parts.length ? 0 : sizes.slice(0, n).reduce((a, b) => a + b, 0);
    }
    return { done, total };
  }

  /** Pauses a download (or takes it out of the queue). */
  pause(id?: string) {
    const target = id ?? this.active;
    if (!target) return;
    if (target === this.active) {
      this.ctrl?.abort();
      return;
    }
    const i = this.queue.indexOf(target);
    if (i >= 0) {
      this.queue.splice(i, 1);
      const j = this.jobs.get(target);
      this.setJob(target, { status: 'paused', done: j?.done ?? 0, total: j?.total ?? 0 });
      this.emit();
    }
  }

  /** Downloads (or resumes, or updates) a pack; others wait their turn. Resolves when it is queued or done. */
  async download(id: string): Promise<void> {
    if (!this.supported) return;
    if (this.active === id || this.queue.includes(id)) return;
    let e: CatalogEntry | undefined;
    try {
      e = (await this.catalog()).packs.find((x) => x.id === id);
    } catch (err) {
      this.setJob(id, { status: 'error', message: (err as Error).message, done: 0, total: 0 });
      return this.emit();
    }
    if (!e) {
      this.setJob(id, { status: 'error', message: 'These offline maps are not on offer any more.', done: 0, total: 0 });
      return this.emit();
    }
    if (!this.canDownload(e)) {
      this.setJob(id, { status: 'error', message: 'These maps download in the JunctionNav Android app.', done: 0, total: 0 });
      return this.emit();
    }
    const j = this.jobs.get(id);
    this.setJob(id, { status: 'queued', done: j?.done ?? 0, total: j?.total ?? downloadSize(e.manifest) });
    this.queue.push(id);
    this.emit();
    if (!this.active) await this.next();
  }

  private async next(): Promise<void> {
    while (!this.active && this.queue.length) {
      const id = this.queue.shift()!;
      this.active = id;
      try {
        await this.run(id);
      } finally {
        this.active = null;
        this.ctrl = null;
        this.emit();
      }
    }
  }

  private async run(id: string): Promise<void> {
    let e: CatalogEntry | undefined;
    try {
      e = (await this.catalog()).packs.find((x) => x.id === id);
      if (!e) throw new Error('These offline maps are not on offer any more.');
    } catch (err) {
      this.setJob(id, { status: 'error', message: (err as Error).message, done: 0, total: 0 });
      return;
    }
    const m = e.manifest;
    const name = folderOf(m);
    if (this.installed.some((p) => p.dir[1] === name)) {
      this.setJob(id, null);
      return;
    }
    let p = this.progress(id);
    if (!p || p.version !== m.version) {
      if (p) await this.removeFolder(folderOf(p));
      p = { id, version: m.version, files: {} };
      await this.removeFolder(name);
    }
    const prog = p;
    const saveP = () => this.kv.set(progressKey(id), JSON.stringify(prog));
    saveP();
    const { total } = this.counts(m, p);
    let { done } = this.counts(m, p);

    try {
      await this.keep();
      const est = await navigator.storage.estimate?.();
      const need = (total - done) * 1.05 + m.files.filter((f) => f.gzip).reduce((a, f) => a + f.size, 0) * 0.1;
      if (est?.quota != null && est.usage != null && est.quota - est.usage < need) {
        this.setJob(id, { status: 'error', message: `Not enough free space on this device: about ${Math.ceil(need / 1048576)} MB is needed.`, done, total });
        return;
      }
    } catch {
      /* estimates are optional */
    }

    const ctrl = (this.ctrl = new AbortController());
    let lastEmit = 0;
    const tick = (n: number) => {
      done += n;
      const now = performance.now();
      if (now - lastEmit > 250) {
        lastEmit = now;
        this.setJob(id, { status: 'downloading', done, total });
        this.emit();
      }
    };
    // Packs on GitHub's release servers: the phone's own HTTP client (they send no CORS headers).
    const native = NATIVE && !e.web;
    /** A part as a stream, and whether its bytes were counted already (native downloads count as they arrive). */
    const get = async (url: string): Promise<{ body: ReadableStream<Uint8Array>; counted: boolean }> => {
      if (native) {
        if (ctrl.signal.aborted) throw new DOMException('Paused', 'AbortError');
        return { body: await nativePart(url, tick), counted: true };
      }
      const res = await fetch(url, { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
      return { body: res.body, counted: false };
    };
    this.setJob(id, { status: 'downloading', done, total });
    this.emit();
    try {
      const dir = await this.folder(name, true);
      for (const f of m.files) {
        const finished = p.files[f.name] ?? 0;
        if (finished >= f.parts.length) continue;
        if (f.gzip) {
          // One gzip stream spread over the parts: fetch them in order and decompress on the fly.
          p.files[f.name] = 0;
          let k = 0;
          let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
          let counted = false;
          const parts = new ReadableStream<Uint8Array>({
            async pull(c) {
              for (;;) {
                if (!reader) {
                  if (k >= f.parts.length) return c.close();
                  const got = await get(f.parts[k].path);
                  reader = got.body.getReader();
                  counted = got.counted;
                }
                const { value, done: end } = await reader.read();
                if (end) {
                  reader = null;
                  k++;
                  continue;
                }
                if (!counted) tick(value.length);
                c.enqueue(value);
                return;
              }
            },
            cancel() {
              void reader?.cancel();
            },
          });
          const h = await dir.getFileHandle(f.name, { create: true });
          const w = await h.createWritable({ keepExistingData: false });
          const gunzip = new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
          await parts.pipeThrough(gunzip).pipeTo(w, { signal: ctrl.signal });
          const size = (await h.getFile()).size;
          if (size !== f.size) throw new Error(`${f.name} arrived incomplete (${size} of ${f.size} bytes). Try again.`);
          p.files[f.name] = f.parts.length;
          saveP();
        } else {
          // Raw files stay in their parts; each one is committed on its own, so a pause loses at most one.
          for (let k = finished; k < f.parts.length; k++) {
            const h = await dir.getFileHandle(`${f.name}.${k}`, { create: true });
            const w = await h.createWritable({ keepExistingData: false });
            const before = done;
            const got = await get(f.parts[k].path);
            await got.body
              .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform: (c, out) => (got.counted || tick(c.length), out.enqueue(c)) }))
              .pipeTo(w, { signal: ctrl.signal });
            const size = (await h.getFile()).size;
            if (size !== f.parts[k].size) {
              done = before;
              throw new Error(`Part ${k + 1} of ${f.name} arrived incomplete. Try again.`);
            }
            p.files[f.name] = k + 1;
            saveP();
          }
        }
      }
      const mh = await dir.getFileHandle('manifest.json', { create: true });
      const w = await mh.createWritable();
      await w.write(JSON.stringify(m));
      await w.close();
      // An update replaces the older version of the same pack.
      const old = this.installed.find((x) => x.id === id);
      this.installed = [...this.installed.filter((x) => x.id !== id), { id, manifest: m, bytes: deviceSize(m), dir: ['packs', name] }];
      this.saveNames();
      this.kv.remove(progressKey(id));
      this.assetsIndex = null;
      this.assetsFile = null;
      this.setJob(id, null);
      if (old && old.dir[1] !== name) void this.removeFolder(old.dir[1]);
    } catch (err) {
      const counts = this.counts(m, p);
      if (ctrl.signal.aborted) this.setJob(id, { status: 'paused', ...counts });
      else
        this.setJob(id, {
          status: 'error',
          message: /fetch|network|load failed|connect|timeout|unable to resolve/i.test((err as Error).message) ? 'The download stopped: check your connection, then resume.' : (err as Error).message,
          ...counts,
        });
    }
  }

  private async removeFolder(name: string) {
    try {
      const root = await navigator.storage.getDirectory();
      const packs = await root.getDirectoryHandle('packs', { create: true });
      await packs.removeEntry(name, { recursive: true });
    } catch {
      /* nothing there */
    }
  }

  /** Whether the browser has promised not to clear the packs when space runs low (null: it cannot say). */
  async kept(): Promise<boolean | null> {
    // In the Android app the maps sit in the app's own data, which Android never clears to make room.
    if (NATIVE) return true;
    try {
      const s = navigator.storage;
      return s?.persisted ? await s.persisted() : null;
    } catch {
      return null;
    }
  }

  /**
   * Asks the browser to keep the packs when space runs low. Chrome, Edge and Safari decide on their
   * own (added to the home screen, bookmarked, used often), so asking again later can succeed.
   * Firefox asks the user instead, so `quiet` (the check at start-up) leaves it to a tap there.
   */
  async keep(quiet = false): Promise<boolean | null> {
    if (NATIVE) return true;
    try {
      const s = navigator.storage;
      if (!s?.persist) return null;
      if (await s.persisted?.()) return true;
      if (quiet && /firefox|fxios/i.test(navigator.userAgent)) return false;
      return await s.persist();
    } catch {
      return null;
    }
  }

  /** Stops and throws away an unfinished download (an installed version stays). */
  async cancel(id: string): Promise<void> {
    if (this.active === id) {
      this.ctrl?.abort();
      // Wait for the download to stop before removing its files.
      for (let i = 0; i < 50 && this.active === id; i++) await new Promise((r) => setTimeout(r, 100));
    }
    const qi = this.queue.indexOf(id);
    if (qi >= 0) this.queue.splice(qi, 1);
    const p = this.progress(id);
    if (p && !this.installed.some((x) => x.dir[1] === folderOf(p))) await this.removeFolder(folderOf(p));
    this.kv.remove(progressKey(id));
    this.setJob(id, null);
    this.emit();
  }

  /** Deletes a pack (and any unfinished update of it). */
  async remove(id: string): Promise<void> {
    await this.cancel(id);
    const inst = this.installed.find((x) => x.id === id);
    if (inst) await this.removeFolder(inst.dir[1]);
    this.installed = this.installed.filter((x) => x.id !== id);
    this.saveNames();
    this.assetsIndex = null;
    this.assetsFile = null;
    this.emit();
  }

  /** The pack covering a point (the smallest where several do). */
  at(p: [number, number]): InstalledPack | null {
    return packAt(this.installed, p);
  }

  /** The pack covering all these points, else the one at the first. */
  for(points: [number, number][]): InstalledPack | null {
    return packFor(this.installed, points);
  }

  /** A pack file. Raw files come back as one Blob made of their stored parts (no copying). */
  async file(pack: InstalledPack, name: string): Promise<Blob> {
    const dir = await this.folder(pack.dir[1]);
    const f = pack.manifest.files.find((x) => x.name === name);
    if (!f || f.gzip) return (await dir.getFileHandle(name)).getFile();
    const parts = await Promise.all(f.parts.map(async (_, k) => (await dir.getFileHandle(`${name}.${k}`)).getFile()));
    return parts.length === 1 ? parts[0] : new Blob(parts);
  }

  /** A font or sprite file from the bundled assets (any pack has them), or null when there is none. */
  async asset(path: string): Promise<ArrayBuffer | null> {
    if (!this.assetsIndex) {
      const pack = this.installed[0];
      if (!pack) return null;
      this.assetsIndex = JSON.parse(await (await this.file(pack, 'assets.json')).text()) as Record<string, [number, number]>;
      this.assetsFile = (await this.file(pack, 'assets.bin')) as File;
    }
    const at = this.assetsIndex[path];
    if (!at || !this.assetsFile) return null;
    return this.assetsFile.slice(at[0], at[0] + at[1]).arrayBuffer();
  }
}
