// Activities, ideas inbox, daily habits and the "Your Next Move" card.
// Data lives in Firestore next to the journal entries (same login, same offline cache):
//   activities/{auto id}       one per skill, task, place, dish or habit, owned by "p1" or "p2"
//   habitDays/{person}_{date}  { owner, date, done: [habit ids], skipped: [habit ids] }, one per person per day
//   moves/{auto id}            { owner, item, type, act: done|later|another, date, hour }, what was done or passed over,
//                              so suggestions learn each person's patterns (see learn() in suggest.js)
import {
  collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, arrayUnion, arrayRemove, query, where,
} from "https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js";
import {
  TYPES, ALL_DAYS, guessType, isScheduled, habitState, habitWeek, describe, firstOpenStep, scoreOf, pickNext, learn, iso, parse, addDays, dayNum,
} from "./suggest.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => iso(new Date());
const fmt = (s) => parse(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const safeUrl = (u) => /^https?:\/\//i.test(u || "") ? u : "";
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TABS = { inbox: "Ideas", active: "Active", paused: "Paused", done: "Done" };

let db, people, commit, exercisedToday, actsCol, daysCol, movesCol;
let acts = [], dayDocs = [], moves = [], movesReady = false, unsubs = [];
let me = null, tab = "inbox", typeFilter = "", editing = null, draft = null, confirmDel = null;
let moveMsg = "", undoFn = null, undoId = null, addTypeTouched = false, lastDay = today();

export function initActivities(opts) {
  ({ db, people, commit, exercisedToday } = opts);
  actsCol = collection(db, "activities");
  daysCol = collection(db, "habitDays");
  movesCol = collection(db, "moves");
  wire();
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
  unsubs.push(onSnapshot(query(movesCol, where("date", ">=", addDays(today(), -180))), (snap) => { moves = snap.docs.map((d) => d.data()); movesReady = true; renderMove(); }));
}
// The journal calls this when entries change, so "already exercised today" stays current.
export function refreshMove() { if (people().length && me) renderMove(); }
export function stopActivities() { unsubs.forEach((u) => u()); unsubs = []; movesReady = false; }

// Called once the people are known, and again on every data change.
export function refresh() {
  const ps = people();
  if (!ps.length) return;
  if (editing && $("editor")) readEditor(); // keep unsaved typing when new data arrives
  if (!ps.some((p) => p.id === me)) me = ps.some((p) => p.id === store.get("journal-me")) ? store.get("journal-me") : ps[0].id;
  $("me").innerHTML = ps.map((p) => `<input type="radio" name="me" id="me-${p.id}" value="${p.id}"${p.id === me ? " checked" : ""}><label for="me-${p.id}">${esc(p.name)}</label>`).join("");
  showView();
  renderMove();
  renderHabits();
  renderList();
}

function showView() {
  const onList = location.hash === "#activities";
  $("home").hidden = onList;
  $("activities").hidden = !onList;
  document.querySelectorAll("#nav a").forEach((a) => a.toggleAttribute("aria-current", (a.dataset.view === "activities") === onList));
}

// ---------- data ----------
const mine = () => acts.filter((a) => a.owner === me);
const logs = () => Object.fromEntries(dayDocs.filter((d) => d.owner === me).map((d) => [d.date, d]));
const strip = ({ id, ...rest }) => rest;
const update = (id, patch) => commit(() => updateDoc(doc(actsCol, id), { ...patch, updated: Date.now() }));
const replace = (id, body) => commit(() => setDoc(doc(actsCol, id), { ...body, updated: Date.now() }));
// Note what was done or passed over. Returns a function that takes the note back (for Undo).
function logMove(a, act) {
  const ref = doc(movesCol), now = new Date();
  commit(() => setDoc(ref, { owner: me, item: a.id, type: a.type, act, date: iso(now), hour: now.getHours() }));
  return () => commit(() => deleteDoc(ref));
}
function markHabit(id, state, date = today()) {
  const ref = doc(daysCol, `${me}_${date}`);
  const body = { owner: me, date, done: state === "done" ? arrayUnion(id) : arrayRemove(id), skipped: state === "skipped" ? arrayUnion(id) : arrayRemove(id) };
  return commit(() => setDoc(ref, body, { merge: true }));
}

// ---------- Your Next Move ----------
const ctxNow = () => ({
  today: today(), hour: new Date().getHours(), logs: logs(), recent: store.get(`journal-recent-${me}`, []),
  profile: learn(moves.filter((m) => m.owner === me), today()), exercised: !!exercisedToday?.(me),
});
const skipKey = () => `journal-skip-${me}`;
const skipList = () => { const s = store.get(skipKey(), null); return s && s.date === today() ? s.ids : []; };
const setSkip = (ids) => store.set(skipKey(), { date: today(), ids });

// Keep showing the same suggestion until it's acted on, so it doesn't jump around while data syncs.
function currentMove() {
  const ctx = ctxNow(), all = mine(), keep = store.get(`journal-current-${me}`, null);
  if (keep && keep.date === ctx.today) {
    const a = all.find((x) => x.id === keep.id), s = a && scoreOf(a, { ...ctx, recent: [], all });
    if (s) return { a, ...s };
  }
  let pick = pickNext(all, { ...ctx, skip: new Set(skipList()) });
  if (!pick && skipList().length) { setSkip([]); pick = pickNext(all, ctx); } // everything was passed over: new round
  if (pick && movesReady) remember(pick.a.id); // only settle on a pick once the history has loaded
  return pick;
}
function remember(id) {
  store.set(`journal-current-${me}`, { date: today(), id });
  store.set(`journal-recent-${me}`, [id, ...store.get(`journal-recent-${me}`, []).filter((x) => x !== id)].slice(0, 5));
}
const clearCurrent = () => store.set(`journal-current-${me}`, null);

function renderMove() {
  const m = currentMove(), el = $("next");
  const msg = moveMsg ? `<p class="msg" role="status">${esc(moveMsg)}${undoFn ? ` <button type="button" class="link" data-mv="undo">Undo</button>` : ""}</p>` : `<p class="msg" role="status"></p>`;
  if (!m) {
    const ideas = mine().filter((a) => a.status === "inbox").length;
    el.innerHTML = `<p class="eyebrow">Your next move</p>
      ${ideas
        ? `<h2>Look through your ideas</h2><p class="detail">You have ${ideas} idea${ideas > 1 ? "s" : ""} waiting. Start the one that feels right.</p>
           <div class="actions"><a class="btn primary" href="#activities" data-mv="ideas">See ideas</a></div>`
        : `<h2>Nothing planned. Go somewhere new.</h2><p class="detail">Take a short walk or visit a café you haven't tried. Or add something you'd like to do.</p>
           <div class="actions"><a class="btn primary" href="#activities" data-mv="add">Add something</a></div>`}
      ${msg}`;
    return;
  }
  const { a, why } = m, t = TYPES[a.type], { detail, minutes } = describe(a), url = safeUrl(a.url);
  const doneLabel = { skill: "Did it", habit: "Done", explore: "Been there", cook: "Cooked it", task: "Done" }[a.type];
  el.innerHTML = `<p class="eyebrow">Your next move</p>
    <span class="tag" style="--c:var(${t.color})">${t.label}</span>
    <h2>${esc(a.title)}</h2>
    <p class="detail">${esc(detail)}${url ? ` <a href="${esc(url)}" target="_blank" rel="noopener noreferrer">Recipe</a>` : ""}</p>
    <p class="meta">${[minutes ? `About ${minutes} min` : "", why].filter(Boolean).map(esc).join(" · ")}</p>
    <div class="actions">
      <button type="button" class="primary" data-mv="done">${doneLabel}</button>
      <button type="button" data-mv="later">Not now</button>
      <button type="button" data-mv="another">Suggest another</button>
    </div>
    ${msg}`;
}

async function moveAction(act) {
  const m = currentMove();
  if (act === "undo") { const f = undoFn; undoFn = null; moveMsg = ""; if (f) await f(); if (undoId) remember(undoId); refresh(); return; }
  if (!m) return;
  const { a } = m, before = strip(a);
  moveMsg = ""; undoFn = null; undoId = a.id;
  if (act === "done") {
    if (a.type === "habit") { await markHabit(a.id, "done"); undoFn = () => markHabit(a.id, null); }
    else {
      const patch = a.type === "skill" ? { lastDone: today() } : { status: "done", doneOn: today() };
      const step = a.type === "skill" && firstOpenStep(a);
      if (step) patch.steps = a.steps.map((s) => s === step ? { ...s, done: true } : s);
      if (a.type !== "skill") patch.lastDone = today();
      await update(a.id, patch);
      undoFn = () => replace(a.id, before);
    }
    const unlog = logMove(a, "done"), undoDone = undoFn;
    undoFn = async () => { await unlog(); await undoDone(); };
    moveMsg = a.type === "skill" ? `Good work on "${a.title}".` : `"${a.title}" is done.`;
    clearCurrent();
  }
  if (act === "later") {
    // Hidden today and the next two days. Habits just step aside for today.
    if (a.type === "habit") setSkip([...skipList(), a.id]);
    else await update(a.id, { snoozed: addDays(today(), 2) });
    const unlog = logMove(a, "later");
    undoFn = a.type === "habit" ? () => { setSkip(skipList().filter((x) => x !== a.id)); return unlog(); } : async () => { await unlog(); await replace(a.id, before); };
    moveMsg = "Okay, not now.";
    clearCurrent();
  }
  if (act === "another") {
    logMove(a, "another");
    const skip = [...skipList(), a.id];
    clearCurrent();
    if (pickNext(mine(), { ...ctxNow(), skip: new Set(skip) })) setSkip(skip);
    else {
      // Went through everything: start a fresh round, just not with the one on screen.
      setSkip([]);
      const again = pickNext(mine(), { ...ctxNow(), skip: new Set([a.id]) });
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
      return `<li${s === "skipped" ? ' class="skipped"' : ""}><label><input type="checkbox" data-habit="${esc(h.id)}"${s === "done" ? " checked" : ""}${s === "skipped" ? " disabled" : ""}><span>${esc(h.title)}${s === "skipped" ? " <small>skipped today</small>" : ""}</span></label></li>`;
    }).join("")}</ul>`
    : `<p class="note">No habits yet. <a href="#activities" data-mv="habits">Add one</a>, like "Drink 2.5L water".</p>`}`;
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
  $("list").innerHTML = rows.length ? rows.map((a) => a.id === editing ? editorHtml() : rowHtml(a)).join("") : `<p class="note">${typeFilter ? "Nothing of this type here." : empty}</p>`;
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
  let btns;
  if (confirmDel === a.id) btns = b("del-yes", "Delete", "danger") + b("del-no", "Keep");
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
      ${confirmDel === a.id ? `<button type="button" class="danger" data-act="del-yes" data-id="${esc(a.id)}">Delete for good</button><button type="button" data-act="del-no">Keep</button>` : `<button type="button" class="push" data-act="del" data-id="${esc(a.id)}">Delete</button>`}
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
  editing = draft = null; confirmDel = null;
  await replace(id, body);
  renderList();
}

async function addActivity(ev) {
  ev.preventDefault();
  const title = $("addTitle").value.trim(), type = $("addType").value;
  if (!title) { $("addMsg").textContent = "Type what you'd like to add first."; return; }
  const ref = doc(actsCol);
  $("addTitle").value = ""; addTypeTouched = false; $("addType").value = "task";
  $("addMsg").textContent = `Saved "${title}" to Ideas. Start it when you're ready.`;
  tab = "inbox"; typeFilter = "";
  await commit(() => setDoc(ref, { owner: me, title, type, status: "inbox", created: today(), updated: Date.now() }));
}

async function listAction(act, id) {
  const a = acts.find((x) => x.id === id);
  if (act === "edit") { editing = id; draft = structuredClone(a); draft.steps ||= []; confirmDel = null; renderList(); $("ed-title")?.focus(); return; }
  if (act === "ed-cancel") { editing = draft = null; confirmDel = null; renderList(); return; }
  if (act === "step-add") { readEditor(); const t = $("ed-step").value.trim(); if (t) draft.steps.push({ text: t, done: false }); renderList(); $("ed-step")?.focus(); return; }
  if (act === "del") { if (editing) readEditor(); confirmDel = id; renderList(); return; }
  if (act === "del-no") { if (editing) readEditor(); confirmDel = null; renderList(); return; }
  if (act === "del-yes") { confirmDel = null; if (editing === id) editing = draft = null; await commit(() => deleteDoc(doc(actsCol, id))); return; }
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
  $("addTitle").addEventListener("input", () => { if (!addTypeTouched) $("addType").value = guessType($("addTitle").value); });
  $("addType").addEventListener("change", () => { addTypeTouched = true; });
  $("addForm").addEventListener("submit", addActivity);
  $("tabs").addEventListener("click", (ev) => { const b = ev.target.closest("[data-tab]"); if (!b) return; tab = b.dataset.tab; editing = draft = null; confirmDel = null; renderList(); });
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
