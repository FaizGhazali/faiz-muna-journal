// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { checkIncome, monthIncome, lastIncome, sources } from "../public/logic/income.js";

const I = (person, date, kind, amountSen, extra = {}) => ({ person, date, kind, amountSen, from: "", at: Date.parse(date), ...extra });

test("checkIncome wants a kind, an amount and a day", () => {
  assert.equal(checkIncome({ person: "p1", date: "2026-11-25", kind: "nope", amountSen: 100 }).ok, false);
  assert.equal(checkIncome({ person: "p1", date: "2026-11-25", kind: "salary", amountSen: 0 }).ok, false);
  assert.equal(checkIncome({ person: "p1", date: "", kind: "salary", amountSen: 100 }).ok, false);
  assert.deepEqual(checkIncome({ person: "p1", date: "2026-11-25", kind: "side", amountSen: 35000, from: "  Sold   old phone ", note: "" }).income,
    { person: "p1", date: "2026-11-25", kind: "side", from: "Sold old phone", amountSen: 35000 });
});

test("no salary logged yet: the plan's income, plus anything extra that came in", () => {
  const r = monthIncome([I("p1", "2026-11-28", "side", 30000)], 450000, "2026-12", 25);
  assert.equal(r.fromPlan, true);
  assert.equal(r.totalSen, 480000);
  assert.equal(r.extrasSen, 30000);
});

test("real salaries replace the plan; last month's stands in until this month's is logged", () => {
  const xs = [
    I("p1", "2026-10-25", "salary", 280000), I("p2", "2026-10-25", "salary", 170000),
    I("p1", "2026-11-25", "salary", 300000), // this pay month (25 Nov - 24 Dec): only p1 so far
    I("p1", "2026-12-02", "parttime", 40000), I("p2", "2026-12-10", "bonus", 50000),
  ];
  const r = monthIncome(xs, 450000, "2026-12", 25);
  assert.equal(r.fromPlan, false);
  assert.deepEqual(r.salaries, [{ person: "p1", amountSen: 300000, expected: false }, { person: "p2", amountSen: 170000, expected: true }]);
  assert.equal(r.regularSen, 470000);
  assert.equal(r.extrasSen, 90000);
  assert.equal(r.totalSen, 560000);
  assert.deepEqual(r.items.map((x) => x.date), ["2026-12-10", "2026-12-02", "2026-11-25"]);
});

test("two salaries in one month (a main job and another) add up", () => {
  const r = monthIncome([I("p1", "2026-11-25", "salary", 250000), I("p1", "2026-12-01", "salary", 60000)], 0, "2026-12", 25);
  assert.equal(r.totalSen, 310000);
});

test("a new entry starts from the last kind and source; sources are most recent first, no repeats", () => {
  const xs = [I("p1", "2026-10-25", "salary", 1, { from: "Petronas" }), I("p1", "2026-11-02", "side", 1, { from: "Carousell" }), I("p1", "2026-11-03", "side", 1, { from: "carousell" }), I("p2", "2026-11-05", "salary", 1, { from: "Clinic" })];
  assert.deepEqual(lastIncome(xs, "p1"), { kind: "side", from: "carousell" });
  assert.equal(lastIncome(xs, "p3"), null);
  assert.deepEqual(sources(xs, "p1"), ["carousell", "Petronas"]);
});
