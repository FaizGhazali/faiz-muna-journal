// Keeps the app opening without a connection. Journal data is cached by Firestore, not here.
const CACHE = "journal-v40";
const SHELL = ["/", "/app.js", "/suggest.js", "/activities.js", "/fitness.js", "/runweight.js", "/fitdetail.js", "/mood.js", "/moodui.js", "/meals.js", "/mealsui.js", "/collapse.js", "/zoom.js", "/tour.js", "/coros.js", "/backup.js", "/diary.js", "/diaryui.js", "/writestyle.js", "/localai.js", "/aiworker.js", "/cloudai.js", "/fs.js", "/memdb.js", "/sample.js", "/landing.js", "/visits.js", "/styles.css", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/robots.txt", "/sitemap.xml", "/google6e6a8a8f21a7fbb1.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
// Only the app's own old caches are cleared. Dearly's downloaded AI model lives in "webllm/*" caches and must survive updates.
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("journal-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET") return;
  if (url.hostname === "www.gstatic.com" || url.hostname === "cdn.jsdelivr.net") {
    // The Firebase library and the picture reader have a version in their address and never change.
    e.respondWith(caches.match(e.request).then((hit) => hit || fetch(e.request).then((res) => {
      const copy = res.clone();
      caches.open(CACHE).then((c) => c.put(e.request, copy));
      return res;
    })));
    return;
  }
  if (url.origin !== location.origin || url.pathname.startsWith("/__/")) return;
  // Newest version when online, saved copy when offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/"))));
});
