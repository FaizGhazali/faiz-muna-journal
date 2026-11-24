// Brain dump: a thought typed in the ✎ sheet becomes an idea in the Activities inbox (Ideas), so nothing
// is forgotten mid-task. Pure: no DOM, no Firestore (shell/braindump.js draws the sheet and saves).

// What the thought is. Saved as `dump` on the activity and shown as a tag in Ideas.
export const DUMP_KINDS = {
  bug: { label: "Bug", icon: "🐞" },
  improve: { label: "Improve", icon: "✨" },
  idea: { label: "Idea", icon: "💡" },
};
export const DEFAULT_KIND = "idea";
export const TITLE_MAX = 120; // the Activities title limit
export const NOTE_MAX = 1000;

// The first line (cut at a word near TITLE_MAX) is the title; anything longer or on later lines is the note.
export function splitDump(text) {
  const clean = String(text || "").replace(/\r/g, "").trim();
  if (!clean) return { title: "", note: "" };
  const nl = clean.indexOf("\n");
  let title = nl < 0 ? clean : clean.slice(0, nl).trim(), rest = nl < 0 ? "" : clean.slice(nl + 1).trim();
  if (title.length > TITLE_MAX) {
    const cut = title.lastIndexOf(" ", TITLE_MAX - 1);
    const at = cut > TITLE_MAX / 2 ? cut : TITLE_MAX - 1;
    rest = (title.slice(at).trim() + (rest ? "\n" + rest : "")).trim();
    title = title.slice(0, at).trim() + "…";
  }
  return { title, note: rest.slice(0, NOTE_MAX) };
}

/** The activity doc for a brain dump: a task waiting in Ideas, tagged with its kind and the page it came from. */
export function dumpDoc({ text, kind, owner, from, day, now }) {
  const { title, note } = splitDump(text);
  if (!title || !owner) return null;
  const doc = { owner, title, type: "task", status: "inbox", dump: DUMP_KINDS[kind] ? kind : DEFAULT_KIND, created: day, updated: now };
  if (note) doc.note = note;
  if (from) doc.from = String(from).slice(0, 80);
  return doc;
}

// "#ledger/spend/fun" → "Ledger", for the "from …" line under a dumped idea.
const PAGES = { ledger: "Ledger", stocky: "Stocky", diary: "Dearly", meals: "Meals", mealsets: "Meal sets", home: "Weight",
  activities: "Activities", fitness: "Fitness", mood: "Mood", guide: "Show me how", soon: "Coming soon" };
export function pageName(from) {
  const key = String(from || "").replace(/^#/, "").split("/")[0];
  return PAGES[key] || "";
}
