// 離線外殼：頁面與靜態檔先用快取開啟，背景再更新（下次開啟就是新版）。
// Apps Script 的 API 請求不經過這裡。
const CACHE = 'clock-cat-v1';
const SHELL = [
  './',
  'index.html',
  'app.js',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/apple-touch-icon.png',
  'vendor/fontawesome/css/fontawesome.min.css',
  'vendor/fontawesome/css/solid.min.css',
  'vendor/fontawesome/css/regular.min.css',
  'vendor/fontawesome/webfonts/fa-solid-900.woff2',
  'vendor/fontawesome/webfonts/fa-regular-400.woff2'
];
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  const url = new URL(request.url);
  const sameOrigin = url.origin === self.location.origin;

  if (request.method !== 'GET' || !(sameOrigin || FONT_HOSTS.includes(url.hostname))) return;
  event.respondWith(staleWhileRevalidate(event, sameOrigin));
});

async function staleWhileRevalidate(event, sameOrigin) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(event.request, { ignoreSearch: true });

  // 同源檔案要繞過瀏覽器的 HTTP 快取，才能馬上拿到新版
  const update = fetch(sameOrigin ? event.request.url : event.request, sameOrigin ? { cache: 'no-cache' } : undefined)
    .then((response) => {
      if (response.ok) cache.put(event.request, response.clone());
      return response;
    })
    .catch(() => null);

  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) || Response.error();
}
