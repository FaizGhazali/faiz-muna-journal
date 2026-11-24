// Ledger: the Income card (#ledgerIncome, data-card "income"): salaries, part-time pay and side money (flipping,
// a bonus) as they come in, each with 📎 for its payslip or proof (docsui.js). What the money plan counts as the
// month's income is worked out in logic/income.js (real salaries; last month's stands in until this month's is
// logged; extras on top). Each person adds and changes only their own; the other's show read-only.
// Small: this month's total. Medium: the total and the latest entries. Large: who's in, extras, every entry this
// month and last, edit / delete in place. The form shows large (data-force).
import { collection, doc, setDoc, deleteDoc } from "../../core/fs.js";
import { $, esc, today } from "../../core/util.js";
import { confirmDelete } from "../../core/confirm.js";
import { canEdit } from "../../core/owner.js";
import { rm, toSen, shortDate } from "../../logic/ledger.js";
import { monthOf, addMonths, payOf, payLabel } from "../../logic/moneyplan.js";
import { INCOME_KINDS, incomeKind, checkIncome, monthIncome, lastIncome, sources, FROM_MAX, NOTE_MAX } from "../../logic/income.js";
import { openDocs, docsOn } from "./docsui.js";
import { planState } from "./plan.js";

const M_SHOWN = 3; // entries on the medium card
let ctx, form = null, msg = "", flash = null; // form: { id|null, kind, amount, date, from, note, err }

export function initIncome(c) {
  ctx = c;
  const host = $("ledgerIncome");
  host.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) click(b); });
  host.addEventListener("input", (ev) => {
    if (!form) return;
    const t = ev.target; host.querySelector("[data-form]")?.setAttribute("data-dirty", "1");
    if (t.id === "lnAmt") form.amount = t.value;
    if (t.id === "lnDate") form.date = t.value;
    if (t.id === "lnFrom") form.from = t.value;
    if (t.id === "lnNote") form.note = t.value;
  });
}

const people = () => Object.fromEntries(ctx.people().map((p) => [p.id, p.name]));
const view = () => {
  const plan = planState().plan, pay = payOf(plan), m = monthOf(ctx.today(), pay);
  return { plan, pay, m, inc: monthIncome(ctx.incomes(), plan?.incomeSen ?? 0, m, pay) };
};

export function renderIncome() {
  const host = $("ledgerIncome"); if (!host || !ctx.people().length) return;
  if (host.querySelector("[data-form][data-dirty]")) return; // never wipe typing
  const { pay, m, inc } = view(), size = form ? "l" : ctx.board.sizeOf("income");
  if (form) host.dataset.force = "l"; else delete host.dataset.force;
  const names = people();
  if (size === "s") {
    host.innerHTML = ctx.board.tile("income", `<small id="lnTitle">Income this month</small><b class="bdbig">${rm(inc.totalSen, { whole: true })}</b><small>${esc(status(inc, names))}</small>`, "Income");
    return;
  }
  const head = `<div class="lhead"><h2 id="lnTitle">Income</h2><span class="note">${esc(payLabel(m, pay))}</span>
    <span class="lbtnrow">${form ? "" : `<button type="button" class="mini" data-ln="new">＋ Add income</button>`}${ctx.board.less("income")}</span></div>`;
  const total = `<div class="lpleft"><div><small>came in${inc.fromPlan ? " (your plan, until a salary is logged)" : ""}</small><b>${rm(inc.totalSen, { whole: true })}</b></div>
    ${inc.extrasSen ? `<div><small>extra this month</small><b class="sm">+${rm(inc.extrasSen, { whole: true })}</b></div>` : ""}</div>`;
  if (size === "m") {
    host.innerHTML = `${head}${total}
      ${inc.items.length ? `<div class="lpbl">${inc.items.slice(0, M_SHOWN).map((x) => row(x, names, false)).join("")}</div>` : `<p class="note">${esc(status(inc, names))}</p>`}
      <p class="note">${inc.items.length > M_SHOWN ? `And ${inc.items.length - M_SHOWN} more. ` : ""}${ctx.board.more("income", "All income")}</p>
      <p class="msg" aria-live="polite">${esc(msg)}</p>`;
    return;
  }
  const last = monthIncome(ctx.incomes(), 0, addMonths(m, -1), pay).items;
  host.innerHTML = `${head}
    ${form ? incomeForm() : ""}
    ${total}
    ${inc.salaries.length ? `<p class="note">Salaries: ${inc.salaries.map((s) => `${esc(names[s.person] ?? "")} ${rm(s.amountSen, { whole: true })}${s.expected ? " (last month's, until this month's is in)" : ""}`).join(" · ")}</p>` : ""}
    ${inc.items.length ? `<div class="lpbl">${inc.items.map((x) => row(x, names, true)).join("")}</div>` : `<p class="note">Nothing logged this month yet. Add a salary when it lands, and part-time pay or side money (selling, flipping) whenever it comes.</p>`}
    ${last.length ? `<h3 class="lph">${esc(payLabel(addMonths(m, -1), pay))}</h3><div class="lpbl">${last.map((x) => row(x, names, true)).join("")}</div>` : ""}
    <p class="msg" aria-live="polite">${esc(msg)}</p>`;
  if (flash && Date.now() - flash.at < 1800) host.querySelector(`[data-inc="${flash.id}"]`)?.classList.add("lflash");
}

// "2 of 2 salaries in", "Lina's salary not in yet", "from your plan".
function status(inc, names) {
  if (inc.fromPlan) return inc.items.length ? `plan + ${rm(inc.extrasSen, { whole: true })} extra` : "from your plan · log a salary";
  const wait = inc.salaries.filter((s) => s.expected);
  return wait.length ? `${wait.map((s) => names[s.person] ?? "").join(" & ")}'s salary not in yet` : "all salaries in";
}

function row(x, names, actions) {
  const k = incomeKind(x.kind), mine = canEdit(x.person), n = x.docs?.length ?? 0;
  return `<div class="lpb lnrow" data-inc="${x.id}">
    <span class="lpdue">${shortDate(x.date)}</span>
    <span class="lpbn"><b>${k.icon} ${esc(x.from || k.name)}</b><small>${esc(k.name)} · ${esc(names[x.person] ?? "")}${x.note ? ` · ${esc(x.note)}` : ""}${!actions && n ? ` · 📎${n > 1 ? ` ${n}` : ""}` : ""}</small></span>
    <b class="lpba ok">+${rm(x.amountSen)}</b>
    ${actions ? `<span class="lbtnrow">${docsOn() && (mine || n) ? `<button type="button" class="mini" data-ln="docs" data-id="${x.id}" aria-label="Payslip or proof">📎${n ? ` ${n}` : ""}</button>` : ""}${mine ? `<button type="button" class="mini" data-ln="edit" data-id="${x.id}">Edit</button>` : ""}</span>` : ""}
  </div>`;
}

function incomeForm() {
  const f = form, mine = sources(ctx.incomes(), ctx.me());
  return `<div class="lpbform" data-form="income">
    <h3>${f.id ? "Edit income" : "Add income"}</h3>
    <div class="chips" role="group" aria-label="What it is">${INCOME_KINDS.map((k) => `<button type="button" class="chip" data-lnkind="${k.id}" aria-pressed="${k.id === f.kind}">${k.icon} ${esc(k.name)}</button>`).join("")}</div>
    ${incomeKind(f.kind).hint ? `<p class="note">${esc(incomeKind(f.kind).hint)}</p>` : ""}
    <div class="two">
      <label>Amount, RM<input type="text" id="lnAmt" inputmode="decimal" autocomplete="off" placeholder="2500" value="${esc(f.amount)}"></label>
      <label>Came in on<input type="date" id="lnDate" value="${esc(f.date)}"></label>
    </div>
    <label>From <small>employer, buyer, where</small><input type="text" id="lnFrom" list="lnFromList" maxlength="${FROM_MAX}" autocomplete="off" placeholder="${f.kind === "side" ? "Sold old phone" : "Company name"}" value="${esc(f.from)}"></label>
    <datalist id="lnFromList">${mine.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>
    <label>Note <small>optional</small><input type="text" id="lnNote" maxlength="${NOTE_MAX}" autocomplete="off" value="${esc(f.note)}"></label>
    <div class="actions"><button type="button" class="primary" data-ln="save">Save</button><button type="button" data-ln="cancel">Cancel</button>${f.id ? `<button type="button" class="mini" data-ln="del" data-id="${f.id}">Delete</button>` : ""}</div>
    <p class="msg" id="lnMsg" aria-live="polite">${esc(f.err ?? "")}</p>
  </div>`;
}

function open(id = null) {
  const x = id ? ctx.incomes().find((y) => y.id === id) : null;
  if (x && !canEdit(x.person)) { msg = ""; return; }
  const last = lastIncome(ctx.incomes(), ctx.me());
  form = x ? { id, kind: x.kind, amount: (x.amountSen / 100).toFixed(2), date: x.date, from: x.from ?? "", note: x.note ?? "" }
    : { id: null, kind: last?.kind ?? "salary", amount: "", date: today(), from: last?.from ?? "", note: "" };
  msg = ""; renderIncome();
  $("ledgerIncome").scrollIntoView({ block: "nearest" });
  $("lnAmt")?.focus({ preventScroll: true });
}
const clearDirty = () => { const d = $("ledgerIncome").querySelector("[data-form]"); if (d) delete d.dataset.dirty; };
function closeForm() { form = null; clearDirty(); renderIncome(); }

async function save() {
  const f = form, old = f.id ? ctx.incomes().find((y) => y.id === f.id) : null;
  const r = checkIncome({ person: old?.person ?? ctx.me(), date: f.date, kind: f.kind, from: f.from, note: f.note, amountSen: toSen(f.amount) });
  if (!r.ok) { f.err = r.error; $("lnMsg").textContent = r.error; return; }
  const now = Date.now(), ref = old ? doc(ctx.db(), "ledgerIncome", old.id) : doc(collection(ctx.db(), "ledgerIncome"));
  const body = { ...r.income, docs: old?.docs ?? [], at: old?.at ?? now, created: old?.created ?? now, updated: now };
  const what = `${incomeKind(r.income.kind).name} ${rm(r.income.amountSen)}`;
  try {
    await ctx.commit(() => setDoc(ref, body), `${what} ${old ? "saved" : "added"}.`);
    form = null; clearDirty(); flash = { id: ref.id, at: Date.now() };
    msg = old || !docsOn() ? "" : `Saved. Tap 📎 on it to add the ${r.income.kind === "salary" || r.income.kind === "parttime" ? "payslip" : "proof"} now or later.`;
    renderIncome();
  } catch (_) { /* commit showed the error; the form stays as typed */ }
}

async function remove(id) {
  const x = ctx.incomes().find((y) => y.id === id); if (!x || !canEdit(x.person)) return;
  const n = x.docs?.length ?? 0;
  const ok = await confirmDelete({ title: `Delete ${incomeKind(x.kind).name.toLowerCase()} ${rm(x.amountSen)}?`,
    body: `<p>${esc(x.from || incomeKind(x.kind).name)}, ${esc(shortDate(x.date))}.${n ? ` Its ${n === 1 ? "file stays" : `${n} files stay`} in your OneDrive.` : ""}</p>` });
  if (!ok) return;
  form = null; msg = ""; clearDirty();
  await ctx.commit(() => deleteDoc(doc(ctx.db(), "ledgerIncome", id)), "Deleted.");
  renderIncome();
}

// The 📎 sheet's entry for an income (docsui.js): salary and part-time go to Payslips, the rest to Income.
export function incomeEntry(x) {
  const k = incomeKind(x.kind), names = people();
  return { coll: "ledgerIncome", id: x.id, kind: k.folder, date: x.date, what: x.from ? `${k.name} ${x.from}` : k.name, amountSen: x.amountSen,
    person: names[x.person] ?? "", docs: x.docs, canEdit: canEdit(x.person), title: `${k.name}${x.from ? ` · ${x.from}` : ""} · ${rm(x.amountSen)} · ${shortDate(x.date)}` };
}

function click(b) {
  if (b.dataset.lnkind && form) { form.kind = b.dataset.lnkind; const dirty = $("ledgerIncome").querySelector("[data-form]")?.dataset.dirty; clearDirty(); renderIncome(); if (dirty) $("ledgerIncome").querySelector("[data-form]")?.setAttribute("data-dirty", "1"); return; }
  const a = b.dataset.ln, id = b.dataset.id; if (!a) return;
  if (a === "new") open();
  if (a === "edit") open(id);
  if (a === "cancel") closeForm();
  if (a === "save") save();
  if (a === "del") remove(id);
  if (a === "docs") { const x = ctx.incomes().find((y) => y.id === id); if (x) openDocs(incomeEntry(x)); }
}
