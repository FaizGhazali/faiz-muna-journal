// Stocky, the groceries journal (#stocky view). One shared house stock and shopping list for both people.
// Pages by hash: #stocky (list + at home), #stocky/item/<id>, #stocky/add, #stocky/prices ("Price book"), #stocky/plan.
// Maths and the data model live in stocky.js. Meals are read, never written: what meals use is worked out.
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot } from "../../core/fs.js";
import { confirmDelete } from "../../core/confirm.js";
import { UNITS, LEVELS, allKinds, kindOf, shelves, matchKind, kindsLike, FALLBACK_KIND, amount, money, estimate, lowItems, priceBoard, vsUsual, shopNames, shopTotals, perUnit, unitLabel, shown, planNeeds, shortfall, readItem, readPrice } from "../../logic/stocky.js";
import { readFood } from "../../logic/meals.js";
import { $, esc, iso, parse, today } from "../../core/util.js";

const day = (d) => parse(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });

let commit, me, people, mealData, cols = {}, unsubs = [];
let pantry = [], buys = [], prices = [], list = [], kinds = allKinds(), ests = {}, boards = {};
// Page state: which row's "Bought" form is open, the item in the quick sheet, folded shelves, the meal plan, messages.
let buying = null, pricing = false, editing = false, byShop = false, peek = null, msg = "", plan = {}, pending = false;
let shut = new Set(), opened = new Set(), unfolded = new Set(); // folded shelves (kept per device), shelves showing every tile, open parts of the item page
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

export function initStocky(opts) {
  ({ commit, me, people, mealData } = opts);
  for (const c of ["pantry", "buys", "prices", "shopList", "foods", "kinds"]) cols[c] = collection(opts.db, c);
  byShop = store.get("journal-stocky-byshop", "") === "1";
  try { shut = new Set(JSON.parse(store.get("journal-stocky-shut", "[]"))); } catch (_) { shut = new Set(); }
  addEventListener("hashchange", () => { closePeek(); pricing = false; editing = false; unfolded.clear(); refreshStocky(true); });
  wire();
}
export function startStocky() {
  const on = (c, set) => unsubs.push(onSnapshot(cols[c], (s) => { set(s.docs.map((d) => ({ id: d.id, ...d.data() }))); refreshStocky(); }));
  on("pantry", (v) => { pantry = v.sort((a, b) => a.name.localeCompare(b.name)); });
  on("buys", (v) => { buys = v; });
  on("prices", (v) => { prices = v; });
  on("shopList", (v) => { list = v.sort((a, b) => (a.created || 0) - (b.created || 0)); });
  on("kinds", (v) => { kinds = allKinds(v); repaintMenus(); });
}
export function stopStocky() { unsubs.forEach((u) => u()); unsubs = []; }

function compute() {
  const { meals } = mealData(), t = today();
  ests = {}; boards = {};
  for (const p of pantry) { ests[p.id] = estimate(p, buys, meals, t); boards[p.id] = priceBoard(p.id, buys, prices, t); }
}

// For the meal card: how the pantry item linked to a Meals food is doing. null if no item is linked.
export function stockOf(foodId) {
  const p = pantry.find((x) => x.food === foodId);
  if (!p) return null;
  const e = ests[p.id] || estimate(p, buys, mealData().meals, today());
  return { item: p.id, name: p.name, status: e.status, daysLeft: e.daysLeft, listed: onList(p.id) };
}
// Put the item linked to a food on the list (from the meal card).
export async function listFood(foodId) {
  const p = pantry.find((x) => x.food === foodId);
  if (!p || onList(p.id)) return;
  await addRow({ name: p.name, item: p.id, qty: p.pack, unit: p.unit, from: "manual" });
}
const onList = (itemId) => list.some((r) => r.item === itemId);
const addRow = (row) => commit(() => setDoc(doc(cols.shopList), { ...row, created: Date.now() }));

// ---------- drawing ----------
const route = () => {
  const h = location.hash.replace(/^#stocky\/?/, "");
  const [page, id] = h.split("/");
  return { page: page || "home", id };
};
export function refreshStocky(force) {
  const host = $("stocky"); if (!host || !people().length) return;
  compute();
  // Don't redraw under someone typing, or over a form they've started filling in; catch up when they leave it.
  const a = document.activeElement, sheet = $("skSheet");
  const busy = (el) => (el.contains(a) && a.matches("input, select, textarea")) || el.querySelector("form[data-dirty]");
  if (!force && (busy(host) || (sheet.open && busy(sheet)))) { pending = true; return; }
  pending = false;
  if (host.hidden && !force) return;
  const r = route();
  host.innerHTML = r.page === "item" ? itemPage(r.id) : r.page === "add" ? addPage() : r.page === "prices" ? pricesPage() : r.page === "plan" ? planPage() : homePage();
  if (peek && sheet.open) sheet.innerHTML = sheetHtml(peek);
  syncForms();
}

const nav = (on) => `<nav class="chips sk-nav" aria-label="Stocky pages">${[["", "🛒 List"], ["prices", "🏷️ Price book"], ["plan", "🍽️ Plan meals"]]
  .map(([k, v]) => `<a class="chip" href="#stocky${k ? "/" + k : ""}" aria-pressed="${on === (k || "home")}">${v}</a>`).join("")}</nav>`;
const say = () => `<p class="note sk-msg" role="status">${esc(msg)}</p>`;
const PILL = { out: ["--obese", "Out"], low: ["--over", "Low"], soon: ["--under", "Buy soon"], ok: ["--good", "Fine"], unknown: ["--line", "Not sure"] };
const pill = (s) => `<span class="pill" style="--c:var(${PILL[s][0]})">${PILL[s][1]}</span>`;
function leftText(p, e) {
  if (e.status === "unknown" && e.left == null) return "Not bought yet";
  if (e.status === "out") return "Probably out";
  const d = e.daysLeft == null ? "" : e.daysLeft === 0 ? "runs out today" : e.daysLeft === 1 ? "about 1 day left" : `about ${e.daysLeft} days left`;
  return [d, `${amount(e.left, p.unit)} left`].filter(Boolean).join(" · ");
}
// "Cheapest: Mydin RM 4.20 per kg · sale"
function bestText(itemId, unit) {
  const b = boards[itemId]?.[0];
  if (!b) return "";
  return `<span class="sk-best">Cheapest: <b>${esc(b.shop)}</b> ${money(shown(b.now, unit))} ${unitLabel(unit)}${b.onSale ? ` <i class="sk-sale">Sale</i>` : ""}</span>`;
}

// The list: rows typed or planned, then everything running low that isn't on it yet.
function listRows() {
  const rows = list.map((r) => ({ key: r.id, doc: r.id, ...r, item: r.item && pantry.some((p) => p.id === r.item) ? r.item : undefined }));
  for (const p of lowItems(pantry, ests)) if (!rows.some((r) => r.item === p.id)) rows.push({ key: "low-" + p.id, name: p.name, item: p.id, qty: p.pack, unit: p.unit, from: "low" });
  return rows;
}
function rowHtml(r) {
  const p = pantry.find((x) => x.id === r.item), e = p && ests[p.id];
  const why = r.from === "low" ? (e.status === "out" ? "Probably out" : leftText(p, e)) : r.from === "plan" ? "For your meal plan" : "";
  const qty = r.qty ? amount(r.qty, r.unit || p?.unit || "pcs") : "";
  return `<div class="sk-row${r.from === "low" ? " low" : ""}">
    <div><b>${esc(r.name)}</b><small>${esc([qty, why].filter(Boolean).join(" · "))}</small>${p ? bestText(p.id, p.unit) : ""}</div>
    <span class="btns">${buying === r.key ? "" : `<button type="button" class="mini primary" data-sk="buy" data-key="${esc(r.key)}">Bought</button>`}${r.doc ? `<button type="button" class="mini" data-sk="unlist" data-id="${esc(r.doc)}" aria-label="Take ${esc(r.name)} off the list">✕</button>` : ""}</span>
    ${buying === r.key ? buyForm(r, p) : ""}
  </div>`;
}
const shopList = () => shopNames(buys, prices);
const datalist = () => `<datalist id="skShops">${shopList().map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`;
// The Kind field: type a name (the keyboard opens), or tap ▾ for the list. A name that isn't a kind yet
// becomes a new kind when the item is saved. Your own kinds have ✕ in the list. Only Food links to Meals.
const kindName = (id) => kindOf(id, kinds).name;
const kindField = (selId) => `<div class="sk-kindf"><span class="sk-lbl">Kind</span>
  <div class="sk-combo"><input type="text" name="kind" value="${esc(kindName(selId))}" maxlength="30" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="Type or pick" role="combobox" aria-label="Kind" aria-autocomplete="list" aria-expanded="false"><button type="button" class="sk-combo-btn" data-sk="kindmenu" aria-label="Show all kinds" aria-expanded="false">▾</button></div>
  <div class="sk-menu" role="listbox" aria-label="Kinds" hidden></div>
  <small class="sk-kindnote" data-sk-kindnote></small></div>`;
function menuHtml(text, all) {
  const m = matchKind(text, kinds), list = all ? kinds : kindsLike(text, kinds);
  const rows = list.map((k) => `<div class="sk-opt" role="option" aria-selected="${m.id === k.id}"><button type="button" data-sk="kindpick" data-name="${esc(k.name)}">${esc(k.name)}${k.id === "food" ? " <small>links to Meals</small>" : k.id === "home" ? " <small>soap, tissue</small>" : ""}</button>${k.builtIn ? "" : `<button type="button" class="mini" data-sk="kind-del" data-id="${esc(k.id)}" aria-label="Remove the kind ${esc(k.name)}">✕</button>`}</div>`);
  if (m.name) rows.push(`<div class="sk-opt new"><button type="button" data-sk="kindpick" data-name="${esc(m.name)}">+ New kind "<b>${esc(m.name)}</b>"</button></div>`);
  return rows.join("") || `<p class="note">No kind like that.</p>`;
}
function openMenu(f, all) {
  const box = f.querySelector(".sk-kindf"); if (!box) return;
  const menu = box.querySelector(".sk-menu");
  menu.innerHTML = menuHtml(f.elements.kind.value, all); menu.hidden = false; menu.dataset.all = all ? "1" : "";
  box.querySelectorAll("[aria-expanded]").forEach((x) => x.setAttribute("aria-expanded", "true"));
}
function closeMenus(except) {
  for (const box of $("stocky").querySelectorAll(".sk-kindf")) {
    if (box === except) continue;
    box.querySelector(".sk-menu").hidden = true;
    box.querySelectorAll("[aria-expanded]").forEach((x) => x.setAttribute("aria-expanded", "false"));
  }
}
function repaintMenus() {
  for (const box of $("stocky")?.querySelectorAll(".sk-kindf") || []) {
    const menu = box.querySelector(".sk-menu"); if (!menu.hidden) openMenu(box.closest("form"), !!menu.dataset.all);
  }
}
// Under the field: say when saving will make a new kind.
function kindNote(f) {
  const n = f.querySelector("[data-sk-kindnote]"); if (!n) return;
  const m = matchKind(f.elements.kind.value, kinds);
  n.textContent = m.name ? `New kind. It's made when you save.` : "";
}
const isFood = (f) => matchKind(f.elements.kind?.value, kinds).id === "food";
// The "Bought" form: how much, and (optional) the price, shop and whether it was on sale.
function buyForm(r, p) {
  const unit = p?.unit || r.unit || "pcs", qty = r.qty || p?.pack || "";
  const last = buys.filter((b) => b.item === p?.id && b.shop).sort((a, b) => b.date.localeCompare(a.date))[0];
  return `<form class="mform sk-buy" data-skform="buy" data-key="${esc(r.key)}" novalidate>
    ${p ? "" : `<div class="two">${kindField(r.food ? "food" : FALLBACK_KIND)}
      <label>Counted in<select name="unit">${Object.keys(UNITS).map((u) => `<option${u === unit ? " selected" : ""}>${u}</option>`).join("")}</select></label></div>`}
    <div class="two"><label>How much${p ? ` (${unit})` : ""}<input type="number" name="qty" inputmode="decimal" min="0" value="${esc(qty)}"></label>
      <label>Price paid, ${"RM"}<input type="number" name="price" inputmode="decimal" min="0" step="0.01" placeholder="optional"></label></div>
    <label>Shop<input type="text" name="shop" list="skShops" maxlength="40" value="${esc(last?.shop || "")}" placeholder="Like Mydin, Lotus's, pasar"></label>
    <label class="sk-check"><input type="checkbox" name="sale"> It was on sale</label>
    <p class="note" data-sk-hint></p>
    <div class="actions"><button type="submit" class="primary">Save</button><button type="button" data-sk="cancel">Cancel</button></div>
    ${datalist()}
  </form>`;
}

function homePage() {
  const rows = listRows();
  let listHtml;
  if (!rows.length) listHtml = `<p class="note">Nothing to buy. Items that run low show up here by themselves.</p>`;
  else if (byShop) {
    // Group by each row's cheapest shop, with the whole list priced at the best few shops.
    const groups = new Map();
    for (const r of rows) { const s = (r.item && boards[r.item]?.[0]?.shop) || "No price yet"; groups.set(s, [...(groups.get(s) || []), r]); }
    const tot = shopTotals(rows.filter((r) => r.item).map((r) => ({ item: r.item, qty: r.qty || 0 })), boards).slice(0, 3);
    listHtml = `${tot.length ? `<p class="note">The list at each shop, for the things it has a price for:</p><div class="sk-tot">${tot.map((t) => `<div><b>${esc(t.shop)}</b><span>${money(t.total)}</span><small>${t.have} item${t.have === 1 ? "" : "s"} with a price${t.missing ? `, ${t.missing} without` : ""}</small></div>`).join("")}</div>` : ""}
      ${[...groups].sort(([a], [b]) => (a === "No price yet") - (b === "No price yet") || a.localeCompare(b)).map(([s, rs]) => `<h3 class="sk-shop">${esc(s)}</h3>${rs.map(rowHtml).join("")}`).join("")}`;
  } else listHtml = rows.map(rowHtml).join("");
  return `${nav("home")}
  <section class="panel sk-list" aria-labelledby="skListTitle" data-title="Shopping list">
    <div class="mhead"><h2 id="skListTitle">Shopping list</h2>${rows.length ? `<button type="button" class="chip" data-sk="byshop" aria-pressed="${byShop}">By cheapest shop</button>` : ""}</div>
    ${listHtml}
    <form class="addrow1 sk-add" data-skform="row" novalidate><input type="text" name="name" maxlength="60" placeholder="Add something, like Susu" aria-label="Add to the list" list="skItems"><input type="number" name="qty" inputmode="decimal" min="0" placeholder="How much" aria-label="How much"><button type="submit">Add</button>
      <datalist id="skItems">${pantry.map((p) => `<option value="${esc(p.name)}">`).join("")}</datalist></form>
    ${say()}
  </section>
  <section class="panel sk-home" aria-labelledby="skHomeTitle" data-title="At home">
    <div class="mhead"><h2 id="skHomeTitle">At home</h2><a class="btn mini" href="#stocky/add">+ Add item</a></div>
    ${pantry.length ? shelves(pantry, ests, kinds).map(shelfHtml).join("")
      : `<div class="mempty"><p><b>Add the things you buy often.</b></p><p class="note">Rice, eggs, milk, soap, tissue. Each time you buy one, Stocky learns how fast it goes and tells you before it runs out. Link food to your Meals foods and the meals you log count too.</p><a class="btn primary" href="#stocky/add">Add your first item</a></div>`}
  </section>
  <p class="note">"Days left" is a guess from how often you buy each thing and the meals you log. Tap an item and say how much is left to put it right.</p>`;
}

// ---------- At home shelves ----------
// One shelf per kind: small tiles, three a row, neediest first. A shelf folds (kept per device) and shows
// SHELF_TILES tiles until "+ more" is tapped, so a full house stays a short page.
const SHELF_TILES = 9;
const bar = (e) => `<span class="sk-bar" aria-hidden="true"><i class="is-${e.status}" style="width:${Math.round((e.share ?? 0) * 100)}%"></i></span>`;
// "3 days", "2 wk", "Out": short enough for a tile.
function tileLeft(e) {
  if (e.status === "out") return "Out";
  const d = e.daysLeft;
  if (d == null) return e.left == null ? "New" : "Not sure";
  return d === 0 ? "Today" : d < 14 ? `${d} day${d === 1 ? "" : "s"}` : d < 60 ? `${Math.round(d / 7)} wk` : "2+ months";
}
function shelfHtml({ kind, items, need }) {
  const open = !shut.has(kind.id), all = opened.has(kind.id) || items.length <= SHELF_TILES + 1;
  const shown = all ? items : items.slice(0, SHELF_TILES);
  return `<div class="sk-shelf">
    <button type="button" class="sk-shelfhead" data-sk="shelf" data-kind="${esc(kind.id)}" aria-expanded="${open}">
      <b>${esc(kind.name)}</b><small>${items.length}</small>${need ? `<span class="sk-need">${need} to buy</span>` : ""}<i aria-hidden="true">▾</i></button>
    ${open ? `<div class="sk-tiles">${shown.map((p) => { const e = ests[p.id]; return `<button type="button" class="sk-tile is-${e.status}" data-sk="peek" data-id="${esc(p.id)}">
      <b>${esc(p.name)}</b><small>${esc(tileLeft(e))}</small>${bar(e)}</button>`; }).join("")}${all ? "" : `<button type="button" class="sk-tile more" data-sk="more" data-kind="${esc(kind.id)}">+${items.length - shown.length} more</button>`}</div>` : ""}
  </div>`;
}
// The quick sheet: what a tile tap opens. The everyday jobs (how much is left, bought, add to list);
// "See everything" opens the full item page.
function sheetHtml(id) {
  const p = pantry.find((x) => x.id === id);
  if (!p) return `<div class="gsin"><p>This item isn't here any more.</p><div class="actions"><button type="button" data-sk="unpeek">Close</button></div></div>`;
  const e = ests[p.id], key = "item-" + p.id;
  return `<div class="gsin sk-peek">
    <div class="mhead"><h3 id="skSheetTitle">${esc(p.name)}</h3>${pill(e.status)}<button type="button" class="mini" data-sk="unpeek" aria-label="Close">✕</button></div>
    ${bar(e)}
    <p class="note">${esc(leftText(p, e))}${e.outOn && e.status !== "out" ? ` · runs out ${esc(day(e.outOn))}` : ""}</p>
    ${levelChips(p)}
    <div class="actions">${buying === key ? "" : `<button type="button" class="primary" data-sk="buy" data-key="${key}">Bought some</button>`}${onList(p.id) ? `<span class="note">On the list</span>` : `<button type="button" data-sk="list" data-id="${esc(p.id)}">Add to list</button>`}</div>
    ${buying === key ? buyForm({ key, item: p.id, qty: p.pack }, p) : ""}
    ${bestText(p.id, p.unit)}
    ${say()}
    <a class="sk-all" href="#stocky/item/${esc(p.id)}">See everything →</a>
  </div>`;
}
const levelChips = (p) => `<p class="mwhat">How much is left?</p>
  <div class="chips sk-levels" role="group" aria-label="How much is left">${LEVELS.map(([l, t]) => `<button type="button" class="chip" data-sk="level" data-id="${esc(p.id)}" data-level="${l}" aria-pressed="${p.check?.date === today() && p.check.level === l}">${t}</button>`).join("")}</div>`;
function openPeek(id) {
  peek = id; buying = null; msg = "";
  const s = $("skSheet"); s.innerHTML = sheetHtml(id);
  if (!s.open) s.showModal();
}
function closePeek() {
  peek = null; buying = null; msg = "";
  const s = $("skSheet"); if (s?.open) s.close();
}

function itemPage(id) {
  const p = pantry.find((x) => x.id === id);
  if (!p) return `${nav("")}<section class="panel"><p>${pantry.length ? "This item isn't here any more." : "Opening…"}</p><a class="btn" href="#stocky">← Back</a></section>`;
  const e = ests[p.id], board = boards[p.id], { foods } = mealData();
  const food = foods.find((f) => f.id === p.food);
  const hist = buys.filter((b) => b.item === p.id).sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0)).slice(0, 10);
  const key = "item-" + p.id;
  return `<div class="fdtop"><a class="btn" href="#stocky">← Back</a></div>
  <section class="panel sk-detail" aria-labelledby="skItemTitle" data-title="${esc(p.name)}">
    <div class="mhead"><h2 id="skItemTitle">${esc(p.name)}</h2>${pill(e.status)}</div>
    <p class="note">${esc(kindName(p.kind))}${food ? ` · linked to <b class="ink">${esc(food.name)}</b> in Meals` : ""} · usually ${amount(p.pack, p.unit)} at a time</p>
    <div class="tiles"><div class="tile"><b>${e.left == null ? "–" : amount(e.left, p.unit)}</b>left</div><div class="tile"><b>${e.daysLeft ?? "–"}</b>days left</div><div class="tile"><b>${e.outOn ? esc(day(e.outOn)) : "–"}</b>runs out</div></div>
    <ul class="sk-why">${e.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    ${levelChips(p)}
    <div class="actions">${buying === key ? "" : `<button type="button" class="primary" data-sk="buy" data-key="${key}">Bought some</button>`}${onList(p.id) ? `<span class="note">On the list</span>` : `<button type="button" data-sk="list" data-id="${esc(p.id)}">Add to list</button>`}</div>
    ${buying === key ? buyForm({ key, item: p.id, qty: p.pack }, p) : ""}
    ${say()}
  </section>
  <section class="panel sk-more" aria-label="More about ${esc(p.name)}" data-title="Prices, buys and edit">
  ${part("prices", "Prices by shop", board.length ? `${esc(board[0].shop)} cheapest` : "None yet", pricing, `
    ${pricing ? "" : `<div class="actions"><button type="button" class="mini" data-sk="price">+ Price I saw</button></div>`}
    ${board.length ? `<div class="sk-board">${board.map((s, i) => `<div class="sk-shoprow${i === 0 ? " best" : ""}">
        <b>${esc(s.shop)}${i === 0 ? ` <i class="sk-tag">Cheapest</i>` : ""}</b>
        <span>${money(shown(s.now, p.unit))} <small>${unitLabel(p.unit)}</small></span>
        <small>${s.onSale ? `<i class="sk-sale">Sale${s.until ? ` till ${esc(day(s.until))}` : ""}</i> normal ${s.normal == null ? "not known" : money(shown(s.normal, p.unit))}` : "Normal price"} · seen ${esc(day(s.date))}</small></div>`).join("")}</div>
      ${board.length > 1 ? `<p class="note">${esc(board[0].shop)} saves you about ${money(shown(board.at(-1).now - board[0].now, p.unit))} ${unitLabel(p.unit)} over ${esc(board.at(-1).shop)}.</p>` : ""}`
      : `<p class="note">No prices yet. Add the price when you buy it, or a price you spot in a shop, and Stocky compares shops for you.</p>`}
    ${pricing ? priceForm(p) : ""}`)}
  ${part("bought", "Bought", hist.length ? `Last: ${esc(day(hist[0].date))}, ${amount(hist[0].qty, p.unit)}` : "Nothing yet", false, `
    ${hist.length ? `<div class="mlist">${hist.map((b) => `<div class="mitem"><div><b>${esc(day(b.date))} · ${amount(b.qty, p.unit)}</b><small>${esc([b.price ? money(b.price) : "", b.shop || "", b.sale ? "on sale" : ""].filter(Boolean).join(" · ") || "No price")}</small></div><button type="button" class="mini" data-sk="unbuy" data-id="${esc(b.id)}" aria-label="Remove this buy">✕</button></div>`).join("")}</div>`
      : `<p class="note">Nothing yet.</p>`}`)}
  ${part("edit", "Edit or delete", "", editing, `
    ${editing ? itemForm(p) : `<div class="actions"><button type="button" data-sk="edit">Edit ${esc(p.name)}</button><button type="button" class="danger" data-sk="del">Delete</button></div>`}`)}
  </section>`;
}
// A folded part of the item page: its row says the gist, tapping opens it. What's open survives live redraws.
const part = (key, title, gist, force, body) => `<details class="sk-part" data-part="${key}"${force || unfolded.has(key) ? " open" : ""}>
  <summary><b>${title}</b>${gist ? `<small>${gist}</small>` : ""}</summary>${body}</details>`;
function priceForm(p) {
  return `<form class="mform" data-skform="price" novalidate>
    <div class="two"><label>Amount (${p.unit})<input type="number" name="qty" inputmode="decimal" min="0" value="${esc(p.pack)}"></label>
      <label>Price, RM<input type="number" name="price" inputmode="decimal" min="0" step="0.01"></label></div>
    <label>Shop<input type="text" name="shop" list="skShops" maxlength="40" placeholder="Like Mydin, Lotus's, pasar"></label>
    <label class="sk-check"><input type="checkbox" name="sale" data-sk-toggle="until"> On sale</label>
    <label data-sk-show="until" hidden>Sale ends (optional)<input type="date" name="until" min="${today()}"></label>
    <p class="note" data-sk-hint></p>
    <div class="actions"><button type="submit" class="primary">Save price</button><button type="button" data-sk="cancel">Cancel</button></div>
    ${datalist()}
  </form>`;
}
// Add or edit an item. Food can be linked to a Meals food, or a new Meals food made from it.
function itemForm(p) {
  const { foods } = mealData(), v = (k, d = "") => esc(p?.[k] ?? d);
  return `<form class="mform" data-skform="item" novalidate>
    <label>Name<input type="text" name="name" maxlength="60" value="${v("name")}" placeholder="Beras, Telur, Tisu"></label>
    <div class="two">${kindField(p ? kindOf(p.kind, kinds).id : "food")}
      <label>Counted in<select name="unit">${Object.keys(UNITS).map((u) => `<option value="${u}"${(p?.unit || "g") === u ? " selected" : ""}>${{ g: "grams", ml: "ml", pcs: "pieces" }[u]}</option>`).join("")}</select></label></div>
    <label>Usually bought at once<input type="number" name="pack" inputmode="decimal" min="0" value="${v("pack")}" placeholder="5000 for a 5 kg bag, 30 for a tray"></label>
    <div data-sk-show="food">
      <label>Meals food<select name="food"><option value="">Not linked</option>${foods.map((f) => `<option value="${esc(f.id)}"${p?.food === f.id ? " selected" : ""}>${esc(f.name)}</option>`).join("")}<option value="new">+ New Meals food from this</option></select></label>
      <small class="note">Linked, the meals you log use it up, and the meal card warns you when it's low.</small>
      <label data-sk-show="each" hidden>Grams in one piece<input type="number" name="each" inputmode="numeric" min="1" value="${p?.unit === "pcs" ? v("each") : ""}" placeholder="An egg is about 55"></label>
      <label data-sk-show="ratio" hidden>Weight once cooked<input type="number" name="ratio" inputmode="decimal" min="0.1" max="10" step="0.1" value="${p && p.unit !== "pcs" ? v("each", 1) : 1}"><small>Meals counts cooked food. 1 g of dry rice cooks to about 2.5 g, so type 2.5. Leave 1 if it's eaten as bought.</small></label>
      <div data-sk-show="newfood" hidden><p class="note">Per 100 g, from the pack:</p><div class="four">
        <label>kcal<input type="number" name="kcal" inputmode="decimal" min="0" max="900"></label><label>Carbs g<input type="number" name="carb" inputmode="decimal" min="0" max="100" step="0.1"></label>
        <label>Protein g<input type="number" name="protein" inputmode="decimal" min="0" max="100" step="0.1"></label><label>Fat g<input type="number" name="fat" inputmode="decimal" min="0" max="100" step="0.1"></label></div></div>
    </div>
    ${p ? "" : `<label class="sk-check"><input type="checkbox" name="bought" checked data-sk-toggle="bought"> I just bought it</label>
    <div data-sk-show="bought"><div class="two"><label>Price paid, RM<input type="number" name="price" inputmode="decimal" min="0" step="0.01" placeholder="optional"></label>
      <label>Shop<input type="text" name="shop" list="skShops" maxlength="40" placeholder="optional"></label></div>
      <label class="sk-check"><input type="checkbox" name="sale"> It was on sale</label></div>${datalist()}`}
    <p class="note sk-msg" role="status">${esc(msg)}</p>
    <div class="actions"><button type="submit" class="primary">${p ? "Save changes" : "Add item"}</button>${p ? `<button type="button" data-sk="cancel">Cancel</button>` : `<a class="btn" href="#stocky">Cancel</a>`}</div>
  </form>`;
}
const addPage = () => `<div class="fdtop"><a class="btn" href="#stocky">← Back</a></div>
  <section class="panel" aria-labelledby="skAddTitle"><h2 id="skAddTitle">Add an item</h2>${itemForm(null)}</section>`;

function pricesPage() {
  const withP = pantry.filter((p) => boards[p.id].length);
  const sales = withP.filter((p) => boards[p.id].some((s) => s.onSale));
  const shops = shopList();
  return `${nav("prices")}
  <section class="panel" aria-labelledby="skSaleTitle" data-title="On sale now">
    <h2 id="skSaleTitle">On sale now</h2>
    ${sales.length ? `<div class="mlist">${sales.map((p) => boards[p.id].filter((s) => s.onSale).map((s) => `<a class="mitem sk-link" href="#stocky/item/${esc(p.id)}"><div><b>${esc(p.name)}</b><small>${esc(s.shop)}${s.until ? ` · till ${esc(day(s.until))}` : ""}${s.normal ? ` · normal ${money(shown(s.normal, p.unit))}` : ""}</small></div><span><i class="sk-sale">${money(shown(s.sale, p.unit))}</i> <small>${unitLabel(p.unit)}</small></span></a>`).join("")).join("")}</div>`
      : `<p class="note">No sales noted. Tick "On sale" when you add a price and it shows here.</p>`}
  </section>
  <section class="panel" aria-labelledby="skCheapTitle" data-title="Cheapest shop">
    <h2 id="skCheapTitle">Cheapest shop for each</h2>
    ${withP.length ? `<div class="mlist">${withP.map((p) => { const b = boards[p.id], s = b[0]; return `<a class="mitem sk-link" href="#stocky/item/${esc(p.id)}"><div><b>${esc(p.name)}</b><small>${esc(s.shop)}${s.onSale ? " (sale)" : ""}${b.length > 1 ? ` · ${b.length} shops compared` : " · only one shop so far"}</small></div><span>${money(shown(s.now, p.unit))} <small>${unitLabel(p.unit)}</small></span></a>`; }).join("")}</div>`
      : `<p class="note">Add prices when you buy, or tap an item and add a price you saw. Stocky compares the price per kg, per litre or per piece, so different pack sizes are fair.</p>`}
    ${shops.length ? `<p class="note">Your shops: ${shops.map(esc).join(", ")}.</p>` : ""}
  </section>`;
}

function planPage() {
  const { foods, sets, meals } = mealData();
  const need = planNeeds(sets, plan, foods, meals, people());
  const short = shortfall(need, pantry, ests, foods).filter((r) => !list.some((x) => (r.item && x.item === r.item) || (!r.item && x.food === r.food)));
  return `${nav("plan")}
  <section class="panel" aria-labelledby="skPlanTitle" data-title="Plan meals">
    <h2 id="skPlanTitle">What will you cook this week?</h2>
    <p class="note">Pick your meal sets and how many times. Stocky works out the food for both of you from your usual portions, takes off what's at home, and adds the rest to the list.</p>
    ${sets.length ? `<div class="mlist">${sets.map((s) => `<div class="mitem sk-plan"><div><b>${esc(s.name)}</b></div><span class="grams"><button type="button" class="mini" data-sk="plan" data-id="${esc(s.id)}" data-step="-1" aria-label="Once less">−</button><b>${plan[s.id] || 0}×</b><button type="button" class="mini" data-sk="plan" data-id="${esc(s.id)}" data-step="1" aria-label="Once more">+</button></span></div>`).join("")}</div>`
      : `<p class="note">No meal sets yet. Make some in <a href="#mealsets">Meal sets and foods</a>.</p>`}
    ${Object.values(plan).some((n) => n > 0) ? short.length ? `<h3>To buy</h3><ul class="sk-why">${short.map((r) => `<li><b>${esc(r.name)}</b> ${amount(r.qty, r.unit)}${r.item ? "" : " (new)"}</li>`).join("")}</ul>
      <div class="actions"><button type="button" class="primary" data-sk="plan-add">Add ${short.length} to the list</button></div>` : `<p class="note">You have enough at home for that, or it's already on the list.</p>` : ""}
    ${say()}
  </section>`;
}

// Show or hide parts of a form from its own fields.
function syncForms() {
  for (const f of [...$("stocky").querySelectorAll("form.mform"), ...$("skSheet").querySelectorAll("form.mform")]) {
    const el = f.elements, show = (k, on) => f.querySelectorAll(`[data-sk-show="${k}"]`).forEach((x) => { x.hidden = !on; });
    if (el.kind) kindNote(f);
    if (el.kind && el.food) {
      const food = isFood(f);
      show("food", food);
      show("newfood", food && el.food.value === "new");
      const linked = food && !!el.food.value;
      show("each", linked && el.unit.value === "pcs");
      show("ratio", linked && el.unit.value !== "pcs");
    }
    if (el.bought) show("bought", el.bought.checked);
    if (el.until) show("until", el.sale.checked);
    hint(f);
  }
}
// Under a price being typed: what it is per kg, and how it compares with usual.
function hint(f) {
  const h = f.querySelector("[data-sk-hint]"); if (!h) return;
  const el = f.elements, p = pantry.find((x) => x.id === (f.dataset.skform === "price" ? route().id : rowByKey(f.dataset.key)?.item));
  const q = Number(el.qty?.value), pr = Number(el.price?.value), unit = p?.unit || el.unit?.value;
  if (!(q > 0 && pr > 0) || !unit) { h.textContent = ""; return; }
  const u = perUnit({ qty: q, price: pr }), vs = p && vsUsual(p.id, u, buys, prices, today());
  h.textContent = `${money(shown(u, unit))} ${unitLabel(unit)}${vs && vs.pct ? `, ${Math.abs(vs.pct)}% ${vs.pct < 0 ? "under" : "over"} the usual ${money(shown(vs.usual, unit))}` : vs ? ", the usual price" : ""}.`;
}
const rowByKey = (k) => (k?.startsWith("item-") ? { key: k, item: k.slice(5) } : listRows().find((r) => r.key === k));

// ---------- saving ----------
// The kind typed in a form: an existing id, or a new kind (made with commitKind() once the rest checks out).
function kindFrom(f) {
  const m = matchKind(f.elements.kind?.value, kinds);
  if (m.error) return m;
  if (m.id) return { id: m.id, ids: kinds.map((k) => k.id) };
  const ref = doc(cols.kinds);
  return { id: ref.id, ids: [...kinds.map((k) => k.id), ref.id], make: { ref, body: { name: m.name, created: Date.now() } } };
}
async function commitKind(k) {
  if (!k.make) return;
  kinds = allKinds([...kinds.filter((x) => !x.builtIn), { id: k.id, ...k.make.body }]);
  await commit(() => setDoc(k.make.ref, k.make.body));
}
async function saveBuy(f) {
  const r = rowByKey(f.dataset.key); if (!r) return;
  const el = f.elements, { rec, error } = readPrice({ qty: el.qty.value, price: el.price.value, shop: el.shop.value, sale: el.sale.checked });
  if (error) { setMsg(f, error); return; }
  let itemId = r.item;
  if (!itemId) { // first buy of something new: it becomes a pantry item
    const known = pantry.find((p) => p.name.toLowerCase() === String(r.name).toLowerCase());
    if (known) itemId = known.id;
    else {
      const k = kindFrom(f);
      if (k.error) { setMsg(f, k.error); return; }
      const { item, error: e2 } = readItem({ name: r.name, kind: k.id, unit: el.unit?.value, pack: rec.qty, food: r.food }, k.ids);
      if (e2) { setMsg(f, e2); return; }
      await commitKind(k);
      const ref = doc(cols.pantry); itemId = ref.id;
      await commit(() => setDoc(ref, { ...item, created: Date.now() }));
    }
  }
  const name = r.name || pantry.find((p) => p.id === itemId)?.name || "";
  buying = null; msg = `Bought ${name}.`;
  await commit(() => setDoc(doc(cols.buys), { item: itemId, date: today(), ...rec, by: me(), at: Date.now() }));
  if (r.doc) await commit(() => deleteDoc(doc(cols.shopList, r.doc)));
  refreshStocky(true);
}
async function savePrice(f) {
  const id = route().id, el = f.elements;
  const { rec, error } = readPrice({ qty: el.qty.value, price: el.price.value, shop: el.shop.value, sale: el.sale.checked, until: el.until.value }, { needPrice: true });
  if (error) { setMsg(f, error); return; }
  pricing = false; msg = "";
  await commit(() => setDoc(doc(cols.prices), { item: id, date: today(), ...rec, at: Date.now() }));
  refreshStocky(true);
}
async function saveItem(f) {
  const el = f.elements, id = route().page === "item" ? route().id : null, { foods } = mealData();
  const k = kindFrom(f);
  if (k.error) { setMsg(f, k.error); return; }
  let food = k.id === "food" ? el.food.value : "";
  const fd = { name: el.name.value, kind: k.id, unit: el.unit.value, pack: el.pack.value, each: el.unit.value === "pcs" ? el.each.value : el.ratio.value, food: food === "new" ? "new" : food };
  const { item, error } = readItem(fd, k.ids);
  if (error) { setMsg(f, error); return; }
  if (pantry.some((p) => p.id !== id && p.name.toLowerCase() === item.name.toLowerCase())) { setMsg(f, "That's already in Stocky."); return; }
  // "+ New Meals food from this": the numbers per 100 g become a food in the Meals library.
  let newFood = null;
  if (food === "new") {
    const r = readFood({ name: item.name, kcal: el.kcal.value, carb: el.carb.value, protein: el.protein.value, fat: el.fat.value });
    if (r.error) { setMsg(f, r.error); return; }
    const same = foods.find((x) => x.name.toLowerCase() === r.food.name.toLowerCase());
    if (same) item.food = same.id; else newFood = { ref: doc(cols.foods), body: { ...r.food, created: Date.now(), updated: Date.now() } };
  }
  let buy = null;
  if (!id && el.bought.checked) {
    const p = readPrice({ qty: item.pack, price: el.price.value, shop: el.shop.value, sale: el.sale.checked });
    if (p.error) { setMsg(f, p.error); return; }
    buy = p.rec;
  }
  await commitKind(k);
  if (newFood) { item.food = newFood.ref.id; await commit(() => setDoc(newFood.ref, newFood.body)); }
  const ref = id ? doc(cols.pantry, id) : doc(cols.pantry);
  const old = id ? pantry.find((p) => p.id === id) : null;
  const body = { ...item, created: old?.created || Date.now(), updated: Date.now(), ...(old?.check ? { check: old.check } : {}) };
  editing = false; msg = id ? "Saved." : `Added ${item.name}.${newFood ? " It's in your Meals foods too." : ""}`;
  await commit(() => setDoc(ref, body));
  if (buy) await commit(() => setDoc(doc(cols.buys), { item: ref.id, date: today(), ...buy, by: me(), at: Date.now() }));
  if (!id) location.hash = "#stocky"; else refreshStocky(true);
}
async function addTyped(f) {
  const name = f.elements.name.value.trim(), qty = Number(f.elements.qty.value) || 0;
  if (!name) return;
  const p = pantry.find((x) => x.name.toLowerCase() === name.toLowerCase());
  if (p && onList(p.id)) { msg = `${p.name} is already on the list.`; refreshStocky(true); return; }
  msg = "";
  await addRow(p ? { name: p.name, item: p.id, qty: qty || p.pack, unit: p.unit, from: "manual" } : { name: name.slice(0, 60), ...(qty ? { qty } : {}), from: "manual" });
  refreshStocky(true);
  $("stocky").querySelector('[data-skform="row"] input')?.focus();
}
// Every delete goes through confirmDelete() (see .claude/skills/safe-delete/SKILL.md).
const names = (ps) => ps.length <= 3 ? ps.map((p) => `<b>${esc(p.name)}</b>`).join(", ") : `${ps.slice(0, 3).map((p) => `<b>${esc(p.name)}</b>`).join(", ")} and ${ps.length - 3} more`;
async function removeKind(id) {
  const k = kinds.find((x) => x.id === id && !x.builtIn); if (!k) return;
  const inIt = pantry.filter((p) => p.kind === id), to = kindName(FALLBACK_KIND);
  const ok = await confirmDelete({ title: `Remove the kind ${k.name}?`, yes: "Remove kind",
    body: inIt.length ? `<p>${inIt.length} item${inIt.length === 1 ? "" : "s"} (${names(inIt)}) will move to <b>${esc(to)}</b>. The items, buys and prices stay.</p>` : `<p>No items use it.</p>` });
  if (!ok) return;
  // A form showing this kind switches to Home.
  for (const input of $("stocky").querySelectorAll(".sk-kindf input")) if (input.value.trim().toLowerCase() === k.name.toLowerCase()) input.value = to;
  kinds = kinds.filter((x) => x.id !== id); repaintMenus(); syncForms();
  await commit(() => Promise.all([...inIt.map((p) => updateDoc(doc(cols.pantry, p.id), { kind: FALLBACK_KIND })), deleteDoc(doc(cols.kinds, id))]));
}
async function removeItem(id) {
  const p = pantry.find((x) => x.id === id); if (!p) return;
  const nb = buys.filter((x) => x.item === id), np = prices.filter((x) => x.item === id), nl = list.filter((x) => x.item === id);
  const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
  const what = [nb.length && plural(nb.length, "buy"), np.length && plural(np.length, "price"), nl.length && "its row on the shopping list"].filter(Boolean);
  const ok = await confirmDelete({ title: `Delete ${p.name}?`, yes: "Delete it", body: what.length ? `<p>Its history goes too: ${esc(what.join(", "))}.</p>` : "" });
  if (!ok) return;
  const gone = [...nb.map((x) => doc(cols.buys, x.id)), ...np.map((x) => doc(cols.prices, x.id)), ...nl.map((x) => doc(cols.shopList, x.id))];
  location.hash = "#stocky";
  await commit(() => Promise.all([deleteDoc(doc(cols.pantry, id)), ...gone.map((d) => deleteDoc(d))]));
}
async function unlist(id) {
  const r = list.find((x) => x.id === id); if (!r) return;
  const ok = await confirmDelete({ title: `Take ${r.name} off the list?`, yes: "Take it off",
    body: r.item ? `<p>If it's running low it comes back by itself.</p>` : "" });
  if (ok) await commit(() => deleteDoc(doc(cols.shopList, id)));
}
async function unbuy(id) {
  const b = buys.find((x) => x.id === id); if (!b) return;
  const p = pantry.find((x) => x.id === b.item);
  const ok = await confirmDelete({ title: "Remove this buy?", yes: "Remove buy",
    body: `<p><b>${esc(day(b.date))} · ${amount(b.qty, p?.unit || "pcs")}</b>${b.price ? ` · ${money(b.price)}` : ""}${b.shop ? ` · ${esc(b.shop)}` : ""}</p><p>The days-left guess is worked out again without it.</p>` });
  if (ok) await commit(() => deleteDoc(doc(cols.buys, id)));
}
function setMsg(f, t) { msg = t; const el = f.querySelector(".sk-msg") || f.querySelector("[data-sk-hint]") || $("stocky").querySelector(".sk-msg"); if (el) el.textContent = t; }

// ---------- events ----------
// The page and the quick sheet (a <dialog> outside #stocky, so redraws of the page leave it alone) share
// the same handlers: a button means the same thing in either.
function wire() {
  const host = $("stocky"), sheet = $("skSheet"), both = (type, fn) => { host.addEventListener(type, fn); sheet.addEventListener(type, fn); };
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet) sheet.close(); }); // tap outside closes
  sheet.addEventListener("close", () => { if (peek) { closePeek(); refreshStocky(true); } });
  both("click", async (ev) => {
    closeMenus(ev.target.closest(".sk-kindf"));
    const b = ev.target.closest("[data-sk]"); if (!b) return;
    const act = b.dataset.sk, id = b.dataset.id || route().id, here = sheet.open ? sheet : host;
    if (act === "peek") openPeek(b.dataset.id);
    if (act === "unpeek") closePeek();
    if (act === "shelf") { const k = b.dataset.kind; shut.has(k) ? shut.delete(k) : shut.add(k); store.set("journal-stocky-shut", JSON.stringify([...shut])); refreshStocky(true); }
    if (act === "more") { opened.add(b.dataset.kind); refreshStocky(true); }
    if (act === "buy") { buying = b.dataset.key; pricing = false; msg = ""; refreshStocky(true); here.querySelector(".sk-buy input[name=qty]")?.focus(); }
    if (act === "cancel") { buying = null; pricing = false; editing = false; msg = ""; refreshStocky(true); }
    if (act === "byshop") { byShop = !byShop; store.set("journal-stocky-byshop", byShop ? "1" : ""); refreshStocky(true); }
    if (act === "unlist") await unlist(b.dataset.id);
    if (act === "kind-del") await removeKind(b.dataset.id);
    if (act === "kindmenu") { const f = b.closest("form"), menu = f.querySelector(".sk-menu"); if (menu.hidden || !menu.dataset.all) openMenu(f, true); else closeMenus(); } // suggestions open → show them all
    if (act === "kindpick") { const f = b.closest("form"); f.elements.kind.value = b.dataset.name; f.dataset.dirty = "1"; closeMenus(); syncForms(); }
    if (act === "list") { const p = pantry.find((x) => x.id === b.dataset.id); if (p) { msg = `${p.name} is on the list.`; await addRow({ name: p.name, item: p.id, qty: p.pack, unit: p.unit, from: "manual" }); } }
    if (act === "level") {
      const check = { date: today(), at: Date.now(), level: Number(b.dataset.level) };
      const p = pantry.find((x) => x.id === id); if (p) { p.check = check; msg = "Thanks, the guess is updated."; refreshStocky(true); }
      await commit(() => updateDoc(doc(cols.pantry, id), { check }));
    }
    if (act === "price") { pricing = true; buying = null; refreshStocky(true); host.querySelector('[data-skform="price"] input[name=price]')?.focus(); }
    if (act === "unbuy") await unbuy(b.dataset.id);
    if (act === "edit") { editing = true; msg = ""; refreshStocky(true); }
    if (act === "del") await removeItem(route().id);
    if (act === "plan") { plan[b.dataset.id] = Math.max(0, Math.min(21, (plan[b.dataset.id] || 0) + Number(b.dataset.step))); refreshStocky(true); }
    if (act === "plan-add") {
      const { foods, sets, meals } = mealData();
      const short = shortfall(planNeeds(sets, plan, foods, meals, people()), pantry, ests, foods).filter((r) => !list.some((x) => (r.item && x.item === r.item) || (!r.item && x.food === r.food)));
      plan = {}; msg = `Added ${short.length} to the list.`;
      await commit(() => Promise.all(short.map((r) => setDoc(doc(cols.shopList), { ...r, from: "plan", created: Date.now() }))));
      location.hash = "#stocky";
    }
  });
  both("submit", (ev) => {
    ev.preventDefault();
    const f = ev.target, k = f.dataset.skform;
    if (k === "buy") saveBuy(f);
    if (k === "price") savePrice(f);
    if (k === "item") saveItem(f);
    if (k === "row") addTyped(f);
  });
  both("change", (ev) => { const f = ev.target.closest("form.mform"); if (f) f.dataset.dirty = "1"; syncForms(); });
  // An item page part opened or shut stays that way through live redraws ("toggle" doesn't bubble).
  host.addEventListener("toggle", (ev) => { const k = ev.target.dataset?.part; if (k) ev.target.open ? unfolded.add(k) : unfolded.delete(k); }, true);
  both("input", (ev) => {
    const f = ev.target.closest("form"); if (!f) return;
    if (f.matches(".mform")) f.dataset.dirty = "1";
    if (ev.target.name === "kind" && ev.target.closest(".sk-kindf")) { openMenu(f, false); syncForms(); return; }
    hint(f);
  });
  host.addEventListener("keydown", (ev) => {
    if (ev.target.name !== "kind" || !ev.target.closest(".sk-kindf")) return;
    if (ev.key === "Enter") { ev.preventDefault(); closeMenus(); ev.target.blur(); }
    if (ev.key === "Escape") closeMenus();
  });
  document.addEventListener("click", (ev) => { if (!$("stocky").contains(ev.target)) closeMenus(); });
  both("focusout", () => setTimeout(() => { if (pending && !host.contains(document.activeElement) && !sheet.contains(document.activeElement)) refreshStocky(); }, 0));
}
