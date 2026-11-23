// Which journal this phone shows (picked on the wheel): kept per device in localStorage "journal-type".
// App-level state shared by the wheel (mealsui.js) and the view switcher (showView in activities.js).
export const JOURNAL_KEY = "journal-type";
const FIRST = "meals";

export function currentJournal() { try { return localStorage.getItem(JOURNAL_KEY) ?? FIRST; } catch (_) { return FIRST; } }
export function setJournal(id) { try { localStorage.setItem(JOURNAL_KEY, id); } catch (_) {} }

// The view the Dashboard tab opens: the last journal picked on this phone, Meals at first.
export function journalView() {
  const t = currentJournal();
  return t === "weight" ? "home" : t === "diary" ? "diary" : t === "stocky" ? "stocky" : t === "ledger" ? "ledger" : "meals";
}
