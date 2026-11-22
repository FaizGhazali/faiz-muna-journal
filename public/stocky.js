// Stocky (groceries) maths. Pure: no Firebase, no DOM (tests in tests/stocky.test.mjs).
//   pantry/{auto id}   { name, kind: "food"|"home", unit: "g"|"ml"|"pcs", pack, each?, food?, check?: { date, at, level }, created }
//                      one thing the house buys. pack = the usual amount bought at once (in unit);
//                      food = a Meals food id; each = grams of that food one unit makes: grams in one piece (pcs),
//                      or how much it weighs once cooked (rice about 2.5, missing = 1), so logged meals can use it up.
//   buys/{auto id}     { item, date, qty, price?, shop?, sale?, by, at }  one purchase; price = what was paid for qty
//   prices/{auto id}   { item, date, qty, price, shop, sale?, until? }     a price seen in a shop without buying
//   shopList/{auto id} { name, item?, food?, qty?, unit?, from: "manual"|"plan", created }
// What's left, when it runs out, and which shop is cheapest are worked out when drawing, never stored.
import { dayNum, addDays } from "./suggest.js";
import { plateOf } from "./meals.js";

export const UNITS = { g: "g", ml: "ml", pcs: "pcs" };
export const LEVELS = [[1, "Full"], [0.5, "Half"], [0.25, "Low"], [0, "Out"]];
export const LOW_DAYS = 3; // this many days left or fewer = low
export const SOON_DAYS = 7; // a week or less = buy soon
export const LOW_SHARE = 0.25; // a quarter of a pack or less = low
export const RATE_BUYS = 6; // how many recent buys teach the pace
export const MEAL_DAYS = 28; // logged meals over this many days give a second pace
export const SALE_DAYS = 14; // a sale with no end date counts this long after it was seen
export const PRICE_DAYS = 180; // older prices are ignored
export const CURRENCY = "RM";

// Grams of the linked Meals food that one unit of the item makes (0 = unknown, so meals are not counted).
export const gramsPer = (item) => Number(item.each) || (item.unit === "pcs" ? 0 : 1);
const days = (a, b) => dayNum(b) - dayNum(a);
const key = (s) => String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
const byTime = (a, b) => a.date.localeCompare(b.date) || (a.at || 0) - (b.at || 0);

// "1.2 kg", "750 g", "2 L", "6 pcs".
export function amount(q, unit) {
  const n = Math.max(0, q);
  if (unit === "pcs") return `${Math.round(n)} pcs`;
  const big = unit === "ml" ? "L" : "kg";
  return n >= 1000 ? `${Math.round(n / 100) / 10} ${big}` : `${Math.round(n)} ${unit}`;
}
export const money = (n) => `${CURRENCY} ${(Math.round(n * 100) / 100).toFixed(2)}`;

// Units of a pantry item used per day, from the buying pattern: everything bought before the
// last buy was used up over the days between the first and the last buy. null if it can't tell yet.
export function buyRate(buys) {
  const byDay = new Map();
  for (const b of [...buys].sort(byTime)) byDay.set(b.date, (byDay.get(b.date) || 0) + (Number(b.qty) || 0));
  const list = [...byDay].slice(-(RATE_BUYS + 1));
  if (list.length < 2) return null;
  const span = days(list[0][0], list[list.length - 1][0]);
  if (span < 1) return null;
  const used = list.slice(0, -1).reduce((a, [, q]) => a + q, 0);
  return used > 0 ? used / span : null;
}

// Grams of a Meals food that both people logged on days from..to (both included).
export function mealUse(meals, foodId, from, to) {
  if (!foodId) return 0;
  let g = 0;
  for (const m of meals) if (m.date >= from && m.date <= to) for (const it of m.items || []) if (it.food === foodId) g += Number(it.g) || 0;
  return g;
}

// Where an item stands today.
// { left, base, share, rate, daysLeft, outOn, status: ok|soon|low|out|unknown, why: [lines] }
// Meals only record what was eaten (not cooking, not guests), so they can only bring the date forward:
// used = the larger of (buying pace × days) and (what meals used).
export function estimate(item, buys, meals, today) {
  const mine = buys.filter((b) => b.item === item.id).sort(byTime);
  const each = gramsPer(item);
  const toUnits = (g) => (each > 0 ? g / each : 0);
  const fromMeals = (a, b) => (item.food && each > 0 ? toUnits(mealUse(meals, item.food, a, b)) : 0);
  const bought = buyRate(mine);
  // A second pace from meals logged lately, for items bought only once.
  const mealPace = item.food ? fromMeals(addDays(today, -MEAL_DAYS + 1), today) / MEAL_DAYS : 0;
  const rate = Math.max(bought || 0, mealPace) || null;
  const base = Number(item.pack) || mine.at(-1)?.qty || 0;
  const events = mine.map((b) => ({ date: b.date, at: b.at || 0, add: Number(b.qty) || 0 }));
  if (item.check) events.push({ date: item.check.date, at: item.check.at || 0, set: item.check.level * base });
  events.sort(byTime);
  const why = [];
  if (!events.length) return { left: null, base, share: null, rate, daysLeft: null, outOn: null, status: "unknown", why: ["Not bought yet."] };
  // Walk through buys and checks: use up stock between them, add each buy, a check sets the level.
  let left = 0, prev = null, sinceMeals = 0;
  const useUp = (a, b, last) => {
    // Meals on the day of the next buy or check count after it; meals today count now.
    const end = last ? b : addDays(b, -1);
    const n = Math.max(0, days(a, b));
    const meal = end >= a ? fromMeals(a, end) : 0;
    if (last) sinceMeals = meal;
    left = Math.max(0, left - Math.max((bought || 0) * n, meal));
  };
  for (const e of events) {
    if (prev) useUp(prev, e.date, false);
    left = e.set != null ? e.set : left + e.add;
    prev = e.date;
  }
  useUp(prev, today, true);
  const anchor = events.at(-1);
  if (bought) why.push(`You buy about ${amount(bought * 7, item.unit)} a week${base ? `, a pack every ${Math.max(1, Math.round(base / bought))} days` : ""}.`);
  else if (mealPace) why.push(`From meals logged lately: about ${amount(mealPace * 7, item.unit)} a week.`);
  else why.push("Buy it once more, or link it to a Meals food, and Stocky learns how fast it goes.");
  if (sinceMeals > 0) why.push(`Meals logged since ${anchor.set != null ? "your check" : "the last buy"} used ${amount(sinceMeals, item.unit)}.`);
  if (anchor.set != null) why.push(`You said it was ${LEVELS.find(([l]) => l === item.check.level)?.[1].toLowerCase() || "checked"} on ${anchor.date}.`);
  const daysLeft = rate ? Math.floor(left / rate) : null;
  const share = base ? Math.min(1, left / base) : null;
  const status = left <= 0 ? "out"
    : (daysLeft != null && daysLeft <= LOW_DAYS) || (share != null && share <= LOW_SHARE) ? "low"
    : daysLeft != null && daysLeft <= SOON_DAYS ? "soon"
    : daysLeft == null && share == null ? "unknown" : "ok";
  return { left, base, share, rate, daysLeft, outOn: daysLeft == null ? null : addDays(today, daysLeft), status, why };
}

// Items running low or out, soonest first.
export function lowItems(pantry, ests) {
  return pantry.filter((p) => ["low", "out"].includes(ests[p.id]?.status))
    .sort((a, b) => (ests[a.id].daysLeft ?? -1) - (ests[b.id].daysLeft ?? -1) || a.name.localeCompare(b.name));
}

// ---------- shops and prices ----------
// Price per unit (per kg, per L or per piece reads better than per gram).
export const perUnit = (r) => (r.qty > 0 && r.price > 0 ? r.price / r.qty : null);
export const unitLabel = (unit) => (unit === "pcs" ? "each" : unit === "ml" ? "per L" : "per kg");
export const shown = (p, unit) => (unit === "pcs" ? p : p * 1000);
// Same shop however it was typed: "Lotus's", "lotus's ", "LOTUS'S".
export const shopKey = key;
// A sale counts until its end date, or SALE_DAYS after it was seen when no date was given.
export const saleOn = (r, today) => !!r.sale && (r.until ? r.until >= today : days(r.date, today) <= SALE_DAYS);

// Every price for an item from buys and prices seen, newest first, over the last PRICE_DAYS.
export function priceRecords(itemId, buys, prices, today) {
  const from = addDays(today, -PRICE_DAYS);
  return [...buys, ...prices].filter((r) => r.item === itemId && r.shop && perUnit(r) && r.date >= from && r.date <= today)
    .sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
}

// One row per shop: its normal price (the latest non-sale one), a sale price if one is on now, and the price to pay now.
// Cheapest now first. [{ shop, normal, sale, until?, now, onSale, date }]
export function priceBoard(itemId, buys, prices, today) {
  const shops = new Map();
  for (const r of priceRecords(itemId, buys, prices, today)) {
    const k = shopKey(r.shop);
    const s = shops.get(k) || { shop: String(r.shop).trim(), normal: null, sale: null, until: null, date: r.date };
    const p = perUnit(r);
    if (!r.sale && s.normal == null) s.normal = p;
    if (r.sale && s.sale == null && saleOn(r, today)) { s.sale = p; s.until = r.until || null; }
    shops.set(k, s);
  }
  const rows = [...shops.values()].map((s) => {
    const onSale = s.sale != null && (s.normal == null || s.sale < s.normal);
    return { ...s, onSale, now: onSale ? s.sale : s.normal ?? s.sale };
  }).filter((s) => s.now != null);
  return rows.sort((a, b) => a.now - b.now || a.shop.localeCompare(b.shop));
}

// How a price compares with what this item usually costs (the median of normal prices across shops).
// { usual, pct } where pct < 0 means cheaper than usual. null if nothing to compare with.
export function vsUsual(itemId, unitPrice, buys, prices, today) {
  const ps = priceRecords(itemId, buys, prices, today).filter((r) => !r.sale).map(perUnit).sort((a, b) => a - b);
  if (!ps.length || !(unitPrice > 0)) return null;
  const m = ps.length >> 1, usual = ps.length % 2 ? ps[m] : (ps[m - 1] + ps[m]) / 2;
  return { usual, pct: Math.round(((unitPrice - usual) / usual) * 100) };
}

// Every shop name used, most used first, for the shop picker.
export function shopNames(buys, prices) {
  const n = new Map();
  for (const r of [...buys, ...prices]) if (r.shop) { const k = shopKey(r.shop); const s = n.get(k) || { name: String(r.shop).trim(), n: 0 }; s.n++; n.set(k, s); }
  return [...n.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).map((s) => s.name);
}

// What going to each shop costs for a list: per shop, the items it has a price for and their total at
// each item's usual amount. Cheapest shop for the whole list first. [{ shop, total, have, missing }]
export function shopTotals(rows, boards) {
  const all = new Map();
  for (const r of rows) for (const s of boards[r.item] || []) all.set(shopKey(s.shop), s.shop);
  return [...all].map(([k, shop]) => {
    let total = 0, have = 0;
    for (const r of rows) {
      const s = (boards[r.item] || []).find((x) => shopKey(x.shop) === k);
      if (s && r.qty > 0) { total += s.now * r.qty; have++; }
    }
    return { shop, total, have, missing: rows.length - have };
  }).sort((a, b) => b.have - a.have || a.total - b.total);
}

// ---------- planning meals into a shopping list ----------
// Grams of each food the planned sets need for both people: times[setId] = how often this week.
export function planNeeds(sets, times, foods, meals, people) {
  const need = {};
  for (const s of sets) {
    const n = Number(times[s.id]) || 0;
    if (!n) continue;
    for (const p of people) for (const r of plateOf(s, foods, meals, p.id)) need[r.food] = (need[r.food] || 0) + r.g * n;
  }
  return need;
}
// What to buy for those needs after what's at home. Linked items are rounded up to whole packs;
// foods with no pantry item yet are listed by name, rounded up to 100 g.
// [{ name, item?, food, qty, unit }]
export function shortfall(need, pantry, ests, foods) {
  const out = [];
  for (const [food, g] of Object.entries(need)) {
    const it = pantry.find((p) => p.food === food);
    if (it) {
      const each = gramsPer(it);
      if (!each) continue;
      const short = g / each - Math.max(0, ests[it.id]?.left || 0);
      if (short <= 0) continue;
      const pack = Number(it.pack) || short;
      out.push({ name: it.name, item: it.id, food, qty: Math.ceil(short / pack - 1e-9) * pack, unit: it.unit });
    } else {
      const f = foods.find((x) => x.id === food);
      if (f) out.push({ name: f.name, food, qty: Math.ceil(g / 100) * 100, unit: "g" });
    }
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- checking what's typed ----------
// A pantry item. Returns { item } or { error }.
export function readItem({ name, kind, unit, pack, each, food }) {
  const nm = String(name || "").trim().slice(0, 60);
  if (!nm) return { error: "Give it a name." };
  const u = UNITS[unit] ? unit : "pcs", p = Number(pack);
  if (!(p > 0 && p <= 100000)) return { error: "How much do you usually buy at once? Type a number." };
  const item = { name: nm, kind: kind === "home" ? "home" : "food", unit: u, pack: Math.round(p * 10) / 10 };
  if (item.kind === "food" && food) item.food = String(food);
  if (u === "pcs" && item.food) {
    const e = Number(each);
    if (!(e > 0 && e <= 5000)) return { error: "How many grams is one? (An egg is about 55 g.)" };
    item.each = Math.round(e);
  } else if (item.food && each !== "" && each != null && Number(each) !== 1) {
    const e = Number(each);
    if (!(e >= 0.1 && e <= 10)) return { error: "Cooked weight is 0.1 to 10 times the dry weight. Rice is about 2.5." };
    item.each = Math.round(e * 10) / 10;
  }
  return { item };
}
// A buy or a price seen. Returns { rec } or { error }.
export function readPrice({ qty, price, shop, sale, until }, { needPrice = false } = {}) {
  const q = Number(qty);
  if (!(q > 0 && q <= 100000)) return { error: "How much? Type a number." };
  const rec = { qty: Math.round(q * 10) / 10 };
  const pr = price === "" || price == null ? null : Number(price);
  if (pr != null && !(pr >= 0 && pr <= 100000)) return { error: "Type the price as a number, like 12.90." };
  if (needPrice && !(pr > 0)) return { error: "Type the price you saw." };
  const sh = String(shop || "").trim().slice(0, 40);
  if ((needPrice || pr) && !sh) return { error: "Which shop?" };
  if (pr) rec.price = Math.round(pr * 100) / 100;
  if (sh) rec.shop = sh;
  if (sale && pr) { rec.sale = true; if (until) rec.until = String(until); }
  return { rec };
}
