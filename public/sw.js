// Service Worker: caches only the app itself (same-origin static files) so it can start offline.
// - never touches requests to other origins such as APIs (conversation content is never cached)
// - the page (index.html) is network-first, falling back to cache only on failure (so updates apply immediately)
// - /assets/ is cache-first since file names carry a hash
// - handles only the app page (/). Leaves the vault page (/vault/) alone
// - /index.html gets redirected to / by the host, so the cache key is always /
//   (browsers refuse to render a page from a redirected response)
const CACHE = 'app-shell-v2';
const SHELL = ['/', '/favicon.svg', '/manifest.webmanifest'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
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
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone();
              caches.open(CACHE).then((c) => c.put(req, copy));
            }
            return res;
          })
      )
    );
  }
});
