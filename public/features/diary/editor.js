// Dearly editor (#diary/write, #diary/edit/<id>): notes for the writer, the page, title, mood, tags, photos.
// Drafts autosave on this device (journal-diary-draft-<pid> / journal-diary-edit-<id>). The writer itself: writer.js.
import { doc, deleteDoc, writeBatch } from "../../core/fs.js";
import { OPENING, words, bodyText, parseTags, tagStats, tagMatches, MAX_TAGS, prettyDate } from "../../logic/diary.js";
import { MOODS, isMood } from "../../logic/mood.js";
import { face } from "../../core/face.js";
import { confirmDelete } from "../../core/confirm.js";
import { $, esc, today, tagKey } from "../../core/util.js";
import { S, store, pid, person, mine, find } from "./state.js";
import { loadPhotos, photoCache } from "./data.js";
import { paintAi, useCloud, wakeCloud, probe, device, aiState } from "./writer.js";
import { render } from "./diaryui.js";
import { ico } from "../../core/icons.js";

const MAX_PHOTOS = 4;
let saveTimer = 0;

export const draftKey = (id) => (id ? `journal-diary-edit-${id}` : `journal-diary-draft-${pid()}`);
function blank() { return { id: null, date: today(), title: "", notes: "", body: `${OPENING}\n\n`, mood: null, tags: "", noStyle: false, ai: false, mode: "ai", photos: [], removed: [] }; }
function fromEntry(e) {
  return { id: e.id, date: e.date, title: e.title || "", notes: e.notes || "", body: e.body || "", mood: isMood(e.mood) ? e.mood : null, tags: (e.tags || []).join(", "),
    noStyle: !!e.noStyle, ai: !!e.ai, mode: "self", photos: [], removed: [] };
}

export function renderEditor(id) {
  const host = $("diary"), e = id ? find(id) : null;
  if (id && !e) { host.innerHTML = `<section class="panel"><p>${S.ready ? "This entry isn't here any more." : "Opening…"}</p><a class="btn" href="#diary">← All memories</a></section>`; return; }
  const saved = store.get(draftKey(id), null);
  let restored = false;
  if (!S.ed || S.ed.id !== (id || null) || S.ed.person !== pid()) {
    S.ed = { ...(e ? fromEntry(e) : blank()), person: pid() };
    if (saved && (saved.body !== S.ed.body || saved.notes !== S.ed.notes || saved.title !== S.ed.title)) { Object.assign(S.ed, saved, { photos: [], removed: [] }); restored = true; }
    if (e && (e.photos || []).length) loadPhotos(e).then((ph) => { const ed = S.ed; if (ed && ed.id === e.id && !ed.photos.length) { ed.photos = ph.map((p) => ({ ...p, old: true })); paintPhotos(); } });
  }
  const ed = S.ed, pd = prettyDate(ed.date), p = person();
  host.innerHTML = `<div class="fdtop"><a class="btn" href="${id ? `#diary/read/${esc(id)}` : "#diary"}">← ${id ? "Back to the entry" : "Back"}</a><span class="note dy-saved" id="dySaved" role="status">${restored ? "Your unsaved draft is back." : ""}</span></div>
    <section class="panel paper dy-editor" aria-labelledby="dyEdDate" data-title="Write">
      <header class="dy-edhead">
        <div><p class="dy-day" id="dyEdDay">${esc(pd.day)}</p><h2 class="dy-date" id="dyEdDate">${esc(pd.date)}</h2></div>
        <label class="dy-datepick">Change day<input type="date" id="dyDate" value="${esc(ed.date)}" max="${today()}"></label>
      </header>
      <p class="note">${id ? "Editing" : "Writing as"} <b>${esc(p.name)}</b>${restored ? ` · <button type="button" class="linkbtn" data-dy="fresh">Start fresh instead</button>` : ""}</p>
      <div class="chips dy-modes" role="tablist" aria-label="How to write">
        <button type="button" class="chip" role="tab" data-mode="ai" aria-selected="${ed.mode === "ai"}" aria-pressed="${ed.mode === "ai"}">${ico("sparkle")} Help me write</button>
        <button type="button" class="chip" role="tab" data-mode="self" aria-selected="${ed.mode === "self"}" aria-pressed="${ed.mode === "self"}">${ico("pen")} Write it myself</button>
      </div>
      <div class="dy-notes" id="dyNotesBox"${ed.mode === "ai" ? "" : " hidden"}>
        <label for="dyNotes">Jot down your day <small>Keywords, half sentences, slang, any language. One thing per line.</small></label>
        <textarea id="dyNotes" rows="5" maxlength="2000" placeholder="went mamak with friends&#10;discussed career&#10;risau pasal duit&#10;laughed until 2AM">${esc(ed.notes)}</textarea>
        <div class="actions"><button type="button" class="primary" id="dyWrite" data-dy="write">${ico("sparkle")} Write it for me</button><button type="button" id="dyStop" data-dy="stop" hidden>Stop</button></div>
        <div id="dyAi" class="dy-ai" aria-live="polite"></div>
      </div>
      <label for="dyBody" class="sr">Your diary entry</label>
      <textarea id="dyBody" class="dy-page" rows="12" maxlength="20000">${esc(ed.body)}</textarea>
      <div class="dy-under"><span class="note" id="dyCount"></span><span id="dyUndo"></span></div>
      <label for="dyTitle">Title <small>Optional. Otherwise the first sentence is used.</small><input type="text" id="dyTitle" maxlength="80" value="${esc(ed.title)}" autocomplete="off"></label>
      <div class="lbl"><span>How was the day? <small>Optional. Sets your mood for the day; several entries are averaged.</small></span><div class="mfaces" role="group" aria-label="Mood">${[1, 2, 3, 4, 5].map((v) =>
        `<button type="button" class="mface" data-mood="${v}" aria-pressed="${ed.mood === v}" aria-label="${MOODS[v].label}">${face(v, 32)}</button>`).join("")}</div></div>
      <div class="lbl dy-tagfield"><label for="dyTags">Tags <small>Optional. Tap one you've used, or type a new one and press Enter. Spaces are fine: part time.</small></label>
        <div class="dy-tagbox" id="dyTagBox"><span class="dy-chips" id="dyChips"></span><input type="text" id="dyTags" maxlength="40" value="${esc(ed.tagText || "")}" placeholder="Add a tag" autocomplete="off" autocapitalize="off" enterkeyhint="done" aria-describedby="dyTagSug"></div>
        <div class="dy-tagsug" id="dyTagSug" aria-live="polite"></div></div>
      <div class="lbl"><span>Photos <small>Optional, up to ${MAX_PHOTOS}. Made smaller before saving.</small></span>
        <div class="dy-edphotos" id="dyEdPhotos"></div>
        <input type="file" id="dyPhotoIn" accept="image/*" multiple hidden></div>
      <label class="inline dy-nostyle"><input type="checkbox" id="dyNoStyle"${ed.noStyle ? " checked" : ""}> Don't use this entry to learn my writing style</label>
      <div class="actions"><button type="button" class="primary" data-dy="save" id="dySave">${id ? "Save changes" : "Save entry"}</button>
        ${!id ? `<button type="button" data-dy="discard">Discard draft</button>` : ""}</div>
      <p class="note" id="dyEdMsg" role="status"></p>
    </section>`;
  count(); paintPhotos(); paintTags(); paintAi();
  if (ed.mode === "ai") { if (useCloud()) wakeCloud(); else if (!device) probe(); }
}

export function count() {
  const n = words(bodyText(S.ed.body)), el = $("dyCount");
  if (el) el.textContent = `${n} ${n === 1 ? "word" : "words"}`;
}

// "Undo, bring back what I had" under the page after the writer replaced it.
export function offerUndo(before) {
  const el = $("dyUndo"); if (!el) return;
  el.innerHTML = before && words(bodyText(before)) ? `<button type="button" class="linkbtn" data-dy="undo">Undo, bring back what I had</button>` : "";
  el.dataset.before = before;
}

// ---------- tags: chips + suggestions from tags already used ----------
// ed.tags = the chosen tags (comma text, as drafts always kept it); ed.tagText = what's being typed.
const chosenTags = () => parseTags(S.ed.tags);
function addTag(raw) {
  const have = chosenTags(), stats = tagStats(mine());
  const add = parseTags(raw, stats.map((s) => s.tag)).filter((t) => !have.some((h) => tagKey(h) === tagKey(t)));
  const room = MAX_TAGS - have.length;
  S.ed.tags = [...have, ...add.slice(0, Math.max(0, room))].join(", ");
  if (add.length > room) edMsg(`Up to ${MAX_TAGS} tags on one entry.`);
}
function paintTags() {
  const box = $("dyChips"), sug = $("dyTagSug"); if (!box || !S.ed) return;
  const have = chosenTags(), stats = tagStats(mine()), text = (S.ed.tagText || "").trim();
  box.innerHTML = have.map((t, i) => `<span class="dy-chip">#${esc(t)}<button type="button" data-dy="untag" data-i="${i}" aria-label="Remove tag ${esc(t)}">✕</button></span>`).join("");
  if (have.length >= MAX_TAGS) { sug.innerHTML = `<p class="note">That's ${MAX_TAGS} tags, the most for one entry.</p>`; return; }
  const { same, close, list } = tagMatches(text, stats, have, text ? 5 : 8);
  const btn = (s, cls = "") => `<button type="button" class="dy-sugtag${cls}" data-dy="addtag" data-tag="${esc(s.tag)}">#${esc(s.tag)}<small>${s.n}</small></button>`;
  let html = "";
  if (text && same) html = `<p class="dy-sughead">${same.tag === text.toLowerCase().replace(/^#+/, "").replace(/\s+/g, " ") ? "You've used this before:" : "Same as a tag you have:"}</p><div class="dy-sugrow">${btn(same, " same")}</div>`;
  else if (text) {
    const add = `<button type="button" class="dy-sugtag new" data-dy="addtag" data-tag="${esc(text)}">+ New tag #${esc(parseTags(text)[0] || text)}</button>`;
    html = close.length
      ? `<p class="dy-sughead">Did you mean…</p><div class="dy-sugrow">${close.map((s) => btn(s, " same")).join("")}</div><p class="dy-sughead">No, it's new:</p><div class="dy-sugrow">${add}</div>`
      : `<div class="dy-sugrow">${add}</div>`;
  }
  if (list.length) html += `<p class="dy-sughead">${text ? "Or one of yours:" : "Your tags:"}</p><div class="dy-sugrow">${list.map((s) => btn(s)).join("")}</div>`;
  sug.innerHTML = html;
}

// ---------- photos ----------
function paintPhotos() {
  const host = $("dyEdPhotos"), ed = S.ed; if (!host || !ed) return;
  host.innerHTML = ed.photos.map((p, i) => `<span class="dy-thumb"><img src="${esc(p.thumb || p.data)}" alt="Photo ${i + 1}"><button type="button" class="mini" data-dy="unphoto" data-i="${i}" aria-label="Remove photo ${i + 1}">✕</button></span>`).join("")
    + (ed.photos.length < MAX_PHOTOS ? `<button type="button" class="dy-addphoto" data-dy="photo">${ico("camera")} Add photo</button>` : "");
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

// ---------- drafts and saving ----------
export function saveDraft() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    if (!S.ed) return;
    const { photos, removed, ...rest } = S.ed;
    store.set(draftKey(S.ed.id), rest);
    const el = $("dySaved"); if (el) el.textContent = `Draft saved on this device${photos.some((p) => !p.old) ? " (photos are kept only until you leave)" : ""}.`;
  }, 600);
}
// Leaving the editor keeps the draft; the dashboard then offers "Continue your draft".
export function leaveEditor() {
  const ed = S.ed; if (!ed) return;
  clearTimeout(saveTimer);
  const { photos, removed, ...rest } = ed;
  if (words(bodyText(rest.body)) + words(rest.notes)) store.set(draftKey(ed.id), rest);
  S.ed = null; aiState.flags = [];
}
function edMsg(t) { const el = $("dyEdMsg"); if (el) el.textContent = t; }

async function saveEntry() {
  const ed = S.ed, body = ed.body.trim();
  if (words(bodyText(body)) < 1) { edMsg("Write a little first, even one line."); return; }
  if (!ed.date || ed.date > today()) { edMsg("Pick a day that isn't in the future."); return; }
  const old = ed.id ? find(ed.id) : null, ref = ed.id ? doc(S.diaryCol, ed.id) : doc(S.diaryCol), now = Date.now();
  const batch = writeBatch(S.db);
  const kept = [];
  for (const p of ed.photos) {
    if (p.old) { kept.push(p.id); continue; }
    const pref = doc(S.photosCol);
    batch.set(pref, { entry: ref.id, person: pid(), data: p.data, w: p.w, h: p.h, created: now });
    kept.push(pref.id);
  }
  const cover = ed.photos[0]?.thumb || (ed.photos[0]?.old ? old?.cover : null);
  const entry = {
    person: pid(), date: ed.date, body, tags: parseTags(`${ed.tags},${ed.tagText || ""}`, tagStats(mine()).map((s) => s.tag)), fav: !!old?.fav,
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
    await S.commit(() => batch.commit(), old ? "Changes saved." : "Saved to your diary.");
    if (gone.length) await S.commit(() => Promise.all(gone.map((id) => deleteDoc(doc(S.photosCol, id)))));
  } finally { const b = $("dySave"); if (b) b.disabled = false; }
  photoCache.delete(ref.id);
  store.del(draftKey(ed.id));
  S.ed = null;
  S.flash = { id: ref.id, text: old ? "Changes saved." : "Saved to your diary." };
  location.hash = `#diary/read/${ref.id}`;
}

// ---------- events (dispatched from diaryui.js) ----------
export function click(ev) {
  const ed = S.ed, host = $("diary");
  const modeBtn = ev.target.closest("[data-mode]");
  if (modeBtn && ed) {
    ed.mode = modeBtn.dataset.mode;
    host.querySelectorAll("[data-mode]").forEach((b) => { b.setAttribute("aria-pressed", b === modeBtn); b.setAttribute("aria-selected", b === modeBtn); });
    $("dyNotesBox").hidden = ed.mode !== "ai";
    if (ed.mode === "ai") { if (useCloud()) wakeCloud(); else if (!device) probe(); }
    if (ed.mode === "self") $("dyBody").focus();
    saveDraft(); return true;
  }
  const moodBtn = ev.target.closest("[data-mood]");
  if (moodBtn && ed) {
    const v = +moodBtn.dataset.mood; ed.mood = ed.mood === v ? null : v;
    host.querySelectorAll("[data-mood]").forEach((b) => b.setAttribute("aria-pressed", +b.dataset.mood === ed.mood));
    saveDraft(); return true;
  }
  if (ev.target.id === "dyTagBox" || ev.target.id === "dyChips") { $("dyTags").focus(); return true; }
  return false;
}

export const actions = {
  undo() { const el = $("dyUndo"), ed = S.ed; ed.body = el.dataset.before || `${OPENING}\n\n`; ed.ai = false; aiState.flags = []; $("dyBody").value = ed.body; el.innerHTML = ""; count(); saveDraft(); paintAi(); },
  addtag(b) { const typed = !!(S.ed.tagText || "").trim(); addTag(b.dataset.tag); S.ed.tagText = ""; $("dyTags").value = ""; paintTags(); saveDraft(); if (typed) $("dyTags").focus(); },
  untag(b) { const have = chosenTags(); have.splice(+b.dataset.i, 1); S.ed.tags = have.join(", "); paintTags(); saveDraft(); },
  photo() { $("dyPhotoIn").click(); },
  async unphoto(b) {
    const i = +b.dataset.i, ph = S.ed?.photos[i]; if (!ph) return;
    const ok = await confirmDelete({ title: `Remove photo ${i + 1}?`, yes: "Remove photo", note: ph.old ? "It goes when you save the entry. Cancel the edit to keep it." : "To get it back you'd add it again.",
      body: `<p><img src="${esc(ph.thumb || ph.data)}" alt="" style="max-width:120px;max-height:120px;border-radius:10px"></p>` });
    if (!ok || S.ed?.photos[i] !== ph) return;
    S.ed.photos.splice(i, 1); if (ph.old) S.ed.removed.push(ph.id); paintPhotos();
  },
  save() { saveEntry(); },
  async discard() {
    const ok = await confirmDelete({ title: "Throw this draft away?", yes: "Discard draft", body: "<p>What you've written here, and any photos added to it, are gone.</p>" });
    if (ok) { store.del(draftKey(null)); S.ed = null; aiState.flags = []; S.painted = ""; location.hash = "#diary"; }
  },
  async fresh() {
    const ok = await confirmDelete({ title: "Start fresh?", yes: "Throw draft away",
      body: `<p>The unsaved changes kept on this phone are thrown away, and you start from ${S.ed?.id ? "the saved entry" : "an empty page"}.</p>` });
    if (!ok) return;
    store.del(draftKey(S.ed?.id)); S.ed = null; aiState.flags = []; S.painted = ""; render();
  },
};

export function input(t) {
  const ed = S.ed; if (!ed) return;
  if (t.id === "dyNotes") { ed.notes = t.value; if (aiState.msg) { aiState.msg = ""; paintAi(); } }
  if (t.id === "dyBody") { ed.body = t.value; count(); }
  if (t.id === "dyTitle") ed.title = t.value;
  if (t.id === "dyTags") {
    // A comma or # ends a tag (spaces don't: "part time" stays one tag).
    const parts = t.value.split(/[,;#\n]/);
    if (parts.length > 1) { addTag(parts.slice(0, -1).join(",")); t.value = parts[parts.length - 1].trimStart(); }
    ed.tagText = t.value; paintTags();
  }
  if (["dyNotes", "dyBody", "dyTitle", "dyTags"].includes(t.id)) saveDraft();
}

export function keydown(ev) {
  const t = ev.target, ed = S.ed; if (t.id !== "dyTags" || !ed) return;
  if (ev.key === "Enter" && !ev.isComposing) { ev.preventDefault(); if (t.value.trim()) { addTag(t.value); t.value = ""; ed.tagText = ""; paintTags(); saveDraft(); } }
  if (ev.key === "Backspace" && !t.value) { const have = chosenTags(); if (have.length) { have.pop(); ed.tags = have.join(", "); paintTags(); saveDraft(); } }
}

export async function change(t) {
  const ed = S.ed; if (!ed) return;
  if (t.id === "dyDate") {
    ed.date = t.value && t.value <= today() ? t.value : today(); t.value = ed.date;
    const pd = prettyDate(ed.date); $("dyEdDay").textContent = pd.day; $("dyEdDate").textContent = pd.date; saveDraft();
  }
  if (t.id === "dyNoStyle") { ed.noStyle = t.checked; saveDraft(); }
  if (t.id === "dyPhotoIn") {
    const files = [...t.files].slice(0, MAX_PHOTOS - ed.photos.length); t.value = "";
    for (const f of files) {
      try { ed.photos.push(await readPhoto(f)); } catch (_) { edMsg("One photo couldn't be added. Try a different picture."); }
      paintPhotos();
    }
  }
}
