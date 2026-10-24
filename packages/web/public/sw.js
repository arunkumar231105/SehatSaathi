// Minimal app-shell service worker: makes the PWA installable and lets the
// shell open on a flaky connection. API and socket traffic is never cached.
const SHELL = 'sehat-shell-v2';
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(['/', '/manifest.webmanifest'])));
  self.skipWaiting();
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== SHELL).map((k) => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', (e) => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api') || u.pathname.startsWith('/ws')) return;
  // Pages bypass the HTTP cache: a stale index.html points at the previous
  // build. Hashed assets can come from it freely.
  const req = e.request.mode === 'navigate' ? fetch(e.request, { cache: 'no-cache' }) : fetch(e.request);
  e.respondWith(req.catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
