// The Meals journal page (#meals view): pick a saved meal set, check the grams, add it to a meal.
// Also the food library (per 100 g) and the meal sets. Maths lives in meals.js; data model is described there.
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where } from "../../core/fs.js";
import { SLOTS, LEARN_AFTER, slotAt, portion, total, dayTotal, plateOf, rowFor, logItems, rankSets, readFood, fitsSlot, burnOf, intakeRange, weightOn, verdict, shadeOf, yearStats } from "../../logic/meals.js";

import { money, SERVES_MAX } from "../../logic/stocky.js";
import { offerWidget } from "../../shell/widget.js";
import { confirmDelete } from "../../core/confirm.js";
import { $, esc, iso, parse, addDays, today } from "../../core/util.js";
import { currentJournal, setJournal } from "../../core/journal.js";

const num = (n) => (Math.round(n * 10) / 10).toLocaleString();

let commit, me, people, entries, stock, foodsCol, setsCol, mealsCol, burnsCol, unsubs = [];
let foods = [], sets = [], meals = [], burns = {};
// Who the meals are for: picked on the card, starting from the "For" switch at the top.
let whoId = null;
const who = () => (people().some((p) => p.id === whoId) ? whoId : me());
const CAL_DAYS = 14;
let burnEdit = null; // the person whose watch burn is being typed
// The plate being put together on the card.
let date = today(), slot = slotAt(new Date().getHours()), picked = null, rows = [], naming = false, cardMsg = "";
// Library editing: { kind: "food"|"set", id|null }. Deletes ask through confirmDelete().
let moreSets = false; // showing other meals' sets on the card
let editing = null, setRows = [], setSlots = [], libMsg = "";
// How the set being edited is made: "cooked" (ingredients from the Price book) or "bought" (a price per plate).
let setMade = "", setIngr = [], setServes = "", setPrice = "";
let setTitle = ""; // the name typed in the set form, kept when the form redraws

export function initMeals(opts) {
  ({ commit, me, people, entries } = opts);
  // Stocky hooks (stockyui.js, passed in by app.js): { of(foodId), list(foodId), items(), cost(set), changed() }.
  stock = { of: () => null, list: () => {}, items: () => [], cost: () => null, changed: () => {}, ...opts.stock };
  const db = opts.db;
  foodsCol = collection(db, "foods");
  setsCol = collection(db, "mealSets");
  mealsCol = collection(db, "meals");
  burnsCol = collection(db, "burns");
  wire();
}
export function startMeals() {
  unsubs.push(onSnapshot(foodsCol, (s) => { foods = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byName); refreshMeals(); stock.changed(); }));
  unsubs.push(onSnapshot(setsCol, (s) => { sets = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort(byName); refreshMeals(); stock.changed(); }));
  // A year and a bit: enough for the year strip and to learn usual portions.
  unsubs.push(onSnapshot(query(mealsCol, where("date", ">=", addDays(today(), -380))), (s) => { meals = s.docs.map((d) => ({ id: d.id, ...d.data() })); renderPicker(); renderDay(); refreshCalories(); stock.changed(); }));
  unsubs.push(onSnapshot(query(burnsCol, where("date", ">=", addDays(today(), -380))), (s) => { burns = Object.fromEntries(s.docs.map((d) => [d.id, d.data()])); refreshCalories(); }));
}
// Foods, sets and meals for Stocky (it reads them, never writes meals).
export const mealData = () => ({ foods, sets, meals });
export function stopMeals() { unsubs.forEach((u) => u()); unsubs = []; }
const byName = (a, b) => String(a.name).localeCompare(String(b.name));

export function refreshMeals() {
  if (!$("mealCard") || !people().length) return;
  // Drop plate rows whose food was deleted.
  rows = rows.filter((r) => foods.some((f) => f.id === r.food)).map((r) => ({ ...r, per100: foods.find((f) => f.id === r.food) }));
  renderCard();
  renderDay();
  renderLib();
  refreshCalories();
}

// ---------- the card ----------
function renderCard() {
  $("mealCard").innerHTML = `
    <div class="mhead"><h2 id="mealTitle">Add a meal</h2>
      <label class="mealdate">Day<input type="date" id="mealDate" value="${esc(date)}" max="${today()}"></label></div>
    <div class="lbl mwho"><span>Who</span><div class="seg">${people().map((p) => `<input type="radio" name="mealWho" id="mw-${p.id}" value="${p.id}"${p.id === who() ? " checked" : ""}><label for="mw-${p.id}">${esc(p.name)}</label>`).join("")}</div></div>
    <div class="chips" role="group" aria-label="Which meal">${Object.entries(SLOTS).map(([k, v]) => `<button type="button" class="chip" data-slot="${k}" aria-pressed="${k === slot}">${v}</button>`).join("")}</div>
    <div id="mealPicker"></div>
    <div id="mealPlate"></div>
    <p class="note" id="mealMsg" role="status">${esc(cardMsg)}</p>
    <a class="btn more" href="#mealsets">Meal sets and foods →</a>`;
  renderPicker();
  renderPlate();
}

function renderPicker() {
  const host = $("mealPicker"); if (!host) return;
  if (!foods.length) {
    host.innerHTML = `<div class="mempty"><p><b>Start with the foods you usually eat.</b></p><p class="note">Add each food once with its calories, carbs, protein and fat per 100 g. Then put them together into meal sets, like "Nasi + patin + sayur".</p><a class="btn primary" href="#mealsets" data-act="go-lib">Add your foods</a></div>`;
    return;
  }
  // Only the sets that belong to this meal; the rest wait behind "Other meals' sets".
  const ranked = rankSets(sets, meals, who()), fit = ranked.filter((s) => fitsSlot(s, slot)), rest = ranked.filter((s) => !fitsSlot(s, slot));
  const chip = (s) => `<button type="button" class="chip" data-set="${esc(s.id)}" aria-pressed="${picked === s.id}">${esc(s.name)}</button>`;
  const showRest = moreSets || rest.some((s) => s.id === picked);
  host.innerHTML = `<p class="mwhat">What did you eat for ${slot === "snack" ? "a snack" : SLOTS[slot].toLowerCase()}?</p>
    <div class="chips">${fit.map(chip).join("")}
      <button type="button" class="chip" data-set="" aria-pressed="${picked === ""}">Something else</button>
      ${rest.length && !showRest ? `<button type="button" class="chip more" data-act="more-sets">Other meals' sets (${rest.length})</button>` : ""}</div>
    ${rest.length && showRest ? `<p class="note">Sets for other meals</p><div class="chips">${rest.map(chip).join("")}</div>` : ""}
    ${sets.length ? fit.length ? "" : `<p class="note">No sets for ${slot === "snack" ? "snacks" : SLOTS[slot].toLowerCase()} yet. Pick "Something else", add foods, then save it as a set.</p>`
      : `<p class="note">No meal sets yet. Pick "Something else", add foods, then save it as a set.</p>`}`;
}

function renderPlate() {
  const host = $("mealPlate"); if (!host) return;
  if (picked === null) { host.innerHTML = ""; return; }
  const left = foods.filter((f) => !rows.some((r) => r.food === f.id));
  const t = total(rows.map((r) => portion(r.per100, r.g || 0)));
  host.innerHTML = `<div class="plate">
    ${rows.map((r, i) => `<div class="prow">
      <div class="pname">${esc(r.name)}<small>${r.learned ? `your usual ${r.g} g` : r.n ? `weighed ${r.n} of ${LEARN_AFTER} times` : "weigh it the first time"}</small></div>
      <div class="grams"><button type="button" class="mini" data-step="-10" data-i="${i}" aria-label="10 g less">−</button><input type="number" inputmode="numeric" min="0" max="3000" value="${r.g}" data-i="${i}" aria-label="${esc(r.name)}, grams"><span>g</span><button type="button" class="mini" data-step="10" data-i="${i}" aria-label="10 g more">+</button></div>
      <b class="pk" id="pk-${i}">${portion(r.per100, r.g || 0).kcal}</b>
      <button type="button" class="mini" data-act="drop" data-i="${i}" aria-label="Take ${esc(r.name)} off the plate">✕</button>
    </div>`).join("") || `<p class="note">Add the foods on your plate.</p>`}
    ${stockHtml()}
    ${left.length ? `<select id="mealAddFood" aria-label="Add a food"><option value="">+ Add a food</option>${left.map((f) => `<option value="${esc(f.id)}">${esc(f.name)}</option>`).join("")}</select>` : ""}
    <div class="mtot" id="mealTot">${totHtml(t)}</div>
    <p class="note mcost" id="mealCost">${plateCost()}</p>
    ${naming ? `<div class="addrow1"><input type="text" id="setName" maxlength="60" placeholder="Name, like Nasi + patin + sayur" aria-label="Set name"><button type="button" data-act="save-set" class="primary">Save set</button><button type="button" data-act="name-no">Cancel</button></div>` : ""}
    <div class="actions">
      <button type="button" class="primary" data-act="log"${rows.length ? "" : " disabled"}>Add to ${SLOTS[slot].toLowerCase()}</button>
      ${rows.length && changed() && !naming ? `<button type="button" data-act="name">Save as a set</button>` : ""}
      <button type="button" data-act="clear">Cancel</button>
    </div></div>`;
}
// Foods on the plate that Stocky says are low or out at home.
function stockHtml() {
  const low = rows.map((r) => ({ food: r.food, s: stock.of(r.food) })).filter(({ s }) => s && ["low", "out"].includes(s.status));
  if (!low.length) return "";
  const line = (s) => (s.status === "out" ? `Probably out of <b>${esc(s.name)}</b>` : `Low on <b>${esc(s.name)}</b>${s.daysLeft != null ? `, about ${s.daysLeft} day${s.daysLeft === 1 ? "" : "s"} left` : ""}`);
  return `<div class="mstock">${low.map(({ food, s }) => `<p><span>🛒 ${line(s)}</span>
    ${s.listed ? `<span class="note">On the list</span>` : `<button type="button" class="mini" data-act="stock-list" data-food="${esc(food)}">Add to list</button>`}</p>`).join("")}</div>`;
}
const totHtml = (t) => `<div><b>${t.kcal}</b><small>kcal</small></div><div><b>${num(t.carb)}</b><small>carbs g</small></div><div><b>${num(t.protein)}</b><small>protein g</small></div><div><b>${num(t.fat)}</b><small>fat g</small></div>`;
// What the picked set costs a plate (from the Price book), while the plate is still that set.
function plateCost() {
  const s = sets.find((x) => x.id === picked);
  return s && !changed() ? costLine(s) : "";
}
// One line saying how a set is made and what a plate costs. Ingredients with no price yet are named, never counted as free.
function costLine(s) {
  if (s.made !== "cooked" && s.made !== "bought") return "";
  const c = stock.cost(s);
  if (s.made === "bought") return c ? `🛍️ Bought · <b>${money(c.plate)}</b> a plate` : "🛍️ Bought";
  if (!c) return "🍳 Cooked · add what goes in the pot to see the cost";
  const none = c.missing.length ? `no price yet for ${esc(c.missing.join(", "))}` : "";
  if (!c.priced) return `🍳 Cooked · ${none}`;
  return `🍳 Cooked · about <b>${money(c.plate)}</b> a plate${c.serves > 1 ? ` (${money(c.pot)} makes ${c.serves})` : ""}${none ? ` · ${none}` : ""}`;
}
// Prices in Stocky changed: update the costs shown, but never redraw a set form someone is filling in.
export function refreshMealCost() {
  const el = $("mealCost"); if (el) el.innerHTML = plateCost();
  if (!editing) renderLib();
}
// True when the foods on the plate aren't the picked set's.
function changed() {
  const s = sets.find((x) => x.id === picked);
  if (!s) return true;
  const a = (s.items || []).map((x) => x.food).filter((id) => foods.some((f) => f.id === id)).sort().join(), b = rows.map((r) => r.food).sort().join();
  return a !== b;
}
function updateTotals() {
  rows.forEach((r, i) => { const el = $("pk-" + i); if (el) el.textContent = portion(r.per100, r.g || 0).kcal; });
  const el = $("mealTot"); if (el) el.innerHTML = totHtml(total(rows.map((r) => portion(r.per100, r.g || 0))));
}

function pick(id) {
  picked = id; naming = false; cardMsg = "";
  const s = sets.find((x) => x.id === id);
  rows = s ? plateOf(s, foods, meals, who()) : [];
  renderPicker(); renderPlate(); setMsg("");
}
function setMsg(t) { cardMsg = t; const el = $("mealMsg"); if (el) el.textContent = t; }

async function logMeal() {
  const items = logItems(rows);
  if (!items.length) { setMsg("Put the grams in for at least one food."); return; }
  if (rows.some((r) => !(r.g >= 0 && r.g <= 3000))) { setMsg("Grams go from 0 to 3000."); return; }
  const s = sets.find((x) => x.id === picked) && !changed() ? sets.find((x) => x.id === picked) : null;
  const name = (s ? s.name : items.map((x) => x.name).join(" + ")).slice(0, 80);
  const body = { person: who(), date, slot, name, items, at: Date.now() };
  if (s) body.set = s.id;
  const kcal = total(items).kcal, where = SLOTS[slot].toLowerCase(), day = date === today() ? "" : ` on ${parse(date).toLocaleDateString(undefined, { day: "numeric", month: "short" })}`;
  picked = null; rows = []; naming = false;
  renderPicker(); renderPlate();
  setMsg(`Added to ${where}${day}: ${kcal} kcal.`);
  await commit(() => setDoc(doc(mealsCol), body));
}

async function saveSetFromPlate() {
  const name = $("setName").value.trim();
  if (!name) { setMsg("Give the set a name."); return; }
  if (sets.some((s) => s.name.toLowerCase() === name.toLowerCase())) { setMsg("There's already a set with that name."); return; }
  const ref = doc(setsCol);
  naming = false;
  await commit(() => setDoc(ref, { name, items: rows.map((r) => ({ food: r.food, g: Math.round(r.g) || 100 })), slots: [slot], created: Date.now(), updated: Date.now() })); // offered at this meal; change it on the sets page
  picked = ref.id;
  renderPicker(); renderPlate();
  setMsg(`Saved "${name}". Next time it's one tap.`);
}

// ---------- the day ----------
function renderDay() {
  const host = $("mealDay"); if (!host) return;
  const mine = meals.filter((m) => m.person === who() && m.date === date).sort((a, b) => (a.at || 0) - (b.at || 0));
  const t = dayTotal(mine), label = date === today() ? "Today" : parse(date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" });
  host.innerHTML = `<h2>${esc(label)}</h2>
    <div class="mtot">${totHtml(t)}</div>
    ${mine.length ? Object.keys(SLOTS).map((k) => {
      const ms = mine.filter((m) => m.slot === k);
      if (!ms.length) return "";
      return `<div class="mslot"><h3>${SLOTS[k]}</h3>${ms.map((m) => `<div class="mlog">
        <div><b>${esc(m.name)}</b><small>${esc((m.items || []).map((x) => `${x.name} ${x.g} g`).join(" · "))}</small></div>
        <span>${total(m.items || []).kcal} kcal</span>
        <button type="button" class="mini" data-ask-meal="${esc(m.id)}">Delete</button>
      </div>`).join("")}</div>`;
    }).join("") : `<p class="note">Nothing logged for this day yet.</p>`}`;
}

// ---------- the library ----------
function renderLib() {
  const host = $("mealLib"); if (!host) return;
  const fname = (id) => foods.find((f) => f.id === id)?.name;
  const delBtns = (kind, id) => `<button type="button" class="mini" data-act="edit" data-kind="${kind}" data-id="${esc(id)}">Edit</button><button type="button" class="mini" data-act="del" data-kind="${kind}" data-id="${esc(id)}">Delete</button>`;
  const ed = (kind, id) => editing && editing.kind === kind && editing.id === id;
  host.innerHTML = `<h2>Your meal sets</h2>
    <p class="note">A set is a plate you eat often. The grams here are a starting point: after you weigh a food ${LEARN_AFTER} times, your usual amount is filled in for you.</p>
    <div class="mlist">${sets.map((s) => ed("set", s.id) ? setForm(s) : `<div class="mitem"><div><b>${esc(s.name)}</b><small class="slottags">${(s.slots?.length ? s.slots.filter((k) => SLOTS[k]).map((k) => SLOTS[k]) : ["Any meal"]).map((t) => `<span>${esc(t)}</span>`).join("")}</small><small>${esc((s.items || []).filter((x) => fname(x.food)).map((x) => `${fname(x.food)} ${x.g} g`).join(" · ") || "No foods")}</small>${s.made ? `<small class="mcost">${costLine(s)}</small>` : ""}</div><span class="btns">${delBtns("set", s.id)}</span></div>`).join("")}</div>
    ${ed("set", null) ? setForm(null) : foods.length ? `<button type="button" data-act="new" data-kind="set">+ New meal set</button>` : ""}
    <h2 id="foodLib">Your foods <small>per 100 g</small></h2>
    <p class="note">Find the numbers on the pack or a nutrition website. They're for 100 g, so any portion works them out.</p>
    <div class="mlist">${foods.map((f) => ed("food", f.id) ? foodForm(f) : `<div class="mitem"><div><b>${esc(f.name)}</b><small>${f.kcal} kcal · carbs ${num(f.carb || 0)} g · protein ${num(f.protein || 0)} g · fat ${num(f.fat || 0)} g</small></div><span class="btns">${delBtns("food", f.id)}</span></div>`).join("")}</div>
    ${ed("food", null) ? foodForm(null) : `<button type="button" data-act="new" data-kind="food">+ New food</button>`}
    <p class="note" id="libMsg" role="status">${esc(libMsg)}</p>`;
}
function foodForm(f) {
  const v = (k) => (f && f[k] != null ? esc(f[k]) : "");
  return `<form class="mform" data-form="food" novalidate>
    <label>Food<input type="text" name="name" maxlength="60" value="${v("name")}" placeholder="Ikan patin goreng"></label>
    <div class="four">
      <label>kcal<input type="number" name="kcal" inputmode="decimal" min="0" max="900" value="${v("kcal")}"></label>
      <label>Carbs g<input type="number" name="carb" inputmode="decimal" min="0" max="100" step="0.1" value="${v("carb")}"></label>
      <label>Protein g<input type="number" name="protein" inputmode="decimal" min="0" max="100" step="0.1" value="${v("protein")}"></label>
      <label>Fat g<input type="number" name="fat" inputmode="decimal" min="0" max="100" step="0.1" value="${v("fat")}"></label>
    </div>
    <div class="actions"><button type="submit" class="primary">${f ? "Save changes" : "Add food"}</button><button type="button" data-act="cancel">Cancel</button></div>
  </form>`;
}
function setForm(s) {
  return `<form class="mform" data-form="set" novalidate>
    <label>Set name<input type="text" name="name" maxlength="60" value="${esc(setTitle)}" placeholder="Nasi + patin + sayur"></label>
    <fieldset class="slotpick"><legend>Eaten at</legend><div class="chips">${Object.entries(SLOTS).map(([k, v]) => `<label class="chip"><input type="checkbox" name="slots" value="${k}"${setSlots.includes(k) ? " checked" : ""}> ${v}</label>`).join("")}</div>
      <small class="note">It's offered only at these meals. Leave all empty for any meal.</small></fieldset>
    ${setRows.map((r, i) => `<div class="srow">
      <select data-srow="${i}" aria-label="Food ${i + 1}"><option value="">Pick a food</option>${foods.map((f) => `<option value="${esc(f.id)}"${f.id === r.food ? " selected" : ""}>${esc(f.name)}</option>`).join("")}</select>
      <label class="inline"><input type="number" data-sg="${i}" min="1" max="3000" inputmode="numeric" value="${r.g}" aria-label="Grams"> g</label>
      <button type="button" class="mini" data-act="srow-drop" data-i="${i}" aria-label="Remove">✕</button></div>`).join("")}
    <button type="button" class="mini" data-act="srow-add">+ Another food</button>
    <fieldset class="madepick"><legend>Made</legend>
      <div class="seg">${[["cooked", "🍳 Cooked"], ["bought", "🛍️ Bought"]].map(([k, v]) => `<input type="radio" name="made" id="made-${k}" value="${k}"${setMade === k ? " checked" : ""}><label for="made-${k}">${v}</label>`).join("")}</div>
      ${setMade === "cooked" ? cookedHtml() : setMade === "bought" ? boughtHtml() : `<small class="note">Cooked at home or bought outside? Pick one to see what a plate costs.</small>`}
    </fieldset>
    <div class="actions"><button type="submit" class="primary">${s ? "Save changes" : "Save set"}</button><button type="button" data-act="cancel">Cancel</button></div>
  </form>`;
}
// Cooked: what goes in the whole pot, picked from the Price book, and how many plates it makes.
function cookedHtml() {
  const items = stock.items();
  if (!items.length) return `<p class="note">Nothing in the Price book yet. <a href="#stocky/add">Add the ingredients in Stocky</a> first, then pick them here.</p>`;
  const unitOf = (id) => items.find((x) => x.id === id)?.unit || "g";
  return `<small class="note">What goes in the whole pot, from the Price book.</small>
    ${setIngr.map((r, i) => `<div class="srow">
      <select data-irow="${i}" aria-label="Ingredient ${i + 1}"><option value="">Pick an ingredient</option>${items.map((x) => `<option value="${esc(x.id)}"${x.id === r.item ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select>
      <label class="inline"><input type="number" data-iq="${i}" min="0" step="any" inputmode="decimal" value="${esc(r.qty)}" aria-label="How much"> ${unitOf(r.item)}</label>
      <button type="button" class="mini" data-act="irow-drop" data-i="${i}" aria-label="Remove">✕</button></div>`).join("")}
    <button type="button" class="mini" data-act="irow-add">+ Another ingredient</button>
    <label class="inline mserves">Makes <input type="number" name="serves" min="1" max="${SERVES_MAX}" inputmode="numeric" value="${esc(setServes)}" placeholder="1" aria-label="How many plates"> plates</label>`;
}
function boughtHtml() {
  return `<label class="inline mserves">One plate costs RM <input type="number" name="price" min="0" max="1000" step="0.1" inputmode="decimal" value="${esc(setPrice)}" placeholder="8.50" aria-label="Price of one plate"></label>
    <small class="note">Bought outside, so no ingredients to look up.</small>`;
}
function libSay(t) { libMsg = t; const el = $("libMsg"); if (el) el.textContent = t; }

async function submitFood(form) {
  const fd = Object.fromEntries(new FormData(form));
  const { food, error } = readFood(fd);
  if (error) { libSay(error); return; }
  const id = editing.id;
  if (foods.some((f) => f.id !== id && f.name.toLowerCase() === food.name.toLowerCase())) { libSay("That food is already in the list."); return; }
  editing = null; libMsg = id ? `Saved ${food.name}.` : `Added ${food.name}.`;
  const now = Date.now(), was = id ? foods.find((f) => f.id === id) : null;
  await commit(() => setDoc(id ? doc(foodsCol, id) : doc(foodsCol), { ...food, created: was?.created || now, updated: now }));
  renderLib();
}
async function submitSet(form) {
  const name = form.elements.name.value.trim(), items = setRows.filter((r) => r.food).map((r) => ({ food: r.food, g: Math.round(Number(r.g)) || 0 }));
  if (!name) { libSay("Give the set a name."); return; }
  if (!items.length) { libSay("Pick at least one food."); return; }
  if (items.some((x) => !(x.g >= 1 && x.g <= 3000))) { libSay("Grams go from 1 to 3000."); return; }
  const id = editing.id;
  if (sets.some((s) => s.id !== id && s.name.toLowerCase() === name.toLowerCase())) { libSay("There's already a set with that name."); return; }
  const slots = Object.keys(SLOTS).filter((k) => setSlots.includes(k));
  const { made, error } = readMade();
  if (error) { libSay(error); return; }
  editing = null; setRows = []; setSlots = []; setMade = ""; setIngr = []; setTitle = ""; libMsg = `Saved "${name}".`;
  const now = Date.now(), times = { created: sets.find((s) => s.id === id)?.created || now, updated: now };
  await commit(() => setDoc(id ? doc(setsCol, id) : doc(setsCol), { name, items, ...(slots.length ? { slots } : {}), ...made, ...times }));
  renderLib();
}

// The "Made" part of the set form as fields to save: {} when not picked.
function readMade() {
  if (setMade === "bought") {
    if (setPrice === "" || setPrice == null) return { made: { made: "bought" } };
    const price = Math.round(Number(setPrice) * 100) / 100;
    return price > 0 && price <= 1000 ? { made: { made: "bought", price } } : { error: "A plate costs between RM 0.10 and RM 1000." };
  }
  if (setMade !== "cooked") return { made: {} };
  const ingredients = setIngr.filter((r) => r.item).map((r) => ({ item: r.item, qty: Number(r.qty) || 0 }));
  if (ingredients.some((r) => !(r.qty > 0 && r.qty <= 100000))) return { error: "Put how much of each ingredient goes in the pot." };
  const serves = setServes === "" ? 1 : Math.round(Number(setServes));
  if (!(serves >= 1 && serves <= SERVES_MAX)) return { error: `A pot makes 1 to ${SERVES_MAX} plates.` };
  return { made: { made: "cooked", ingredients, serves } };
}

// ---------- events ----------
function wire() {
  const card = $("mealCard");
  card.addEventListener("click", (ev) => {
    if (ev.target.closest("[data-act=go-lib]")) { editing = { kind: "food", id: null }; renderLib(); return; }
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.slot) { slot = b.dataset.slot; moreSets = false; card.querySelectorAll("[data-slot]").forEach((x) => x.setAttribute("aria-pressed", x === b)); renderPicker(); renderPlate(); return; }
    if (b.dataset.act === "more-sets") { moreSets = true; renderPicker(); return; }
    if (b.dataset.set !== undefined) { pick(b.dataset.set); return; }
    if (b.dataset.step) {
      const r = rows[+b.dataset.i]; r.g = Math.max(0, Math.round((Number(r.g) || 0) + Number(b.dataset.step)));
      const inp = card.querySelector(`input[data-i="${b.dataset.i}"]`); if (inp) inp.value = r.g;
      updateTotals(); return;
    }
    const act = b.dataset.act;
    if (act === "drop") { rows.splice(+b.dataset.i, 1); renderPlate(); }
    if (act === "clear") { picked = null; rows = []; naming = false; renderPicker(); renderPlate(); setMsg(""); }
    if (act === "log") logMeal();
    if (act === "name") { naming = true; renderPlate(); $("setName")?.focus(); }
    if (act === "name-no") { naming = false; renderPlate(); }
    if (act === "save-set") saveSetFromPlate();
    if (act === "stock-list") { b.replaceWith(Object.assign(document.createElement("span"), { className: "note", textContent: "On the list" })); stock.list(b.dataset.food); }
  });
  card.addEventListener("input", (ev) => {
    const i = ev.target.dataset.i;
    if (i !== undefined && ev.target.type === "number") { rows[+i].g = Number(ev.target.value) || 0; updateTotals(); }
  });
  card.addEventListener("change", (ev) => {
    if (ev.target.id === "mealDate") { setDate(ev.target.value); ev.target.value = date; }
    if (ev.target.name === "mealWho") { whoId = ev.target.value; picked = null; rows = []; naming = false; cardMsg = ""; burnEdit = null; renderCard(); renderDay(); refreshCalories(); }
    if (ev.target.id === "mealAddFood") { const f = foods.find((x) => x.id === ev.target.value); if (f) { rows.push(rowFor(f, meals, who())); renderPlate(); } }
  });
  card.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.id === "setName") { ev.preventDefault(); saveSetFromPlate(); } });

  $("mealDay").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.askMeal) {
      const id = b.dataset.askMeal, m = meals.find((x) => x.id === id); if (!m) return;
      const ok = await confirmDelete({ title: `Delete ${m.name} from ${SLOTS[m.slot]?.toLowerCase() || "this meal"}?`, yes: "Delete meal",
        body: `<p>${total(m.items || []).kcal} kcal${(m.items || []).length ? ` (${esc(m.items.map((x) => x.name).join(", "))})` : ""} comes off ${esc(parse(m.date).toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "short" }))}.</p>` });
      if (ok) await commit(() => deleteDoc(doc(mealsCol, id)));
    }
  });

  const lib = $("mealLib");
  lib.addEventListener("click", async (ev) => {
    const b = ev.target.closest("button"); if (!b || b.type === "submit") return;
    const { act, kind, id } = b.dataset;
    if (act === "new" || act === "edit") {
      editing = { kind, id: id || null }; libMsg = "";
      if (kind === "set") { const s = sets.find((x) => x.id === id); setRows = s ? (s.items || []).map((x) => ({ ...x })) : [{ food: "", g: 100 }]; setSlots = s ? [...(s.slots || [])] : []; setTitle = s?.name || "";
        setMade = s?.made || ""; setIngr = (s?.ingredients || []).map((x) => ({ ...x })); setServes = s?.serves ?? ""; setPrice = s?.price ?? ""; }
      renderLib(); lib.querySelector(".mform input")?.focus();
    }
    if (act === "cancel") { editing = null; setRows = []; setSlots = []; setMade = ""; setIngr = []; setTitle = ""; libMsg = ""; renderLib(); }
    if (act === "irow-add") { readSetRows(); setIngr.push({ item: "", qty: "" }); renderLib(); }
    if (act === "irow-drop") { readSetRows(); setIngr.splice(+b.dataset.i, 1); renderLib(); }
    if (act === "srow-add") { readSetRows(); setRows.push({ food: "", g: 100 }); renderLib(); }
    if (act === "srow-drop") { readSetRows(); setRows.splice(+b.dataset.i, 1); renderLib(); }
    if (act === "del") {
      const name = (kind === "food" ? foods : sets).find((x) => x.id === id)?.name || "";
      const inSets = kind === "food" ? sets.filter((s) => (s.items || []).some((x) => x.food === id)) : [];
      const ok = await confirmDelete({ title: kind === "food" ? `Delete the food ${name}?` : `Delete the meal set ${name}?`, yes: kind === "food" ? "Delete food" : "Delete set",
        body: kind === "food"
          ? `<p>Meals already logged keep their numbers.${inSets.length ? ` It's in ${inSets.length} meal set${inSets.length === 1 ? "" : "s"} (${esc(inSets.map((s) => s.name).join(", "))}), which will skip it.` : ""}</p>`
          : `<p>Meals already logged from it stay.</p>` });
      if (!ok) return;
      libMsg = kind === "food" ? `Deleted ${name}. Meals you already logged keep their numbers.` : `Deleted "${name}".`;
      if (picked === id) { picked = null; rows = []; renderPlate(); }
      await commit(() => deleteDoc(doc(kind === "food" ? foodsCol : setsCol, id)));
      renderLib();
    }
  });
  lib.addEventListener("submit", (ev) => {
    ev.preventDefault();
    if (ev.target.dataset.form === "food") submitFood(ev.target);
    if (ev.target.dataset.form === "set") { readSetRows(); submitSet(ev.target); }
  });
  lib.addEventListener("input", () => { if (libMsg) libSay(""); });
  // Picking Cooked / Bought, or an ingredient (its unit shows beside the amount), redraws the form.
  lib.addEventListener("change", (ev) => {
    const t = ev.target;
    if (t.name !== "made" && t.dataset.irow === undefined) return;
    readSetRows();
    if (t.name === "made" && setMade === "cooked" && !setIngr.length) setIngr.push({ item: "", qty: "" });
    renderLib();
  });

  // A new person picked with "For": start a fresh plate for them.
  $("me").addEventListener("change", () => { whoId = null; picked = null; rows = []; naming = false; cardMsg = ""; burnEdit = null; refreshMeals(); });
  $("setsBack").addEventListener("click", () => { location.hash = "#meals"; });
  wireCalories();
}
function setDate(d) {
  date = d && d <= today() ? d : today();
  burnEdit = null;
  const inp = $("mealDate"); if (inp) inp.value = date;
  renderDay(); refreshCalories();
}

// ---------- calories vs your range ----------
// The range comes from BMI: eat a bit under your burn when over 25, about the same when normal, a bit over when under 18.5.
// Days with nothing logged are skipped, never counted as zero: logging is optional.
function dayInfo(p, d) {
  const kg = weightOn(entries(), p.id, d);
  if (kg == null) return null;
  const run = entries().find((e) => e.person === p.id && e.date === d && e.run)?.run;
  const b = burnOf(p, kg, { runKcal: run?.kcal || 0, measured: burns[`${p.id}_${d}`]?.kcal });
  const range = intakeRange(p, kg, b.kcal);
  const eaten = dayTotal(meals.filter((m) => m.person === p.id && m.date === d)).kcal;
  return { d, kg, burn: b, range, eaten, v: verdict(eaten, range) };
}
// The Calories part of each person's card (the "mealsSlot-<id>" box under their weight). The day shown is the meal card's day.
export function refreshCalories() {
  if (!people().length) return;
  people().forEach((p) => {
    const slot = $("mealsSlot-" + p.id); if (!slot) return;
    slot.innerHTML = calHtml(p);
    const el = $("calChart-" + p.id); if (el) drawCal(el, calDays(p));
    const yr = $("calYear-" + p.id); if (yr) yr.scrollLeft = yr.scrollWidth; // start at this week, like GitHub
  });
}
// "14 days" or "Year", kept per phone.
let calView = (() => { try { return localStorage.getItem("journal-calview") === "year" ? "year" : "14"; } catch (_) { return "14"; } })();
const YEAR_WEEKS = 53;
// GitHub-style strip: one column per week (Monday at the top), the last 53 weeks up to today.
function yearHtml(p) {
  const t = today(), first = addDays(t, -((parse(t).getDay() + 6) % 7) - (YEAR_WEEKS - 1) * 7);
  const days = [];
  for (let d = first; d <= t; d = addDays(d, 1)) days.push({ d, x: dayInfo(p, d) });
  // Today isn't over, so it isn't counted in the tiles yet.
  const st = yearStats(days.filter((y) => y.x && y.d !== t).map((y) => y.x));
  const cs = 12, gap = 3, L = 26, T = 16, W = L + YEAR_WEEKS * (cs + gap), H = T + 7 * (cs + gap);
  let svg = "", lastM = -1;
  ["Mon", "", "Wed", "", "Fri", "", ""].forEach((l, i) => { if (l) svg += `<text x="0" y="${T + i * (cs + gap) + 10}">${l}</text>`; });
  days.forEach((y, i) => {
    const col = Math.floor(i / 7), row = i % 7, X = L + col * (cs + gap), Y = T + row * (cs + gap), m = parse(y.d).getMonth();
    if (row === 0 && m !== lastM) { if (col < YEAR_WEEKS - 1) svg += `<text x="${X}" y="11">${esc(parse(y.d).toLocaleDateString(undefined, { month: "short" }))}</text>`; lastM = m; }
    const shade = y.x ? (y.d === t && y.x.v === "under" ? "sofar" : shadeOf(y.x.eaten, y.x.range)) : "none";
    const tip = `${parse(y.d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short", year: "numeric" })}: ${y.x?.eaten ? `${y.x.eaten} kcal, range ${y.x.range.lo} to ${y.x.range.hi}` : "not logged"}`;
    svg += `<rect class="ysq ${shade}${y.d === date ? " sel" : ""}" data-day="${y.d}" x="${X}" y="${Y}" width="${cs}" height="${cs}" rx="3"><title>${esc(tip)}</title></rect>`;
  });
  return `<div class="tiles caltiles"><div class="tile"><b>${st.logged}</b>days logged</div><div class="tile"><b>${st.logged ? st.inPct + "%" : "–"}</b>in range</div><div class="tile"><b>${st.logged ? st.avg.toLocaleString() : "–"}</b>avg kcal</div><div class="tile"><b>${st.best}</b>best streak</div></div>
    <div class="calyear" id="calYear-${p.id}"><svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.name)}'s calories each day for the past year">${svg}</svg></div>
    <div class="callegend yleg"><span>Under</span><i class="ysq farunder"></i><i class="ysq under"></i><i class="ysq in"></i><i class="ysq over"></i><i class="ysq farover"></i><span>Over</span><span class="gapl"><i class="ysq none"></i>Not logged</span></div>
    <p class="week">Tap a day to open it. Days you skip stay grey and never break your streak.</p>`;
}
const calDays = (p) => Array.from({ length: CAL_DAYS }, (_, i) => dayInfo(p, addDays(today(), i - CAL_DAYS + 1))).filter(Boolean);
function calHtml(p) {
  const now = dayInfo(p, date);
  const head = `<div class="calhead"><h3 class="ptitle">Calories</h3><div class="chips" role="group" aria-label="Show">${[["14", "14 days"], ["year", "Year"]].map(([k, v]) => `<button type="button" class="chip" data-calview="${k}" aria-pressed="${calView === k}">${v}</button>`).join("")}</div></div>`;
  if (!now) return `${head}<p class="note">Add a weigh-in to see a calorie range.</p>`;
  const days = calDays(p), logged = days.filter((x) => x.eaten), inRange = logged.filter((x) => x.v === "in").length;
  const avg = logged.length ? Math.round(logged.reduce((a, x) => a + x.eaten, 0) / logged.length) : 0;
  const goalWord = { lose: "a little under the burn, to lose about 0.5 kg a week", keep: "close to the burn, to stay where you are", gain: "a little over the burn, to gain slowly" }[now.range.goal];
  const label = date === today() ? "today" : parse(date).toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const measured = now.burn.measured, editing = burnEdit === p.id;
  // Today isn't over, so being under the range is just "to go", not a mark against you.
  const pill = date === today() && now.v === "under" ? ["--line", `${(now.range.lo - now.eaten).toLocaleString()} kcal to go`]
    : { in: ["--good", "In range"], under: ["--under", "Under"], over: ["--over", "Over"] }[now.v];
  return `${head}
    <div class="calnow">
      <div class="stat"><small>Eaten ${esc(label)}</small><b>${now.eaten.toLocaleString()}</b><i>kcal</i></div>
      <div class="stat"><small>Range</small><b class="rng">${now.range.lo.toLocaleString()}–${now.range.hi.toLocaleString()}</b><i>kcal</i></div>
      ${pill ? `<span class="pill" style="--c:var(${pill[0]})">${pill[1]}</span>` : ""}
    </div>
    ${calView === "year" ? yearHtml(p) : `<div class="chart calchart" id="calChart-${p.id}"></div>
    <p class="week">${logged.length ? `Logged ${logged.length} of the last ${days.length} days, ${inRange} in range. Average ${avg.toLocaleString()} kcal on days logged.` : "No meals logged in the last two weeks."} Skipped days are simply left out.</p>`}
    <div class="burn">
      ${editing
        ? `<div class="addrow1"><input type="number" id="burnIn" inputmode="numeric" min="800" max="8000" placeholder="${now.burn.kcal}" value="${measured ? now.burn.kcal : ""}" aria-label="${esc(p.name)}, calories burned ${esc(label)}"><button type="button" class="primary" data-cal="save">Save</button><button type="button" data-cal="cancel">Cancel</button></div>
           <p class="note" id="burnMsg">The day's total burn from a watch or machine, active plus resting.</p>`
        : `<p class="note">Burn ${esc(label)}: <b class="ink">${now.burn.kcal.toLocaleString()} kcal</b> ${measured ? "from the watch" : "estimated from weight, height, age and runs"}. The range aims ${goalWord}.</p>
           <div class="actions"><button type="button" class="mini" data-cal="edit">${measured ? "Change burn" : "Enter burn from watch"}</button>${measured ? `<button type="button" class="mini" data-cal="clear">Use the estimate</button>` : ""}</div>`}
    </div>
  `;
}
// Bars of what was eaten on each day's shaded range. Tap a day to open it in the meal card.
function drawCal(host, days) {
  const W = host.clientWidth || 320, H = 160, m = { l: 34, r: 4, t: 12, b: 22 };
  const top = Math.max(...days.flatMap((x) => [x.range.hi, x.eaten])) * 1.1, step = top > 3000 ? 1000 : 500;
  const yMax = Math.ceil(top / step) * step, Y = (v) => m.t + (1 - v / yMax) * (H - m.t - m.b);
  const bw = (W - m.l - m.r) / CAL_DAYS, X = (i) => m.l + i * bw, off = CAL_DAYS - days.length;
  let g = "";
  for (let v = 0; v <= yMax; v += step) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 5}" y="${Y(v) + 4}" text-anchor="end">${v ? `${v / 1000}k` : 0}</text>`;
  const bars = days.map((x, j) => {
    const i = j + off, cx = X(i) + bw / 2;
    const band = `<rect class="calband" x="${X(i) + 1}" width="${bw - 2}" y="${Y(x.range.hi)}" height="${Y(x.range.lo) - Y(x.range.hi)}"/>`;
    const bar = x.eaten
      ? `<rect class="calbar ${x.d === today() && x.v === "under" ? "sofar" : x.v}" x="${cx - bw * 0.28}" width="${bw * 0.56}" y="${Y(x.eaten)}" height="${Y(0) - Y(x.eaten)}" rx="3"/>`
      : `<circle class="calgap" cx="${cx}" cy="${Y(0) - 4}" r="2"/>`;
    const tip = `${parse(x.d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}: ${x.eaten ? `${x.eaten} kcal eaten` : "not logged"}, range ${x.range.lo} to ${x.range.hi}`;
    return `<g class="calday${x.d === date ? " sel" : ""}" data-day="${x.d}"><rect class="calhit" x="${X(i)}" width="${bw}" y="0" height="${H}"/>${band}${bar}<text x="${cx}" y="${H - 6}" text-anchor="middle">${parse(x.d).getDate()}</text><title>${esc(tip)}</title></g>`;
  }).join("");
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Calories eaten each day for the last ${CAL_DAYS} days against the range">${g}${bars}</svg>
    <div class="callegend"><span><i class="calkey band"></i>Range</span><span><i class="calkey in"></i>In range</span><span><i class="calkey under"></i>Under</span><span><i class="calkey over"></i>Over</span></div>`;
}
function wireCalories() {
  const host = $("people"); // the calories sit inside each person's card
  addEventListener("journalchange", () => refreshCalories()); // drawn at the right width once shown
  host.addEventListener("click", async (ev) => {
    const card = ev.target.closest('.pextra[data-journal="meals"]'); if (!card) return;
    const pid = card.dataset.pid, day = ev.target.closest("[data-day]");
    if (day) { // open that person's day in the meal card
      if (pid !== who()) { whoId = pid; picked = null; rows = []; naming = false; cardMsg = ""; renderCard(); }
      setDate(day.dataset.day); return;
    }
    const v = ev.target.closest("[data-calview]");
    if (v) { calView = v.dataset.calview; try { localStorage.setItem("journal-calview", calView); } catch (_) {} refreshCalories(); return; }
    const b = ev.target.closest("[data-cal]"); if (!b) return;
    const act = b.dataset.cal, id = `${pid}_${date}`;
    if (act === "edit") { burnEdit = pid; refreshCalories(); $("burnIn")?.focus(); }
    if (act === "cancel") { burnEdit = null; refreshCalories(); }
    if (act === "clear") {
      const ok = await confirmDelete({ title: "Use the estimate instead?", yes: "Remove watch burn",
        body: `<p>The burn you typed from the watch${burns[id]?.kcal ? ` (${Number(burns[id].kcal).toLocaleString()} kcal)` : ""} is removed, and the day uses the estimate from weight, height, age and runs.</p>` });
      if (!ok) return;
      delete burns[id]; refreshCalories(); await commit(() => deleteDoc(doc(burnsCol, id)));
    }
    if (act === "save") saveBurn(pid);
  });
  host.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && ev.target.id === "burnIn") { ev.preventDefault(); saveBurn(burnEdit); } });
  let lastW = 0;
  new ResizeObserver(() => { if (!burnEdit && host.clientWidth !== lastW) { lastW = host.clientWidth; refreshCalories(); } }).observe(host);
}
async function saveBurn(pid) {
  const v = Number($("burnIn").value), id = `${pid}_${date}`;
  if (!(v >= 800 && v <= 8000)) { $("burnMsg").textContent = "Enter the day's total burn, between 800 and 8000 kcal."; return; }
  const body = { person: pid, date, kcal: Math.round(v), at: Date.now() };
  burns[id] = body; burnEdit = null; refreshCalories();
  await commit(() => setDoc(doc(burnsCol, id), body));
}

// Keep what was typed in the set form before re-drawing it.
function readSetRows() {
  setRows = setRows.map((r, i) => ({
    food: $("mealLib").querySelector(`[data-srow="${i}"]`)?.value ?? r.food,
    g: $("mealLib").querySelector(`[data-sg="${i}"]`)?.value ?? r.g,
  }));
  const lib = $("mealLib"), val = (sel, d) => lib.querySelector(sel)?.value ?? d;
  setIngr = setIngr.map((r, i) => ({ item: val(`[data-irow="${i}"]`, r.item), qty: val(`[data-iq="${i}"]`, r.qty) }));
  setMade = lib.querySelector('input[name="made"]:checked')?.value ?? setMade;
  setTitle = lib.querySelector('form[data-form="set"] input[name="name"]')?.value ?? setTitle;
  setServes = val('input[name="serves"]', setServes); setPrice = val('input[name="price"]', setPrice);
  const boxes = lib.querySelectorAll('input[name="slots"]');
  if (boxes.length) setSlots = [...boxes].filter((b) => b.checked).map((b) => b.value);
}

// ---------- journal wheel ----------
// Tap the round button, then tap a journal. (Holding it and sliding to one, then letting go, also works.)
export const JOURNALS = [
  { id: "meals", name: "Meals", icon: "🍽️" },
  { id: "weight", name: "Weight", icon: "⚖️" },
  { id: "diary", name: "Dearly", icon: "📔" },
  { id: "stocky", name: "Stocky", icon: "🛒" },
  { id: "ledger", name: "Ledger", icon: "💳" },
];
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
// How many times the "More lives here" tip shows before it stops by itself (journal-tip-more: count, or "off").
const TIP_VIEWS = 5, TIP_KEY = "journal-tip-more";

export function initWheel() {
  const fab = $("wheelBtn"), wheel = $("wheel"), ring = $("wheelRing"), hub = $("wheelHub");
  const R = () => Math.min(120, innerWidth / 2 - 50);
  ring.innerHTML = JOURNALS.map((j, i) => `<button type="button" class="wslot${j.soon ? " soon" : ""}" data-j="${j.id}" style="--i:${i}"><span aria-hidden="true">${j.icon}</span>${esc(j.name)}</button>`).join("");
  const slots = [...ring.querySelectorAll(".wslot")];
  let open = false, hot = null, dragging = false, startX = 0, startY = 0, openedAt = 0, liftedAt = 0;
  // On a phone the browser sends a click where the finger lifted, and by then the open wheel covers that spot.
  // Without this, that click lands on the dark backdrop and shuts the wheel the moment it opens.
  const ghost = () => dragging || performance.now() - Math.max(openedAt, liftedAt) < 400;

  const current = () => (location.hash === "#soon" ? null : currentJournal());
  const paintFab = () => { const j = JOURNALS.find((x) => x.id === current()); fab.firstElementChild.textContent = j ? j.icon : "＋"; fab.setAttribute("aria-label", `Switch journal. Now: ${j ? j.name : "empty slot"}`); };
  const place = () => {
    const r = R();
    slots.forEach((s, i) => {
      const a = -Math.PI / 2 + (i * 2 * Math.PI) / slots.length;
      s.style.setProperty("--x", `${Math.round(Math.cos(a) * r)}px`);
      s.style.setProperty("--y", `${Math.round(Math.sin(a) * r)}px`);
      s.classList.toggle("on", s.dataset.j === current());
    });
  };
  const setHot = (s) => {
    hot = s;
    slots.forEach((x) => x.classList.toggle("hot", x === s));
    hub.textContent = s ? JOURNALS.find((j) => j.id === s.dataset.j).name : "Pick a journal";
  };
  // The ⋯ button in the top corner opens a short menu of extras. A cloud tip points at it until it has
  // been seen TIP_VIEWS times, "Don't show again" is ticked, or ⋯ is used. Nobody has to tick anything.
  const more = $("wheelMore"), menu = $("wheelMenu"), tip = $("wheelTip");
  const tipSeen = () => { const v = store.get(TIP_KEY, "0"); return v === "off" ? Infinity : Number(v) || 0; };
  const setMenu = (on) => { menu.hidden = !on; more.setAttribute("aria-expanded", String(on)); };
  const showTip = () => { $("tipNever").checked = false; tip.hidden = false; wheel.classList.add("hint"); };
  const hideTip = () => { wheel.classList.remove("hint"); tip.hidden = true; };
  const tipDone = () => { store.set(TIP_KEY, "off"); hideTip(); };
  function show() {
    if (open) return;
    open = true; openedAt = performance.now(); place(); setHot(null);
    setMenu(false); hideTip();
    // A walkthrough is pointing at something else, so the tip stays out of its way.
    if (tipSeen() < TIP_VIEWS && !document.documentElement.classList.contains("touring")) { store.set(TIP_KEY, String(tipSeen() + 1)); showTip(); }
    wheel.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => wheel.classList.add("open")));
  }
  function hide() {
    if (!open) return;
    open = false; dragging = false;
    setMenu(false);
    wheel.classList.remove("open");
    setTimeout(() => { if (!open) wheel.hidden = true; }, 220);
    fab.focus({ preventScroll: true });
  }
  function choose(id) {
    const j = JOURNALS.find((x) => x.id === id);
    hide();
    if (!j) return;
    if (j.soon) { location.hash = "#soon"; }
    else {
      setJournal(j.id);
      if (location.hash && location.hash !== "#") location.hash = "";
      else window.dispatchEvent(new HashChangeEvent("hashchange"));
    }
    scrollTo({ top: 0 });
    paintFab();
  }
  // Which slot the finger points at: the direction from the middle of the wheel, like a game's weapon wheel.
  // Uses the slots' resting places, so it works while they are still flying out.
  function aim(x, y) {
    const b = ring.getBoundingClientRect(), dx = x - b.left, dy = y - b.top;
    if (Math.hypot(dx, dy) < 40) return setHot(null);
    const turn = (Math.atan2(dy, dx) + Math.PI / 2 + 2 * Math.PI) % (2 * Math.PI);
    setHot(slots[Math.round(turn / ((2 * Math.PI) / slots.length)) % slots.length]);
  }

  fab.addEventListener("pointerdown", (ev) => {
    if (ev.button > 0) return;
    ev.preventDefault();
    dragging = true; startX = ev.clientX; startY = ev.clientY;
    show();
  });
  addEventListener("pointermove", (ev) => { if (dragging && open && Math.hypot(ev.clientX - startX, ev.clientY - startY) > 12) aim(ev.clientX, ev.clientY); });
  addEventListener("pointerup", (ev) => {
    if (!dragging) return;
    dragging = false; liftedAt = performance.now();
    // A slide that ends pointing at a journal picks it; a plain tap leaves the wheel open.
    if (Math.hypot(ev.clientX - startX, ev.clientY - startY) <= 12) return;
    aim(ev.clientX, ev.clientY);
    if (hot) choose(hot.dataset.j);
  });
  addEventListener("pointercancel", () => { if (dragging) liftedAt = performance.now(); dragging = false; });
  fab.addEventListener("contextmenu", (ev) => ev.preventDefault()); // long press on Android
  fab.addEventListener("click", (ev) => { if (ev.detail === 0) { show(); slots[0].focus(); } }); // keyboard
  ring.addEventListener("click", (ev) => { const s = ev.target.closest(".wslot"); if (s && !(ev.detail && ghost())) choose(s.dataset.j); });
  wheel.addEventListener("click", (ev) => {
    if ((ev.target === wheel || ev.target === hub) && !(ev.detail && ghost())) { if (!menu.hidden) setMenu(false); else hide(); }
  });
  more.addEventListener("click", () => { tipDone(); setMenu(menu.hidden); });
  $("tipOk").addEventListener("click", () => { if ($("tipNever").checked) tipDone(); else hideTip(); });
  menu.addEventListener("click", (ev) => {
    const go = ev.target.closest("[data-go]")?.dataset.go;
    if (!go) return;
    if (go === "tips") { store.set(TIP_KEY, "0"); setMenu(false); showTip(); return; }
    hide();
    if (go === "widget") { offerWidget(); return; }
    if (go === "backup") {
      // The backup card lives in the Weight journal; open it first when another journal is showing.
      const go2 = () => document.querySelector("#app .data")?.scrollIntoView({ behavior: "smooth", block: "start" });
      if ($("home").hidden) { choose("weight"); setTimeout(go2, 80); } else go2();
      return;
    }
    location.hash = `#${go}`;
    scrollTo({ top: 0 });
  });
  $("guideBack").addEventListener("click", () => { location.hash = ""; scrollTo({ top: 0 }); });
  addEventListener("keydown", (ev) => { if (open && ev.key === "Escape") hide(); });
  addEventListener("hashchange", paintFab);
  $("soonBack").addEventListener("click", () => choose(currentJournal()));
  paintFab();
}
