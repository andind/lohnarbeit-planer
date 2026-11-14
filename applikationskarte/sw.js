/* IM-Applikationskarten – Service Worker v1.17
   Programm und Bibliotheken werden für den Offline-Start zwischengespeichert.
   Karten, Parzellen, Satelliten- und AV-Daten kommen immer frisch aus dem Netz. */
const CACHE = "appkarte-v1.17";
const APP = ["./", "./index.html", "./manifest.webmanifest", "./icon-192.png", "./icon-512.png", "./icon-maskable-512.png", "./apple-touch-icon.png"];
const LIBS = [
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css",
  "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js",
  "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.css",
  "https://unpkg.com/@geoman-io/leaflet-geoman-free@2.17.0/dist/leaflet-geoman.min.js",
  "https://unpkg.com/@turf/turf@6.5.0/turf.min.js",
  "https://unpkg.com/shpjs@4.0.4/dist/shp.min.js",
  "https://unpkg.com/jszip@3.10.1/dist/jszip.min.js",
  "https://unpkg.com/geotiff@2.1.3/dist-browser/geotiff.js",
  "https://unpkg.com/proj4@2.11.0/dist/proj4.js"
];
self.addEventListener("install", e => {
  e.waitUntil((async () => {
    const c = await caches.open(CACHE);
    await c.addAll(APP);
    await Promise.all(LIBS.map(u => c.add(new Request(u, { mode:"cors" })).catch(() => {})));
    self.skipWaiting();
  })());
});
self.addEventListener("activate", e => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Programmseite: zuerst Netz (für Updates), sonst Zwischenspeicher
  if (req.mode === "navigate" || (url.origin === location.origin && /\/(index\.html)?$/.test(url.pathname))) {
    e.respondWith(fetch(req.url, { cache:"no-cache", credentials:"same-origin" }).then(r => { if (r.ok){ const cp = r.clone(); caches.open(CACHE).then(c => c.put("./index.html", cp)); } return r; })
      .catch(async () => (await caches.match("./index.html")) || (await caches.match("./"))));
    return;
  }
  // Eigene Dateien, Bibliotheken und Schriften: zuerst Zwischenspeicher
  if (url.origin === location.origin || url.hostname === "unpkg.com" || url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    e.respondWith(caches.match(req).then(hit => hit || fetch(req).then(r => {
      if (r.ok || r.type === "opaque") { const cp = r.clone(); caches.open(CACHE).then(c => c.put(req, cp)); }
      return r;
    })));
  }
  // alles andere (Kartenkacheln, geo.admin, geodienste, Sentinel) normal übers Netz
});
