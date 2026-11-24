// Activities, ideas inbox, daily habits and the "Your Next Move" card.
// Data lives in Firestore next to the journal entries (same login, same offline cache):
//   activities/{auto id}       one per skill, task, place, dish or habit, owned by "p1" or "p2"
//   habitDays/{person}_{date}  { owner, date, done: [habit ids], skipped: [habit ids] }, one per person per day
//   moves/{auto id}            { owner, item, type, act: done|later|another, date, hour }, what was done or passed over,
//                              so suggestions learn each person's patterns (see learn() in suggest.js)
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, arrayUnion, arrayRemove, query, where,
} from "../../core/fs.js";
import {
  TYPES, ALL_DAYS, guessType, isScheduled, habitState, habitWeek, describe, firstOpenStep, scoreOf, pickNext, learn,
} from "../../logic/suggest.js";
import { journalView, DASH, DASH_LINE } from "../../core/journal.js";
import { confirmDelete } from "../../core/confirm.js";
import { canEdit, viewOnly } from "../../core/owner.js";
import { $, esc, iso, parse, dayNum, addDays, today, lastUsed } from "../../core/util.js";
import { rm } from "../../logic/ledger.js";

const fmt = (s) => parse(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const safeUrl = (u) => /^https?:\/\//i.test(u || "") ? u : "";
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TABS = { inbox: "Ideas", active: "Active", paused: "Paused", done: "Done" };

let db, people, commit, exercisedToday, onChange, bills, actsCol, daysCol, movesCol, nextCol;
let acts = [], dayDocs = [], moves = [], movesReady = false, nextReady = false, unsubs = [];
let me = null, tab = "inbox", typeFilter = "", editing = null, draft = null;
let moveMsg = "", undoFn = null, undoId = null, addTypeTouched = false, lastDay = today();

export function initActivities(opts) {
  ({ db, people, commit, exercisedToday, onChange, bills } = opts);
  actsCol = collection(db, "activities");
  daysCol = collection(db, "habitDays");
  movesCol = collection(db, "moves");
  nextCol = collection(db, "nextMove");
  wire();
  // Open where you left off: the last page on this phone (the journal itself is kept by the wheel, "journal-type").
  const last = store.get("journal-page", "");
  if (!location.hash && RESUME.test(last)) history.replaceState(null, "", last);
  window.addEventListener("hashchange", showView);
  // A new day: habits start fresh and the suggestion is chosen again.
  const tick = () => { if (today() !== lastDay) { lastDay = today(); refresh(); } };
  setInterval(tick, 60000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) tick(); });
}

export function startActivities() {
  unsubs.push(onSnapshot(actsCol, (snap) => { acts = snap.docs.map((d) => ({ id: d.id, ...d.data() })); refresh(); }));
  unsubs.push(onSnapshot(daysCol, (snap) => { dayDocs = snap.docs.map((d) => d.data()); refresh(); }));
  // Only the last 180 days are used for learning, so older history isn't downloaded.
  unsubs.push(onSnapshot(query(movesCol, where("date", ">=", addDays(today(), -180))), (snap) => { moves = snap.docs.map((d) => d.data()); movesReady = true; renderMove(); onChange?.(); }));
  // What the widget shows (see publishMoves). Read so phones keep the same pick and don't rewrite an unchanged one.
  unsubs.push(onSnapshot(nextCol, (snap) => { published = Object.fromEntries(snap.docs.map((d) => [d.id, d.data()])); nextReady = true; renderMove(); }));
}
// The journal calls this when entries change, so "already exercised today" stays current.
export function refreshMove() { if (people().length && me) renderMove(); }
export function stopActivities() { unsubs.forEach((u) => u()); unsubs = []; movesReady = nextReady = false; published = {}; sent = {}; }

// Called once the people are known, and again on every data change.
export function refresh() {
  const ps = people();
  if (!ps.length) return;
  if (editing && $("editor")) readEditor(); // keep unsaved typing when new data arrives
  if (!ps.some((p) => p.id === me)) me = ps.some((p) => p.id === store.get("journal-me")) ? store.get("journal-me") : ps[0].id;
  $("me").innerHTML = ps.map((p) => `<input type="radio" name="me" id="me-${p.id}" value="${p.id}"${p.id === me ? " checked" : ""}><label for="me-${p.id}">${esc(p.name)}</label>`).join("");
  $("meRo").hidden = !ro(); // looking at the other person's journal: theirs to change, not yours
  $("addForm").hidden = ro();
  if (!addTypeTouched && !$("addTitle").value.trim()) setAddType(lastType()); // an empty Add box starts on the last type
  showView();
  renderMove();
  renderHabits();
  renderList();
  onChange?.();
}

// The person picked with "For" at the top (the mood card and page follow it too).
export const currentPerson = () => me;
// True while "For" is the other person: their next move, habits and list show, but only they can change them.
const ro = () => !canEdit(me);

// Habits and Next Moves per day for one person, for the mood page: { date: { habitsDone, habitsDue, habits, move } }.
// "habits" = at least half of that day's due habits were ticked.
export function habitFacts(pid) {
  const out = {}, hs = acts.filter((a) => a.owner === pid && a.type === "habit" && a.status !== "inbox");
  for (const d of dayDocs) {
    if (d.owner !== pid) continue;
    const done = (d.done || []).length;
    const due = Math.max(done, hs.filter((h) => (!h.created || h.created <= d.date) && isScheduled(h, d.date) && !(d.skipped || []).includes(h.id)).length);
    out[d.date] = { habitsDone: done, habitsDue: due, habits: due > 0 && done / due >= 0.5 };
  }
  for (const m of moves) if (m.owner === pid && m.act === "done" && m.type !== "habit") (out[m.date] ||= {}).move = true;
  return out;
}

const RESUME = /^#(activities|mood|mealsets|fitness\/[\w-]+|diary(?:\/(?:write|ai|(?:edit|read)\/[\w-]+))?|stocky(?:\/(?:add|prices|plan|item\/[\w-]+))?|ledger(?:\/spend\/[\w-]+|\/analytics)?)$/;
function showView() {
  const h = location.hash;
  store.set("journal-page", RESUME.test(h) ? h : "");
  // The Dashboard tab shows the journal picked on the wheel (journalView in journal.js).
  const view = h === "#activities" ? "activities" : h.startsWith("#fitness") ? "fitness" : h === "#mood" ? "mood" : h === "#soon" ? "soon" : h === "#guide" ? "guide"
    : h.startsWith("#diary") ? "diary" : h.startsWith("#stocky") ? "stocky" : h.startsWith("#ledger") ? "ledger" : h === "#meals" ? "meals" : h === "#mealsets" ? "mealsets" : journalView();
  ["home", "meals", "mealsets", "soon", "guide", "diary", "stocky", "ledger", "activities", "fitness", "mood"].forEach((v) => { $(v).hidden = v !== view; });
  // Each journal has its own dashboard (DASH in journal.js): only Weight shows the shared top. Meals and Ledger
  // get the person cards with just their own part, under their own cards; a Ledger page (#ledger/…) keeps to itself.
  const dash = DASH[view] || {}, subpage = view === "ledger" && h.includes("/");
  $("shared").hidden = !dash.shared;
  const journal = (!subpage && dash.people) || "", slot = journal && document.querySelector(`.jslot[data-slot="${journal}"]`), people = $("people");
  if (slot && people.parentNode !== slot) slot.append(people);
  people.hidden = !journal;
  if (people.dataset.journal !== journal) { people.dataset.journal = journal; dispatchEvent(new Event("journalchange")); }
  $("jline").textContent = dash.line || DASH_LINE;
  $("meBox").hidden = ["fitness", "mealsets", "guide", "stocky"].includes(view); // the fitness page has its own person switch; sets and groceries are shared
  const tab = ["home", "meals", "mealsets", "soon", "guide", "diary", "stocky", "ledger"].includes(view) ? "home" : view;
  document.querySelectorAll("#nav a").forEach((a) => a.toggleAttribute("aria-current", a.dataset.view === tab));
}

// ---------- data ----------
const mine = (p = me) => acts.filter((a) => a.owner === p);
// Debt bills due within 3 days (billTasks() in moneyplan.js, from Ledger through app.js) join the Next Move
// candidates as one-time tasks. They're never saved as activities, so the list stays clean; "Paid" ticks the
// bill in Ledger and it's gone for both. Shown to whoever ticked it last, or to both when nobody has yet.
const billItems = (p) => (bills?.due() ?? []).filter((r) => !r.who || r.who === p).map((r) => ({
  id: `bill:${r.c.id}_${r.month}`, owner: p, type: "task", status: "active", title: `Pay ${r.c.name}`,
  due: r.due, minutes: 5, created: r.due, note: `${rm(r.amountSen)} for ${r.c.name}. Paid ticks it off in Ledger's bills.`, bill: r,
}));
const moveList = (p = me) => [...mine(p), ...billItems(p)];
const logs = (p = me) => Object.fromEntries(dayDocs.filter((d) => d.owner === p).map((d) => [d.date, d]));
const strip = ({ id, ...rest }) => rest;
const update = (id, patch) => commit(() => updateDoc(doc(actsCol, id), { ...patch, updated: Date.now() }));
const replace = (id, body) => commit(() => setDoc(doc(actsCol, id), { ...body, updated: Date.now() }));
// Note what was done or passed over. Returns a function that takes the note back (for Undo).
function logMove(a, act) {
  if (ro()) return async () => {};
  const ref = doc(movesCol), now = new Date();
  commit(() => setDoc(ref, { owner: me, item: a.id, type: a.bill ? "bill" : a.type, act, date: iso(now), hour: now.getHours(), at: now.getTime() }));
  return () => commit(() => deleteDoc(ref));
}
function markHabit(id, state, date = today()) {
  if (ro()) return Promise.resolve();
  const ref = doc(daysCol, `${me}_${date}`);
  const body = { owner: me, date, done: state === "done" ? arrayUnion(id) : arrayRemove(id), skipped: state === "skipped" ? arrayUnion(id) : arrayRemove(id), updated: Date.now() };
  return commit(() => setDoc(ref, body, { merge: true }));
}

// ---------- Your Next Move ----------
const ctxNow = (p = me) => ({
  today: today(), hour: new Date().getHours(), logs: logs(p), recent: store.get(`journal-recent-${p}`, []),
  profile: learn(moves.filter((m) => m.owner === p), today()), exercised: !!exercisedToday?.(p),
});
const skipKey = (p = me) => `journal-skip-${p}`;
const skipList = (p = me) => { const s = store.get(skipKey(p), null); return s && s.date === today() ? s.ids : []; };
const setSkip = (ids, p = me) => store.set(skipKey(p), { date: today(), ids });

// Keep showing the same suggestion until it's acted on, so it doesn't jump around while data syncs.
// The pick published to nextMove is kept too, so phones agree: for the person picked with "For" this phone's own
// pick comes first (they're using it), for the other person the published one does (their phone may have moved on).
function currentMove(p = me) {
  const ctx = ctxNow(p), all = moveList(p), local = store.get(`journal-current-${p}`, null), shared = published[p];
  const mineToday = local && local.date === ctx.today; // id null = acted on here today (Done / Not now / Suggest another)
  const keeps = [mineToday && local.id, !(p === me && mineToday) && shared && shared.date === ctx.today && shared.item];
  if (p !== me) keeps.reverse();
  for (const id of keeps) {
    const a = id && all.find((x) => x.id === id), s = a && scoreOf(a, { ...ctx, recent: [], all });
    if (s) return { a, ...s };
  }
  let pick = pickNext(all, { ...ctx, skip: new Set(skipList(p)) });
  if (!pick && skipList(p).length) { setSkip([], p); pick = pickNext(all, ctx); } // everything was passed over: new round
  if (pick && movesReady) remember(pick.a.id, p); // only settle on a pick once the history has loaded
  return pick;
}
function remember(id, p = me) {
  store.set(`journal-current-${p}`, { date: today(), id });
  store.set(`journal-recent-${p}`, [id, ...store.get(`journal-recent-${p}`, []).filter((x) => x !== id)].slice(0, 5));
}
const clearCurrent = () => store.set(`journal-current-${me}`, { date: today(), id: null });

// ---------- Home-screen widget feed ----------
// nextMove/{person} holds each person's current pick, so the Android widget (android/) shows what the app shows
// without copying the suggestion rules. Each phone publishes only the signed-in person's (firestore.rules lets
// nobody write the other's), so a widget refreshes when its owner opens the app. Written only when it differs from what Firestore already has (and not twice while a write is on its way).
let published = {}, sent = {}; // nextMove docs as last read, and the last body this page wrote, per person
const sameAs = (body, d) => !!d && Object.keys(body).every((k) => (d[k] ?? null) === body[k]);
function publishMoves() {
  if (!movesReady || !nextReady) return;
  for (const { id: p } of people()) {
    if (!canEdit(p)) continue;
    const m = currentMove(p), ideas = mine(p).some((a) => a.status === "inbox");
    const body = m
      ? { person: p, item: m.a.id, title: m.a.title, type: m.a.type, why: m.why || "", date: today() }
      : { person: p, item: null, title: null, type: null, why: ideas ? "Look through your ideas" : "Nothing planned. Go somewhere new.", date: today() };
    const key = JSON.stringify(body);
    if (sent[p] === key || sameAs(body, published[p])) { sent[p] = key; continue; }
    sent[p] = key;
    setDoc(doc(nextCol, p), { ...body, updated: Date.now() }).catch(() => { sent[p] = ""; }); // best effort: the widget keeps the last one
  }
}

function renderMove() {
  publishMoves();
  const m = currentMove(), el = $("next");
  const eyebrow = ro() ? `${esc(people().find((p) => p.id === me)?.name || "Their")}'s next move` : "Your next move";
  const msg = ro() ? viewOnly(me, "next move") : moveMsg ? `<p class="msg" role="status">${esc(moveMsg)}${undoFn ? ` <button type="button" class="link" data-mv="undo">Undo</button>` : ""}</p>` : `<p class="msg" role="status"></p>`;
  if (!m) {
    const ideas = mine().filter((a) => a.status === "inbox").length;
    el.innerHTML = `<p class="eyebrow">${eyebrow}</p>
      ${ro() ? `<h2>Nothing picked right now</h2>${ideas ? `<div class="actions"><a class="btn" href="#activities" data-mv="ideas">See ideas</a></div>` : ""}`
        : ideas
        ? `<h2>Look through your ideas</h2><p class="detail">You have ${ideas} idea${ideas > 1 ? "s" : ""} waiting. Start the one that feels right.</p>
           <div class="actions"><a class="btn primary" href="#activities" data-mv="ideas">See ideas</a></div>`
        : `<h2>Nothing planned. Go somewhere new.</h2><p class="detail">Take a short walk or visit a café you haven't tried. Or add something you'd like to do.</p>
           <div class="actions"><a class="btn primary" href="#activities" data-mv="add">Add something</a></div>`}
      ${msg}`;
    return;
  }
  const { a, why } = m, t = a.bill ? { label: "Bill", color: "--s8" } : TYPES[a.type], { detail, minutes } = describe(a), url = safeUrl(a.url);
  const doneLabel = a.bill ? "Paid" : { skill: "Did it", habit: "Done", explore: "Been there", cook: "Cooked it", task: "Done" }[a.type];
  el.innerHTML = `<p class="eyebrow">${eyebrow}</p>
    <span class="tag" style="--c:var(${t.color})">${t.label}</span>
    <h2>${esc(a.title)}</h2>
    <p class="detail">${esc(detail)}${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Recipe</a>` : ""}</p>
    <p class="meta">${[minutes ? `About ${minutes} min` : "", why].filter(Boolean).map(esc).join(" · ")}</p>
    ${ro() ? "" : `<div class="actions">
      <button type="button" class="primary" data-mv="done">${doneLabel}</button>
      <button type="button" data-mv="later">Not now</button>
      <button type="button" data-mv="another">Suggest another</button>
    </div>`}
    ${msg}`;
}

async function moveAction(act) {
  if (ro()) return;
  const m = currentMove();
  if (act === "undo") { const f = undoFn; undoFn = null; moveMsg = ""; if (f) await f(); if (undoId) remember(undoId); refresh(); return; }
  if (!m) return;
  const { a } = m, before = strip(a);
  moveMsg = ""; undoFn = null; undoId = a.id;
  if (act === "done") {
    if (a.type === "habit") { await markHabit(a.id, "done"); undoFn = () => markHabit(a.id, null); }
    else if (a.bill) {
      const { c, month } = a.bill;
      await bills.pay(c.id, month, `${c.name} ticked as paid.`);
      undoFn = () => bills.undo(c.id, month);
    } else {
      const patch = a.type === "skill" ? { lastDone: today() } : { status: "done", doneOn: today() };
      const step = a.type === "skill" && firstOpenStep(a);
      if (step) patch.steps = a.steps.map((s) => s === step ? { ...s, done: true } : s);
      if (a.type !== "skill") patch.lastDone = today();
      await update(a.id, patch);
      undoFn = () => replace(a.id, before);
    }
    const unlog = logMove(a, "done"), undoDone = undoFn;
    undoFn = async () => { await unlog(); await undoDone(); };
    moveMsg = a.type === "skill" ? `Good work on "${a.title}".` : a.bill ? `${a.bill.c.name} is paid for this month.` : `"${a.title}" is done.`;
    clearCurrent();
  }
  if (act === "later") {
    // Hidden today and the next two days. Habits and bills just step aside for today.
    const todayOnly = a.type === "habit" || !!a.bill;
    if (todayOnly) setSkip([...skipList(), a.id]);
    else await update(a.id, { snoozed: addDays(today(), 2) });
    const unlog = logMove(a, "later");
    undoFn = todayOnly ? () => { setSkip(skipList().filter((x) => x !== a.id)); return unlog(); } : async () => { await unlog(); await replace(a.id, before); };
    moveMsg = "Okay, not now.";
    clearCurrent();
  }
  if (act === "another") {
    logMove(a, "another");
    const skip = [...skipList(), a.id];
    clearCurrent();
    if (pickNext(moveList(), { ...ctxNow(), skip: new Set(skip) })) setSkip(skip);
    else {
      // Went through everything: start a fresh round, just not with the one on screen.
      setSkip([]);
      const again = pickNext(moveList(), { ...ctxNow(), skip: new Set([a.id]) });
      if (again) remember(again.a.id);
      moveMsg = again ? "That's everything. Starting from the top." : "This is the only thing on your list right now.";
    }
  }
  refresh();
}

// ---------- Daily habits ----------
function renderHabits() {
  const d = today(), L = logs();
  const hs = mine().filter((a) => a.type === "habit" && a.status === "active" && isScheduled(a, d));
  const live = hs.filter((h) => habitState(h, L, d) !== "skipped");
  const done = live.filter((h) => habitState(h, L, d) === "done").length;
  $("habits").innerHTML = `<div class="hhead"><p class="eyebrow">Daily habits</p>${live.length ? `<span class="count">${done}/${live.length} done</span>` : ""}</div>
    ${hs.length ? `<ul class="checks">${hs.map((h) => {
      const s = habitState(h, L, d);
      return `<li${s === "skipped" ? ' class="skipped"' : ""}><label><input type="checkbox" data-habit="${esc(h.id)}"${s === "done" ? " checked" : ""}${s === "skipped" || ro() ? " disabled" : ""}><span>${esc(h.title)}${s === "skipped" ? " <small>skipped today</small>" : ""}</span></label></li>`;
    }).join("")}</ul>${ro() ? viewOnly(me, "habits") : ""}`
    : ro() ? `<p class="note">No habits yet.</p>` : `<p class="note">No habits yet. <a href="#activities" data-mv="habits">Add one</a>, like "Drink 2.5L water".</p>`}`;
}

// ---------- Activities page ----------
function bucket(a) { return a.status === "archived" ? "done" : a.status; }

function renderList() {
  const all = mine(), counts = {};
  all.forEach((a) => { const b = bucket(a); counts[b] = (counts[b] || 0) + 1; });
  $("tabs").innerHTML = Object.entries(TABS).map(([k, v]) => `<button type="button" class="chip" data-tab="${k}" aria-pressed="${k === tab}">${v}${counts[k] ? ` <span>${counts[k]}</span>` : ""}</button>`).join("");
  $("typeFilter").value = typeFilter;
  let rows = all.filter((a) => bucket(a) === tab && (!typeFilter || a.type === typeFilter));
  const order = { habit: 0, task: 1, skill: 2, explore: 3, cook: 4 };
  rows.sort((a, b) => tab === "done" ? (b.updated || 0) - (a.updated || 0) : order[a.type] - order[b.type] || (b.updated || 0) - (a.updated || 0));
  const empty = {
    inbox: "No ideas waiting. New things you add land here first, so nothing becomes a commitment until you start it.",
    active: "Nothing active. Start something from Ideas.", paused: "Nothing paused.", done: "Nothing finished yet.",
  }[tab];
  $("list").innerHTML = (ro() ? viewOnly(me, "activities") : "") + (rows.length ? rows.map((a) => a.id === editing ? editorHtml() : rowHtml(a)).join("") : `<p class="note">${typeFilter ? "Nothing of this type here." : empty}</p>`);
}

function metaOf(a) {
  const out = [], d = today();
  if (a.type === "task" && a.due && a.status === "active") {
    const left = dayNum(a.due) - dayNum(d);
    out.push(left < 0 ? `<span class="late">Was due ${esc(fmt(a.due))}</span>` : `Due ${esc(fmt(a.due))}`);
  }
  if (a.type === "skill") {
    const n = (a.steps || []).length, k = (a.steps || []).filter((s) => s.done).length;
    if (n) out.push(`${k} of ${n} steps`);
    if (a.lastDone) out.push(`Last worked on ${esc(fmt(a.lastDone))}`);
  }
  if (a.type === "habit") {
    const days = a.days?.length && a.days.length < 7 ? a.days.map((x) => DAY_NAMES[x]).join(", ") : "Every day";
    out.push(esc(days));
    if (a.status === "active") {
      const w = habitWeek(a, logs(), d), s = habitState(a, logs(), d);
      if (w.due) out.push(`Last 7 days: ${w.done} of ${w.due}`);
      if (s) out.push(s === "done" ? "Done today" : "Skipped today");
    }
  }
  if (a.location) out.push(esc(a.location));
  if (a.minutes && a.type !== "habit") out.push(`About ${a.minutes} min`);
  if (a.favourite) out.push("★ Favourite");
  if (a.status === "done" && a.doneOn) out.push(`${{ explore: "Visited", cook: "Tried" }[a.type] || "Done"} ${esc(fmt(a.doneOn))}`);
  if (a.status === "archived") out.push("Archived");
  if (a.snoozed && a.snoozed >= d && a.status === "active") out.push(`Resting until ${esc(fmt(addDays(a.snoozed, 1)))}`);
  return out.join(" · ");
}

function rowHtml(a) {
  const t = TYPES[a.type], id = esc(a.id), b = (act, label, cls = "") => `<button type="button" class="mini ${cls}" data-act="${act}" data-id="${id}">${label}</button>`;
  let btns = ""; // the other person's: nothing to press
  if (!canEdit(a.owner)) btns = "";
  else if (a.status === "inbox") btns = b("start", "Start", "go") + b("edit", "Edit") + b("archive", "Archive");
  else if (a.status === "active") btns = (a.type === "habit" && isScheduled(a, today()) ? (habitState(a, logs(), today()) === "skipped" ? b("unskip", "Unskip") : b("skip", "Skip today")) : "") + b("edit", "Edit") + b("pause", "Pause");
  else if (a.status === "paused") btns = b("resume", "Resume", "go") + b("edit", "Edit");
  else btns = b(a.status === "archived" ? "restore-idea" : "resume", a.status === "archived" ? "Back to ideas" : "Do again") + b("del", "Delete");
  const url = safeUrl(a.url), meta = metaOf(a);
  return `<div class="act">
    <div class="act-main">
      <span class="tag" style="--c:var(${t.color})">${t.label}</span>
      <div class="act-title">${esc(a.title)}${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Recipe</a>` : ""}</div>
      ${meta ? `<div class="act-meta">${meta}</div>` : ""}
      ${a.note ? `<p class="act-note">${esc(a.note)}</p>` : ""}
    </div>
    <div class="btns">${btns}</div>
  </div>`;
}

function typeOptions(sel) { return Object.entries(TYPES).map(([k, v]) => `<option value="${k}"${k === sel ? " selected" : ""}>${v.label}</option>`).join(""); }

function editorHtml() {
  const a = draft, f = (id, label, input) => `<label for="ed-${id}">${label}${input}</label>`;
  const typeFields = {
    task: f("due", "Due date <small>optional</small>", `<input type="date" id="ed-due" value="${esc(a.due || "")}">`),
    skill: `<div class="lbl"><span>Steps and milestones <small>optional, small and doable</small></span>
      <ul class="steps">${(a.steps || []).map((s, i) => `<li><label class="inline"><input type="checkbox" data-step="${i}"${s.done ? " checked" : ""}><span>${esc(s.text)}</span></label><button type="button" class="mini" data-act="step-del" data-i="${i}" aria-label="Remove step">✕</button></li>`).join("")}</ul>
      <div class="addrow"><input type="text" id="ed-step" placeholder="e.g. Edit two photos" maxlength="120"><button type="button" class="mini" data-act="step-add">Add step</button></div></div>`,
    explore: f("location", "Where <small>optional</small>", `<input type="text" id="ed-location" value="${esc(a.location || "")}" maxlength="120">`),
    cook: f("url", "Recipe link <small>optional</small>", `<input type="url" id="ed-url" value="${esc(a.url || "")}" placeholder="https://" inputmode="url">`)
      + `<label class="inline"><input type="checkbox" id="ed-fav"${a.favourite ? " checked" : ""}><span>Favourite</span></label>`,
    habit: `<div class="lbl"><span>Which days</span><div class="days">${ALL_DAYS.map((d) => `<label class="inline"><input type="checkbox" data-day="${d}"${(a.days?.length ? a.days : ALL_DAYS).includes(d) ? " checked" : ""}><span>${DAY_NAMES[d]}</span></label>`).join("")}</div></div>`,
  }[a.type];
  return `<form class="editor" id="editor" novalidate>
    ${f("title", "Title", `<input type="text" id="ed-title" value="${esc(a.title)}" maxlength="120" required>`)}
    <div class="two">
      ${f("type", "Type", `<select id="ed-type">${typeOptions(a.type)}</select>`)}
      ${a.type === "habit" ? "" : f("minutes", "Time needed, min", `<input type="number" id="ed-minutes" min="1" max="1440" inputmode="numeric" value="${a.minutes || ""}">`)}
    </div>
    ${typeFields}
    ${f("note", "Notes <small>what to do, anything to remember</small>", `<textarea id="ed-note" maxlength="1000">${esc(a.note || "")}</textarea>`)}
    <div class="actions">
      <button type="submit" class="primary">Save</button>
      <button type="button" data-act="ed-cancel">Cancel</button>
      <button type="button" class="push" data-act="del" data-id="${esc(a.id)}">Delete</button>
    </div>
    <p class="msg" id="edMsg" role="status"></p>
  </form>`;
}

// Copy what's typed in the editor into the draft, so switching type or adding a step keeps it.
function readEditor() {
  const v = (id) => $("ed-" + id)?.value.trim();
  draft.title = v("title") ?? draft.title;
  draft.type = v("type") || draft.type;
  draft.note = v("note") ?? draft.note;
  if ($("ed-minutes")) draft.minutes = Number(v("minutes")) || null;
  if ($("ed-due")) draft.due = v("due") || null;
  if ($("ed-location")) draft.location = v("location") || null;
  if ($("ed-url")) draft.url = v("url") || null;
  if ($("ed-fav")) draft.favourite = $("ed-fav").checked;
  const days = [...document.querySelectorAll("#editor [data-day]")];
  if (days.length) draft.days = days.filter((x) => x.checked).map((x) => Number(x.dataset.day));
  document.querySelectorAll("#editor [data-step]").forEach((x) => { draft.steps[Number(x.dataset.step)].done = x.checked; });
}

async function saveEditor() {
  if (ro()) return;
  readEditor();
  const msg = $("edMsg");
  if (!draft.title) { msg.textContent = "Give it a title."; return; }
  if (draft.url && !safeUrl(draft.url)) { msg.textContent = "The recipe link should start with http:// or https://."; return; }
  if (draft.type === "habit" && draft.days && !draft.days.length) { msg.textContent = "Pick at least one day, or pause the habit instead."; return; }
  // Keep only fields that mean something for this type, and drop empty ones.
  const keepFor = { task: ["due", "minutes"], skill: ["steps", "minutes", "lastDone"], explore: ["location", "minutes"], cook: ["url", "favourite", "minutes"], habit: ["days"] }[draft.type];
  const base = ["owner", "title", "type", "status", "note", "created", "doneOn", "lastDone", "snoozed"];
  const body = {};
  for (const k of [...base, ...keepFor]) {
    const val = draft[k];
    if (val == null || val === "" || val === false || (Array.isArray(val) && !val.length)) continue;
    if (k === "days" && val.length === 7) continue;
    body[k] = val;
  }
  const id = editing;
  editing = draft = null;
  await replace(id, body);
  renderList();
}

// The type a new activity starts on (great-ux: start from the last choice): the last one this person added.
const lastType = () => lastUsed(acts.filter((a) => a.owner === me).map((a) => ({ type: a.type, date: a.created, at: a.updated })), "type");
function setAddType(t) {
  const sel = $("addType"), blank = sel.querySelector('option[value=""]');
  if (!t && !blank) sel.insertAdjacentHTML("afterbegin", `<option value="" disabled>Pick one</option>`);
  sel.value = t || "";
}
async function addActivity(ev) {
  ev.preventDefault();
  if (ro()) return;
  const title = $("addTitle").value.trim(), type = $("addType").value;
  if (!title) { $("addMsg").textContent = "Type what you'd like to add first."; return; }
  if (!type) { $("addMsg").textContent = "Pick what kind it is: skill, task, explore, cooking or habit."; $("addType").focus(); return; }
  const ref = doc(actsCol);
  $("addTitle").value = ""; addTypeTouched = false; setAddType(lastType() || type);
  $("addMsg").textContent = `Saved "${title}" to Ideas. Start it when you're ready.`;
  tab = "inbox"; typeFilter = "";
  await commit(() => setDoc(ref, { owner: me, title, type, status: "inbox", created: today(), updated: Date.now() }), `Added "${title}" to Ideas.`);
}

async function listAction(act, id) {
  if (ro()) return;
  const a = acts.find((x) => x.id === id);
  if (act === "edit") { editing = id; draft = structuredClone(a); draft.steps ||= []; renderList(); $("ed-title")?.focus(); return; }
  if (act === "ed-cancel") { editing = draft = null; renderList(); return; }
  if (act === "step-add") { readEditor(); const t = $("ed-step").value.trim(); if (t) draft.steps.push({ text: t, done: false }); renderList(); $("ed-step")?.focus(); return; }
  if (act === "del") {
    if (editing) readEditor();
    if (!a) return;
    const steps = a.steps?.length || 0;
    const ok = await confirmDelete({ title: `Delete ${a.title}?`, yes: "Delete it",
      body: `<p>It goes from the list${steps ? `, with its ${steps} step${steps === 1 ? "" : "s"}` : ""}. What was already done stays in the history.</p>` });
    if (!ok) return;
    if (editing === id) editing = draft = null;
    await commit(() => deleteDoc(doc(actsCol, id))); return;
  }
  if (!a) return;
  const started = a.status === "inbox" ? { started: today() } : {};
  if (act === "start" || act === "resume") await update(id, { status: "active", snoozed: null, ...started });
  if (act === "pause") await update(id, { status: "paused" });
  if (act === "archive") await update(id, { status: "archived" });
  if (act === "restore-idea") await update(id, { status: "inbox" });
  if (act === "skip") await markHabit(id, "skipped");
  if (act === "unskip") await markHabit(id, null);
}

function wire() {
  $("next").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-mv]"); if (!b) return;
    if (b.dataset.mv === "ideas") { tab = "inbox"; typeFilter = ""; return; }
    if (b.dataset.mv === "add") { setTimeout(() => $("addTitle").focus(), 0); return; }
    moveAction(b.dataset.mv);
  });
  $("habits").addEventListener("click", (ev) => { if (ev.target.closest("[data-mv=habits]")) { tab = "active"; typeFilter = "habit"; setTimeout(() => $("addTitle").focus(), 0); } });
  $("habits").addEventListener("change", (ev) => {
    const box = ev.target.closest("[data-habit]"); if (!box) return;
    const h = acts.find((x) => x.id === box.dataset.habit);
    markHabit(box.dataset.habit, box.checked ? "done" : null);
    if (h && box.checked) logMove(h, "done"); // ticking a habit teaches when it usually gets done
  });
  $("me").addEventListener("change", (ev) => { me = ev.target.value; store.set("journal-me", me); editing = draft = null; moveMsg = ""; undoFn = null; refresh(); });
  $("addTitle").addEventListener("input", () => { if (!addTypeTouched) setAddType(guessType($("addTitle").value, lastType())); });
  $("addType").addEventListener("change", () => { addTypeTouched = true; });
  $("addForm").addEventListener("submit", addActivity);
  $("tabs").addEventListener("click", (ev) => { const b = ev.target.closest("[data-tab]"); if (!b) return; tab = b.dataset.tab; editing = draft = null; renderList(); });
  $("typeFilter").addEventListener("change", () => { typeFilter = $("typeFilter").value; renderList(); });
  $("list").addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-act]"); if (!b) return;
    if (b.dataset.act === "step-del") { readEditor(); draft.steps.splice(Number(b.dataset.i), 1); renderList(); return; }
    listAction(b.dataset.act, b.dataset.id || editing);
  });
  $("list").addEventListener("change", (ev) => { if (ev.target.id === "ed-type") { readEditor(); renderList(); } });
  $("list").addEventListener("submit", (ev) => { ev.preventDefault(); saveEditor(); });
  $("list").addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.id === "ed-step") { ev.preventDefault(); listAction("step-add"); } });
}
