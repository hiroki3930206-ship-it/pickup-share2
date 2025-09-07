// sw.js — 超シンプル版（同一オリジンGETをキャッシュ優先で返す）
const CACHE = 'pickup-share-v1';

// 初回インストール時に最低限キャッシュ
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) =>
      c.addAll([
        '/',              // ルート
        '/manifest.webmanifest',
        '/favicon.ico'
      ]).catch(() => {})
    )
  );
  self.skipWaiting();
});

// 新しいSWが有効化されたら、古いキャッシュを掃除
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// 取得：同一オリジンGETはキャッシュ優先 → なければネット → 取れたらキャッシュ
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;

  e.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE).then((c) => c.put(req, resClone)).catch(() => {});
        return res;
      }).catch(() => cached);
    })
  );
});
