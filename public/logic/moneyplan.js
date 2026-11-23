// Ledger's money plan: income split into buckets, monthly commitments (bills and instalments),
// what's been paid this month, what's left to spend, and the next 12 months.
// Pure: no Firebase, no DOM. Tests: tests/moneyplan.test.mjs.
import { pad, dayNum } from "../core/util.js";
import { isSpend } from "./ledger.js";
//
// Firestore (money in whole sen, months "YYYY-MM"):
//   ledgerPlan/main           { incomeSen, buckets: [{ id, name, pct, about? }], created, updated }   shared by both
//   ledgerCommitments/{id}    { name, bucket, amountSen, dueDay (1-31), startMonth, endMonth? (final payment), notes?, created, updated }
//   ledgerPaid/{commit}_{YYYY-MM} { commitment, month, date, amountSen, by, source: typed|statement, at }
//     "typed" = ticked by hand. A statement import may later set source "statement" (checked).

// The family's own split from their Commitment sheet. Ids are fixed (commitments point at them); names and % are theirs to change.
export const DEFAULT_BUCKETS = [
  { id: "essentials", name: "Essentials", pct: 55, about: "Housing, food, bills, transport and necessities" },
  { id: "fun", name: "Fun", pct: 5, about: "Eating out, entertainment and hobbies" },
  { id: "debt", name: "Debt repayment", pct: 10, about: "Loans, instalments and PayLater" },
  { id: "savings", name: "Savings", pct: 15, about: "Emergency fund and short-term goals" },
  { id: "invest", name: "Investments", pct: 15, about: "Long-term investments" },
];
// Day-to-day Ledger spending counts against a bucket by category; anything else is Essentials.
export const CAT_BUCKET = { dining: "fun", shopping: "fun" };
// Categories that are commitments paid on a card (a PayLater instalment), so counting them as
// day-to-day spending too would count them twice.
export const COMMITTED_CATS = ["bnpl"];
export const OUTLOOK_MONTHS = 12;

// ---------- months ----------
export const monthOf = (day) => day.slice(0, 7);
const ym = (m) => m.split("-").map(Number);
export const addMonths = (m, n) => { const [y, mo] = ym(m), t = y * 12 + mo - 1 + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; };
// Whole months from a to b ("YYYY-MM"), negative when b is earlier.
export const monthsBetween = (a, b) => { const [y1, m1] = ym(a), [y2, m2] = ym(b); return (y2 - y1) * 12 + m2 - m1; };
const daysIn = (m) => { const [y, mo] = ym(m); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
// The due date in a month, with day 31 meaning the month's last day.
export const dueDate = (c, m) => `${m}-${pad(Math.min(Math.max(1, c.dueDay || 1), daysIn(m)))}`;
// "2026-11" -> "Nov 2026"; { short: true } -> "Nov"
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m, { short = false } = {}) => { const [y, mo] = ym(m); return short ? MON[mo - 1] : `${MON[mo - 1]} ${y}`; };

// ---------- the plan ----------
// The buckets to use: the saved plan's, else the defaults. Missing pct reads as 0.
export const bucketsOf = (plan) => (plan?.buckets?.length ? plan.buckets : DEFAULT_BUCKETS).map((b) => ({ ...b, pct: Number(b.pct) || 0 }));
const bucketIds = (plan) => bucketsOf(plan).map((b) => b.id);
// A commitment whose bucket was removed counts as the first bucket.
export const bucketFor = (plan, id) => (bucketIds(plan).includes(id) ? id : bucketIds(plan)[0]);

// Checks a plan before saving: { ok, error?, plan } (names trimmed, % whole numbers).
export function checkPlan({ incomeSen, buckets }) {
  if (!(Number.isInteger(incomeSen) && incomeSen > 0)) return { ok: false, error: "Type your monthly income, like 4000." };
  const bs = buckets.map((b) => ({ ...b, name: String(b.name ?? "").trim(), pct: Number(b.pct) }));
  if (bs.some((b) => !b.name)) return { ok: false, error: "Every bucket needs a name." };
  if (bs.some((b) => !Number.isInteger(b.pct) || b.pct < 0 || b.pct > 100)) return { ok: false, error: "Use whole numbers from 0 to 100 for the percentages." };
  const sum = bs.reduce((s, b) => s + b.pct, 0);
  if (sum !== 100) return { ok: false, error: `The percentages add up to ${sum}%. Make them 100%.` };
  return { ok: true, plan: { incomeSen, buckets: bs } };
}

// ---------- commitments ----------
// Live in a month: started by then and not past its final payment.
export const liveIn = (c, m) => (!c.startMonth || c.startMonth <= m) && (!c.endMonth || c.endMonth >= m);
export const paidKey = (cid, m) => `${cid}_${m}`;
// Payments still to make from month m on, counting m only if it isn't paid yet. null = no end date.
export function paymentsLeft(c, m, paidThisMonth) {
  if (!c.endMonth) return null;
  if (c.endMonth < m) return 0;
  return monthsBetween(m, c.endMonth) + (paidThisMonth ? 0 : 1);
}

// This month's bills: unpaid first by due date, then paid ones (latest first).
// paid: { "<commitment>_<YYYY-MM>": record }
export function monthBills(commitments, paid, m) {
  const rows = commitments.filter((c) => liveIn(c, m)).map((c) => {
    const p = paid[paidKey(c.id, m)] ?? null;
    return { c, due: dueDate(c, m), paid: p, amountSen: p?.amountSen ?? c.amountSen, left: paymentsLeft(c, m, !!p) };
  });
  return [...rows.filter((r) => !r.paid).sort((a, b) => a.due.localeCompare(b.due) || a.c.name.localeCompare(b.c.name)),
    ...rows.filter((r) => r.paid).sort((a, b) => (b.paid.date || "").localeCompare(a.paid.date || ""))];
}

// Day-to-day spending this month by bucket (both people), leaving out commitments paid by card.
export function spentByBucket(txns, plan, m) {
  const out = {};
  for (const t of txns) {
    const b = monthOf(t.date) === m ? txnBucket(t, plan) : null;
    if (b) out[b] = (out[b] ?? 0) + t.amountSen;
  }
  return out;
}
// The bucket a category's spending counts in when nobody picked one for the item.
export const catBucket = (cat, plan) => bucketFor(plan, CAT_BUCKET[cat] ?? "essentials");
// Can this item be counted in a bucket at all? Not card payments, rebate credits or PayLater instalments (bills here).
export const inBuckets = (t) => isSpend(t) && !COMMITTED_CATS.includes(t.cat);
// The bucket a Ledger item counts in, or null when it isn't day-to-day spending. An item's own
// `bucket` (picked by hand on the spending page) wins while that bucket is still in the plan.
export const txnBucket = (t, plan) => (!inBuckets(t) ? null : t.bucket && bucketIds(plan).includes(t.bucket) ? t.bucket : catBucket(t.cat, plan));

// Everything the plan dashboard shows for the month of `day`.
export function planView({ plan, commitments = [], paid = {}, txns = [], day }) {
  const m = monthOf(day), incomeSen = plan?.incomeSen ?? 0;
  const bills = monthBills(commitments, paid, m);
  const committed = {}, spent = spentByBucket(txns, plan, m);
  for (const r of bills) { const b = bucketFor(plan, r.c.bucket); committed[b] = (committed[b] ?? 0) + r.amountSen; }
  const buckets = bucketsOf(plan).map((b) => {
    const planSen = Math.round((incomeSen * b.pct) / 100), usedSen = (committed[b.id] ?? 0) + (spent[b.id] ?? 0);
    return { ...b, planSen, committedSen: committed[b.id] ?? 0, spentSen: spent[b.id] ?? 0, usedSen, overSen: Math.max(0, usedSen - planSen) };
  });
  const committedSen = bills.reduce((s, r) => s + r.amountSen, 0);
  const spentSen = buckets.reduce((s, b) => s + b.spentSen, 0);
  const paidSen = bills.filter((r) => r.paid).reduce((s, r) => s + r.amountSen, 0);
  const freeSen = incomeSen - committedSen - spentSen;
  const daysLeft = dayNum(`${m}-${pad(daysIn(m))}`) - dayNum(day) + 1; // today counts
  return {
    month: m, incomeSen, buckets, bills, committedSen, spentSen, paidSen, toPaySen: committedSen - paidSen, freeSen, daysLeft,
    perDaySen: freeSen > 0 ? Math.floor(freeSen / daysLeft) : 0,
    sharePct: incomeSen ? Math.round((committedSen / incomeSen) * 1000) / 10 : 0,
    owedSen: owedOnInstalments(commitments, paid, m),
  };
}

// Still owed across every instalment plan from month m on (this month only if unpaid).
export function owedOnInstalments(commitments, paid, m) {
  return commitments.reduce((s, c) => s + (paymentsLeft(c, m, !!paid[paidKey(c.id, m)]) ?? 0) * c.amountSen, 0);
}

// The next n months: what's committed, what's free after it, and which instalments end that month.
export function outlook(commitments, incomeSen, m, n = OUTLOOK_MONTHS) {
  return Array.from({ length: n }, (_, i) => {
    const mm = addMonths(m, i), live = commitments.filter((c) => liveIn(c, mm));
    const committedSen = live.reduce((s, c) => s + c.amountSen, 0);
    return { month: mm, committedSen, freeSen: incomeSen - committedSen, ends: live.filter((c) => c.endMonth === mm) };
  });
}

// The debt-free countdown: instalments in end order, each freeing its amount from the next month,
// and the month the last one ends. Only plans that end from month m on.
export function countdown(commitments, m) {
  const ending = commitments.filter((c) => c.endMonth && c.endMonth >= m && liveIn(c, c.endMonth))
    .sort((a, b) => a.endMonth.localeCompare(b.endMonth) || b.amountSen - a.amountSen);
  return { ending, last: ending.at(-1)?.endMonth ?? null };
}

// The record saved when a bill is ticked as paid.
export function paidRecord(c, { month, date, by, amountSen = c.amountSen, at }) {
  return { commitment: c.id, month, date, amountSen, by, source: "typed", at };
}

// A commitment from the form, checked: { ok, error?, c }.
export function checkCommitment(f, plan, month) {
  const name = String(f.name ?? "").trim(), dueDay = Number(f.dueDay);
  if (!name) return { ok: false, error: "Give it a name, like Car or House." };
  if (!(Number.isInteger(f.amountSen) && f.amountSen > 0)) return { ok: false, error: "Type the monthly amount, like 490." };
  if (!(Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31)) return { ok: false, error: "The due day is 1 to 31." };
  const endMonth = f.endMonth || null, startMonth = f.startMonth || month;
  if (endMonth && !/^\d{4}-\d{2}$/.test(endMonth)) return { ok: false, error: "Pick the final payment month, or leave it empty." };
  if (endMonth && endMonth < startMonth) return { ok: false, error: "The final payment can't be before it starts." };
  const c = { name: name.slice(0, 40), bucket: bucketFor(plan, f.bucket), amountSen: f.amountSen, dueDay, startMonth };
  if (endMonth) c.endMonth = endMonth;
  return { ok: true, c };
}
