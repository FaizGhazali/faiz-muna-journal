// Keeps the app opening without a connection. Journal data is cached by Firestore, not here.
const CACHE = "journal-v85";
const SHELL = ["/", "/app.js", "/logic/bmi.js", "/features/weight/weightui.js", "/features/weight/weightcharts.js", "/features/weight/entryform.js", "/shell/setup.js", "/shell/visitors.js", "/shell/account.js", "/logic/account.js", "/shell/theme.js", "/shell/install.js", "/shell/demo.js", "/core/util.js", "/core/journal.js", "/core/face.js", "/logic/suggest.js", "/features/activities/activities.js", "/logic/fitness.js", "/logic/runweight.js", "/features/weight/fitdetail.js", "/logic/mood.js", "/features/mood/moodui.js", "/logic/reflect.js", "/logic/meals.js", "/features/meals/mealsui.js", "/logic/stocky.js", "/logic/search.js", "/logic/ledger.js", "/logic/ledgerimport.js", "/features/ledger/ledgerui.js", "/features/ledger/import.js", "/features/ledger/trends.js", "/features/ledger/rules.js", "/features/ledger/seeds.js", "/features/ledger/plan.js", "/logic/moneyplan.js", "/features/ledger/spend.js", "/logic/bucketspend.js", "/features/stocky/stockyui.js", "/core/confirm.js", "/core/owner.js", "/core/toast.js", "/core/collapse.js", "/core/zoom.js", "/shell/tour.js", "/features/weight/coros.js", "/shell/backup.js", "/logic/diary.js", "/features/diary/diaryui.js", "/features/diary/state.js", "/features/diary/data.js", "/features/diary/dashboard.js", "/features/diary/read.js", "/features/diary/editor.js", "/features/diary/writer.js", "/features/diary/settings.js", "/logic/writestyle.js", "/features/diary/localai.js", "/features/diary/aiworker.js", "/features/diary/cloudai.js", "/core/fs.js", "/shell/widget.js", "/core/memdb.js", "/shell/sample.js", "/shell/landing.js", "/logic/visits.js", "/styles.css", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/robots.txt", "/sitemap.xml", "/google6e6a8a8f21a7fbb1.html"];

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
