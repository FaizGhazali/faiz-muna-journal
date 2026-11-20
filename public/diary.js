// Dearly, the diary journal: the pure parts (no Firebase, no DOM). Tests in tests/diary.test.mjs.
// diary/{auto id} -> { person, date, title?, body, notes?, mood?, tags: [], fav?, cover?, photos?: [ids], ai?, noStyle?,
//                      created, updated, deleted? }. Several entries a day are fine. "deleted" (ms) = in Recently deleted.
import { iso, parse, addDays } from "./suggest.js";

export const PAGE = 8; // memories shown at a time; "Show more" adds this many
export const KEEP_DELETED_DAYS = 30; // Recently deleted keeps an entry this long
export const MAX_TAGS = 8;
export const OPENING = "Dear Diary,";

export const words = (s) => (String(s || "").match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || []).length;

// The body without the "Dear Diary," line, for previews and titles.
export const bodyText = (s) => String(s || "").replace(/^\s*dear diary,?\s*/i, "").trim();

// The entry's title, or its first sentence (cut short).
export function titleOf(e, max = 60) {
  if (e.title && e.title.trim()) return e.title.trim();
  const first = bodyText(e.body).split(/(?<=[.!?])\s|\n/)[0]?.trim() || "";
  if (!first) return "A quiet entry";
  return first.length > max ? first.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : first;
}
export function preview(e, max = 150) {
  const t = bodyText(e.body).replace(/\s+/g, " ");
  return t.length > max ? t.slice(0, max - 1).replace(/\s+\S*$/, "") + "…" : t;
}

export function parseTags(s) {
  const out = [];
  for (const t of String(s || "").split(/[,#\n]/)) {
    const v = t.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 24);
    if (v && !out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_TAGS);
}

export const live = (list) => list.filter((e) => !e.deleted);
const newestFirst = (a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0);

// Total, current streak (days in a row with an entry, ending today or yesterday), this month, last written day.
export function diaryStats(list, today) {
  const ls = live(list), days = new Set(ls.map((e) => e.date));
  let streak = 0, d = days.has(today) ? today : addDays(today, -1);
  while (days.has(d)) { streak++; d = addDays(d, -1); }
  const month = today.slice(0, 7);
  const last = [...days].filter((x) => x <= today).sort().pop() || null;
  return { total: ls.length, streak, month: ls.filter((e) => e.date.startsWith(month)).length, last };
}

// Entries from earlier years on today's month and day. 29 Feb shows on 28 Feb in other years.
export function onThisDay(list, today) {
  const md = today.slice(5), year = today.slice(0, 4);
  const leap = (y) => (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
  return live(list).filter((e) => {
    if (e.date.slice(0, 4) >= year) return false;
    const emd = e.date.slice(5);
    return emd === md || (emd === "02-29" && md === "02-28" && !leap(+year));
  }).sort(newestFirst);
}

export function tagsOf(list) { return [...new Set(live(list).flatMap((e) => e.tags || []))].sort(); }

// Search words match the title, body and tags (every word must appear, any order, any case).
export function filterEntries(list, { q = "", month = "", tag = "", fav = false, sort = "new" } = {}) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = live(list).filter((e) => {
    if (month && !e.date.startsWith(month)) return false;
    if (tag && !(e.tags || []).includes(tag)) return false;
    if (fav && !e.fav) return false;
    if (!terms.length) return true;
    const hay = `${e.title || ""} ${e.body || ""} ${(e.tags || []).join(" ")}`.toLowerCase();
    return terms.every((t) => hay.includes(t));
  }).sort(newestFirst);
  return sort === "old" ? out.reverse() : out;
}

// The entries either side of one, in date order: older and newer.
export function neighbours(list, id) {
  const ls = live(list).sort(newestFirst), i = ls.findIndex((e) => e.id === id);
  if (i < 0) return { older: null, newer: null };
  return { older: ls[i + 1] || null, newer: ls[i - 1] || null };
}

export const expired = (e, now) => !!e.deleted && now - e.deleted > KEEP_DELETED_DAYS * 864e5;

// "Friday" / "20 November 2026" for the paper header.
export function prettyDate(d) {
  const x = parse(d);
  return { day: x.toLocaleDateString(undefined, { weekday: "long" }), date: x.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" }) };
}
export function ago(d, today) {
  const n = Math.round((parse(today) - parse(d)) / 864e5);
  if (n <= 0) return "today";
  if (n === 1) return "yesterday";
  if (n < 7) return `${n} days ago`;
  if (n < 60) return `${Math.round(n / 7)} week${n < 11 ? "" : "s"} ago`;
  return parse(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

// A gentle line under the greeting. Our own words; picked by date so it stays put all day.
const LINES = [
  "Small days are worth keeping too.",
  "A few words now, a memory later.",
  "Write it the way you'd say it.",
  "No need for full sentences. Just the bits you remember.",
  "Future you will be glad you wrote this.",
  "Hari biasa pun ada cerita.",
  "Whatever today was, it counts.",
];
export const lineFor = (today) => LINES[Math.abs(Math.floor(parse(today) / 864e5)) % LINES.length];
export function greeting(hour) { return hour < 5 ? "Still up" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"; }

export { iso, parse, addDays };
