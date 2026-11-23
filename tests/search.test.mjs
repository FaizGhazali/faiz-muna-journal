// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { searchKey, findByName } from "../public/logic/search.js";

const items = ["Ayam", "Bawang Merah", "Bawang Putih", "Beras", "Minyak masak", "Sabun pinggan", "Café latte"].map((name, i) => ({ id: String(i), name }));
const names = (r) => r.map((x) => x.name);

test("searchKey ignores case, accents and extra spaces", () => {
  assert.equal(searchKey("  Café-Latte  "), "cafe latte");
  assert.equal(searchKey(null), "");
});

test("an empty search keeps everything", () => {
  assert.deepEqual(findByName(items, "  ").hits, items);
});

test("every word must be in the name, in any order", () => {
  assert.deepEqual(names(findByName(items, "putih bawang").hits), ["Bawang Putih"]);
  assert.deepEqual(names(findByName(items, "BAWANG").hits), ["Bawang Merah", "Bawang Putih"]);
  assert.deepEqual(names(findByName(items, "cafe").hits), ["Café latte"]);
});

test("names starting with it come first, then a word starting with it, then anywhere", () => {
  const r = findByName([{ name: "Kicap masin" }, { name: "Garam" }, { name: "Masin ikan" }], "masin");
  assert.deepEqual(names(r.hits), ["Masin ikan", "Kicap masin"]);
  assert.deepEqual(names(findByName(items, "a").hits).slice(0, 1), ["Ayam"]);
});

test("Did you mean, only when nothing matches", () => {
  assert.deepEqual(names(findByName(items, "ayma").close), ["Ayam"]);
  assert.deepEqual(names(findByName(items, "bwg").close), ["Bawang Merah", "Bawang Putih"]);
  assert.deepEqual(findByName(items, "ayam").close, []);
  assert.deepEqual(findByName(items, "zzzz"), { hits: [], close: [] });
});
