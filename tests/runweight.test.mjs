// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { pairRunsWithWeight, runsWithWeight, weightBands, bandWidth, linearRegression, median, similarEffort, usualHr, runEntries, ageOn, ageText } from "../public/logic/runweight.js";

const run = (person, date, pace, hr, extra = {}) => ({ person, date, run: { source: "coros", km: 5, secs: pace * 5, pace, hr }, ...extra });
const weigh = (person, date, weight) => ({ person, date, weight });

test("age on a run date counts completed years and months", () => {
  assert.deepEqual(ageOn("1990-03-15", "2026-03-15"), { years: 36, months: 0 });
  assert.deepEqual(ageOn("1990-03-15", "2026-03-14"), { years: 35, months: 11 });
  assert.deepEqual(ageOn("1990-01-31", "2026-10-12"), { years: 36, months: 8 });
  assert.equal(ageText(ageOn("1990-12-01", "2026-08-18")), "35y 8m");
  assert.equal(ageOn("", "2026-08-18"), null);
  assert.equal(ageOn("2027-01-01", "2026-08-18"), null);
});

test("two runs with weight give two points and no trend line", () => {
  const entries = [
    run("p1", "2026-08-18", 480, 152, { weight: 64.2 }),
    run("p1", "2026-10-12", 540, 144),
    weigh("p1", "2026-10-12", 66.5),
  ];
  const pairs = pairRunsWithWeight(entries, "p1");
  assert.deepEqual(pairs, [
    { date: "2026-08-18", paceSec: 480, weightKg: 64.2, hr: 152, km: 5, note: "", weightDate: "2026-08-18", gapDays: 0 },
    { date: "2026-10-12", paceSec: 540, weightKg: 66.5, hr: 144, km: 5, note: "", weightDate: "2026-10-12", gapDays: 0 },
  ]);
  const fit = linearRegression(pairs.map((p) => ({ x: p.weightKg, y: p.paceSec })));
  assert.equal(fit.n, 2);
  assert.equal(fit.slope, null);
  assert.equal(fit.intercept, null);
});

test("same-day weight in the same entry wins over a nearer-looking one", () => {
  const pairs = pairRunsWithWeight([run("p1", "2026-09-10", 480, 150, { weight: 80 }), weigh("p1", "2026-09-11", 79)], "p1");
  assert.equal(pairs[0].weightKg, 80);
  assert.equal(pairs[0].gapDays, 0);
});

test("nearest weigh-in within 7 days is used, with the gap in days", () => {
  const pairs = pairRunsWithWeight([
    run("p1", "2026-09-10", 480, 150),
    weigh("p1", "2026-09-01", 82),  // 9 days before: too far
    weigh("p1", "2026-09-05", 81),  // 5 days before
    weigh("p1", "2026-09-13", 80),  // 3 days after: nearest
  ], "p1");
  assert.equal(pairs.length, 1);
  assert.equal(pairs[0].weightKg, 80);
  assert.equal(pairs[0].weightDate, "2026-09-13");
  assert.equal(pairs[0].gapDays, 3);
});

test("a tie between two weigh-ins goes to the earlier date", () => {
  const pairs = pairRunsWithWeight([run("p1", "2026-09-10", 480, 150), weigh("p1", "2026-09-12", 79), weigh("p1", "2026-09-08", 81)], "p1");
  assert.equal(pairs[0].weightDate, "2026-09-08");
  assert.equal(pairs[0].weightKg, 81);
});

test("a run with no weigh-in within 7 days is left out", () => {
  const entries = [run("p1", "2026-09-10", 480, 150), weigh("p1", "2026-09-02", 81), weigh("p1", "2026-09-18", 80)];
  assert.deepEqual(pairRunsWithWeight(entries, "p1"), []);
  assert.equal(pairRunsWithWeight(entries, "p1", 8).length, 1); // exactly 8 days counts with an 8-day limit
  assert.equal(runEntries(entries, "p1").length, 1);
});

test("only the chosen person's runs and weights are used", () => {
  const entries = [run("p1", "2026-09-10", 480, 150), weigh("p2", "2026-09-10", 60), run("p2", "2026-09-11", 600, 140)];
  assert.deepEqual(pairRunsWithWeight(entries, "p1"), []);
  const p2 = pairRunsWithWeight(entries, "p2");
  assert.equal(p2.length, 1);
  assert.equal(p2[0].gapDays, 1);
});

test("accepts the backup file's { id: entry } map and runs without a stored pace", () => {
  const map = { "p1_2026-09-10": { person: "p1", date: "2026-09-10", weight: 80, note: "Hot", run: { km: 5, secs: 2500, hr: 150 } } };
  const [p] = pairRunsWithWeight(map, "p1");
  assert.equal(p.paceSec, 500);
  assert.equal(p.note, "Hot");
});

test("person with no runs gives no points", () => {
  assert.deepEqual(pairRunsWithWeight([weigh("p2", "2026-09-10", 60)], "p2"), []);
  assert.deepEqual(pairRunsWithWeight([], "p1"), []);
});

test("regression finds an exact line", () => {
  const fit = linearRegression([{ x: 70, y: 400 }, { x: 75, y: 420 }, { x: 80, y: 440 }]);
  assert.equal(fit.n, 3);
  assert.ok(Math.abs(fit.slope - 4) < 1e-9);
  assert.ok(Math.abs(fit.intercept - 120) < 1e-9);
  assert.ok(Math.abs(fit.r2 - 1) < 1e-9);
});

test("regression on noisy data matches least squares", () => {
  // x: 1..5, y: 2,4,5,4,5 → slope 0.6, intercept 2.2, R² 0.6
  const fit = linearRegression([[1, 2], [2, 4], [3, 5], [4, 4], [5, 5]].map(([x, y]) => ({ x, y })));
  assert.ok(Math.abs(fit.slope - 0.6) < 1e-9);
  assert.ok(Math.abs(fit.intercept - 2.2) < 1e-9);
  assert.ok(Math.abs(fit.r2 - 0.6) < 1e-9);
});

test("regression gives no line for fewer than 3 points or one weight only", () => {
  assert.equal(linearRegression([]).slope, null);
  assert.equal(linearRegression([{ x: 1, y: 1 }, { x: 2, y: 2 }]).slope, null);
  const same = linearRegression([{ x: 80, y: 500 }, { x: 80, y: 520 }, { x: 80, y: 510 }]);
  assert.equal(same.slope, null);
  assert.equal(same.n, 3);
});

test("similar effort keeps runs within 5 bpm of the usual heart rate that month", () => {
  assert.equal(median([140, 146, 150, 154, 160]), 150);
  assert.equal(median([1, 2, 3, 10]), 2.5);
  const runs = [140, 146, 150, 154, 160].map((hr, i) => ({ date: `2026-03-0${i + 1}`, hr }));
  assert.deepEqual(similarEffort(runs, runs).map((p) => p.hr), [146, 150, 154]);
  assert.deepEqual(similarEffort(runs, []), []);
  assert.deepEqual(similarEffort([{ date: "2026-03-01", hr: null }], runs), []);
});

test("similar effort follows a heart rate that drops as fitness improves", () => {
  // Same easy runs, but the heart rate falls from ~160 to ~130 over six months.
  const runs = [];
  for (let m = 1; m <= 6; m++) for (const d of [5, 15, 25]) runs.push({ date: `2026-0${m}-${d}`, hr: 166 - m * 6 });
  runs.push({ date: "2026-03-16", hr: 175 }); // one hard session
  // An all-time middle value (~148) would drop the first and last months; a monthly one keeps every easy run.
  const kept = similarEffort(runs, runs);
  assert.equal(kept.length, 18);
  assert.ok(!kept.some((r) => r.hr === 175));
  assert.equal(usualHr(runs, "2026-01-15"), 160);
  assert.equal(usualHr(runs, "2026-06-15"), 130);
});

test("runsWithWeight keeps runs with no weight nearby, with null weight", () => {
  const all = runsWithWeight([run("p1", "2026-09-10", 480, 150), run("p1", "2026-09-20", 470, 150, { weight: 80 })], "p1");
  assert.equal(all.length, 2);
  assert.equal(all[0].weightKg, null);
  assert.equal(all[0].gapDays, null);
  assert.equal(all[1].weightKg, 80);
});

test("weight bands average the distance and keep empty bands in between", () => {
  const pts = [
    { date: "2026-03-01", weightKg: 64.2, km: 5 },
    { date: "2026-03-08", weightKg: 64.9, km: 7 },
    { date: "2026-04-01", weightKg: 66.0, km: 3 },
  ];
  const b = weightBands(pts, 1);
  assert.deepEqual(b.map((x) => [x.lo, x.hi, x.n, x.avgKm, x.maxKm]), [[64, 65, 2, 6, 7], [65, 66, 0, null, null], [66, 67, 1, 3, 3]]);
  assert.equal(b[0].from, "2026-03-01");
  assert.equal(b[0].to, "2026-03-08");
  assert.deepEqual(weightBands([], 1), []);
  assert.deepEqual(weightBands([{ date: "2026-03-01", weightKg: 64, km: null }], 1), []);
});

test("band width keeps the bars to about ten", () => {
  assert.equal(bandWidth([64, 66]), 0.5);
  assert.equal(bandWidth([64, 70]), 1);
  assert.equal(bandWidth([60, 78]), 2);
  assert.equal(bandWidth([]), 1);
});
