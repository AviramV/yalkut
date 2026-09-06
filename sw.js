/* Service worker — the release lever for this app.
   Bump VERSION, commit, push. Every open copy then offers "יש גרסה חדשה". */
const VERSION = '1.2.2';
const CACHE = `yalkut-${VERSION}`;

const ASSETS = [
  './',
  'index.html',
  'app.css',
  'app.js',
  'aptabase.js',
  'data.json',
  'manifest.json',
  'icon.svg',
  'icon-192.png',
  'icon-512.png',
];

self.addEventListener('install', (event) => {
  // No skipWaiting here on purpose: the new version installs quietly and
  // waits until the parent taps "רענן", so the list never changes mid-pack.
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((n) => n !== CACHE).map((n) => caches.delete(n)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  if (new URL(request.url).origin !== self.location.origin) return;

  event.respondWith((async () => {
    const cached = await caches.match(request, { ignoreVary: true });
    if (cached) return cached;

    try {
      const fresh = await fetch(request);
      if (fresh.ok && fresh.type === 'basic') {
        const cache = await caches.open(CACHE);
        cache.put(request, fresh.clone());
      }
      return fresh;
    } catch (err) {
      // Offline and not in cache: hand navigations the app shell.
      if (request.mode === 'navigate') {
        const shell = await caches.match('index.html', { ignoreVary: true });
        if (shell) return shell;
      }
      throw err;
    }
  })());
});
