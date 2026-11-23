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

// Each journal has its own dashboard: Weight keeps the whole shared top (Your Next Move, habits, Yesterday,
// reflection and the full person cards), Meals and Ledger show only their own part of each person card under
// their own cards, Dearly and Stocky keep to themselves. `people` = which part of the person cards shows.
export const DASH = {
  home: { shared: true, people: "weight", line: "Our goal: both of us in the normal BMI range, 18.5 to 24.9." },
  meals: { people: "meals", line: "What we eat each day, and how it fits what we burn." },
  ledger: { people: "ledger", line: "Where our money goes, and what's left this month." },
  diary: { line: "A few words a day, kept for later." },
  stocky: { line: "What's at home, and what to buy next." },
  activities: { line: "Small things to do next, and our daily habits." },
  mood: { line: "How our days felt, and what goes with the good ones." },
  fitness: { line: "How each run went, and how it's changing." },
  mealsets: { line: "Our foods and the meals we make often." },
};
export const DASH_LINE = "One journal for the two of us.";
