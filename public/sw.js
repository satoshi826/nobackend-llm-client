// Service Worker: アプリ本体（同一オリジンの静的ファイル）だけをキャッシュしてオフライン起動を可能にする。
// - API など別オリジンへの通信には一切関与しない（会話内容はキャッシュしない）
// - ページ（index.html）はネットワーク優先 → 失敗時のみキャッシュ（更新をすぐ反映するため）
// - /assets/ はファイル名にハッシュが付くのでキャッシュ優先
// - 本体のページ（/）だけを扱う。金庫（/vault/）のページには関与しない
// - /index.html は配信元によって / へリダイレクトされるので、キャッシュの鍵は / に統一する
//   （リダイレクトされた応答をページの表示に使うとブラウザが拒否するため）
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
  if (url.origin !== self.location.origin) return; // 外部（API 等）は素通し

  if (req.mode === 'navigate') {
    if (url.pathname !== '/' && url.pathname !== '/index.html') return; // 金庫など、本体以外のページは素通し
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
