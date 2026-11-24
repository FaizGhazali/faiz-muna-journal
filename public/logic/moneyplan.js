// Ledger's money plan: income split into buckets, monthly commitments (bills and instalments),
// what's been paid this month, what's left to spend, and the next 12 months.
// Pure: no Firebase, no DOM. Tests: tests/moneyplan.test.mjs.
import { pad, dayNum } from "../core/util.js";
import { isSpend, norm, catName } from "./ledger.js";
//
// Firestore (money in whole sen, months "YYYY-MM"):
//   ledgerPlan/main           { incomeSen, payDay? (1-28, missing = DEFAULT_PAY_DAY), buckets: [{ id, name, pct, about? }], shopBuckets?: { <shop key>: bucket id }, created, updated }   shared by both
//     shopBuckets: a shop moved to another bucket by hand (the spending page's Edit); it covers new purchases too.
//   ledgerCommitments/{id}    { name, bucket, amountSen, dueDay (1-31), startMonth, endMonth? (final payment), notes?, created, updated }
//   ledgerPaid/{commit}_{YYYY-MM} { commitment, month, date, amountSen, by, source: typed|statement, at }   month = the pay month
//
// Pay months (decided 24 Nov 2026): the money month starts on payday, not the 1st. With payDay 25, the pay month
// "2026-12" runs 25 Nov - 24 Dec and is named after the month it ends in (where most of it is spent), so bills due
// before payday keep their calendar month. payDay 1 = calendar months. A bill's startMonth / endMonth stay the
// calendar month of its first / final payment; a bill due on or after payday falls in the next pay month.
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
export const DEFAULT_PAY_DAY = 25; // the family's payday
export const PAY_DAY_MAX = 28; // so every month has it

// ---------- months ----------
const ym = (m) => m.split("-").map(Number);
export const addMonths = (m, n) => { const [y, mo] = ym(m), t = y * 12 + mo - 1 + n; return `${Math.floor(t / 12)}-${pad((t % 12) + 1)}`; };
// The plan's payday (1 = calendar months).
export const payOf = (plan) => { const d = Number(plan?.payDay ?? DEFAULT_PAY_DAY); return Number.isInteger(d) && d >= 1 && d <= PAY_DAY_MAX ? d : DEFAULT_PAY_DAY; };
// The pay month a day is in: from payday on, it's next month's.
export const monthOf = (day, pay = 1) => (pay > 1 && Number(day.slice(8, 10)) >= pay ? addMonths(day.slice(0, 7), 1) : day.slice(0, 7));
// First and last day of pay month m: { from, to }.
export const monthRange = (m, pay = 1) => (pay > 1
  ? { from: `${addMonths(m, -1)}-${pad(pay)}`, to: `${m}-${pad(pay - 1)}` }
  : { from: `${m}-01`, to: `${m}-${pad(daysIn(m))}` });
// Whole months from a to b ("YYYY-MM"), negative when b is earlier.
export const monthsBetween = (a, b) => { const [y1, m1] = ym(a), [y2, m2] = ym(b); return (y2 - y1) * 12 + m2 - m1; };
const daysIn = (m) => { const [y, mo] = ym(m); return new Date(Date.UTC(y, mo, 0)).getUTCDate(); };
// Does a bill fall in the calendar month before its pay month? (due on or after payday)
const early = (c, pay) => pay > 1 && (c.dueDay || 1) >= pay;
// The due date in pay month m, with day 31 meaning the month's last day.
export const dueDate = (c, m, pay = 1) => { const cm = early(c, pay) ? addMonths(m, -1) : m; return `${cm}-${pad(Math.min(Math.max(1, c.dueDay || 1), daysIn(cm)))}`; };
// A bill's calendar start / final month as a pay month.
const payMonth = (c, cal, pay) => (cal && early(c, pay) ? addMonths(cal, 1) : cal);
const endOf = (c, pay) => payMonth(c, c.endMonth, pay);
// "2026-11" -> "Nov 2026"; { short: true } -> "Nov"
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const monthName = (m, { short = false } = {}) => { const [y, mo] = ym(m); return short ? MON[mo - 1] : `${MON[mo - 1]} ${y}`; };
// "25 Nov – 24 Dec" (calendar months: "Dec 2026").
export const payLabel = (m, pay = 1) => {
  if (pay <= 1) return monthName(m);
  const { from, to } = monthRange(m, pay), d = (x) => `${Number(x.slice(8))} ${MON[ym(x.slice(0, 7))[1] - 1]}`;
  return `${d(from)} – ${d(to)}`;
};

// ---------- the plan ----------
// The buckets to use: the saved plan's, else the defaults. Missing pct reads as 0.
export const bucketsOf = (plan) => (plan?.buckets?.length ? plan.buckets : DEFAULT_BUCKETS).map((b) => ({ ...b, pct: Number(b.pct) || 0 }));
const bucketIds = (plan) => bucketsOf(plan).map((b) => b.id);
// A commitment whose bucket was removed counts as the first bucket.
export const bucketFor = (plan, id) => (bucketIds(plan).includes(id) ? id : bucketIds(plan)[0]);

// Checks a plan before saving: { ok, error?, plan } (names trimmed, % whole numbers).
export function checkPlan({ incomeSen, buckets, payDay = DEFAULT_PAY_DAY }) {
  if (!(Number.isInteger(incomeSen) && incomeSen > 0)) return { ok: false, error: "Type your monthly income, like 4000." };
  const pd = Number(payDay);
  if (!(Number.isInteger(pd) && pd >= 1 && pd <= PAY_DAY_MAX)) return { ok: false, error: `Payday is a day from 1 to ${PAY_DAY_MAX}.` };
  const bs = buckets.map((b) => ({ ...b, name: String(b.name ?? "").trim(), pct: Number(b.pct) }));
  if (bs.some((b) => !b.name)) return { ok: false, error: "Every bucket needs a name." };
  if (bs.some((b) => !Number.isInteger(b.pct) || b.pct < 0 || b.pct > 100)) return { ok: false, error: "Use whole numbers from 0 to 100 for the percentages." };
  const sum = bs.reduce((s, b) => s + b.pct, 0);
  if (sum !== 100) return { ok: false, error: `The percentages add up to ${sum}%. Make them 100%.` };
  return { ok: true, plan: { incomeSen, payDay: pd, buckets: bs } };
}

// ---------- commitments ----------
// Live in pay month m: started by then and not past its final payment.
export const liveIn = (c, m, pay = 1) => (!c.startMonth || payMonth(c, c.startMonth, pay) <= m) && (!c.endMonth || endOf(c, pay) >= m);
export const paidKey = (cid, m) => `${cid}_${m}`;
// Payments still to make from month m on, counting m only if it isn't paid yet. null = no end date.
export function paymentsLeft(c, m, paidThisMonth, pay = 1) {
  if (!c.endMonth) return null;
  const end = endOf(c, pay);
  if (end < m) return 0;
  return monthsBetween(m, end) + (paidThisMonth ? 0 : 1);
}

// This month's bills: unpaid first by due date, then paid ones (latest first).
// paid: { "<commitment>_<YYYY-MM>": record }
export function monthBills(commitments, paid, m, pay = 1) {
  const rows = commitments.filter((c) => liveIn(c, m, pay)).map((c) => {
    const p = paid[paidKey(c.id, m)] ?? null;
    return { c, due: dueDate(c, m, pay), paid: p, amountSen: p?.amountSen ?? c.amountSen, left: paymentsLeft(c, m, !!p, pay) };
  });
  return [...rows.filter((r) => !r.paid).sort((a, b) => a.due.localeCompare(b.due) || a.c.name.localeCompare(b.c.name)),
    ...rows.filter((r) => r.paid).sort((a, b) => (b.paid.date || "").localeCompare(a.paid.date || ""))];
}

// Day-to-day spending this month by bucket (both people), leaving out commitments paid by card.
export function spentByBucket(txns, plan, m) {
  const out = {}, pay = payOf(plan);
  for (const t of txns) {
    const b = monthOf(t.date, pay) === m ? txnBucket(t, plan) : null;
    if (b) out[b] = (out[b] ?? 0) + t.amountSen;
  }
  return out;
}
// The bucket a category's spending counts in when nobody picked one for the item.
export const catBucket = (cat, plan) => bucketFor(plan, CAT_BUCKET[cat] ?? "essentials");
// Can this item be counted in a bucket at all? Not card payments, rebate credits or PayLater instalments (bills here).
export const inBuckets = (t) => isSpend(t) && !COMMITTED_CATS.includes(t.cat);
// A shop's name as shown, and the key that joins its spellings ("Setel", "SETEL ").
export const shopName = (t) => String(t.merchant || t.raw || catName(t.cat)).trim();
export const shopKey = (t) => norm(shopName(t));
// The bucket a Ledger item counts in, or null when it isn't day-to-day spending. First the item's own
// `bucket` (older hand fixes), then the plan's rule for its shop, then its category; a picked bucket
// counts only while it's still in the plan.
export function txnBucket(t, plan) {
  if (!inBuckets(t)) return null;
  const ids = bucketIds(plan), shop = plan?.shopBuckets?.[shopKey(t)];
  return t.bucket && ids.includes(t.bucket) ? t.bucket : shop && ids.includes(shop) ? shop : catBucket(t.cat, plan);
}
// The plan's shop rules after putting shop `key` in `bucket`. No rule is kept when that's where its category puts it anyway.
export function shopBucketsWith(plan, key, bucket, cat) {
  const out = { ...(plan?.shopBuckets ?? {}) };
  if (bucket === catBucket(cat, plan)) delete out[key]; else out[key] = bucket;
  return out;
}

// Everything the plan dashboard shows for the month of `day`. incomeSen: the month's real income
// (logic/income.js monthIncome); missing = the plan's.
export function planView({ plan, commitments = [], paid = {}, txns = [], day, incomeSen = plan?.incomeSen ?? 0 }) {
  const pay = payOf(plan), m = monthOf(day, pay), range = monthRange(m, pay);
  const bills = monthBills(commitments, paid, m, pay);
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
  const daysLeft = dayNum(range.to) - dayNum(day) + 1; // today counts
  return {
    month: m, pay, from: range.from, to: range.to, label: payLabel(m, pay), incomeSen, buckets, bills, committedSen, spentSen, paidSen, toPaySen: committedSen - paidSen, freeSen, daysLeft,
    perDaySen: freeSen > 0 ? Math.floor(freeSen / daysLeft) : 0,
    sharePct: incomeSen ? Math.round((committedSen / incomeSen) * 1000) / 10 : 0,
    owedSen: owedOnInstalments(commitments, paid, m, pay),
  };
}

// Still owed across every instalment plan from month m on (this month only if unpaid).
export function owedOnInstalments(commitments, paid, m, pay = 1) {
  return commitments.reduce((s, c) => s + (paymentsLeft(c, m, !!paid[paidKey(c.id, m)], pay) ?? 0) * c.amountSen, 0);
}

// The next n months: what's committed, what's free after it, and which instalments end that month.
export function outlook(commitments, incomeSen, m, { n = OUTLOOK_MONTHS, pay = 1 } = {}) {
  return Array.from({ length: n }, (_, i) => {
    const mm = addMonths(m, i), live = commitments.filter((c) => liveIn(c, mm, pay));
    const committedSen = live.reduce((s, c) => s + c.amountSen, 0);
    return { month: mm, committedSen, freeSen: incomeSen - committedSen, ends: live.filter((c) => endOf(c, pay) === mm) };
  });
}

// The debt-free countdown: instalments in end order, each freeing its amount from the next month,
// and the month the last one ends. Only plans that end from month m on.
export function countdown(commitments, m, pay = 1) {
  const ending = commitments.filter((c) => c.endMonth && endOf(c, pay) >= m && liveIn(c, endOf(c, pay), pay))
    .sort((a, b) => endOf(a, pay).localeCompare(endOf(b, pay)) || b.amountSen - a.amountSen);
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
