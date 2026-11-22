// Meals journal maths. Pure: no Firebase, no DOM (tests in tests/meals.test.mjs).
//   foods/{auto id}     { name, kcal, carb, protein, fat }  per 100 g, shared by both people
//   mealSets/{auto id}  { name, items: [{ food, g }], slots? } a plate eaten often, shared; g = starting grams;
//                       slots = the meals it's offered at (breakfast|lunch|dinner|snack), missing = all
//   meals/{auto id}     { person, date, slot, name, items: [{ food, name, g, kcal, carb, protein, fat }], at }
//                       one per meal logged; numbers are copied in, so editing a food later never changes history
export const SLOTS = { breakfast: "Breakfast", lunch: "Lunch", dinner: "Dinner", snack: "Snack" };
export const MACROS = ["kcal", "carb", "protein", "fat"];
export const LEARN_AFTER = 3; // weigh a food this many times and its usual grams are trusted

const round = (n) => Math.round(n);
const r1 = (n) => Math.round(n * 10) / 10;

// The slot that fits the time of day.
export function slotAt(hour) {
  return hour < 11 ? "breakfast" : hour < 16 ? "lunch" : hour < 21 ? "dinner" : "snack";
}

// Numbers for g grams of a food given per 100 g.
export function portion(food, g) {
  const f = g / 100;
  return { kcal: round((food.kcal || 0) * f), carb: r1((food.carb || 0) * f), protein: r1((food.protein || 0) * f), fat: r1((food.fat || 0) * f) };
}

// Sum of kcal, carb, protein and fat over items (logged items or whole meals).
export function total(items) {
  const t = { kcal: 0, carb: 0, protein: 0, fat: 0 };
  for (const it of items) for (const k of MACROS) t[k] += Number(it[k]) || 0;
  return { kcal: round(t.kcal), carb: r1(t.carb), protein: r1(t.protein), fat: r1(t.fat) };
}
export const mealTotal = (meal) => total(meal.items || []);
export const dayTotal = (meals) => total(meals.map(mealTotal));

// How much this person usually takes of a food: the median of their last 5 portions, to the nearest 5 g.
// { g, n } with n = how many times it was logged in all, or null if never.
export function usual(meals, person, foodId) {
  const gs = [];
  const mine = meals.filter((m) => m.person === person).sort((a, b) => (a.date + (a.at || 0)).localeCompare(b.date + (b.at || 0)));
  for (const m of mine) for (const it of m.items || []) if (it.food === foodId && it.g > 0) gs.push(it.g);
  if (!gs.length) return null;
  const last = gs.slice(-5).sort((a, b) => a - b), mid = last.length >> 1;
  const med = last.length % 2 ? last[mid] : (last[mid - 1] + last[mid]) / 2;
  return { g: Math.max(5, Math.round(med / 5) * 5), n: gs.length };
}

// The plate to show when a set is picked: each food at the person's usual grams once learned, else the set's grams.
// Foods deleted from the library are left out. Each row: { food, name, g, learned, per100 }.
export function plateOf(set, foods, meals, person) {
  const byId = new Map(foods.map((f) => [f.id, f]));
  return (set.items || []).filter((it) => byId.has(it.food)).map((it) => {
    const f = byId.get(it.food), u = usual(meals, person, it.food);
    const learned = !!u && u.n >= LEARN_AFTER;
    return { food: f.id, name: f.name, g: learned ? u.g : it.g || u?.g || 100, learned, n: u?.n || 0, per100: f };
  });
}
// One food added to a plate by hand.
export function rowFor(food, meals, person) {
  const u = usual(meals, person, food.id), learned = !!u && u.n >= LEARN_AFTER;
  return { food: food.id, name: food.name, g: u?.g || 100, learned, n: u?.n || 0, per100: food };
}

// What gets saved for each row of a plate.
export function logItems(rows) {
  return rows.filter((r) => r.g > 0).map((r) => ({ food: r.food, name: r.name, g: round(r.g), ...portion(r.per100, r.g) }));
}

// Whether a set is offered for a meal. A set's `slots` lists the meals it's eaten at; none listed = any meal.
export function fitsSlot(set, slot) {
  return !Array.isArray(set.slots) || !set.slots.length || set.slots.includes(slot);
}

// Sets in the order to offer them: the ones this person logs most first, then by name.
export function rankSets(sets, meals, person) {
  const n = {};
  for (const m of meals) if (m.person === person && m.set) n[m.set] = (n[m.set] || 0) + 1;
  return [...sets].sort((a, b) => (n[b.id] || 0) - (n[a.id] || 0) || a.name.localeCompare(b.name));
}

// ---------- calories in vs a range for your BMI ----------
// burns/{person}_{date} → { person, date, kcal }: a day's total burn typed from a watch or machine (optional).
export const ACTIVITY = 1.35; // light daily movement on top of resting burn; runs are added on their own
export const PACE_KCAL = 550; // about 0.5 kg a week, the journal's goal pace

// Resting burn (Mifflin-St Jeor), kcal a day.
export function bmr(p, kg) {
  return 10 * kg + 6.25 * p.cm - 5 * p.age + (p.sex === "Female" ? -161 : 5);
}
// The day's burn: what the watch said if typed, else an estimate plus any run's kcal.
export function burnOf(p, kg, { runKcal = 0, measured } = {}) {
  if (measured > 0) return { kcal: Math.round(measured), measured: true };
  return { kcal: Math.round((bmr(p, kg) * ACTIVITY + runKcal) / 10) * 10, measured: false };
}
// How much to eat: below the burn when BMI is over 25, above it under 18.5, close to it in the normal range.
// Never below a safe floor. { lo, hi, goal: "lose" | "keep" | "gain" }
export function intakeRange(p, kg, burn) {
  const b = kg / (p.cm / 100) ** 2, floor = p.sex === "Female" ? 1200 : 1500;
  const [goal, a, z] = b >= 25 ? ["lose", -PACE_KCAL - 150, -PACE_KCAL + 250] : b < 18.5 ? ["gain", 250, 500] : ["keep", -200, 200];
  const r10 = (n) => Math.round(n / 10) * 10;
  const lo = Math.max(floor, r10(burn + a)), hi = Math.max(lo + 200, r10(burn + z));
  return { lo, hi, goal };
}
// The weight to use for a day: the last weigh-in on or before it, else the first one. null if none.
export function weightOn(entries, person, date) {
  const ws = entries.filter((e) => e.person === person && typeof e.weight === "number").sort((a, b) => a.date.localeCompare(b.date));
  if (!ws.length) return null;
  let w = ws[0].weight;
  for (const e of ws) if (e.date <= date) w = e.weight;
  return w;
}
// Where a day's intake sits against its range. Days with nothing logged aren't judged.
export function verdict(eaten, range) {
  if (!eaten) return "none";
  return eaten < range.lo ? "under" : eaten > range.hi ? "over" : "in";
}

// Colour step for the year strip: how far a day's intake sits from its range. FAR kcal past the edge = "far".
export const FAR = 400;
export function shadeOf(eaten, range) {
  if (!eaten) return "none";
  if (eaten < range.lo) return eaten < range.lo - FAR ? "farunder" : "under";
  if (eaten > range.hi) return eaten > range.hi + FAR ? "farover" : "over";
  return "in";
}
// Totals for the year tiles, from day infos { eaten, v }. Unlogged days are skipped, so they never
// break a streak: the streak only counts logged days in a row that were in range.
export function yearStats(days) {
  let logged = 0, inR = 0, sum = 0, run = 0, best = 0;
  for (const x of days) {
    if (!x.eaten) continue;
    logged++; sum += x.eaten;
    if (x.v === "in") { inR++; run++; best = Math.max(best, run); } else run = 0;
  }
  return { logged, inPct: logged ? Math.round((inR / logged) * 100) : 0, avg: logged ? Math.round(sum / logged) : 0, best };
}

// Checks a food typed into the library. Returns { food } or { error }.
export function readFood({ name, kcal, carb, protein, fat }) {
  const nm = String(name || "").trim();
  if (!nm) return { error: "Give the food a name." };
  const nums = { kcal, carb, protein, fat }, out = { name: nm.slice(0, 60) };
  for (const [k, v] of Object.entries(nums)) {
    if (v === "" || v == null) { if (k === "kcal") return { error: "Add the calories per 100 g." }; out[k] = 0; continue; }
    const x = Number(v), max = k === "kcal" ? 900 : 100;
    if (!(x >= 0 && x <= max)) return { error: k === "kcal" ? "Calories per 100 g go from 0 to 900." : "Carbs, protein and fat per 100 g go from 0 to 100 g." };
    out[k] = r1(x);
  }
  if (out.carb + out.protein + out.fat > 100) return { error: "Carbs, protein and fat add up to more than 100 g. Check the numbers." };
  return { food: out };
}
