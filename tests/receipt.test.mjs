// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { num, readDate, readReceipt, checkReceipt, nameKey, aliasId, matchLine, matchAll, buyQty, foldDiscounts, toBuys, newAliases, niceName, receiptList } from "../public/logic/receipt.js";
import { GOOD, BAD } from "./fixtures/receipt-gemini.mjs";

const pantry = [
  { id: "beras", name: "Beras", unit: "g", pack: 5000 },
  { id: "telur", name: "Telur", unit: "pcs", pack: 30 },
  { id: "susu", name: "Susu", unit: "ml", pack: 1000 },
  { id: "tisu", name: "Tisu", unit: "pcs", pack: 10 },
];

test("numbers however they're printed", () => {
  assert.equal(num("RM 4.50"), 4.5);
  assert.equal(num("4,50"), 4.5);
  assert.equal(num("1,234.00"), 1234);
  assert.equal(num("-1.00"), -1);
  assert.equal(num("1.00-"), -1);
  assert.equal(num("(2.00)"), -2);
  assert.equal(num(3), 3);
  assert.equal(num(""), null);
  assert.equal(num("abc"), null);
  assert.equal(num(null), null);
});

test("dates: ISO or day first", () => {
  assert.equal(readDate("2026-11-24"), "2026-11-24");
  assert.equal(readDate("24/11/2026"), "2026-11-24");
  assert.equal(readDate("4-1-26"), "2026-01-04");
  assert.equal(readDate("31/13/2026"), null);
  assert.equal(readDate("yesterday"), null);
});

test("readReceipt tidies Gemini's answer", () => {
  const { receipt, error } = readReceipt(GOOD, "2026-11-25");
  assert.equal(error, undefined);
  assert.equal(receipt.shop, "KEDAI RUNCIT CONTOH");
  assert.equal(receipt.date, "2026-11-24");
  assert.equal(receipt.lines.length, 5);
  assert.deepEqual(receipt.lines[3], { raw: "SUSU SEGAR 1L", qty: 2, unitPrice: 7.2, lineTotal: 14.4 });
  assert.equal(receipt.lines[2].lineTotal, -1);
  assert.equal(receipt.total, 59.3);
});

test("readReceipt takes JSON text, even fenced, and refuses junk", () => {
  assert.ok(readReceipt("```json\n" + JSON.stringify(GOOD) + "\n```", "2026-11-25").receipt);
  assert.ok(readReceipt("not json", "2026-11-25").error);
  assert.ok(readReceipt({ items: [] }, "2026-11-25").error);
  assert.ok(readReceipt({ items: [{ raw_name: "", line_total: 3 }] }, "2026-11-25").error);
});

test("readReceipt fills what's missing: qty from unit price, date from today", () => {
  const { receipt } = readReceipt({ store_name: "X", items: [{ raw_name: "A", unit_price: 2, line_total: 6 }, { raw_name: "B", line_total: "3.00" }], total: 9 }, "2026-11-25");
  assert.equal(receipt.lines[0].qty, 3);
  assert.equal(receipt.lines[1].qty, 1);
  assert.equal(receipt.date, "2026-11-25");
  assert.equal(receipt.discounts, 0);
});

test("checkReceipt: lines + discounts + rounding vs the total", () => {
  const good = checkReceipt(readReceipt(GOOD, "2026-11-25").receipt);
  assert.equal(good.ok, true);
  assert.equal(good.sum, 59.3);
  assert.equal(good.diff, 0);
  const bad = checkReceipt(readReceipt(BAD, "2026-11-25").receipt);
  assert.equal(bad.ok, false);
  assert.deepEqual(bad.badLines, [3]); // 2 × 7.20 isn't 41.40
  assert.equal(bad.diff, 27);
  // rounding and bill discounts count; within 5 sen is fine
  assert.equal(checkReceipt({ lines: [{ qty: 1, lineTotal: 10.02 }], discounts: -1, rounding: -0.02, total: 9 }).ok, true);
  assert.equal(checkReceipt({ lines: [{ qty: 1, lineTotal: 10.04 }], discounts: 0, rounding: 0, total: 10 }).ok, true);
  assert.equal(checkReceipt({ lines: [{ qty: 1, lineTotal: 10.1 }], discounts: 0, rounding: 0, total: 10 }).ok, false);
  assert.equal(checkReceipt({ lines: [{ qty: 1, lineTotal: 10 }], total: null }).ok, false); // no total: can't tell
});

test("names and alias ids ignore case, spaces and punctuation", () => {
  assert.equal(nameKey("GARDENIA  WHITE-400G"), "gardenia white 400g");
  assert.equal(aliasId("Lotus's", "SUSU SEGAR 1L"), "lotuss_susu-segar-1l");
  assert.equal(aliasId("", "Susu"), "any_susu");
  assert.ok(!aliasId("A/B", "x/y").includes("/"));
});

test("matchLine: an alias first, that shop's before any shop's", () => {
  const aliases = [
    { shop: "Other", raw: "SUSU SEGAR 1L", item: "tisu" },
    { shop: "Kedai Runcit Contoh", raw: "susu segar 1l", item: "susu" },
  ];
  assert.deepEqual(matchLine({ raw: "SUSU SEGAR 1L", lineTotal: 7 }, "KEDAI RUNCIT CONTOH", aliases, pantry), { item: "susu", match: "alias" });
  assert.deepEqual(matchLine({ raw: "SUSU SEGAR 1L", lineTotal: 7 }, "Elsewhere", aliases, pantry), { item: "tisu", match: "alias" });
  // an alias to a deleted item is ignored
  assert.deepEqual(matchLine({ raw: "X", lineTotal: 1 }, "", [{ shop: "", raw: "X", item: "gone" }], pantry), {});
});

test("matchLine suggests the item named on the line, or a close one", () => {
  assert.deepEqual(matchLine({ raw: "TELUR GRED A 30BIJI", lineTotal: 12 }, "", [], pantry), { item: "telur", match: "suggested" });
  assert.deepEqual(matchLine({ raw: "BERAS SAMPEL 5KG", lineTotal: 18 }, "", [], pantry), { item: "beras", match: "suggested" });
  assert.deepEqual(matchLine({ raw: "TISU MUKA", lineTotal: 1 }, "", [], [...pantry, { id: "tm", name: "Tisu muka" }]), { item: "tm", match: "suggested" }); // longest name wins
  assert.deepEqual(matchLine({ raw: "BAWANG MERAH", lineTotal: 3 }, "", [], pantry), {});
  assert.deepEqual(matchLine({ raw: "DISKAUN TELUR", lineTotal: -1 }, "", [], pantry), {}); // discounts never match
});

test("matchAll keeps lines picked by hand", () => {
  const lines = [{ raw: "TELUR", lineTotal: 12, item: "beras", match: "manual" }, { raw: "TELUR", lineTotal: 12, item: "beras", match: "suggested" }];
  const out = matchAll(lines, "", [], pantry);
  assert.equal(out[0].item, "beras");
  assert.equal(out[1].item, "telur");
});

test("buyQty: receipt packs × the item's usual pack", () => {
  assert.equal(buyQty(2, { pack: 1000 }), 2000);
  assert.equal(buyQty(1, { pack: 30 }), 30);
  assert.equal(buyQty(3, {}), 3);
  assert.equal(buyQty(0, { pack: 5 }), 5);
});

test("foldDiscounts: a discount lowers the line above it and marks a sale", () => {
  const out = foldDiscounts([{ raw: "A", lineTotal: 12.5 }, { raw: "DISC", lineTotal: -1 }, { raw: "B", lineTotal: 3 }]);
  assert.deepEqual(out, [{ raw: "A", lineTotal: 11.5, sale: true }, { raw: "B", lineTotal: 3 }]);
  assert.deepEqual(foldDiscounts([{ raw: "DISC", lineTotal: -1 }]), []);
});

test("toBuys: one buy per matched line, packs into the item's unit", () => {
  const { receipt } = readReceipt(GOOD, "2026-11-25");
  receipt.lines = matchAll(receipt.lines, receipt.shop, [], pantry);
  receipt.lines[4].skip = true; // tisu not wanted
  const buys = toBuys(receipt, pantry, "r1");
  assert.deepEqual(buys, [
    { item: "beras", date: "2026-11-24", qty: 5000, price: 18.9, shop: "KEDAI RUNCIT CONTOH", receipt: "r1" },
    { item: "telur", date: "2026-11-24", qty: 30, price: 11.5, shop: "KEDAI RUNCIT CONTOH", sale: true, receipt: "r1" },
    { item: "susu", date: "2026-11-24", qty: 2000, price: 14.4, shop: "KEDAI RUNCIT CONTOH", receipt: "r1" },
  ]);
  receipt.lines[3].amount = "1500"; // typed by hand: wins over packs
  assert.equal(toBuys(receipt, pantry, "r1")[2].qty, 1500);
});

test("newAliases: remember new or changed picks only", () => {
  const receipt = { shop: "Kedai", lines: [{ raw: "SUSU 1L", lineTotal: 7, item: "susu" }, { raw: "TELUR", lineTotal: 12, item: "telur" }, { raw: "X", lineTotal: 1 }, { raw: "DISC", lineTotal: -1, item: "susu" }] };
  const out = newAliases(receipt, [{ shop: "kedai", raw: "susu 1l", item: "susu" }]);
  assert.deepEqual(out, [{ id: "kedai_telur", shop: "Kedai", raw: "TELUR", item: "telur" }]);
});

test("niceName and receiptList", () => {
  assert.equal(niceName("BERAS SAMPEL 5KG"), "Beras sampel");
  assert.equal(niceName("TISU KOTAK 5X200"), "Tisu kotak");
  assert.equal(niceName("TELUR GRED A 30S"), "Telur gred a");
  assert.equal(niceName("500G"), "500g"); // nothing but a size: keep it
  const rs = [{ id: "a", date: "2026-11-01", status: "confirmed" }, { id: "b", date: "2026-11-20", status: "needs_review" }];
  assert.deepEqual(receiptList(rs).map((r) => r.id), ["b", "a"]);
  assert.deepEqual(receiptList(rs, "confirmed").map((r) => r.id), ["a"]);
});
