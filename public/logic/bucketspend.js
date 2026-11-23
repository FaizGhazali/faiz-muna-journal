// Ledger: what a money-plan bucket was spent on (the #ledger/spend/<bucket> page): its day-to-day
// items by month, by shop and by category, a search, and one shop's whole history.
// Pure: no Firebase, no DOM. Tests: tests/bucketspend.test.mjs.
import { norm, catName } from "./ledger.js";
import { txnBucket, monthOf, addMonths, monthsBetween, shopName, shopKey } from "./moneyplan.js";

export { shopName, shopKey };

export const ALL = "all"; // the page for every bucket at once
export const TRACK_MONTHS = 12; // months in a shop's bar chart
export const NICK_MAX = 40; // characters in your own name for a shop

// ---------- your own names for shops ----------
// ledgerShops/{auto id} { key (shopKey), name (the statement name when it was named), nick, created, updated }
// A nickname is only a label: items keep the statement name, so they still group and match statements.
export const cleanNick = (s) => String(s ?? "").replace(/\s+/g, " ").trim().slice(0, NICK_MAX);
export const nickMap = (shops = []) => Object.fromEntries(shops.filter((s) => s.key && s.nick).map((s) => [s.key, s.nick]));
// "Where" typed as one of your names gives that shop (its statement name goes on the item); else null.
export function byNick(text, shops = []) {
  const k = norm(text);
  return k ? shops.find((s) => s.nick && s.name && norm(s.nick) === k) ?? null : null;
}


// Does an item match the search? Shop name, your name for it, statement text or category name, ignoring case and spaces.
export function matches(t, q, nicks = {}) {
  const k = norm(q);
  return !k || [shopName(t), nicks[shopKey(t)], t.raw, catName(t.cat)].some((s) => norm(s).includes(k));
}

// The category most of a shop's items have (ties: the newest item's), for its Edit popup.
export function usualCat(items) {
  const n = {};
  for (const t of items) n[t.cat] = (n[t.cat] ?? 0) + 1;
  return Object.keys(n).sort((a, b) => n[b] - n[a] || (a === items[0]?.cat ? -1 : b === items[0]?.cat ? 1 : 0))[0] ?? "other";
}

// The bucket's items, newest first. month null = every month; person null = both.
export function bucketItems(txns, plan, bucket, { month = null, person = null, q = "", nicks = {} } = {}) {
  return txns.filter((t) => {
    const b = txnBucket(t, plan);
    return b && (bucket === ALL || b === bucket) && (!month || monthOf(t.date) === month) && (!person || t.spentBy === person) && matches(t, q, nicks);
  }).sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0));
}

const sum = (items) => items.reduce((s, t) => s + t.amountSen, 0);
// Groups items by a key, keeping the first item's order; each group { key, sen, n, items }.
function group(items, keyOf) {
  const out = new Map();
  for (const t of items) {
    const k = keyOf(t), g = out.get(k) ?? { key: k, sen: 0, n: 0, items: [] };
    g.sen += t.amountSen; g.n += 1; g.items.push(t); out.set(k, g);
  }
  return [...out.values()];
}

// Months, newest first (items come newest first).
export const byMonth = (items) => group(items, (t) => monthOf(t.date)).map((g) => ({ ...g, month: g.key }));
// Shops, most spent first; name = the latest spelling.
export const byShop = (items) => group(items, shopKey).map((g) => ({ ...g, name: shopName(g.items[0]), last: g.items[0].date }))
  .sort((a, b) => b.sen - a.sen || a.name.localeCompare(b.name));
export const byCat = (items) => group(items, (t) => t.cat).map((g) => ({ ...g, cat: g.key })).sort((a, b) => b.sen - a.sen);

// Totals for the tiles. Over every month, perMonthSen spreads the total from the first month to `month`
// (empty months count, so it's a fair monthly average).
export function totals(items, month) {
  const sen = sum(items), first = items.at(-1)?.date ?? null;
  const months = first ? Math.max(1, monthsBetween(monthOf(first), month) + 1) : 0;
  return { sen, n: items.length, first, months, perMonthSen: months ? Math.round(sen / months) : 0 };
}

// One shop's whole history (across every bucket, so a shop is never split): totals, each visit's
// typical amount, the last TRACK_MONTHS months (empty ones as 0) and every month it was used.
export function shopTrack(txns, plan, key, { person = null, month }) {
  const items = bucketItems(txns, plan, ALL, { person }).filter((t) => shopKey(t) === key);
  const t = totals(items, month), amounts = items.filter((x) => x.amountSen > 0).map((x) => x.amountSen).sort((a, b) => a - b);
  const per = Object.fromEntries(byMonth(items).map((g) => [g.month, g]));
  return {
    ...t, key, items, name: items[0] ? shopName(items[0]) : key,
    last: items[0]?.date ?? null,
    perVisitSen: amounts.length ? amounts[Math.floor((amounts.length - 1) / 2)] : 0, // the median visit
    lowSen: amounts[0] ?? 0, highSen: amounts.at(-1) ?? 0,
    recent: Array.from({ length: TRACK_MONTHS }, (_, i) => addMonths(month, i - TRACK_MONTHS + 1)).map((m) => ({ month: m, sen: per[m]?.sen ?? 0, n: per[m]?.n ?? 0 })),
    months: byMonth(items),
  };
}

// The months that have spending in the bucket (newest first), plus `month` itself, for the month picker.
export function monthsWith(txns, plan, bucket, month) {
  const set = new Set([month, ...bucketItems(txns, plan, bucket).map((t) => monthOf(t.date))]);
  return [...set].sort().reverse();
}
