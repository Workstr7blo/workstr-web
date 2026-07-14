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
  // Same-origin only: cross-origin requests (relay media, external images) go
  // straight to the network and never enter the cache.
  if (new URL(event.request.url).origin !== self.location.origin) return;
  const isImage = event.request.destination === 'image';
  const cacheName = isImage ? IMAGE_CACHE : CACHE;
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Never cache opaque or error responses (opaque entries are quota bombs).
        if (response.ok && response.type === 'basic') {
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
