// Keeps the app opening without a connection. Journal data is cached by Firestore, not here.
const CACHE = "journal-v111";
const SHELL = ["/", "/app.js", "/logic/bmi.js", "/features/weight/weightui.js", "/features/weight/weightcharts.js", "/features/weight/entryform.js", "/shell/setup.js", "/shell/visitors.js", "/shell/account.js", "/logic/account.js", "/shell/theme.js", "/shell/install.js", "/shell/demo.js", "/core/util.js", "/core/journal.js", "/core/face.js", "/core/icons.js", "/logic/suggest.js", "/logic/braindump.js", "/shell/braindump.js", "/features/activities/activities.js", "/logic/fitness.js", "/logic/runweight.js", "/features/weight/fitdetail.js", "/logic/mood.js", "/features/mood/moodui.js", "/logic/reflect.js", "/logic/meals.js", "/features/meals/mealsui.js", "/logic/stocky.js", "/logic/search.js", "/logic/ledger.js", "/logic/ledgerimport.js", "/features/ledger/ledgerui.js", "/features/ledger/import.js", "/features/ledger/trends.js", "/features/ledger/rules.js", "/features/ledger/seeds.js", "/features/ledger/plan.js", "/logic/moneyplan.js", "/features/ledger/spend.js", "/features/ledger/analytics.js", "/features/ledger/docsui.js", "/features/ledger/income.js", "/logic/income.js", "/logic/docs.js", "/shell/onedrive.js", "/logic/bucketspend.js", "/logic/shops.js", "/features/stocky/stockyui.js", "/features/stocky/receipt.js", "/features/stocky/receiptread.js", "/logic/receipt.js", "/core/confirm.js", "/core/owner.js", "/core/toast.js", "/core/collapse.js", "/logic/board.js", "/shell/board.js", "/shell/prefs.js", "/core/zoom.js", "/core/motion.js", "/shell/tour.js", "/features/weight/coros.js", "/shell/backup.js", "/logic/diary.js", "/features/diary/diaryui.js", "/features/diary/state.js", "/features/diary/data.js", "/features/diary/dashboard.js", "/features/diary/read.js", "/features/diary/editor.js", "/features/diary/writer.js", "/features/diary/settings.js", "/logic/writestyle.js", "/features/diary/localai.js", "/features/diary/aiworker.js", "/features/diary/cloudai.js", "/core/fs.js", "/shell/widget.js", "/core/memdb.js", "/shell/sample.js", "/shell/landing.js", "/shell/devprogress.js", "/logic/devlog.js", "/logic/visits.js", "/styles.css", "/manifest.webmanifest", "/icon-192.png", "/icon-512.png", "/robots.txt", "/sitemap.xml", "/google6e6a8a8f21a7fbb1.html"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
// Only the app's own old caches are cleared. Dearly's downloaded AI model lives in "webllm/*" caches and must survive updates.
self.addEventListener("activate", (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("journal-") && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
// A receipt picture shared to the installed journal (the widget app's scanner, or any app's Share): kept for a moment in a
// cache that version bumps don't clear, then the journal opens #stocky/scan, which takes it out (features/stocky/receiptread.js).
const INBOX = "receipt-inbox", INBOX_KEY = "/receipt-inbox/latest";
async function shareIn(req) {
  try {
    const file = (await req.formData()).get("receipt");
    if (file && file.size) await (await caches.open(INBOX)).put(INBOX_KEY, new Response(file, { headers: { "Content-Type": file.type || "image/jpeg" } }));
  } catch (_) { /* the page then says no picture came through */ }
  return Response.redirect("/#stocky/scan", 303);
}
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method === "POST" && url.origin === location.origin && url.pathname === "/share-receipt") { e.respondWith(shareIn(e.request)); return; }
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
  if (url.searchParams.has("code") || url.searchParams.has("error")) return; // back from Microsoft sign-in: never cache the one-time code
  // Newest version when online, saved copy when offline.
  e.respondWith(fetch(e.request).then((res) => {
    if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
    return res;
  }).catch(() => caches.match(e.request).then((hit) => hit || caches.match("/"))));
});
