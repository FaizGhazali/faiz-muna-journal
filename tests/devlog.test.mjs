import { test } from "node:test";
import assert from "node:assert/strict";
import { readCommit, modulesOf, kindOf, wheel, calendar, weeksFor, levelOf, kindLine } from "../public/logic/devlog.js";

const c = (subject, files = ["public/app.js"], body = "", at = "2026-11-20T21:15:00+08:00") => readCommit({ sha: "abcdef123", at, subject, body, files });

test("kindOf tells fixes, new features and improvements apart", () => {
  assert.equal(kindOf("Ledger: fix a Recent item right in its row"), "fix");
  assert.equal(kindOf("Dearly: don't repeat notes"), "fix");
  assert.equal(kindOf("Add Ledger money plan"), "feature");
  assert.equal(kindOf("Stocky: groceries journal with run-out estimates"), "feature");
  assert.equal(kindOf("Every delete in the journal now asks first"), "improve");
  assert.equal(kindOf("Ledger: tap a bucket to see what it went on"), "improve");
});

test("modulesOf: trailer, then summary words, then files", () => {
  assert.deepEqual(modulesOf("Mood + Dearly: diary moods set the day"), ["weight", "diary"]);
  assert.deepEqual(modulesOf("Tidy things", ["public/features/stocky/stockyui.js"]), ["stocky"]);
  assert.deepEqual(modulesOf("Ledger: x", [], "Body\n\nModule: meals, stocky"), ["meals", "stocky"]);
  // Files across three or more modules are app-wide work, counted for none.
  assert.deepEqual(modulesOf("Sort files", ["public/features/meals/mealsui.js", "public/features/diary/read.js", "public/features/ledger/plan.js"]), []);
  // "run-out" is not a run.
  assert.deepEqual(modulesOf("Stocky: guesses the run-out date"), ["stocky"]);
});

test("readCommit skips docs-only, app-wide, trivial and Dev: skip commits", () => {
  assert.equal(c("Docs: install the widget", ["docs/android.md"]), null);
  assert.equal(c("A cozy new look", ["public/styles.css"]), null);
  assert.equal(c("Ledger: fix typo"), null);
  assert.equal(c("Ledger: rename a variable", ["public/features/ledger/plan.js"], "Dev: skip"), null);
  assert.deepEqual(c("Ledger: give a shop your own name", ["public/features/ledger/spend.js"]),
    { sha: "abcdef1", at: "2026-11-20T21:15:00+08:00", date: "2026-11-20", modules: ["ledger"], kind: "improve", what: "Ledger: give a shop your own name" });
});

const log = {
  since: "2026-11-16",
  items: [
    { date: "2026-11-16", modules: ["weight"], kind: "feature" },
    { date: "2026-11-20", modules: ["diary"], kind: "improve" },
    { date: "2026-11-20", modules: ["diary"], kind: "fix" },
    { date: "2026-11-20", modules: ["weight", "diary"], kind: "improve" },
  ],
};

test("wheel totals each module over its lifetime", () => {
  const w = Object.fromEntries(wheel(log).map((m) => [m.id, m]));
  assert.equal(w.diary.updates, 3);
  assert.equal(w.diary.points, 5);
  assert.equal(w.diary.days, 1);
  assert.equal(w.weight.updates, 2);
  assert.equal(w.weight.days, 2);
  assert.equal(w.weight.first, "2026-11-16");
  assert.equal(w.weight.last, "2026-11-20");
  assert.equal(w.ledger.updates, 0);
  assert.equal(kindLine(w.diary), "2 improvements, 1 fix");
  assert.equal(wheel(null).every((m) => m.updates === 0), true);
});

test("calendar groups a day's updates and keeps unknown apart from zero", () => {
  const weeks = calendar(log, "2026-11-24", 3);
  assert.equal(weeks.length, 3);
  assert.equal(weeks[0][0].date, "2026-11-09"); // Monday two weeks before this one
  const day = (d) => weeks.flat().find((x) => x.date === d);
  assert.equal(day("2026-11-15").state, "unknown");
  assert.equal(day("2026-11-17").state, "tracked");
  assert.equal(day("2026-11-17").count, 0);
  assert.equal(day("2026-11-17").level, 0);
  assert.equal(day("2026-11-25").state, "future");
  const d20 = day("2026-11-20");
  assert.equal(d20.count, 3);
  assert.deepEqual(d20.modules.map((m) => [m.id, m.n]), [["weight", 1], ["diary", 3]]);
  assert.equal(d20.level, 4); // the busiest day
  assert.equal(day("2026-11-16").level, levelOf(3, 5));
  // No log at all: every past day is unknown, never zero.
  assert.equal(calendar(null, "2026-11-24", 1).flat().filter((d) => d.state === "tracked").length, 0);
});

test("weeksFor reaches back to the first record within limits", () => {
  assert.equal(weeksFor(log, "2026-11-24"), 17);
  assert.equal(weeksFor({ since: "2024-01-01", items: [] }, "2026-11-24"), 53);
  assert.equal(levelOf(0, 10), 0);
  assert.equal(levelOf(1, 10), 1);
  assert.equal(levelOf(6, 10), 3);
  assert.equal(levelOf(10, 10), 4);
});
