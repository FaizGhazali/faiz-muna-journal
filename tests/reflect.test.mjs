// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { reflections, pickReflection } from "../public/reflect.js";
import { addDays } from "../public/suggest.js";

const T = "2026-11-20";
const e = (id, date, mood, extra = {}) => ({ id, person: "p1", date, mood, body: `Dear Diary,\n\nEntry ${id}.`, tags: [], created: 1, ...extra });

test("nothing yet gives one gentle empty card", () => {
  const c = reflections({ today: T });
  assert.equal(c.length, 1);
  assert.equal(c[0].kind, "empty");
});

test("a hard yesterday brings back a great day they wrote about, first", () => {
  const map = { [addDays(T, -1)]: 1, "2026-10-02": 5, "2026-11-05": 5 };
  const diary = [e("a", "2026-10-02", 5, { title: "Lake day" })];
  const c = reflections({ map, diary, today: T });
  assert.equal(c[0].kind, "comfort");
  assert.equal(c[0].entry, "a", "prefers the great day with a diary entry");
  assert.match(c[0].text, /Lake day/);
  assert.equal(pickReflection(c, T, "p1"), c[0], "comfort always leads");
});

test("on this day, a week ago, bright spot, tags and streak", () => {
  const diary = [
    e("y", "2025-11-20", 4), e("w", addDays(T, -7), 3),
    e("g1", addDays(T, -2), 5, { tags: ["family"] }), e("g2", addDays(T, -1), 4, { tags: ["family"] }), e("t", T, 4),
  ];
  const map = { [addDays(T, -2)]: 5, [addDays(T, -1)]: 4, [T]: 4, [addDays(T, -7)]: 3 };
  const kinds = reflections({ map, diary, today: T }).map((c) => c.key);
  for (const k of ["otd-y", "ago7-w", `bright-${addDays(T, -2)}`, "tag-family", "streak"]) assert.ok(kinds.includes(k), k);
});

test("deleted and future entries are left out", () => {
  const diary = [e("x", "2025-11-20", 4, { deleted: 5 }), e("f", addDays(T, 3), 4)];
  assert.equal(reflections({ diary, today: T })[0].kind, "empty");
});

test("pick changes with Another and stays put for the day", () => {
  const cards = [1, 2, 3, 4].map((i) => ({ key: `k${i}`, score: 50 - i }));
  const a = pickReflection(cards, T, "p1"), b = pickReflection(cards, T, "p1", 1);
  assert.equal(a, pickReflection(cards, T, "p1"));
  assert.notEqual(a, b);
  assert.equal(pickReflection([], T), null);
});
