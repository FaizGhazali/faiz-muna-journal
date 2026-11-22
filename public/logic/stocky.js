// Stocky (groceries) maths. Pure: no Firebase, no DOM (tests in tests/stocky.test.mjs).
//   pantry/{auto id}   { name, kind: "food"|"home"|<kinds id>, unit: "g"|"ml"|"pcs", pack, links?: [{ food, per100 }], check?: { date, at, level }, created }
//                      one thing the house buys. pack = the usual amount bought at once (in unit);
//                      links = "Used in meals": each Meals food it goes into (Nasi putih, Ayam kam heong) and
//                      per100 = how much of the item (in its unit) is in 100 g of that food, so logged meals use it up.
//                      Older items have food + each (grams of that food one unit makes) and also: [{ food, per100 }];
//                      they're read as links and rewritten as links only when the item is saved again.
//   buys/{auto id}     { item, date, qty, price?, shop?, sale?, by, at }  one purchase; price = what was paid for qty
//   prices/{auto id}   { item, date, qty, price, shop, sale?, until? }     a price seen in a shop without buying
//   shopList/{auto id} { name, item?, food?, qty?, unit?, from: "manual"|"plan", created }
//   kinds/{auto id}    { name, created }  the family's own kinds beside the built-in Food and Home
// What's left, when it runs out, and which shop is cheapest are worked out when drawing, never stored.

import { plateOf } from "./meals.js";
import { dayNum, addDays, tagKey } from "../core/util.js"; // tagKey: same near-copy rule as diary tags

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
// skip(meal) leaves a meal out (one from a cooked set that already counts this item as an ingredient).
export function mealUse(meals, foodId, from, to, skip = () => false) {
  if (!foodId) return 0;
  let g = 0;
  for (const m of meals) if (m.date >= from && m.date <= to && !skip(m)) for (const it of m.items || []) if (it.food === foodId) g += Number(it.g) || 0;
  return g;
}
// "Used in meals" as rows for the form: [{ food, per100 }] (per100 "" when an old item never said).
// An old main link (food + each) becomes 100 / each: rice that cooks to 2.5x is 40 g in 100 g of nasi.
export function linkRows(item) {
  if (Array.isArray(item.links)) return item.links.map((l) => ({ food: l.food, per100: l.per100 ?? "" }));
  const rows = [], each = gramsPer(item);
  if (item.food) rows.push({ food: item.food, per100: each > 0 ? Math.round((100 / each) * 100) / 100 : "" });
  for (const a of item.also || []) if (a.food && !rows.some((r) => r.food === a.food)) rows.push({ food: a.food, per100: a.per100 ?? "" });
  return rows;
}
// Every Meals food an item is used in, with how many units of the item one gram of that food uses. [{ food, per }]
export const linksOf = (item) => linkRows(item).filter((r) => Number(r.per100) > 0).map((r) => ({ food: r.food, per: Number(r.per100) / 100 }));
export const linksTo = (item, foodId) => linkRows(item).some((r) => r.food === foodId);
// The cooked sets that put this item in the pot: setId → units of it in one plate (the pot shared by its plates).
export function cookedIn(item, sets) {
  const per = new Map();
  for (const s of sets || []) {
    if (s.made !== "cooked") continue;
    const q = (s.ingredients || []).filter((x) => x.item === item.id).reduce((a, x) => a + (Number(x.qty) || 0), 0);
    if (q > 0) per.set(s.id, q / Math.max(1, Math.round(Number(s.serves) || 1)));
  }
  return per;
}
// Units of an item used by meals logged on days from..to: its linked foods by weight, and a share of the pot
// for each plate logged from a cooked set that lists it. A plate from such a set isn't counted twice by its foods.
export function itemUse(item, meals, sets, from, to) {
  const pot = cookedIn(item, sets), skip = (m) => pot.has(m.set);
  let u = 0;
  for (const l of linksOf(item)) u += mealUse(meals, l.food, from, to, skip) * l.per;
  if (pot.size) for (const m of meals) if (m.date >= from && m.date <= to && pot.has(m.set)) u += pot.get(m.set);
  return u;
}

// Where an item stands today.
// { left, base, share, rate, daysLeft, outOn, status: ok|soon|low|out|unknown, why: [lines] }
// Meals only record what was eaten (not cooking, not guests), so they can only bring the date forward:
// used = the larger of (buying pace × days) and (what meals used).
// sets = the meal sets, so plates from a cooked set use up its ingredients.
export function estimate(item, buys, meals, today, sets = []) {
  const mine = buys.filter((b) => b.item === item.id).sort(byTime);
  const fromMeals = (a, b) => itemUse(item, meals, sets, a, b);
  const bought = buyRate(mine);
  // A second pace from meals logged lately, for items bought only once.
  const mealPace = fromMeals(addDays(today, -MEAL_DAYS + 1), today) / MEAL_DAYS;
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
  else why.push("Buy it once more, link it to a Meals food, or put it in a cooked meal set, and Stocky learns how fast it goes.");
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

// At home as shelves: one per kind that has items (in the kinds' own order), each item sorted out → low →
// soon → not sure → fine, then fewest days left, then name. `need` counts what wants buying (out / low / soon).
const STATUS_ORDER = { out: 0, low: 1, soon: 2, unknown: 3, ok: 4 };
export function shelves(pantry, ests, kinds) {
  const rank = (p) => STATUS_ORDER[ests[p.id]?.status] ?? STATUS_ORDER.unknown;
  return kinds.map((kind) => {
    const items = pantry.filter((p) => kindOf(p.kind, kinds).id === kind.id)
      .sort((a, b) => rank(a) - rank(b) || (ests[a.id]?.daysLeft ?? 999) - (ests[b.id]?.daysLeft ?? 999) || a.name.localeCompare(b.name));
    return { kind, items, need: items.filter((p) => rank(p) <= STATUS_ORDER.soon).length };
  }).filter((s) => s.items.length);
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
  const usual = usualPrice(itemId, buys, prices, today, false);
  if (usual == null || !(unitPrice > 0)) return null;
  return { usual, pct: Math.round(((unitPrice - usual) / usual) * 100) };
}
// What one unit (g, ml or piece) of an item usually costs: the median of its normal prices across shops.
// With anySale, sale prices count when there's no normal price yet. null if it has no price at all.
export function usualPrice(itemId, buys, prices, today, anySale = true) {
  const rs = priceRecords(itemId, buys, prices, today), normal = rs.filter((r) => !r.sale);
  const ps = (normal.length || !anySale ? normal : rs).map(perUnit).sort((a, b) => a - b);
  if (!ps.length) return null;
  const m = ps.length >> 1;
  return ps.length % 2 ? ps[m] : (ps[m - 1] + ps[m]) / 2;
}

// ---------- what a meal set costs ----------
// A meal set is made "cooked" (ingredients from the Price book for the whole pot, which makes `serves` plates)
// or "bought" (no ingredients; `price` = what one plate costs outside). Missing = not said, so no cost.
//   mealSets: { ..., made?: "cooked"|"bought", ingredients?: [{ item, qty }], serves?, price? }
// Ingredients with no price yet are listed in `missing`, never counted as zero.
// { made, plate, pot?, serves?, missing: [names], priced } or null when there's nothing to say.
export const SERVES_MAX = 50;
export function setCost(set, pantry, buys, prices, today) {
  if (set?.made === "bought") return Number(set.price) > 0 ? { made: "bought", plate: Number(set.price), missing: [], priced: 1 } : null;
  if (set?.made !== "cooked") return null;
  const byId = new Map(pantry.map((p) => [p.id, p]));
  const rows = (set.ingredients || []).filter((x) => byId.has(x.item) && Number(x.qty) > 0);
  if (!rows.length) return null;
  let pot = 0, priced = 0;
  const missing = [];
  for (const x of rows) {
    const u = usualPrice(x.item, buys, prices, today);
    if (u == null) { missing.push(byId.get(x.item).name); continue; }
    pot += u * Number(x.qty); priced++;
  }
  const serves = Math.min(SERVES_MAX, Math.max(1, Math.round(Number(set.serves) || 1)));
  return { made: "cooked", pot, serves, plate: pot / serves, missing, priced };
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
// What the planned sets need: times[setId] = how often this week. A cooked set with ingredients is one pot
// each time (items: units of each pantry item); any other set is plates for both people (foods: grams of each food).
// Bought sets need nothing from home. { foods: { foodId: g }, items: { itemId: units } }
export function planNeeds(sets, times, foods, meals, people) {
  const need = { foods: {}, items: {} };
  for (const s of sets) {
    const n = Number(times[s.id]) || 0;
    if (!n || s.made === "bought") continue;
    const pot = s.made === "cooked" ? (s.ingredients || []).filter((x) => x.item && Number(x.qty) > 0) : [];
    if (pot.length) { for (const x of pot) need.items[x.item] = (need.items[x.item] || 0) + Number(x.qty) * n; continue; }
    for (const p of people) for (const r of plateOf(s, foods, meals, p.id)) need.foods[r.food] = (need.foods[r.food] || 0) + r.g * n;
  }
  return need;
}
// What to buy for those needs after what's at home. Linked items are rounded up to whole packs;
// foods with no pantry item yet are listed by name, rounded up to 100 g.
// [{ name, item?, food, qty, unit }]
// A food linked to several items (bihun goreng ayam: bihun and ayam) needs some of each.
export function shortfall(need, pantry, ests, foods) {
  const out = [], units = { ...need.items };
  for (const [food, g] of Object.entries(need.foods)) {
    const its = pantry.filter((p) => linksTo(p, food));
    for (const it of its) { const l = linksOf(it).find((x) => x.food === food); if (l) units[it.id] = (units[it.id] || 0) + g * l.per; }
    if (its.length) continue;
    const f = foods.find((x) => x.id === food);
    if (f) out.push({ name: f.name, food, qty: Math.ceil(g / 100) * 100, unit: "g" });
  }
  for (const [id, u] of Object.entries(units)) {
    const it = pantry.find((p) => p.id === id);
    if (!it) continue;
    const short = u - Math.max(0, ests[it.id]?.left || 0);
    if (short <= 1e-9) continue;
    const pack = Number(it.pack) || short;
    out.push({ name: it.name, item: it.id, ...(linkRows(it)[0] ? { food: linkRows(it)[0].food } : {}), qty: Math.ceil(short / pack - 1e-9) * pack, unit: it.unit });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

// ---------- kinds ----------
// Food (can link to a Meals food) and Home are built in and can't be removed. The family adds their own
// in kinds/{auto id} → { name, created }; an item's `kind` is one of these ids. A removed kind's items
// move to Home (FALLBACK_KIND), and an item whose kind is unknown is shown as Home too.
export const BUILT_IN_KINDS = [{ id: "food", name: "Food", builtIn: true }, { id: "home", name: "Home", builtIn: true }];
export const FALLBACK_KIND = "home";
export const allKinds = (custom = []) => [...BUILT_IN_KINDS, ...[...custom].sort((a, b) => (a.created || 0) - (b.created || 0) || a.name.localeCompare(b.name))];
export const kindOf = (id, kinds) => kinds.find((k) => k.id === id) || kinds.find((k) => k.id === FALLBACK_KIND);
// The Kind field: what's typed (or picked) → { id } of a kind that exists (any capitals / spaces),
// { name } of a new kind to make on save, or { error }.
export function matchKind(text, kinds) {
  const nm = String(text || "").trim().replace(/\s+/g, " ");
  if (!nm) return { error: "Pick a kind, or type a new one." };
  const same = kinds.find((k) => tagKey(k.name) === tagKey(nm));
  if (same) return { id: same.id };
  return readKind(nm, kinds);
}
// Kinds for the open list: those whose name has what's typed in it (all of them when nothing is typed).
export const kindsLike = (text, kinds) => {
  const q = String(text || "").trim().toLowerCase(), qk = tagKey(q);
  return q ? kinds.filter((k) => k.name.toLowerCase().includes(q) || (qk && tagKey(k.name).includes(qk))) : kinds;
};
// A kind being typed. Returns { name } or { error }.
export function readKind(name, kinds) {
  const nm = String(name || "").trim().replace(/\s+/g, " ").slice(0, 30);
  if (!nm) return { error: "Give the kind a name, like Baby or Pets." };
  const same = kinds.find((k) => tagKey(k.name) === tagKey(nm));
  if (same) return { error: `There's already a kind called ${same.name}.` };
  return { name: nm };
}

// ---------- checking what's typed ----------
// A pantry item. Returns { item } or { error }.
// `kinds` = the kind ids that exist (built-in + the family's own); anything else is saved as food.
export const LINKS_MAX = 12; // meal foods one item can be used in
export function readItem({ name, kind, unit, pack, links }, kinds = BUILT_IN_KINDS.map((k) => k.id)) {
  const nm = String(name || "").trim().slice(0, 60);
  if (!nm) return { error: "Give it a name." };
  const u = UNITS[unit] ? unit : "pcs", p = Number(pack);
  if (!(p > 0 && p <= 100000)) return { error: "How much do you usually buy at once? Type a number." };
  const item = { name: nm, kind: kind && kinds.includes(kind) ? kind : "food", unit: u, pack: Math.round(p * 10) / 10 };
  // Used in meals: rows with no food picked are skipped, a food picked twice counts once.
  // Only food can be used in meals; other kinds drop the rows.
  if (item.kind === "food") {
    const seen = new Set(), out = [];
    for (const a of (links || []).filter((x) => x && x.food)) {
      if (seen.has(a.food)) continue;
      const v = Number(a.per100);
      if (!(v > 0 && v <= (u === "pcs" ? 100 : 1000))) return { error: u === "pcs" ? `How many ${nm} in 100 g of each meal food? Like 0.5 for half.` : `How much ${nm} is in 100 g of each meal food? Like 40 for 40 ${u}.` };
      seen.add(a.food); out.push({ food: String(a.food), per100: Math.round(v * 100) / 100 });
    }
    if (out.length > LINKS_MAX) return { error: `Up to ${LINKS_MAX} meal foods.` };
    if (out.length) item.links = out;
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
