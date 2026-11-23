// The Ledger journal (#ledger view, picked on the wheel): add spending, card rebates, recent items,
// and the "Spending" part of each person card (ledgerSlot-<id>). All maths lives in ledger.js (pure).
import { collection, doc, setDoc, deleteDoc, onSnapshot, query, where, writeBatch } from "../../core/fs.js";
import { $, esc, today, addDays } from "../../core/util.js";
import { confirmDelete } from "../../core/confirm.js";
import {
  SYSTEM_CATEGORIES, PRESETS, toSen, rm, shortDate, norm, categorise, cycleOf, lastStatement, cycleView, computeRebate,
  manualTxn, payWarning, warningText, tierLabel, spendByCat, spendTotal, ruleMatches,
} from "../../logic/ledger.js";
import { suggestPattern } from "../../logic/ledgerimport.js";
import { shopKey, nickMap, byNick, usualCat } from "../../logic/bucketspend.js";
import { initImport, startImport, renderImport } from "./import.js";
import { initTrends, renderTrends } from "./trends.js";
import { initRules, startRules, renderRules } from "./rules.js";
import { ensureSeeds, addAccount, saveCycle } from "./seeds.js";
import { initPlan, planSubs, renderPlan } from "./plan.js";
import { initSpend, renderSpend } from "./spend.js";

const store = {
  get(k, d) { try { return localStorage.getItem(k) ?? d; } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch (_) {} },
};
const ACCT_KEY = "journal-ledger-acct";
const LOAD_DAYS = 400; // a year and a bit, for trends later
const RECENT = 15;
const KINDS = { purchase: "Spend", payment: "Card payment", refund: "Refund" };
const TYPES = { credit_card: "Credit card", debit: "Debit card", ewallet: "E-wallet", cash: "Cash", bank: "Bank account" };
const CATS = SYSTEM_CATEGORIES.filter((c) => !c.hidden);
const cat = (id) => SYSTEM_CATEGORIES.find((c) => c.id === id) ?? SYSTEM_CATEGORIES.find((c) => c.id === "other");

let db, commit, people, me, unsubs = [], seeded = false;
let accounts = [], programs = [], aliases = [], cycles = {}, txns = [], rebates = {}, shopNames = [];
// "Always categorise" offer after a category is changed by hand: { raw, cat, pattern, host, msg }.
let offer = null, openRow = null;
// The add form. catAuto: the category came from a merchant rule (it follows the shop until picked by hand).
const blank = (keep = {}) => ({ who: keep.who ?? null, type: "purchase", amount: "", raw: "", cat: "other", catAuto: true, account: keep.account ?? null, date: today() });
const f = blank();
let msg = "", cardForm = false, cardMsg = "", formKey = "", shown = RECENT;
// While fixing an item from Recent, the same form edits it: { id, where } (where = the Where text it opened with).
let editing = null;

const who = () => (people().some((p) => p.id === f.who) ? f.who : me());
const live = () => accounts.filter((a) => a.active !== false).sort((a, b) => (a.at ?? 0) - (b.at ?? 0));
const acct = () => live().find((a) => a.id === f.account) ?? live().find((a) => a.id === store.get(ACCT_KEY, "")) ?? live()[0] ?? null;
const personName = (id) => people().find((p) => p.id === id)?.name ?? "";

export function initLedger(opts) {
  ({ db, commit, people, me } = opts);
  wire();
  initImport({
    db: () => db, commit, people, me, today, accounts: () => accounts, programs: () => programs, aliases: () => aliases, txns: () => txns,
    refresh: () => refreshLedger(), offer: makeOffer, paintOffer,
  });
  const shared = { db: () => db, commit, people, today, accounts: () => live(), programs: () => programs, cycles: () => cycles, txns: () => txns, refresh: () => refreshLedger() };
  initTrends(shared);
  initRules(shared);
  initPlan({ ...shared, me });
  initSpend({ ...shared, loadedFrom: () => addDays(today(), -LOAD_DAYS), aliases: () => aliases, shops: () => shopNames });
  $("me").addEventListener("change", () => { if (!editing) f.who = null; formKey = ""; refreshLedger(); });
  addEventListener("journalchange", () => refreshLedgerParts());
}
export function startLedger() {
  const sub = (name, fn) => unsubs.push(onSnapshot(collection(db, name), (s) => { fn(s.docs.map((d) => ({ id: d.id, ...d.data() }))); refreshLedger(); }));
  sub("ledgerAccounts", (x) => { accounts = x; });
  sub("ledgerPrograms", (x) => { programs = x; });
  sub("ledgerAliases", (x) => { aliases = x; });
  sub("ledgerCycles", (x) => { cycles = Object.fromEntries(x.map((c) => [c.id, c])); });
  sub("ledgerRebates", (x) => { rebates = Object.fromEntries(x.map((r) => [r.id, r])); });
  sub("ledgerShops", (x) => { shopNames = x; });
  unsubs.push(onSnapshot(query(collection(db, "ledgerTxns"), where("date", ">=", addDays(today(), -LOAD_DAYS))), (s) => {
    txns = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date || "") && Number.isInteger(t.amountSen));
    refreshLedger();
  }));
  unsubs.push(...planSubs(db));
  if (!seeded) { seeded = true; ensureSeeds(db).catch(() => { seeded = false; }); }
}
export function stopLedger() { unsubs.forEach((u) => u()); unsubs = []; }

export function refreshLedger() {
  if (!$("ledgerAdd") || !people().length) return;
  renderPlan();
  renderSpend();
  renderAdd();
  renderImport();
  renderRules();
  renderCards();
  renderTrends();
  renderList();
  refreshLedgerParts();
}

// ---------- add spending ----------
function renderAdd() {
  const host = $("ledgerAdd"), a = acct();
  if (cardForm || !live().length) return renderCardForm(host);
  // Drawn once per shape, so new data from the other phone never wipes what's being typed.
  const key = [editing?.id, who(), f.type, live().map((x) => x.id + x.name).join(","), people().map((p) => p.id + p.name).join(",")].join("|");
  if (key !== formKey || !$("lgAmt")) {
    formKey = key;
    const pay = f.type === "payment";
    const title = editing ? (pay ? "Edit card payment" : f.type === "refund" ? "Edit refund" : "Edit spending") : pay ? "Log a card payment" : f.type === "refund" ? "Log a refund" : "Add spending";
    host.classList.toggle("is-editing", !!editing);
    host.innerHTML = `
      <div class="mhead"><h2 id="ledgerAddTitle">${title}</h2>
        <label class="mealdate">Day<input type="date" id="lgDate" value="${esc(f.date)}" max="${today()}"></label></div>
      <div class="lbl mwho"><span>${pay ? "Paid by" : "Spent by"}</span><div class="seg">${people().map((p) => `<input type="radio" name="lgWho" id="lgw-${p.id}" value="${p.id}"${p.id === who() ? " checked" : ""}><label for="lgw-${p.id}">${esc(p.name)}</label>`).join("")}</div></div>
      <div class="chips" role="group" aria-label="Kind">${Object.entries(KINDS).map(([k, v]) => `<button type="button" class="chip" data-ltype="${k}" aria-pressed="${k === f.type}">${v}</button>`).join("")}</div>
      <div class="two">
        <label>Amount, RM<input type="text" id="lgAmt" inputmode="decimal" autocomplete="off" placeholder="0.00" value="${esc(f.amount)}"></label>
        <label>${pay ? "Card" : "Paid with"}<select id="lgAcct">${live().filter((x) => !pay || x.type === "credit_card").map((x) => `<option value="${x.id}"${x.id === a?.id ? " selected" : ""}>${esc(x.name)}${x.last4 ? ` ··${esc(x.last4)}` : ""}</option>`).join("")}</select></label>
      </div>
      ${pay ? "" : `<label>Where<input type="text" id="lgRaw" list="lgShops" autocomplete="off" placeholder="Shop, e.g. Setel or Econsave" value="${esc(f.raw)}"></label>
      <datalist id="lgShops"></datalist>
      <label>Category <small id="lgWhy"></small><select id="lgCat">${CATS.map((c) => `<option value="${c.id}"${c.id === f.cat ? " selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}</select></label>`}
      <div class="lwarn" id="lgWarn" role="status" hidden></div>
      ${editing ? `<p class="note ledhint">Fixing an item from Recent. Change what's wrong, then save.</p>` : ""}
      <div class="actions"><button type="button" class="primary" id="lgSave">${saveLabel()}</button>${editing
        ? `<button type="button" id="lgCancel">Cancel</button>`
        : `<button type="button" class="mini" id="lgCard">＋ Card or wallet</button>`}</div>
      <p class="msg" id="lgMsg" aria-live="polite"></p>`;
  }
  if ($("lgShops")) $("lgShops").innerHTML = shopOptions(); // refreshed every time: it never disturbs typing
  paintWhy(); paintWarn();
  $("lgMsg").textContent = msg;
}
// The "Where" suggestions: your own shop names first (the statement name beside), then past shops,
// most recent first, no repeats, leaving out shops you named.
function shopOptions() {
  const named = shopNames.filter((s) => s.nick && s.name).sort((a, b) => a.nick.localeCompare(b.nick));
  return [...named.map((s) => `<option value="${esc(s.nick)}" label="${esc(s.name)}"></option>`), ...shops(new Set(named.map((s) => s.key))).map((s) => `<option value="${esc(s)}"></option>`)].join("");
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
function shops(skip = new Set()) {
  const seen = new Set(skip), out = [];
  for (const t of [...txns].sort((x, y) => y.date.localeCompare(x.date))) {
    const s = t.merchant || t.raw; if (!s || t.type === "payment" || seen.has(norm(s))) continue;
    seen.add(norm(s)); out.push(s); if (out.length >= 60) break;
  }
  return out;
}
function paintWhy() {
  const el = $("lgWhy"); if (!el) return;
  const r = f.raw.trim() ? autoCat() : null, named = byNick(f.raw, shopNames);
  el.textContent = [named ? `· your name for ${named.name}` : "", f.catAuto && r?.rule ? "· picked from the shop name" : f.catAuto && r?.usual ? "· what it usually is" : ""].filter(Boolean).join(" ");
}
// The live "don't pay yet" check while a card payment is being typed.
function paintWarn() {
  const el = $("lgWarn"), save = $("lgSave"); if (!el) return;
  const w = f.type === "payment" ? warning() : null;
  el.hidden = !w;
  el.classList.toggle("calm", !!w?.calm);
  el.innerHTML = w ? (w.calm ? esc(w.text) : `<b>Wait — don't pay yet?</b> ${esc(w.text)}`) : "";
  save.textContent = w && !w.calm ? "Save anyway" : saveLabel();
}
const saveLabel = () => (editing ? "Save changes" : "Save");

// "Edit" on a Recent item: load it into the form at the top, which then saves over it.
function startEdit(id) {
  const t = txns.find((x) => x.id === id); if (!t) return;
  const where = t.type === "payment" ? "" : t.merchant || t.raw || "";
  Object.assign(f, { who: t.spentBy, type: t.type, amount: (Math.abs(t.amountSen) / 100).toFixed(2), raw: where,
    cat: t.cat === "payment" ? "other" : t.cat || "other", catAuto: false, account: t.account, date: t.date });
  editing = { id, where };
  cardForm = false; msg = ""; openRow = null; formKey = "";
  refreshLedger();
  $("ledgerAdd").scrollIntoView({ behavior: "smooth", block: "start" });
  $("lgAmt")?.focus({ preventScroll: true });
}
function stopEdit() {
  editing = null;
  Object.assign(f, blank({ account: store.get(ACCT_KEY, null) }));
  msg = ""; formKey = "";
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
  const old = editing ? txns.find((x) => x.id === editing.id) : null;
  if (editing && !old) { stopEdit(); refreshLedger(); return say("That item was deleted on the other phone."); }
  const t = manualTxn(a, { spentBy: who(), date: f.date, amount: f.amount, type: f.type, raw: f.type === "payment" ? "Card payment" : raw, cat: f.cat, merchant: r.merchant || raw.trim() }, old?.at ?? Date.now());
  const body = old ? editedTxn(old, t) : t;
  store.set(ACCT_KEY, a.id);
  const cyc = cycleOf(a, body.posted);
  const what = f.type === "payment" ? `${rm(sen)} paid to ${a.name}` : `${f.type === "refund" ? "Refund of " : ""}${rm(sen)} at ${f.raw.trim()}`;
  const ref = old ? doc(db, "ledgerTxns", old.id) : doc(collection(db, "ledgerTxns"));
  const save = $("lgSave"); if (save) save.disabled = true;
  try {
    await commit(() => Promise.all([setDoc(ref, body), a.type === "credit_card" ? saveCycle(db, cyc) : Promise.resolve()]),
      old ? `Updated: ${what} for ${personName(who())}.` : `Saved ${what} for ${personName(who())}.`);
  } catch (_) {
    if (save) save.disabled = false;
    return say("Not saved yet. Your numbers are still here: try again.");
  }
  if (old) stopEdit();
  else { msg = ""; Object.assign(f, { amount: "", raw: "", cat: "other", catAuto: true, type: "purchase" }); formKey = ""; }
  refreshLedger();
}
// The saved item after an edit: the form's fields over the old item, keeping what the form doesn't show
// (where it came from, statement check, notes, created time). A statement item keeps its statement name and
// posting date unless Where, the day or the card was changed.
function editedTxn(old, t) {
  const { id: _id, ...keep } = old;
  const out = { ...keep, ...t, source: old.source ?? "manual", reconciled: old.reconciled ?? false, at: old.at ?? t.at, updated: Date.now() };
  if (old.source !== "manual" && f.raw.trim() === editing.where) Object.assign(out, { raw: old.raw, merchant: old.merchant ?? t.merchant });
  if (old.date === t.date && old.account === t.account) Object.assign(out, { posted: old.posted ?? t.posted, postedGuess: old.postedGuess ?? t.postedGuess, cycle: old.cycle ?? t.cycle });
  for (const k of Object.keys(out)) if (out[k] === undefined) delete out[k];
  return out;
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
    const head = `<div class="lhead"><h2>${esc(a.name)}</h2>${a.last4 ? `<span class="note">··${esc(a.last4)}</span>` : ""}<span class="lbtnrow"><button type="button" class="mini" data-lrules="${a.id}">⚙️ Rules</button><button type="button" class="mini" data-limport="${a.id}">📄 Import statement</button></span></div>
      <p class="lcycle">${shortDate(v.cycle.start)} – ${shortDate(v.cycle.statement)} · <b>${v.daysLeft === 0 ? "statement today" : `${v.daysLeft} ${v.daysLeft === 1 ? "day" : "days"} to statement`}</b> · due ${shortDate(v.cycle.due)}</p>
      ${last ? `<p class="note llast">Last statement ${shortDate(last.statement)}: <b>${last.balanceSen == null ? "–" : rm(last.balanceSen)}</b>${lastReb ? ` · rebate <b>${rm(lastReb.totalSen)}</b> (${esc(lastReb.tierLabel)} tier)` : ""} ✓</p>` : ""}`;
    if (!v.program) return `<section class="panel lcard" id="lcard-${a.id}" data-title="${esc(a.name)}">${head}
      <div class="stats"><div class="stat"><small>Next statement so far</small><b>${rm(v.balanceSen)}</b></div></div>
      <p class="note">No rebate rules for this card yet. Tap ⚙️ Rules to add them.</p></section>`;
    const p = v.program, r = v.rebate, top = p.tiers.at(-1).minSen;
    const max = Math.max(top * 1.25, v.balanceSen * 1.05, 1), at = (sen) => Math.max(0, Math.min(100, (sen / max) * 100));
    // At the 0% tier, show what the first paying tier would give, so the gap is real money.
    const gs = withEligible(r.tier > 0 || !p.tiers[1] ? r : computeRebate(p, { txns: v.txns, balanceSen: p.tiers[1].minSen }));
    return `<section class="panel lcard" id="lcard-${a.id}" data-title="${esc(a.name)} rebate">${head}
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
      ${v.risky.length ? `<p class="note">⚠️ ${v.risky.length} ${v.risky.length === 1 ? "swipe" : "swipes"} near the cut-off may post in the next cycle.</p>` : ""}
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
  const list = [...txns].sort((a, b) => b.date.localeCompare(a.date) || (b.at ?? 0) - (a.at ?? 0));
  const names = Object.fromEntries(accounts.map((a) => [a.id, a.name])), nicks = nickMap(shopNames);
  host.innerHTML = `<h2>Recent</h2><div id="lgOffer"></div>${list.length ? `<div class="llist">${list.slice(0, shown).map((t) => {
    const c = cat(t.cat), credit = t.amountSen < 0, open = openRow === t.id, name = t.merchant || t.raw || c.name;
    return `<div class="lrow${open ? " open" : ""}">
      <button type="button" class="lopen" data-lopen="${t.id}" aria-expanded="${open}">
        <span class="lic" aria-hidden="true">${c.icon}</span>
        <span class="lmain"><b>${esc(name)}${t.type !== "payment" && nicks[shopKey(t)] ? ` <span class="lsnick">🏷 ${esc(nicks[shopKey(t)])}</span>` : ""}</b><small>${shortDate(t.date)} · ${esc(personName(t.spentBy))} · ${esc(names[t.account] ?? "")}${t.type === "payment" ? "" : ` · ${esc(c.name)}`}${t.reconciled ? " · ✓ statement" : ""}</small></span>
        <span class="lamt${credit ? " cr" : ""}">${rm(Math.abs(t.amountSen))}${credit ? " CR" : ""}</span>
      </button>
      ${open ? `<div class="ledit">
        ${t.type === "payment" ? "" : `<label>Category<select data-lcat="${t.id}">${CATS.map((x) => `<option value="${x.id}"${x.id === t.cat ? " selected" : ""}>${x.icon} ${esc(x.name)}</option>`).join("")}</select></label>`}
        ${t.raw && t.raw !== norm(name) ? `<p class="note">On the statement: ${esc(t.raw)}</p>` : ""}
        <div class="actions"><button type="button" class="mini" data-ledit="${t.id}">✏️ Edit</button><button type="button" class="mini" data-ldel="${t.id}">Delete</button></div>
      </div>` : ""}
    </div>`;
  }).join("")}</div>${list.length > shown ? `<button type="button" class="mini" id="lgMore">Show more</button>` : ""}`
    : `<p class="note">Nothing yet. What you add shows here.</p>`}`;
  paintOffer("lgOffer");
}

// Delete one item, after asking (safe-delete). A statement item comes back if that statement is imported again.
async function removeTxn(id) {
  const t = txns.find((x) => x.id === id); if (!t) return;
  const name = t.merchant || t.raw || cat(t.cat).name;
  const ok = await confirmDelete({
    title: `Delete ${name}?`,
    body: `<p>${rm(Math.abs(t.amountSen))} on ${shortDate(t.date)}${t.reconciled ? ". It's on a statement, so importing that statement again brings it back." : "."}</p>`,
    yes: "Delete it",
  });
  if (!ok) return;
  openRow = null;
  if (editing?.id === id) { stopEdit(); renderAdd(); }
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
    <p><b>Always put this shop in ${c.icon} ${esc(c.name)}?</b> Shop names starting with:</p>
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
const monthStart = (d) => `${d.slice(0, 7)}-01`;
export function refreshLedgerParts() {
  if (!people().length) return;
  const t = today(), from = monthStart(t), lastFrom = monthStart(addDays(from, -1)), lastTo = addDays(lastFrom, Number(t.slice(8)) - 1);
  const month = new Date(`${t}T12:00`).toLocaleDateString(undefined, { month: "long" });
  people().forEach((p) => {
    const slot = $("ledgerSlot-" + p.id); if (!slot) return;
    const rows = spendByCat(txns, { from, to: t, person: p.id }), total = spendTotal(rows);
    const last = spendTotal(spendByCat(txns, { from: lastFrom, to: lastTo, person: p.id }));
    const big = rows[0]?.sen || 1;
    slot.innerHTML = `<div class="calhead"><h3 class="ptitle">Spending</h3><a class="btn mini" href="#ledger/spend/all">See all →</a></div>
      ${rows.length ? `<p class="week"><b>${rm(total)}</b> in ${esc(month)} so far${last ? ` · ${rm(last)} by this day last month` : ""}</p>
      <div class="lcats">${rows.slice(0, 5).map((r) => `<div class="lcat"><span>${cat(r.cat).icon} ${esc(cat(r.cat).name)}</span><i style="width:${Math.max(3, Math.round((r.sen / big) * 100))}%"></i><b>${rm(r.sen, { whole: true })}</b></div>`).join("")}</div>`
        : `<p class="note">Nothing logged in ${esc(month)} yet. Logging is optional: add what you want to keep an eye on.</p>`}`;
  });
}

// ---------- events ----------
function wire() {
  const add = $("ledgerAdd");
  add.addEventListener("input", (ev) => {
    const id = ev.target.id;
    if (id === "lgAmt") { f.amount = ev.target.value; paintWarn(); }
    if (id === "lgRaw") {
      f.raw = ev.target.value;
      if (f.catAuto) { const r = autoCat(); f.cat = r.cat === "payment" ? "other" : r.cat; if ($("lgCat")) $("lgCat").value = f.cat; }
      paintWhy();
    }
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
    if (b.dataset.ltype) { f.type = b.dataset.ltype; msg = ""; formKey = ""; renderAdd(); }
    if (b.id === "lgSave") save();
    if (b.id === "lgCard") { cardForm = true; msg = ""; renderAdd(); $("lcName")?.focus(); }
    if (b.id === "lcSave") saveCard();
    if (b.id === "lgCancel") { stopEdit(); refreshLedger(); }
    if (b.id === "lcCancel") { cardForm = false; add.innerHTML = ""; renderAdd(); }
  });
  $("ledgerList").addEventListener("change", async (ev) => {
    const id = ev.target.dataset.lcat; if (!id) return;
    const t = txns.find((x) => x.id === id); if (!t) return;
    await commit(() => setDoc(doc(db, "ledgerTxns", id), { cat: ev.target.value }, { merge: true }));
    makeOffer(t.raw || t.merchant, ev.target.value, "lgOffer");
  });
  $("ledger").addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.limport) startImport(b.dataset.limport);
    if (b.dataset.lrules) startRules(b.dataset.lrules);
    if (b.dataset.offer === "yes") acceptOffer(b.dataset.host);
    if (b.dataset.offer === "no") { const h = b.dataset.host; offer = null; paintOffer(h); }
  });
  $("ledgerList").addEventListener("click", async (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.lopen) { openRow = openRow === b.dataset.lopen ? null : b.dataset.lopen; renderList(); }
    if (b.id === "lgMore") { shown += RECENT; renderList(); }
    if (b.dataset.ledit) startEdit(b.dataset.ledit);
    if (b.dataset.ldel) removeTxn(b.dataset.ldel);
  });
}
