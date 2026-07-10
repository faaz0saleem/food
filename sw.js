// Hungter Service Worker — app shell cache for offline support
const CACHE = 'hungter-v1';
const SHELL = [
  '/',
  '/chat.html',
  '/dashboard.html',
  '/brand.css',
  '/nav.css',
  '/styles.css',
  '/chat.css',
  '/script.js',
  '/layout.js',
  '/app.js',
  '/api-config.js',
  '/manifest.json',
  '/favicon.svg',
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL)).catch(() => {})
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);

  // Always go to network for API calls, analytics, and external resources
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/.netlify/') ||
    url.hostname !== self.location.hostname
  ) {
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;
      return fetch(e.request)
        .then((response) => {
          if (e.request.method === 'GET' && response.ok) {
            const clone = response.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone));
          }
          return response;
        })
        .catch(() => caches.match('/'));
    })
  );
});
