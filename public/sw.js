const CACHE_NAME = 'malangee-shell-v1';
const SCOPE_URL = new URL('./', self.location.href);
const APP_ROOT = SCOPE_URL.pathname;
const SHELL = [APP_ROOT, new URL('manifest.webmanifest', SCOPE_URL).href, new URL('icon.svg', SCOPE_URL).href];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return;
  if (request.mode === 'navigate' && new URL(request.url).pathname.startsWith(APP_ROOT)) {
    event.respondWith(fetch(request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(APP_ROOT, copy));
      return response;
    }).catch(() => caches.match(APP_ROOT)));
    return;
  }
  event.respondWith(caches.match(request).then((cached) => cached || fetch(request).then((response) => {
    if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(request, response.clone()));
    return response;
  })));
});
