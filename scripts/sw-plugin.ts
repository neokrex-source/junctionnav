/**
 * Vite plugin that writes sw.js: a small service worker that keeps the app itself (HTML, scripts,
 * styles, icons) on the device so JunctionNav opens with no internet. The offline map pack is
 * stored separately by the app and is never touched here.
 */
import { createHash } from 'node:crypto';
import { readFileSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Plugin } from 'vite';

const PUBLIC = ['manifest.webmanifest', 'icon.svg', 'icon-192.png', 'icon-512.png'];
/** Public files the Android app's website mode also needs (the page Capacitor shows on a load error). */
const APP_PUBLIC = [...PUBLIC, 'webview.html'];

export function serviceWorker(): Plugin {
  return {
    name: 'junctionnav-sw',
    apply: 'build',
    enforce: 'post',
    generateBundle(_opts, bundle) {
      const files = Object.keys(bundle)
        .filter((f) => !f.endsWith('.map') && !/^lab[.-]/.test(f) && !f.includes('/lab-'))
        .sort();
      const hash = createHash('sha256');
      for (const f of files) {
        const item = bundle[f];
        hash.update(f);
        hash.update(item.type === 'chunk' ? item.code : typeof item.source === 'string' ? item.source : Buffer.from(item.source));
      }
      const version = hash.digest('hex').slice(0, 12);
      const shell = ['./', ...files.filter((f) => f !== 'index.html'), ...PUBLIC];
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: source(version, shell) });
    },
    // Every file of this build as written, with its size, for the Android app's website mode,
    // which downloads the latest site into the app (src/native/appMode.ts) and checks each file.
    writeBundle(opts, bundle) {
      const dir = opts.dir ?? 'dist';
      const files = [
        ...Object.keys(bundle).filter((f) => !f.endsWith('.map') && !/^lab[.-]/.test(f) && !f.includes('/lab-') && f !== 'sw.js'),
        ...APP_PUBLIC,
      ].sort();
      const hash = createHash('sha256');
      const list = files.map((f) => {
        const buf = readFileSync(join(dir, f));
        hash.update(f);
        hash.update(buf);
        return { path: f, size: statSync(join(dir, f)).size };
      });
      writeFileSync(join(dir, 'app-files.json'), JSON.stringify({ version: hash.digest('hex').slice(0, 12), built: new Date().toISOString(), files: list }));
    },
  };
}

function source(version: string, shell: string[]): string {
  return `// Generated at build time. Keeps the app shell for offline use.
const VERSION = ${JSON.stringify(version)};
const SHELL = ${JSON.stringify(shell)};
const CACHE = 'jn-shell-' + VERSION;
const FONTS = 'jn-fonts';
const scope = new URL(self.registration.scope);

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((p) => new URL(p, scope).href))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k.startsWith('jn-shell-') && k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === scope.origin) {
    if (!url.pathname.startsWith(scope.pathname)) return;
    const rel = url.pathname.slice(scope.pathname.length);
    // The offline pack is large and is stored by the app itself.
    if (rel.startsWith('offline/') || rel === 'sw.js') return;
    if (req.mode === 'navigate') {
      // Fresh page when the network answers quickly, else the stored one.
      e.respondWith((async () => {
        try {
          const res = await Promise.race([fetch(req), timeout(4000)]);
          if (res.ok && (rel === '' || rel === 'index.html')) (await caches.open(CACHE)).put(new URL('./', scope).href, res.clone());
          return res;
        } catch {
          return (await caches.match(new URL('./', scope).href)) || Response.error();
        }
      })());
      return;
    }
    e.respondWith(caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req)));
    return;
  }
  if (url.hostname === 'fonts.googleapis.com' || url.hostname === 'fonts.gstatic.com') {
    // Web fonts: stored on first use, refreshed in the background.
    e.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => {
        if (res.ok || res.type === 'opaque') cache.put(req, res.clone());
        return res;
      });
      if (hit) {
        e.waitUntil(net.catch(() => {}));
        return hit;
      }
      return net;
    })());
  }
});
`;
}
