/**
 * The Android app's two modes (Settings → App version):
 *
 * - **Built-in**: the copy of the web app built into the APK. Opens with no internet from the first
 *   start; changes when a newer installer is installed.
 * - **Website**: the latest build published on the website. The app downloads it (the files listed
 *   in the site's app-files.json, about 2.3 MB) into its own storage and runs it in place of the
 *   built-in copy, with Capacitor's WebView server pointed at that folder. The address stays
 *   https://localhost, so the account, saved places and offline maps are the same in both modes,
 *   and Android's voice, keep-awake and the back button keep working. At each start it looks for a
 *   newer build and switches to it while not navigating; offline, it runs the copy it has.
 *
 * Capacitor goes back to the built-in copy by itself after a new APK is installed; website mode
 * then switches to the latest build again at the next start.
 */
import { BUILT_IN, NATIVE, WEB_APP_URL } from '../platform';

export type AppMode = 'built-in' | 'web';

interface AppFiles {
  version: string;
  built: string;
  files: { path: string; size: number }[];
}

export interface WebCopy {
  version: string;
  built: string;
  /** Folder on the device (absolute path) the WebView serves the copy from. */
  path: string;
}

const KEY = 'junctionnav.webApp';
const ROOT = 'web-app';

const core = () => import('@capacitor/core');
const files = () => import('@capacitor/filesystem');

function read(): WebCopy | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null') as WebCopy | null;
  } catch {
    return null;
  }
}

function write(c: WebCopy | null) {
  try {
    if (c) localStorage.setItem(KEY, JSON.stringify(c));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage unavailable */
  }
}

/** The website build downloaded into the app, if any. */
export function webCopy(): WebCopy | null {
  return read();
}

/** What is running now, for Settings. */
export function runningCopy(): { kind: AppMode; built?: string } {
  return BUILT_IN ? { kind: 'built-in' } : { kind: 'web', built: read()?.built };
}

async function has(c: WebCopy): Promise<boolean> {
  try {
    const { Filesystem, Directory } = await files();
    await Filesystem.stat({ path: `${ROOT}/${c.version}/index.html`, directory: Directory.Data });
    return true;
  } catch {
    return false;
  }
}

function base64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

/**
 * Downloads the website's current build into the app, unless that version is already here.
 * Every file is checked against its listed size before the copy counts as installed.
 */
export async function downloadLatest(onProgress?: (done: number, total: number) => void): Promise<WebCopy> {
  if (!WEB_APP_URL) throw new Error('This build does not know the website address.');
  const res = await fetch(new URL('app-files.json', WEB_APP_URL).href, { cache: 'no-store' });
  if (!res.ok) throw new Error(`The website did not answer (${res.status}).`);
  const m = (await res.json()) as AppFiles;
  const have = read();
  if (have && have.version === m.version && (await has(have))) return have;
  const { Filesystem, Directory } = await files();
  const dir = `${ROOT}/${m.version}`;
  const total = m.files.reduce((a, f) => a + f.size, 0);
  let done = 0;
  // index.html last: a copy without it is never used.
  const order = [...m.files.filter((f) => f.path !== 'index.html'), ...m.files.filter((f) => f.path === 'index.html')];
  for (const f of order) {
    const r = await fetch(new URL(f.path, WEB_APP_URL).href, { cache: 'no-store' });
    if (!r.ok) throw new Error(`Could not download ${f.path} (${r.status}).`);
    const buf = await r.arrayBuffer();
    if (buf.byteLength !== f.size) throw new Error(`${f.path} arrived incomplete. Try again.`);
    await Filesystem.writeFile({ path: `${dir}/${f.path}`, data: base64(buf), directory: Directory.Data, recursive: true });
    done += f.size;
    onProgress?.(done, total);
  }
  const { uri } = await Filesystem.getUri({ path: dir, directory: Directory.Data });
  const copy: WebCopy = { version: m.version, built: m.built, path: decodeURIComponent(uri.replace(/^file:\/\//, '')) };
  write(copy);
  await tidy(copy);
  return copy;
}

/** Removes older downloaded builds, except the one running now (its pages may still load files). */
async function tidy(keep: WebCopy) {
  try {
    const { Filesystem, Directory } = await files();
    const { WebView } = await core();
    const running = (await WebView.getServerBasePath()).path;
    const list = await Filesystem.readdir({ path: ROOT, directory: Directory.Data });
    for (const e of list.files) {
      if (e.name === keep.version || (running && running.endsWith(`/${ROOT}/${e.name}`))) continue;
      await Filesystem.rmdir({ path: `${ROOT}/${e.name}`, directory: Directory.Data, recursive: true });
    }
  } catch {
    /* nothing to tidy */
  }
}

/** Runs a downloaded build (the WebView reloads into it). */
async function runCopy(c: WebCopy) {
  const { WebView } = await core();
  await WebView.setServerBasePath({ path: c.path });
}

/** Runs the copy built into the APK (the WebView reloads into it). */
async function runBuiltIn() {
  const { WebView } = await core();
  await WebView.setServerAssetPath({ path: 'public' });
}

let pending: WebCopy | null = null;

export interface ModeHooks {
  /** Not navigating, so the app may reload. */
  idle(): boolean;
  notify(text: string): void;
}

/** A newer build waiting for the drive to end: switch to it now if the app is idle. */
export function applyPending(hooks: ModeHooks) {
  const c = pending;
  if (!c || !hooks.idle()) return;
  pending = null;
  hooks.notify('Opening the latest version of JunctionNav…');
  void runCopy(c);
}

/**
 * At each start of the Android app: keep the chosen mode for the next start, and in website mode
 * look for a newer build and switch to it (now if idle, else when the drive ends).
 */
export async function startAppMode(mode: AppMode, hooks: ModeHooks): Promise<void> {
  if (!NATIVE) return;
  const { WebView } = await core();
  if (mode === 'built-in') {
    // A downloaded build is running (just switched in Settings, or left over): back to the built-in one.
    if (!BUILT_IN) return runBuiltIn();
    // Start the built-in copy next time too (Capacitor stores its asset path, which is not a folder).
    await WebView.persistServerBasePath();
    return;
  }
  // Website mode: the running downloaded build starts next time as well.
  if (!BUILT_IN) await WebView.persistServerBasePath();
  const running = (await WebView.getServerBasePath()).path;
  let latest: WebCopy | null = null;
  try {
    latest = await downloadLatest();
  } catch (e) {
    // Offline, or the site is down: use the downloaded build if the built-in one is running.
    console.info('[app] could not check the website for a newer version:', (e as Error).message);
    const have = read();
    if (BUILT_IN && have && (await has(have))) latest = have;
  }
  if (!latest || running === latest.path) return;
  pending = latest;
  if (hooks.idle()) applyPending(hooks);
  else hooks.notify('The latest version of JunctionNav is ready; it opens when this drive ends.');
}

/** Settings changed the mode: switch now (website mode downloads the latest build first). */
export async function switchAppMode(mode: AppMode, hooks: ModeHooks): Promise<void> {
  if (!NATIVE) return;
  if (mode === 'built-in') {
    if (BUILT_IN) return startAppMode(mode, hooks);
    hooks.notify('Opening the built-in version…');
    return runBuiltIn();
  }
  hooks.notify('Getting the latest version from the website…');
  let last = 0;
  const copy = await downloadLatest((done, total) => {
    const pct = Math.floor((done / total) * 100);
    if (pct - last >= 25 && pct < 100) {
      last = pct;
      hooks.notify(`Getting the latest version… ${pct}%`);
    }
  });
  const { WebView } = await core();
  if ((await WebView.getServerBasePath()).path === copy.path) {
    hooks.notify('You already have the latest version.');
    return;
  }
  pending = copy;
  if (hooks.idle()) applyPending(hooks);
  else hooks.notify('The latest version is ready; it opens when this drive ends.');
}
