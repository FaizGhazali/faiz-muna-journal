// Dearly, the diary journal (#diary view). Pages by hash:
//   #diary              dashboard: welcome, write button, stats, On this day, memories (search, filter, sort, show more)
//   #diary/write        new entry   #diary/edit/<id>  edit   (drafts autosave on this device)
//   #diary/read/<id>    reading view with older / newer
//   #diary/ai           the on-device writer, writing style, privacy, Recently deleted
// Pure logic: diary.js (entries) and writestyle.js (style profile, prompt). The model: localai.js (WebLLM, in the browser).
// Data: diary/{id} (see diary.js), diaryPhotos/{id} -> { entry, person, data, w, h }, diaryStyle/{person} -> { on, since? }.
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, getDocs, query, where, writeBatch } from "./fs.js";
import { PAGE, OPENING, words, bodyText, titleOf, preview, parseTags, live, diaryStats, onThisDay, tagsOf, filterEntries, neighbours, expired,
  prettyDate, ago, lineFor, greeting, iso } from "./diary.js";
import { MIN_STYLE, ABOUT_MAX, aboutSuggestions, addToAbout, styleSource, styleProfile, describeStyle, samplesFor, buildMessages, cleanOutput, unsupported, dropped, looksGarbled } from "./writestyle.js";
import * as ai from "./localai.js";
import * as cloud from "./cloudai.js";
import { MOODS, isMood } from "./mood.js";
import { face } from "./moodui.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => iso(new Date());
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};
const MAX_PHOTOS = 4;
const PAPERS = { cream: "Cream", rose: "Rose", sage: "Sage" };

let db, commit, people, me, getToken, demo, diaryCol, photosCol, styleCol, unsubs = [];
let list = [], styles = {}, ready = false, onChange = () => {};
// Everyone's diary entries (deleted ones included, marked). The Mood page and reflections read moods from these.
export const diaryList = () => list;
// Dashboard filters (kept while the app is open) and how many memories are showing.
const filt = { q: "", month: "", tag: "", fav: false, sort: "new" };
let shown = PAGE, route = "", painted = "", confirm = null, flash = null; // flash: { id, text } shown on that entry until you leave it
let ed = null, saveTimer = 0, abort = null, photoCache = new Map();
let modelUi = ""; // editor writer line: "" | "sizes" (picking a size) | "remove" (confirming removal)
let aboutMsg = ""; // "Saved" under About you, kept through the redraw that saving causes
let device = null, aiState = { busy: false, progress: 0, mb: 0, phase: "", msg: "", note: "", flags: [], lost: [] }; // msg = problem (red), note = calm news

export function initDiary(opts) {
  ({ db, commit, people, me } = opts);
  getToken = opts.token || (async () => null); demo = !!opts.demo; onChange = opts.onChange || onChange;
  diaryCol = collection(opts.db, "diary");
  photosCol = collection(opts.db, "diaryPhotos");
  styleCol = collection(opts.db, "diaryStyle");
  addEventListener("hashchange", () => render());
  $("me").addEventListener("change", () => { painted = ""; ed = null; render(); });
  wire();
  paper();
}
export function startDiary() {
  unsubs.push(onSnapshot(diaryCol, (s) => {
    list = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date || ""));
    ready = true;
    purge();
    render(true);
    onChange();
  }));
  unsubs.push(onSnapshot(styleCol, (s) => { styles = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); if (route === "ai") render(true); }));
}
export function stopDiary() { unsubs.forEach((u) => u()); unsubs = []; ready = false; }
export const refreshDiary = () => render(true);

const pid = () => me();
const person = () => people().find((p) => p.id === pid());
const mine = () => list.filter((e) => e.person === pid());
const find = (id) => list.find((e) => e.id === id);
const styleOf = (p = pid()) => styles[p] || { on: false };

// Entries kept in Recently deleted for longer than the keep period go for good, photos too.
let purging = false;
async function purge() {
  if (purging) return;
  const old = list.filter((e) => expired(e, Date.now()));
  if (!old.length) return;
  purging = true;
  try { for (const e of old) await removeForever(e); } finally { purging = false; }
}

// ---------- routing ----------
function parseRoute() {
  const h = location.hash;
  const m = h.match(/^#diary\/(write|edit|read|ai)(?:\/([\w-]+))?$/);
  if (!m) return { page: "dash" };
  return { page: m[1], id: m[2] || null };
}
function render(data = false) {
  const view = $("diary");
  if (!view || view.hidden || !people().length) return;
  const r = parseRoute(), key = `${r.page}/${r.id || ""}/${pid()}`;
  // The editor is drawn once per opening, so new data never wipes what is being typed.
  if (data && (r.page === "write" || r.page === "edit") && painted === key && ed) return;
  if (painted !== key) { confirm = null; aboutMsg = ""; modelUi = ""; if (flash && flash.id !== r.id) flash = null; if (r.page !== "dash") scrollTo({ top: 0 }); }
  route = r.page;
  if (r.page === "dash") renderDash(painted !== key);
  else if (r.page === "read") renderRead(r.id);
  else if (r.page === "write" || r.page === "edit") renderEditor(r.page === "edit" ? r.id : null);
  else if (r.page === "ai") renderAi();
  painted = key;
}

// ---------- dashboard ----------
function renderDash(fresh) {
  const host = $("diary");
  if (fresh || !$("dyList")) {
    host.innerHTML = `<section class="panel paper dy-hero" id="dyHero" aria-label="Today" data-title="Dearly"></section>
      <section class="panel paper dy-otd" id="dyOtd" aria-labelledby="dyOtdTitle" hidden></section>
      <section class="panel dy-mem" aria-labelledby="dyMemTitle" data-title="Your memories">
        <div class="dy-memhead"><h2 id="dyMemTitle">Your memories</h2><a class="btn mini" href="#diary/ai">✨ AI &amp; privacy<span class="dy-badge" id="dyBadge" hidden></span></a></div>
        <div class="dy-tools" id="dyTools">
          <input type="search" id="dyQ" class="gsearch" placeholder="Search your diary" aria-label="Search your diary" autocomplete="off" enterkeyhint="search" value="${esc(filt.q)}">
          <div class="dy-filters">
            <label class="inline">Month <input type="month" id="dyMonth" value="${esc(filt.month)}" max="${today().slice(0, 7)}"></label>
            <select id="dyTag" aria-label="Tag"></select>
            <button type="button" class="chip" id="dyFav" aria-pressed="${filt.fav}">★ Favourites</button>
            <select id="dySort" aria-label="Order"><option value="new"${filt.sort === "new" ? " selected" : ""}>Newest first</option><option value="old"${filt.sort === "old" ? " selected" : ""}>Oldest first</option></select>
          </div>
        </div>
        <div id="dyList" class="dy-list" aria-live="polite"></div>
      </section>`;
  }
  paintHero(); paintOtd(); paintList();
}
function paintHero() {
  const p = person(), t = today(), st = diaryStats(mine(), t), pd = prettyDate(t), draft = store.get(draftKey(null), null);
  const has = draft && words(bodyText(draft.body)) + words(draft.notes) > 0;
  $("dyHero").innerHTML = `<p class="dy-day">${esc(pd.day)}</p>
    <h2 class="dy-greet">${esc(greeting(new Date().getHours()))}, ${esc(p.name)}</h2>
    <p class="dy-date">${esc(pd.date)}</p>
    <p class="dy-line">${esc(lineFor(t))}</p>
    <div class="actions"><a class="btn primary dy-go" href="#diary/write">${has ? "✍️ Continue your draft" : "✍️ Write today's diary"}</a></div>
    ${st.total ? `<dl class="dy-stats">
      <div><dt>Entries</dt><dd>${st.total}</dd></div>
      <div><dt>Day streak</dt><dd>${st.streak}</dd></div>
      <div><dt>This month</dt><dd>${st.month}</dd></div>
      <div><dt>Last written</dt><dd>${st.last ? esc(ago(st.last, t)) : "–"}</dd></div>
    </dl>` : ""}`;
  const badge = $("dyBadge"), n = suggestions().length;
  if (badge) { badge.hidden = !n; badge.textContent = n; badge.setAttribute("aria-label", `${n} ${n === 1 ? "suggestion" : "suggestions"} for About you`); }
}
// Suggested lines for About you, from this person's own entries (not ones left out of style learning).
const suggestions = () => aboutSuggestions(live(mine()).filter((e) => !e.noStyle).map((e) => e.body), styleOf().about || "", styleOf().dismissed || []);
function suggHtml() {
  const sg = suggestions();
  if (!sg.length) return "";
  return `<div class="dy-sugg"><h3>Suggestions from your entries</h3>
    <p class="note">Spotted on this device by counting what you write, not guessed. Nothing is added unless you tap Add.</p>
    <ul>${sg.map((x) => `<li data-key="${esc(x.key)}"><p>${esc(x.text)}</p>
      ${x.kind === "ask" ? `<input type="text" class="dy-sugin" maxlength="80" placeholder="${esc(x.hint)}" aria-label="${esc(x.text)}" autocomplete="off">` : `<p class="note">Adds: "${esc(x.line)}"</p>`}
      <div class="actions"><button type="button" class="mini go" data-dy="sugg-add">Add</button><button type="button" class="mini" data-dy="sugg-no">Not now</button></div></li>`).join("")}</ul></div>`;
}
function paintOtd() {
  const host = $("dyOtd"), items = onThisDay(mine(), today());
  host.hidden = !items.length;
  if (!items.length) { host.innerHTML = ""; return; }
  const yr = +today().slice(0, 4);
  host.innerHTML = `<h2 id="dyOtdTitle">On this day</h2>
    <div class="dy-otdlist">${items.slice(0, 3).map((e) => `<a class="dy-otditem" href="#diary/read/${esc(e.id)}">
      <small>${yr - +e.date.slice(0, 4) === 1 ? "A year ago" : `${yr - +e.date.slice(0, 4)} years ago`}</small>
      <b>${esc(titleOf(e))}</b><span>${esc(preview(e, 110))}</span></a>`).join("")}</div>`;
}
function paintList() {
  const host = $("dyList"); if (!host) return;
  const tags = tagsOf(mine());
  $("dyTag").innerHTML = `<option value="">All tags</option>${tags.map((t) => `<option value="${esc(t)}"${t === filt.tag ? " selected" : ""}>#${esc(t)}</option>`).join("")}`;
  $("dyTag").hidden = !tags.length;
  if (!ready) { host.innerHTML = `<p class="note">Opening your diary…</p>`; return; }
  if (!live(mine()).length) {
    $("dyTools").hidden = true;
    host.innerHTML = `<div class="dy-empty"><p class="dy-emptyicon" aria-hidden="true">📔</p>
      <h3>Your diary is waiting</h3>
      <p class="note">No need for full sentences. Jot a few words about your day, in English, Malay or both, and Dearly can turn them into an entry that sounds like you. Or write it all yourself.</p>
      <a class="btn primary" href="#diary/write">Write your first entry</a></div>`;
    return;
  }
  $("dyTools").hidden = false;
  const found = filterEntries(mine(), filt), some = found.slice(0, shown), left = found.length - some.length;
  const filtered = filt.q || filt.month || filt.tag || filt.fav;
  host.innerHTML = found.length ? `${filtered ? `<p class="note">${found.length} ${found.length === 1 ? "entry" : "entries"} found. <button type="button" class="linkbtn" data-dy="clear">Clear</button></p>` : ""}
    ${some.map(cardHtml).join("")}
    ${left > 0 ? `<button type="button" class="dy-more" data-dy="more">Show more (${left} left)</button>` : ""}`
    : `<div class="dy-empty"><p>Nothing matches.</p><button type="button" data-dy="clear">Clear search and filters</button></div>`;
}
function cardHtml(e) {
  const pd = prettyDate(e.date);
  return `<a class="dy-card" href="#diary/read/${esc(e.id)}">
    <div class="dy-cdate"><b>${+e.date.slice(8)}</b><small>${esc(new Date(e.date + "T12:00").toLocaleDateString(undefined, { month: "short" }))}</small><small>${e.date.slice(0, 4)}</small></div>
    <div class="dy-cbody"><h3>${e.fav ? '<span class="dy-star" aria-label="Favourite">★</span> ' : ""}${esc(titleOf(e))}</h3>
      <p>${esc(preview(e))}</p>
      ${(e.tags || []).length ? `<p class="dy-tags">${e.tags.map((t) => `<span>#${esc(t)}</span>`).join("")}</p>` : ""}
      <span class="sr">${esc(pd.day)}, ${esc(pd.date)}</span></div>
    ${e.cover ? `<img class="dy-cover" src="${esc(e.cover)}" alt="" loading="lazy">` : isMood(e.mood) ? `<span class="dy-cmood" title="${MOODS[e.mood].label}">${face(e.mood, 30)}</span>` : ""}
  </a>`;
}

// ---------- reading view ----------
function paras(body) {
  return bodyText(body).split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}
function renderRead(id) {
  const e = find(id), host = $("diary");
  if (!e || e.deleted) {
    host.innerHTML = `<div class="fdtop"><a class="btn" href="#diary">← All memories</a></div>
      <section class="panel"><p>${ready ? "This entry isn't here any more. It may have been deleted." : "Opening…"}</p></section>`;
    return;
  }
  const pd = prettyDate(e.date), { older, newer } = neighbours(mine(), id);
  host.innerHTML = `<div class="fdtop dy-readtop"><a class="btn" href="#diary">← All memories</a>
      <span class="dy-pager">${newer ? `<a class="btn mini" href="#diary/read/${esc(newer.id)}" aria-label="Newer entry">← Newer</a>` : ""}${older ? `<a class="btn mini" href="#diary/read/${esc(older.id)}" aria-label="Older entry">Older →</a>` : ""}</span></div>
    <article class="panel paper dy-read" aria-labelledby="dyReadDate" data-title="Diary entry">
      <header class="dy-rhead">
        <div><p class="dy-day">${esc(pd.day)}</p><h2 class="dy-date" id="dyReadDate">${esc(pd.date)}</h2></div>
        <div class="dy-rside">${isMood(e.mood) ? `<span class="dy-rmood">${face(e.mood, 30)}<small>${MOODS[e.mood].word}</small></span>` : ""}
          <button type="button" class="dy-favbtn" data-dy="fav" aria-pressed="${!!e.fav}" aria-label="${e.fav ? "Remove from favourites" : "Add to favourites"}">${e.fav ? "★" : "☆"}</button></div>
      </header>
      ${e.title ? `<h3 class="dy-title">${esc(e.title)}</h3>` : ""}
      <p class="dy-dear">${esc(OPENING)}</p>
      <div class="dy-text">${paras(e.body)}</div>
      <div class="dy-photos" id="dyPhotos"></div>
      ${(e.tags || []).length ? `<p class="dy-tags">${e.tags.map((t) => `<button type="button" class="linkbtn" data-dy="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</p>` : ""}
      <p class="dy-meta">${[e.ai ? "Written with Dearly's helper, from your notes" : "", e.noStyle ? "Not used to learn your style" : "", `${words(bodyText(e.body))} words`].filter(Boolean).map(esc).join(" · ")}</p>
      <div class="actions" id="dyReadActs">${confirm === "del" + id
        ? `<p class="note">Move this entry to Recently deleted? You can bring it back for 30 days.</p><button type="button" class="danger" data-dy="del-yes">Delete</button><button type="button" data-dy="del-no">Keep</button>`
        : `<a class="btn" href="#diary/edit/${esc(e.id)}">Edit</a><button type="button" data-dy="del">Delete</button>`}</div>
      ${flash?.id === id ? `<p class="note dy-flash" role="status">${esc(flash.text)}</p>` : ""}
    </article>
    <nav class="dy-nav" aria-label="More entries">
      ${older ? `<a href="#diary/read/${esc(older.id)}"><small>Older</small>${esc(titleOf(older))}</a>` : "<span></span>"}
      ${newer ? `<a href="#diary/read/${esc(newer.id)}" class="r"><small>Newer</small>${esc(titleOf(newer))}</a>` : "<span></span>"}
    </nav>`;
  if ((e.photos || []).length) loadPhotos(e).then((ph) => {
    const box = $("dyPhotos"); if (!box || parseRoute().id !== id) return;
    box.innerHTML = ph.map((p) => `<button type="button" class="dy-photo" data-dy="zoom" aria-label="Show photo bigger"><img src="${esc(p.data)}" alt="Photo from this day" loading="lazy"></button>`).join("");
  });
}
async function loadPhotos(e) {
  if (photoCache.has(e.id)) return photoCache.get(e.id);
  try {
    const snap = await getDocs(query(photosCol, where("entry", "==", e.id)));
    const order = e.photos || [];
    const out = snap.docs.map((d) => ({ id: d.id, ...d.data() })).filter((p) => /^data:image\//.test(p.data || "")).sort((a, b) => order.indexOf(a.id) - order.indexOf(b.id));
    photoCache.set(e.id, out);
    return out;
  } catch (_) { return []; }
}

// ---------- editor ----------
const draftKey = (id) => (id ? `journal-diary-edit-${id}` : `journal-diary-draft-${pid()}`);
function blank() { return { id: null, date: today(), title: "", notes: "", body: `${OPENING}\n\n`, mood: null, tags: "", noStyle: false, ai: false, mode: "ai", photos: [], removed: [] }; }
function fromEntry(e) {
  return { id: e.id, date: e.date, title: e.title || "", notes: e.notes || "", body: e.body || "", mood: isMood(e.mood) ? e.mood : null, tags: (e.tags || []).join(", "),
    noStyle: !!e.noStyle, ai: !!e.ai, mode: "self", photos: [], removed: [] };
}
function renderEditor(id) {
  const host = $("diary"), e = id ? find(id) : null;
  if (id && !e) { host.innerHTML = `<section class="panel"><p>${ready ? "This entry isn't here any more." : "Opening…"}</p><a class="btn" href="#diary">← All memories</a></section>`; return; }
  const saved = store.get(draftKey(id), null);
  let restored = false;
  if (!ed || ed.id !== (id || null) || ed.person !== pid()) {
    ed = { ...(e ? fromEntry(e) : blank()), person: pid() };
    if (saved && (saved.body !== ed.body || saved.notes !== ed.notes || saved.title !== ed.title)) { Object.assign(ed, saved, { photos: [], removed: [] }); restored = true; }
    if (e && (e.photos || []).length) loadPhotos(e).then((ph) => { if (ed && ed.id === e.id && !ed.photos.length) { ed.photos = ph.map((p) => ({ ...p, old: true })); paintPhotos(); } });
  }
  const pd = prettyDate(ed.date), p = person();
  host.innerHTML = `<div class="fdtop"><a class="btn" href="${id ? `#diary/read/${esc(id)}` : "#diary"}">← ${id ? "Back to the entry" : "Back"}</a><span class="note dy-saved" id="dySaved" role="status">${restored ? "Your unsaved draft is back." : ""}</span></div>
    <section class="panel paper dy-editor" aria-labelledby="dyEdDate" data-title="Write">
      <header class="dy-edhead">
        <div><p class="dy-day" id="dyEdDay">${esc(pd.day)}</p><h2 class="dy-date" id="dyEdDate">${esc(pd.date)}</h2></div>
        <label class="dy-datepick">Change day<input type="date" id="dyDate" value="${esc(ed.date)}" max="${today()}"></label>
      </header>
      <p class="note">${id ? "Editing" : "Writing as"} <b>${esc(p.name)}</b>${restored ? ` · <button type="button" class="linkbtn" data-dy="fresh">Start fresh instead</button>` : ""}</p>
      <div class="chips dy-modes" role="tablist" aria-label="How to write">
        <button type="button" class="chip" role="tab" data-mode="ai" aria-selected="${ed.mode === "ai"}" aria-pressed="${ed.mode === "ai"}">✨ Help me write</button>
        <button type="button" class="chip" role="tab" data-mode="self" aria-selected="${ed.mode === "self"}" aria-pressed="${ed.mode === "self"}">✍️ Write it myself</button>
      </div>
      <div class="dy-notes" id="dyNotesBox"${ed.mode === "ai" ? "" : " hidden"}>
        <label for="dyNotes">Jot down your day <small>Keywords, half sentences, slang, any language. One thing per line.</small></label>
        <textarea id="dyNotes" rows="5" maxlength="2000" placeholder="went mamak with friends&#10;discussed career&#10;risau pasal duit&#10;laughed until 2AM">${esc(ed.notes)}</textarea>
        <div class="actions"><button type="button" class="primary" id="dyWrite" data-dy="write">✨ Write it for me</button><button type="button" id="dyStop" data-dy="stop" hidden>Stop</button></div>
        <div id="dyAi" class="dy-ai" aria-live="polite"></div>
      </div>
      <label for="dyBody" class="sr">Your diary entry</label>
      <textarea id="dyBody" class="dy-page" rows="12" maxlength="20000">${esc(ed.body)}</textarea>
      <div class="dy-under"><span class="note" id="dyCount"></span><span id="dyUndo"></span></div>
      <label for="dyTitle">Title <small>Optional. Otherwise the first sentence is used.</small><input type="text" id="dyTitle" maxlength="80" value="${esc(ed.title)}" autocomplete="off"></label>
      <div class="lbl"><span>How was the day? <small>Optional. Sets your mood for the day; several entries are averaged.</small></span><div class="mfaces" role="group" aria-label="Mood">${[1, 2, 3, 4, 5].map((v) =>
        `<button type="button" class="mface" data-mood="${v}" aria-pressed="${ed.mood === v}" aria-label="${MOODS[v].label}">${face(v, 32)}</button>`).join("")}</div></div>
      <label for="dyTags">Tags <small>Optional, with commas: friends, work</small><input type="text" id="dyTags" maxlength="200" value="${esc(ed.tags)}" autocomplete="off"></label>
      <div class="lbl"><span>Photos <small>Optional, up to ${MAX_PHOTOS}. Made smaller before saving.</small></span>
        <div class="dy-edphotos" id="dyEdPhotos"></div>
        <input type="file" id="dyPhotoIn" accept="image/*" multiple hidden></div>
      <label class="inline dy-nostyle"><input type="checkbox" id="dyNoStyle"${ed.noStyle ? " checked" : ""}> Don't use this entry to learn my writing style</label>
      <div class="actions"><button type="button" class="primary" data-dy="save" id="dySave">${id ? "Save changes" : "Save entry"}</button>
        ${!id ? `<button type="button" data-dy="discard">Discard draft</button>` : ""}</div>
      <p class="note" id="dyEdMsg" role="status"></p>
    </section>`;
  count(); paintPhotos(); paintAi();
  if (ed.mode === "ai") { if (useCloud()) wakeCloud(); else if (!device) probe(); }
}
function count() {
  const n = words(bodyText(ed.body)), el = $("dyCount");
  if (el) el.textContent = `${n} ${n === 1 ? "word" : "words"}`;
}
function paintPhotos() {
  const host = $("dyEdPhotos"); if (!host || !ed) return;
  host.innerHTML = ed.photos.map((p, i) => `<span class="dy-thumb"><img src="${esc(p.thumb || p.data)}" alt="Photo ${i + 1}"><button type="button" class="mini" data-dy="unphoto" data-i="${i}" aria-label="Remove photo ${i + 1}">✕</button></span>`).join("")
    + (ed.photos.length < MAX_PHOTOS ? `<button type="button" class="dy-addphoto" data-dy="photo">📷 Add photo</button>` : "");
}
function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!ed) return;
    const { photos, removed, ...rest } = ed;
    store.set(draftKey(ed.id), rest);
    const el = $("dySaved"); if (el) el.textContent = `Draft saved on this device${photos.some((p) => !p.old) ? " (photos are kept only until you leave)" : ""}.`;
  }, 600);
}
function edMsg(t) { const el = $("dyEdMsg"); if (el) el.textContent = t; }

async function saveEntry() {
  const body = ed.body.trim();
  if (words(bodyText(body)) < 1) { edMsg("Write a little first, even one line."); return; }
  if (!ed.date || ed.date > today()) { edMsg("Pick a day that isn't in the future."); return; }
  const old = ed.id ? find(ed.id) : null, ref = ed.id ? doc(diaryCol, ed.id) : doc(diaryCol), now = Date.now();
  const batch = writeBatch(db);
  const kept = [];
  for (const p of ed.photos) {
    if (p.old) { kept.push(p.id); continue; }
    const pref = doc(photosCol);
    batch.set(pref, { entry: ref.id, person: pid(), data: p.data, w: p.w, h: p.h });
    kept.push(pref.id);
  }
  const cover = ed.photos[0]?.thumb || (ed.photos[0]?.old ? old?.cover : null);
  const entry = {
    person: pid(), date: ed.date, body, tags: parseTags(ed.tags), fav: !!old?.fav,
    created: old?.created || now, updated: now,
  };
  if (ed.title.trim()) entry.title = ed.title.trim();
  if (isMood(ed.mood)) entry.mood = ed.mood;
  if (ed.ai) { entry.ai = true; if (ed.notes.trim()) entry.notes = ed.notes.trim(); }
  if (ed.noStyle) entry.noStyle = true;
  if (kept.length) { entry.photos = kept; if (cover) entry.cover = cover; }
  batch.set(ref, entry);
  $("dySave").disabled = true;
  edMsg("Saving…");
  const gone = [...ed.removed];
  try {
    await commit(() => batch.commit());
    if (gone.length) await commit(() => Promise.all(gone.map((id) => deleteDoc(doc(photosCol, id)))));
  } finally { const b = $("dySave"); if (b) b.disabled = false; }
  photoCache.delete(ref.id);
  store.del(draftKey(ed.id));
  ed = null;
  flash = { id: ref.id, text: old ? "Changes saved." : "Saved to your diary." };
  location.hash = `#diary/read/${ref.id}`;
}

// Photos are shrunk on the phone (longest side 1280 px, JPEG) so each fits in one database document.
async function readPhoto(file) {
  const bmp = await createImageBitmap(file);
  const draw = (max, q) => {
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height)), c = document.createElement("canvas");
    c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
    c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height);
    return { data: c.toDataURL("image/jpeg", q), w: c.width, h: c.height };
  };
  let big = draw(1280, 0.72);
  if (big.data.length > 700000) big = draw(1000, 0.6);
  if (big.data.length > 900000) throw new Error("big");
  return { ...big, thumb: draw(200, 0.6).data };
}

// ---------- the writer ----------
async function probe() {
  device = { checking: true };
  paintAi();
  device = await ai.checkSupport();
  if (device.why === "mobile" && await ai.clearAll()) aiState.note = "The on-phone writer is now off on phones, so its download was removed to free space. Use the cloud writer or write it yourself.";
  // The faster 16-bit build scrambles words on some phone graphics chips even when they claim support, so phones
  // (and any device where scrambling was seen, journal-ai-f32) use the 32-bit build. A bit bigger, always correct.
  if (device.ok) {
    const had16 = device.f16;
    // "journal-ai-build": "f16" when the person chose the faster build on a phone (with the scramble guard watching).
    device.f16raw = had16;
    device.f16 = device.f16 && (!device.mobile || store.get("journal-ai-build", "") === "f16") && !store.get("journal-ai-f32", false);
    // A phone that downloaded the 16-bit build before this change: remove it and say why, once.
    if (had16 && !device.f16) {
      let removed = false;
      for (const x of ai.MODELS) if (await ai.isDownloaded(x.key, true)) { try { await ai.remove(x.key, true); removed = true; } catch (_) {} }
      if (removed) aiState.note = "Dearly now uses a safer version of the writer on this phone (the old one could scramble words). Please download it once more.";
    }
  }
  const key = aiKey();
  device.downloaded = device.ok ? await ai.isDownloaded(key, device.f16) : false;
  paintAi();
  if (route === "ai") renderAi();
}
const aiKey = () => store.get("journal-ai-model", null) || ai.suggestKey(device);
function paintAi() {
  const host = $("dyAi"); if (!host) return;
  const btn = $("dyWrite"), stop = $("dyStop");
  const m = ai.modelOf(aiKey());
  let html = "";
  if (modelUi === "cloud-ask") html = cloudAskHtml();
  else if (useCloud()) html = cloudLineHtml();
  else if (!device || device.checking) html = `<p class="note">Checking whether this device can run the writer…</p>`;
  else if (!device.ok) html = `<div class="dy-box"><p><b>The writer can't run on this device.</b> ${esc(ai.whyText(device.why))}</p><p class="note">Everything else works. Tap "Write it myself" and your notes stay in the box above to help you.</p>${cloudOffer()}</div>`;
  else if (aiState.phase === "download" || aiState.phase === "open") {
    html = `<div class="dy-box">${barHtml()}
      <p class="note">${aiState.phase === "download" ? "One time only. Stay on this page and keep writing if you like. If it stops, tap Download again: finished parts are kept." : "This takes a few seconds each time the app opens."}</p></div>`;
  } else if (!device.downloaded && !ai.isLoaded(aiKey(), device.f16)) {
    html = `<div class="dy-box"><p><b>Turn on Dearly's writer.</b> It runs entirely on this ${device.mobile ? "phone" : "device"}: your notes never leave it, and it's free.</p>
      <p class="note">Pick a size. It downloads once${device.mobile ? ", best on Wi-Fi" : ""}.</p>
      ${sizesHtml()}
      <p class="note">${esc(m.note)}</p>
      <div class="actions"><button type="button" class="primary" data-dy="download">Download ${esc(sizeOf(m))}</button></div>${cloudOffer("No download? ")}</div>`;
  } else if (modelUi === "sizes") {
    // Changing size while one is already downloaded: same buttons, right here.
    html = `<div class="dy-box"><p><b>Pick a writer size</b></p>${sizesHtml()}<p class="note">${esc(m.note)}</p>
      <div class="actions"><button type="button" class="primary" data-dy="sizes-done">Done</button></div></div>`;
  } else if (modelUi === "remove") {
    html = `<div class="dy-box"><p><b>Remove the ${esc(m.name)} writer from this ${device.mobile ? "phone" : "device"}?</b></p>
      <p class="note">Frees about ${esc(sizeOf(m))}. Your diary isn't touched, and you can download it again any time.</p>
      <div class="actions"><button type="button" class="danger" data-dy="remove-here">Remove it</button><button type="button" data-dy="model-keep">Keep it</button></div></div>`;
  } else {
    if (device.soft) html = `<p class="note">This device has no graphics chip for AI, so writing will be slow.</p>`;
    // One quiet line so the writer can be changed or removed without leaving the page.
    if (!aiState.busy) html += `<div class="dy-modelline"><span>Writer: <b>${esc(m.name)}</b> · about ${esc(sizeOf(m))} on this ${device.mobile ? "phone" : "device"}</span>
      <span class="btns"><button type="button" class="mini" data-dy="sizes-open">Change size</button><button type="button" class="mini" data-dy="model-remove">Remove</button>${cloud.cloudReady() ? `<button type="button" class="mini" data-dy="cloud-use">Use cloud</button>` : ""}</span></div>`;
  }
  if (aiState.note) html = `<p class="note dy-note" role="status">✓ ${esc(aiState.note)}</p>` + html;
  if (aiState.msg) html += `<p class="note dy-err" role="alert">${esc(aiState.msg)}</p>`;
  if (aiState.detail && !aiState.busy) html += failHtml();
  if ((aiState.flags.length || aiState.lost?.length) && !aiState.busy) html += `<div class="dy-box dy-check">
    ${aiState.flags.length ? `<p><b>${aiState.story ? "Added by the writer.</b> Keep what's true, delete what didn't happen:" : "Check these.</b> They weren't in your notes:"} ${aiState.flags.map((f) => `<mark>${esc(f)}</mark>`).join(" ")}</p>` : ""}
    ${aiState.lost?.length ? `<p><b>Your own words that went missing:</b> ${aiState.lost.map((f) => `<mark>${esc(f)}</mark>`).join(" ")}</p>` : ""}
    <p class="note">The writer is small and makes slips. Change anything that didn't happen, isn't how you felt, or isn't how you'd say it.</p></div>`;
  host.innerHTML = html;
  if (btn) { btn.disabled = aiState.busy || (!useCloud() && device && !device.checking && !device.ok); btn.textContent = aiState.busy && aiState.phase === "write" ? "Writing…" : ed && ed.ai && bodyText(ed.body) ? "✨ Write it again" : "✨ Write it for me"; }
  if (stop) stop.hidden = !(aiState.busy && aiState.phase === "write");
}
// The model wrote scrambled text: this graphics chip mishandles the 16-bit build. Remember that on this device,
// throw away the broken download, and offer the safe 32-bit build. Returns the message to show.
async function switchToSafe() {
  const key = aiKey(), wasF16 = device.f16;
  store.set("journal-ai-f32", true); store.set("journal-ai-build", "");
  device.f16 = false;
  if (wasF16) { try { await ai.remove(key, true); } catch (_) {} }
  device.downloaded = await ai.isDownloaded(key, false);
  const m = ai.modelOf(key);
  return wasF16
    ? `This ${device.mobile ? "phone" : "device"}'s graphics chip scrambled the words. Nothing was saved. Dearly has switched to the safe version of the writer: download it once (about ${sizeOf(m)}) and try again.`
    : `The writer scrambled the words even with the safe build. Nothing was saved. Some phone graphics chips (Qualcomm Adreno included) don't run it reliably in the browser yet. You can write yourself here, or use the writer on a laptop. Copy the details below if you'd like it looked into.`;
}
// ---------- the cloud writer (cloudai.js): the family's own Modal server, for phones that can't run the writer ----------
// Chosen per device ("journal-ai-where"); the first time, it says what leaves the phone and asks ("journal-ai-cloud-ok").
const useCloud = () => cloud.cloudReady() && store.get("journal-ai-where", "device") === "cloud";
let demoLeftN = null;
async function wakeCloud() {
  if (demo) { demoLeftN = await cloud.demoLeft(); paintAi(); }
  else cloud.cloudWarm(await getToken().catch(() => null));
}
const cloudOffer = (lead = "") => cloud.cloudReady()
  ? `<div class="dy-cloudoffer"><span class="note">${esc(lead)}The cloud writer works on any phone, with nothing to download.</span><button type="button" data-dy="cloud-use">☁️ Use the cloud writer</button></div>` : "";
function cloudAskHtml() {
  return `<div class="dy-box"><p><b>Use the cloud writer?</b></p>
    <p class="note">${demo ? "In the demo, only your notes go to a shared server that writes the entry and keeps nothing. Everyone trying the demo shares a few writes a day."
      : "This entry's notes, plus About you and your style if they're on, go to your family's own server on Modal. It writes the entry and keeps nothing. Nothing to download, and it's free."}</p>
    <div class="actions"><button type="button" class="primary" data-dy="cloud-yes">Use the cloud writer</button><button type="button" data-dy="cloud-no">Not now</button></div></div>`;
}
function cloudLineHtml() {
  const where = (device?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent)) ? "phone" : "device";
  const left = demo && demoLeftN != null ? ` · ${demoLeftN} demo ${demoLeftN === 1 ? "write" : "writes"} left today` : "";
  const story = storyOn();
  return aiState.busy ? "" : `<div class="dy-modelline"><span>Writer: <b>☁️ Cloud</b>${esc(left)}</span>
    <span class="btns"><button type="button" class="mini" data-dy="device-use">Use this ${where} instead</button></span></div>
    <div class="dy-style" role="group" aria-label="Writing style"><span>Style</span>
      <button type="button" class="mini" data-dy="style-story" aria-pressed="${story}">📖 Story</button>
      <button type="button" class="mini" data-dy="style-close" aria-pressed="${!story}">📝 Close to my notes</button></div>
    <p class="note">${story ? "Tells your points as a story. It may add small details, so you'll see what it added to check." : "Tidies each point into a sentence, with nothing added."}</p>`;
}
// Story (default) or Close to my notes, per device. Story is cloud only: the on-phone models are too small to tell a
// story without making things up.
const storyOn = () => useCloud() && store.get("journal-ai-style", "story") === "story";
async function writeInCloud(notes) {
  const st = styleOf(), src = st.on ? styleSource(list, pid(), st.since || "") : [];
  const profile = st.on ? styleProfile(src.map((e) => e.body)) : null, about = st.about || "";
  const tok = demo ? null : await getToken().catch(() => null);
  if (!demo && !tok) { aiState.msg = "The cloud writer only works when you're signed in to the journal."; paintAi(); return; }
  // Family: the full prompt, built here. Demo: only the notes; the server builds a fixed prompt.
  const story = storyOn();
  const messages = tok ? buildMessages({ notes, profile, samples: profile ? samplesFor(src, 2) : [], name: person().name, about, story }) : null;
  const before = ed.body, page = $("dyBody");
  aiState = { busy: true, phase: "write", progress: 0, msg: "", note: "Waking the cloud writer… the first write after a quiet spell can take up to a minute.", detail: "", flags: [], lost: [], story };
  paintAi();
  abort = new AbortController();
  let first = true;
  try {
    const out = await cloud.cloudWrite({ token: tok, messages, notes, story, signal: abort.signal }, (t) => {
      if (first && t.trim()) { first = false; aiState.note = ""; paintAi(); }
      const c = cleanOutput(t, notes, false, story); if (c && page) page.value = c;
    });
    if (looksGarbled(out, notes)) throw new Error("jumbled");
    const clean = cleanOutput(out, notes, true, story);
    if (!clean || words(bodyText(clean)) < 3) throw new Error("empty");
    ed.body = clean; ed.ai = true;
    if (page) page.value = clean;
    aiState.flags = unsupported(notes, clean, about);
    aiState.lost = dropped(notes, clean);
    undo(before);
  } catch (e) {
    if (page) page.value = ed.body;
    const stopped = abort?.signal.aborted;
    aiState.msg = stopped ? "" : e.message === "empty" ? "The writer came back empty. Try again, or add a little more to your notes."
      : e.message === "jumbled" ? "The cloud writer's reply came out jumbled. Nothing was saved. Try again." : cloud.cloudErrorText(e, demo);
    // Daily limits and sign-in problems explain themselves; details only for real failures.
    if (!stopped && (!e.status || e.status >= 500) && !["empty", "jumbled"].includes(e.message)) aiState.detail = `Cloud writer: ${e.status ? `HTTP ${e.status} ${e.detail || ""}` : String(e.message || e)}\nBrowser: ${navigator.userAgent}`;
  } finally {
    aiState.busy = false; aiState.phase = ""; aiState.note = ""; abort = null;
    count(); saveDraft(); paintAi();
    if (demo) wakeCloud();
  }
}
// When the writer won't start: offer the phone's other build right here, and the real error to copy and send.
function failHtml() {
  const other = useCloud() ? "" : device?.f16 ? "safe" : device?.f16raw ? "fast" : ""; // builds are for the on-phone writer only
  return `<div class="dy-box dy-fail">
    ${other ? `<p class="note">${other === "fast" ? "This phone also has a faster build. It sometimes scrambles words on phones, but Dearly watches for that and stops it." : "Try the safe build instead. It's a little bigger but works on more graphics chips."}</p>
      <div class="actions"><button type="button" class="primary" data-dy="other-build">${other === "fast" ? "Try the faster build" : "Try the safe build"}</button></div>` : ""}
    <details><summary>Show technical details</summary><pre class="dy-detail">${esc(aiState.detail)}</pre>
      <div class="actions"><button type="button" class="mini" data-dy="copy-detail">Copy details</button><span class="note" id="dyCopied" role="status"></span></div></details>${useCloud() ? "" : cloudOffer()}</div>`;
}
// Download size for this device: the safe 32-bit build used on phones is about 15% bigger.
const sizeOf = (x) => `${(x.gb * (device?.f16 === false ? 1.15 : 1)).toFixed(1)} GB`;
// Size picker shown right in the editor, so choosing a size never leaves the page you're writing on.
function sizesHtml() {
  const key = aiKey(), fit = ai.suggestKey(device);
  return `<div class="dy-sizes" role="radiogroup" aria-label="Model size">${ai.MODELS.map((x) => `<button type="button" role="radio" class="dy-size" data-size="${x.key}" aria-checked="${x.key === key}">
    <b>${esc(x.name)}</b><small>${esc(sizeOf(x))}</small>${x.key === fit ? `<em>Suits this ${device?.mobile ? "phone" : "device"}</em>` : ""}</button>`).join("")}</div>`;
}
// The download / opening bar: a big percentage, a thick bar and how many MB so far. Updated in place while it runs.
const barTotal = () => Math.round(ai.modelOf(aiKey()).gb * 1000 * (device?.f16 === false ? 1.15 : 1));
function barText() {
  const dl = aiState.phase === "download", pct = Math.round(aiState.progress * 100);
  return { pct, title: dl ? "Downloading the writer" : "Getting the writer ready",
    detail: dl ? (aiState.mb ? `${Math.round(aiState.mb)} of about ${barTotal()} MB` : "Starting the download…") : "Opening it from this device…" };
}
function barHtml() {
  const t = barText();
  return `<div class="dy-prog" data-prog>
    <div class="dy-proghead"><b data-prog-title>${esc(t.title)}</b><span class="dy-pct" data-prog-pct>${t.pct}%</span></div>
    <div class="dy-bar${t.pct ? "" : " wait"}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.pct}" aria-label="${esc(t.title)}"><i style="width:${t.pct}%"></i></div>
    <p class="note" data-prog-detail>${esc(t.detail)}</p></div>`;
}
// Move the bars without redrawing the box, so it doesn't flicker on a phone.
function updateBars() {
  const bars = document.querySelectorAll("#diary [data-prog]");
  if (!bars.length) return false;
  const t = barText();
  bars.forEach((b) => {
    b.querySelector("[data-prog-title]").textContent = t.title;
    b.querySelector("[data-prog-pct]").textContent = `${t.pct}%`;
    b.querySelector("[data-prog-detail]").textContent = t.detail;
    const bar = b.querySelector(".dy-bar"); bar.classList.toggle("wait", !t.pct); bar.setAttribute("aria-valuenow", t.pct); bar.setAttribute("aria-label", t.title);
    bar.firstElementChild.style.width = `${t.pct}%`;
  });
  return true;
}
async function startModel() {
  const key = aiKey();
  aiState = { ...aiState, busy: true, phase: device.downloaded ? "open" : "download", progress: 0, mb: 0, msg: "", note: "", detail: "" };
  paintAi();
  ai.keepStorage();
  try {
    await ai.load(key, device.f16, (r) => {
      const was = aiState.phase, mb = /([\d.]+)\s*MB fetched/i.exec(r.text);
      aiState.phase = device.downloaded ? "open" : r.phase === "download" ? "download" : aiState.phase;
      aiState.progress = r.progress; if (mb) aiState.mb = +mb[1];
      if (aiState.phase !== was || !updateBars()) { paintAi(); paintAiPage(); }
    });
    device.downloaded = true;
    store.set("journal-ai-model", key);
    return true;
  } catch (e) {
    aiState.msg = ai.errorText(e);
    aiState.detail = `${String(e?.message || e || "unknown").slice(0, 500)}

Model: ${ai.idOf(key, device.f16)}
GPU: ${device.gpu || "?"}
Browser: ${navigator.userAgent}`;
    device.downloaded = await ai.isDownloaded(key, device.f16);
    return false;
  } finally { aiState.busy = false; aiState.phase = ""; paintAi(); paintAiPage(); }
}
async function writeForMe() {
  if (!ed || aiState.busy) return;
  const notes = ed.notes.trim();
  if (words(notes) < 2) { aiState.msg = "Jot down a few words about your day first."; paintAi(); $("dyNotes")?.focus(); return; }
  if (useCloud()) return writeInCloud(notes);
  if (!device || device.checking) await probe();
  if (!device.ok) return;
  if (!ai.isLoaded(aiKey(), device.f16) && !(await startModel())) return;
  // Style comes only from this person's own entries, and only when they turned it on.
  const st = styleOf(), src = st.on ? styleSource(list, pid(), st.since || "") : [];
  const profile = st.on ? styleProfile(src.map((e) => e.body)) : null;
  const about = st.about || ""; // "About you" is always used: the person wrote it for exactly this
  // Phones get shorter instructions: a long first step can trip the phone GPU's watchdog, which drops the job.
  const compact = !!device.mobile;
  const messages = buildMessages({ notes, profile, samples: profile && !compact ? samplesFor(src, 2) : [], name: person().name, about, compact });
  const before = ed.body;
  aiState = { busy: true, phase: "write", progress: 0, msg: "", flags: [], lost: [] };
  paintAi();
  const page = $("dyBody");
  let garbled = false, sample = "";
  // One go at writing. The scramble guard stops it the moment the text turns to junk.
  const run = async () => {
    abort = new AbortController();
    garbled = false;
    const out = await ai.write(messages, (t) => {
      if (garbled) return;
      if (looksGarbled(t, notes)) { garbled = true; sample = bodyText(t).slice(0, 120); abort.abort(); if (page) page.value = before; return; }
      const c = cleanOutput(t, notes, false); if (c && page) page.value = c;
    }, abort.signal);
    if (garbled || looksGarbled(out, notes)) { sample ||= bodyText(out).slice(0, 120); throw new Error("garbled"); }
    return out;
  };
  try {
    let out;
    try { out = await run(); }
    catch (e) {
      // The GPU dropped the job (not our guard, not the Stop button): start the writer fresh and try once more.
      if (garbled || e.message !== "gpu-lost") throw e;
      if (page) page.value = before;
      aiState.phase = ""; aiState.note = "The phone's graphics chip stopped the writer partway. Starting it fresh and trying once more…"; paintAi();
      if (!(await startModel())) throw e;
      aiState = { ...aiState, busy: true, phase: "write", note: "" }; paintAi();
      out = await run();
    }
    const clean = cleanOutput(out, notes);
    if (!clean || words(bodyText(clean)) < 3) throw new Error("empty");
    ed.body = clean; ed.ai = true;
    if (page) page.value = clean;
    aiState.flags = unsupported(notes, clean, about);
    aiState.lost = dropped(notes, clean);
    aiState.note = "";
    undo(before);
  } catch (e0) {
    // Our own guard stopping a scrambled run can surface as a GPU error; it's still "scrambled".
    const e = garbled ? new Error("garbled") : e0, stopped = abort?.signal.aborted && !garbled;
    if (page) page.value = ed.body;
    aiState.note = "";
    aiState.msg = e.message === "garbled" ? await switchToSafe()
      : e.message === "empty" ? "The writer came back empty. Try again, or add a little more to your notes." : stopped ? "" : ai.errorText(e0);
    if (e.message !== "empty" && !stopped)
      aiState.detail = `${e.message === "garbled" ? `Scrambled output, e.g.: ${sample}` : String(e0?.cause?.message || e0?.message || e0 || "unknown").slice(0, 500)}

Model: ${ai.idOf(aiKey(), device.f16)}
GPU: ${device.gpu || "?"}
Browser: ${navigator.userAgent}`;
  } finally {
    aiState.busy = false; aiState.phase = ""; abort = null;
    count(); saveDraft(); paintAi();
  }
}
function undo(before) {
  const el = $("dyUndo"); if (!el) return;
  el.innerHTML = before && words(bodyText(before)) ? `<button type="button" class="linkbtn" data-dy="undo">Undo, bring back what I had</button>` : "";
  el.dataset.before = before;
}

// ---------- AI, style and privacy page ----------
function renderAi() {
  const host = $("diary"), p = person(), st = styleOf(), m = ai.modelOf(aiKey());
  const src = styleSource(list, pid(), st.since || ""), profile = styleProfile(src.map((e) => e.body));
  const excluded = live(mine()).filter((e) => e.noStyle), deleted = mine().filter((e) => e.deleted).sort((a, b) => b.deleted - a.deleted);
  const paperNow = store.get("journal-paper", "cream");
  host.innerHTML = `<div class="fdtop"><a class="btn" href="#diary">← Back</a></div>
    <section class="panel" aria-labelledby="dyAiTitle" data-title="Dearly's writer">
      <p class="eyebrow">Dearly AI</p><h2 id="dyAiTitle">Your writing helper</h2>
      <p class="note">Turns a few words about your day into a diary entry that sounds like you. It runs on this device's graphics chip, inside the browser. Nothing you write is sent anywhere, there's no account or key, and it's free to use as much as you like.</p>
      <div id="dyAiPage"></div>
      <fieldset class="dy-models"><legend>Model size</legend>
        ${ai.MODELS.map((x) => `<label class="dy-model"><input type="radio" name="dyModel" value="${x.key}"${x.key === m.key ? " checked" : ""}>
          <span><b>${esc(x.name)}</b> · ${esc(x.size)} download · needs about ${x.mem} GB of graphics memory${device?.ok && x.key === ai.suggestKey(device) ? ' <span class="pill" style="--c:var(--good)">Suits this device</span>' : ""}<small>${esc(x.note)}</small></span></label>`).join("")}
      </fieldset>
      <div class="actions" id="dyAiActs"></div>
      <p class="note">The model is kept in this browser's storage. Clearing the site's data or browsing history, or the browser running short of space, removes it, and it downloads again next time. On iPhone, add the app to the home screen so Safari keeps it.</p>
    </section>
    <section class="panel" aria-labelledby="dyStyleTitle" data-title="Writing style">
      <h2 id="dyStyleTitle">Your writing style</h2>
      <p class="note">With this on, the writer looks at how ${esc(p.name)} writes (sentence length, favourite words, how English and Malay are mixed, slang) so new entries sound the same. It only learns from entries you wrote yourself, never from ones the helper wrote, and it never judges what you feel. All of this happens on this device.</p>
      <label for="dyAbout"><b>About you</b> <small>In your own words, any language. The writer reads this in the background so entries sound like you and it knows who people are. It never adds anything from here as something that happened.</small></label>
      <textarea id="dyAbout" rows="4" maxlength="${ABOUT_MAX}" placeholder="Aku Amir, kerja engineer kat KL. Wife aku Lina, aku panggil dia sayang. Suka run pagi weekend. Cakap rojak, banyak guna lah dengan haha.">${esc(st.about || "")}</textarea>
      <div class="actions"><button type="button" data-dy="about">Save About you</button><span class="note" id="dyAboutMsg" role="status">${esc(aboutMsg)}</span></div>
      ${suggHtml()}
      <label class="dy-switch"><input type="checkbox" id="dyStyleOn"${st.on ? " checked" : ""}><span>Learn my writing style from my past entries</span></label>
      ${st.on ? profile ? `<h3>What Dearly noticed</h3><ul class="dy-dna">${describeStyle(profile).map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p class="note">From ${src.length} ${src.length === 1 ? "entry" : "entries"}${st.since ? ` written since ${esc(prettyDate(st.since).date)}` : ""}.</p>`
        : `<p class="note">Write ${MIN_STYLE - src.length} more ${MIN_STYLE - src.length === 1 ? "entry" : "entries"} yourself and Dearly starts matching your style.</p>` : ""}
      ${excluded.length ? `<details class="dy-excl"><summary>${excluded.length} ${excluded.length === 1 ? "entry is" : "entries are"} left out of style learning</summary>
        <ul>${excluded.map((e) => `<li><a href="#diary/read/${esc(e.id)}">${esc(titleOf(e))}</a> <small>${esc(e.date)}</small> <button type="button" class="mini" data-dy="include" data-id="${esc(e.id)}">Use again</button></li>`).join("")}</ul></details>` : ""}
      <p class="note">To leave one entry out, tick "Don't use this entry to learn my writing style" when you write or edit it.</p>
      <div class="actions">${confirm === "reset"
        ? `<p class="note">Start fresh from today? Entries written before today stop being used for style. Nothing is deleted.</p><button type="button" class="danger" data-dy="reset-yes">Reset style</button><button type="button" data-dy="reset-no">Keep</button>`
        : `<button type="button" data-dy="reset">Reset my writing style</button>`}</div>
    </section>
    <section class="panel" aria-labelledby="dyPrivTitle" data-title="Privacy and your data">
      <h2 id="dyPrivTitle">Privacy and your data</h2>
      <ul class="dy-priv">
        <li><b>Your entries</b> are saved in this journal's private database (Google Firebase), where only your family login can read them, with a copy on this device so it works offline.</li>
        <li><b>The writer on this device</b> runs on its graphics chip. Your notes never leave it. The only thing downloaded is the model itself, once.</li>
        <li><b>The cloud writer</b> (only if you pick it) sends that entry's notes, plus About you and your style if they're on, to the family's own server on Modal. It writes the entry and keeps nothing. No AI company sees it.</li>
        <li><b>Shared login:</b> both of you sign in with the same family password, so each of you could open the other's diary. Nobody outside the family can.</li>
        <li><b>No tracking:</b> no ads, no analytics, nothing about your diary is logged.</li>
        <li><b>Photos</b> are made smaller on this device and saved with the entry.</li>
      </ul>
      <div class="actions"><button type="button" data-dy="export">Download ${esc(p.name)}'s diary as text</button></div>
      <p class="note">For a full backup you can load back in, use Backup (round button, then ⋯). It includes the diary.</p>
      <div class="lbl"><span>Paper colour on this device</span><div class="chips">${Object.entries(PAPERS).map(([k, v]) => `<button type="button" class="chip" data-paper="${k}" aria-pressed="${paperNow === k}">${v}</button>`).join("")}</div></div>
    </section>
    <section class="panel" aria-labelledby="dyBinTitle" data-title="Recently deleted">
      <h2 id="dyBinTitle">Recently deleted</h2>
      ${deleted.length ? `<p class="note">Deleted entries stay here for 30 days, then go for good.</p><ul class="dy-bin">${deleted.map((e) => `<li><div><b>${esc(titleOf(e))}</b><small>${esc(prettyDate(e.date).date)}</small></div><span class="btns">${confirm === "gone" + e.id
          ? `<button type="button" class="mini danger" data-dy="gone-yes" data-id="${esc(e.id)}">Delete forever</button><button type="button" class="mini" data-dy="gone-no">Keep</button>`
          : `<button type="button" class="mini" data-dy="restore" data-id="${esc(e.id)}">Restore</button><button type="button" class="mini" data-dy="gone" data-id="${esc(e.id)}">Delete forever</button>`}</span></li>`).join("")}</ul>`
        : `<p class="note">Nothing here. Deleted entries wait here for 30 days, so a slip of the finger can be undone.</p>`}
    </section>`;
  paintAiPage();
  if (!device) probe();
}
function paintAiPage() {
  const host = $("dyAiPage"), acts = $("dyAiActs"); if (!host) return;
  const key = aiKey(), m = ai.modelOf(key);
  let s = "";
  if (!device || device.checking) s = `<p class="note">Checking this device…</p>`;
  else if (!device.ok) s = `<div class="dy-box"><p><b>Not available on this device.</b> ${esc(ai.whyText(device.why))}</p><p class="note">The diary works fully without it. You can write yourself on this device and use the writer on another one.</p></div>`;
  else {
    const loaded = ai.isLoaded(key, device.f16);
    s = `<p class="dy-status"><span class="dy-dot ${device.downloaded ? "on" : ""}"></span>${device.downloaded ? `${esc(m.name)} model is on this device${loaded ? " and ready" : ""}.` : "Not downloaded on this device yet."}${device.soft ? " No graphics chip was found, so it will be slow." : ""}${device.memGB ? ` This device reports about ${device.memGB} GB of memory.` : ""}</p>`;
    if (aiState.phase === "download" || aiState.phase === "open") s += barHtml();
    if (aiState.msg) s += `<p class="note dy-err" role="alert">${esc(aiState.msg)}</p>`;
  }
  host.innerHTML = s;
  if (acts) acts.innerHTML = device?.ok ? `${device.downloaded
      ? `<button type="button" data-dy="test"${aiState.busy ? " disabled" : ""}>Get it ready now</button><button type="button" data-dy="remove"${aiState.busy ? " disabled" : ""}>Remove from this device</button>`
      : `<button type="button" class="primary" data-dy="download"${aiState.busy ? " disabled" : ""}>Download and turn on (about ${esc(sizeOf(m))})</button>`}` : "";
  storageLine();
}
async function storageLine() {
  const info = await ai.storageInfo(), acts = $("dyAiActs"); if (!info || !acts || !device?.ok) return;
  const gb = (n) => (n / 1e9).toFixed(n > 1e9 ? 1 : 2);
  let el = $("dyStore");
  if (!el) { el = document.createElement("p"); el.id = "dyStore"; el.className = "note"; acts.after(el); }
  el.textContent = `This site uses ${gb(info.used)} GB of this device's storage. ${info.kept ? "The browser has agreed to keep it." : "The browser may clear it if space runs low."}`;
}

function exportText() {
  const p = person(), es = live(mine()).sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
  const txt = `${p.name}'s diary\nSaved ${prettyDate(today()).date}\n\n` + es.map((e) => {
    const pd = prettyDate(e.date);
    return [`${pd.day}, ${pd.date}`, e.title ? e.title : "", isMood(e.mood) ? `Mood: ${MOODS[e.mood].word}` : "", (e.tags || []).length ? `Tags: ${e.tags.join(", ")}` : "", "", e.body.trim()].filter((x, i) => x || i === 4).join("\n");
  }).join("\n\n— — —\n\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" }));
  a.download = `dearly-${p.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}-${today()}.txt`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}
async function removeForever(e) {
  const snap = await getDocs(query(photosCol, where("entry", "==", e.id))).catch(() => null);
  await commit(() => Promise.all([deleteDoc(doc(diaryCol, e.id)), ...(snap ? snap.docs.map((d) => deleteDoc(doc(photosCol, d.id))) : [])]));
  photoCache.delete(e.id);
}
function paper() { $("diary").dataset.paper = store.get("journal-paper", "cream"); }

// ---------- events ----------
function wire() {
  const host = $("diary");
  host.addEventListener("click", async (ev) => {
    const modeBtn = ev.target.closest("[data-mode]");
    if (modeBtn && ed) {
      ed.mode = modeBtn.dataset.mode;
      host.querySelectorAll("[data-mode]").forEach((b) => { b.setAttribute("aria-pressed", b === modeBtn); b.setAttribute("aria-selected", b === modeBtn); });
      $("dyNotesBox").hidden = ed.mode !== "ai";
      if (ed.mode === "ai") { if (useCloud()) wakeCloud(); else if (!device) probe(); }
      if (ed.mode === "self") $("dyBody").focus();
      saveDraft(); return;
    }
    const moodBtn = ev.target.closest("[data-mood]");
    if (moodBtn && ed) {
      const v = +moodBtn.dataset.mood; ed.mood = ed.mood === v ? null : v;
      host.querySelectorAll("[data-mood]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.mood === ed.mood));
      saveDraft(); return;
    }
    const size = ev.target.closest("button[data-size]");
    if (size) {
      if (aiState.busy) return;
      store.set("journal-ai-model", size.dataset.size); aiState.msg = "";
      paintAi();
      if (device?.ok) { device.downloaded = await ai.isDownloaded(size.dataset.size, device.f16); if (!device.downloaded) modelUi = ""; paintAi(); }
      return;
    }
    const pap = ev.target.closest("button[data-paper]"); // #diary itself carries data-paper, so match the buttons only
    if (pap) { store.set("journal-paper", pap.dataset.paper); paper(); host.querySelectorAll("[data-paper]").forEach((b) => b.setAttribute("aria-pressed", b === pap)); return; }
    const b = ev.target.closest("[data-dy]"); if (!b) return;
    const act = b.dataset.dy, id = parseRoute().id;
    if (act === "more") { shown += PAGE; paintList(); }
    if (act === "clear") { Object.assign(filt, { q: "", month: "", tag: "", fav: false }); shown = PAGE; renderDash(true); }
    if (act === "tag") { Object.assign(filt, { q: "", month: "", fav: false, tag: b.dataset.tag }); shown = PAGE; location.hash = "#diary"; }
    if (act === "fav") { const e = find(id); if (e) { e.fav = !e.fav; renderRead(id); await commit(() => updateDoc(doc(diaryCol, id), { fav: e.fav })); } }
    if (act === "del") { confirm = "del" + id; renderRead(id); }
    if (act === "del-no") { confirm = null; renderRead(id); }
    if (act === "del-yes") {
      const e = find(id); confirm = null;
      if (e) { const { older, newer } = neighbours(mine(), id); e.deleted = Date.now(); const next = older || newer; flash = { id: next?.id || null, text: "Moved to Recently deleted. You can restore it from AI & privacy." }; location.hash = next ? `#diary/read/${next.id}` : "#diary"; await commit(() => updateDoc(doc(diaryCol, id), { deleted: e.deleted })); }
    }
    if (act === "zoom") b.classList.toggle("big");
    if (act === "write") writeForMe();
    if (act === "stop") abort?.abort();
    if (act === "download" || act === "test") { if (!device || device.checking) await probe(); if (device.ok) await startModel(); }
    if (act === "other-build") {
      const fast = !device.f16;
      store.set("journal-ai-build", fast ? "f16" : ""); store.set("journal-ai-f32", !fast);
      device.f16 = fast; aiState.msg = ""; aiState.detail = "";
      device.downloaded = await ai.isDownloaded(aiKey(), device.f16);
      aiState.note = `Switched to the ${fast ? "faster" : "safe"} build. ${device.downloaded ? "Tap Write it for me." : "Download it below, then try again."}`;
      paintAi(); return;
    }
    if (act === "copy-detail") {
      try { await navigator.clipboard.writeText(aiState.detail); $("dyCopied").textContent = "Copied. Paste it in a message to whoever helps you with the app."; }
      catch (_) { $("dyCopied").textContent = "Couldn't copy. Take a screenshot instead."; }
      return;
    }
    if (act === "cloud-use") { aiState.msg = ""; aiState.detail = ""; if (store.get("journal-ai-cloud-ok", false)) { store.set("journal-ai-where", "cloud"); wakeCloud(); } else modelUi = "cloud-ask"; paintAi(); return; }
    if (act === "cloud-yes") { store.set("journal-ai-cloud-ok", true); store.set("journal-ai-where", "cloud"); modelUi = ""; aiState.note = "Using the cloud writer on this device."; paintAi(); wakeCloud(); return; }
    if (act === "cloud-no") { modelUi = ""; paintAi(); return; }
    if (act === "style-story" || act === "style-close") { store.set("journal-ai-style", act === "style-story" ? "story" : "close"); paintAi(); return; }
    if (act === "device-use") { store.set("journal-ai-where", "device"); modelUi = ""; aiState.note = ""; paintAi(); if (!device) probe(); return; }
    if (act === "sizes-open") { modelUi = "sizes"; paintAi(); return; }
    if (act === "sizes-done") { modelUi = ""; paintAi(); return; }
    if (act === "model-remove") { modelUi = "remove"; paintAi(); return; }
    if (act === "model-keep") { modelUi = ""; paintAi(); return; }
    if (act === "remove-here") {
      const m = ai.modelOf(aiKey());
      b.disabled = true; b.textContent = "Removing…";
      try { await ai.remove(aiKey(), device.f16); device.downloaded = false; aiState.msg = ""; aiState.note = `Removed. The ${m.name} writer is off this ${device.mobile ? "phone" : "device"}. Download any size below when you want it back.`; }
      catch (_) { aiState.msg = "Couldn't remove it. Try again."; }
      modelUi = ""; paintAi(); return;
    }
    if (act === "remove") {
      aiState.busy = true; paintAiPage();
      try { await ai.remove(aiKey(), device.f16); device.downloaded = false; aiState.msg = ""; } catch (_) { aiState.msg = "Couldn't remove it. Try again."; }
      aiState.busy = false; paintAiPage();
    }
    if (act === "undo") { const el = $("dyUndo"); ed.body = el.dataset.before || `${OPENING}\n\n`; ed.ai = false; aiState.flags = []; $("dyBody").value = ed.body; el.innerHTML = ""; count(); saveDraft(); paintAi(); }
    if (act === "photo") $("dyPhotoIn").click();
    if (act === "unphoto") { const [p] = ed.photos.splice(+b.dataset.i, 1); if (p?.old) ed.removed.push(p.id); paintPhotos(); }
    if (act === "save") saveEntry();
    if (act === "discard") {
      if (b.dataset.sure) { store.del(draftKey(null)); ed = null; aiState.flags = []; painted = ""; location.hash = "#diary"; }
      else { b.dataset.sure = "1"; b.textContent = "Tap again to throw it away"; b.classList.add("danger"); }
    }
    if (act === "fresh") { store.del(draftKey(ed?.id)); ed = null; aiState.flags = []; painted = ""; render(); }
    if (act === "include") await commit(() => updateDoc(doc(diaryCol, b.dataset.id), { noStyle: false }));
    if (act === "reset") { confirm = "reset"; renderAi(); }
    if (act === "reset-no") { confirm = null; renderAi(); }
    if (act === "reset-yes") { confirm = null; styles[pid()] = { ...styleOf(), since: today() }; renderAi(); await commit(() => setDoc(doc(styleCol, pid()), { on: !!styleOf().on, since: today() }, { merge: true })); }
    if (act === "export") exportText();
    if (act === "sugg-add" || act === "sugg-no") {
      const li = b.closest("li[data-key]"), key = li.dataset.key, x = suggestions().find((y) => y.key === key); if (!x) return;
      const st = styleOf();
      if (act === "sugg-no") {
        const dismissed = [...(st.dismissed || []), key].slice(-50);
        styles[pid()] = { ...st, dismissed }; renderAi();
        await commit(() => setDoc(doc(styleCol, pid()), { dismissed }, { merge: true }));
        return;
      }
      let line = x.line;
      if (x.kind === "ask") {
        const v = li.querySelector(".dy-sugin").value.trim();
        if (!v) { li.querySelector(".dy-sugin").focus(); return; }
        line = v.toLowerCase().includes(x.name.toLowerCase()) ? v : `${x.name}: ${v}`; // "my wife" -> "Lina: my wife."
        if (!/[.!?]$/.test(line)) line += ".";
      }
      const about = addToAbout(st.about, line);
      if (about == null) { aboutMsg = "About you is full. Shorten it a little, then add this."; renderAi(); return; }
      // "Words you use" and "language" are asked once; names can each be asked about.
      const dismissed = x.kind === "add" ? [...(st.dismissed || []), key].slice(-50) : st.dismissed || [];
      styles[pid()] = { ...st, about, dismissed }; aboutMsg = "Added to About you."; renderAi();
      await commit(() => setDoc(doc(styleCol, pid()), { about, dismissed }, { merge: true }));
    }
    if (act === "about") {
      const about = $("dyAbout").value.trim().slice(0, ABOUT_MAX);
      styles[pid()] = { ...styleOf(), about };
      aboutMsg = about ? "Saved. The writer will use it from your next entry." : "Cleared."; $("dyAboutMsg").textContent = aboutMsg;
      await commit(() => setDoc(doc(styleCol, pid()), { about }, { merge: true }));
    }
    if (act === "restore") { const e = find(b.dataset.id); if (e) { delete e.deleted; renderAi(); await commit(() => setDoc(doc(diaryCol, e.id), strip(e))); } }
    if (act === "gone") { confirm = "gone" + b.dataset.id; renderAi(); }
    if (act === "gone-no") { confirm = null; renderAi(); }
    if (act === "gone-yes") { const e = find(b.dataset.id); confirm = null; if (e) { list = list.filter((x) => x.id !== e.id); renderAi(); await removeForever(e); } }
  });
  host.addEventListener("input", (ev) => {
    const t = ev.target;
    if (t.id === "dyQ") { filt.q = t.value; shown = PAGE; paintList(); return; }
    if (!ed) return;
    if (t.id === "dyNotes") { ed.notes = t.value; if (aiState.msg) { aiState.msg = ""; paintAi(); } }
    if (t.id === "dyBody") { ed.body = t.value; count(); }
    if (t.id === "dyTitle") ed.title = t.value;
    if (t.id === "dyTags") ed.tags = t.value;
    if (["dyNotes", "dyBody", "dyTitle", "dyTags"].includes(t.id)) saveDraft();
  });
  host.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t.id === "dyMonth") { filt.month = t.value; shown = PAGE; paintList(); }
    if (t.id === "dyTag") { filt.tag = t.value; shown = PAGE; paintList(); }
    if (t.id === "dySort") { filt.sort = t.value; paintList(); }
    if (t.id === "dyDate" && ed) {
      ed.date = t.value && t.value <= today() ? t.value : today(); t.value = ed.date;
      const pd = prettyDate(ed.date); $("dyEdDay").textContent = pd.day; $("dyEdDate").textContent = pd.date; saveDraft();
    }
    if (t.id === "dyNoStyle" && ed) { ed.noStyle = t.checked; saveDraft(); }
    if (t.name === "dyModel") {
      store.set("journal-ai-model", t.value);
      if (device?.ok) device.downloaded = await ai.isDownloaded(t.value, device.f16);
      aiState.msg = ""; paintAiPage();
    }
    if (t.id === "dyStyleOn") {
      const on = t.checked; styles[pid()] = { ...styleOf(), on }; renderAi();
      const body = { on }; if (styleOf().since) body.since = styleOf().since;
      await commit(() => setDoc(doc(styleCol, pid()), body, { merge: true }));
    }
    if (t.id === "dyPhotoIn" && ed) {
      const files = [...t.files].slice(0, MAX_PHOTOS - ed.photos.length); t.value = "";
      for (const f of files) {
        try { ed.photos.push(await readPhoto(f)); } catch (_) { edMsg("One photo couldn't be added. Try a different picture."); }
        paintPhotos();
      }
    }
  });
  host.addEventListener("click", (ev) => { const d = ev.target.closest("#dyFav"); if (d) { filt.fav = !filt.fav; d.setAttribute("aria-pressed", filt.fav); shown = PAGE; paintList(); } });
  // Leaving the editor keeps the draft; the dashboard then offers "Continue your draft".
  addEventListener("hashchange", () => { const r = parseRoute(); if (ed && r.page !== "write" && r.page !== "edit") { clearTimeout(saveTimer); const { photos, removed, ...rest } = ed; if (words(bodyText(rest.body)) + words(rest.notes)) store.set(draftKey(ed.id), rest); ed = null; aiState.flags = []; } });
}
const strip = ({ id, ...rest }) => rest;
