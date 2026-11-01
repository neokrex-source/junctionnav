/**
 * The offline pack in browser storage (Origin Private File System): download with progress,
 * pause and resume, update, delete, and file access for the map and the offline worker.
 *
 * Layout: packs/<id>-<version>/ holds manifest.json, the decompressed gzip files (graph.bin,
 * places.bin, assets.bin, assets.json) and raw files kept as their published parts
 * (tiles.pmtiles.0, .1, ...), which are joined into one Blob for reading. Keeping parts separate
 * means a resumed or interrupted download never rewrites what is already stored.
 */
import { safeStorage } from '../auth/types';
import type { PackManifest } from './graphLayout';

export type PackState =
  | { status: 'unsupported' }
  | { status: 'idle' }
  | { status: 'downloading'; done: number; total: number; manifest: PackManifest }
  | { status: 'paused'; done: number; total: number; manifest: PackManifest }
  | { status: 'error'; message: string; done: number; total: number; manifest?: PackManifest };

export interface InstalledPack {
  manifest: PackManifest;
  bytes: number;
  /** Folder path inside browser storage, for the worker. */
  dir: string[];
}

const PACK_KEY = 'junctionnav.offline.pack';
const PROGRESS_KEY = 'junctionnav.offline.progress';

interface Progress {
  id: string;
  version: string;
  /** Finished parts per file. */
  files: Record<string, number>;
}

const folderOf = (m: { id: string; version: string }) => `${m.id}-${m.version}`.replace(/[^\w.-]+/g, '_');

export class OfflineStore {
  state: PackState = { status: 'idle' };
  installed: InstalledPack | null = null;
  private kv = safeStorage('local');
  private listeners = new Set<(s: PackState) => void>();
  private ctrl: AbortController | null = null;
  private assetsIndex: Record<string, [number, number]> | null = null;
  private assetsFile: File | null = null;

  constructor(public manifestUrl = new URL('offline/manifest.json', document.baseURI).href) {
    const fs = (navigator as Navigator & { storage?: StorageManager }).storage;
    const writable = typeof FileSystemFileHandle !== 'undefined' && 'createWritable' in FileSystemFileHandle.prototype;
    if (!fs?.getDirectory || !writable) this.state = { status: 'unsupported' };
  }

  get supported(): boolean {
    return this.state.status !== 'unsupported';
  }

  onChange(fn: (s: PackState) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  private emit(s: PackState) {
    this.state = s;
    for (const fn of this.listeners) fn(s);
  }

  get ready(): boolean {
    return !!this.installed;
  }

  private async folder(name: string, create = false): Promise<FileSystemDirectoryHandle> {
    const root = await navigator.storage.getDirectory();
    const packs = await root.getDirectoryHandle('packs', { create });
    return packs.getDirectoryHandle(name, { create });
  }

  /** Looks for an installed pack and any unfinished download. */
  async init(): Promise<void> {
    if (!this.supported) return;
    const name = this.kv.get(PACK_KEY);
    if (name) {
      try {
        const dir = await this.folder(name);
        const m = JSON.parse(await (await (await dir.getFileHandle('manifest.json')).getFile()).text()) as PackManifest;
        this.installed = { manifest: m, bytes: m.files.reduce((a, f) => a + f.size, 0), dir: ['packs', name] };
      } catch {
        this.kv.remove(PACK_KEY);
      }
    }
    const p = this.progress();
    if (p) {
      // An unfinished download from an earlier visit: show it as paused once we know the sizes.
      try {
        const m = await this.remote();
        if (m.version === p.version && m.id === p.id) return this.emit({ status: 'paused', ...this.counts(m, p), manifest: m });
      } catch {
        /* offline or no pack published */
      }
    }
    this.emit({ status: 'idle' });
  }

  /** The pack published with the site. */
  async remote(): Promise<PackManifest> {
    const res = await fetch(this.manifestUrl, { cache: 'no-cache' });
    if (!res.ok)
      throw new Error(
        res.status === 404
          ? 'The offline maps are still being prepared on the server (this takes about 20 minutes after an update). Tap Download again in a few minutes.'
          : `Could not get the offline map list (${res.status}). Tap Download to try again.`,
      );
    return (await res.json()) as PackManifest;
  }

  /** Is the published pack newer than the installed one? */
  async updateAvailable(): Promise<PackManifest | null> {
    if (!this.installed) return null;
    const m = await this.remote();
    return m.id === this.installed.manifest.id && m.version === this.installed.manifest.version ? null : m;
  }

  private progress(): Progress | null {
    try {
      return JSON.parse(this.kv.get(PROGRESS_KEY) || 'null') as Progress | null;
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

  pause() {
    this.ctrl?.abort();
  }

  /** Downloads (or resumes, or updates to) the published pack. Resolves when finished, paused or failed. */
  async download(): Promise<void> {
    if (this.state.status === 'downloading' || !this.supported) return;
    let m: PackManifest;
    try {
      m = await this.remote();
    } catch (e) {
      this.emit({ status: 'error', message: (e as Error).message, done: 0, total: 0 });
      return;
    }
    const name = folderOf(m);
    if (this.installed && this.installed.dir[1] === name) return this.emit({ status: 'idle' });
    let p = this.progress();
    if (!p || p.id !== m.id || p.version !== m.version) {
      if (p) await this.removeFolder(folderOf(p));
      p = { id: m.id, version: m.version, files: {} };
      await this.removeFolder(name);
    }
    const prog = p;
    const saveP = () => this.kv.set(PROGRESS_KEY, JSON.stringify(prog));
    saveP();
    const { total } = this.counts(m, p);
    let { done } = this.counts(m, p);

    try {
      await this.keep();
      const est = await navigator.storage.estimate?.();
      const need = (total - done) * 1.05 + m.files.filter((f) => f.gzip).reduce((a, f) => a + f.size, 0) * 0.1;
      if (est?.quota != null && est.usage != null && est.quota - est.usage < need) {
        this.emit({ status: 'error', message: `Not enough free space on this device: about ${Math.ceil(need / 1048576)} MB is needed.`, done, total, manifest: m });
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
        this.emit({ status: 'downloading', done, total, manifest: m });
      }
    };
    const url = (path: string) => new URL(path, this.manifestUrl).href;
    const get = async (path: string) => {
      const res = await fetch(url(path), { signal: ctrl.signal, cache: 'no-store' });
      if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}).`);
      return res.body;
    };
    this.emit({ status: 'downloading', done, total, manifest: m });
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
          const parts = new ReadableStream<Uint8Array>({
            async pull(c) {
              for (;;) {
                if (!reader) {
                  if (k >= f.parts.length) return c.close();
                  reader = (await get(f.parts[k].path)).getReader();
                }
                const { value, done: end } = await reader.read();
                if (end) {
                  reader = null;
                  k++;
                  continue;
                }
                tick(value.length);
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
            await (await get(f.parts[k].path))
              .pipeThrough(new TransformStream<Uint8Array, Uint8Array>({ transform: (c, out) => (tick(c.length), out.enqueue(c)) }))
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
      const old = this.installed?.dir[1];
      this.kv.set(PACK_KEY, name);
      this.kv.remove(PROGRESS_KEY);
      this.assetsIndex = null;
      this.assetsFile = null;
      this.installed = { manifest: m, bytes: m.files.reduce((a, f) => a + f.size, 0), dir: ['packs', name] };
      this.emit({ status: 'idle' });
      if (old && old !== name) void this.removeFolder(old);
    } catch (e) {
      const counts = this.counts(m, p);
      if (ctrl.signal.aborted) this.emit({ status: 'paused', ...counts, manifest: m });
      else
        this.emit({
          status: 'error',
          message: /fetch|network|load failed/i.test((e as Error).message) ? 'The download stopped: check your connection, then resume.' : (e as Error).message,
          ...counts,
          manifest: m,
        });
    } finally {
      this.ctrl = null;
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

  /** Whether the browser has promised not to clear the pack when space runs low (null: it cannot say). */
  async kept(): Promise<boolean | null> {
    try {
      const s = navigator.storage;
      return s?.persisted ? await s.persisted() : null;
    } catch {
      return null;
    }
  }

  /**
   * Asks the browser to keep the pack when space runs low. Chrome, Edge and Safari decide on their
   * own (added to the home screen, bookmarked, used often), so asking again later can succeed.
   * Firefox asks the user instead, so `quiet` (the check at start-up) leaves it to a tap there.
   */
  async keep(quiet = false): Promise<boolean | null> {
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

  /** Stops and throws away an unfinished download (the installed pack stays). */
  async cancel(): Promise<void> {
    this.pause();
    const p = this.progress();
    if (p) await this.removeFolder(folderOf(p));
    this.kv.remove(PROGRESS_KEY);
    this.emit({ status: 'idle' });
  }

  /** Deletes the installed pack and any unfinished download. */
  async remove(): Promise<void> {
    await this.cancel();
    if (this.installed) await this.removeFolder(this.installed.dir[1]);
    this.installed = null;
    this.kv.remove(PACK_KEY);
    this.assetsIndex = null;
    this.assetsFile = null;
    this.emit({ status: 'idle' });
  }

  private async installedDir(): Promise<FileSystemDirectoryHandle> {
    if (!this.installed) throw new Error('Offline maps are not downloaded');
    return this.folder(this.installed.dir[1]);
  }

  /** A pack file. Raw files come back as one Blob made of their stored parts (no copying). */
  async file(name: string): Promise<Blob> {
    const dir = await this.installedDir();
    const f = this.installed!.manifest.files.find((x) => x.name === name);
    if (!f || f.gzip) return (await dir.getFileHandle(name)).getFile();
    const parts = await Promise.all(f.parts.map(async (_, k) => (await dir.getFileHandle(`${name}.${k}`)).getFile()));
    return parts.length === 1 ? parts[0] : new Blob(parts);
  }

  /** A font or sprite file from the bundled assets, or null when the pack has none. */
  async asset(path: string): Promise<ArrayBuffer | null> {
    if (!this.assetsIndex) {
      this.assetsIndex = JSON.parse(await (await this.file('assets.json')).text()) as Record<string, [number, number]>;
      this.assetsFile = (await this.file('assets.bin')) as File;
    }
    const at = this.assetsIndex[path];
    if (!at || !this.assetsFile) return null;
    return this.assetsFile.slice(at[0], at[0] + at[1]).arrayBuffer();
  }
}
