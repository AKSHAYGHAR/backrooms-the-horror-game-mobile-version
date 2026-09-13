const CACHE_NAME = 'backrooms-pwa-v1';

self.addEventListener('install', (event) => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  // A basic fetch handler is required by Chrome to show the "Add to Home Screen" prompt.
  // We try the network first, fallback to cache if available, but mainly just pass through.
  event.respondWith(
    fetch(event.request).catch(() => caches.match(event.request))
  );
});
