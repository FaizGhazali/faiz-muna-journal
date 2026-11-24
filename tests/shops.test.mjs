// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { shopId, sameShop, ledgerShopOf, namesOf, shopChoices, stockyAt, renames } from "../public/logic/shops.js";

const lotus = { id: "s1", key: "LOTUS'S STORES SDN BHD", name: "LOTUS'S STORES SDN BHD", nick: "Lotus's" };
const mydin = { id: "s2", key: "MYDIN MOHAMED", name: "MYDIN MOHAMED", nick: "" };

test("one shop however it's typed", () => {
  assert.equal(shopId(" Lotus's "), "lotuss");
  assert.ok(sameShop("LOTUS'S", "lotus's"));
  assert.ok(!sameShop("Lotus", "Lotus's"));
  assert.ok(!sameShop("", ""));
});

test("ledgerShopOf finds a shop by nick or statement name", () => {
  assert.equal(ledgerShopOf("lotus's", [lotus, mydin]), lotus);
  assert.equal(ledgerShopOf("Lotus's Stores Sdn Bhd", [lotus]), lotus);
  assert.equal(ledgerShopOf("mydin mohamed", [lotus, mydin]), mydin);
  assert.equal(ledgerShopOf("Giant", [lotus, mydin]), null);
  assert.equal(ledgerShopOf("", [lotus]), null);
});

test("namesOf gives nick and statement name", () => {
  assert.deepEqual(namesOf(lotus), ["Lotus's", "LOTUS'S STORES SDN BHD"]);
  assert.deepEqual(namesOf(mydin), ["MYDIN MOHAMED"]);
  assert.deepEqual(namesOf(null), []);
});

test("shopChoices puts named shops first and drops repeats", () => {
  assert.deepEqual(shopChoices([lotus, mydin], ["LOTUS'S", "Pasar", "pasar ", "Lotus's Stores Sdn Bhd"]), ["LOTUS'S STORES SDN BHD", "Pasar"]);
  assert.deepEqual(shopChoices([{ ...lotus, first: "nick" }], ["Lotus's Stores Sdn Bhd", "Pasar"]), ["Lotus's", "Pasar"]);
  assert.deepEqual(shopChoices([], ["Mydin"]), ["Mydin"]);
});

test("stockyAt sums what Stocky bought at a shop", () => {
  const pantry = [{ id: "rice", name: "Beras" }, { id: "egg", name: "Telur" }];
  const buys = [
    { item: "rice", date: "2026-11-01", shop: "Lotus's", price: 26 },
    { item: "egg", date: "2026-11-10", shop: "LOTUS'S STORES SDN BHD", price: 12.5 },
    { item: "egg", date: "2026-11-15", shop: "lotus's" },
    { item: "egg", date: "2026-11-12", shop: "Mydin", price: 11 },
    { item: "gone", date: "2026-11-16", shop: "Lotus's", price: 3 },
  ];
  const r = stockyAt(namesOf(lotus), buys, pantry);
  assert.equal(r.n, 4);
  assert.equal(r.spent, 41.5);
  assert.equal(r.last, "2026-11-16");
  assert.deepEqual(r.items.map((i) => [i.name, i.n]), [["Telur", 2], ["Beras", 1]]);
  assert.equal(stockyAt([], buys, pantry).n, 0);
});

test("renames follows a new nick", () => {
  const rows = [{ id: "a", shop: "Lotus's" }, { id: "b", shop: "LOTUS'S" }, { id: "c", shop: "Mydin" }];
  assert.deepEqual(renames("Lotus's", "Lotus Seri Kembangan", rows), [{ id: "a", shop: "Lotus Seri Kembangan" }, { id: "b", shop: "Lotus Seri Kembangan" }]);
  assert.deepEqual(renames("Lotus's", "lotus's", rows), []); // same shop, no change
  assert.deepEqual(renames("", "X", rows), []);
  assert.deepEqual(renames("Lotus's", "", rows), []); // clearing the nick keeps Stocky's names
});

test("shopLabel shows the first name, the other as a remark", async () => {
  const { shopLabel, whichFirst, firstUsed } = await import("../public/logic/shops.js");
  assert.deepEqual(shopLabel(lotus), { main: "LOTUS'S STORES SDN BHD", remark: "Lotus's", mainIsNick: false });
  assert.deepEqual(shopLabel({ ...lotus, first: "nick" }), { main: "Lotus's", remark: "LOTUS'S STORES SDN BHD", mainIsNick: true });
  assert.deepEqual(shopLabel(mydin), { main: "MYDIN MOHAMED", remark: "", mainIsNick: false });
  assert.deepEqual(shopLabel({ name: "SETEL", nick: "setel" }), { main: "SETEL", remark: "", mainIsNick: false });
  assert.deepEqual(shopLabel(null, "Kopi Pagi"), { main: "Kopi Pagi", remark: "", mainIsNick: false });
  assert.equal(whichFirst("2026-10-01", "2026-11-01"), "nick");
  assert.equal(whichFirst("2026-11-01", "2026-11-01"), "name");
  assert.equal(whichFirst(null, "2026-11-01"), "name");
  assert.equal(whichFirst("2026-11-01", null), "nick");
  assert.equal(firstUsed(["Lotus's"], [{ shop: "lotus's", date: "2026-11-02" }, { shop: "LOTUS'S", date: "2026-10-30" }, { shop: "Mydin", date: "2026-01-01" }]), "2026-10-30");
  assert.equal(firstUsed([], [{ shop: "x", date: "2026-01-01" }]), null);
});

test("ledgerShopNames lists every Ledger shop once, newest first, by its first name", async () => {
  const { ledgerShopNames } = await import("../public/logic/shops.js");
  const txns = [
    { merchant: "NakNak", date: "2026-11-20", type: "purchase", cat: "dining" },
    { merchant: "naknak ", date: "2026-11-01", type: "purchase", cat: "dining" },
    { merchant: "LOTUS'S STORES SDN BHD", date: "2026-11-10", type: "purchase", cat: "groceries" },
    { raw: "Card payment", date: "2026-11-22", type: "payment", cat: "payment" },
    { raw: "SETEL", date: "2026-11-21", type: "purchase", cat: "fuel" },
  ];
  assert.deepEqual(ledgerShopNames(txns, []), ["SETEL", "NakNak", "LOTUS'S STORES SDN BHD"]);
  assert.deepEqual(ledgerShopNames(txns, [{ ...lotus, first: "nick" }]), ["SETEL", "NakNak", "Lotus's"]);
  assert.deepEqual(ledgerShopNames([], []), []);
});
