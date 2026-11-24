import test from "node:test";
import assert from "node:assert/strict";
import { allowed, sizeOf, resolve, move, resize, merge, spans, clean, asDefaults } from "../public/logic/board.js";

const defaults = [{ id: "add", size: "m" }, { id: "recent", size: "m" }, { id: "sum", size: "s" }, { id: "card:*", size: "s" }, { id: "people", size: "l" }];
const sizes = { people: "l", "card:*": "sml" };

test("allowed sizes default to all three, wildcards match", () => {
  assert.deepEqual(allowed(sizes, "add"), ["s", "m", "l"]);
  assert.deepEqual(allowed(sizes, "people"), ["l"]);
  assert.deepEqual(allowed({ "card:*": "ml" }, "card:abc"), ["m", "l"]);
});

test("sizeOf: saved, then default, then the largest allowed", () => {
  assert.equal(sizeOf("add", { defaults }), "m");
  assert.equal(sizeOf("add", { defaults, saved: [{ id: "add", size: "s" }] }), "s");
  assert.equal(sizeOf("card:x", { defaults, sizes }), "s");
  assert.equal(sizeOf("people", { defaults, sizes, saved: [{ id: "people", size: "s" }] }), "l");
  assert.equal(sizeOf("trends", { defaults }), "l");
});

test("resolve follows the defaults the first time", () => {
  const r = resolve(["people", "card:b", "sum", "card:a", "recent", "add"], { defaults, sizes });
  assert.deepEqual(r.map((x) => x.id), ["add", "recent", "sum", "card:b", "card:a", "people"]);
});

test("resolve keeps the saved order and slots a new card in after its neighbour", () => {
  const saved = [{ id: "sum", size: "l" }, { id: "add", size: "s" }, { id: "card:a", size: "m" }, { id: "recent", size: "m" }];
  const r = resolve(["add", "recent", "sum", "card:a", "card:b", "people"], { defaults, saved, sizes });
  assert.deepEqual(r.map((x) => x.id), ["sum", "add", "card:a", "card:b", "recent", "people"]);
  assert.equal(r[0].size, "l");
  assert.equal(r[3].size, "s");
});

test("resolve drops cards that aren't there and never repeats", () => {
  const saved = [{ id: "gone", size: "s" }, { id: "add", size: "m" }, { id: "add", size: "s" }];
  assert.deepEqual(resolve(["add"], { defaults, saved }).map((x) => x.id), ["add"]);
});

test("move and resize", () => {
  const l = [{ id: "a", size: "s" }, { id: "b", size: "m" }, { id: "c", size: "l" }];
  assert.deepEqual(move(l, "b", -1).map((x) => x.id), ["b", "a", "c"]);
  assert.deepEqual(move(l, "a", -1), l);
  assert.deepEqual(move(l, "c", 1), l);
  assert.equal(resize(l, "a", "l")[0].size, "l");
});

test("merge keeps cards that aren't on the page", () => {
  assert.deepEqual(merge([{ id: "x", size: "s" }, { id: "a", size: "s" }], [{ id: "a", size: "l" }]), [{ id: "a", size: "l" }, { id: "x", size: "s" }]);
});

test("spans fill every row", () => {
  assert.deepEqual(spans(["m", "m", "s", "s", "s", "s"], 2), [2, 2, 1, 1, 1, 1]);
  assert.deepEqual(spans(["s", "m", "s"], 2), [2, 2, 2]);
  assert.deepEqual(spans(["s", "s", "s"], 2), [1, 1, 2]);
  assert.deepEqual(spans(["m", "s", "s", "l"], 4), [2, 1, 1, 4]);
  assert.deepEqual(spans(["s", "m", "l"], 4), [1, 3, 4]);
  assert.deepEqual(spans([], 2), []);
});

test("clean keeps only good entries", () => {
  assert.deepEqual(clean([{ id: "a", size: "s", x: 1 }, { id: "a", size: "m" }, { id: "b", size: "xl" }, null, { id: 3, size: "s" }]), [{ id: "a", size: "s" }]);
  assert.deepEqual(clean("nope"), []);
});

test("asDefaults folds each card into one slot", () => {
  const mine = [{ id: "sum", size: "m" }, { id: "card:x", size: "s" }, { id: "add", size: "s" }, { id: "card:y", size: "l" }];
  assert.deepEqual(asDefaults(mine), [{ id: "sum", size: "m" }, { id: "card:*", size: "s" }, { id: "add", size: "s" }]);
  // and a new card on another phone lands in that slot
  assert.deepEqual(resolve(["add", "card:z", "sum"], { defaults: asDefaults(mine) }).map((x) => x.id), ["sum", "card:z", "add"]);
});
