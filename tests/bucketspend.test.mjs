// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_BUCKETS, txnBucket, spentByBucket, catBucket, shopBucketsWith } from "../public/logic/moneyplan.js";
import { ALL, bucketItems, byMonth, byShop, byCat, totals, shopTrack, monthsWith, matches, shopKey, usualCat, byNick, nickMap, cleanNick } from "../public/logic/bucketspend.js";

const PLAN = { incomeSen: 400000, payDay: 1, buckets: DEFAULT_BUCKETS }; // calendar months; pay months are tested below
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

test("an item's own bucket wins over its category, until that bucket leaves the plan", () => {
  const t = T("2026-11-20", "groceries", 8000, "Econsave", { bucket: "fun" });
  assert.equal(txnBucket(t, PLAN), "fun");
  assert.equal(txnBucket({ ...t, bucket: null }, PLAN), "essentials");
  assert.equal(txnBucket(t, { ...PLAN, buckets: DEFAULT_BUCKETS.filter((b) => b.id !== "fun") }), "essentials");
  assert.equal(txnBucket({ ...TX[5], bucket: "fun" }, PLAN), null); // PayLater stays a bill
  assert.deepEqual(spentByBucket([t], PLAN, "2026-11"), { fun: 8000 });
  assert.equal(bucketItems([t], PLAN, "essentials").length, 0);
  assert.equal(catBucket("dining", PLAN), "fun");
});

test("a shop rule on the plan moves every item from that shop, new ones too; the item's own pick still wins", () => {
  const plan = { ...PLAN, shopBuckets: { ECONSAVE: "fun" } };
  assert.equal(txnBucket(TX[0], plan), "fun");
  assert.equal(txnBucket(TX[1], plan), "fun"); // "ECONSAVE " spelling
  assert.equal(txnBucket(T("2027-01-02", "groceries", 100, "Econsave"), plan), "fun");
  assert.equal(txnBucket({ ...TX[0], bucket: "essentials" }, plan), "essentials");
  assert.equal(txnBucket(TX[0], { ...plan, shopBuckets: { ECONSAVE: "gone" } }), "essentials");
  assert.equal(bucketItems(TX, plan, "essentials").length, 1); // only Setel is left
});

test("shopBucketsWith keeps a rule only when it differs from what the category gives", () => {
  assert.deepEqual(shopBucketsWith(PLAN, "AG ARTISAN", "fun", "groceries"), { "AG ARTISAN": "fun" });
  assert.deepEqual(shopBucketsWith({ ...PLAN, shopBuckets: { "AG ARTISAN": "fun", X: "fun" } }, "AG ARTISAN", "fun", "dining"), { X: "fun" });
});

test("usualCat picks the category most of a shop's items have", () => {
  assert.equal(usualCat([T("2026-11-02", "dining", 1, "A"), T("2026-11-01", "groceries", 1, "A"), T("2026-10-01", "groceries", 1, "A")]), "groceries");
  assert.equal(usualCat([T("2026-11-02", "dining", 1, "A"), T("2026-11-01", "groceries", 1, "A")]), "dining");
  assert.equal(usualCat([]), "other");
});

test("your own shop names: search finds them, Where maps them back to the statement name", () => {
  const shops = [{ key: "ECONSAVE", name: "Econsave", nick: "Kedai bawah rumah" }, { key: "X", name: "X", nick: "" }];
  const nicks = nickMap(shops);
  assert.deepEqual(nicks, { ECONSAVE: "Kedai bawah rumah" });
  assert.ok(matches(TX[1], "bawah", nicks)); // "ECONSAVE " spelling too
  assert.ok(!matches(TX[2], "bawah", nicks));
  assert.equal(bucketItems(TX, PLAN, ALL, { q: "kedai bawah", nicks }).length, 4);
  assert.equal(byNick("  kedai BAWAH rumah ", shops).name, "Econsave");
  assert.equal(byNick("Econsave", shops), null);
  assert.equal(byNick("", shops), null);
  assert.equal(cleanNick("  Donut   stop  "), "Donut stop");
  assert.equal(cleanNick("x".repeat(60)).length, 40);
});
