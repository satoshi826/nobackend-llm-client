// Service Worker: caches only the app itself (same-origin static files) so it can start offline.
// - never touches requests to other origins such as APIs (conversation content is never cached)
// - the pages are network-first, falling back to cache only on failure (so updates apply immediately): the app, and
//   the key vault when it is on this origin (the app waits for it before its first screen, so it has to open offline
//   too). Not the fetch page (it is for reaching the web) or the sandbox
// - assets/ is cache-first since file names carry a hash
// - every built script, stylesheet and font is cached at install (PRECACHE, filled in by the build:
//   vite.config.ts serviceWorkerPlugin), so screens that load their code later (components/lazy.tsx)
//   also open offline, and look the same (the first visit loads its fonts before the worker controls the page).
//   Files that did not change keep their cached copy across updates.
// - a tab opened before an update keeps running its build, and may load more of that build's files later (PDF
//   reading, code highlighting), which the host no longer has. So the files of the build before stay cached until
//   the next update; only older ones are removed when a new worker activates
// - <page>index.html gets redirected to <page> by the host, so the cache key is always the folder
//   (browsers refuse to render a page from a redirected response); the vault's address carries its options after ?,
//   which the key leaves out
// - paths are under the scope: '/' at a domain root, '/repo/' under a subpath (VITE_BASE_PATH)
const CACHE = 'app-shell-v3';
const BASE = new URL(self.registration.scope).pathname;
const ASSETS = `${BASE}assets/`;
/** The pages it serves (filled in by the build) */
const PAGES = self.__PAGES__ ?? [BASE];
const SHELL = [...PAGES, `${BASE}favicon.svg`, `${BASE}manifest.webmanifest`];
/** Scripts, stylesheets and fonts of this build (filled in by the build) */
const PRECACHE = self.__PRECACHE__ ?? [];
/** Every file under assets/ in this build, including ones only cached when used (the image tag list) */
const KNOWN = new Set(self.__ASSETS__ ?? []);
/** Where the cache keeps the asset list of the build that activated last, for the next one to read */
const LISTED = `${BASE}sw-assets.json`;
/** A real asset, not a page some host returns for a missing file (that must never be cached as a script) */
const isAsset = (res) => res.ok && !(res.headers.get('content-type') ?? '').includes('text/html');

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      await cache.addAll(SHELL);
      // Only what is not cached yet: unchanged files keep their copy across updates
      const missing = [];
      for (const url of PRECACHE) {
        const hit = await cache.match(url);
        if (!hit || !isAsset(hit)) missing.push(url);
      }
      await cache.addAll(missing);
      await self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
      // Drop assets neither this build nor the one before has (none when the one before is not known)
      if (KNOWN.size) {
        const cache = await caches.open(CACHE);
        const before = await cache.match(LISTED).then((r) => r?.json()).catch(() => null);
        if (Array.isArray(before)) {
          const keep = new Set([...KNOWN, ...before]);
          for (const req of await cache.keys()) {
            const path = new URL(req.url).pathname;
            if (path.startsWith(ASSETS) && !keep.has(path)) await cache.delete(req);
          }
        }
        await cache.put(LISTED, new Response(JSON.stringify([...KNOWN]), { headers: { 'Content-Type': 'application/json' } }));
      }
      await self.clients.claim();
    })()
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return; // external (APIs etc.) passes through
  if (req.mode === 'navigate') {
    const page = PAGES.find((p) => url.pathname === p || url.pathname === `${p}index.html`);
    if (!page) return; // other pages (the fetch page, the sandbox) pass through
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(page, copy));
          }
          return res;
        })
        .catch(() => caches.match(page))
    );
    return;
  }
  if (url.pathname.startsWith(ASSETS)) {
    event.respondWith(
      caches.match(req).then(
        (hit) =>
          (hit && isAsset(hit) ? hit : null) ||
          fetch(req).then((res) => {
            if (isAsset(res)) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
