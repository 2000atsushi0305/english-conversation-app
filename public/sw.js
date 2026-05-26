const CACHE_NAME = "talkboba-v1";
const STATIC_ASSETS = [
  "/",
  "/public/style.css",
  "/public/app.js",
  "/public/boba-icon.svg",
];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(STATIC_ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("push", (e) => {
  let data = { title: "TalkBoba", body: "新しいメッセージがあります" };
  try { data = e.data.json(); } catch {}
  e.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      icon: "/public/boba-icon.svg",
      badge: "/public/boba-icon.svg",
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  e.waitUntil(clients.openWindow("/"));
});

self.addEventListener("fetch", (e) => {
  // APIリクエストはキャッシュしない
  if (e.request.url.includes("/api/")) return;

  e.respondWith(
    caches.match(e.request).then((cached) => cached || fetch(e.request))
  );
});
