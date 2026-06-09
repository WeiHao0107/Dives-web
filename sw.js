/* =========================================================================
 * sw.js — Service Worker：App 殼層離線快取（網路優先抓報價，殼層快取優先）
 * ======================================================================= */
const CACHE = 'dives-v7';
const SHELL = [
  './',
  './index.html',
  './css/style.css',
  './js/util.js',
  './js/store.js',
  './js/calc.js',
  './js/csv.js',
  './js/api.js',
  './js/charts.js',
  './js/ui.js',
  './js/sync.js',
  './js/views.js',
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

  // 同源殼層 → cache-first
  if (url.origin === location.origin) {
    e.respondWith(
      caches.match(req).then(cached => cached || fetch(req).then(res => {
        const copy = res.clone();
        caches.open(CACHE).then(c => c.put(req, copy)).catch(() => {});
        return res;
      }).catch(() => caches.match('./index.html')))
    );
    return;
  }
  // 外部 API（報價/匯率） → 直接走網路，不快取
});
