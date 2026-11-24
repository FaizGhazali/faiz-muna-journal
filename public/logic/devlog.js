// Development progress (pure, tests in tests/devlog.test.mjs). The record is the git history: tools/devlog.js turns
// each commit into one activity with readCommit() and writes public/devlog.json on every deploy, so nothing is
// typed by hand and nothing earlier is ever overwritten. The landing page reads it with wheel() and calendar().
//
// public/devlog.json → { app: "our-journal-devlog", version: 1, generated (ISO), since (YYYY-MM-DD, first record),
//   items: [{ sha, at (ISO), date (YYYY-MM-DD, author's local day), modules: [module id], kind, what }] }
// A day before `since` is "not tracked" (unknown), never zero. A commit can steer itself with trailers:
//   "Module: ledger, meals" picks the modules, "Dev: skip" leaves it out.

import { dayNum } from "../core/util.js";

export const MODULES = [
  { id: "weight", name: "Weight" },
  { id: "meals", name: "Meals" },
  { id: "diary", name: "Dearly" },
  { id: "stocky", name: "Stocky" },
  { id: "ledger", name: "Ledger" },
];
export const KINDS = { feature: 3, improve: 2, fix: 1 }; // how much a change counts toward the day's intensity
const KIND_NAMES = { feature: ["new feature", "new features"], improve: ["improvement", "improvements"], fix: ["fix", "fixes"] };

// Words in a commit summary that name a module ("Ledger: …", "Mood + Dearly: …").
const WORDS = [
  ["weight", /\b(weight|fitness|coros|mood|next move|habits?|activities|widget)\b/i],
  ["meals", /\b(meals?|calories|meal sets?)\b/i],
  ["diary", /\b(dearly|diary)\b/i],
  ["stocky", /\b(stocky|groceries)\b/i],
  ["ledger", /\b(ledger|spending|rebates?)\b/i],
];
// Files that belong to one module, used when the summary names none. The activities router (showView) is left out:
// every journal touches it. A change whose files reach APP_WIDE or more modules is app-wide work (sign-in, the
// look, refactors) and counts for none of them.
const FILES = [
  ["weight", /^public\/(features\/(weight|mood)\/|logic\/(bmi|fitness|runweight|suggest|mood|reflect)\.js|(suggest|coros|fitness|fitdetail|runweight|mood|moodui|reflect|bmi)\.js)|^android\//],
  ["meals", /^public\/(features\/meals\/|logic\/meals\.js|(meals|mealsui)\.js)/],
  ["diary", /^public\/(features\/diary\/|logic\/(diary|writestyle)\.js|(diary|diaryui|localai|aiworker|cloudai|writestyle)\.js)|^modal\//],
  ["stocky", /^public\/(features\/stocky\/|logic\/stocky\.js|(stocky|stockyui)\.js)/],
  ["ledger", /^public\/(features\/ledger\/|logic\/(ledger|ledgerimport|moneyplan|bucketspend|board|docs)\.js|shell\/board\.js)/],
];
const APP_WIDE = 3;
const CODE = /^(public|android|modal)\//; // a commit that changes none of these (docs, tests, tooling) isn't module work
const TRIVIAL = /\b(typo|wording|merge branch|revert)\b/i;

/** What kind of change a summary describes: a fix, a new feature or an improvement. */
export function kindOf(subject) {
  const s = String(subject).replace(/^[^:]{1,40}:\s*/, ""); // "Ledger: fix …" → "fix …"
  if (/\bfix(e[sd])?\b|\bbug\b|\bstop\b|\bdon'?t\b|\bno longer\b/i.test(s)) return "fix";
  if (/^(add|new)\b/i.test(s) || /^(add|new)\b/i.test(subject) || /^(an? )?\w+ journal\b/i.test(s)) return "feature";
  return "improve";
}

/** Module ids a commit worked on: its trailer, else the words in its summary, else the files it changed. */
export function modulesOf(subject, files = [], body = "") {
  const ids = MODULES.map((m) => m.id);
  const trailer = /^module:\s*(.+)$/im.exec(body);
  if (trailer) return ids.filter((id) => new RegExp(`\\b${id}\\b`, "i").test(trailer[1]));
  const named = WORDS.filter(([, re]) => re.test(subject)).map(([id]) => id);
  if (named.length) return named;
  const touched = FILES.filter(([, re]) => files.some((f) => re.test(f))).map(([id]) => id);
  return touched.length >= APP_WIDE ? [] : touched;
}

/** One commit → one activity, or null when it isn't module work (docs, tooling, app-wide, "Dev: skip", typos). */
export function readCommit({ sha, at, subject, body = "", files = [] }) {
  if (/^dev:\s*skip\b/im.test(body) || TRIVIAL.test(subject) || !files.some((f) => CODE.test(f))) return null;
  const modules = modulesOf(subject, files, body);
  if (!modules.length) return null;
  return { sha: String(sha).slice(0, 7), at, date: String(at).slice(0, 10), modules, kind: kindOf(subject), what: String(subject).trim() };
}

const valid = (log) => log && Array.isArray(log.items) && /^\d{4}-\d{2}-\d{2}$/.test(log.since || "");

/** Lifetime totals per module, in MODULES order: updates, points, each kind, active days, first / last day. */
export function wheel(log) {
  const out = MODULES.map((m) => ({ ...m, updates: 0, points: 0, feature: 0, improve: 0, fix: 0, days: 0, first: null, last: null, lastAt: "" }));
  if (!valid(log)) return out;
  const byId = Object.fromEntries(out.map((m) => [m.id, m]));
  const seen = new Set();
  for (const it of log.items) for (const id of it.modules || []) {
    const m = byId[id];
    if (!m) continue;
    m.updates++; m.points += KINDS[it.kind] || 1; m[it.kind] = (m[it.kind] || 0) + 1;
    if (!seen.has(id + it.date)) { seen.add(id + it.date); m.days++; }
    if (!m.first || it.date < m.first) m.first = it.date;
    if (!m.last || it.date > m.last) m.last = it.date;
    if ((it.at || "") > m.lastAt) m.lastAt = it.at;
  }
  return out;
}

/**
 * Journals by how long since they were last worked on, the longest wait first (never worked on leads; on the same day
 * the earlier last change, `lastAt`, waits longer; then MODULES order). Adds `ago` (whole days, null = never) and marks
 * the first one `due` when it is behind the others, so the landing page can say which journal is waiting for its turn.
 */
export function waiting(mods, today) {
  const rows = mods.map((m) => ({ ...m, ago: m.last ? Math.max(0, dayNum(today) - dayNum(m.last)) : null, due: false }));
  const key = (m) => (m.ago == null ? Infinity : m.ago);
  const time = (m) => Date.parse(m.lastAt || "") || 0;
  rows.sort((a, b) => key(b) - key(a) || time(a) - time(b));
  if (rows.length > 1 && key(rows[0]) > key(rows[rows.length - 1])) rows[0].due = true;
  return rows;
}

/** "today", "yesterday", "5 days ago", "not yet"; `short` gives "5d ago" for the wheel's labels. */
export function agoText(ago, short = false) {
  if (ago == null) return "not yet";
  if (ago === 0) return "today";
  if (ago === 1) return "yesterday";
  return short ? `${ago}d ago` : `${ago} days ago`;
}

/** "3 new features, 1 fix" for a module's totals. */
export function kindLine(m) {
  return Object.keys(KINDS).filter((k) => m[k]).map((k) => `${m[k]} ${KIND_NAMES[k][m[k] === 1 ? 0 : 1]}`).join(", ");
}

const pad = (n) => String(n).padStart(2, "0");
const isoOf = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dayOf = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };

/** Intensity 1–4 for a day's points against the busiest day's (0 = tracked, nothing done), in quarters like GitHub. */
export const levelOf = (points, max) => (points <= 0 ? 0 : Math.min(4, Math.max(1, Math.ceil((4 * points) / Math.max(points, max || 0)))));

/**
 * Weeks of days for the contribution grid, Monday first, ending with the week of `today`.
 * Each day: { date, state: "future" | "unknown" (before tracking) | "tracked", count, points, level, modules, items }.
 * Updates to one module on one day are grouped: `modules` lists each module once with its count.
 */
export function calendar(log, today, weeks = 26) {
  const ok = valid(log);
  const byDate = new Map();
  if (ok) for (const it of log.items) {
    const d = byDate.get(it.date) || { count: 0, points: 0, mods: new Map(), items: [] };
    d.count++; d.points += KINDS[it.kind] || 1; d.items.push(it);
    for (const id of it.modules || []) d.mods.set(id, (d.mods.get(id) || 0) + 1);
    byDate.set(it.date, d);
  }
  const busiest = Math.max(0, ...[...byDate.values()].map((d) => d.points));
  const end = dayOf(today);
  const start = new Date(end);
  start.setDate(end.getDate() - ((end.getDay() + 6) % 7) - (weeks - 1) * 7); // Monday, weeks-1 weeks back
  const out = [];
  for (let w = 0; w < weeks; w++) {
    const col = [];
    for (let i = 0; i < 7; i++) {
      const day = new Date(start); day.setDate(start.getDate() + w * 7 + i);
      const date = isoOf(day), d = byDate.get(date);
      const state = date > today ? "future" : !ok || date < log.since ? "unknown" : "tracked";
      const modules = d ? MODULES.filter((m) => d.mods.has(m.id)).map((m) => ({ id: m.id, name: m.name, n: d.mods.get(m.id) })) : [];
      col.push({ date, state, count: d?.count || 0, points: d?.points || 0, level: state === "tracked" ? levelOf(d?.points || 0, busiest) : 0, modules, items: d?.items || [] });
    }
    out.push(col);
  }
  return out;
}

/** How many weeks the grid needs to reach back to the first record, within [min, max]. */
export function weeksFor(log, today, min = 17, max = 53) {
  if (!valid(log)) return min;
  const span = Math.ceil((dayOf(today) - dayOf(log.since)) / 864e5 / 7) + 1;
  return Math.max(min, Math.min(max, span));
}
