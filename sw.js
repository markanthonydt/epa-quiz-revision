const CACHE_NAME = 'epa-revision-studio-v2';
const OFFLINE_ASSETS = [
  './',
  './index.html',
  './app.js',
  './logic.js',
  './styles.css',
  './review.css',
  './manifest.webmanifest',
  './icons/app-icon.svg',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './data/ncfe-sample-002.json',
  './data/city-guilds-sample-1.json',
  './data/city-guilds-sample-2.json',
  './data/revision-glossary.json',
  './data/question-topics.json',
  './data/question-review.json',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME)
    .then((cache) => cache.addAll(OFFLINE_ASSETS))
    .then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys()
    .then((names) => Promise.all(names.filter((name) => name.startsWith('epa-revision-studio-') && name !== CACHE_NAME).map((name) => caches.delete(name))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;

  event.respondWith(fetch(request).then((response) => {
    if (response.ok) {
      const copy = response.clone();
      event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(request, copy)));
    }
    return response;
  }).catch(async () => {
    const cached = await caches.match(request);
    if (cached) return cached;
    if (request.mode === 'navigate') return caches.match(new URL('index.html', self.registration.scope));
    return Response.error();
  }));
});
