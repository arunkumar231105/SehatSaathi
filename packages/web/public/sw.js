// Minimal app-shell service worker: makes the PWA installable and lets the
// shell open on a flaky connection. API and socket traffic is never cached.
const SHELL = 'sehat-shell-v1';
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
  e.respondWith(fetch(e.request).catch(() => caches.match(e.request).then((r) => r || caches.match('/'))));
});
