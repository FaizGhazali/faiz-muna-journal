// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { QUOTES, quoteFor, moodMap, periods, boosters, yearGrid, lastSeven, mondayOf, moodMix, MIN_DAYS } from "../public/mood.js";

test("moodMap keeps one person's valid ratings only", () => {
  const map = moodMap([
    { person: "p1", date: "2026-11-01", mood: 4 },
    { person: "p1", date: "2026-11-02", mood: 7 },
    { person: "p1", date: "2026-11-03", weight: 70 },
    { person: "p2", date: "2026-11-01", mood: 2 },
  ], "p1");
  assert.deepEqual(map, { "2026-11-01": 4 });
});

test("quote stays the same all day and comes from the right level", () => {
  for (const v of [null, 1, 2, 3, 4, 5]) {
    const q = quoteFor(v, "2026-11-19", "p1");
    assert.equal(q, quoteFor(v, "2026-11-19", "p1"));
    assert.ok(QUOTES[v ?? 0].includes(q));
  }
  const days = new Set(Array.from({ length: 10 }, (_, i) => quoteFor(4, `2026-11-${10 + i}`, "p1")));
  assert.ok(days.size > 1, "quotes change from day to day");
});

test("week starts on Monday and the 7-day average covers seven days", () => {
  assert.equal(mondayOf("2026-11-19"), "2026-11-16"); // Thursday
  assert.equal(mondayOf("2026-11-16"), "2026-11-16");
  assert.equal(mondayOf("2026-11-22"), "2026-11-16"); // Sunday
  const map = { "2026-11-11": 1, "2026-11-12": 5, "2026-11-18": 3 };
  assert.equal(lastSeven(map, "2026-11-18"), 4); // 12th to 18th; the 11th is left out
  assert.equal(lastSeven({}, "2026-11-18"), null);
});

test("periods compare this week, month and year with the one before", () => {
  const map = {
    "2026-11-09": 2, "2026-11-10": 4, // last week: 3
    "2026-11-16": 4, "2026-11-18": 5, // this week: 4.5
    "2026-10-05": 3, // last month
    "2025-12-31": 1, // last year, not counted in this year
  };
  const P = periods(map, "2026-11-19");
  assert.equal(P.week.now, 4.5);
  assert.equal(P.week.before, 3);
  assert.equal(P.month.now, 3.75);
  assert.equal(P.month.before, 3);
  assert.equal(P.year.days, 5);
  assert.equal(P.year.good, 3 / 5);
  assert.equal(periods({}, "2026-11-19").week.now, null);
});

test("boosters need enough days on both sides and sort the biggest lift first", () => {
  const map = {}, facts = {};
  for (let i = 1; i <= 20; i++) {
    const d = `2026-10-${String(i).padStart(2, "0")}`;
    const ran = i % 2 === 0, weighed = i <= 18;
    map[d] = ran ? 5 : 3;
    facts[d] = { ran, weighed, habits: true };
  }
  const B = boosters(map, facts);
  assert.equal(B.days, 20);
  assert.deepEqual(B.rows.map((r) => r.key), ["ran"]); // weighed has only 2 "without" days; habits has none
  assert.equal(B.rows[0].with, 5);
  assert.equal(B.rows[0].without, 3);
  assert.ok(MIN_DAYS <= 20);
});

test("year grid has every day of each month and marks the future", () => {
  const g = yearGrid({ "2026-02-28": 4 }, 2026, "2026-11-19");
  assert.equal(g.length, 12);
  assert.deepEqual(g.map((m) => m.length), [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]);
  assert.equal(g[1][27].mood, 4);
  assert.equal(g[10][18].future, false); // 19 Nov
  assert.equal(g[10][19].future, true); // 20 Nov
  assert.equal(yearGrid({}, 2028, "2028-01-01")[1].length, 29);
});

test("moodMix week: counts each mood Monday to Sunday, nothing after today", () => {
  const map = { "2026-11-16": 4, "2026-11-17": 4, "2026-11-18": 2, "2026-11-15": 5, "2026-11-20": 1 };
  const c = moodMix(map, "week", "2026-11-19", "2026-11-19");
  assert.equal(c.from, "2026-11-16");
  assert.equal(c.to, "2026-11-22");
  assert.deepEqual(c.counts, [0, 0, 1, 0, 2, 0]);
  assert.equal(c.rated, 3);
  assert.equal(c.days, 4);
  assert.equal(c.avg, 10 / 3);
  assert.equal(c.prev, "2026-11-09");
  assert.equal(c.next, null);
  assert.equal(moodMix(map, "week", c.prev, "2026-11-19").next, "2026-11-16");
});

test("moodMix month and year", () => {
  const map = { "2026-02-03": 3, "2026-02-28": 3, "2026-03-01": 5, "2025-12-31": 1 };
  const m = moodMix(map, "month", "2026-02-15", "2026-11-19");
  assert.deepEqual(m.counts, [0, 0, 0, 2, 0, 0]);
  assert.equal(m.days, 28);
  assert.equal(m.prev, "2026-01-01");
  assert.equal(m.next, "2026-03-01");
  const y = moodMix(map, "year", "2026-06-01", "2026-11-19");
  assert.deepEqual(y.counts, [0, 0, 0, 2, 0, 1]);
  assert.equal(y.next, null);
  assert.equal(y.prev, "2025-01-01");
});

test("moodMix pct: share of rated days, whole numbers that add up to 100", () => {
  const map = { "2026-11-16": 4, "2026-11-17": 4, "2026-11-18": 2 };
  const c = moodMix(map, "week", "2026-11-19", "2026-11-19");
  assert.deepEqual(c.pct, [0, 0, 33, 0, 67, 0]);
  assert.deepEqual(moodMix({}, "week", "2026-11-19", "2026-11-19").pct, [0, 0, 0, 0, 0, 0]);
  const three = moodMix({ "2026-11-16": 1, "2026-11-17": 3, "2026-11-18": 5 }, "week", "2026-11-19", "2026-11-19");
  assert.equal(three.pct.reduce((s, n) => s + n, 0), 100);
});
