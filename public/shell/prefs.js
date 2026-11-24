// Settings that follow a person to any phone, and the family's starting choices (today: card layouts).
// - Each person's own: prefs/{person id} → { person, boards: { <journal>: [{ id, size }] }, created, updated }.
//   Only that person writes it (firestore.rules). Their phone keeps a copy too (shell/board.js), so it opens
//   instantly and offline; a newer copy from the account replaces it when it arrives.
// - The family's starting layout: config/boards → { boards: { <journal>: [{ id, size }] }, by, created, updated },
//   set by either person with "Make this the starting layout". A layout nobody has arranged starts from it,
//   and so does "Start over". The demo never reaches Firestore, so its starting layout is the one in code.
import { doc, setDoc, onSnapshot } from "../core/fs.js";

let db, commit, demo = false, pid = null, unsubs = [];
let mine, family; // undefined = not loaded yet, then the doc's data ({} when there's none)
const subs = new Set();
const tell = () => subs.forEach((fn) => fn());

export function initPrefs(o) { ({ db, commit, demo = false } = o); }
// Called once the signed-in person is known (the demo plays the first person).
export function startPrefs(person) {
  if (!person || (person === pid && unsubs.length)) return;
  stopPrefs();
  pid = person;
  unsubs = [
    onSnapshot(doc(db, "prefs", pid), (s) => { mine = s.exists() ? s.data() : {}; tell(); }, () => {}),
    onSnapshot(doc(db, "config", "boards"), (s) => { family = s.exists() ? s.data() : {}; tell(); }, () => {}),
  ];
  tell(); // a different person on this phone: the board switches to their phone copy straight away
}
export function stopPrefs() { unsubs.forEach((u) => u()); unsubs = []; pid = null; mine = family = undefined; }

// What one board (key = the journal, e.g. "ledger") needs.
export function boardPrefs(key) {
  const now = () => Date.now();
  return {
    who: () => pid,
    // The person's saved layout: undefined while loading, null when they never saved one.
    mine: () => (mine === undefined ? undefined : mine.boards?.[key] ?? null),
    // The family's starting layout, or null for the one in code.
    family: () => family?.boards?.[key] ?? null,
    save: (layout, ok) => (pid ? commit(() => setDoc(doc(db, "prefs", pid),
      { person: pid, boards: { [key]: layout }, updated: now(), ...(mine?.created ? {} : { created: now() }) }, { merge: true }), ok) : Promise.resolve()),
    // Only signed-in people set the family's starting layout (the demo's lives in code).
    canShare: () => !!pid && !demo,
    share: (layout, ok) => commit(() => setDoc(doc(db, "config", "boards"),
      { boards: { [key]: layout }, by: pid, updated: now(), ...(family?.created ? {} : { created: now() }) }, { merge: true }), ok),
    changed: (fn) => subs.add(fn),
  };
}
