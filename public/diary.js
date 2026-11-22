// Dearly, the diary journal: the pure parts (no Firebase, no DOM). Tests in tests/diary.test.mjs.
// diary/{auto id} -> { person, date, title?, body, notes?, mood?, tags: [], fav?, cover?, photos?: [ids], ai?, noStyle?,
//                      created, updated, deleted? }. Several entries a day are fine. "deleted" (ms) = in Recently deleted.
import { iso, parse, addDays } from "./util.js";

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

// One key for tags that mean the same thing: case, spaces, dashes and a plural "s" don't count,
// so "part time", "Part-time", "parttime" and "parts times" are all one tag.
export function tagKey(t) {
  return String(t || "").toLowerCase().split(/[\s\-_.]+/).filter(Boolean)
    .map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)).join("");
}
const cleanTag = (t) => String(t || "").trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, " ").slice(0, 24).trim();

// Typed text -> tags. A tag that matches one already used ("known") takes that spelling, so no near-copies are made.
export function parseTags(s, known = []) {
  const out = [], keys = new Set(), byKey = new Map(known.map((k) => [tagKey(k), k]));
  for (const t of String(s || "").split(/[,;#\n]/)) {
    const v = cleanTag(t), k = tagKey(v);
    if (!k || keys.has(k)) continue;
    keys.add(k); out.push(byKey.get(k) || v);
  }
  return out.slice(0, MAX_TAGS);
}

// Each tag once (near-copies merged), with how many entries use it: [{ tag, key, n }], most used first.
// The spelling shown is the one used most (then the shorter one, so "part time" beats "parts times").
export function tagStats(list) {
  const by = new Map();
  for (const e of live(list)) {
    const seen = new Set();
    for (const t of e.tags || []) {
      const k = tagKey(t); if (!k || seen.has(k)) continue;
      seen.add(k);
      const g = by.get(k) || { key: k, n: 0, sp: {} };
      g.n++; g.sp[t] = (g.sp[t] || 0) + 1; by.set(k, g);
    }
  }
  return [...by.values()].map((g) => ({ key: g.key, n: g.n,
    tag: Object.keys(g.sp).sort((a, b) => g.sp[b] - g.sp[a] || a.length - b.length || a.localeCompare(b))[0] }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag));
}

// An entry's tags as they should be shown: the shared spelling, each once.
export function showTags(tags, stats) {
  const name = new Map(stats.map((s) => [s.key, s.tag])), out = [];
  for (const t of tags || []) { const v = name.get(tagKey(t)) || t; if (!out.includes(v)) out.push(v); }
  return out;
}

// Letters you'd type in order, with some left out: "mkan" fits "makan", "kja" fits "kerja" (texting short forms).
const fitsShort = (q, k) => {
  if (q.length < 2 || q[0] !== k[0] || q.length >= k.length) return false;
  let i = 0; for (const c of k) if (c === q[i]) i++;
  return i === q.length;
};
// Typo distance: a letter added, missing, wrong, or two next to each other swapped ("mkaan") each count 1.
export function typos(a, b, max = 2) {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let pp = null, prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i]; let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (pp && i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) cur[j] = Math.min(cur[j], pp[j - 2] + 1);
      best = Math.min(best, cur[j]);
    }
    if (best > max) return max + 1;
    pp = prev; prev = cur;
  }
  return prev[b.length];
}
// Is "q" (a typed key) probably a misspelling or short form of tag key "k"?
export function looksLike(q, k) {
  if (!q || !k || q === k || q.length < 3) return false;
  return fitsShort(q, k) || typos(q, k, q.length >= 7 ? 2 : 1) <= (q.length >= 7 ? 2 : 1);
}

// Tags to offer while typing:
//  same  = a tag that is the same thing (case, spaces, dashes, plural don't count),
//  close = tags it was probably meant to be ("mkan" -> "makan", "mkaan" -> "makan"),
//  list  = other tags that start with or contain the text.
export function tagMatches(text, stats, chosen = [], max = 6) {
  const q = tagKey(text), have = new Set(chosen.map(tagKey));
  const free = stats.filter((s) => !have.has(s.key));
  if (!q) return { same: null, close: [], list: free.slice(0, max) };
  const same = free.find((s) => s.key === q) || null;
  const close = same ? [] : free.filter((s) => looksLike(q, s.key)).slice(0, 3);
  const raw = cleanTag(text);
  const list = free.filter((s) => s !== same && !close.includes(s) && (s.key.startsWith(q) || s.key.includes(q) || s.tag.includes(raw))).slice(0, max);
  return { same, close, list };
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

export function tagsOf(list) { return tagStats(list).map((s) => s.tag).sort(); }

// Search words match the title, body and tags (every word must appear, any order, any case).
export function filterEntries(list, { q = "", month = "", tag = "", fav = false, sort = "new" } = {}) {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  const out = live(list).filter((e) => {
    if (month && !e.date.startsWith(month)) return false;
    if (tag && !(e.tags || []).some((t) => tagKey(t) === tagKey(tag))) return false;
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
