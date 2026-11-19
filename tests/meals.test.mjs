// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { slotAt, portion, total, dayTotal, usual, plateOf, logItems, rankSets, readFood, fitsSlot, shadeOf, yearStats, LEARN_AFTER, bmr, burnOf, intakeRange, weightOn, verdict } from "../public/meals.js";

const rice = { id: "rice", name: "Rice", kcal: 130, carb: 28, protein: 2.7, fat: 0.3 };
const fish = { id: "fish", name: "Fried fish", kcal: 220, carb: 2, protein: 18, fat: 16 };
const meal = (person, date, items, at = 0, set) => ({ person, date, at, items, ...(set ? { set } : {}) });

test("slotAt picks the meal for the hour", () => {
  assert.equal(slotAt(7), "breakfast");
  assert.equal(slotAt(13), "lunch");
  assert.equal(slotAt(19), "dinner");
  assert.equal(slotAt(23), "snack");
});

test("portion scales per-100 g numbers", () => {
  assert.deepEqual(portion(rice, 150), { kcal: 195, carb: 42, protein: 4.1, fat: 0.5 });
  assert.deepEqual(portion(fish, 0), { kcal: 0, carb: 0, protein: 0, fat: 0 });
});

test("total and dayTotal add up items and meals", () => {
  const a = { kcal: 100, carb: 10.25, protein: 1, fat: 2 }, b = { kcal: 50, carb: 0.1, protein: 3, fat: 0 };
  assert.deepEqual(total([a, b]), { kcal: 150, carb: 10.4, protein: 4, fat: 2 });
  assert.deepEqual(dayTotal([{ items: [a] }, { items: [b] }, {}]), { kcal: 150, carb: 10.4, protein: 4, fat: 2 });
});

test("usual is the median of the last 5 portions for that person, to 5 g", () => {
  assert.equal(usual([], "p1", "rice"), null);
  const ms = [150, 160, 400, 170, 180, 175].map((g, i) => meal("p1", `2026-11-0${i + 1}`, [{ food: "rice", g }]));
  ms.push(meal("p2", "2026-11-09", [{ food: "rice", g: 90 }]));
  // last five for p1: 160, 400, 170, 180, 175 -> median 175
  assert.deepEqual(usual(ms, "p1", "rice"), { g: 175, n: 6 });
  assert.deepEqual(usual(ms, "p2", "rice"), { g: 90, n: 1 });
  // order follows date, not array order
  const shuffled = [meal("p1", "2026-11-05", [{ food: "rice", g: 200 }]), meal("p1", "2026-11-01", [{ food: "rice", g: 100 }])];
  assert.equal(usual(shuffled, "p1", "rice").g, 150);
});

test("plateOf uses learned grams only after enough weigh-ins and skips deleted foods", () => {
  const set = { id: "s", name: "Rice + fish", items: [{ food: "rice", g: 200 }, { food: "fish", g: 100 }, { food: "gone", g: 50 }] };
  const few = [meal("p1", "2026-11-01", [{ food: "rice", g: 150 }])];
  let rows = plateOf(set, [rice, fish], few, "p1");
  assert.equal(rows.length, 2);
  assert.deepEqual(rows.map((r) => [r.food, r.g, r.learned]), [["rice", 200, false], ["fish", 100, false]]);
  const many = Array.from({ length: LEARN_AFTER }, (_, i) => meal("p1", `2026-11-0${i + 1}`, [{ food: "rice", g: 160 }]));
  rows = plateOf(set, [rice, fish], many, "p1");
  assert.deepEqual(rows.map((r) => [r.food, r.g, r.learned]), [["rice", 160, true], ["fish", 100, false]]);
});

test("logItems copies the numbers and drops empty rows", () => {
  const out = logItems([{ food: "rice", name: "Rice", g: 150, per100: rice }, { food: "fish", name: "Fried fish", g: 0, per100: fish }]);
  assert.deepEqual(out, [{ food: "rice", name: "Rice", g: 150, kcal: 195, carb: 42, protein: 4.1, fat: 0.5 }]);
});

test("rankSets puts this person's most logged sets first", () => {
  const sets = [{ id: "a", name: "Apple" }, { id: "b", name: "Bread" }, { id: "c", name: "Curry" }];
  const ms = [meal("p1", "2026-11-01", [], 0, "c"), meal("p1", "2026-11-02", [], 0, "c"), meal("p1", "2026-11-03", [], 0, "b"), meal("p2", "2026-11-03", [], 0, "a")];
  assert.deepEqual(rankSets(sets, ms, "p1").map((s) => s.id), ["c", "b", "a"]);
});

test("readFood checks the typed numbers", () => {
  assert.deepEqual(readFood({ name: " Patin ", kcal: "220", carb: "2", protein: "18", fat: "" }), { food: { name: "Patin", kcal: 220, carb: 2, protein: 18, fat: 0 } });
  assert.ok(readFood({ name: "", kcal: 1 }).error);
  assert.ok(readFood({ name: "x", kcal: "" }).error);
  assert.ok(readFood({ name: "x", kcal: 1000 }).error);
  assert.ok(readFood({ name: "x", kcal: 100, carb: 60, protein: 30, fat: 20 }).error);
});

const man = { sex: "Male", cm: 172, age: 34 }, woman = { sex: "Female", cm: 160, age: 31 };

test("bmr follows Mifflin-St Jeor", () => {
  assert.equal(bmr(man, 80), 10 * 80 + 6.25 * 172 - 5 * 34 + 5);
  assert.equal(bmr(woman, 60), 10 * 60 + 6.25 * 160 - 5 * 31 - 161);
});

test("burnOf uses the watch number when typed, else an estimate plus the run", () => {
  assert.deepEqual(burnOf(man, 80, { measured: 2650 }), { kcal: 2650, measured: true });
  const est = burnOf(man, 80), run = burnOf(man, 80, { runKcal: 400 });
  assert.equal(est.measured, false);
  assert.equal(est.kcal, Math.round(bmr(man, 80) * 1.35 / 10) * 10);
  assert.equal(run.kcal - est.kcal, 400);
});

test("intakeRange aims below burn when overweight, around it when normal, above when under", () => {
  const over = intakeRange(man, 84, 2500), ok = intakeRange(man, 68, 2500), under = intakeRange(woman, 45, 1800);
  assert.equal(over.goal, "lose"); assert.ok(over.hi < 2500);
  assert.equal(ok.goal, "keep"); assert.ok(ok.lo < 2500 && ok.hi > 2500);
  assert.equal(under.goal, "gain"); assert.ok(under.lo > 1800);
  // never under the floor
  assert.equal(intakeRange(woman, 90, 1300).lo, 1200);
});

test("weightOn takes the last weigh-in on or before the day", () => {
  const es = [{ person: "p1", date: "2026-11-05", weight: 80 }, { person: "p1", date: "2026-11-01", weight: 82 }, { person: "p2", date: "2026-11-01", weight: 60 }, { person: "p1", date: "2026-11-03" }];
  assert.equal(weightOn(es, "p1", "2026-11-04"), 82);
  assert.equal(weightOn(es, "p1", "2026-11-09"), 80);
  assert.equal(weightOn(es, "p1", "2026-10-01"), 82);
  assert.equal(weightOn(es, "p3", "2026-11-01"), null);
});

test("verdict leaves unlogged days alone", () => {
  const r = { lo: 1800, hi: 2200 };
  assert.equal(verdict(0, r), "none");
  assert.equal(verdict(1500, r), "under");
  assert.equal(verdict(2000, r), "in");
  assert.equal(verdict(2500, r), "over");
});

test("fitsSlot offers a set only at its meals, or at any meal when none are set", () => {
  assert.equal(fitsSlot({ slots: ["lunch", "dinner"] }, "breakfast"), false);
  assert.equal(fitsSlot({ slots: ["lunch", "dinner"] }, "dinner"), true);
  assert.equal(fitsSlot({}, "breakfast"), true);
  assert.equal(fitsSlot({ slots: [] }, "snack"), true);
});

test("shadeOf grades a day against its range", () => {
  const r = { lo: 1600, hi: 2000 };
  assert.equal(shadeOf(0, r), "none");
  assert.equal(shadeOf(1100, r), "farunder");
  assert.equal(shadeOf(1500, r), "under");
  assert.equal(shadeOf(1800, r), "in");
  assert.equal(shadeOf(2300, r), "over");
  assert.equal(shadeOf(2500, r), "farover");
});

test("yearStats skips unlogged days, and they don't break a streak", () => {
  const d = (eaten, v) => ({ eaten, v });
  const s = yearStats([d(1800, "in"), d(0, "none"), d(1900, "in"), d(2500, "over"), d(1700, "in"), d(1750, "in"), d(1760, "in")]);
  assert.deepEqual(s, { logged: 6, inPct: 83, avg: Math.round((1800 + 1900 + 2500 + 1700 + 1750 + 1760) / 6), best: 3 });
  assert.deepEqual(yearStats([d(0, "none")]), { logged: 0, inPct: 0, avg: 0, best: 0 });
});
