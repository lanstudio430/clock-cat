// 由 scripts/service-worker.ts 在建置時填入版本與檔案清單，請勿直接修改 docs/sw.js。
// 頁面先用快取開啟、背景再更新；有雜湊檔名的檔案內容不會變，直接用快取。
// Apps Script 的 API 請求是跨網域的，不經過這裡。
const CACHE = 'clock-cat-6b46b7d27d48';
const SHELL = [
  "./",
  "assets/iansui-MjSXw50J.woff2",
  "assets/index-9te07Zql.js",
  "assets/index-BHHDXyUa.css",
  "assets/mascot-COiunRr0.webp",
  "assets/nunito-latin-BzFMHfZw.woff2",
  "icons/apple-touch-icon.png",
  "icons/favicon-32.png",
  "icons/favicon-48.png",
  "icons/favicon.ico",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/icon-maskable-512.png",
  "manifest.webmanifest"
];
// 伺服器可能回 Vary: Origin，模組腳本的請求帶 Origin、預先快取時沒帶，忽略 Vary 才對得上
const MATCH = { ignoreSearch: true, ignoreVary: true };

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(SHELL.map((path) => new Request(path, { cache: 'reload' }))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((names) => Promise.all(names.filter((name) => name !== CACHE).map((name) => caches.delete(name))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  event.respondWith(request.mode === 'navigate' ? openPage(event) : fromCache(request));
});

// 頁面：先給快取裡的版本，背景抓新版存起來，下次開啟就是新版
async function openPage(event) {
  const cache = await caches.open(CACHE);
  const cached = (await cache.match('index.html', MATCH)) || (await cache.match('./', MATCH));
  const update = fetch(event.request, { cache: 'no-cache' })
    .then((response) => {
      if (response.ok) cache.put('index.html', response.clone());
      return response;
    })
    .catch(() => null);
  if (cached) {
    event.waitUntil(update);
    return cached;
  }
  return (await update) || Response.error();
}

async function fromCache(request) {
  const cached = await caches.match(request, MATCH);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) (await caches.open(CACHE)).put(request, response.clone());
  return response;
}
