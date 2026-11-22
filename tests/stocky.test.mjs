// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { buyRate, mealUse, estimate, lowItems, priceBoard, vsUsual, usualPrice, setCost, shopNames, shopTotals, saleOn, planNeeds, shortfall, readItem, readPrice, amount, money, allKinds, kindOf, readKind, matchKind, kindsLike, shelves } from "../public/logic/stocky.js";

const T = "2026-11-22";
const rice = { id: "rice", name: "Beras", kind: "food", unit: "g", pack: 5000, food: "f-nasi" };
const buy = (date, qty, extra = {}) => ({ item: "rice", date, qty, at: 0, ...extra });
const meal = (date, g, food = "f-nasi") => ({ person: "p1", date, items: [{ food, g }] });

test("buyRate needs two buy days", () => {
  assert.equal(buyRate([]), null);
  assert.equal(buyRate([buy("2026-11-01", 5000)]), null);
  assert.equal(buyRate([buy("2026-11-01", 5000), buy("2026-11-01", 5000)]), null); // same day
  // 5 kg used over 20 days = 250 g a day
  assert.equal(buyRate([buy("2026-11-01", 5000), buy("2026-11-21", 5000)]), 250);
  // two buys the same day add up
  assert.equal(buyRate([buy("2026-11-01", 2500), buy("2026-11-01", 2500), buy("2026-11-11", 5000)]), 500);
});

test("mealUse adds grams of that food on days in range", () => {
  const ms = [meal("2026-11-20", 200), meal("2026-11-21", 150), meal("2026-11-21", 99, "other"), meal("2026-11-10", 500)];
  assert.equal(mealUse(ms, "f-nasi", "2026-11-20", "2026-11-22"), 350);
  assert.equal(mealUse(ms, undefined, "2026-11-01", T), 0);
});

test("estimate from the buying pattern", () => {
  const buys = [buy("2026-10-22", 5000), buy("2026-11-11", 5000)]; // 250 g a day
  const e = estimate(rice, buys, [], T); // 11 days since the last buy
  assert.equal(e.left, 5000 - 250 * 11);
  assert.equal(e.daysLeft, 9);
  assert.equal(e.outOn, "2026-12-01");
  assert.equal(e.status, "ok");
});

test("meals can bring the date forward but never push it back", () => {
  const buys = [buy("2026-10-22", 5000), buy("2026-11-11", 5000)];
  const lots = [meal("2026-11-15", 2000), meal("2026-11-20", 1500)];
  const e = estimate(rice, buys, lots, T);
  assert.equal(e.left, 5000 - 3500); // meals used more than the pace says
  assert.ok(e.why.some((w) => w.includes("Meals logged")));
  const few = [meal("2026-11-15", 100)];
  assert.equal(estimate(rice, buys, few, T).left, 5000 - 250 * 11); // fewer meals: the pace still counts
});

test("a check resets what's left", () => {
  const buys = [buy("2026-10-22", 5000), buy("2026-11-11", 5000)];
  const e = estimate({ ...rice, check: { date: "2026-11-21", at: 0, level: 0.25 } }, buys, [], T);
  assert.equal(e.left, 1250 - 250);
  assert.equal(e.status, "low"); // under a quarter of a pack
  const out = estimate({ ...rice, check: { date: T, at: 0, level: 0 } }, buys, [], T);
  assert.equal(out.status, "out");
});

test("status steps: unknown, soon, low", () => {
  assert.equal(estimate(rice, [], [], T).status, "unknown");
  const once = estimate({ ...rice, food: undefined }, [buy("2026-11-20", 5000)], [], T);
  assert.equal(once.daysLeft, null);
  assert.equal(once.status, "ok"); // full pack, pace not known yet
  const soon = estimate(rice, [buy("2026-10-19", 5000), buy("2026-11-08", 5000)], [], T); // 14 days in, 6 left
  assert.equal(soon.status, "soon");
  const low = estimate(rice, [buy("2026-10-15", 5000), buy("2026-11-04", 5000)], [], T); // 2 days left
  assert.equal(low.status, "low");
});

test("pieces linked to a food use grams per piece", () => {
  const eggs = { id: "egg", name: "Telur", kind: "food", unit: "pcs", pack: 30, food: "f-telur", each: 50 };
  const e = estimate(eggs, [{ item: "egg", date: "2026-11-20", qty: 30 }], [meal("2026-11-21", 500, "f-telur")], T);
  assert.equal(e.left, 20);
  assert.ok(e.daysLeft != null); // meals give a pace even after one buy
});

test("lowItems sorts out and low first", () => {
  const p = [{ id: "a", name: "A" }, { id: "b", name: "B" }, { id: "c", name: "C" }];
  const ests = { a: { status: "low", daysLeft: 2 }, b: { status: "ok", daysLeft: 9 }, c: { status: "out", daysLeft: 0 } };
  assert.deepEqual(lowItems(p, ests).map((x) => x.id), ["c", "a"]);
});

test("priceBoard: cheapest shop now, sales only while on", () => {
  const buys = [
    buy("2026-11-01", 5000, { price: 20, shop: "Lotus's" }),
    buy("2026-11-15", 5000, { price: 17, shop: "lotus's ", sale: true }),
    buy("2026-10-20", 5000, { price: 18.5, shop: "Mydin" }),
    buy("2026-09-01", 5000, { price: 15, shop: "Giant", sale: true }), // old sale, over
  ];
  const prices = [{ item: "rice", date: "2026-11-21", qty: 10000, price: 42, shop: "Giant" }];
  const b = priceBoard("rice", buys, prices, T);
  assert.deepEqual(b.map((s) => s.shop.toLowerCase()), ["lotus's", "mydin", "giant"]);
  assert.equal(b[0].onSale, true);
  assert.equal(b[0].now, 17 / 5000);
  assert.equal(b[0].normal, 20 / 5000);
  assert.equal(b[2].onSale, false);
  assert.ok(Math.abs(b[2].now - 42 / 10000) < 1e-12);
});

test("saleOn uses the end date, else SALE_DAYS", () => {
  assert.equal(saleOn({ sale: true, date: "2026-11-01", until: "2026-11-30" }, T), true);
  assert.equal(saleOn({ sale: true, date: "2026-11-01", until: "2026-11-20" }, T), false);
  assert.equal(saleOn({ sale: true, date: "2026-11-01" }, T), false);
  assert.equal(saleOn({ sale: true, date: "2026-11-15" }, T), true);
  assert.equal(saleOn({ date: "2026-11-15" }, T), false);
});

test("vsUsual compares with normal prices", () => {
  const buys = [buy("2026-11-01", 5000, { price: 20, shop: "A" }), buy("2026-11-10", 5000, { price: 22, shop: "B" }), buy("2026-11-12", 5000, { price: 10, shop: "A", sale: true })];
  const v = vsUsual("rice", 17 / 5000, buys, [], T);
  assert.ok(Math.abs(v.usual - 21 / 5000) < 1e-12);
  assert.equal(v.pct, -19);
  assert.equal(vsUsual("rice", 1, [], [], T), null);
});

test("shopNames merges spellings, most used first", () => {
  assert.deepEqual(shopNames([{ shop: "Mydin" }, { shop: "Lotus's" }, { shop: "lotus's" }, {}], [{ shop: "Mydin " }, { shop: "Mydin" }]), ["Mydin", "Lotus's"]);
});

test("shopTotals prices the list per shop", () => {
  const boards = { rice: [{ shop: "A", now: 0.004 }, { shop: "B", now: 0.005 }], egg: [{ shop: "B", now: 0.5 }] };
  const t = shopTotals([{ item: "rice", qty: 5000 }, { item: "egg", qty: 30 }], boards);
  assert.equal(t[0].shop, "B"); // has both
  assert.equal(t[0].total, 25 + 15);
  assert.equal(t[1].missing, 1);
});

test("planNeeds and shortfall round to packs", () => {
  const foods = [{ id: "f-nasi", name: "Nasi", kcal: 130 }, { id: "f-ikan", name: "Ikan", kcal: 200 }];
  const sets = [{ id: "s1", name: "Nasi ikan", items: [{ food: "f-nasi", g: 200 }, { food: "f-ikan", g: 100 }] }];
  const people = [{ id: "p1" }, { id: "p2" }];
  const need = planNeeds(sets, { s1: 3 }, foods, [], people);
  assert.deepEqual(need, { "f-nasi": 1200, "f-ikan": 600 });
  const pantry = [{ ...rice }];
  const short = shortfall(need, pantry, { rice: { left: 500 } }, foods);
  assert.deepEqual(short, [{ name: "Beras", item: "rice", food: "f-nasi", qty: 5000, unit: "g" }, { name: "Ikan", food: "f-ikan", qty: 600, unit: "g" }].sort((a, b) => a.name.localeCompare(b.name)));
  assert.deepEqual(shortfall({ "f-nasi": 400 }, pantry, { rice: { left: 500 } }, foods), []);
});

test("readItem and readPrice check what's typed", () => {
  assert.equal(readItem({ name: "" }).error, "Give it a name.");
  assert.ok(readItem({ name: "Tisu", kind: "home", unit: "pcs", pack: "" }).error);
  assert.deepEqual(readItem({ name: " Tisu ", kind: "home", unit: "pcs", pack: "10", food: "x" }).item, { name: "Tisu", kind: "home", unit: "pcs", pack: 10 });
  assert.ok(readItem({ name: "Telur", kind: "food", unit: "pcs", pack: 30, food: "f-telur" }).error); // grams per egg needed
  assert.equal(readItem({ name: "Telur", kind: "food", unit: "pcs", pack: 30, food: "f-telur", each: 55 }).item.each, 55);
  assert.deepEqual(readPrice({ qty: "5000" }).rec, { qty: 5000 });
  assert.equal(readPrice({ qty: 1, price: "12.9" }).error, "Which shop?");
  assert.deepEqual(readPrice({ qty: 1, price: "12.9", shop: "Mydin", sale: true, until: "2026-11-30" }).rec, { qty: 1, price: 12.9, shop: "Mydin", sale: true, until: "2026-11-30" });
  assert.ok(readPrice({ qty: 1, shop: "Mydin" }, { needPrice: true }).error);
});

test("amount and money read nicely", () => {
  assert.equal(amount(1250, "g"), "1.3 kg");
  assert.equal(amount(750, "g"), "750 g");
  assert.equal(amount(2000, "ml"), "2 L");
  assert.equal(amount(6, "pcs"), "6 pcs");
  assert.equal(money(12.9), "RM 12.90");
});

test("cooked weight: meals of cooked rice use up less dry rice", () => {
  const dry = { ...rice, each: 2.5 };
  const e = estimate(dry, [buy("2026-11-20", 5000)], [meal("2026-11-21", 2500)], T);
  assert.equal(e.left, 4000); // 2.5 kg cooked = 1 kg dry
  const item = (each) => readItem({ name: "Beras", kind: "food", unit: "g", pack: 5000, food: "f-nasi", each });
  assert.equal(item("2.5").item.each, 2.5);
  assert.equal(item("1").item.each, undefined);
  assert.ok(item("50").error);
});

test("kinds: built-in Food and Home, the family's own, and removed kinds fall back to Home", () => {
  const custom = [{ id: "k2", name: "Pets", created: 2 }, { id: "k1", name: "Baby", created: 1 }];
  const kinds = allKinds(custom);
  assert.deepEqual(kinds.map((k) => k.id), ["food", "home", "k1", "k2"]);
  assert.equal(kindOf("k2", kinds).name, "Pets");
  assert.equal(kindOf("gone", kinds).id, "home");
  assert.deepEqual(readKind("  Baby   things ", kinds), { name: "Baby things" });
  assert.ok(readKind("", kinds).error);
  assert.ok(readKind("baby", kinds).error);
  assert.ok(readKind("HOME", kinds).error);
  const ids = kinds.map((k) => k.id);
  assert.equal(readItem({ name: "Lampin", kind: "k1", unit: "pcs", pack: 40, food: "x" }, ids).item.kind, "k1");
  assert.equal(readItem({ name: "Lampin", kind: "k1", unit: "pcs", pack: 40 }, ids).item.food, undefined);
  assert.equal(readItem({ name: "Lampin", kind: "nope", unit: "pcs", pack: 40 }, ids).item.kind, "food");
});

test("the Kind field: typed names match a kind, or make a new one on save", () => {
  const kinds = allKinds([{ id: "k1", name: "Medicine", created: 1 }]);
  assert.deepEqual(matchKind(" medicine ", kinds), { id: "k1" });
  assert.deepEqual(matchKind("FOOD", kinds), { id: "food" });
  assert.deepEqual(matchKind("medicines", kinds), { id: "k1" }); // near-copies match, like diary tags
  assert.deepEqual(matchKind("Medi cine", kinds), { id: "k1" });
  assert.deepEqual(matchKind("Pet  food", kinds), { name: "Pet food" });
  assert.ok(matchKind("  ", kinds).error);
  assert.deepEqual(kindsLike("", kinds).map((k) => k.id), ["food", "home", "k1"]);
  assert.deepEqual(kindsLike("me", kinds).map((k) => k.id), ["home", "k1"]);
  assert.deepEqual(kindsLike("zzz", kinds), []);
  assert.deepEqual(kindsLike("medicines", kinds).map((k) => k.id), ["k1"]);
});

test("shelves group by kind, neediest first, and skip empty kinds", () => {
  const kinds = allKinds([{ id: "k-med", name: "Medicine", created: 1 }, { id: "k-pet", name: "Pet", created: 2 }]);
  const pantry = [
    { id: "a", name: "Telur", kind: "food" }, { id: "b", name: "Beras", kind: "food" }, { id: "c", name: "Minyak", kind: "food" },
    { id: "d", name: "Sabun", kind: "home" }, { id: "e", name: "Panadol", kind: "k-med" }, { id: "f", name: "Old", kind: "gone" },
  ];
  const ests = { a: { status: "ok", daysLeft: 20 }, b: { status: "low", daysLeft: 2 }, c: { status: "out", daysLeft: 0 },
    d: { status: "soon", daysLeft: 5 }, e: { status: "unknown", daysLeft: null }, f: { status: "ok", daysLeft: 40 } };
  const s = shelves(pantry, ests, kinds);
  assert.deepEqual(s.map((x) => x.kind.id), ["food", "home", "k-med"]); // Pet has nothing, so no shelf
  assert.deepEqual(s[0].items.map((p) => p.id), ["c", "b", "a"]);
  assert.equal(s[0].need, 2);
  assert.deepEqual(s[1].items.map((p) => p.id), ["d", "f"]); // an unknown kind sits on Home
  assert.equal(s[1].need, 1);
  assert.equal(s[2].need, 0);
  assert.deepEqual(shelves([], {}, kinds), []);
});

test("usualPrice is the median normal price, sale only when nothing else", () => {
  const buys = [buy("2026-11-01", 5000, { price: 20, shop: "A" }), buy("2026-11-10", 5000, { price: 22, shop: "B" }), buy("2026-11-12", 5000, { price: 10, shop: "A", sale: true })];
  assert.ok(Math.abs(usualPrice("rice", buys, [], T) - 21 / 5000) < 1e-12);
  const onlySale = [buy("2026-11-12", 5000, { price: 10, shop: "A", sale: true })];
  assert.equal(usualPrice("rice", onlySale, [], T), 10 / 5000);
  assert.equal(usualPrice("rice", onlySale, [], T, false), null);
  assert.equal(usualPrice("rice", [], [], T), null);
});

test("setCost for cooked and bought sets", () => {
  const pantry = [rice, { id: "ayam", name: "Ayam", unit: "g" }, { id: "kari", name: "Daun kari", unit: "g" }, { id: "telur", name: "Telur", unit: "pcs" }];
  const buys = [buy("2026-11-01", 5000, { price: 20, shop: "A" }), { item: "ayam", date: "2026-11-15", qty: 1000, price: 12, shop: "Pasar" }, { item: "telur", date: "2026-11-15", qty: 30, price: 12, shop: "A" }];
  const set = { made: "cooked", serves: 4, ingredients: [{ item: "rice", qty: 500 }, { item: "ayam", qty: 1000 }, { item: "telur", qty: 2 }, { item: "kari", qty: 10 }, { item: "gone", qty: 5 }] };
  const c = setCost(set, pantry, buys, [], T);
  assert.ok(Math.abs(c.pot - (2 + 12 + 0.8)) < 1e-9); // 500 g of RM 20 / 5 kg, 1 kg ayam, 2 of 30 eggs at RM 12
  assert.ok(Math.abs(c.plate - 14.8 / 4) < 1e-9);
  assert.deepEqual(c.missing, ["Daun kari"]); // no price yet: listed, not counted as zero; deleted items skipped
  assert.equal(c.priced, 3);
  assert.equal(setCost({ ...set, serves: 0 }, pantry, buys, [], T).serves, 1);
  assert.equal(setCost({ made: "cooked", ingredients: [] }, pantry, buys, [], T), null);
  assert.deepEqual(setCost({ made: "bought", price: 8 }, pantry, buys, [], T), { made: "bought", plate: 8, missing: [], priced: 1 });
  assert.equal(setCost({ made: "bought" }, pantry, buys, [], T), null);
  assert.equal(setCost({ name: "old set" }, pantry, buys, [], T), null);
});
