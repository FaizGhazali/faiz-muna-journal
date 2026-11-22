// The backup must include every collection the app saves to, so nothing is left out when a journal is added.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";

const dir = new URL("../public/", import.meta.url);
const src = readFileSync(new URL("backup.js", dir), "utf8");
const list = (name) => JSON.parse(src.match(new RegExp(`export const ${name} = (\\[[^\\]]*\\])`))[1]);

test("every collection the app uses is backed up or skipped on purpose", () => {
  const used = new Set();
  for (const f of readdirSync(dir).filter((f) => f.endsWith(".js") && !["memdb.js", "fs.js", "sample.js"].includes(f))) {
    const code = readFileSync(new URL(f, dir), "utf8");
    for (const m of code.matchAll(/(?:collection|doc)\((?:opts\.)?db, "([A-Za-z]+)"/g)) used.add(m[1]);
    for (const m of code.matchAll(/for \(const c of (\[[^\]]*\])\) cols\[c\] = collection/g)) JSON.parse(m[1]).forEach((c) => used.add(c));
  }
  const covered = new Set([...list("COLS"), ...list("COLS_SKIPPED")]);
  const missing = [...used].filter((c) => !covered.has(c));
  assert.deepEqual(missing, []);
  for (const c of ["pantry", "buys", "prices", "shopList", "kinds", "meals", "diary", "diaryPhotos"]) assert.ok(list("COLS").includes(c), c);
});
