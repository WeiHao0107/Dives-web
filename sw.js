/* =========================================================================
 * sw.js — Service Worker：App 殼層採「網路優先」（永遠拿最新，離線才用快取）
 * ======================================================================= */
const CACHE = 'dives-v138';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/util.js',
  './js/store.js',
  './js/futures.js',
  './js/calc.js',
  './js/csv.js',
  './js/api.js',
  './js/charts.js',
  './js/ui.js',
  './js/sync.js',
  './js/auth.js',
  './js/views.js',
  './js/views-futures.js',
  './js/app.js',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // 同源殼層 → 網路優先（拿最新），失敗（離線）才回退快取
  // cache:'no-cache' = 向伺服器驗證（304 很便宜），否則 fetch 會先吃瀏覽器 HTTP 快取（GitHub Pages max-age=600），
  // 改版後最多 10 分鐘仍拿到舊 JS
  if (url.origin === location.origin) {
    e.respondWith(
      fetch(req.url, { cache: 'no-cache' }).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match(req).then(c => c || caches.match('./index.html')))
    );
    return;
  }
  // 外部 API（報價/匯率） → 直接走網路，不快取
});
