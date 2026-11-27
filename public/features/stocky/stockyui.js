// Stocky, the groceries journal (#stocky view). One shared house stock and shopping list for both people.
// Pages by hash: #stocky (list + at home), #stocky/item/<id>, #stocky/add, #stocky/prices ("Price book"), #stocky/plan,
// and receipt scanning (receipt.js): #stocky/receipts, #stocky/receipt/<id>, #stocky/scan.
// Maths and the data model live in stocky.js. Meals are read, never written: what meals use is worked out.
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot, writeBatch } from "../../core/fs.js";
import { confirmDelete } from "../../core/confirm.js";
import { UNITS, LEVELS, allKinds, kindOf, shelves, matchKind, kindsLike, FALLBACK_KIND, amount, money, estimate, lowItems, priceBoard, priceAtQuantity, PRICE_UNITS, vsUsual, shopNames, shopTotals, perUnit, unitLabel, shown, planNeeds, shortfall, readItem, readPrice, setCost, linksTo, linkRows, LINKS_MAX } from "../../logic/stocky.js";
import { readFood } from "../../logic/meals.js";
import { findByName, SEARCH_MIN } from "../../logic/search.js";
import { shopChoices, stockyAt, renames, firstUsed, ledgerShopOf, shopLabel, shopId } from "../../logic/shops.js";
import { $, esc, iso, parse, today, lastUsed } from "../../core/util.js";
import { ico } from "../../core/icons.js";
import { priceHistory } from "../../logic/stocky.js";
import { historyChart, shopComparison } from "./pricehistory.js";
import { initReceipts, startReceipts, stopReceipts, wireReceipts, receiptsPage, receiptPage, scanPage, canScan } from "./receipt.js";

const day = (d) => parse(d).toLocaleDateString(undefined, { day: "numeric", month: "short" });

let db, commit, me, people, mealData, cols = {}, unsubs = [];
let pantry = [], buys = [], prices = [], list = [], kinds = allKinds(), ests = {}, boards = {};
let ledgerShops = []; // Ledger's shop names: one shop list for both journals (logic/shops.js)
// Page state: which row's "Bought" form is open, the item in the quick sheet, folded shelves, the meal plan, messages.
let buying = null, pricing = false, editing = false, byShop = false, peek = null, msg = "", plan = {}, pending = false;
let shut = new Set(), opened = new Set(), unfolded = new Set(); // folded shelves (kept per device), shelves showing every tile, open parts of the item page
let homeQ = "", newName = ""; // the At home search (kept in memory), and the name "+ Add" carries to the add page
let priceQ = "", priceShop = null, priceCalc = null;
const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};

let pricesChanged = () => {}; // the meal sets show what they cost from the Price book
let ledgerNames = () => []; // every shop Ledger has spending at (from app.js), for the shop picker
export function initStocky(opts) {
  ({ db, commit, me, people, mealData } = opts);
  if (opts.pricesChanged) pricesChanged = opts.pricesChanged;
  if (opts.ledgerShops) ledgerNames = opts.ledgerShops;
  for (const c of ["pantry", "buys", "prices", "shopList", "foods", "kinds", "ledgerShops"]) cols[c] = collection(opts.db, c);
  initReceipts({ db: opts.db, commit, me, demo: opts.demo, token: opts.token, pantry: () => pantry, buys: () => buys, kinds: () => kinds, list: () => list,
    ledgerShops: () => ledgerShops, lastKind: () => lastKind(), shopsHtml: () => datalist(), refresh: (force) => refreshStocky(force) });
  byShop = store.get("journal-stocky-byshop", "") === "1";
  try { shut = new Set(JSON.parse(store.get("journal-stocky-shut", "[]"))); } catch (_) { shut = new Set(); }
  addEventListener("hashchange", () => {
    const { page, action } = route();
    if (page !== "add") newName = "";
    closePeek(); pricing = page === "item" && action === "price"; editing = false; unfolded.clear(); refreshStocky(true);
    if (pricing) $("stocky").querySelector('[data-skform="price"] input[name=price]')?.focus();
  });
  wire();
  wireReceipts($("stocky"));
}
export function startStocky() {
  const on = (c, set) => unsubs.push(onSnapshot(cols[c], (s) => { set(s.docs.map((d) => ({ id: d.id, ...d.data() }))); refreshStocky(); }));
  on("pantry", (v) => { pantry = v.sort((a, b) => a.name.localeCompare(b.name)); pricesChanged(); });
  on("buys", (v) => { buys = v; pricesChanged(); });
  on("prices", (v) => { prices = v; pricesChanged(); });
  on("shopList", (v) => { list = v.sort((a, b) => (a.created || 0) - (b.created || 0)); });
  on("kinds", (v) => { kinds = allKinds(v); repaintMenus(); });
  on("ledgerShops", (v) => { ledgerShops = v; });
  startReceipts();
}
export function stopStocky() { unsubs.forEach((u) => u()); unsubs = []; stopReceipts(); }

function compute() {
  const { meals, sets } = mealData(), t = today();
  const keyOfShop = route().page === "prices" ? priceShopKey : undefined;
  ests = {}; boards = {};
  for (const p of pantry) { ests[p.id] = estimate(p, buys, meals, t, sets); boards[p.id] = priceBoard(p.id, buys, prices, t, keyOfShop); }
}

// The pantry item behind a Meals food. A food can come from several (bihun goreng ayam: bihun and ayam),
// so the one nearest to running out speaks for it.
const WORST = { out: 0, low: 1, soon: 2, unknown: 3, ok: 4 };
function linkedItem(foodId) {
  const its = pantry.filter((x) => linksTo(x, foodId));
  return its.sort((a, b) => (WORST[ests[a.id]?.status] ?? 3) - (WORST[ests[b.id]?.status] ?? 3))[0] || null;
}
// For the meal card: how the pantry item linked to a Meals food is doing. null if no item is linked.
export function stockOf(foodId) {
  const p = linkedItem(foodId);
  if (!p) return null;
  const e = ests[p.id] || estimate(p, buys, mealData().meals, today(), mealData().sets);
  return { item: p.id, name: p.name, status: e.status, daysLeft: e.daysLeft, listed: onList(p.id) };
}
// For the meal set editor: every Price book item to pick as an ingredient, by name.
export const priceItems = () => pantry.map((p) => ({ id: p.id, name: p.name, unit: p.unit })).sort((a, b) => a.name.localeCompare(b.name));
// What a meal set costs a plate, from the Price book (setCost in stocky.js).
export const costOf = (set) => setCost(set, pantry, buys, prices, today());
// Put the item linked to a food on the list (from the meal card).
export async function listFood(foodId) {
  const p = linkedItem(foodId);
  if (!p || onList(p.id)) return;
  await addRow({ name: p.name, item: p.id, qty: p.pack, unit: p.unit, from: "manual" });
}
// For Ledger (through app.js): the shop names Stocky uses, what Stocky bought at a shop, and renaming a
// shop's rows when Ledger gives it a new name (so they stay with it).
export const stockyShops = () => shopNames(buys, prices);
export const stockyAtShop = (names) => stockyAt(names, buys, pantry);
export const stockySince = (names) => firstUsed(names, [...buys, ...prices]);
// A shop as typed, shown by the name that came first, the other (from Ledger) as a small remark.
function shopHtml(name) {
  const sh = ledgerShopOf(name, ledgerShops);
  if (!sh) return esc(name);
  const l = shopLabel(sh);
  return `${esc(l.main)}${l.remark ? ` <span class="sk-aka">${esc(l.remark)}</span>` : ""}`;
}
export async function renameStockyShop(from, to) {
  const rows = [...renames(from, to, buys).map((r) => [cols.buys, r]), ...renames(from, to, prices).map((r) => [cols.prices, r])];
  if (rows.length) await Promise.all(rows.map(([c, r]) => updateDoc(doc(c, r.id), { shop: r.shop })));
  return rows.length;
}
const onList = (itemId) => list.some((r) => r.item === itemId);
const addRow = (row) => commit(() => setDoc(doc(cols.shopList), { ...row, created: Date.now() }), `${row.name} is on the list.`);

// ---------- drawing ----------
const route = () => {
  const h = location.hash.replace(/^#stocky\/?/, "");
  const [page, id, action] = h.split("/");
  return { page: page || "home", id, action };
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
  const PAGES = { item: () => itemPage(r.id), add: addPage, prices: pricesPage, wishlist: wishlistPage, analytics: analyticsPage,
    plan: planPage, receipts: receiptsPage, receipt: () => receiptPage(r.id), scan: scanPage };
  host.innerHTML = (PAGES[r.page] || homePage)();
  if (sheet.open && peek) sheet.innerHTML = sheetHtml(peek);
  syncForms();
}

const nav = (on) => `<nav class="chips sk-nav" aria-label="Stocky pages">${[["", `${ico("cart")} List`], ["prices", `${ico("tag")} Price book`],
  ["wishlist", `${ico("star")} Wishlist`], ["analytics", `${ico("chart")} Analytics`], ["plan", `${ico("plate")} Plan meals`], ...(canScan() ? [["receipts", `${ico("receipt")} Scan receipt`]] : [])]
  .map(([k, v]) => `<a class="chip" href="#stocky${k ? "/" + k : ""}" aria-pressed="${on === (k || "home")}">${v}</a>`).join("")}</nav>`;
const say = () => `<p class="note sk-msg" role="status">${esc(msg)}</p>`;
const PILL = { out: ["--obese", "Out"], low: ["--over", "Low"], soon: ["--under", "Buy soon"], ok: ["--good", "Fine"], unknown: ["--line", "Not sure"], noRestock: ["--line", "No auto-restock"] };
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
  return `<span class="sk-best">Cheapest: <b>${shopHtml(b.shop)}</b> ${money(shown(b.now, unit))} ${unitLabel(unit)}${b.onSale ? ` <i class="sk-sale">Sale</i>` : ""}</span>`;
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
// Every shop: Ledger's named shops first (so both journals spell them the same), then Stocky's own,
// then the rest of Ledger's shops (ones only Ledger has spending at so far).
const shopList = () => shopChoices(ledgerShops, [...shopNames(buys, prices), ...ledgerNames()]);
const priceShopName = (name) => {
  const shop = ledgerShopOf(name, ledgerShops);
  return shop ? shopLabel(shop).main : name;
};
const priceShopKey = (name) => shopId(priceShopName(name)) || name;
const datalist = () => `<datalist id="skShops">${shopList().map((s) => `<option value="${esc(s)}">`).join("")}</datalist>`;
// The Kind field: type a name (the keyboard opens), or tap ▾ for the list. A name that isn't a kind yet
// becomes a new kind when the item is saved. Your own kinds have ✕ in the list. Only Food links to Meals.
const kindName = (id) => kindOf(id, kinds).name;
// Forms start from the last choice (great-ux skill): the shop of the newest buy or price seen, the kind and unit of
// the newest item. Blank until there is one, so nothing is guessed the first time.
const lastShop = () => lastUsed([...buys, ...prices], "shop");
const lastKind = () => { const k = lastUsed(pantry, "kind"); return k && kinds.some((x) => x.id === k) ? k : ""; };
const lastUnit = () => lastUsed(pantry, "unit");
const UNIT_WORDS = { g: "grams", ml: "ml", pcs: "pieces" };
const unitSelect = (sel) => `<label>Counted in<select name="unit">${sel ? "" : `<option value="" selected disabled>Pick one</option>`}${Object.keys(UNITS).map((u) => `<option value="${u}"${sel === u ? " selected" : ""}>${UNIT_WORDS[u]}</option>`).join("")}</select></label>`;
const kindField = (selId) => `<div class="sk-kindf"><span class="sk-lbl">Kind</span>
  <div class="sk-combo"><input type="text" name="kind" value="${selId ? esc(kindName(selId)) : ""}" maxlength="30" autocomplete="off" autocapitalize="words" enterkeyhint="done" placeholder="Type or pick" role="combobox" aria-label="Kind" aria-autocomplete="list" aria-expanded="false"><button type="button" class="sk-combo-btn" data-sk="kindmenu" aria-label="Show all kinds" aria-expanded="false">▾</button></div>
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
// Kind fields on the page and in the quick sheet.
const kindBoxes = () => [...($("stocky")?.querySelectorAll(".sk-kindf") || []), ...($("skSheet")?.querySelectorAll(".sk-kindf") || [])];
function closeMenus(except) {
  for (const box of kindBoxes()) {
    if (box === except) continue;
    box.querySelector(".sk-menu").hidden = true;
    box.querySelectorAll("[aria-expanded]").forEach((x) => x.setAttribute("aria-expanded", "false"));
  }
}
function repaintMenus() {
  for (const box of kindBoxes()) {
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
const restockCheckbox = (p, attrs = "") => `<label class="sk-check"><input type="checkbox" name="noRestock"${p?.noRestock ? " checked" : ""}${attrs}> No auto-restock</label>`;
function buyForm(r, p) {
  const unit = p?.unit || r.unit || lastUnit(), qty = r.qty || p?.pack || "";
  return `<form class="mform sk-buy" data-skform="buy" data-key="${esc(r.key)}" novalidate>
    ${p ? "" : `<div class="two">${kindField(r.food ? "food" : lastKind())}${unitSelect(unit)}</div>`}
    <div class="two"><label>How much${p ? ` (${unit})` : ""}<input type="number" name="qty" inputmode="decimal" min="0" value="${esc(qty)}"></label>
      <label>Price paid, ${"RM"}<input type="number" name="price" inputmode="decimal" min="0" step="0.01" placeholder="optional"></label></div>
    <label>Shop<input type="text" name="shop" list="skShops" maxlength="40" value="${esc(lastShop())}" placeholder="Like Mydin, Lotus's, pasar"></label>
    <label class="sk-check"><input type="checkbox" name="sale"> It was on sale</label>
    ${restockCheckbox(p)}
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
    ${pantry.length >= SEARCH_MIN || homeQ ? `<input type="search" id="skFind" class="gsearch sk-find" placeholder="Search ${pantry.length} items" aria-label="Search what's at home" aria-controls="skShelves" autocomplete="off" enterkeyhint="search" value="${esc(homeQ)}">` : ""}
    <div id="skShelves">${shelvesHtml()}</div>
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
  if (e.status === "noRestock") return "No auto-restock";
  if (e.status === "out") return "Out";
  const d = e.daysLeft;
  if (d == null) return e.left == null ? "New" : "Not sure";
  return d === 0 ? "Today" : d < 14 ? `${d} day${d === 1 ? "" : "s"}` : d < 60 ? `${Math.round(d / 7)} wk` : "2+ months";
}
// The shelves, or only what matches the search. A search looks on every shelf, folded ones too, and shows
// every match (no "+ more"); nothing found offers "Did you mean" and adding it. Redrawn alone while typing,
// so the search box keeps its focus and keyboard.
function shelvesHtml() {
  if (!pantry.length) return `<div class="mempty"><p><b>Add the things you buy often.</b></p><p class="note">Rice, eggs, milk, soap, tissue. Each time you buy one, Stocky learns how fast it goes and tells you before it runs out. Link food to your Meals foods and the meals you log count too.</p><a class="btn primary" href="#stocky/add">Add your first item</a></div>`;
  const q = homeQ.trim();
  if (!q) return shelves(pantry, ests, kinds).map((s) => shelfHtml(s)).join("");
  const { hits, close } = findByName(pantry, q);
  const clear = `<button type="button" class="linkbtn" data-sk="findclear">Clear search</button>`;
  if (!hits.length) return `<div class="sk-none" role="status"><p>Nothing called "<b>${esc(q)}</b>" at home.</p>
    ${close.length ? `<p class="note">Did you mean:</p><div class="chips">${close.map((p) => `<button type="button" class="chip" data-sk="peek" data-id="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</div>` : ""}
    <div class="actions"><a class="btn primary" href="#stocky/add" data-sk="addnamed" data-name="${esc(q)}">+ Add "${esc(q)}"</a>${clear}</div></div>`;
  return `<p class="note sk-found" role="status">${hits.length} of ${pantry.length} item${pantry.length === 1 ? "" : "s"} · ${clear}</p>
    ${shelves(hits, ests, kinds).map((s) => shelfHtml(s, true)).join("")}`;
}
function shelfHtml({ kind, items, need }, searching = false) {
  const open = searching || !shut.has(kind.id), all = searching || opened.has(kind.id) || items.length <= SHELF_TILES + 1;
  const shown = all ? items : items.slice(0, SHELF_TILES);
  const head = `<b>${esc(kind.name)}</b><small>${items.length}</small>${need ? `<span class="sk-need">${need} to buy</span>` : ""}`;
  return `<div class="sk-shelf">
    ${searching ? `<div class="sk-shelfhead">${head}</div>` : `<button type="button" class="sk-shelfhead" data-sk="shelf" data-kind="${esc(kind.id)}" aria-expanded="${open}">
      ${head}<i aria-hidden="true">▾</i></button>`}
    ${open ? `<div class="sk-tiles">${shown.map((p) => { const e = ests[p.id]; return `<button type="button" class="sk-tile is-${e.status}" data-sk="peek" data-id="${esc(p.id)}">
      <b>${esc(p.name)}</b><small>${esc(tileLeft(e))}</small>${p.noRestock ? "" : bar(e)}</button>`; }).join("")}${all ? "" : `<button type="button" class="sk-tile more" data-sk="more" data-kind="${esc(kind.id)}">+${items.length - shown.length} more</button>`}</div>` : ""}
  </div>`;
}
// The quick sheet: what a tile tap opens. The everyday jobs (how much is left, bought, add to list);
// "See everything" opens the full item page.
function sheetHtml(id) {
  const p = pantry.find((x) => x.id === id);
  if (!p) return `<div class="gsin"><p>This item isn't here any more.</p><div class="actions"><button type="button" data-sk="unpeek">Close</button></div></div>`;
  const e = ests[p.id], key = "item-" + p.id;
  // "✎ Edit" swaps the sheet for the item form, right here; saving comes back to the sheet.
  if (editing) return `<div class="gsin sk-peek">
    <div class="mhead"><h3 id="skSheetTitle">Edit ${esc(p.name)}</h3><button type="button" class="mini" data-sk="unpeek" aria-label="Close">✕</button></div>
    ${itemForm(p)}
    <div class="actions"><button type="button" class="danger mini" data-sk="del" data-id="${esc(p.id)}">Delete ${esc(p.name)}</button></div>
  </div>`;
  return `<div class="gsin sk-peek">
    <div class="mhead"><h3 id="skSheetTitle">${esc(p.name)}</h3>${pill(e.status)}<button type="button" class="mini" data-sk="edit" aria-label="Edit ${esc(p.name)}">✎ Edit</button><button type="button" class="mini" data-sk="unpeek" aria-label="Close">✕</button></div>
    ${p.noRestock ? "" : `${bar(e)}
    <p class="note">${esc(leftText(p, e))}${e.outOn && e.status !== "out" ? ` · runs out ${esc(day(e.outOn))}` : ""}</p>
    ${levelChips(p)}`}
    <div class="actions">${buying === key ? "" : `<button type="button" class="primary" data-sk="buy" data-key="${key}">Bought some</button>`}${onList(p.id) ? `<span class="note">On the list</span>` : `<button type="button" data-sk="list" data-id="${esc(p.id)}">Add to list</button>`}</div>
    ${buying === key ? buyForm({ key, item: p.id, qty: p.pack }, p) : restockCheckbox(p, ' data-sk-restock')}
    ${bestText(p.id, p.unit)}
    ${say()}
    <a class="sk-all" href="#stocky/item/${esc(p.id)}">See everything →</a>
  </div>`;
}
const levelChips = (p) => `<p class="mwhat">How much is left?</p>
  <div class="chips sk-levels" role="group" aria-label="How much is left">${LEVELS.map(([l, t]) => `<button type="button" class="chip" data-sk="level" data-id="${esc(p.id)}" data-level="${l}" aria-pressed="${p.check?.date === today() && p.check.level === l}">${t}</button>`).join("")}</div>`;
function openPeek(id) {
  peek = id; buying = null; editing = false; msg = "";
  const s = $("skSheet"); s.innerHTML = sheetHtml(id);
  if (!s.open) s.showModal();
}
function closePeek() {
  if (peek) editing = false;
  peek = null; priceCalc = null; buying = null; msg = "";
  const s = $("skSheet"); if (s?.open) s.close();
}

function openPriceCalculator({ id, shop, pack, price }) {
  const p = pantry.find((x) => x.id === id);
  if (!p || !PRICE_UNITS[p.unit]) return;
  const record = { qty: Number(pack), price: Number(price) };
  priceCalc = { record, unit: p.unit };
  const { qty, unit } = displayPack(record.qty, p.unit), sheet = $("skSheet");
  const options = Object.keys(PRICE_UNITS[p.unit]).map((u) =>
    `<option value="${u}"${u === unit ? " selected" : ""}>${u === "pcs" ? "pieces" : u}</option>`).join("");
  sheet.innerHTML = `<div class="gsin sk-peek">
    <div class="mhead"><h3 id="skSheetTitle">Price calculator · ${esc(p.name)}</h3><button type="button" class="mini" data-sk="unpeek" aria-label="Close">×</button></div>
    <p class="note">${shopHtml(shop)} · Saved price ${money(record.price)} for ${packNumber.format(qty)} ${unit}</p>
    <div class="mform">
      <div class="two"><label>Quantity<input id="skCalcQty" type="number" inputmode="decimal" min="0" step="any" value="${qty}"></label>
      <label>Unit<select id="skCalcUnit">${options}</select></label></div>
      <p>Estimated price <strong><output id="skCalcTotal" for="skCalcQty skCalcUnit" aria-live="polite"></output></strong></p>
    </div>
  </div>`;
  updatePriceCalculator();
  sheet.showModal();
}

function updatePriceCalculator() {
  const { record, unit } = priceCalc;
  const result = priceAtQuantity(record, unit, $("skCalcQty").valueAsNumber, $("skCalcUnit").value);
  $("skCalcTotal").value = result == null ? "—" : money(result);
}

function itemPage(id) {
  const p = pantry.find((x) => x.id === id);
  if (!p) return `${nav("")}<section class="panel"><p>${pantry.length ? "This item isn't here any more." : "Opening…"}</p><a class="btn" href="#stocky">← Back</a></section>`;
  const e = ests[p.id], board = boards[p.id], { foods } = mealData();
  const linked = linkRows(p).map((r) => foods.find((f) => f.id === r.food)?.name).filter(Boolean);
  const hist = buys.filter((b) => b.item === p.id).sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0)).slice(0, 10);
  const key = "item-" + p.id;
  const fromPrices = route().action === "price";
  return `<div class="fdtop"><a class="btn" href="${fromPrices ? "#stocky/prices" : "#stocky"}">${fromPrices ? "← Price book" : "← Back"}</a></div>
  <section class="panel sk-detail" aria-labelledby="skItemTitle" data-title="${esc(p.name)}">
    <div class="mhead"><h2 id="skItemTitle">${esc(p.name)}</h2>${pill(e.status)}</div>
    <p class="note">${esc(kindName(p.kind))}${linked.length ? ` · used in <b class="ink">${esc(linked.join(", "))}</b>` : ""} · usually ${amount(p.pack, p.unit)} at a time</p>
    ${p.noRestock ? "" : `<div class="tiles"><div class="tile"><b>${e.left == null ? "–" : amount(e.left, p.unit)}</b>left</div><div class="tile"><b>${e.daysLeft ?? "–"}</b>days left</div><div class="tile"><b>${e.outOn ? esc(day(e.outOn)) : "–"}</b>runs out</div></div>
    <ul class="sk-why">${e.why.map((w) => `<li>${esc(w)}</li>`).join("")}</ul>
    ${levelChips(p)}`}
    <div class="actions">${buying === key ? "" : `<button type="button" class="primary" data-sk="buy" data-key="${key}">Bought some</button>`}${onList(p.id) ? `<span class="note">On the list</span>` : `<button type="button" data-sk="list" data-id="${esc(p.id)}">Add to list</button>`}</div>
    ${buying === key ? buyForm({ key, item: p.id, qty: p.pack }, p) : ""}
    <div class="actions">${wishlistButton(p)}${p.wishlist ? `<a class="btn mini" href="#stocky/wishlist/${esc(p.id)}">View on Wishlist</a>` : ""}</div>
    ${say()}
  </section>
  <section class="panel sk-more" aria-label="More about ${esc(p.name)}" data-title="Prices, buys and edit">
  ${part("prices", "Prices by shop", board.length ? `${esc(board[0].shop)} cheapest` : "None yet", pricing, `
    ${pricing ? "" : `<div class="actions"><button type="button" class="mini" data-sk="price">+ Price I saw</button></div>`}
    ${board.length ? `<div class="sk-board">${board.map((s, i) => `<div class="sk-shoprow${i === 0 ? " best" : ""}">
        <b>${shopHtml(s.shop)}${i === 0 ? ` <i class="sk-tag">Cheapest</i>` : ""}</b>
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
  return `<form class="mform" data-skform="price" data-id="${esc(p.id)}" novalidate>
    <div class="two"><label>Amount (${p.unit})<input type="number" name="qty" inputmode="decimal" min="0" step="any" value="${esc(p.pack)}"></label>
      <label>Price, RM<input type="number" name="price" inputmode="decimal" min="0" step="0.01"></label></div>
    <label>Shop<input type="text" name="shop" list="skShops" maxlength="40" value="${esc(lastShop())}" placeholder="Like Mydin, Lotus's, pasar"></label>
    <label>Date seen<input type="date" name="date" max="${today()}" value="${today()}"></label>
    <label class="sk-check"><input type="checkbox" name="sale" data-sk-toggle="until"> On sale</label>
    <label data-sk-show="until" hidden>Sale ends (optional)<input type="date" name="until"></label>
    <p class="note" data-sk-hint role="status"></p>
    <div class="actions"><button type="submit" class="primary">Save price</button><button type="button" data-sk="cancel">Cancel</button></div>
    ${datalist()}
  </form>`;
}
// One "Used in meals" row: meal food × how much of the item goes into 100 g of it.
// "+ New meal food from this" makes a Meals food out of the item itself (filled in with the numbers per 100 g).
const linkRow = (foods, a = {}, unit = "g") => `<div class="srow" data-link-row>
  <select name="linkFood" aria-label="Meal food"><option value="">Pick a meal food</option>${foods.map((f) => `<option value="${esc(f.id)}"${f.id === a.food ? " selected" : ""}>${esc(f.name)}</option>`).join("")}<option value="new">+ New meal food from this</option></select>
  <span class="sk-amt"><span class="sk-x" aria-hidden="true">×</span>
  <input type="number" name="linkPer" min="0" step="any" inputmode="decimal" value="${esc(a.per100 ?? "")}" placeholder="${unit === "pcs" ? "0.5" : "40"}" aria-label="How much in 100 g of that food">
  <span class="sk-unit" data-link-unit>${esc(unit)}</span>
  <button type="button" class="mini" data-sk="link-drop" aria-label="Remove">✕</button></span></div>`;
// Add or edit an item. Food can be linked to a Meals food, or a new Meals food made from it.
function itemForm(p) {
  const { foods } = mealData(), v = (k, d = "") => esc(p?.[k] ?? d);
  const source = p ? "" : addSource();
  const tracking = !!source;
  return `<form class="mform" data-skform="item" novalidate>
    <label>Name<input type="text" name="name" maxlength="60" value="${p ? v("name") : esc(newName)}" placeholder="Beras, Telur, Tisu"></label>
    <div class="two">${kindField(p ? kindOf(p.kind, kinds).id : lastKind())}${unitSelect(p ? p.unit : lastUnit())}</div>
    <label>${tracking ? "Pack quantity" : "Usually bought at once"}<input type="number" name="pack" inputmode="decimal" min="0" step="any" value="${v("pack", tracking ? 1 : "")}" placeholder="5000 for a 5 kg bag, 30 for a tray"></label>
    ${tracking ? "" : `${restockCheckbox(p)}
    <fieldset class="sk-links" data-sk-show="food">
      <legend>Used in meals</legend>
      <small class="note">Each meal food it goes into × how much of it is in 100 g of that food. Logging those meals uses it up.</small>
      ${(p ? linkRows(p) : []).map((a) => linkRow(foods, a, p.unit)).join("")}
      <button type="button" class="mini" data-sk="link-add">+ Add a meal food</button>
      <small class="note sk-eg">Like: Nasi putih × 40 g (dry rice cooks to 2.5×) · Ayam kam heong × 60 g · Telur rebus × 1.8 pcs.</small>
      <div data-sk-show="newfood" hidden><p class="note">The new meal food, per 100 g from the pack:</p><div class="four">
        <label>kcal<input type="number" name="kcal" inputmode="decimal" min="0" max="900"></label><label>Carbs g<input type="number" name="carb" inputmode="decimal" min="0" max="100" step="0.1"></label>
        <label>Protein g<input type="number" name="protein" inputmode="decimal" min="0" max="100" step="0.1"></label><label>Fat g<input type="number" name="fat" inputmode="decimal" min="0" max="100" step="0.1"></label></div></div>
    </fieldset>
    ${p ? "" : `<label class="sk-check"><input type="checkbox" name="bought" checked data-sk-toggle="bought"> I just bought it</label>
    <div data-sk-show="bought"><div class="two"><label>Price paid, RM<input type="number" name="price" inputmode="decimal" min="0" step="0.01" placeholder="optional"></label>
      <label>Shop<input type="text" name="shop" list="skShops" maxlength="40" value="${esc(lastShop())}" placeholder="optional"></label></div>
      <label class="sk-check"><input type="checkbox" name="sale"> It was on sale</label></div>${datalist()}`}`}
    <p class="note sk-msg" role="status">${esc(msg)}</p>
    <div class="actions"><button type="submit" class="primary">${p ? "Save changes" : "Add item"}</button>${p ? `<button type="button" data-sk="cancel">Cancel</button>` : `<a class="btn" href="${addBack(source)}">Cancel</a>`}</div>
  </form>`;
}
const addSource = () => ["prices", "wishlist"].includes(route().id) ? route().id : "";
const addBack = (source) => source ? `#stocky/${source}` : "#stocky";
const addPage = () => `<div class="fdtop"><a class="btn" href="${addBack(addSource())}">← Back</a></div>
  <section class="panel" aria-labelledby="skAddTitle"><h2 id="skAddTitle">Add an item</h2>${itemForm(null)}</section>`;

function wishlistButton(p, iconOnly = false) {
  const label = p.wishlist ? "Remove from Wishlist" : "Add to Wishlist";
  return `<button type="button" class="mini${iconOnly ? " sk-favorite" : ""}" data-sk="wishlist-toggle" data-id="${esc(p.id)}" aria-pressed="${!!p.wishlist}"${iconOnly ? ` aria-label="${label}: ${esc(p.name)}" title="${label}"` : ""}>${ico("star")}${iconOnly ? "" : ` ${label}`}</button>`;
}
const historyFor = (p) => priceHistory(p, buys, prices, today(), priceShopKey);

function wishlistPage() {
  const items = pantry.filter((p) => p.wishlist);
  const p = items.find((item) => item.id === route().id);
  if (p) return `${nav("wishlist")}
    <div class="fdtop"><a class="btn" href="#stocky/wishlist">← Wishlist</a></div>
    <section class="panel"><h2>${esc(p.name)}</h2>
      <div class="actions">
        ${pricing ? "" : '<button type="button" class="primary" data-sk="price">+ Record price</button>'}
        <a class="btn" href="#stocky/analytics/${esc(p.id)}">Compare shops</a>
        ${wishlistButton(p)}
      </div>
      ${pricing ? priceForm(p) : ""}
      ${historyChart(p, historyFor(p), priceShopName)}
    </section>`;
  const available = pantry.filter((item) => !item.wishlist);
  return `${nav("wishlist")}
    <section class="panel" aria-labelledby="skWishTitle"><div class="mhead">
      <h2 id="skWishTitle">Wishlist</h2><a class="btn primary" href="#stocky/add/wishlist">+ New item</a>
    </div>
    ${available.length ? `<form class="mform" data-skform="wishlist">
      <label>Add an existing item<select name="item" required><option value="">Choose an item</option>
        ${available.map((item) => `<option value="${esc(item.id)}">${esc(item.name)}</option>`).join("")}</select></label>
      <div class="actions"><button type="submit" class="mini">Add to Wishlist</button></div>
    </form>` : ""}
    ${items.length ? `<div class="mlist">${items.map((item) =>
    `<a class="mitem sk-link" href="#stocky/wishlist/${esc(item.id)}"><b>${esc(item.name)}</b><span>Price history →</span></a>`).join("")}</div>`
    : '<p class="note">Add a planned purchase to start tracking the prices you see.</p>'}
    </section>`;
}

function analyticsPage() {
  const pricedIds = new Set([...buys, ...prices].filter((r) => r.shop && perUnit(r) > 0).map((r) => r.item));
  const selectedId = route().id;
  const options = pantry.filter((p) => p.id === selectedId || p.wishlist || pricedIds.has(p.id));
  const p = options.find((item) => item.id === selectedId) || options[0];
  const shops = p ? historyFor(p) : [];
  return `${nav("analytics")}
    <section class="panel"><h2>Price analytics</h2>
    ${p ? `<label for="skAnalyticsItem">Item</label>
      <select id="skAnalyticsItem">${options.map((item) => `<option value="${esc(item.id)}"${item.id === p.id ? " selected" : ""}>${esc(item.name)}</option>`).join("")}</select>
      <div id="skAnalyticsResults">${analyticsResults(p, shops)}</div>`
    : '<p class="note">Record a shop price to start comparing prices and checking sale claims.</p>'}
    </section>`;
}

function analyticsResults(p, shops) {
  return historyChart(p, shops, priceShopName) + shopComparison(p, shops, priceShopName);
}

function openPriceAnalytics(id) {
  const p = pantry.find((item) => item.id === id);
  if (!p) return;
  const sheet = $("skSheet");
  sheet.innerHTML = `<div class="gsin sk-peek">
    <div class="mhead"><h3 id="skSheetTitle">Price history · ${esc(p.name)}</h3><button type="button" class="mini" data-sk="unpeek" aria-label="Close" autofocus>×</button></div>
    ${analyticsResults(p, historyFor(p))}
  </div>`;
  sheet.showModal();
}

function pricesPage() {
  const shops = new Map();
  for (const board of Object.values(boards)) {
    for (const { shop } of board) shops.set(priceShopKey(shop), priceShopName(shop));
  }
  // Keep the selected shop available when its last price is edited or removed.
  if (priceShop && !shops.has(priceShop.key)) shops.set(priceShop.key, priceShop.name);
  const options = [...shops].sort((a, b) => a[1].localeCompare(b[1]));
  return `${nav("prices")}
    <div class="actions"><a class="btn primary" href="#stocky/add/prices">+ Add item</a></div>
    <div class="sk-price-filters">
      <input type="search" id="skPriceFind" class="gsearch" placeholder="Search items" aria-label="Search the Price book" aria-controls="skPriceResults" autocomplete="off" enterkeyhint="search" value="${esc(priceQ)}">
      <select id="skPriceShop" aria-label="Filter prices by shop" aria-controls="skPriceResults"><option value="">All shops</option>${options.map(([key, name]) => `<option value="${esc(key)}"${key === priceShop?.key ? " selected" : ""}>${esc(name)}</option>`).join("")}</select>
    </div>
    <div id="skPriceResults">${priceResults()}</div>`;
}

const packNumber = new Intl.NumberFormat(undefined, { maximumFractionDigits: 5 });
const displayPack = (qty, unit) => qty >= 1000 && unit !== "pcs"
  ? { qty: qty / 1000, unit: unit === "g" ? "kg" : "L" } : { qty, unit };
const priceActions = (p) => `<div class="sk-price-actions">${wishlistButton(p, true)}
  <button type="button" class="mini sk-price-chart" data-sk="price-analytics" data-id="${esc(p.id)}" aria-label="Price history: ${esc(p.name)}" title="Price history" aria-haspopup="dialog">${ico("chart")}</button>
</div>`;

function priceRow(p, s, detail) {
  const { record } = s, { qty, unit } = displayPack(Number(record.qty), p.unit);
  const standardQty = p.unit === "pcs" ? 1 : 1000;
  const standardPack = Number(record.qty) === standardQty;
  const comparison = standardPack ? "" : `<small>${money(shown(s.now, p.unit))} ${unitLabel(p.unit)}</small>`;
  return `<div class="sk-price-entry"><button type="button" class="mitem sk-link sk-price-row" data-sk="calculate-price" data-id="${esc(p.id)}" data-shop="${esc(s.shop)}" data-pack="${esc(record.qty)}" data-price="${esc(record.price)}" aria-haspopup="dialog">
    <span><b>${esc(p.name)}</b><small>${shopHtml(s.shop)}${detail}</small></span>
    <span><b>${money(record.price)}</b><small>${standardPack ? "per" : "for"} ${packNumber.format(qty)} ${unit === "pcs" && qty === 1 ? "piece" : unit}</small>${comparison}</span>
  </button>${priceActions(p)}</div>`;
}

function priceResults() {
  const shopsFor = (p) => priceShop ? boards[p.id].filter((s) => priceShopKey(s.shop) === priceShop.key) : boards[p.id];
  const priced = pantry.map((p) => ({ ...p, offers: shopsFor(p) })).filter((p) => p.offers.length);
  const q = priceQ.trim();
  const withP = q ? findByName(priced, q).hits : priced;
  const withoutPrices = priceShop ? [] : pantry.filter((p) => !boards[p.id].length);
  const unpriced = q ? findByName(withoutPrices, q).hits : withoutPrices;
  if ((q || priceShop) && !withP.length && !unpriced.length) return `<p class="note" role="status">No items${q ? ` match “${esc(q)}”` : ""}${priceShop ? ` at ${esc(priceShop.name)}` : ""}.</p>`;
  const sales = withP.flatMap((p) => p.offers.filter((s) => s.onSale).map((s) =>
    priceRow(p, s, ` · <i class="sk-sale">Sale</i>${s.until ? ` till ${esc(day(s.until))}` : ""}${s.normal ? ` · normal ${money(shown(s.normal, p.unit))} ${unitLabel(p.unit)}` : ""}`)));
  const title = priceShop ? "Prices at " + priceShop.name : "Cheapest shop for each";
  return `<section class="panel" aria-labelledby="skSaleTitle" data-title="On sale now">
    <h2 id="skSaleTitle">On sale now</h2>
    ${sales.length ? `<div class="mlist">${sales.join("")}</div>`
      : `<p class="note">${q || priceShop ? "No matching items on sale." : 'No sales noted. Tick "On sale" when you add a price and it shows here.'}</p>`}
  </section>
  <section class="panel" aria-labelledby="skCheapTitle">
    <h2 id="skCheapTitle">${esc(title)}</h2>
    ${withP.length ? '<p class="note">Tap an item to calculate the price for another quantity.</p>' : ""}
    ${withP.length ? `<div class="mlist">${withP.map((p) => {
      const [s] = p.offers;
      const sale = s.onSale ? ` · <i class="sk-sale">Sale</i>` : "";
      const compared = priceShop ? "" : p.offers.length > 1 ? ` · ${p.offers.length} shops compared` : " · only one shop so far";
      return priceRow(p, s, sale + compared);
    }).join("")}</div>`
      : `<p class="note">Add prices when you buy, or tap an item and add a price you saw. Stocky compares the price per kg, per litre or per piece, so different pack sizes are fair.</p>`}
  </section>
  ${unpriced.length ? `<section class="panel"><h2>No recent shop price</h2><div class="mlist">
    ${unpriced.map((p) => `<div class="sk-price-entry"><a class="mitem sk-link sk-price-row" href="#stocky/item/${esc(p.id)}/price"><span><b>${esc(p.name)}</b></span><span>Record a price →</span></a>${priceActions(p)}</div>`).join("")}
  </div></section>` : ""}`;
}

function planPage() {
  const { foods, sets, meals } = mealData();
  const need = planNeeds(sets, plan, foods, meals, people());
  const short = shortfall(need, pantry, ests, foods).filter((r) => !list.some((x) => (r.item && x.item === r.item) || (!r.item && x.food === r.food)));
  return `${nav("plan")}
  <section class="panel" aria-labelledby="skPlanTitle" data-title="Plan meals">
    <h2 id="skPlanTitle">What will you cook this week?</h2>
    <p class="note">Pick your meal sets and how many times. Stocky works out the food for both of you from your usual portions (a cooked set is one pot each time; bought ones need nothing), takes off what's at home, and adds the rest to the list.</p>
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
    if (el.kind && f.querySelector(".sk-links")) {
      const food = isFood(f), rows = [...f.querySelectorAll("[data-link-row]")];
      show("food", food);
      show("newfood", food && rows.some((r) => r.querySelector("select").value === "new"));
      f.querySelectorAll("[data-link-unit]").forEach((x) => { x.textContent = el.unit.value || "g"; });
      // A meal food made from the item itself is all item: 100 g in 100 g unless something else is typed.
      rows.forEach((r) => { r.querySelector('[name="linkPer"]').placeholder = r.querySelector("select").value === "new" && el.unit.value !== "pcs" ? "100" : el.unit.value === "pcs" ? "0.5" : "40"; });
      const add = f.querySelector('[data-sk="link-add"]'); if (add) { add.hidden = rows.length >= LINKS_MAX; add.textContent = rows.length ? "+ Another meal food" : "+ Add a meal food"; }
    }
    if (el.bought) show("bought", el.bought.checked);
    if (el.until) show("until", el.sale.checked);
    hint(f);
  }
}
// Under a price being typed: what it is per kg, and how it compares with usual.
function hint(f) {
  const h = f.querySelector("[data-sk-hint]"); if (!h) return;
  const el = f.elements, p = pantry.find((x) => x.id === (f.dataset.skform === "price" ? f.dataset.id : rowByKey(f.dataset.key)?.item));
  const q = Number(el.qty?.value), pr = Number(el.price?.value), unit = p?.unit || el.unit?.value;
  if (!(q > 0 && pr > 0) || !unit) { h.textContent = ""; return; }
  const u = perUnit({ qty: q, price: pr }), vs = p && vsUsual(p.id, u, buys, prices, today());
  h.textContent = `${money(shown(u, unit))} ${unitLabel(unit)}${vs && vs.pct ? `, ${Math.abs(vs.pct)}% ${vs.pct < 0 ? "under" : "over"} the usual ${money(shown(vs.usual, unit))}` : vs ? ", the usual price" : ""}.`;
}
const rowByKey = (k) => (k?.startsWith("item-") ? { key: k, item: k.slice(5) } : listRows().find((r) => r.key === k));

// ---------- saving ----------
// The kind typed in a form: an existing id, or a new kind to save with the item.
function kindFrom(f) {
  const m = matchKind(f.elements.kind?.value, kinds);
  if (m.error) return m;
  if (m.id) return { id: m.id, ids: kinds.map((k) => k.id) };
  const ref = doc(cols.kinds);
  return { id: ref.id, ids: [...kinds.map((k) => k.id), ref.id], make: { ref, body: { name: m.name, created: Date.now() } } };
}
async function saveBuy(f) {
  const r = rowByKey(f.dataset.key); if (!r || f.dataset.saving) return;
  const el = f.elements, { rec, error } = readPrice({ qty: el.qty.value, price: el.price.value, shop: el.shop.value, sale: el.sale.checked });
  if (error) { setMsg(f, error); return; }
  const existing = pantry.find((p) => p.id === r.item || (!r.item && p.name.toLowerCase() === String(r.name).toLowerCase()));
  const ref = existing ? doc(cols.pantry, existing.id) : doc(cols.pantry);
  const noRestock = el.noRestock.checked, batch = writeBatch(db), at = Date.now();
  if (!existing) {
    const k = kindFrom(f);
    if (k.error) { setMsg(f, k.error); return; }
    if (!el.unit.value) { setMsg(f, "Pick what it's counted in: grams, ml or pieces."); return; }
    const { item, error: e2 } = readItem({ name: r.name, kind: k.id, unit: el.unit.value, pack: rec.qty, links: r.food && el.unit.value !== "pcs" ? [{ food: r.food, per100: 100 }] : [] }, k.ids);
    if (e2) { setMsg(f, e2); return; }
    if (k.make) batch.set(k.make.ref, k.make.body);
    batch.set(ref, { ...item, created: at, ...(noRestock ? { noRestock } : {}) });
  } else if (noRestock !== el.noRestock.defaultChecked) {
    batch.update(ref, { noRestock });
  }
  batch.set(doc(cols.buys), { item: ref.id, date: today(), ...rec, by: me(), at });
  if (r.doc) batch.delete(doc(cols.shopList, r.doc));
  const message = `Bought ${r.name || existing?.name || ""}.`, submit = f.querySelector('[type="submit"]');
  f.dataset.saving = "1"; f.dataset.dirty = "1"; submit.disabled = true;
  try {
    await commit(() => batch.commit(), message);
    if (f.isConnected && buying === r.key) { buying = null; msg = message; refreshStocky(true); }
  } catch (_) {
    if (f.isConnected) setMsg(f, "Could not save the purchase. Try again.");
  } finally {
    delete f.dataset.saving;
    submit.disabled = false;
  }
}
async function savePreviewRestock(input) {
  const id = peek, p = pantry.find((x) => x.id === id);
  if (!p) return;
  const noRestock = input.checked;
  input.disabled = true;
  try {
    await commit(() => updateDoc(doc(cols.pantry, id), { noRestock }));
    const current = pantry.find((item) => item.id === id);
    if (current) current.noRestock = noRestock;
    if (peek === id && input.isConnected) {
      refreshStocky(true);
      $("skSheet").querySelector("[data-sk-restock]")?.focus();
    }
  } catch (_) {
    input.checked = !!pantry.find((item) => item.id === id)?.noRestock;
  } finally {
    input.disabled = false;
  }
}
async function savePrice(f) {
  if (f.dataset.saving) return;
  const el = f.elements, date = el.date.value, p = pantry.find((item) => item.id === f.dataset.id);
  if (!p) { setMsg(f, "This item is no longer available."); return; }
  if (!date || date > today() || el.date.validity.rangeOverflow) { setMsg(f, "Pick the date you saw the price, up to today."); return; }
  if (el.sale.checked && el.until.value && el.until.value < date) { setMsg(f, "The sale end must be on or after the date seen."); return; }
  const { rec, error } = readPrice({ qty: el.qty.value, price: el.price.value, shop: el.shop.value, sale: el.sale.checked, until: el.until.value }, { needPrice: true });
  if (error) { setMsg(f, error); return; }
  const submit = f.querySelector('[type="submit"]');
  f.dataset.saving = "1"; f.dataset.dirty = "1"; submit.disabled = true;
  try {
    await commit(() => setDoc(doc(cols.prices), { item: p.id, unit: p.unit, date, ...rec, at: Date.now() }), "Price saved.");
    if (f.isConnected) { pricing = false; msg = ""; refreshStocky(true); }
  } catch (_) {
    if (f.isConnected) setMsg(f, "Could not save the price. Try again.");
  } finally {
    delete f.dataset.saving;
    submit.disabled = false;
  }
}
async function saveItem(f) {
  if (f.dataset.saving) return;
  const el = f.elements, id = $("skSheet").contains(f) ? peek : route().page === "item" ? route().id : null, { foods } = mealData();
  const source = route().page === "add" ? addSource() : "";
  const k = kindFrom(f);
  if (k.error) { setMsg(f, k.error); return; }
  if (!el.unit.value) { setMsg(f, "Pick what it's counted in: grams, ml or pieces."); return; }
  const links = k.id === "food" ? [...f.querySelectorAll("[data-link-row]")].map((r) => ({ food: r.querySelector('[name="linkFood"]').value, per100: r.querySelector('[name="linkPer"]').value })) : [];
  // "+ New meal food from this": the numbers per 100 g become a food in the Meals library (one per save).
  // Eaten as it is bought, so 100 g of it in 100 g of the food unless something else is typed.
  let newFood = null;
  if (links.some((l) => l.food === "new")) {
    const r = readFood({ name: el.name.value.trim(), kcal: el.kcal.value, carb: el.carb.value, protein: el.protein.value, fat: el.fat.value });
    if (r.error) { setMsg(f, r.error); return; }
    const same = foods.find((x) => x.name.toLowerCase() === r.food.name.toLowerCase());
    const foodId = same ? same.id : doc(cols.foods).id;
    if (!same) newFood = { ref: doc(cols.foods, foodId), body: { ...r.food, created: Date.now(), updated: Date.now() } };
    for (const l of links) if (l.food === "new") { l.food = foodId; if (l.per100 === "") l.per100 = el.unit.value === "pcs" ? "" : 100; }
  }
  const { item, error } = readItem({ name: el.name.value, kind: k.id, unit: el.unit.value, pack: el.pack.value, links }, k.ids);
  if (error) { setMsg(f, error); return; }
  if (pantry.some((p) => p.id !== id && p.name.toLowerCase() === item.name.toLowerCase())) { setMsg(f, "That's already in Stocky."); return; }
  let buy = null;
  if (!id && el.bought?.checked) {
    const p = readPrice({ qty: item.pack, price: el.price.value, shop: el.shop.value, sale: el.sale.checked });
    if (p.error) { setMsg(f, p.error); return; }
    buy = p.rec;
  }
  const ref = id ? doc(cols.pantry, id) : doc(cols.pantry);
  const at = Date.now(), batch = writeBatch(db), noRestock = !!(source || el.noRestock?.checked);
  if (k.make) batch.set(k.make.ref, k.make.body);
  if (newFood) batch.set(newFood.ref, newFood.body);
  if (id) batch.update(ref, { ...item, links: item.links || [], noRestock, updated: at });
  else batch.set(ref, { ...item, created: at, updated: at, ...(noRestock ? { noRestock } : {}),
    ...(source === "wishlist" ? { wishlist: true } : {}) });
  if (buy) batch.set(doc(cols.buys), { item: ref.id, date: today(), ...buy, by: me(), at });
  const message = id ? "Saved." : `Added ${item.name}.${newFood ? " It's in your Meals foods too." : ""}`;
  const submit = f.querySelector('[type="submit"]');
  f.dataset.saving = "1"; f.dataset.dirty = "1"; submit.disabled = true;
  try {
    await commit(() => batch.commit(), message);
    if (!f.isConnected) return;
    if (source === "prices") location.hash = `#stocky/item/${ref.id}/price`;
    else if (source === "wishlist") location.hash = `#stocky/wishlist/${ref.id}`;
    else if (!id) location.hash = "#stocky";
    else { editing = false; msg = message; refreshStocky(true); }
  } catch (_) {
    if (f.isConnected) setMsg(f, "Could not save the item. Try again.");
  } finally {
    delete f.dataset.saving;
    submit.disabled = false;
  }
}

async function setWishlist(id, wishlist, button, target) {
  if (!pantry.some((p) => p.id === id) || button.disabled) return;
  const hash = location.hash;
  button.disabled = true;
  try {
    await commit(() => updateDoc(doc(cols.pantry, id), { wishlist }), wishlist ? "Added to Wishlist." : "Removed from Wishlist.");
    if (target && location.hash === hash) location.hash = target;
  } catch (_) {
    // The shared save helper reports write failures.
  } finally {
    button.disabled = false;
  }
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
  for (const input of kindBoxes().map((b) => b.querySelector("input"))) if (input.value.trim().toLowerCase() === k.name.toLowerCase()) input.value = to;
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
  closePeek();
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
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet && !sheet.querySelector("form[data-dirty]")) sheet.close(); }); // tap outside closes, unless it would lose typing
  sheet.addEventListener("close", () => {
    if (sheet.open) return;
    if (priceCalc) priceCalc = null;
    if (peek || pending) { closePeek(); refreshStocky(); }
  });
  both("click", async (ev) => {
    closeMenus(ev.target.closest(".sk-kindf"));
    const b = ev.target.closest("[data-sk]"); if (!b) return;
    const act = b.dataset.sk, id = b.dataset.id || route().id, here = sheet.open ? sheet : host;
    if (act === "peek") openPeek(b.dataset.id);
    if (act === "unpeek") { closePeek(); if (pending) refreshStocky(); }
    if (act === "wishlist-toggle") {
      const p = pantry.find((item) => item.id === id);
      if (p) await setWishlist(id, !p.wishlist, b, route().page === "wishlist" ? "#stocky/wishlist" : "");
    }
    if (act === "calculate-price") openPriceCalculator(b.dataset);
    if (act === "price-analytics") openPriceAnalytics(id);
    if (act === "shelf") { const k = b.dataset.kind; shut.has(k) ? shut.delete(k) : shut.add(k); store.set("journal-stocky-shut", JSON.stringify([...shut])); refreshStocky(true); }
    if (act === "more") { opened.add(b.dataset.kind); refreshStocky(true); }
    if (act === "findclear") { homeQ = ""; refreshStocky(true); $("skFind")?.focus(); }
    if (act === "addnamed") newName = b.dataset.name; // the link then opens the add page with the name typed in
    if (act === "buy") { buying = b.dataset.key; pricing = false; msg = ""; refreshStocky(true); here.querySelector(".sk-buy input[name=qty]")?.focus(); }
    if (act === "cancel") { buying = null; pricing = false; editing = false; msg = ""; refreshStocky(true); }
    if (act === "byshop") { byShop = !byShop; store.set("journal-stocky-byshop", byShop ? "1" : ""); refreshStocky(true); }
    if (act === "unlist") await unlist(b.dataset.id);
    if (act === "kind-del") await removeKind(b.dataset.id);
    if (act === "kindmenu") { const f = b.closest("form"), menu = f.querySelector(".sk-menu"); if (menu.hidden || !menu.dataset.all) openMenu(f, true); else closeMenus(); } // suggestions open → show them all
    // "Used in meals" rows are added and removed in place, so what's typed elsewhere in the form stays.
    if (act === "link-add") { const f = b.closest("form"), unit = f.elements.unit?.value || "g"; b.insertAdjacentHTML("beforebegin", linkRow(mealData().foods, {}, unit)); f.dataset.dirty = "1"; syncForms(); b.previousElementSibling?.querySelector("select")?.focus(); }
    if (act === "link-drop") { const f = b.closest("form"); b.closest("[data-link-row]").remove(); f.dataset.dirty = "1"; syncForms(); }
    if (act === "kindpick") { const f = b.closest("form"); f.elements.kind.value = b.dataset.name; f.dataset.dirty = "1"; closeMenus(); syncForms(); }
    if (act === "list") { const p = pantry.find((x) => x.id === b.dataset.id); if (p) { msg = `${p.name} is on the list.`; await addRow({ name: p.name, item: p.id, qty: p.pack, unit: p.unit, from: "manual" }); } }
    if (act === "level") {
      const check = { date: today(), at: Date.now(), level: Number(b.dataset.level) };
      const p = pantry.find((x) => x.id === id); if (p) { p.check = check; msg = "Thanks, the guess is updated."; refreshStocky(true); }
      await commit(() => updateDoc(doc(cols.pantry, id), { check }));
    }
    if (act === "price") { pricing = true; buying = null; refreshStocky(true); host.querySelector('[data-skform="price"] input[name=price]')?.focus(); }
    if (act === "unbuy") await unbuy(b.dataset.id);
    if (act === "edit") { editing = true; buying = null; msg = ""; refreshStocky(true); here.querySelector('[data-skform="item"] input[name=name]')?.focus(); }
    if (act === "del") await removeItem(b.dataset.id || route().id);
    if (act === "plan") { plan[b.dataset.id] = Math.max(0, Math.min(21, (plan[b.dataset.id] || 0) + Number(b.dataset.step))); refreshStocky(true); }
    if (act === "plan-add") {
      const { foods, sets, meals } = mealData();
      const short = shortfall(planNeeds(sets, plan, foods, meals, people()), pantry, ests, foods).filter((r) => !list.some((x) => (r.item && x.item === r.item) || (!r.item && x.food === r.food)));
      plan = {}; msg = `Added ${short.length} to the list.`;
      await commit(() => Promise.all(short.map((r) => setDoc(doc(cols.shopList), { ...r, from: "plan", created: Date.now() }))), msg);
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
    if (k === "wishlist") {
      const id = f.elements.namedItem("item").value;
      setWishlist(id, true, f.querySelector('[type="submit"]'), `#stocky/wishlist/${id}`);
    }
  });
  both("change", (ev) => {
    if (ev.target.matches("[data-sk-restock]")) { savePreviewRestock(ev.target); return; }
    if (ev.target.id === "skCalcUnit") { updatePriceCalculator(); return; }
    if (ev.target.id === "skAnalyticsItem") {
      const p = pantry.find((item) => item.id === ev.target.value);
      if (p) {
        history.replaceState(history.state, "", `#stocky/analytics/${p.id}`);
        $("skAnalyticsResults").innerHTML = analyticsResults(p, historyFor(p));
      }
      return;
    }
    if (ev.target.id === "skPriceShop") {
      const select = ev.target;
      priceShop = select.value ? { key: select.value, name: select.selectedOptions[0].textContent } : null;
      $("skPriceResults").innerHTML = priceResults();
      return;
    }
    const f = ev.target.closest("form.mform"); if (f) f.dataset.dirty = "1"; syncForms();
  });
  // An item page part opened or shut stays that way through live redraws ("toggle" doesn't bubble).
  host.addEventListener("toggle", (ev) => { const k = ev.target.dataset?.part; if (k) ev.target.open ? unfolded.add(k) : unfolded.delete(k); }, true);
  both("input", (ev) => {
    if (ev.target.id === "skCalcQty") { updatePriceCalculator(); return; }
    if (ev.target.id === "skFind") { homeQ = ev.target.value; $("skShelves").innerHTML = shelvesHtml(); return; } // only the results redraw
    if (ev.target.id === "skPriceFind") { priceQ = ev.target.value; $("skPriceResults").innerHTML = priceResults(); return; }
    const f = ev.target.closest("form"); if (!f) return;
    if (f.matches(".mform")) f.dataset.dirty = "1";
    if (ev.target.name === "kind" && ev.target.closest(".sk-kindf")) { openMenu(f, false); syncForms(); return; }
    hint(f);
  });
  both("keydown", (ev) => {
    if (ev.target.id === "skPriceFind") {
      if (ev.key === "Enter") ev.target.blur();
      if (ev.key === "Escape" && priceQ) { ev.preventDefault(); priceQ = ""; ev.target.value = ""; $("skPriceResults").innerHTML = priceResults(); }
      return;
    }
    if (ev.target.id === "skFind") {
      if (ev.key === "Enter") ev.target.blur(); // shuts the phone keyboard so the results show
      if (ev.key === "Escape" && homeQ) { ev.preventDefault(); homeQ = ""; ev.target.value = ""; $("skShelves").innerHTML = shelvesHtml(); }
      return;
    }
    if (ev.target.name !== "kind" || !ev.target.closest(".sk-kindf")) return;
    if (ev.key === "Enter") { ev.preventDefault(); closeMenus(); ev.target.blur(); }
    if (ev.key === "Escape") closeMenus();
  });
  document.addEventListener("click", (ev) => { if (!$("stocky").contains(ev.target) && !sheet.contains(ev.target)) closeMenus(); });
  both("focusout", () => setTimeout(() => { if (pending && !host.contains(document.activeElement) && !sheet.contains(document.activeElement)) refreshStocky(); }, 0));
}
