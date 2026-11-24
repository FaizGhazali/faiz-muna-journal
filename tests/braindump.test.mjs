// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { splitDump, dumpDoc, pageName, TITLE_MAX, DEFAULT_KIND } from "../public/logic/braindump.js";

test("splitDump: first line is the title, the rest the note", () => {
  assert.deepEqual(splitDump("  Save jumps\nwhen the keyboard opens  "), { title: "Save jumps", note: "when the keyboard opens" });
  assert.deepEqual(splitDump("just one line"), { title: "just one line", note: "" });
  assert.deepEqual(splitDump("   \n "), { title: "", note: "" });
});

test("splitDump: a long first line is cut at a word and carries on in the note", () => {
  const long = "word ".repeat(40).trim();
  const { title, note } = splitDump(long + "\nmore");
  assert.ok(title.length <= TITLE_MAX);
  assert.ok(title.endsWith("…"));
  assert.ok(!title.slice(0, -1).endsWith(" "));
  assert.ok(note.startsWith("word") && note.endsWith("\nmore"));
  assert.equal((title.slice(0, -1) + " " + note.split("\n")[0]).split(" ").length, 40);
});

test("dumpDoc: an inbox task tagged with its kind and page", () => {
  const d = dumpDoc({ text: "Fix ring colours\nin dark mode", kind: "bug", owner: "p1", from: "#ledger/spend/fun", day: "2026-11-24", now: 5 });
  assert.deepEqual(d, { owner: "p1", title: "Fix ring colours", type: "task", status: "inbox", dump: "bug", created: "2026-11-24", updated: 5, note: "in dark mode", from: "#ledger/spend/fun" });
});

test("dumpDoc: nothing typed or nobody signed in saves nothing; an unknown kind is an idea; no undefined fields", () => {
  assert.equal(dumpDoc({ text: "  ", kind: "bug", owner: "p1", day: "2026-11-24", now: 1 }), null);
  assert.equal(dumpDoc({ text: "x", kind: "bug", owner: null, day: "2026-11-24", now: 1 }), null);
  const d = dumpDoc({ text: "x", kind: "nope", owner: "p2", day: "2026-11-24", now: 1 });
  assert.equal(d.dump, DEFAULT_KIND);
  assert.ok(!("note" in d) && !("from" in d));
  assert.ok(Object.values(d).every((v) => v !== undefined));
});

test("pageName: the journal a hash belongs to", () => {
  assert.equal(pageName("#ledger/spend/fun"), "Ledger");
  assert.equal(pageName("#diary"), "Dearly");
  assert.equal(pageName("#home"), "Weight");
  assert.equal(pageName(""), "");
  assert.equal(pageName("#whatever"), "");
});
