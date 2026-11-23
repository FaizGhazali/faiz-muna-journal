// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BUCKETS, addMonths, monthsBetween, dueDate, monthName, checkPlan, liveIn, paymentsLeft, monthBills,
  spentByBucket, planView, outlook, countdown, checkCommitment, paidKey, bucketFor,
} from "../public/logic/moneyplan.js";

const PLAN = { incomeSen: 400000, buckets: DEFAULT_BUCKETS };
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
  const plan = { incomeSen: 1, buckets: [{ id: "x", name: "All", pct: 100 }] };
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
  const v = planView({ plan: null, commitments: [], day: "2026-11-30" });
  assert.equal(v.incomeSen, 0);
  assert.equal(v.perDaySen, 0);
  assert.equal(v.daysLeft, 1);
  assert.equal(v.buckets.length, 5);
});

test("outlook frees money in the month after an instalment ends", () => {
  const cs = [C("house", 100000), C("paylater", 30000, { endMonth: "2027-02" })];
  const o = outlook(cs, 400000, "2026-11", 6);
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
