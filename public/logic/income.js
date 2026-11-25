// Ledger income: salaries, part-time pay and money from the side (flipping things, a bonus), logged by each
// person, and what the money plan counts as a month's income. Pure: no Firebase, no DOM. Tests: tests/income.test.mjs.
//
// Firestore: ledgerIncome/{auto id} { person, date, kind, from, amountSen (> 0), note?, docs?, at, created, updated }
//   one entry per payment received; a pay month can have many. Each person logs and changes only their own.
//
// What a pay month's income is (decided 24 Nov 2026, "use the real salary"):
//   - Salaries: each person's logged salaries that month. Until this month's is logged, their salary from the
//     pay month before stands in ("expected"), so Can still spend doesn't drop on the 1st day of a month.
//   - Nobody has a salary logged this month or last: the plan's income (the old way) until the first is logged.
//   - Part-time, side income, bonuses and other income are added on top (only once received).
import { monthOf, addMonths } from "./moneyplan.js";

export const INCOME_KINDS = [
  { id: "salary", name: "Salary", icon: "work", folder: "salary" },
  { id: "parttime", name: "Part-time", icon: "clock", folder: "salary" },
  { id: "side", name: "Side income", icon: "repeat", folder: "income", hint: "Flipping, selling, small jobs" },
  { id: "bonus", name: "Bonus", icon: "gift", folder: "income" },
  { id: "other", name: "Other", icon: "wallet", folder: "income" },
];
export const FROM_MAX = 40;
export const NOTE_MAX = 120;
export const incomeKind = (id) => INCOME_KINDS.find((k) => k.id === id) ?? INCOME_KINDS.at(-1);
// Extras are everything that isn't a salary.
const isSalary = (x) => x.kind === "salary";

// A form's values, checked: { ok, error?, income }.
export function checkIncome(f) {
  const amountSen = f.amountSen, kind = INCOME_KINDS.some((k) => k.id === f.kind) ? f.kind : null;
  if (!kind) return { ok: false, error: "Pick what it is: salary, part-time, side income…" };
  if (!(Number.isInteger(amountSen) && amountSen > 0)) return { ok: false, error: "Type how much came in, like 2500." };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(f.date || "")) return { ok: false, error: "Pick the day it came in." };
  const from = String(f.from ?? "").replace(/\s+/g, " ").trim().slice(0, FROM_MAX);
  const note = String(f.note ?? "").trim().slice(0, NOTE_MAX);
  return { ok: true, income: { person: f.person, date: f.date, kind, from, amountSen, ...(note ? { note } : {}) } };
}

const sum = (xs) => xs.reduce((s, x) => s + x.amountSen, 0);
const byPerson = (xs) => xs.reduce((o, x) => ({ ...o, [x.person]: (o[x.person] ?? 0) + x.amountSen }), {});

// Pay month m's income. incomes: every ledgerIncome doc; planSen: the plan's income; pay: payday.
// { totalSen, regularSen (salaries, for the months ahead), extrasSen, fromPlan, items (this month, newest first),
//   salaries: [{ person, amountSen, expected }] }
export function monthIncome(incomes, planSen, m, pay = 1) {
  const inM = incomes.filter((x) => monthOf(x.date, pay) === m);
  const before = incomes.filter((x) => monthOf(x.date, pay) === addMonths(m, -1));
  const now = byPerson(inM.filter(isSalary)), last = byPerson(before.filter(isSalary));
  const people = [...new Set([...Object.keys(now), ...Object.keys(last)])].sort();
  const salaries = people.map((p) => (now[p] != null ? { person: p, amountSen: now[p], expected: false } : { person: p, amountSen: last[p], expected: true }));
  const fromPlan = !salaries.length;
  const regularSen = fromPlan ? planSen : sum(salaries);
  const extrasSen = sum(inM.filter((x) => !isSalary(x)));
  const items = [...inM].sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0));
  return { totalSen: regularSen + extrasSen, regularSen, extrasSen, fromPlan, items, salaries };
}

// The last values a person used, so a new entry starts from them (great-ux: start from the last choice).
export function lastIncome(incomes, person) {
  const mine = incomes.filter((x) => x.person === person).sort((a, b) => (b.at ?? 0) - (a.at ?? 0));
  return mine[0] ? { kind: mine[0].kind, from: mine[0].from } : null;
}
// The "From" suggestions: where this person's income came from before, most recent first.
export function sources(incomes, person) {
  const seen = new Set(), out = [];
  for (const x of [...incomes].filter((y) => y.person === person && y.from).sort((a, b) => (b.at ?? 0) - (a.at ?? 0))) {
    const k = x.from.toLowerCase(); if (!seen.has(k)) { seen.add(k); out.push(x.from); }
  }
  return out;
}
