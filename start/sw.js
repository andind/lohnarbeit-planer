// Service Worker der Startseite IM-Programme (Netz zuerst, sonst Zwischenspeicher). Bei Updates CACHE erhöhen.
const CACHE = 'imstart-v1.1';
const FILES = ['./', 'index.html', 'config.js', 'manifest.webmanifest', '../gemeinsam/im-basis.js?v=3', '../icon-192.png', '../icon-512.png', '../apple-touch-icon.png'];
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => Promise.all(FILES.map(f => c.add(f).catch(() => null))))); self.skipWaiting(); });
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('imstart-') && k !== CACHE).map(k => caches.delete(k)))));
  self.clients.claim();
});
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.origin !== location.origin || u.searchParams.has('code')) return;
  e.respondWith(fetch(e.request).then(r => {
    if (r.ok) { const copy = r.clone(); caches.open(CACHE).then(c => c.put(e.request, copy)); }
    return r;
  }).catch(() => caches.match(e.request, { ignoreSearch: true }).then(r => r || caches.match('index.html'))));
});
