// Our Journal's entry module: starts Firebase (or the demo's in-memory database), signs the family in, keeps
// the people and entries live, and wires the other modules together. The screens live in their own files:
// weightui.js (person cards, feed), entryform.js (the entry form), setup.js (first run), the journals
// (mealsui, diaryui, stockyui, activities, moodui, fitdetail), plus visitors.js, theme.js, install.js, demo.js.
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, terminate, clearIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { collection, doc, setDoc, onSnapshot, useMemory } from "./core/fs.js";
import { openMemory } from "./core/memdb.js";
import { sampleData } from "./shell/sample.js";
import { DEMO, initDemo } from "./shell/demo.js";
import { initWeight, renderPeople, renderFeed, renderFoot } from "./features/weight/weightui.js";
import { initEntryForm, setPeople } from "./features/weight/entryform.js";
import { initSetup, buildSetup } from "./shell/setup.js";
import { visitors } from "./shell/visitors.js";
import { initTheme } from "./shell/theme.js";
import { initInstall } from "./shell/install.js";
import { initActivities, startActivities, stopActivities, refresh as refreshActivities, refreshMove, currentPerson, habitFacts } from "./features/activities/activities.js";
import { initBackup } from "./shell/backup.js";
import { initFitDetail, refreshFitDetail } from "./features/weight/fitdetail.js";
import { initMood, refreshMood } from "./features/mood/moodui.js";
import { initMeals, startMeals, stopMeals, refreshMeals, refreshCalories, refreshMealCost, initWheel, mealData } from "./features/meals/mealsui.js";
import { initStocky, startStocky, stopStocky, refreshStocky, stockOf, listFood, priceItems, costOf } from "./features/stocky/stockyui.js";
import { initCollapse } from "./core/collapse.js";
import { initZoom } from "./core/zoom.js";
import { initGuides } from "./shell/tour.js";
import { initWidget } from "./shell/widget.js";
import { initDiary, startDiary, stopDiary, refreshDiary, diaryList } from "./features/diary/diaryui.js";
import { initLedger, startLedger, stopLedger, refreshLedger, refreshLedgerParts } from "./features/ledger/ledgerui.js";
import { $, today } from "./core/util.js";
import { toast } from "./core/toast.js";

const FAMILY_EMAIL = "family@journal.invalid"; // a login name only; no mail is ever sent to it
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";
const show = (id) => ["loading", "login", "setup", "app"].forEach((v) => { $(v).hidden = v !== id; });

// reCAPTCHA Enterprise site key for Firebase App Check (public, safe to commit). Empty = App Check off.
// With it set and enforcement on in the Firebase console, only this site can reach Firestore and sign-in; scripts and bots can't.
const APP_CHECK_KEY = "";

// The demo runs on made-up data in this tab only (demo.js). It never loads Firebase sign-in or the real
// database, so it can't touch the family's journal or its usage limits.
let auth = null, db;
if (DEMO) {
  useMemory();
  db = openMemory(sampleData);
} else {
  const config = LOCAL
    ? { apiKey: "demo-key", projectId: "demo-journal", appId: "demo" }
    : await fetch("/__/firebase/init.json").then((r) => r.json());
  const app = initializeApp(config);
  if (APP_CHECK_KEY && !LOCAL) {
    const { initializeAppCheck, ReCaptchaEnterpriseProvider } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-check.js");
    initializeAppCheck(app, { provider: new ReCaptchaEnterpriseProvider(APP_CHECK_KEY), isTokenAutoRefreshEnabled: true });
  }
  auth = getAuth(app);
  db = initializeFirestore(app, { localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }) });
  if (LOCAL) {
    connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
    connectFirestoreEmulator(db, "127.0.0.1", 8085);
  }
}

// The two people (config/people) and every entry (entries/{person}_{date}), kept live while signed in.
let PEOPLE = [], entries = [], unsubs = [];
const people = () => PEOPLE, allEntries = () => entries;
const entriesCol = collection(db, "entries");

// Every save goes through here. Offline, Firestore keeps a write and sends it later, so its promise waits:
// don't hold the form for that. `ok` (optional) is the "it worked" toast. A failed write shows the error
// toast and rejects, so the caller stops (keeps the form as typed) instead of carrying on as if saved.
const FAILED = "That didn't save. Check your connection and try again.";
async function commit(write, ok) {
  let done;
  try { done = Promise.resolve(write()); } catch (e) { done = Promise.reject(e); } // a bad field throws at once
  done.catch((e) => { console.error("Save failed", e); toast(FAILED, { kind: "error" }); });
  await Promise.race([done, new Promise((res) => setTimeout(res, 2500))]);
  if (ok) toast(navigator.onLine ? ok : `${ok} It'll sync when you're back online.`);
}
function render() { renderPeople(); renderFeed(); refreshFitDetail(); refreshMood(); refreshCalories(); refreshLedgerParts(); }

// ---------- wire the modules ----------
const exercisedToday = (pid) => entries.some((e) => e.person === pid && e.date === today() && (e.minutes > 0 || e.run));
initWeight({ people, entries: allEntries });
initEntryForm({ entriesCol, people, entries: allEntries, commit });
initSetup({ db, entriesCol });
initActivities({ db, people, commit, exercisedToday, onChange: () => refreshMood() });
initBackup({ db });
initMeals({ db, people, me: currentPerson, entries: allEntries, commit, stock: { of: stockOf, list: listFood, items: priceItems, cost: costOf, changed: () => refreshStocky() } });
initStocky({ db, people, me: currentPerson, commit, mealData, pricesChanged: refreshMealCost });
initLedger({ db, people, me: currentPerson, commit });
initWheel();
initCollapse();
initZoom();
initGuides();
initDiary({ db, people, me: currentPerson, commit, onChange: () => refreshMood(), demo: DEMO, token: async () => (auth?.currentUser ? auth.currentUser.getIdToken() : null) });
initMood({ db, people, entries: allEntries, diary: diaryList, me: currentPerson, habitFacts, commit });
initFitDetail({
  people, entries: allEntries,
  saveBorn: (pid, born) => commit(() => setDoc(doc(db, "config", "people"), { people: PEOPLE.map((p) => (p.id === pid ? { ...p, born } : p)), updated: Date.now() }, { merge: true })),
});

// ---------- signed in: keep people and entries live ----------
function startApp() {
  let timer = setTimeout(() => { if (!$("loading").hidden) $("loading").innerHTML = `<p class="note">Still connecting. Check your internet connection.</p>`; }, 10000);
  const denied = async () => { clearTimeout(timer); stop(); await signOut(auth); $("loginMsg").textContent = "This account can't open the journal."; };
  unsubs.push(onSnapshot(doc(db, "config", "people"), (snap) => {
    clearTimeout(timer);
    if (!snap.exists()) {
      if (snap.metadata.fromCache) return;
      buildSetup(); show("setup"); return;
    }
    PEOPLE = snap.data().people;
    $("heading").textContent = `${PEOPLE.map((p) => p.name).join(" & ")}'s Journal`;
    document.title = DEMO ? "Demo – Our Journal" : $("heading").textContent;
    setPeople(PEOPLE);
    renderFoot();
    show("app");
    render();
    refreshActivities();
    refreshMeals();
    refreshDiary();
    refreshStocky();
    refreshLedger();
  }, denied));
  unsubs.push(onSnapshot(entriesCol, (snap) => {
    entries = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date || ""));
    if (PEOPLE.length) { entries = entries.filter((e) => PEOPLE.some((p) => p.id === e.person)); render(); refreshMove(); }
  }, denied));
  startActivities();
  startMeals();
  startDiary();
  startStocky();
  startLedger();
}
function stop() { unsubs.forEach((u) => u()); unsubs = []; stopActivities(); stopMeals(); stopDiary(); stopStocky(); stopLedger(); }

initDemo();
if (DEMO) {
  show("loading");
  startApp();
} else {
  onAuthStateChanged(auth, (user) => {
    stop();
    if (user) { show("loading"); startApp(); }
    else { show("login"); visitors(db); }
  });
}

// ---------- sign in / out ----------
$("loginForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("loginMsg");
  msg.textContent = "";
  $("signIn").disabled = true;
  try {
    await signInWithEmailAndPassword(auth, FAMILY_EMAIL, $("password").value);
    $("password").value = "";
  } catch (e) {
    msg.textContent = e.code === "auth/too-many-requests" ? "Too many tries. Wait a few minutes, then try again."
      : e.code === "auth/network-request-failed" ? "No connection. Check your internet and try again."
      : "That password isn't right.";
  } finally { $("signIn").disabled = false; }
});
$("signOut").addEventListener("click", async () => {
  // Remove the saved copy of the journal from this device as well.
  stop();
  await signOut(auth);
  try { await terminate(db); await clearIndexedDbPersistence(db); } catch (_) {}
  location.reload();
});

initTheme();
initInstall();
initWidget();
if ("serviceWorker" in navigator && !LOCAL) navigator.serviceWorker.register("/sw.js");
