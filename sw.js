// Hungter Service Worker — network-first so deploys show up immediately,
// cache only as an offline fallback. Bump CACHE on every deploy.
const CACHE = 'hungter-v20260725';
const SHELL = [
  '/',
  '/chat.html',
  '/dashboard.html',
  '/codex.html',
  '/brand.css',
  '/nav.css',
  '/styles.css',
  '/chat.css',
  '/script.js',
  '/layout.js',
  '/convos.js',
  '/celebrate.js',
  '/app.js',
  '/api-config.js',
  '/fx.js',
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

  // Network-first: fresh content whenever online, cache as offline fallback.
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (e.request.method === 'GET' && response.ok) {
          const clone = response.clone();
          caches.open(CACHE).then((c) => c.put(e.request, clone));
        }
        return response;
      })
      .catch(() =>
        caches.match(e.request).then((cached) => cached || caches.match('/'))
      )
  );
});
