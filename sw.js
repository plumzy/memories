const CACHE = "anniversary-memories-v13";
const STATIC_ASSETS = [
  "/",
  "/index.html",
  "/style.css",
  "/enhancements.css",
  "/folder-themes.css",
  "/folder-bulk-actions.css",
  "/script.js",
  "/enhancements.js",
  "/upload-scale.js",
  "/folder-themes.js",
  "/folder-size.js",
  "/folder-bulk-actions.js",
  "/bulk-delete.js",
  "/manifest.webmanifest",
  "/assets/icon-192.svg",
  "/assets/icon-512.svg"
];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(STATIC_ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)))));
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (url.pathname.startsWith("/api/")) return;
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      const copy = response.clone();
      caches.open(CACHE).then((cache) => cache.put(event.request, copy));
      return response;
    }).catch(() => caches.match("/index.html")))
  );
});
