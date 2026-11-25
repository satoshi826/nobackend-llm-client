// Service Worker: caches only the app itself (same-origin static files) so it can start offline.
// - never touches requests to other origins such as APIs (conversation content is never cached)
// - the page (index.html) is network-first, falling back to cache only on failure (so updates apply immediately)
// - /assets/ is cache-first since file names carry a hash
// - every built script and stylesheet is cached at install (PRECACHE, filled in by the build:
//   vite.config.ts serviceWorkerPlugin), so screens that load their code later (components/lazy.tsx)
//   also open offline. Files a build no longer has are removed when the new worker activates;
//   files that did not change keep their cached copy.
// - handles only the app page (/). Leaves the vault page (/vault/) alone
// - /index.html gets redirected to / by the host, so the cache key is always /
//   (browsers refuse to render a page from a redirected response)
const CACHE = 'app-shell-v3';
const SHELL = ['/', '/favicon.svg', '/manifest.webmanifest'];
/** Scripts and stylesheets of this build (filled in by the build) */
const PRECACHE = self.__PRECACHE__ ?? [];
/** Every file under /assets/ in this build, including ones only cached when used (fonts) */
const KNOWN = new Set(self.__ASSETS__ ?? []);
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
      // Drop assets the current build no longer has
      if (KNOWN.size) {
        const cache = await caches.open(CACHE);
        for (const req of await cache.keys()) {
          const path = new URL(req.url).pathname;
          if (path.startsWith('/assets/') && !KNOWN.has(path)) await cache.delete(req);
        }
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
    if (url.pathname !== '/' && url.pathname !== '/index.html') return; // pages other than the app (e.g. the vault) pass through
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok && !res.redirected) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put('/', copy));
          }
          return res;
        })
        .catch(() => caches.match('/'))
    );
    return;
  }
  if (url.pathname.startsWith('/assets/')) {
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
