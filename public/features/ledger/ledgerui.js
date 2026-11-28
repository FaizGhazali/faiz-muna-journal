// The Ledger journal (#ledger view, picked on the wheel): add spending, card rebates, recent items,
// and the "Spending" part of each person card (ledgerSlot-<id>). All maths lives in ledger.js (pure).
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, writeBatch } from "../../core/fs.js";
import { $, esc, today, addDays, dayNum } from "../../core/util.js";
import { confirmDelete } from "../../core/confirm.js";
import { canEdit, viewOnly } from "../../core/owner.js";
import {
  SYSTEM_CATEGORIES, PRESETS, toSen, rm, shortDate, norm, categorise, cycleOf, lastStatement, cycleView, computeRebate,
  manualTxn, payWarning, warningText, tierLabel, spendByCat, spendTotal, ruleMatches,
} from "../../logic/ledger.js";
import { suggestPattern } from "../../logic/ledgerimport.js";
import { shopKey, byNick, usualCat } from "../../logic/bucketspend.js";
import { ledgerShopNames, whereChoices, whereMatches } from "../../logic/shops.js";
import { initImport, startImport, renderImport } from "./import.js";
import { initTrends, renderTrends } from "./trends.js";
import { initRules, startRules, renderRules } from "./rules.js";
import { ensureSeeds, addAccount, saveCycle } from "./seeds.js";
import { initPlan, planSubs, renderPlan, planState, billEntry } from "./plan.js";
import { payOf, monthOf, monthRange, addMonths, bucketsOf, txnBucket, ownBucket } from "../../logic/moneyplan.js";
import { initSpend, renderSpend, shopHtml } from "./spend.js";
import { initAnalytics, renderAnalytics, ANALYTICS } from "./analytics.js";
import { initDocs, openDocs, refreshDocs, resumeDocs, afterSignIn, docsOn } from "./docsui.js";
import { initTax, TAX, refreshTax, taxDocEntry } from "./taxui.js";
import { initIncome, renderIncome, incomeEntry, openIncome } from "./income.js";
import { makeBoard } from "../../shell/board.js";
import { boardPrefs } from "../../shell/prefs.js";
import { ico } from "../../core/icons.js";

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
const ACCT_KEY = "journal-ledger-acct";
const LOAD_DAYS = 400; // a year and a bit, for trends later
const RECENT = 15;
// How many Recent items each size shows before "Show more".
const RECENT_BY_SIZE = { s: 1, m: 3, l: RECENT };
// The Ledger cards' starting order and sizes (shell/board.js; each person can arrange their own phone):
// the everyday part first (add, check it saved), then the month as small tiles, the details below.
const BOARD = {
  defaults: [
    { id: "add", size: "m" }, { id: "recent", size: "m" },
    { id: "sum", size: "m" }, { id: "income", size: "s" }, { id: "bills", size: "s" }, { id: "card:*", size: "s" },
    { id: "people", size: "l" }, { id: "trends", size: "m" },
  ],
  sizes: { people: "l" },
  // Beside "Arrange cards": graphs that don't need a place on the board (analytics.js).
  extra: `<a class="btn mini" href="${ANALYTICS}">${ico("chart")} Analytics</a><a class="btn mini" href="${TAX}">${ico("file")} Income Tax</a>`,
};
const KINDS = { purchase: "Spend", payment: "Card payment", refund: "Refund" };
const TYPES = { credit_card: "Credit card", debit: "Debit card", ewallet: "E-wallet", cash: "Cash", bank: "Bank account" };
const CATS = SYSTEM_CATEGORIES.filter((c) => !c.hidden);
const cat = (id) => SYSTEM_CATEGORIES.find((c) => c.id === id) ?? SYSTEM_CATEGORIES.find((c) => c.id === "other");

let db, commit, people, me, unsubs = [], seeded = false;
let accounts = [], programs = [], aliases = [], cycles = {}, txns = [], rebates = {}, shopNames = [], incomes = [], taxRecords = [];
// "Always categorise" offer after a category is changed by hand: { raw, cat, pattern, host, msg }.
let offer = null, openRow = null;
// The add form. catAuto: the category came from a merchant rule (it follows the shop until picked by hand).
// bucket / bucketPicked: "Counts in", which follows the category and shop until a chip is tapped.
const f = { who: null, type: "purchase", amount: "", raw: "", cat: "other", catAuto: true, bucket: null, bucketPicked: false, account: null, date: today() };
let msg = "", cardForm = false, cardMsg = "", formKey = "", extra = 0, board;
// The Recent item being fixed in place (its own row turns into the form): { id, where, who, type, amount, raw,
// cat, account, date, msg }. where = the Where text it opened with. While it's open the list isn't redrawn.
let edit = null;
// The row just saved glows for FLASH_MS; kept here so a live redraw carries the glow on instead of cutting it.
const FLASH_MS = 1800;
let flashed = null; // { id, at }

// Each person logs and fixes only their own spending (core/owner.js); older items with no spentBy are anyone's.
const who = () => (people().some((p) => p.id === f.who) && canEdit(f.who) ? f.who : me());
const own = (t) => !t.spentBy || canEdit(t.spentBy);
const whoSeg = (name, sel, idp) => { const ps = people().filter((p) => canEdit(p.id)); return ps.length < 2 ? "" : `<div class="lbl mwho"><span>${name}</span><div class="seg">${ps.map((p) => `<input type="radio" name="${idp}Who" id="${idp}w-${p.id}" value="${p.id}"${p.id === sel ? " checked" : ""}><label for="${idp}w-${p.id}">${esc(p.name)}</label>`).join("")}</div></div>`; };
const live = () => accounts.filter((a) => a.active !== false).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
const acct = () => live().find((a) => a.id === f.account) ?? live().find((a) => a.id === store.get(ACCT_KEY, "")) ?? live()[0] ?? null;
const personName = (id) => people().find((p) => p.id === id)?.name ?? "";

export { billsDue, payBill, undoPayBill } from "./plan.js";
// Stocky's side of the one shop list (from app.js): its shop names, what it bought at a shop, renaming its rows.
let stocky = { shops: () => [], at: () => null, since: () => null, rename: async () => 0 };
// For Stocky (through app.js): every shop Ledger has spending at, so one shop list serves both journals.
export const ledgerShops = () => ledgerShopNames(txns, shopNames);
// Tells Stocky (opts.shopsChanged) when that list changes, so its shop picker never misses a shop.
let shopsChanged = () => {}, shopsSeen = "";
function checkShops() { const k = ledgerShops().join("|"); if (k !== shopsSeen) { shopsSeen = k; shopsChanged(); } }
export function initLedger(opts) {
  ({ db, commit, people, me } = opts);
  if (opts.stocky) stocky = opts.stocky;
  if (opts.shopsChanged) shopsChanged = opts.shopsChanged;
  board = makeBoard({ host: $("ledger"), bar: $("ledgerBar"), key: "ledger", ...BOARD, redraw: () => refreshLedger(), sync: boardPrefs("ledger") });
  wire();
  initImport({
    db: () => db, commit, people, me, today, accounts: () => accounts, programs: () => programs, aliases: () => aliases, txns: () => txns,
    refresh: () => refreshLedger(), offer: makeOffer, paintOffer,
  });
  const shared = { db: () => db, commit, people, today, accounts: () => live(), programs: () => programs, cycles: () => cycles, txns: () => txns, incomes: () => incomes, refresh: () => refreshLedger(), board };
  initTrends(shared);
  initRules(shared);
  initPlan({ ...shared, me, planChanged: () => renderAnalytics(), billsChanged: opts.billsChanged });
  initAnalytics(shared);
  initDocs({ db: () => db, commit, me });
  initIncome({ ...shared, me, token: opts.token, taxRoute: TAX });
  initTax({ ...shared, me, taxRecords: () => taxRecords, openIncome, incomeEntry });
  afterSignIn();
  initSpend({ ...shared, loadedFrom: () => addDays(today(), -LOAD_DAYS), aliases: () => aliases, shops: () => shopNames, stocky });
  $("me").addEventListener("change", () => { f.who = null; formKey = ""; refreshLedger(); });
  addEventListener("journalchange", () => refreshLedgerParts());
  board.start();
}
export function startLedger() {
  const sub = (name, fn) => unsubs.push(onSnapshot(collection(db, name), (s) => { fn(s.docs.map((d) => ({ id: d.id, ...d.data() }))); refreshLedger(); }));
  sub("ledgerAccounts", (x) => { accounts = x; });
  sub("ledgerPrograms", (x) => { programs = x; });
  sub("ledgerAliases", (x) => { aliases = x; });
  sub("ledgerCycles", (x) => { cycles = Object.fromEntries(x.map((c) => [c.id, c])); });
  sub("ledgerRebates", (x) => { rebates = Object.fromEntries(x.map((r) => [r.id, r])); });
  sub("ledgerShops", (x) => { shopNames = x; checkShops(); });
  sub("ledgerIncome", (x) => {
    incomes = x.filter((i) => !i.taxType && /^\d{4}-\d{2}-\d{2}$/.test(i.date || "") && Number.isInteger(i.amountSen));
    taxRecords = x.filter((i) => ["ea", "relief"].includes(i.taxType) && /^\d{4}$/.test(i.year || ""));
  });
  unsubs.push(onSnapshot(query(collection(db, "ledgerTxns"), where("date", ">=", addDays(today(), -LOAD_DAYS))), (s) => {
    txns = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date || "") && Number.isInteger(t.amountSen));
    refreshLedger();
    checkShops();
  }));
  unsubs.push(...planSubs(db));
  if (!seeded) { seeded = true; ensureSeeds(db).catch(() => { seeded = false; }); }
}
export function stopLedger() { unsubs.forEach((u) => u()); unsubs = []; }

export function refreshLedger() {
  if (!$("ledgerAdd") || !people().length) return;
  renderPlan();
  renderSpend();
  renderAnalytics();
  renderIncome();
  refreshTax();
  refreshDocs(findEntry); resumeDocs(findEntry);
  renderAdd();
  renderImport();
  renderRules();
  renderCards();
  renderTrends();
  renderList();
  refreshLedgerParts();
}

// ---------- add spending ----------
// The small card is just "+ Spend": the full form pops out in a sheet (#lgSheet) and the card stays put.
// sheetView = "l" while that sheet is open.
let sheetView = null;
function renderAdd() {
  const card = $("ledgerAdd"), a = acct();
  if (cardForm || !live().length) { if (sheetView) closeSheet(); card.dataset.force = "l"; card.dataset.why = "card"; return renderCardForm(card); }
  if (card.dataset.why === "card") { delete card.dataset.force; delete card.dataset.why; formKey = ""; }
  const small = board.sizeOf("add") === "s" && !card.dataset.force;
  if (!small && sheetView) closeSheet();
  if (small && !card.querySelector(".lsq")) card.innerHTML = `<div class="lsq">
      <span class="lsqt"><h2 id="ledgerAddTitle">Add spending</h2><small id="lgLast"></small></span>
      <button type="button" class="primary" id="lgOpen" aria-haspopup="dialog">＋ Spend</button>
    </div>`;
  // Medium: amount, where, Save, the rest guessed and shown in one line. Large: everything.
  // On the card, "More options" opens large for now (data-force).
  const host = small ? (sheetView ? $("lgSheet") : null) : card;
  const view = small ? sheetView : card.dataset.force || board.sizeOf("add");
  // Drawn once per shape, so new data from the other phone never wipes what's being typed.
  const key = [small ? "sheet" : "card", view, who(), f.type, live().map((x) => x.id + x.name).join(","), people().map((p) => p.id + p.name).join(",")].join("|");
  if (host && (key !== formKey || !host.querySelector("#lgAmt"))) {
    formKey = key;
    const pay = f.type === "payment", tid = small ? "lgSheetTitle" : "ledgerAddTitle";
    const title = pay ? "Log a card payment" : f.type === "refund" ? "Log a refund" : "Add spending";
    const amount = `<label>Amount, RM<input type="text" id="lgAmt" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(f.amount)}"></label>`;
    // Our own suggestion list, not a <datalist>: on phones a datalist often showed nothing while typing.
    const where = pay ? "" : `<div class="lgwhere"><label>Where<input type="text" id="lgRaw" autocomplete="off" autocapitalize="words" enterkeyhint="done" role="combobox" aria-autocomplete="list" aria-controls="lgSug" aria-expanded="false" placeholder="Shop, e.g. Setel or Econsave" value="${esc(f.raw)}"></label>
      <div class="sk-menu lgsug" id="lgSug" role="listbox" aria-label="Shops" hidden></div></div>`;
    const close = small ? `<button type="button" class="mini lsx" id="lgFew" data-to="" aria-label="Close">✕</button>` : "";
    const fewer = !small && card.dataset.force ? "" : null; // the pop-out is always the full form
    const html = view === "m" ? `
      <div class="mhead"><h2 id="${tid}">${title}</h2>${close}</div>
      <div class="two">${amount}${pay ? "" : `<div>${where}</div>`}</div>
      <p class="lgquick"><span id="lgQuick"></span> <button type="button" class="mini" id="lgAll">More options</button></p>
      <div class="lwarn" id="lgWarn" role="status" hidden></div>
      <div class="actions"><button type="button" class="primary" id="lgSave">Save</button></div>
      <p class="msg" id="lgMsg" aria-live="polite"></p>` : `
      <div class="mhead"><h2 id="${tid}">${title}</h2>${close}
        <label class="mealdate">Day<input type="date" id="lgDate" value="${esc(f.date)}" max="${today()}"></label></div>
      ${whoSeg(pay ? "Paid by" : "Spent by", who(), "lg")}
      <div class="chips" role="group" aria-label="Kind">${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="chip" data-ltype="${k}" aria-pressed="${k === f.type}">${v}</button>`).join("")}</div>
      <div class="two">
        ${amount}
        <label>${pay ? "Card" : "Paid with"}<select id="lgAcct">${live().filter((x) => !pay || x.type === "credit_card").map((x) => `<option value="${x.id}"${x.id === a?.id ? " selected" : ""}>${esc(x.name)}${x.last4 ? ` ··${esc(x.last4)}` : ""}</option>`).join("")}</select></label>
      </div>
      ${pay ? "" : `${where}
      <label>Category <small id="lgWhy"></small><select id="lgCat">${CATS.map((c) => `<option value="${c.id}"${c.id === f.cat ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
      <div id="lgBucket"></div>`}
      <div class="lwarn" id="lgWarn" role="status" hidden></div>
      <div class="actions"><button type="button" class="primary" id="lgSave">Save</button>${fewer != null ? `<button type="button" class="mini" id="lgFew" data-to="${fewer}">Fewer options</button>` : ""}<button type="button" class="mini" id="lgCard">＋ Card or wallet</button></div>
      <p class="msg" id="lgMsg" aria-live="polite"></p>`;
    host.innerHTML = small ? `<div class="gsin ladd">${html}</div>` : html;
  }
  paintSug();
  paintWhy(); paintWarn(); paintQuick();
  if ($("lgMsg")) $("lgMsg").textContent = msg;
}
// The medium card's one line of what it will save with (picked for you), and the small card's last save.
function paintQuick() {
  const q = $("lgQuick"), last = $("lgLast");
  if (q) {
    const a = acct(), c = cat(f.cat), day = f.date === today() ? "today" : shortDate(f.date);
    q.textContent = [f.type === "payment" ? KINDS.payment : f.type === "refund" ? `${KINDS.refund} · ${c.name}` : c.name,
      a?.name, day, people().filter((p) => canEdit(p.id)).length > 1 ? personName(who()) : ""].filter(Boolean).join(" · ");
  }
  if (last) {
    const t = [...txns].filter((x) => x.spentBy === me()).sort((x, y) => (y.at ?? 0) - (x.at ?? 0))[0];
    last.textContent = t ? `Last: ${rm(Math.abs(t.amountSen))} · ${t.type === "payment" ? "card payment" : t.merchant || t.raw || cat(t.cat).name}, ${t.date === today() ? "today" : shortDate(t.date)}` : "Log a coffee, petrol, groceries…";
  }
}
// Opens a bigger Add spending for now ("+ Spend", "More options"), or back to the chosen size. On the
// small card that's the pop-out sheet (size null closes it).
function openAdd(size) {
  const host = $("ledgerAdd");
  if (board.sizeOf("add") === "s" && !host.dataset.force) {
    if (!size) return closeSheet();
    sheetView = size; formKey = ""; renderAdd();
    const d = $("lgSheet"); if (!d.open) d.showModal();
    $("lgAmt")?.focus();
    return;
  }
  if (size) host.dataset.force = size; else delete host.dataset.force;
  formKey = ""; renderAdd();
  if (size) $("lgAmt")?.focus({ preventScroll: true });
  host.scrollIntoView({ block: "nearest" });
}
function closeSheet() {
  const d = $("lgSheet");
  sheetView = null; formKey = "";
  if (d.open) d.close();
  d.innerHTML = "";
}
// The "Where" suggestions under the field while it's focused: whereMatches() over whereChoices() (your
// shop names, every shop with spending, saved shops, then Stocky's). Tapping one fills Where.
function paintSug(open = !$("lgSug")?.hidden) {
  const box = $("lgSug"), input = $("lgRaw"); if (!box || !input) return;
  const { hits, close } = open ? whereMatches(input.value, whereChoices(txns, shopNames, stocky.shops())) : { hits: [], close: [] };
  const row = (o) => `<div class="sk-opt" role="option"><button type="button" data-lgshop="${esc(o.value)}">${esc(o.value)}${o.label ? ` <small>${o.label === "Stocky" ? "Stocky" : `🏷 ${esc(o.label)}`}</small>` : ""}</button></div>`;
  const html = hits.length ? hits.map(row).join("") : close.length ? `<p class="note">Did you mean</p>${close.map(row).join("")}` : "";
  if (box.innerHTML !== html) box.innerHTML = html;
  box.hidden = !html;
  input.setAttribute("aria-expanded", String(!!html));
}
// What's typed (or picked) in Where: the category follows it while it's still the guessed one.
function setWhere(v) {
  f.raw = v;
  if (f.catAuto) { const r = autoCat(); f.cat = r.cat === "payment" ? "other" : r.cat; if ($("lgCat")) $("lgCat").value = f.cat; }
  paintWhy(); paintQuick();
}
// The shop name to save: a typed nickname gives its shop's statement name, so it groups with the rest.
const whereRaw = () => byNick(f.raw, shopNames)?.name ?? f.raw;
// The category for what's typed in Where: the merchant rules first; for one of your shop names with no
// rule, the category that shop's items usually have. { cat, rule, usual }
function autoCat() {
  const r = categorise(whereRaw(), aliases), named = byNick(f.raw, shopNames);
  if (r.rule || !named) return r;
  const mine = txns.filter((t) => t.type !== "payment" && shopKey(t) === named.key);
  return mine.length ? { cat: usualCat(mine), usual: true } : r;
}
function paintWhy() {
  paintAddBucket();
  const el = $("lgWhy"); if (!el) return;
  const r = f.raw.trim() ? autoCat() : null, named = byNick(f.raw, shopNames);
  el.textContent = [named ? `· your name for ${named.name}` : "", f.catAuto && r?.rule ? "· picked from the shop name" : f.catAuto && r?.usual ? "· what it usually is" : ""].filter(Boolean).join(" ");
}
// The item as Add spending would save it, for working out its bucket.
function addItem() {
  const raw = whereRaw(), r = categorise(raw, aliases);
  return { type: f.type, cat: f.cat, raw, merchant: r.merchant || raw.trim() };
}
function paintAddBucket() {
  const el = $("lgBucket"); if (!el) return;
  const x = addItem();
  if (!f.bucketPicked) f.bucket = txnBucket(x, planState().plan);
  el.innerHTML = bucketPicker(x, f.bucket, "lgbucket");
}
// The live "don't pay yet" check while a card payment is being typed.
function paintWarn() {
  const el = $("lgWarn"), save = $("lgSave"); if (!el) return;
  const w = f.type === "payment" ? warning() : null;
  el.hidden = !w;
  el.classList.toggle("calm", !!w?.calm);
  el.innerHTML = w ? (w.calm ? esc(w.text) : `<b>Wait — don't pay yet?</b> ${esc(w.text)}`) : "";
  if (save) save.textContent = w && !w.calm ? "Save anyway" : "Save";
}
function warning() {
  const a = acct(), sen = toSen(f.amount);
  if (!a || a.type !== "credit_card" || !(sen > 0) || !f.date) return null;
  const v = cycleView(a, { programs, cycles, txns, day: f.date });
  if (!v.program) return null;
  const w = payWarning({ program: v.program, cycle: v.cycle, prevSen: v.prevSen, txns: v.txns, payment: { date: f.date, amountSen: sen } });
  if (w) return { text: warningText(w) };
  if (f.date <= v.cycle.statement && v.rebate.tier > 0) return { calm: true, text: `This keeps you in the ${v.rebate.tierLabel} tier. Safe to pay before ${shortDate(v.cycle.statement)}: ${rm(v.safeSen)}.` };
  return null;
}

async function save() {
  const a = acct(), sen = toSen(f.amount);
  if (!a) return say("Add a card or wallet first.");
  if (!(sen > 0)) return say("Type the amount, like 12.50.");
  if (f.type !== "payment" && !f.raw.trim()) return say("Type where, like Setel or Econsave.");
  if (!f.date || f.date > today()) return say("Pick a day up to today.");
  if (f.type === "payment" && a.type !== "credit_card") return say("Card payments are for credit cards.");
  const raw = whereRaw(), r = categorise(raw, aliases);
  // `at` (ms) is required: Firestore refuses a field that is undefined, and the save used to fail silently.
  const t = manualTxn(a, { spentBy: who(), date: f.date, amount: f.amount, type: f.type, raw: f.type === "payment" ? "Card payment" : raw, cat: f.cat, merchant: r.merchant || raw.trim() }, Date.now());
  const own = f.bucketPicked ? ownBucket(t, planState().plan, f.bucket) : null;
  if (own) t.bucket = own; // only when the shop or category wouldn't put it there anyway
  store.set(ACCT_KEY, a.id);
  const cyc = cycleOf(a, t.posted);
  const what = f.type === "payment" ? `${rm(sen)} paid to ${a.name}` : `${f.type === "refund" ? "Refund of " : ""}${rm(sen)} at ${f.raw.trim()}`;
  const save = $("lgSave"); if (save) save.disabled = true;
  try {
    await commit(() => Promise.all([setDoc(doc(collection(db, "ledgerTxns")), t), a.type === "credit_card" ? saveCycle(db, cyc) : Promise.resolve()]),
      `Saved ${what} for ${personName(who())}.`);
  } catch (_) {
    if (save) save.disabled = false;
    return say("Not saved yet. Your numbers are still here: try again.");
  }
  msg = "";
  Object.assign(f, { amount: "", raw: "", cat: "other", catAuto: true, bucket: null, bucketPicked: false, type: "purchase" });
  formKey = "";
  delete $("ledgerAdd").dataset.force; // "More options" opened it: back to the chosen size, the toast says it's saved
  if (sheetView) closeSheet(); // the pop-out from the small card closes; the toast says it's saved
  refreshLedger();
}
function say(text) { msg = text; const el = $("lgMsg"); if (el) el.textContent = text; }

// ---------- add a card or wallet ----------
function renderCardForm(host) {
  formKey = "";
  if ($("lcName")) return; // already open: keep what's typed
  const first = !live().length;
  host.innerHTML = `<h2 id="ledgerAddTitle">${first ? "Start with your card" : "Add a card or wallet"}</h2>
    <p class="note">${first ? "Ledger tracks what you both spend and how much rebate your card will give. " : ""}Card details stay as plain names here: never the full card number.</p>
    <label>Kind<select id="lcType">${Object.entries(TYPES).map(([k, v]) => `<option value="${k}">${v}</option>`).join("")}</select></label>
    <div class="lcc">
      <label>Rebate rules<select id="lcPreset"><option value="cimb-petronas">${esc(PRESETS["cimb-petronas"].name)}</option><option value="">No rebate rules</option></select></label>
    </div>
    <label>Name<input type="text" id="lcName" autocomplete="off" value="CIMB PETRONAS"></label>
    <div class="two">
      <label>Whose<select id="lcOwner">${people().map((p) => `<option value="${p.id}"${p.id === me() ? " selected" : ""}>${esc(p.name)}</option>`).join("")}<option value="both">Both</option></select></label>
      <label class="lcc">Last 4 digits <small>optional</small><input type="text" id="lcLast4" inputmode="numeric" maxlength="4" autocomplete="off"></label>
    </div>
    <div class="two lcc">
      <label>Statement day<input type="number" id="lcStmt" min="1" max="31" inputmode="numeric" value="20"></label>
      <label>Payment due day<input type="number" id="lcDue" min="1" max="31" inputmode="numeric" value="10"></label>
    </div>
    <label class="lcc">Balance on your last statement, RM <small id="lcWhen"></small><input type="text" id="lcOpen" inputmode="decimal" autocomplete="off" placeholder="0.00"></label>
    <div class="actions"><button type="button" class="primary" id="lcSave">Save</button>${first ? "" : `<button type="button" id="lcCancel">Cancel</button>`}</div>
    <p class="msg" id="lcMsg" aria-live="polite">${esc(cardMsg)}</p>`;
  paintCardForm();
}
function paintCardForm() {
  const cc = $("lcType").value === "credit_card";
  document.querySelectorAll("#ledgerAdd .lcc").forEach((el) => { el.hidden = !cc; });
  const day = Number($("lcStmt").value);
  $("lcWhen").textContent = day >= 1 && day <= 31 ? `(${shortDate(lastStatement({ id: "x", statementDay: day }, today()))})` : "";
}
async function saveCard() {
  const type = $("lcType").value, cc = type === "credit_card", name = $("lcName").value.trim();
  const stmt = Number($("lcStmt").value), due = Number($("lcDue").value), last4 = $("lcLast4").value.trim(), open = $("lcOpen").value.trim();
  const tell = (t) => { $("lcMsg").textContent = t; };
  if (!name) return tell("Give it a name, like CIMB PETRONAS.");
  if (cc && !(stmt >= 1 && stmt <= 31 && due >= 1 && due <= 31)) return tell("Statement and due days are 1 to 31.");
  if (cc && last4 && !/^\d{4}$/.test(last4)) return tell("Last 4 digits: four numbers, or leave it empty.");
  if (cc && open && Number.isNaN(toSen(open))) return tell("Type the balance like 34.50, or leave it empty.");
  const now = Date.now(), acc = { type, name, owner: $("lcOwner").value, created: now, updated: now, statementDay: cc ? stmt : 31 };
  if (cc) Object.assign(acc, { dueDay: due, openingSen: open ? toSen(open) : 0, openingDate: lastStatement({ id: "x", statementDay: stmt }, today()) });
  if (cc && last4) acc.last4 = last4;
  $("lcSave").disabled = true;
  let id = null;
  try { await commit(async () => { id = await addAccount(db, acc, cc ? $("lcPreset").value : null); }, `Added ${name}.`); } catch (_) { $("lcSave").disabled = false; return; }
  if (id) { f.account = id; store.set(ACCT_KEY, id); }
  cardForm = false; cardMsg = ""; msg = "";
  $("ledgerAdd").innerHTML = "";
  refreshLedger();
}

// ---------- card rebates ----------
const GROUP_NAMES = { petronas: "PETRONAS", lifestyle: "Groceries, dining, parking" };
const groupName = (g) => GROUP_NAMES[g.id] ?? g.cats.map((c) => cat(c).name).join(", ");
const tierColor = (prog, i) => (i === 0 ? "var(--muted)" : i === prog.tiers.length - 1 ? "var(--good)" : "var(--over)");

function renderCards() {
  const host = $("ledgerCards"), day = today();
  const cards = live().filter((a) => a.type === "credit_card");
  host.innerHTML = cards.map((a) => {
    const v = cycleView(a, { programs, cycles, txns, day });
    const last = Object.values(cycles).filter((c) => c.account === a.id && c.status === "closed").sort((x, y) => y.statement.localeCompare(x.statement))[0];
    const lastReb = last && rebates[last.id];
    const size = board.sizeOf(`card:${a.id}`), cid = `card:${a.id}`;
    const days = v.daysLeft === 0 ? "statement today" : `${v.daysLeft} ${v.daysLeft === 1 ? "day" : "days"} to statement`;
    const open = `<section class="panel lcard" id="lcard-${a.id}" data-card="${cid}" data-title="${esc(a.name)}${v.program ? " rebate" : ""}">`;
    // Small: one tile (tap to see it all). Medium: the gauge and what's next.
    if (size === "s") return `${open}${board.tile(cid, v.program
      ? `<small>Rebate · ${esc(a.name)}</small><b class="bdbig">${rm(v.rebate.totalSen, { whole: true })}</b><small>${v.next ? `${rm(v.next.needSen, { whole: true })} to next tier` : "Top tier"}</small><small class="note">${days}</small>`
      : `<small>${esc(a.name)} · next statement</small><b class="bdbig">${rm(v.balanceSen, { whole: true })}</b><small class="note">${days}</small>`, a.name)}</section>`;
    const head = `<div class="lhead"><h2>${esc(a.name)}</h2>${a.last4 ? `<span class="note">··${esc(a.last4)}</span>` : ""}<span class="lbtnrow"><button type="button" class="mini" data-lrules="${a.id}">${ico("sliders")} Rules</button><button type="button" class="mini" data-limport="${a.id}">${ico("file")} Import statement</button>${board.less(cid)}</span></div>
      <p class="lcycle">${shortDate(v.cycle.start)} – ${shortDate(v.cycle.statement)} · <b>${v.daysLeft === 0 ? "statement today" : `${v.daysLeft} ${v.daysLeft === 1 ? "day" : "days"} to statement`}</b> · due ${shortDate(v.cycle.due)}</p>
      ${last ? `<p class="note llast">Last statement ${shortDate(last.statement)}: <b>${last.balanceSen == null ? "–" : rm(last.balanceSen)}</b>${lastReb ? ` · rebate <b>${rm(lastReb.totalSen)}</b> (${esc(lastReb.tierLabel)} tier)` : ""} ✓</p>` : ""}`;
    if (!v.program) return `${open}${head}
      <div class="stats"><div class="stat"><small>Next statement so far</small><b>${rm(v.balanceSen)}</b></div></div>
      <p class="note">No rebate rules for this card yet. Tap Rules to add them.</p></section>`;
    const p = v.program, r = v.rebate, top = p.tiers.at(-1).minSen;
    const max = Math.max(top * 1.25, v.balanceSen * 1.05, 1), at = (sen) => Math.max(0, Math.min(100, (sen / max) * 100));
    // At the 0% tier, show what the first paying tier would give, so the gap is real money.
    const gs = withEligible(r.tier > 0 || !p.tiers[1] ? r : computeRebate(p, { txns: v.txns, balanceSen: p.tiers[1].minSen }));
    if (size === "m") return `${open}${head}
      <div class="stats">
        <div class="stat"><small>Next statement so far</small><b>${rm(v.balanceSen, { whole: true })}</b></div>
        <div class="stat"><small>Rebate so far</small><b>${rm(r.totalSen, { whole: true })}</b></div>
        <span class="pill" style="--c:${tierColor(p, r.tier)}">${r.tierLabel} tier</span>
      </div>
      <div class="lbarbg"><i style="width:${at(v.balanceSen)}%;--c:${tierColor(p, r.tier)}"></i></div>
      <p class="lnext">${v.next ? `<b>${rm(v.next.needSen)}</b> more to reach ${v.next.label}.` : "Top tier. Nice."} ${board.more(cid, "Caps and safe to pay")}</p>
    </section>`;
    return `${open}${head}
      <div class="stats">
        <div class="stat"><small>Next statement so far</small><b>${rm(v.balanceSen, { whole: true })}</b><i>.${String(Math.abs(v.balanceSen) % 100).padStart(2, "0")}</i></div>
        <div class="stat"><small>Rebate so far</small><b>${rm(r.totalSen, { whole: true })}</b></div>
        <span class="pill" style="--c:${tierColor(p, r.tier)}">${r.tierLabel} tier</span>
      </div>
      <div class="lgauge" role="img" aria-label="Statement balance ${rm(v.balanceSen)}. Tiers start at ${p.tiers.slice(1).map((t) => rm(t.minSen, { whole: true })).join(" and ")}.">
        <div class="lbarbg"><i style="width:${at(v.balanceSen)}%;--c:${tierColor(p, r.tier)}"></i></div>
        ${p.tiers.slice(1).map((t, i) => `<span class="ltick" style="left:${at(t.minSen)}%"><em>${rm(t.minSen, { whole: true })}</em><small>${tierLabel(p.tiers[i + 1])}</small></span>`).join("")}
      </div>
      ${v.owedSen > 0 ? `<p class="lowed">Last statement: <b>${rm(v.owedSen)}</b> to pay by ${shortDate(v.prevDue)}. Paying it is fine any time; it's left out above.</p>` : ""}
      ${v.next ? `<p class="lnext"><b>${rm(v.next.needSen)}</b> more on the statement to reach ${v.next.label}.${r.tier === 0 && v.txns.some((t) => t.type === "payment" && t.date <= v.cycle.statement) ? ` Paying before ${shortDate(v.cycle.statement)} lowers it.` : ""}</p>` : `<p class="lnext">Top tier. Nice.</p>`}
      <div class="lgroups">${gs.groups.map((g) => `<div class="lgroup">
        <div class="lgline"><span>${esc(groupName(g))}</span><b>${r.tier > 0 ? `${rm(g.finalSen)}` : `<small>at ${tierLabel(p.tiers[1])}:</small> ${rm(g.finalSen)}`}</b></div>
        <div class="lbarbg thin"><i style="width:${Math.round((g.capUse ?? 0) * 100)}%;--c:${r.tier > 0 ? "var(--accent)" : "var(--line)"}"></i></div>
        <small class="note">${rm(g.eligible)} spent${g.capSen != null ? ` · ${rm(g.cappedSen)} of ${rm(g.capSen, { whole: true })} cap` : ""}</small>
      </div>`).join("")}</div>
      ${r.tier > 0 && v.daysLeft >= 0 ? `<p class="note">Safe to pay before ${shortDate(v.cycle.statement)}: <b>${rm(v.safeSen)}</b>. Pay the rest after, by ${shortDate(v.cycle.due)}.</p>` : ""}
      ${v.risky.length ? `<p class="note">${ico("alert")} ${v.risky.length} ${v.risky.length === 1 ? "swipe" : "swipes"} near the cut-off may post in the next cycle.</p>` : ""}
      ${p.needsMinPay ? `<p class="note">The bank pays the rebate on the next statement, if at least the minimum is paid on time.</p>` : ""}
    </section>`;
  }).join("");
}
// Adds each group's eligible spend (sum of its categories) for the "RM… spent" line.
function withEligible(r) {
  return { ...r, groups: r.groups.map((g) => ({ ...g, eligible: r.cats.filter((c) => g.cats.includes(c.cat)).reduce((s, c) => s + c.eligibleSen, 0) })) };
}

// ---------- recent ----------
// Tap an item to open it: change its category (which offers "always categorise") or delete it.
function renderList() {
  const host = $("ledgerList");
  // A row being fixed keeps what's typed: no redraw until it's saved or cancelled (unless it was deleted elsewhere).
  if (edit && $("leForm")) { if (txns.some((x) => x.id === edit.id)) return; edit = null; }
  const list = [...txns].sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0));
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name])), shopDocs = Object.fromEntries(shopNames.filter((x) => x.key).map((x) => [x.key, x]));
  const size = board.sizeOf("recent"), shown = RECENT_BY_SIZE[size] + extra;
  host.innerHTML = `<div class="lhead"><h2>${size === "s" ? "Last saved" : "Recent"}</h2>${board.less("recent")}</div><div id="lgOffer"></div>${list.length ? `<div class="llist">${list.slice(0, shown).map((t) => {
    const c = cat(t.cat), credit = t.amountSen < 0, open = openRow === t.id, name = t.merchant || t.raw || c.name;
    if (open && edit?.id === t.id) return `<div class="lrow open editing" data-row="${t.id}">${editForm(t)}</div>`;
    const glow = flashed?.id === t.id && Date.now() - flashed.at < FLASH_MS;
    return `<div class="lrow${open ? " open" : ""}${glow ? " lflash" : ""}" data-row="${t.id}"${glow ? ` style="animation-delay:-${Date.now() - flashed.at}ms"` : ""}>
      <button type="button" class="lopen" data-lopen="${t.id}" aria-expanded="${open}">
        <span class="lic" aria-hidden="true">${ico(c.icon)}</span>
        <span class="lmain"><b>${t.type === "payment" ? esc(name) : shopHtml(shopDocs[shopKey(t)], name)}</b><small>${shortDate(t.date)} · ${esc(personName(t.spentBy))} · ${esc(names[t.account] ?? "")}${t.type === "payment" ? "" : ` · ${esc(c.name)}`}${t.reconciled ? " · ✓ statement" : ""}${t.docs?.length ? ` · ${ico("clip")}${t.docs.length > 1 ? ` ${t.docs.length}` : ""}` : ""}</small></span>
        <span class="lamt${credit ? " cr" : ""}">${rm(Math.abs(t.amountSen))}${credit ? " CR" : ""}</span>
      </button>
      ${open && !own(t) ? `<div class="ledit">${t.raw && t.raw !== norm(name) ? `<p class="note">On the statement: ${esc(t.raw)}</p>` : ""}${viewOnly(t.spentBy, "spending")}${docsOn() && t.docs?.length ? `<div class="actions">${docsBtn(t)}</div>` : ""}</div>` : open ? `<div class="ledit">
        ${t.type === "payment" ? "" : `<label>Category<select data-lcat="${t.id}">${CATS.map((x) => `<option value="${x.id}"${x.id === t.cat ? " selected" : ""}>${esc(x.name)}</option>`).join("")}</select></label>`}
        ${t.raw && t.raw !== norm(name) ? `<p class="note">On the statement: ${esc(t.raw)}</p>` : ""}
        <div class="actions"><button type="button" class="mini" data-ledit="${t.id}">${ico("pen")} Edit</button>${docsOn() ? docsBtn(t) : ""}<button type="button" class="mini" data-ldel="${t.id}">Delete</button></div>
      </div>` : ""}
    </div>`;
  }).join("")}</div>${list.length > shown ? `<button type="button" class="mini" id="lgMore">Show more</button>` : ""}`
    : `<p class="note">Nothing yet. What you add shows here.</p>`}`;
  paintOffer("lgOffer");
}

// ---------- receipts and documents (docsui.js) ----------
const docsBtn = (t) => `<button type="button" class="mini" data-ldocs="${t.id}">${ico("clip")} ${t.docs?.length ? `${t.docs.length} ${t.docs.length === 1 ? "file" : "files"}` : t.type === "payment" ? "Add proof" : "Add receipt"}</button>`;
function txnEntry(t) {
  const name = t.type === "payment" ? `Card payment ${accounts.find((a) => a.id === t.account)?.name ?? ""}`.trim() : t.merchant || t.raw || cat(t.cat).name;
  return { coll: "ledgerTxns", id: t.id, kind: t.type, date: t.date, what: name, amountSen: Math.abs(t.amountSen), person: personName(t.spentBy),
    docs: t.docs, canEdit: own(t), title: `${name} · ${rm(Math.abs(t.amountSen))} · ${shortDate(t.date)}` };
}
// The entry behind a paperclip sheet, from the live data (null when it's gone).
function findEntry(coll, id) {
  if (coll === "ledgerTxns") { const t = txns.find((x) => x.id === id); return t ? txnEntry(t) : null; }
  if (coll === "ledgerIncome") {
    const x = incomes.find((y) => y.id === id), tax = taxRecords.find((y) => y.id === id);
    return x ? incomeEntry(x) : tax ? taxDocEntry(tax) : null;
  }
  if (coll === "ledgerPaid") { const { paid, commitments } = planState(), p = paid[id], c = p && commitments.find((x) => x.id === p.commitment); return c ? billEntry(p, c) : null; }
  return null;
}

// ---------- fix an item in place ----------
// "Edit" turns the row itself into a small form, so you never lose your place in the list.
function startEdit(id) {
  const t = txns.find((x) => x.id === id); if (!t || !own(t)) return;
  const where = t.type === "payment" ? "" : t.merchant || t.raw || "";
  edit = { id, where, who: t.spentBy || who(), type: t.type, amount: (Math.abs(t.amountSen) / 100).toFixed(2), raw: where,
    cat: t.cat === "payment" ? "other" : t.cat || "other", account: t.account, date: t.date, msg: "" };
  edit.bucketPicked = false; // "Counts in" follows the category until a chip is tapped
  openRow = id;
  renderList();
  rowEl(id)?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  $("leAmt")?.focus({ preventScroll: true });
}
const rowEl = (id) => (id ? document.querySelector(`#ledgerList [data-row="${id}"]`) : null);
function editForm(t) {
  const e = edit, pay = e.type === "payment";
  const cards = live().filter((x) => !pay || x.type === "credit_card");
  if (!cards.some((x) => x.id === e.account)) { const gone = accounts.find((x) => x.id === e.account); if (gone) cards.push(gone); }
  return `<form class="ledform" id="leForm" novalidate aria-label="Fix this item">
    <div class="ledtop"><b>Fix this item</b><span class="note">${esc(t.merchant || t.raw || cat(t.cat).name)} · ${rm(Math.abs(t.amountSen))}</span></div>
    ${whoSeg(pay ? "Paid by" : "Spent by", e.who, "le")}
    ${e.type === "purchase" || e.type === "refund" ? `<div class="chips" role="group" aria-label="Kind">${["purchase", "refund"].map((k) => `<button type="button" class="chip" data-letype="${k}" aria-pressed="${k === e.type}">${KINDS[k]}</button>`).join("")}</div>` : ""}
    <div class="two">
      <label>Amount, RM<input type="text" id="leAmt" inputmode="decimal" autocomplete="off" value="${esc(e.amount)}"></label>
      <label>Day<input type="date" id="leDate" value="${esc(e.date)}" max="${today()}"></label>
    </div>
    <label>${pay ? "Card" : "Paid with"}<select id="leAcct">${cards.map((x) => `<option value="${x.id}"${x.id === e.account ? " selected" : ""}>${esc(x.name)}${x.last4 ? ` ··${esc(x.last4)}` : ""}</option>`).join("")}</select></label>
    ${pay ? "" : `<label>Where<input type="text" id="leRaw" list="lgShops" autocomplete="off" value="${esc(e.raw)}"></label>
    <label>Category<select id="leCat">${CATS.map((c) => `<option value="${c.id}"${c.id === e.cat ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select></label>
    <div id="leBucket">${bucketChips(t)}</div>`}
    <p class="msg" id="leMsg" aria-live="polite">${esc(e.msg)}</p>
    <div class="actions"><button type="submit" class="primary" id="leSave">Save changes</button><button type="button" id="leCancel">Cancel</button></div>
  </form>`;
}
// "Counts in": which money-plan bucket this one item counts in. Until a chip is tapped it follows the
// category (or the shop's rule); hidden when the item isn't day-to-day spending (PayLater, no plan yet).
function editedItem(t) { return { ...t, type: edit.type, cat: edit.cat, merchant: edit.raw.trim() || t.merchant, raw: edit.raw.trim() || t.raw, bucket: null }; }
function bucketChips(t) {
  const x = editedItem(t);
  if (!edit.bucketPicked) edit.bucket = txnBucket({ ...x, bucket: t.bucket }, planState().plan);
  return bucketPicker(x, edit.bucket, "lebucket");
}
// The "Counts in" chips (Add spending and Fix this item); data-<attr> = bucket id. Empty when there's no plan
// yet or the item isn't day-to-day spending (a card payment, PayLater).
function bucketPicker(x, chosen, attr) {
  const plan = planState().plan;
  if (!plan || !txnBucket({ ...x, bucket: null }, plan)) return "";
  return `<div class="lbl"><span>Counts in</span><div class="chips" role="group" aria-label="Counts in which bucket">${bucketsOf(plan).map((b) => `<button type="button" class="chip" data-${attr}="${b.id}" aria-pressed="${b.id === chosen}">${esc(b.name)}</button>`).join("")}</div></div>`;
}
function paintBucket() {
  const t = txns.find((x) => x.id === edit?.id), el = $("leBucket");
  if (t && el) el.innerHTML = bucketChips(t);
}
function cancelEdit() {
  const id = edit?.id; edit = null; openRow = null;
  renderList(); flashRow(id, false);
}
// After saving or cancelling: keep the row on screen (it may have moved if the day changed) and, after a save, light it up.
function flashRow(id, lit = true) {
  const row = rowEl(id); if (!row) return;
  row.scrollIntoView({ block: "nearest", behavior: "smooth" });
  if (!lit) return;
  flashed = { id, at: Date.now() };
  row.style.animationDelay = "0ms"; row.classList.remove("lflash"); void row.offsetWidth; row.classList.add("lflash");
}
async function saveEdit() {
  const e = edit, old = txns.find((x) => x.id === e?.id); if (!old) return cancelEdit();
  const tell = (text) => { e.msg = text; const el = $("leMsg"); if (el) el.textContent = text; };
  const a = accounts.find((x) => x.id === e.account), sen = toSen(e.amount), pay = e.type === "payment";
  if (!a) return tell("Pick the card or wallet.");
  if (!(sen > 0)) return tell("Type the amount, like 12.50.");
  if (!pay && !e.raw.trim()) return tell("Type where, like Setel or Econsave.");
  if (!e.date || e.date > today()) return tell("Pick a day up to today.");
  const raw = byNick(e.raw, shopNames)?.name ?? e.raw, r = categorise(raw, aliases);
  const t = manualTxn(a, { spentBy: e.who, date: e.date, amount: e.amount, type: e.type, raw: pay ? "Card payment" : raw, cat: e.cat, merchant: r.merchant || raw.trim() }, old.at ?? Date.now());
  const body = editedTxn(old, t, e.raw.trim() === e.where);
  // A picked bucket is kept on the item only when its shop rule or category wouldn't put it there anyway.
  if (!pay && e.bucketPicked) body.bucket = ownBucket(body, planState().plan, e.bucket);
  const what = pay ? `${rm(sen)} paid to ${a.name}` : `${rm(sen)} at ${e.raw.trim()}`;
  const btn = $("leSave"); if (btn) btn.disabled = true;
  try {
    await commit(() => Promise.all([setDoc(doc(db, "ledgerTxns", old.id), body), a.type === "credit_card" ? saveCycle(db, cycleOf(a, body.posted)) : Promise.resolve()]), `Updated: ${what}.`);
  } catch (_) {
    if (btn) btn.disabled = false;
    return tell("Not saved yet. Your changes are still here: try again.");
  }
  // Show the change at once (the live update follows), then close the form right where it is.
  Object.assign(old, body);
  edit = null; openRow = null;
  renderList(); refreshLedgerParts(); flashRow(old.id);
}
// The saved item after a fix: the form's fields over the old item, keeping what the form doesn't show (where it
// came from, statement check, notes, created time). A statement item keeps its statement name unless Where changed,
// and its posting date unless the day or card changed.
function editedTxn(old, t, sameWhere) {
  const { id: _id, ...keep } = old;
  const out = { ...keep, ...t, source: old.source ?? "manual", reconciled: old.reconciled ?? false, at: old.at ?? t.at, updated: Date.now() };
  if (old.source !== "manual" && sameWhere) Object.assign(out, { raw: old.raw, merchant: old.merchant ?? t.merchant });
  if (old.date === t.date && old.account === t.account) Object.assign(out, { posted: old.posted ?? t.posted, postedGuess: old.postedGuess ?? t.postedGuess, cycle: old.cycle ?? t.cycle });
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
}

// Delete one item, after asking (safe-delete). A statement item comes back if that statement is imported again.
async function removeTxn(id) {
  const t = txns.find((x) => x.id === id); if (!t || !own(t)) return;
  const name = t.merchant || t.raw || cat(t.cat).name;
  const ok = await confirmDelete({
    title: `Delete ${name}?`,
    body: `<p>${rm(Math.abs(t.amountSen))} on ${shortDate(t.date)}${t.reconciled ? ". It's on a statement, so importing that statement again brings it back." : "."}</p>`,
    yes: "Delete it",
  });
  if (!ok) return;
  openRow = null; if (edit?.id === id) edit = null;
  await commit(() => deleteDoc(doc(db, "ledgerTxns", id)), `Deleted ${name}.`);
}

// ---------- "always categorise" ----------
// Offered after a category is changed by hand, unless the merchant rules already say so.
function makeOffer(raw, catId, host) {
  if (!raw || catId === "payment" || categorise(raw, aliases).cat === catId) { if (offer?.host === host) { offer = null; paintOffer(host); } return; }
  offer = { raw, cat: catId, pattern: suggestPattern(raw), host, msg: "" };
  paintOffer(host);
}
// Earlier purchases a rule with this pattern would move.
const movable = (o, pattern) => txns.filter((t) => t.type === "purchase" && t.cat !== o.cat && ruleMatches({ pattern, match: "prefix" }, t.raw || t.merchant || ""));
function paintOffer(host) {
  const el = $(host); if (!el) return;
  if (!offer || offer.host !== host) { el.innerHTML = ""; return; }
  const c = cat(offer.cat), n = movable(offer, offer.pattern).length;
  el.innerHTML = `<div class="loffer" role="group" aria-label="Always categorise this shop">
    <p><b>Always put this shop in ${esc(c.name)}?</b> Shop names starting with:</p>
    <input type="text" id="${host}-pat" value="${esc(offer.pattern)}" autocomplete="off" aria-label="Shop name starts with">
    ${n ? `<label class="inline"><input type="checkbox" id="${host}-also" checked> Also move ${n} earlier ${n === 1 ? "item" : "items"}</label>` : ""}
    <div class="actions"><button type="button" class="primary" data-offer="yes" data-host="${host}">Yes, always</button><button type="button" data-offer="no" data-host="${host}">Not now</button></div>
    <p class="msg">${esc(offer.msg)}</p>
  </div>`;
}
async function acceptOffer(host) {
  const pattern = norm($(`${host}-pat`)?.value ?? "");
  if (pattern.length < 3) { offer.msg = "Use at least 3 letters of the shop name."; return paintOffer(host); }
  const also = $(`${host}-also`)?.checked, b = writeBatch(db), o = offer;
  b.set(doc(collection(db, "ledgerAliases")), { pattern, match: "prefix", cat: o.cat, priority: 70, from: "user", created: Date.now() });
  if (also) movable(o, pattern).slice(0, 400).forEach((t) => b.set(doc(db, "ledgerTxns", t.id), { cat: o.cat }, { merge: true }));
  offer = null; paintOffer(host);
  await commit(() => b.commit());
}

// ---------- person card part ----------
// This pay month so far (from payday, moneyplan.js), against the same number of days of the last one.
export function refreshLedgerParts() {
  if (!people().length) return;
  const t = today(), pay = payOf(planState().plan), m = monthOf(t, pay), from = monthRange(m, pay).from;
  const lastFrom = monthRange(addMonths(m, -1), pay).from, lastTo = addDays(lastFrom, dayNum(t) - dayNum(from));
  const month = pay > 1 ? `since ${shortDate(from)}` : `in ${new Date(`${t}T12:00`).toLocaleDateString(undefined, { month: "long" })}`;
  people().forEach((p) => {
    const slot = $("ledgerSlot-" + p.id); if (!slot) return;
    const rows = spendByCat(txns, { from, to: t, person: p.id }), total = spendTotal(rows);
    const last = spendTotal(spendByCat(txns, { from: lastFrom, to: lastTo, person: p.id }));
    const big = rows[0]?.sen || 1;
    slot.innerHTML = `<div class="calhead"><h3 class="ptitle">Spending</h3><a class="btn mini" href="#ledger/spend/all">See all →</a></div>
      ${rows.length ? `<p class="week"><b>${rm(total)}</b> ${esc(month)}${pay > 1 ? "" : " so far"}${last ? ` · ${rm(last)} by this day last month` : ""}</p>
      <div class="lcats">${rows.slice(0, 5).map((r) => `<div class="lcat"><span>${ico(cat(r.cat).icon)} ${esc(cat(r.cat).name)}</span><i style="width:${Math.max(3, Math.round((r.sen / big) * 100))}%"></i><b>${rm(r.sen, { whole: true })}</b></div>`).join("")}</div>`
        : `<p class="note">Nothing logged ${esc(month)} yet. Logging is optional: add what you want to keep an eye on.</p>`}`;
  });
}

// ---------- events ----------
function wire() {
  // The form lives on the card, or in the pop-out sheet when the card is small: same handlers for both.
  const sheet = $("lgSheet");
  sheet.addEventListener("close", () => { if (sheetView) closeSheet(); });
  // Tapping outside closes it, unless something's been typed (Escape or ✕ still close; typing is kept in `f`).
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet && !f.amount.trim() && !f.raw.trim()) closeSheet(); });
  for (const add of [$("ledgerAdd"), sheet]) wireAdd(add);
  wireRest();
}
function wireAdd(add) {
  // Where's suggestions: open on focus, shut on leaving it, Escape or Enter. A tap on one keeps the focus
  // (pointerdown), so the list isn't shut before the tap lands.
  add.addEventListener("focusin", (ev) => { if (ev.target.id === "lgRaw") paintSug(true); });
  add.addEventListener("focusout", (ev) => { if (ev.target.id === "lgRaw") paintSug(false); });
  add.addEventListener("pointerdown", (ev) => { if (ev.target.closest("[data-lgshop]")) ev.preventDefault(); });
  add.addEventListener("keydown", (ev) => {
    if (ev.target.id !== "lgRaw" || $("lgSug")?.hidden) return;
    if (ev.key === "Escape") { ev.preventDefault(); ev.stopPropagation(); paintSug(false); }
    if (ev.key === "Enter") { ev.preventDefault(); paintSug(false); }
  });
  add.addEventListener("input", (ev) => {
    const id = ev.target.id;
    if (id === "lgAmt") { f.amount = ev.target.value; paintWarn(); }
    if (id === "lgRaw") { setWhere(ev.target.value); paintSug(true); }
    if (id === "lcStmt") paintCardForm();
  });
  add.addEventListener("change", (ev) => {
    const el = ev.target;
    if (el.name === "lgWho") { f.who = el.value; formKey = ""; renderAdd(); }
    if (el.id === "lgDate") { f.date = el.value; paintWarn(); }
    if (el.id === "lgAcct") { f.account = el.value; paintWarn(); }
    if (el.id === "lgCat") { f.cat = el.value; f.catAuto = false; paintWhy(); }
    if (el.id === "lcType") { const cc = el.value === "credit_card"; $("lcName").value = cc ? ($("lcPreset").value ? "CIMB PETRONAS" : "") : TYPES[el.value]; paintCardForm(); }
    if (el.id === "lcPreset") $("lcName").value = el.value ? "CIMB PETRONAS" : "";
  });
  add.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.lgshop != null) { $("lgRaw").value = b.dataset.lgshop; setWhere(b.dataset.lgshop); paintSug(false); return; }
    if (b.dataset.ltype) { f.type = b.dataset.ltype; msg = ""; formKey = ""; renderAdd(); }
    if (b.dataset.lgbucket) { f.bucket = b.dataset.lgbucket; f.bucketPicked = true; paintAddBucket(); }
    if (b.id === "lgSave") save();
    if (b.id === "lgOpen") { msg = ""; openAdd("l"); } // the pop-out has the screen to itself: the full form
    if (b.id === "lgAll") openAdd("l");
    if (b.id === "lgFew") openAdd(b.dataset.to || null);
    if (b.id === "lgCard") { if (sheetView) closeSheet(); cardForm = true; msg = ""; renderAdd(); $("lcName")?.focus(); }
    if (b.id === "lcSave") saveCard();
    if (b.id === "lcCancel") { cardForm = false; $("ledgerAdd").innerHTML = ""; renderAdd(); }
  });
}
function wireRest() {
  // The in-row fix form: every field goes straight into `edit`.
  const list = $("ledgerList");
  const readEdit = (el) => {
    if (!edit) return;
    if (el.id === "leAmt") edit.amount = el.value;
    if (el.id === "leDate") edit.date = el.value;
    if (el.id === "leAcct") edit.account = el.value;
    if (el.id === "leRaw") { edit.raw = el.value; paintBucket(); }
    if (el.id === "leCat") { edit.cat = el.value; paintBucket(); }
    if (el.name === "leWho") edit.who = el.value;
  };
  list.addEventListener("input", (ev) => readEdit(ev.target));
  list.addEventListener("submit", (ev) => { ev.preventDefault(); saveEdit(); });
  list.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && edit) cancelEdit(); });
  list.addEventListener("change", async (ev) => {
    readEdit(ev.target);
    const id = ev.target.dataset.lcat; if (!id) return;
    const t = txns.find((x) => x.id === id); if (!t || !own(t)) return;
    await commit(() => setDoc(doc(db, "ledgerTxns", id), { cat: ev.target.value }, { merge: true }));
    makeOffer(t.raw || t.merchant, ev.target.value, "lgOffer");
  });
  $("ledger").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    // These open their own panel on the page, so a popped-out card closes first.
    if (b.dataset.limport) { board.close(); startImport(b.dataset.limport); }
    if (b.dataset.lrules) { board.close(); startRules(b.dataset.lrules); }
    if (b.dataset.offer === "yes") acceptOffer(b.dataset.host);
    if (b.dataset.offer === "no") { const h = b.dataset.host; offer = null; paintOffer(h); }
  });
  $("ledgerList").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.ldocs) { const t = txns.find((x) => x.id === b.dataset.ldocs); if (t) openDocs(txnEntry(t)); }
    if (b.dataset.lopen) { edit = null; openRow = openRow === b.dataset.lopen ? null : b.dataset.lopen; renderList(); }
    if (b.id === "lgMore") { extra += RECENT; renderList(); }
    if (b.dataset.ldel) removeTxn(b.dataset.ldel);
    if (b.dataset.ledit) startEdit(b.dataset.ledit);
    if (b.dataset.letype && edit) { edit.type = b.dataset.letype; b.parentElement.querySelectorAll("[data-letype]").forEach((c) => c.setAttribute("aria-pressed", String(c === b))); }
    if (b.dataset.lebucket && edit) { edit.bucket = b.dataset.lebucket; edit.bucketPicked = true; paintBucket(); }
    if (b.id === "leCancel") cancelEdit();
  });
}
