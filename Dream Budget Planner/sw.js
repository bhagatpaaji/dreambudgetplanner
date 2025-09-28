/* Reality Check — Service Worker
   Caches core assets and enables offline usage when served over HTTPS.
   Strategy:
   - Precache core app shell (./, manifest, CDN libs)
   - Navigations: network-first, fallback to cache (./) if offline
   - Same-origin/CDN static: cache-first
   - FX API: network-first with cache fallback
*/

const CACHE_STATIC = 'rc-static-v2-20250928';
const CACHE_DYNAMIC = 'rc-dyn-v2-20250928';
const PRECACHE_URLS = [
  './',
  './manifest.webmanifest',
  './manifest-hi.webmanifest',
  './icons/icon-maskable.svg',
  'https://cdn.jsdelivr.net/npm/html2canvas@1.4.1/dist/html2canvas.min.js',
  'https://cdn.jsdelivr.net/npm/jspdf@2.5.1/dist/jspdf.umd.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_STATIC);
    try { await cache.addAll(PRECACHE_URLS); } catch (_) { /* ignore */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(
      keys.filter(k => ![CACHE_STATIC, CACHE_DYNAMIC].includes(k)).map(k => caches.delete(k))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // API: network-first
  if (/^https?:\/\/api\.exchangerate\.host\//.test(req.url)) {
    event.respondWith(networkFirst(req));
    return;
  }

  // HTML navigations: network-first with cache fallback
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const res = await fetch(req);
        const cache = await caches.open(CACHE_DYNAMIC);
        cache.put(req, res.clone());
        return res;
      } catch (_) {
        const cached = await caches.match(req);
        if (cached) return cached;
        return caches.match('./');
      }
    })());
    return;
  }

  // Same-origin static or CDN libs: cache-first
  if (url.origin === location.origin || /cdn\.jsdelivr\.net$|unpkg\.com$/.test(url.host)) {
    event.respondWith(cacheFirst(req));
    return;
  }

  // default: try network, fallback cache
  event.respondWith(fetch(req).catch(() => caches.match(req)));
});

async function cacheFirst(req) {
  const cached = await caches.match(req);
  if (cached) return cached;
  try {
    const res = await fetch(req);
    const cache = await caches.open(CACHE_DYNAMIC);
    cache.put(req, res.clone());
    return res;
  } catch (e) {
    return cached || Response.error();
  }
}

async function networkFirst(req) {
  try {
    const res = await fetch(req, { cache: 'no-store' });
    const cache = await caches.open(CACHE_DYNAMIC);
    cache.put(req, res.clone());
    return res;
  } catch (e) {
    const cached = await caches.match(req);
    if (cached) return cached;
    return new Response('{}', { headers: { 'Content-Type': 'application/json' } });
  }
}
