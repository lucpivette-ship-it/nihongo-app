// Service worker: app-shell files are cache-first with background revalidation;
// content notes (the .md files under content/) are network-first so new/edited
// notes show up after the next reconnect instead of being stuck until reinstall.
// Bump CACHE_NAME on every app-shell code change to force clients to re-cache.

const CACHE_NAME = 'nihongo-v3';
const CONTENT_INDEX_URL = 'content/index.md';

const APP_SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/markdown.js',
  'js/tts.js',
  'js/trace.js',
  'js/stroke-order.js',
  'js/quiz.js',
  'js/app.js',
  'icons/icon.svg',
  CONTENT_INDEX_URL,
];

// Third-party CDN assets (stroke-order library) — cached best-effort so a
// flaky/offline CDN at install time never breaks caching of the core app.
const CDN_ASSETS = [
  'https://cdn.jsdelivr.net/npm/hanzi-writer@3/dist/hanzi-writer.min.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE_NAME);
      await cache.addAll(APP_SHELL);
      try {
        await cache.addAll(CDN_ASSETS);
      } catch (e) {
        console.error('Could not pre-cache CDN assets', e);
      }
      try {
        const res = await fetch(CONTENT_INDEX_URL);
        const text = await res.text();
        const files = text.split(/\r?\n/)
          .filter((l) => l.startsWith('- '))
          .map((l) => l.slice(2).trim());
        await cache.addAll(files.map((f) => 'content/' + f));
      } catch (e) {
        console.error('Could not pre-cache content files', e);
      }
      self.skipWaiting();
    })()
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

function isContentFile(url) {
  return url.pathname.includes('/content/');
}

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (isContentFile(url)) {
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => caches.match(request))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});
