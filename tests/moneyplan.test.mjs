// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BUCKETS, addMonths, monthsBetween, dueDate, monthName, checkPlan, liveIn, paymentsLeft, monthBills,
  spentByBucket, planView, outlook, countdown, checkCommitment, paidKey, bucketFor, monthOf, monthRange, payLabel, payOf, billTasks,
} from "../public/logic/moneyplan.js";

const PLAN = { incomeSen: 400000, payDay: 1, buckets: DEFAULT_BUCKETS }; // calendar months; pay months are tested below
const C = (id, amountSen, extra = {}) => ({ id, name: id, bucket: "essentials", amountSen, dueDay: 1, startMonth: "2026-01", ...extra });
const T = (date, cat, sen, extra = {}) => ({ date, cat, amountSen: sen, type: sen < 0 ? "refund" : "purchase", spentBy: "p1", ...extra });

test("month maths crosses a new year", () => {
  assert.equal(addMonths("2026-11", 2), "2027-01");
  assert.equal(addMonths("2027-01", -1), "2026-12");
  assert.equal(monthsBetween("2026-11", "2027-12"), 13);
  assert.equal(monthName("2027-02"), "Feb 2027");
});

test("dueDate clamps day 31 to the month's last day", () => {
  assert.equal(dueDate({ dueDay: 31 }, "2027-02"), "2027-02-28");
  assert.equal(dueDate({ dueDay: 10 }, "2026-11"), "2026-11-10");
});

test("default buckets are the sheet's 55/5/10/15/15 and add to 100", () => {
  assert.deepEqual(DEFAULT_BUCKETS.map((b) => b.pct), [55, 5, 10, 15, 15]);
  assert.ok(checkPlan(PLAN).ok);
});

test("checkPlan refuses a split that isn't 100%, no income, or a nameless bucket", () => {
  assert.match(checkPlan({ incomeSen: 400000, buckets: [{ id: "a", name: "A", pct: 60 }, { id: "b", name: "B", pct: 30 }] }).error, /90%/);
  assert.equal(checkPlan({ incomeSen: 0, buckets: DEFAULT_BUCKETS }).ok, false);
  assert.equal(checkPlan({ incomeSen: 1, buckets: [{ id: "a", name: " ", pct: 100 }] }).ok, false);
  assert.equal(checkPlan({ incomeSen: 1, buckets: [{ id: "a", name: "A", pct: 99.5 }, { id: "b", name: "B", pct: 0.5 }] }).ok, false);
});

test("liveIn and paymentsLeft follow start and final months", () => {
  const c = C("taobao", 4408, { startMonth: "2026-01", endMonth: "2026-12" });
  assert.ok(liveIn(c, "2026-12"));
  assert.ok(!liveIn(c, "2027-01"));
  assert.ok(!liveIn(c, "2025-12"));
  // The sheet: Dec final, Nov paid -> 1 left; Nov not paid -> 2.
  assert.equal(paymentsLeft(c, "2026-11", true), 1);
  assert.equal(paymentsLeft(c, "2026-11", false), 2);
  assert.equal(paymentsLeft(c, "2027-02", false), 0);
  assert.equal(paymentsLeft(C("house", 1), "2026-11", false), null);
});

test("monthBills lists unpaid by due date first, then paid, and uses the paid amount", () => {
  const cs = [C("car", 49000, { dueDay: 25 }), C("house", 73030, { dueDay: 1 }), C("loan", 34300, { dueDay: 5 }), C("old", 100, { endMonth: "2026-10" })];
  const paid = { [paidKey("house", "2026-11")]: { date: "2026-11-02", amountSen: 73100 } };
  const rows = monthBills(cs, paid, "2026-11");
  assert.deepEqual(rows.map((r) => r.c.id), ["loan", "car", "house"]);
  assert.equal(rows[2].amountSen, 73100);
});

test("spentByBucket: dining and shopping are Fun, BNPL is left out, refunds net, other months ignored", () => {
  const txns = [T("2026-11-02", "dining", 3000), T("2026-11-03", "groceries", 5000), T("2026-11-04", "bnpl", 30000),
    T("2026-11-05", "shopping", -1000), T("2026-10-30", "dining", 999), T("2026-11-06", "payment", -50000, { type: "payment" })];
  assert.deepEqual(spentByBucket(txns, PLAN, "2026-11"), { fun: 2000, essentials: 5000 });
});

test("spentByBucket sends spending to the first bucket when Essentials/Fun were removed", () => {
  const plan = { incomeSen: 1, payDay: 1, buckets: [{ id: "x", name: "All", pct: 100 }] };
  assert.deepEqual(spentByBucket([T("2026-11-02", "dining", 3000)], plan, "2026-11"), { x: 3000 });
  assert.equal(bucketFor(plan, "debt"), "x");
});

test("planView: the sheet's November adds up (committed, free, over plan, per day)", () => {
  const cs = [C("house", 73030), C("deposit", 65000), C("prog", 25000), C("car", 49000),
    C("taobao", 4408, { bucket: "debt", endMonth: "2026-12" }), C("loan", 34300, { bucket: "debt", endMonth: "2029-08" })];
  const paid = { [paidKey("house", "2026-11")]: { date: "2026-11-01", amountSen: 73030 } };
  const v = planView({ plan: PLAN, commitments: cs, paid, txns: [T("2026-11-10", "dining", 16000)], day: "2026-11-23" });
  assert.equal(v.committedSen, 73030 + 65000 + 25000 + 49000 + 4408 + 34300);
  assert.equal(v.paidSen, 73030);
  assert.equal(v.toPaySen, v.committedSen - 73030);
  assert.equal(v.freeSen, 400000 - v.committedSen - 16000);
  assert.equal(v.daysLeft, 8); // 23rd to 30th, today counts
  assert.equal(v.perDaySen, Math.floor(v.freeSen / 8));
  const debt = v.buckets.find((b) => b.id === "debt");
  assert.equal(debt.planSen, 40000);
  assert.equal(debt.overSen, 0);
  assert.equal(v.buckets.find((b) => b.id === "essentials").committedSen, 212030);
  assert.equal(v.buckets.find((b) => b.id === "fun").spentSen, 16000);
  // Taobao: 2 left (Nov unpaid + Dec); loan: Nov 2026..Aug 2029 = 34 payments.
  assert.equal(v.owedSen, 2 * 4408 + 34 * 34300);
});

test("planView with no plan yet still draws: no income, nothing free per day", () => {
  const v = planView({ plan: null, commitments: [], day: "2026-11-24" }) // no plan: payday 25, so the 24th is the last day;
  assert.equal(v.incomeSen, 0);
  assert.equal(v.perDaySen, 0);
  assert.equal(v.daysLeft, 1);
  assert.equal(v.buckets.length, 5);
});

test("outlook frees money in the month after an instalment ends", () => {
  const cs = [C("house", 100000), C("paylater", 30000, { endMonth: "2027-02" })];
  const o = outlook(cs, 400000, "2026-11", { n: 6 });
  assert.equal(o.length, 6);
  assert.equal(o[3].month, "2027-02");
  assert.equal(o[3].freeSen, 270000);
  assert.deepEqual(o[3].ends.map((c) => c.id), ["paylater"]);
  assert.equal(o[4].freeSen, 300000);
});

test("countdown sorts instalments by end month and skips ones already over", () => {
  const cs = [C("a", 100, { endMonth: "2029-04" }), C("b", 200, { endMonth: "2026-12" }), C("c", 300, { endMonth: "2026-10" }), C("d", 1)];
  const cd = countdown(cs, "2026-11");
  assert.deepEqual(cd.ending.map((c) => c.id), ["b", "a"]);
  assert.equal(cd.last, "2029-04");
  assert.equal(countdown([C("d", 1)], "2026-11").last, null);
});

test("checkCommitment checks the form and defaults start to this month", () => {
  const ok = checkCommitment({ name: " Car ", amountSen: 49000, dueDay: "25", bucket: "essentials" }, PLAN, "2026-11");
  assert.deepEqual(ok, { ok: true, c: { name: "Car", bucket: "essentials", amountSen: 49000, dueDay: 25, startMonth: "2026-11" } });
  assert.equal(checkCommitment({ name: "", amountSen: 1, dueDay: 1 }, PLAN, "2026-11").ok, false);
  assert.equal(checkCommitment({ name: "x", amountSen: NaN, dueDay: 1 }, PLAN, "2026-11").ok, false);
  assert.equal(checkCommitment({ name: "x", amountSen: 1, dueDay: 32 }, PLAN, "2026-11").ok, false);
  assert.equal(checkCommitment({ name: "x", amountSen: 1, dueDay: 1, endMonth: "2026-10" }, PLAN, "2026-11").ok, false);
  assert.equal(checkCommitment({ name: "x", amountSen: 1, dueDay: 1, endMonth: "2027-01", bucket: "gone" }, PLAN, "2026-11").c.bucket, "essentials");
});

// ---------- pay months (payday 25) ----------
const PAY = { ...PLAN, payDay: 25 };

test("pay months: from the 25th it's next month's money, named after the month it ends in", () => {
  assert.equal(monthOf("2026-11-24", 25), "2026-11");
  assert.equal(monthOf("2026-11-25", 25), "2026-12");
  assert.equal(monthOf("2026-12-30", 25), "2027-01");
  assert.equal(monthOf("2026-11-30"), "2026-11"); // calendar months still the default
  assert.deepEqual(monthRange("2026-12", 25), { from: "2026-11-25", to: "2026-12-24" });
  assert.deepEqual(monthRange("2027-02", 1), { from: "2027-02-01", to: "2027-02-28" });
  assert.equal(payLabel("2026-12", 25), "25 Nov – 24 Dec");
  assert.equal(payOf(null), 25);
  assert.equal(payOf({ payDay: 1 }), 1);
  assert.equal(payOf({ payDay: 31 }), 25);
});

test("pay months: a bill due on or after payday is paid from the next pay month", () => {
  assert.equal(dueDate({ dueDay: 8 }, "2026-12", 25), "2026-12-08");
  assert.equal(dueDate({ dueDay: 28 }, "2026-12", 25), "2026-11-28");
  assert.equal(dueDate({ dueDay: 31 }, "2027-03", 25), "2027-02-28");
  // A loan due on the 28th with its final payment in Feb 2027 is paid from the Mar 2027 pay month.
  const loan = C("loan", 28000, { dueDay: 28, startMonth: "2026-11", endMonth: "2027-02" });
  assert.equal(liveIn(loan, "2026-11", 25), false);
  assert.equal(liveIn(loan, "2026-12", 25), true);
  assert.equal(liveIn(loan, "2027-03", 25), true);
  assert.equal(liveIn(loan, "2027-04", 25), false);
  assert.equal(paymentsLeft(loan, "2026-12", false, 25), 4);
  assert.equal(countdown([loan], "2026-12", 25).last, "2027-02");
  assert.equal(outlook([loan], 100000, "2027-03", { n: 2, pay: 25 })[1].freeSen, 100000);
});

test("planView on payday: the new month starts, spending before it counts in the old one", () => {
  const txns = [T("2026-11-24", "groceries", 5000), T("2026-11-25", "groceries", 7000), T("2026-12-03", "dining", 2000)];
  const v = planView({ plan: PAY, commitments: [C("car", 52000, { dueDay: 8 }), C("asb", 30000, { dueDay: 28 })], txns, day: "2026-11-25" });
  assert.equal(v.month, "2026-12");
  assert.equal(v.label, "25 Nov – 24 Dec");
  assert.equal(v.spentSen, 9000);
  assert.deepEqual(v.bills.map((r) => r.due), ["2026-11-28", "2026-12-08"]);
  assert.equal(v.daysLeft, 30);
  const before = planView({ plan: PAY, commitments: [], txns, day: "2026-11-24" });
  assert.equal(before.month, "2026-11");
  assert.equal(before.spentSen, 5000);
  assert.equal(before.daysLeft, 1);
});

test("checkPlan keeps payday 1-28", () => {
  assert.equal(checkPlan({ ...PLAN, payDay: 25 }).plan.payDay, 25);
  assert.equal(checkPlan({ ...PLAN, payDay: 30 }).ok, false);
  assert.equal(checkPlan({ incomeSen: 1, buckets: [{ id: "a", name: "A", pct: 100 }] }).plan.payDay, 25);
});

test("billTasks: unpaid debt bills from 3 days before due, overdue this pay month, payer from the last tick", () => {
  const D = (id, dueDay, extra = {}) => C(id, 10000, { bucket: "debt", dueDay, ...extra });
  const cs = [D("loan", 25), D("sofa", 5), D("late", 20), D("far", 28), C("phone", 5000, { dueDay: 24 }), D("paidOne", 24)];
  const paid = {
    [paidKey("paidOne", "2026-11")]: { commitment: "paidOne", month: "2026-11", date: "2026-11-22", by: "p2" },
    [paidKey("loan", "2026-10")]: { commitment: "loan", month: "2026-10", date: "2026-10-25", by: "p2" },
  };
  // Calendar months, 23 Nov: loan (25th) is 2 days off, late (20th) is overdue, far (28th) is 5 days off,
  // phone isn't debt, paidOne is ticked, sofa (5th) is overdue and still unpaid this month.
  const rows = billTasks(cs, paid, "2026-11-23");
  assert.deepEqual(rows.map((r) => r.c.id).sort(), ["late", "loan", "sofa"]);
  assert.equal(rows.find((r) => r.c.id === "loan").who, "p2");
  assert.equal(rows.find((r) => r.c.id === "late").who, null);
  // Next month's 2nd shows from 30 Nov.
  assert.deepEqual(billTasks([D("early", 2)], { [paidKey("early", "2026-11")]: { commitment: "early", month: "2026-11", by: "p1" } }, "2026-11-30").map((r) => [r.month, r.due]), [["2026-12", "2026-12-02"]]);
  // Payday 25: a bill due the 26th sits in the next pay month and shows from the 23rd.
  const car = { [paidKey("car", "2026-11")]: { commitment: "car", month: "2026-11", by: "p1" } };
  const pd = billTasks([D("car", 26)], car, "2026-11-23", 25);
  assert.deepEqual(pd.map((r) => [r.month, r.due, r.who]), [["2026-12", "2026-11-26", "p1"]]);
  assert.deepEqual(billTasks([D("car", 26)], car, "2026-11-22", 25), []);
});
