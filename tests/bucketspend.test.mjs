// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BUCKETS, txnBucket } from "../public/logic/moneyplan.js";
import { ALL, bucketItems, byMonth, byShop, byCat, totals, shopTrack, monthsWith, matches, shopKey } from "../public/logic/bucketspend.js";

const PLAN = { incomeSen: 400000, buckets: DEFAULT_BUCKETS };
const T = (date, cat, sen, merchant, extra = {}) => ({ date, cat, amountSen: sen, merchant, type: sen < 0 ? "refund" : "purchase", spentBy: "p1", ...extra });
const TX = [
  T("2026-11-20", "groceries", 8000, "Econsave"),
  T("2026-11-05", "groceries", 12000, "ECONSAVE ", { spentBy: "p2" }),
  T("2026-11-03", "dining", 2500, "Kopitiam"),
  T("2026-10-28", "groceries", 6000, "Econsave"),
  T("2026-09-02", "fuel-petronas", 5000, "Setel"),
  T("2026-11-10", "bnpl", 4408, "Shopee PayLater"),
  { date: "2026-11-12", cat: "payment", amountSen: -50000, type: "payment", spentBy: "p1" },
  T("2026-11-21", "groceries", -1000, "Econsave"),
];

test("txnBucket: Fun for dining, Essentials for the rest, nothing for payments and PayLater", () => {
  assert.equal(txnBucket(TX[2], PLAN), "fun");
  assert.equal(txnBucket(TX[0], PLAN), "essentials");
  assert.equal(txnBucket(TX[5], PLAN), null);
  assert.equal(txnBucket(TX[6], PLAN), null);
});

test("bucketItems filters by bucket, month, person and search, newest first", () => {
  assert.deepEqual(bucketItems(TX, PLAN, "essentials", { month: "2026-11" }).map((t) => t.date), ["2026-11-21", "2026-11-20", "2026-11-05"]);
  assert.equal(bucketItems(TX, PLAN, ALL).length, 6);
  assert.equal(bucketItems(TX, PLAN, "essentials", { person: "p2" }).length, 1);
  assert.equal(bucketItems(TX, PLAN, ALL, { q: "econ" }).length, 4);
  assert.equal(bucketItems(TX, PLAN, ALL, { q: "groc" }).length, 4); // category name
  assert.equal(bucketItems(TX, PLAN, "fun", { q: "econ" }).length, 0);
});

test("byShop joins spellings and nets refunds; byMonth and byCat sum", () => {
  const items = bucketItems(TX, PLAN, "essentials");
  const shops = byShop(items);
  assert.equal(shops[0].name, "Econsave");
  assert.equal(shops[0].sen, 8000 + 12000 + 6000 - 1000);
  assert.equal(shops[0].n, 4);
  assert.deepEqual(byMonth(items).map((g) => [g.month, g.sen]), [["2026-11", 19000], ["2026-10", 6000], ["2026-09", 5000]]);
  assert.deepEqual(byCat(items).map((g) => g.cat), ["groceries", "fuel-petronas"]);
  assert.equal(shopKey(TX[1]), shopKey(TX[0]));
  assert.ok(matches(TX[0], "  eCoN "));
});

test("totals spread the total over every month since the first, empty months included", () => {
  const t = totals(bucketItems(TX, PLAN, "essentials"), "2026-11");
  assert.equal(t.months, 3);
  assert.equal(t.perMonthSen, Math.round(30000 / 3));
  assert.deepEqual(totals([], "2026-11"), { sen: 0, n: 0, first: null, months: 0, perMonthSen: 0 });
});

test("shopTrack gives a shop's whole history with 12 months of bars and the median visit", () => {
  const s = shopTrack(TX, PLAN, shopKey(TX[0]), { month: "2026-11" });
  assert.equal(s.n, 4);
  assert.equal(s.sen, 25000);
  assert.equal(s.perVisitSen, 8000); // 6000, 8000, 12000 -> 8000 (refund left out)
  assert.equal(s.lowSen, 6000);
  assert.equal(s.highSen, 12000);
  assert.equal(s.recent.length, 12);
  assert.equal(s.recent.at(-1).month, "2026-11");
  assert.equal(s.recent.at(-1).sen, 19000);
  assert.equal(s.recent.at(-2).sen, 6000);
  assert.equal(s.recent[0].sen, 0);
  assert.equal(s.last, "2026-11-21");
  assert.equal(shopTrack(TX, PLAN, shopKey(TX[0]), { month: "2026-11", person: "p2" }).n, 1);
});

test("monthsWith lists months with spending plus the current one, newest first", () => {
  assert.deepEqual(monthsWith(TX, PLAN, "fun", "2026-12"), ["2026-12", "2026-11"]);
});
