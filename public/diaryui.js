// Dearly, the diary journal (#diary view). Pages by hash, each in its own module under diary/:
//   #diary              dashboard.js  welcome, stats, On this day, memories (search, filter, sort, show more)
//   #diary/write        editor.js     new entry;  #diary/edit/<id> edit (drafts autosave on this device)
//   #diary/read/<id>    read.js       reading view with older / newer
//   #diary/ai           settings.js   the writer model, writing style, privacy, Recently deleted
// The writer box (device or cloud AI): diary/writer.js. Shared state: diary/state.js. Photos and deletes: diary/data.js.
// Pure logic: diary.js (entries) and writestyle.js (style profile, prompt). The model: localai.js (WebLLM, in the browser).
// Data: diary/{id} (see diary.js), diaryPhotos/{id} -> { entry, person, data, w, h }, diaryStyle/{person} -> { on, since? }.
import { collection, onSnapshot } from "./fs.js";
import { $ } from "./util.js";
import { S, pid, parseRoute } from "./diary/state.js";
import { purge } from "./diary/data.js";
import * as dashboard from "./diary/dashboard.js";
import * as read from "./diary/read.js";
import * as editor from "./diary/editor.js";
import * as writer from "./diary/writer.js";
import * as settings from "./diary/settings.js";

const PAGES = [editor, writer, settings, dashboard, read]; // each may handle clicks, input and changes
const ACTIONS = Object.assign({}, ...PAGES.map((m) => m.actions || {})); // data-dy="<name>" -> handler
let unsubs = [], onChange = () => {};

// Everyone's diary entries (deleted ones included, marked). The Mood page and reflections read moods from these.
export const diaryList = () => S.list;

export function initDiary(opts) {
  Object.assign(S, { db: opts.db, commit: opts.commit, people: opts.people, me: opts.me, getToken: opts.token || (async () => null), demo: !!opts.demo });
  onChange = opts.onChange || onChange;
  S.diaryCol = collection(opts.db, "diary");
  S.photosCol = collection(opts.db, "diaryPhotos");
  S.styleCol = collection(opts.db, "diaryStyle");
  addEventListener("hashchange", () => render());
  $("me").addEventListener("change", () => { S.painted = ""; S.ed = null; render(); });
  wire();
  settings.paper();
}
export function startDiary() {
  unsubs.push(onSnapshot(S.diaryCol, (s) => {
    S.list = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((e) => /^\d{4}-\d{2}-\d{2}$/.test(e.date || ""));
    S.ready = true;
    purge();
    render(true);
    onChange();
  }));
  unsubs.push(onSnapshot(S.styleCol, (s) => { S.styles = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); if (S.route === "ai") render(true); }));
}
export function stopDiary() { unsubs.forEach((u) => u()); unsubs = []; S.ready = false; }
export const refreshDiary = () => render(true);

// Draws the page the hash asks for. `data` = called because data changed (not because the page did).
export function render(data = false) {
  const view = $("diary");
  if (!view || view.hidden || !S.people().length) return;
  const r = parseRoute(), key = `${r.page}/${r.id || ""}/${pid()}`;
  // The editor is drawn once per opening, so new data never wipes what is being typed.
  if (data && (r.page === "write" || r.page === "edit") && S.painted === key && S.ed) return;
  if (S.painted !== key) { S.aboutMsg = ""; S.modelUi = ""; if (S.flash && S.flash.id !== r.id) S.flash = null; if (r.page !== "dash") scrollTo({ top: 0 }); }
  S.route = r.page;
  if (r.page === "dash") dashboard.renderDash(S.painted !== key);
  else if (r.page === "read") read.renderRead(r.id);
  else if (r.page === "write" || r.page === "edit") editor.renderEditor(r.page === "edit" ? r.id : null);
  else if (r.page === "ai") settings.renderSettings();
  S.painted = key;
}

// One set of listeners on #diary; each page module says what it handles.
function wire() {
  const host = $("diary");
  host.addEventListener("click", async (ev) => {
    for (const m of PAGES) if (m.click?.(ev)) return;
    const b = ev.target.closest("[data-dy]"); if (!b) return;
    await ACTIONS[b.dataset.dy]?.(b, ev);
  });
  host.addEventListener("input", (ev) => PAGES.forEach((m) => m.input?.(ev.target)));
  host.addEventListener("keydown", (ev) => editor.keydown(ev));
  host.addEventListener("change", (ev) => PAGES.forEach((m) => m.change?.(ev.target)));
  addEventListener("hashchange", () => { const r = parseRoute(); if (r.page !== "write" && r.page !== "edit") editor.leaveEditor(); });
}
