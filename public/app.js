import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, connectAuthEmulator, onAuthStateChanged, signInWithEmailAndPassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import {
  initializeFirestore, persistentLocalCache, persistentMultipleTabManager, connectFirestoreEmulator, terminate, clearIndexedDbPersistence,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import { collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch, getDocs, increment, useMemory } from "./fs.js";
import { countryOf, flagOf, isBot, summarise, UNKNOWN } from "./visits.js";
import { openMemory } from "./memdb.js";
import { sampleData } from "./sample.js";
import { fitnessSeries, perBeat, paceOf, clock, toSecs } from "./fitness.js";
import { readCoros, parseCoros } from "./coros.js";
import { initActivities, startActivities, stopActivities, refresh as refreshActivities, refreshMove, currentPerson, habitFacts } from "./activities.js";
import { initBackup } from "./backup.js";
import { initFitDetail, refreshFitDetail } from "./fitdetail.js";
import { initMood, refreshMood } from "./moodui.js";
import { MOODS, isMood } from "./mood.js";
import { initMeals, startMeals, stopMeals, refreshMeals, refreshCalories, initWheel } from "./mealsui.js";

const FAMILY_EMAIL = "family@journal.invalid"; // a login name only; no mail is ever sent to it
const PACE = 0.5; // kg a week
const WEEKLY_MINUTES = 150; // WHO weekly minimum for moderate activity
const LOCAL = location.hostname === "localhost" || location.hostname === "127.0.0.1";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const r1 = (n) => Math.round(n * 10) / 10;
const pad = (n) => String(n).padStart(2, "0");
const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
const dayNum = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
const fmt = (s, o) => parse(s).toLocaleDateString(undefined, o);
const today = () => iso(new Date());
const m2 = (p) => (p.cm / 100) ** 2;
const bmiOf = (p, kg) => r1(kg / m2(p));
const range = (p) => ({ lo: r1(18.5 * m2(p)), hi: r1(24.9 * m2(p)), asian: r1(22.9 * m2(p)) });
const statusOf = (b) => b < 18.5 ? { t: "Underweight", c: "--under" } : b < 25 ? { t: "Normal", c: "--good" } : b < 30 ? { t: "Overweight", c: "--over" } : { t: "Obese", c: "--obese" };
const show = (id) => ["loading", "login", "setup", "app"].forEach((v) => { $(v).hidden = v !== id; });

// reCAPTCHA Enterprise site key for Firebase App Check (public, safe to commit). Empty = App Check off.
// With it set and enforcement on in the Firebase console, only this site can reach Firestore and sign-in; scripts and bots can't.
const APP_CHECK_KEY = "";

// The demo ("Try the demo" under the sign-in form) runs on made-up data in this tab only. It never loads
// Firebase sign-in or the real database, so it can't touch the family's journal or its usage limits.
const DEMO = (() => { try { return sessionStorage.getItem("journal-demo") === "1"; } catch (_) { return false; } })();

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

let PEOPLE = [], entries = [], editingId = null, confirmDelete = null, unsubs = [];
let runExtra = null; // numbers from the picture that have no box in the form (cadence, power, ...)
const entriesCol = collection(db, "entries");

// Offline, Firestore keeps a write and sends it later, so its promise waits. Don't hold the form for that.
async function commit(write) {
  const done = write();
  done.catch(() => banner("A change couldn't be saved. Reload the app and check your entries."));
  await Promise.race([done, new Promise((res) => setTimeout(res, 2500))]);
}

function weighIns(p) {
  return entries.filter((e) => e.person === p.id && typeof e.weight === "number").sort((a, b) => a.date.localeCompare(b.date));
}
function weekMinutes(p) {
  const t = new Date(), mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
  const from = iso(mon);
  return entries.filter((e) => e.person === p.id && e.date >= from && e.date <= today() && typeof e.minutes === "number").reduce((a, e) => a + e.minutes, 0);
}

// One point per run that has enough numbers for a score, oldest first.
function fitness(p) {
  return fitnessSeries(entries.filter((e) => e.person === p.id && e.run).map((e) => ({ ...e.run, date: e.date })), p.age);
}
function fitHtml(p) {
  const s = fitness(p), last = s[s.length - 1], prev = s[s.length - 2];
  if (!last) return `<div class="fit"><h3>Fitness</h3><p class="note">Add a COROS run picture to start your fitness line.</p></div>`;
  const d = prev ? r1(last.trend) - r1(prev.trend) : 0;
  const delta = !prev ? `<span class="delta">First run. The line starts here.</span>`
    : Math.abs(d) < 0.05 ? `<span class="delta">Same as last run</span>`
    : `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} since last run</span>`;
  const facts = [`This run ${last.score.toFixed(1)}`, `${perBeat(last.run).toFixed(2)} m per heartbeat`];
  if (last.run.hrr) facts.push(`recovery ${last.run.hrr} bpm`);
  return `<div class="fit">
    <div class="fithead"><div class="stat"><small>Fitness score</small><b>${last.trend.toFixed(1)}</b></div>${delta}</div>
    <div class="chart" id="fit-${p.id}"></div>
    <p class="week">${esc(facts.join(" · "))}</p>
    <a class="btn more" href="#fitness/${encodeURIComponent(p.id)}">Show more detail</a>
  </div>`;
}

function goalHtml(p, w) {
  const { lo, hi } = range(p);
  if (w == null) return `<strong>Goal: ${lo.toFixed(1)} to ${hi.toFixed(1)} kg</strong><p>Add a weigh-in to see the distance left.</p>`;
  const first = weighIns(p)[0], change = r1(w - first.weight);
  const since = change === 0 ? "" : ` ${change < 0 ? "Down" : "Up"} ${Math.abs(change).toFixed(1)} kg since ${fmt(first.date, { day: "numeric", month: "short" })}.`;
  if (w >= lo && w <= hi) return `<strong>In the normal range</strong><p>Goal met. Stay between ${lo.toFixed(1)} and ${hi.toFixed(1)} kg.${since}</p>`;
  const target = w > hi ? hi : lo, gap = r1(Math.abs(w - target)), weeks = Math.ceil(gap / PACE);
  const t = new Date(); t.setDate(t.getDate() + weeks * 7);
  const when = t.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return `<strong>${gap.toFixed(1)} kg to ${w > hi ? "lose" : "gain"}</strong><p>Goal: ${target.toFixed(1)} kg, BMI ${w > hi ? "24.9" : "18.5"}. About ${weeks} weeks at ${PACE} kg a week, around ${when}.${since}</p>`;
}

// Each person has one card: weight and BMI on top (every journal), then a part for the journal picked on the wheel.
// #people[data-journal] shows only the matching .pextra. A new journal adds its id here and fills "<id>Slot-<person>".
const JOURNAL_PARTS = ["weight", "meals"];
function renderPeople() {
  $("people").innerHTML = PEOPLE.map((p) => {
    const pts = weighIns(p), w = pts.length ? pts[pts.length - 1].weight : null;
    const b = w == null ? null : bmiOf(p, w), s = b == null ? null : statusOf(b);
    const pos = b == null ? 0 : Math.max(0, Math.min(100, ((b - 15) / 20) * 100));
    return `<article class="person">
      <div class="who"><h2>${esc(p.name)}</h2><span>${esc(p.age)} · ${esc(p.sex)} · ${esc(p.cm)} cm</span></div>
      <div class="stats">
        <div class="stat"><small>Weight</small><b>${w == null ? "–" : w.toFixed(1)}</b><i>kg</i></div>
        <div class="stat"><small>BMI</small><b>${b == null ? "–" : b.toFixed(1)}</b></div>
        ${s ? `<span class="pill" style="--c:var(${s.c})">${s.t}</span>` : ""}
      </div>
      <div class="scale" aria-label="BMI scale${b == null ? "" : `, currently ${b.toFixed(1)}, ${s.t}`}">
        <div class="bands">
          <div style="--c:var(--under)">Under</div><div style="--c:var(--good)">Normal</div><div style="--c:var(--over)">Over</div><div style="--c:var(--obese)">Obese</div>
        </div>
        ${b == null ? "" : `<div class="marker" style="left:${pos}%"></div>`}
        <span class="cut" style="left:17.5%">18.5</span><span class="cut" style="left:50%">25</span><span class="cut" style="left:75%">30</span>
      </div>
      <div class="goal">${goalHtml(p, w)}</div>
      <div class="chart" id="chart-${p.id}"></div>
      ${JOURNAL_PARTS.map((j) => `<div class="pextra" data-journal="${j}" data-pid="${p.id}"${j === "weight" ? "" : ` id="${j}Slot-${p.id}"`}>${j === "weight" ? `${fitHtml(p)}
        <p class="week"><b>${weekMinutes(p)}</b> of ${WEEKLY_MINUTES} exercise minutes this week</p>` : ""}</div>`).join("")}
    </article>`;
  }).join("");
  drawCharts();
}

function drawCharts() {
  PEOPLE.forEach((p) => {
    const el = $("chart-" + p.id), fit = $("fit-" + p.id);
    if (el) drawChart(el, p);
    if (fit) drawFit(fit, p);
  });
}

// Touch or hover a chart to read the nearest point.
function hover(host, W, pts, X, label) {
  const svg = host.querySelector("svg"), cross = host.querySelector(".cross"), tip = host.querySelector(".tip");
  const showTip = (ev) => {
    const px = ev.clientX - svg.getBoundingClientRect().left;
    let best = pts[0];
    pts.forEach((e) => { if (Math.abs(X(e.date) - px) < Math.abs(X(best.date) - px)) best = e; });
    const bx = X(best.date);
    cross.setAttribute("x1", bx); cross.setAttribute("x2", bx); cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.textContent = `${fmt(best.date, { day: "numeric", month: "short", year: "numeric" })}: ${label(best)}`;
    tip.style.left = Math.max(0, Math.min(W - tip.offsetWidth, bx - tip.offsetWidth / 2)) + "px";
  };
  svg.addEventListener("pointermove", showTip);
  svg.addEventListener("pointerdown", showTip);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
}

// Fitness: a ring for each run's own score, and the line for the moving average. The scale hugs the data so small gains show.
function drawFit(host, p) {
  const s = fitness(p), W = host.clientWidth || 320, H = 170, m = { l: 34, r: 12, t: 22, b: 24 };
  if (!s.length) return;
  const vals = s.flatMap((x) => [x.score, x.trend]), lo = Math.min(...vals), hi = Math.max(...vals);
  const room = Math.max(0.6, (hi - lo) * 0.2);
  const step = [0.2, 0.5, 1, 2, 5, 10].find((n) => (hi - lo + 2 * room) / n <= 4) || 20;
  const yMin = Math.floor((lo - room) / step) * step, yMax = Math.ceil((hi + room) / step) * step;
  const x0 = dayNum(s[0].date), x1 = Math.max(dayNum(s[s.length - 1].date), x0 + 14);
  const X = (d) => m.l + ((dayNum(d) - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + ((yMax - v) / (yMax - yMin)) * (H - m.t - m.b);
  let g = "";
  for (let i = 0; yMin + i * step <= yMax + 1e-9; i++) { const v = yMin + i * step; g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(step < 1 ? 1 : 0)}</text>`; }
  const path = s.map((e, i) => `${i ? "L" : "M"}${X(e.date).toFixed(1)} ${Y(e.trend).toFixed(1)}`).join("");
  const rings = s.slice(-60).map((e) => `<circle class="run" cx="${X(e.date)}" cy="${Y(e.score)}" r="3.5"/>`).join("");
  const last = s[s.length - 1], lx = X(last.date), ly = Y(last.trend);
  const xl = (n) => new Date(n * 864e5).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.name)}'s fitness score over time. Now ${last.trend.toFixed(1)}.">
    ${g}${rings}
    <path class="ln" d="${path}"/>
    <circle class="pt" cx="${lx}" cy="${ly}" r="5"/>
    <text class="val" x="${lx}" y="${ly - 10}" text-anchor="${lx > W / 2 ? "end" : "start"}">${last.trend.toFixed(1)}</text>
    <text x="${m.l}" y="${H - 6}">${esc(xl(x0))}</text>
    <text x="${W - m.r}" y="${H - 6}" text-anchor="end">${esc(xl(x1))}</text>
    <line class="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
  </svg><div class="tip" hidden></div>`;
  hover(host, W, s, X, (e) => `fitness ${e.trend.toFixed(1)}. This run ${e.score.toFixed(1)}, ${e.run.km} km at ${clock(paceOf(e.run))} per km, ${e.run.hr} bpm`);
}

function drawChart(host, p) {
  const pts = weighIns(p), W = host.clientWidth || 320, H = 170;
  if (!pts.length) { host.innerHTML = `<p class="note">Your weight line starts with the first weigh-in.</p>`; return; }
  const { lo, hi } = range(p), m = { l: 30, r: 10, t: 22, b: 24 };
  const ws = pts.map((e) => e.weight), wMin = Math.min(...ws), wMax = Math.max(...ws);
  const inRange = wMax <= hi && wMin >= lo;
  const anchorLo = inRange || wMin < lo ? lo : hi;
  const yMin = Math.floor(Math.min(anchorLo, wMin - 1) / 5) * 5, yMax = Math.ceil(Math.max(hi, wMax + 1) / 5) * 5;
  const x0 = dayNum(pts[0].date), x1 = Math.max(dayNum(pts[pts.length - 1].date), x0 + 28);
  const X = (d) => m.l + ((dayNum(d) - x0) / (x1 - x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + ((yMax - v) / (yMax - yMin)) * (H - m.t - m.b);
  const step = yMax - yMin > 40 ? 10 : 5;
  let g = "";
  for (let v = yMin; v <= yMax; v += step) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v}</text>`;
  const bt = Y(Math.min(hi, yMax)), bb = Y(Math.max(lo, yMin));
  let band = `<rect class="band" x="${m.l}" width="${W - m.l - m.r}" y="${bt}" height="${bb - bt}"/>`;
  if (wMax > hi) band += `<line class="goalline" x1="${m.l}" x2="${W - m.r}" y1="${bt}" y2="${bt}"/><text x="${W - m.r}" y="${bt - 5}" text-anchor="end">Goal ${hi.toFixed(1)} kg</text>`;
  else band += `<text x="${W - m.r}" y="${bt + 15}" text-anchor="end">Normal range</text>`;
  const path = pts.map((e, i) => `${i ? "L" : "M"}${X(e.date).toFixed(1)} ${Y(e.weight).toFixed(1)}`).join("");
  const last = pts[pts.length - 1], lx = X(last.date), ly = Y(last.weight);
  const dots = pts.length <= 40 ? pts.slice(0, -1).map((e) => `<circle class="pt" cx="${X(e.date)}" cy="${Y(e.weight)}" r="4"/>`).join("") : "";
  const xl = (n) => new Date(n * 864e5).toLocaleDateString(undefined, { day: "numeric", month: "short", timeZone: "UTC" });
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.name)}'s weight over time. Latest ${last.weight.toFixed(1)} kg. Normal range ${lo.toFixed(1)} to ${hi.toFixed(1)} kg.">
    ${band}${g}
    <path class="ln" d="${path}"/>${dots}
    <circle class="pt" cx="${lx}" cy="${ly}" r="5"/>
    <text class="val" x="${lx}" y="${ly - 10}" text-anchor="${lx > W / 2 ? "end" : "start"}">${last.weight.toFixed(1)} kg</text>
    <text x="${m.l}" y="${H - 6}">${esc(xl(x0))}</text>
    <text x="${W - m.r}" y="${H - 6}" text-anchor="end">${esc(xl(x1))}</text>
    <line class="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
  </svg><div class="tip" hidden></div>`;
  hover(host, W, pts, X, (e) => `${e.weight.toFixed(1)} kg, BMI ${bmiOf(p, e.weight).toFixed(1)}`);
}

function renderFeed() {
  const feed = $("feed");
  if (!entries.length) { feed.innerHTML = `<p class="note">No entries yet. Save your first entry with the form.</p>`; return; }
  const days = [...new Set(entries.map((e) => e.date))].sort().reverse();
  feed.innerHTML = days.map((d) => `<section class="day"><h3>${esc(fmt(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</h3>
    ${entries.filter((e) => e.date === d).sort((a, b) => a.person.localeCompare(b.person)).map(entryHtml).join("")}</section>`).join("");
}
function entryHtml(e) {
  const p = PEOPLE.find((x) => x.id === e.person), facts = [];
  if (typeof e.weight === "number") facts.push(`${e.weight.toFixed(1)} kg, BMI ${bmiOf(p, e.weight).toFixed(1)}`);
  if (e.run) facts.push(`${e.run.km} km run in ${clock(e.run.secs)}${e.run.hr ? `, ${e.run.hr} bpm` : ""}`);
  else if (typeof e.minutes === "number") facts.push(`${e.minutes} min exercise`);
  if (isMood(e.mood)) facts.push(`${facts.length ? "felt" : "Felt"} ${MOODS[e.mood].word.toLowerCase()}`);
  const btns = confirmDelete === e.id
    ? `<button class="mini danger" data-act="del-yes" data-id="${esc(e.id)}">Delete</button><button class="mini" data-act="del-no">Keep</button>`
    : `<button class="mini" data-act="edit" data-id="${esc(e.id)}">Edit</button><button class="mini" data-act="del" data-id="${esc(e.id)}">Delete</button>`;
  return `<div class="entry"><div class="name">${esc(p.name)}</div>
    <div><div class="facts">${esc(facts.join(" · ") || "Note")}</div>${e.note ? `<p class="text">${esc(e.note)}</p>` : ""}</div>
    <div class="btns">${btns}</div></div>`;
}
function renderFoot() {
  $("foot").innerHTML = `<p>BMI is weight in kg divided by height in metres squared. Ranges follow the WHO adult cut-offs. Many Asian guidelines, including Malaysia's, put the top of normal lower at 22.9, which is ${PEOPLE.map((p) => `${range(p).asian.toFixed(1)} kg for ${esc(p.name)}`).join(" and ")}.</p>
    <p>The fitness score compares how fast a run was with how hard the heart worked for it, with a small bonus for quick heart rate recovery. Faster at the same heart rate, or the same pace at a lower one, moves it up. It's an estimate for watching your own trend, not a medical measure.</p>
    <p>BMI doesn't separate muscle from fat, so read it alongside how you feel and what a doctor tells you.</p>`;
}
function render() { renderPeople(); renderFeed(); refreshFitDetail(); refreshMood(); refreshCalories(); }
function banner(text) { $("banner").textContent = text || ""; $("banner").hidden = !text; }

// The run boxes in the form. Paces and time are typed as 9:29 and 40:37.
const RUN_NUMS = ["km", "hr", "hrMax", "hrr", "load"], RUN_TIMES = ["secs", "pace", "effort"];
function showRun(run) {
  $("runFields").hidden = !run;
  $("runPick").textContent = run ? "Use another picture" : "Add run picture";
  runExtra = null;
  if (!run) return;
  RUN_NUMS.forEach((k) => { $("run-" + k).value = run[k] ?? ""; });
  RUN_TIMES.forEach((k) => { $("run-" + k).value = run[k] ? clock(run[k]) : ""; });
  const { cadence, stride, power, ground, kcal } = run;
  runExtra = { cadence, stride, power, ground, kcal };
}
// Returns { run } from the boxes, or { error } with what to fix.
function readRun() {
  const run = { source: "coros" }, lim = { km: [0.1, 100], hr: [60, 220], hrMax: [100, 220], hrr: [1, 120], load: [1, 2000] };
  for (const k of RUN_NUMS) {
    const v = $("run-" + k).value.trim(); if (v === "") continue;
    const n = Number(v);
    if (!(n >= lim[k][0] && n <= lim[k][1])) return { error: `Check the run's ${$("run-" + k).labels[0].firstChild.textContent.toLowerCase()}.` };
    run[k] = k === "km" ? Math.round(n * 100) / 100 : Math.round(n);
  }
  for (const k of RUN_TIMES) {
    const v = $("run-" + k).value.trim(); if (v === "") continue;
    const n = toSecs(v);
    if (!n) return { error: k === "secs" ? "Write the run time like 40:37." : "Write the pace like 9:29." };
    run[k] = n;
  }
  if (!run.km || !run.secs || !run.hr) return { error: "The run needs a distance, a time and an average heart rate." };
  Object.entries(runExtra || {}).forEach(([k, v]) => { if (typeof v === "number") run[k] = v; });
  return { run };
}
$("runPick").addEventListener("click", () => $("runFile").click());
$("runRemove").addEventListener("click", () => { showRun(null); $("runMsg").textContent = ""; });
$("runFile").addEventListener("change", async () => {
  const file = $("runFile").files[0], msg = $("runMsg"), bar = $("runBar");
  if (!file) return;
  msg.textContent = "Reading the picture. This can take a minute…";
  bar.value = 0; bar.hidden = false; $("runPick").disabled = true;
  try {
    const found = parseCoros(await readCoros(file, (v) => { bar.value = v; }));
    if (!found.km && !found.secs && !found.hr) { msg.textContent = "That doesn't look like a COROS run picture. Share the run from the COROS app and try again."; return; }
    const { date, ...run } = found;
    showRun(run);
    if (date && date <= today() && !editingId) $("date").value = date;
    const missing = !run.km || !run.secs || !run.hr;
    msg.textContent = `${missing ? "Some numbers couldn't be read. Fill them in below" : "Done. Check the numbers below"}, then save. The picture wasn't kept.`;
  } catch (e) {
    msg.textContent = e.message === "small" ? "That picture is too small to read. Use the full picture shared from the COROS app."
      : navigator.onLine ? "That picture couldn't be read. Try again." : "The picture reader needs the internet the first time. Try again when you're online.";
  } finally { $("runFile").value = ""; bar.hidden = true; $("runPick").disabled = false; } // nothing of the picture is kept once it's read
});

function selectedPerson() { return document.querySelector("input[name=person]:checked")?.value; }
function resetForm() {
  editingId = null;
  $("form").reset();
  showRun(null);
  $("runMsg").textContent = "";
  $("date").value = today();
  try { const last = localStorage.getItem("journal-person"); if (last && $("person-" + last)) $("person-" + last).checked = true; } catch (_) {}
  $("formTitle").textContent = "Write today's entry";
  $("save").textContent = "Save entry";
  $("cancelEdit").hidden = true;
}
function startEdit(id) {
  const e = entries.find((x) => x.id === id); if (!e) return;
  editingId = id;
  $("person-" + e.person).checked = true;
  $("date").value = e.date;
  $("weight").value = typeof e.weight === "number" ? e.weight : "";
  showRun(e.run || null);
  $("runMsg").textContent = "";
  $("note").value = e.note || "";
  $("formTitle").textContent = "Edit entry";
  $("save").textContent = "Save changes";
  $("cancelEdit").hidden = false;
  $("formMsg").textContent = "";
  $("formPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

$("form").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("formMsg"), person = selectedPerson(), date = $("date").value;
  const ws = $("weight").value.trim(), note = $("note").value.trim();
  const weight = ws === "" ? null : r1(Number(ws));
  const typed = $("runFields").hidden ? {} : readRun();
  if (!date) { msg.textContent = "Pick a date for this entry."; return; }
  if (weight !== null && !(weight >= 30 && weight <= 250)) { msg.textContent = "Enter a weight between 30 and 250 kg."; return; }
  if (typed.error) { msg.textContent = typed.error; return; }
  const id = `${person}_${date}`, existing = entries.find((e) => e.id === id), wasEditing = editingId;
  const body = { person, date };
  // A new entry on a day that already has one fills in only what was typed, so nothing written earlier is lost.
  const keep = !wasEditing && existing ? existing : {};
  const before = wasEditing ? entries.find((e) => e.id === wasEditing) || {} : keep;
  const run = typed.run || keep.run;
  // Minutes come from the run. Entries from before run pictures keep the minutes they had.
  const w = weight ?? keep.weight, mn = run ? Math.round(run.secs / 60) : before.run ? null : before.minutes, n = note || keep.note;
  if (typeof w === "number") body.weight = w;
  if (typeof mn === "number") body.minutes = mn;
  if (run) body.run = run;
  if (Object.keys(body).length === 2 && !n) { msg.textContent = "Add a weight, a run picture or a note first."; return; }
  if (n) body.note = n;
  const md = (wasEditing ? before : keep).mood; // the mood is rated on its own card, so keep it
  if (isMood(md)) body.mood = md;
  $("save").disabled = true;
  await commit(() => setDoc(doc(entriesCol, id), body));
  if (wasEditing && wasEditing !== id) await commit(() => deleteDoc(doc(entriesCol, wasEditing)));
  try { localStorage.setItem("journal-person", person); } catch (_) {}
  const who = PEOPLE.find((p) => p.id === person).name;
  resetForm();
  msg.textContent = `${existing || wasEditing ? "Updated" : "Saved"} ${who}'s entry for ${fmt(date, { day: "numeric", month: "short" })}.`;
  $("save").disabled = false;
});
$("cancelEdit").addEventListener("click", () => { resetForm(); $("formMsg").textContent = ""; });
$("feed").addEventListener("click", async (ev) => {
  const b = ev.target.closest("button[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "edit") startEdit(id);
  if (act === "del") { confirmDelete = id; renderFeed(); }
  if (act === "del-no") { confirmDelete = null; renderFeed(); }
  if (act === "del-yes") {
    confirmDelete = null;
    if (editingId === id) resetForm();
    await commit(() => deleteDoc(doc(entriesCol, id)));
  }
});

const exercisedToday = (pid) => entries.some((e) => e.person === pid && e.date === today() && (e.minutes > 0 || e.run));
initActivities({ db, people: () => PEOPLE, commit, exercisedToday, onChange: () => refreshMood() });
initBackup({ db });
initMeals({ db, people: () => PEOPLE, me: currentPerson, entries: () => entries, commit });
initWheel();
initMood({ db, people: () => PEOPLE, entries: () => entries, me: currentPerson, habitFacts, commit });
initFitDetail({
  people: () => PEOPLE, entries: () => entries,
  saveBorn: (pid, born) => commit(() => setDoc(doc(db, "config", "people"), { people: PEOPLE.map((p) => (p.id === pid ? { ...p, born } : p)) })),
});

let lastWidth = "";
new ResizeObserver(() => { const w = `${$("people").clientWidth}`; if (w !== lastWidth) { lastWidth = w; drawCharts(); } }).observe($("people"));
// The fitness chart is hidden in other journals; draw it again at its real width when it shows.
addEventListener("journalchange", () => drawCharts());

function buildSetup() {
  $("startDate").value = today();
  $("setupPeople").innerHTML = [1, 2].map((n) => `<fieldset>
    <legend>Person ${n}</legend>
    <label for="s${n}-name">Name<input type="text" id="s${n}-name" autocomplete="off"></label>
    <div class="two">
      <label for="s${n}-age">Age<input id="s${n}-age" type="number" min="1" max="120" inputmode="numeric"></label>
      <label for="s${n}-sex">Sex<select id="s${n}-sex"><option>Male</option><option>Female</option></select></label>
    </div>
    <div class="two">
      <label for="s${n}-cm">Height, cm<input id="s${n}-cm" type="number" min="100" max="250" inputmode="numeric"></label>
      <label for="s${n}-kg">Weight, kg<input id="s${n}-kg" type="number" min="30" max="250" step="0.1" inputmode="decimal"></label>
    </div></fieldset>`).join("");
}
$("setupForm").addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const msg = $("setupMsg"), date = $("startDate").value, people = [], batch = writeBatch(db);
  for (const n of [1, 2]) {
    const name = $(`s${n}-name`).value.trim(), age = Number($(`s${n}-age`).value), cm = Number($(`s${n}-cm`).value), kg = r1(Number($(`s${n}-kg`).value));
    if (!name || !(age >= 1 && age <= 120) || !(cm >= 100 && cm <= 250) || !(kg >= 30 && kg <= 250)) { msg.textContent = `Fill in every field for person ${n}. Height is 100 to 250 cm and weight is 30 to 250 kg.`; return; }
    const id = "p" + n;
    people.push({ id, name, age, sex: $(`s${n}-sex`).value, cm });
    batch.set(doc(entriesCol, `${id}_${date}`), { person: id, date, weight: kg, note: "Starting weight." });
  }
  if (!date) { msg.textContent = "Pick the date of these weights."; return; }
  batch.set(doc(db, "config", "people"), { people });
  $("setupSave").disabled = true;
  try { await batch.commit(); } catch (_) { msg.textContent = "That didn't save. Check your connection and try again."; $("setupSave").disabled = false; }
});

function startApp(user) {
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
    $("who").innerHTML = PEOPLE.map((p, i) => `<input type="radio" name="person" id="person-${p.id}" value="${p.id}"${i ? "" : " checked"}><label for="person-${p.id}">${esc(p.name)}</label>`).join("");
    resetForm();
    renderFoot();
    show("app");
    render();
    refreshActivities();
    refreshMeals();
  }, denied));
  unsubs.push(onSnapshot(entriesCol, (snap) => {
    entries = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date || ""));
    if (PEOPLE.length) { entries = entries.filter((e) => PEOPLE.some((p) => p.id === e.person)); render(); refreshMove(); }
  }, denied));
  startActivities();
  startMeals();
}
function stop() { unsubs.forEach((u) => u()); unsubs = []; stopActivities(); stopMeals(); }

// ---------- Demo ----------
// Keys the demo keeps in this tab. journal-theme stays so the day/night choice carries on.
function clearDemo(keepOn) {
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith("journal-") && k !== "journal-theme" && !(keepOn && k === "journal-demo")).forEach((k) => sessionStorage.removeItem(k));
  } catch (_) {}
}
document.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", () => {
  try { sessionStorage.setItem("journal-demo", "1"); } catch (_) { $("loginMsg").textContent = "The demo needs this browser to allow site storage."; return; }
  scrollTo(0, 0);
  location.replace(location.pathname); // start at the dashboard, not a #page
}));
$("demoReset").addEventListener("click", () => { clearDemo(true); scrollTo(0, 0); location.replace(location.pathname); });
$("demoExit").addEventListener("click", () => { clearDemo(false); scrollTo(0, 0); location.replace(location.pathname); });

if (DEMO) {
  $("demoBar").hidden = false;
  $("signOut").hidden = true;
  show("loading");
  startApp(null);
} else {
  onAuthStateChanged(auth, (user) => {
    stop();
    if (user) { show("loading"); startApp(user); }
    else { show("login"); visitors(); }
  });
}
// ---------- Visitors (landing page) ----------
// Counts each new device once, by country guessed from its time zone (see visits.js), then shows the totals.
let visitorsDone = false;
async function visitors() {
  if (visitorsDone) return;
  visitorsDone = true;
  let zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) {}
  const mine = countryOf(zone);
  const names = (() => { try { return new Intl.DisplayNames([navigator.language || "en", "en"], { type: "region" }); } catch (_) { return null; } })();
  const nameOf = (cc) => (cc === UNKNOWN ? "Somewhere else" : names?.of(cc) || cc);
  try {
    let seen = false;
    try { seen = localStorage.getItem("journal-visited") === "1"; } catch (_) { seen = true; }
    if (!seen && !isBot(navigator.userAgent, navigator.webdriver)) {
      await setDoc(doc(db, "visits", mine), { n: increment(1) }, { merge: true });
      try { localStorage.setItem("journal-visited", "1"); } catch (_) {}
    }
  } catch (_) {} // refused or offline: still show what we can
  try {
    const snap = await getDocs(collection(db, "visits"));
    const { total, countries } = summarise(snap.docs.map((d) => ({ id: d.id, n: d.data().n })));
    if (!total) return;
    const top = countries.slice(0, 12), rest = countries.length - top.length;
    $("visTotal").textContent = total.toLocaleString();
    $("visPeople").textContent = total === 1 ? "person has" : "people have";
    const known = countries.filter((c) => c.cc !== UNKNOWN).length;
    $("visCount").textContent = `${known} ${known === 1 ? "country" : "countries"}`;
    $("visList").innerHTML = top.map((c) => `<li${c.cc === mine ? ' class="you"' : ""}><span aria-hidden="true">${flagOf(c.cc)}</span> ${esc(nameOf(c.cc))}<b>${c.n.toLocaleString()}</b></li>`).join("")
      + (rest > 0 ? `<li class="more">and ${rest} more ${rest === 1 ? "country" : "countries"}</li>` : "");
    $("visYou").textContent = mine === UNKNOWN ? "" : `You're visiting from ${nameOf(mine)}.`;
    $("visitors").hidden = false;
  } catch (_) {}
}

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

// Day / night switch. With no saved choice the app follows the phone's own setting.
const darkQuery = matchMedia("(prefers-color-scheme: dark)");
const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light")) === "dark";
const themeBtns = document.querySelectorAll(".theme");
const showTheme = () => themeBtns.forEach((b) => { b.textContent = isDark() ? "☀️ Day" : "🌙 Night"; b.setAttribute("aria-label", isDark() ? "Switch to day mode" : "Switch to night mode"); });
themeBtns.forEach((b) => b.addEventListener("click", () => {
  const next = isDark() ? "light" : "dark";
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem("journal-theme", next); } catch (_) {}
  showTheme();
}));
darkQuery.addEventListener("change", showTheme);
showTheme();

let installEvent = null;
window.addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; $("install").hidden = false; });
$("install").addEventListener("click", async () => { if (!installEvent) return; installEvent.prompt(); await installEvent.userChoice; installEvent = null; $("install").hidden = true; });
window.addEventListener("appinstalled", () => { $("install").hidden = true; });
if ("serviceWorker" in navigator && !LOCAL) navigator.serviceWorker.register("/sw.js");
