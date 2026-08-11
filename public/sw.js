const CACHE = 'workstr-web-v3';
const IMAGE_CACHE = 'workstr-web-img-v1';
const KNOWN_CACHES = [CACHE, IMAGE_CACHE];
const IMAGE_CACHE_MAX_ENTRIES = 60;
const CORE = ['./', './index.html', './manifest.webmanifest', './favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(CORE)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => !KNOWN_CACHES.includes(key)).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

// Drop the oldest entries once a cache grows past maxEntries (Cache.keys()
// returns entries in insertion order, so slicing the front is FIFO).
async function trimCache(name, maxEntries) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length <= maxEntries) return;
  await Promise.all(keys.slice(0, keys.length - maxEntries).map((key) => cache.delete(key)));
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const isImage = event.request.destination === 'image';
  const sameOrigin = new URL(event.request.url).origin === self.location.origin;
  // App assets stay same-origin. Exercise images are intentionally allowed
  // cross-origin so their opaque no-cors responses remain available offline.
  if (!sameOrigin && !isImage) return;
  const cacheName = isImage ? IMAGE_CACHE : CACHE;
  event.respondWith(
    (isImage ? caches.match(event.request) : Promise.resolve(undefined))
      .then((cached) => cached || fetch(event.request))
      .then((response) => {
        // Cross-origin <img> requests produce opaque responses. They can still
        // be cached and replayed safely, with a small FIFO limit for quota.
        if (!response.bodyUsed && (response.ok || response.type === 'opaque')) {
          const copy = response.clone();
          event.waitUntil(
            caches.open(cacheName)
              .then((cache) => cache.put(event.request, copy))
              .then(() => (isImage ? trimCache(IMAGE_CACHE, IMAGE_CACHE_MAX_ENTRIES) : undefined))
          );
        }
        return response;
      })
      .catch(() => caches.match(event.request).then((cached) => {
        if (cached) return cached;
        // Offline HTML fallback only makes sense for page navigations.
        if (event.request.mode === 'navigate') return caches.match('./index.html');
        return Response.error();
      }))
  );
});
