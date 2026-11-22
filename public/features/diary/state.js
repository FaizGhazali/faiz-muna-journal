// Dearly's shared state: what the diary modules (dashboard, reading view, editor, writer, settings) all read.
// ES module imports can't be reassigned, so anything a module changes lives on the one `S` object.
import { PAGE } from "../../logic/diary.js";

// Per-device settings, stored as JSON (journal-ai-*, journal-paper, drafts).
export const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
  del(k) { try { localStorage.removeItem(k); } catch (_) {} },
};

export const S = {
  // Set once by initDiary().
  db: null, commit: null, people: () => [], me: () => null, getToken: async () => null, demo: false,
  diaryCol: null, photosCol: null, styleCol: null,
  // Live data from Firestore: everyone's entries (deleted ones included, marked) and each person's style settings.
  list: [], styles: {}, ready: false,
  // Dashboard filters (kept while the app is open) and how many memories are showing.
  filt: { q: "", month: "", tag: "", fav: false, sort: "new" },
  shown: PAGE,
  route: "", painted: "", // the page drawn last, so the editor isn't redrawn under someone typing
  flash: null, // { id, text } shown on that entry until you leave it
  ed: null, // the entry being written or edited
  modelUi: "", // editor writer line: "" | "sizes" (picking a size) | "remove" (confirming removal) | "cloud-ask"
  aboutMsg: "", // "Saved" under About you, kept through the redraw that saving causes
};

export const pid = () => S.me();
export const person = () => S.people().find((p) => p.id === pid());
export const mine = () => S.list.filter((e) => e.person === pid());
export const find = (id) => S.list.find((e) => e.id === id);
export const styleOf = (p = pid()) => S.styles[p] || { on: false };

// #diary, #diary/write, #diary/edit/<id>, #diary/read/<id>, #diary/ai
export function parseRoute() {
  const m = location.hash.match(/^#diary\/(write|edit|read|ai)(?:\/([\w-]+))?$/);
  if (!m) return { page: "dash" };
  return { page: m[1], id: m[2] || null };
}
