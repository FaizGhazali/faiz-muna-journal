// Mood: how each day felt, rated 1 to 5 by the person themselves (never guessed from other data).
// Pure: no Firebase, no DOM. Stored as `mood` on entries/{person}_{date}. Tune quotes and thresholds here.
import { iso, parse, addDays } from "./util.js";

// Cool colours for hard days, warm for good ones ("feeling blue" / "sunny"). Colour-blind safe: blue vs orange.
export const MOODS = [
  null,
  { v: 1, word: "Hard", label: "Hard day" },
  { v: 2, word: "Low", label: "Low day" },
  { v: 3, word: "Okay", label: "Okay day" },
  { v: 4, word: "Good", label: "Good day" },
  { v: 5, word: "Great", label: "Great day" },
];
export const isMood = (v) => Number.isInteger(v) && v >= 1 && v <= 5;

// Own words, short, kind. Low days get comfort, never "cheer up".
export const QUOTES = {
  0: [
    "Look back kindly. Every day teaches something.",
    "How did yesterday feel? One tap is enough.",
    "Noticing how you feel is a small act of care.",
  ],
  1: [
    "Rough days end too. Be gentle with yourself today.",
    "You got through it. That counts.",
    "Rest is allowed. Today can be small.",
    "Hard days don't undo your good ones.",
    "Talk to someone you love today, even briefly.",
    "Drink water, eat something good, sleep early. Start there.",
    "It's okay not to be okay. Tomorrow is a new page.",
  ],
  2: [
    "A slow step is still a step forward.",
    "Low days pass. Do one kind thing for yourself.",
    "Not every day shines. That's normal.",
    "Pick one small thing to look forward to today.",
    "A short walk outside can change the whole day.",
    "Be as patient with yourself as you are with others.",
  ],
  3: [
    "Ordinary days hold quiet good things. Notice one today.",
    "Steady is good. Small habits build big changes.",
    "An okay day is a good base. Add one thing you enjoy.",
    "What would turn today from okay to good?",
    "Calm days are where progress quietly happens.",
    "Not every day needs to be special to matter.",
  ],
  4: [
    "What made it good? Do a little more of that today.",
    "Small good days add up to a good life.",
    "Remember what helped. It will help again.",
    "Share a bit of yesterday's good mood with someone.",
    "Good days are worth noticing. Well done.",
    "Keep the rhythm going. You're on a good path.",
  ],
  5: [
    "Remember this feeling. Say thank you for it.",
    "A great day! Write down what made it great.",
    "Joy grows when it's shared. Tell someone about it.",
    "This is what you're working for. Enjoy it.",
    "Days like this are proof the effort is worth it.",
    "Hold on to this one. Look back at it on hard days.",
  ],
};

// Same quote all day for the same person and mood, a different one tomorrow.
export function quoteFor(level, date, pid = "") {
  const list = QUOTES[isMood(level) ? level : 0];
  let h = 0;
  for (const c of `${date}|${pid}|${level}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return list[h % list.length];
}

// Every mood given on each day by one person: the face rating (entries.mood) and the mood on each diary entry
// written that day (Dearly). { date: { avg, rating|null, diary: [1..5], n } }. Deleted diary entries don't count.
export function dayMoods(entries, pid, diary = []) {
  const out = {};
  const at = (d) => (out[d] ||= { avg: null, rating: null, diary: [], n: 0 });
  for (const e of entries) if (e.person === pid && isMood(e.mood)) at(e.date).rating = e.mood;
  for (const e of diary) if (e.person === pid && !e.deleted && isMood(e.mood)) at(e.date).diary.push(e.mood);
  for (const day of Object.values(out)) {
    const all = [...day.diary, ...(day.rating ? [day.rating] : [])];
    day.n = all.length;
    day.avg = all.reduce((a, b) => a + b, 0) / all.length;
  }
  return out;
}

// { "YYYY-MM-DD": 1..5 } for one person: each day's average mood, rounded to a whole face (3.5 → 4).
// Writing several diary entries in a day with different moods gives that day their average.
export function moodMap(entries, pid, diary = []) {
  const out = {};
  for (const [d, m] of Object.entries(dayMoods(entries, pid, diary))) out[d] = Math.min(5, Math.max(1, Math.round(m.avg)));
  return out;
}

const avg = (xs) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : null);
const between = (map, from, to) => Object.entries(map).filter(([d]) => d >= from && d <= to).map(([, v]) => v);
export const average = (map, from, to) => avg(between(map, from, to));

export const mondayOf = (date) => { const d = parse(date); return addDays(date, -((d.getDay() + 6) % 7)); };

// Average of the 7 days up to and including `date`.
export const lastSeven = (map, date) => average(map, addDays(date, -6), date);

// This week / month / year, each with the period before for comparison. Averages are null when nothing was rated.
export function periods(map, today) {
  const mon = mondayOf(today), t = parse(today), y = t.getFullYear(), m = t.getMonth();
  const monthStart = iso(new Date(y, m, 1)), prevMonthStart = iso(new Date(y, m - 1, 1));
  const yearVals = between(map, `${y}-01-01`, today);
  return {
    week: { now: average(map, mon, today), before: average(map, addDays(mon, -7), addDays(mon, -1)) },
    month: { now: average(map, monthStart, today), before: average(map, prevMonthStart, addDays(monthStart, -1)) },
    year: { now: avg(yearVals), good: yearVals.length ? yearVals.filter((v) => v >= 4).length / yearVals.length : null, days: yearVals.length },
  };
}

// "What goes with good days": average mood on days with and without each thing.
// facts: { date: { ran, habits, move, weighed } } (true/false; missing = false). Rows need MIN_SIDE days on each side.
export const MIN_DAYS = 14, MIN_SIDE = 3;
export const BOOSTERS = [
  { key: "ran", label: "Exercised that day" },
  { key: "habits", label: "Did most habits" },
  { key: "move", label: "Did a Next Move" },
  { key: "weighed", label: "Weighed in" },
];
export function boosters(map, facts) {
  const days = Object.keys(map);
  const rows = BOOSTERS.map((b) => {
    const yes = days.filter((d) => facts[d]?.[b.key]).map((d) => map[d]);
    const no = days.filter((d) => !facts[d]?.[b.key]).map((d) => map[d]);
    if (yes.length < MIN_SIDE || no.length < MIN_SIDE) return null;
    return { ...b, with: avg(yes), without: avg(no), diff: avg(yes) - avg(no), n: yes.length };
  }).filter(Boolean).sort((a, b) => b.diff - a.diff);
  return { days: days.length, rows };
}

// Year in pixels: 12 rows (months) of up to 31 days. Each cell: { date, mood|null, future }.
export function yearGrid(map, year, today) {
  return Array.from({ length: 12 }, (_, m) => {
    const n = new Date(year, m + 1, 0).getDate();
    return Array.from({ length: n }, (_, i) => {
      const date = iso(new Date(year, m, i + 1));
      return { date, mood: map[date] ?? null, future: date > today };
    });
  });
}

// Mood mix: how many days of each mood (1 hard … 5 great) in the week, month or year around `anchor`.
// counts[1..5]; rated = days rated; days = days so far in the period (up to today).
// prev / next: a day in the period before / after (next is null once it would start after today).
export const VIEWS = ["week", "month", "year"];
export function moodMix(map, view, anchor, today) {
  const a = parse(anchor), y = a.getFullYear(), m = a.getMonth();
  let from, to, prev, next;
  if (view === "year") { from = `${y}-01-01`; to = `${y}-12-31`; prev = `${y - 1}-01-01`; next = `${y + 1}-01-01`; }
  else if (view === "month") { from = iso(new Date(y, m, 1)); to = iso(new Date(y, m + 1, 0)); prev = iso(new Date(y, m - 1, 1)); next = iso(new Date(y, m + 1, 1)); }
  else { from = mondayOf(anchor); to = addDays(from, 6); prev = addDays(from, -7); next = addDays(from, 7); }
  const end = to < today ? to : today, vals = between(map, from, end), counts = [0, 0, 0, 0, 0, 0];
  for (const v of vals) counts[v]++;
  const days = from > today ? 0 : Math.round((parse(end) - parse(from)) / 864e5) + 1;
  return { view, from, to, counts, pct: shares(counts, vals.length), rated: vals.length, days, avg: avg(vals), prev, next: next > today ? null : next };
}

// Whole-number percentages of `total` for counts[1..5] that always add up to 100 (largest remainder).
function shares(counts, total) {
  const pct = [0, 0, 0, 0, 0, 0];
  if (!total) return pct;
  const raw = counts.map((n) => (n * 100) / total);
  for (let v = 1; v <= 5; v++) pct[v] = Math.floor(raw[v]);
  let left = 100 - pct.reduce((s, n) => s + n, 0);
  [1, 2, 3, 4, 5].sort((a, b) => (raw[b] - pct[b]) - (raw[a] - pct[a]) || b - a).forEach((v) => { if (left > 0 && raw[v] > pct[v]) { pct[v]++; left--; } });
  return pct;
}
