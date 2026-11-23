// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { monthsBack, monthlyByCat, topMerchants, comparePeriods, compareSpend, passes, checkProgram, CIMB_PETRONAS, computeRebate } from "../public/logic/ledger.js";

const T = (date, cat, sen, extra = {}) => ({ date, cat, amountSen: sen, type: sen < 0 ? "refund" : "purchase", spentBy: "p1", account: "a", ...extra });
const CARD = { id: "a", statementDay: 20, dueDay: 10 };

test("monthsBack lists months oldest first, across a new year", () => {
  assert.deepEqual(monthsBack("2027-02-03", 4), ["2026-11", "2026-12", "2027-01", "2027-02"]);
});

test("monthlyByCat: totals per month and category, refunds netted, payments and other months left out", () => {
  const txns = [T("2026-10-02", "dining", 1000), T("2026-10-09", "dining", -200), T("2026-11-01", "groceries", 3000),
    T("2026-11-05", "payment", -9000, { type: "payment" }), T("2026-09-30", "dining", 999), T("2026-11-06", "dining", 500, { spentBy: "p2" })];
  assert.deepEqual(monthlyByCat(txns, ["2026-10", "2026-11"]), [
    { ym: "2026-10", totalSen: 800, cats: { dining: 800 } }, { ym: "2026-11", totalSen: 3500, cats: { groceries: 3000, dining: 500 } }]);
  assert.equal(monthlyByCat(txns, ["2026-11"], { person: "p1" })[0].totalSen, 3000);
  assert.equal(monthlyByCat(txns, ["2026-11"], { account: "b" })[0].totalSen, 0);
});

test("topMerchants groups by shop name, ignores case, counts visits", () => {
  const txns = [T("2026-11-01", "fuel-petronas", 5000, { merchant: "Setel" }), T("2026-11-02", "fuel-petronas", 4000, { merchant: "SETEL" }),
    T("2026-11-03", "dining", 6000, { raw: "KOPI A" }), T("2026-11-04", "dining", 100, { merchant: "Tiny" }), T("2026-10-01", "dining", 99999, { merchant: "Old" })];
  assert.deepEqual(topMerchants(txns, { from: "2026-11-01", to: "2026-11-30", limit: 2 }), [{ name: "Setel", sen: 9000, n: 2 }, { name: "KOPI A", sen: 6000, n: 1 }]);
});

test("comparePeriods: same days into the last cycle, or the same days of last month", () => {
  assert.deepEqual(comparePeriods("2026-11-25", CARD), { kind: "cycle", now: ["2026-11-21", "2026-11-25"], before: ["2026-10-21", "2026-10-25"], full: ["2026-10-21", "2026-11-20"] });
  assert.deepEqual(comparePeriods("2026-03-31"), { kind: "month", now: ["2026-03-01", "2026-03-31"], before: ["2026-02-01", "2026-02-28"], full: ["2026-02-01", "2026-02-28"] });
  // Last cycle was shorter: stop at its statement date.
  assert.deepEqual(comparePeriods("2026-04-20", CARD).before, ["2026-02-21", "2026-03-20"]);
});

test("compareSpend: category rows, now vs before, biggest now first", () => {
  const txns = [T("2026-11-22", "dining", 3000), T("2026-11-23", "groceries", 1000), T("2026-10-22", "dining", 2000), T("2026-10-23", "tolls", 500), T("2026-10-30", "dining", 7777)];
  const r = compareSpend(txns, comparePeriods("2026-11-25", CARD));
  assert.deepEqual(r, { rows: [{ cat: "dining", nowSen: 3000, beforeSen: 2000 }, { cat: "groceries", nowSen: 1000, beforeSen: 0 }, { cat: "tolls", nowSen: 0, beforeSen: 500 }], nowSen: 4000, beforeSen: 2500 });
  assert.equal(passes({ type: "payment", amountSen: -1 }), false);
});

test("checkProgram: the CIMB preset is already tidy", () => {
  const { errors, program } = checkProgram(structuredClone(CIMB_PETRONAS));
  assert.deepEqual(errors, []);
  assert.deepEqual(program.tiers.map((t) => [t.minSen, t.maxSen]), [[0, 49999], [50000, 199999], [200000, null]]);
});

test("checkProgram sorts tiers, joins them up, shares a cap group's cap, and normalises exclusions", () => {
  const { errors, program } = checkProgram({
    name: " My card ", qualifier: "cycle_retail_spend", rounding: "none", from: "2026-01-01",
    tiers: [
      { minSen: 100000, rates: [{ cat: "dining", bps: 500, capSen: 3000, capGroup: " Food " }, { cat: "groceries", bps: 500, capSen: 2000, capGroup: "food" }, { cat: "tolls", bps: 100 }] },
      { minSen: 0, rates: [] },
    ],
    exclusions: [{ cat: "gov-tax" }, { pattern: " duitnow ", match: "contains" }, { pattern: "  " }, { cat: "nope" }],
  });
  assert.deepEqual(errors, []);
  assert.equal(program.name, "My card");
  assert.deepEqual(program.tiers.map((t) => [t.minSen, t.maxSen]), [[0, 99999], [100000, null]]);
  assert.deepEqual(program.tiers[1].rates.map((r) => [r.cat, r.capSen, r.capGroup]), [["dining", 2000, "food"], ["groceries", 2000, "food"], ["tolls", undefined, undefined]]);
  assert.deepEqual(program.exclusions, [{ cat: "gov-tax" }, { pattern: "DUITNOW", match: "contains" }]);
  // The tidied program works in the engine: RM1,500 of retail spend → tier 2, food group capped at RM20.
  const txns = [{ type: "purchase", cat: "dining", raw: "X", amountSen: 100000 }, { type: "purchase", cat: "groceries", raw: "Y", amountSen: 50000 }];
  const r = computeRebate(program, { txns, balanceSen: 0 });
  assert.deepEqual([r.tier, r.groups.find((g) => g.id === "food").finalSen], [1, 2000]);
});

test("checkProgram explains what's wrong in plain words", () => {
  const { errors } = checkProgram({ name: "", qualifier: "x", from: "", tiers: [{ minSen: 500, rates: [{ cat: "dining", bps: 20000 }, { cat: "dining", bps: 100 }, { cat: "", bps: 1 }] }, { minSen: 500, rates: [] }] });
  assert.deepEqual(errors, [
    "Give the rules a name.", "Pick what the tiers depend on.", "Pick the date the rules start.", "The first tier has to start at RM0.",
    "Tier 1: rates are 0 to 100%.", "Tier 1: Dining has two rates.", "Tier 1: pick a category for every rate.", "Two tiers start at RM5.",
  ]);
});
