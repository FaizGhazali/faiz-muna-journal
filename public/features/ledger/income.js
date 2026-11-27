// Ledger: the Income card (#ledgerIncome, data-card "income"): salaries, part-time pay and side money (flipping,
// a bonus) as they come in, each with a paperclip for its payslip or proof (docsui.js). What the money plan counts as the
// month's income is worked out in logic/income.js (real salaries; last month's stands in until this month's is
// logged; extras on top). Each person adds and changes only their own; the other's show read-only.
// Small: this month's total. Medium: the total and the latest entries. Large: who's in, extras, every entry this
// month and last, edit / delete in place. The form shows large (data-force).
import { collection, doc, setDoc, updateDoc, deleteDoc } from "../../core/fs.js";
import { $, esc, today } from "../../core/util.js";
import { confirmDelete } from "../../core/confirm.js";
import { canEdit } from "../../core/owner.js";
import { rm, toSen, shortDate } from "../../logic/ledger.js";
import { monthOf, addMonths, payOf, payLabel } from "../../logic/moneyplan.js";
import { INCOME_KINDS, incomeKind, checkIncome, monthIncome, lastIncome, sources, FROM_MAX, NOTE_MAX } from "../../logic/income.js";
import { openDocs, docsOn } from "./docsui.js";
import { pageLines } from "../../logic/ledgerimport.js";
import { payslipFields } from "../../logic/payslip.js";
import { openLocalPdf } from "./pdf.js";
import { planState } from "./plan.js";
import { ico } from "../../core/icons.js";

const PDF_FIELDS = { amount: "lnAmt", date: "lnDate", from: "lnFrom" };
const FIELD_NAMES = { amount: "net pay", date: "payment date", from: "employer" };
const M_SHOWN = 3; // entries on the medium card
let ctx, form = null, msg = "", flash = null; // form: { id|null, kind, amount, date, from, note, err }

export function initIncome(c) {
  ctx = c;
  const host = $("ledgerIncome");
  host.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) click(b); });
  host.addEventListener("change", (ev) => {
    if (ev.target.id === "lnPdf" && ev.target.files[0]) readPayslip(ev.target.files[0]);
  });
  host.addEventListener("input", (ev) => {
    if (!form || form.saving) return;
    const t = ev.target;
    if (t.id === "lnKeep") { form.keep = t.checked; return; }
    const field = Object.keys(PDF_FIELDS).find((key) => PDF_FIELDS[key] === t.id);
    if (!field && t.id !== "lnNote") return;
    host.querySelector("[data-form]")?.setAttribute("data-dirty", "1");
    if (field) {
      form[field] = t.value;
      form.edited.add(field);
      form.suggested.delete(field);
      t.removeAttribute("data-suggested");
    } else form.note = t.value;
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
    <span class="lpbn"><b>${ico(k.icon)} ${esc(x.from || k.name)}</b><small>${esc(k.name)} · ${esc(names[x.person] ?? "")}${x.note ? ` · ${esc(x.note)}` : ""}${!actions && n ? ` · ${ico("clip")}${n > 1 ? ` ${n}` : ""}` : ""}</small></span>
    <b class="lpba ok">+${rm(x.amountSen)}</b>
    ${actions ? `<span class="lbtnrow">${docsOn() && (mine || n) ? `<button type="button" class="mini" data-ln="docs" data-id="${x.id}" aria-label="Payslip or proof">${ico("clip")}${n ? ` ${n}` : ""}</button>` : ""}${mine ? `<button type="button" class="mini" data-ln="edit" data-id="${x.id}">Edit</button>` : ""}</span>` : ""}
  </div>`;
}

function incomeForm() {
  const f = form, mine = sources(ctx.incomes(), ctx.me());
  return `<div class="lpbform lnform" data-form="income">
    <fieldset id="lnFields"${f.saving ? " disabled" : ""}>
      <h3>${f.id ? "Edit income" : "Add income"}</h3>
      ${f.id ? "" : `<div class="lnimport" id="lnImport">${documentPanel(f)}</div>`}
      <div class="chips" role="group" aria-label="Income type">${INCOME_KINDS.map((k) => `<button type="button" class="chip" data-lnkind="${k.id}" aria-pressed="${k.id === f.kind}">${ico(k.icon)} ${esc(k.name)}</button>`).join("")}</div>
      ${incomeKind(f.kind).hint ? `<p class="note">${esc(incomeKind(f.kind).hint)}</p>` : ""}
      <div class="two">
        <label>Amount received (RM)<input type="text" id="lnAmt"${f.suggested.has("amount") ? " data-suggested" : ""} inputmode="decimal" autocomplete="off" placeholder="2500.00" value="${esc(f.amount)}"></label>
        <label>Date received<input type="date" id="lnDate"${f.suggested.has("date") ? " data-suggested" : ""} value="${esc(f.date)}"></label>
      </div>
      <label>From<input type="text" id="lnFrom"${f.suggested.has("from") ? " data-suggested" : ""} list="lnFromList" maxlength="${FROM_MAX}" autocomplete="off" placeholder="${f.kind === "side" ? "Buyer or platform" : "Employer or payer"}" value="${esc(f.from)}"></label>
      <datalist id="lnFromList">${mine.map((s) => `<option value="${esc(s)}"></option>`).join("")}</datalist>
      <details class="lnnote"${f.note ? " open" : ""}>
        <summary>${f.note ? "Note" : "Add note"}</summary>
        <label class="sr" for="lnNote">Note</label><input type="text" id="lnNote" maxlength="${NOTE_MAX}" autocomplete="off" value="${esc(f.note)}">
      </details>
      <div class="actions"><button type="button" class="primary" data-ln="save">Save income</button><button type="button" data-ln="cancel">Cancel</button>${f.id ? `<button type="button" class="mini" data-ln="del" data-id="${f.id}">Delete</button>` : ""}</div>
    </fieldset>
    <p class="msg" id="lnMsg" aria-live="polite">${esc(f.err ?? "")}</p>
  </div>`;
}

function documentPanel(f) {
  return `<div class="lnimporthead">
    ${f.file ? `<b class="lnfilename">${ico("file")} ${esc(f.file.name)}</b>
      <div class="lbtnrow">${f.preview ? `<a class="btn mini" href="${esc(f.preview)}" target="_blank" rel="noopener">Preview</a>` : ""}
        <button type="button" class="mini" data-ln="remove-pdf">Remove</button></div>`
    : `<button type="button" class="mini" data-ln="pick-pdf">${ico("file")} Fill from document</button><span class="note">Optional &middot; Payslip PDF</span>
        <input type="file" id="lnPdf" accept="application/pdf,.pdf" hidden>`}
  </div>
  ${f.file && docsOn() ? `<label class="lnkeep"><input type="checkbox" id="lnKeep"${f.keep ? " checked" : ""}> Keep a copy in OneDrive</label>` : ""}
  <p class="note lnimportmsg" role="status">${esc(f.pdfStatus ?? "")}</p>`;
}

function renderDocument(f, focus) {
  const panel = $("lnImport");
  if (!panel) return;
  panel.innerHTML = documentPanel(f);
  if (focus) panel.querySelector(focus)?.focus({ preventScroll: true });
}

function setPdfValue(f, field, value) {
  if (f.edited.has(field)) return false;
  f[field] = value;
  const input = $(PDF_FIELDS[field]);
  input.value = value;
  if (value) f.suggested.add(field);
  else f.suggested.delete(field);
  input.toggleAttribute("data-suggested", Boolean(value));
  return Boolean(value);
}

function clearDocument(f) {
  if (f.preview) URL.revokeObjectURL(f.preview);
  f.file = f.preview = f.pdfStatus = null;
  f.keep = false;
}

async function readPayslip(file) {
  const f = form;
  if (!f || f.saving || f.file) return;
  const header = await file.slice(0, 1024).text().catch(() => "");
  if (form !== f || f.file || f.saving) return;
  if (!header.includes("%PDF-")) {
    f.pdfStatus = "Choose a payslip PDF.";
    renderDocument(f, '[data-ln="pick-pdf"]');
    return;
  }
  $("ledgerIncome").querySelector("[data-form]")?.setAttribute("data-dirty", "1");
  f.file = file;
  f.preview = URL.createObjectURL(new Blob([file], { type: "application/pdf" }));
  f.beforePdf = { amount: f.amount, date: f.date, from: f.from };
  f.pdfStatus = "Reading payslip on this device…";
  renderDocument(f, '[data-ln="remove-pdf"]');
  // Require a receipt date when the document only gives a pay period.
  setPdfValue(f, "date", "");
  try {
    const pdf = await openLocalPdf(file);
    const lines = [];
    try {
      for (let page = 1; page <= pdf.numPages && f.file === file && form === f; page++) {
        lines.push(...pageLines((await (await pdf.getPage(page)).getTextContent()).items));
      }
    } finally {
      await pdf.destroy();
    }
    if (form !== f || f.file !== file || f.saving) return;
    const parsed = payslipFields(lines);
    const filled = Object.keys(parsed).filter((field) =>
      parsed[field] && setPdfValue(f, field, field === "from" ? parsed.from.slice(0, FROM_MAX) : parsed[field]));
    const review = filled.length
      ? `Check suggested ${filled.map((field) => FIELD_NAMES[field]).join(", ")} before saving.`
      : "No fields filled. Enter the payment details below.";
    f.pdfStatus = filled.length && !f.date ? `${review} Enter the date you received the payment.` : review;
  } catch (error) {
    if (form !== f || f.file !== file || f.saving) return;
    f.pdfStatus = error?.name === "PasswordException"
      ? "This PDF is password-protected. Enter the payment details below."
      : "Couldn't read this PDF. Enter the payment details below.";
  }
  const status = $("lnImport")?.querySelector("[role=status]");
  if (status) status.textContent = f.pdfStatus;
}

function removePayslip(f) {
  for (const field of Object.keys(PDF_FIELDS)) {
    if (!f.edited.has(field)) {
      f[field] = f.beforePdf[field];
      $(PDF_FIELDS[field]).value = f[field];
    }
    $(PDF_FIELDS[field]).removeAttribute("data-suggested");
  }
  f.suggested.clear();
  clearDocument(f);
  renderDocument(f, '[data-ln="pick-pdf"]');
}

function open(id = null) {
  const x = id ? ctx.incomes().find((y) => y.id === id) : null;
  if (x && !canEdit(x.person)) { msg = ""; return; }
  const last = lastIncome(ctx.incomes(), ctx.me());
  form = x ? { id, kind: x.kind, amount: (x.amountSen / 100).toFixed(2), date: x.date, from: x.from ?? "", note: x.note ?? "" }
    : { id: null, kind: last?.kind ?? "salary", amount: "", date: today(), from: last?.from ?? "", note: "" };
  form.edited = new Set();
  form.suggested = new Set();
  msg = ""; renderIncome();
  $("ledgerIncome").scrollIntoView({ block: "nearest" });
  $("lnAmt")?.focus({ preventScroll: true });
}
const clearDirty = () => { const d = $("ledgerIncome").querySelector("[data-form]"); if (d) delete d.dataset.dirty; };
function closeForm() { if (form) clearDocument(form); form = null; clearDirty(); renderIncome(); }

async function save() {
  const f = form; if (!f || f.saving) return;
  const old = f.id ? ctx.incomes().find((y) => y.id === f.id) : null;
  const r = checkIncome({ person: old?.person ?? ctx.me(), date: f.date, kind: f.kind, from: f.from, note: f.note, amountSen: toSen(f.amount) });
  if (!r.ok) { f.err = r.error; $("lnMsg").textContent = r.error; return; }
  const now = Date.now(), ref = old ? doc(ctx.db(), "ledgerIncome", old.id) : doc(collection(ctx.db(), "ledgerIncome"));
  const body = { ...r.income, docs: old?.docs ?? [], at: old?.at ?? now, created: old?.created ?? now, updated: now };
  const what = `${incomeKind(r.income.kind).name} ${rm(r.income.amountSen)}`;
  f.saving = true;
  $("lnFields").disabled = true;
  $("ledgerIncome").querySelector("[data-form]")?.setAttribute("data-dirty", "1");
  const file = f.keep && docsOn() ? f.file : null;
  try {
    await ctx.commit(() => old
      ? updateDoc(ref, { ...r.income, note: r.income.note ?? "", updated: now })
      : setDoc(ref, body), `${what} ${old ? "saved" : "added"}.`);
    clearDocument(f); form = null; clearDirty(); flash = { id: ref.id, at: Date.now() };
    msg = file || old || !docsOn() ? "" : `Saved. Tap the paperclip on it to add the ${r.income.kind === "salary" || r.income.kind === "parttime" ? "payslip" : "proof"} now or later.`;
    renderIncome();
    if (file) openDocs(incomeEntry({ ...body, id: ref.id }), file);
  } catch (_) {
    if (form === f) {
      f.saving = false;
      $("lnFields").disabled = false;
    }
  }
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

// The paperclip sheet's entry for an income (docsui.js): salary and part-time go to Payslips, the rest to Income.
export function incomeEntry(x) {
  const k = incomeKind(x.kind), names = people();
  return { coll: "ledgerIncome", id: x.id, kind: k.folder, date: x.date, what: x.from || "", amountSen: x.amountSen,
    person: names[x.person] ?? "", docs: x.docs, canEdit: canEdit(x.person), title: `${k.name}${x.from ? ` · ${x.from}` : ""} · ${rm(x.amountSen)} · ${shortDate(x.date)}` };
}

function click(b) {
  if (form?.saving) return;
  if (b.dataset.lnkind && form) { form.kind = b.dataset.lnkind; const dirty = $("ledgerIncome").querySelector("[data-form]")?.dataset.dirty; clearDirty(); renderIncome(); if (dirty) $("ledgerIncome").querySelector("[data-form]")?.setAttribute("data-dirty", "1"); return; }
  const a = b.dataset.ln, id = b.dataset.id; if (!a) return;
  if (a === "new") open();
  if (a === "pick-pdf") $("lnPdf")?.click();
  if (a === "remove-pdf" && form?.file) removePayslip(form);
  if (a === "edit") open(id);
  if (a === "cancel") closeForm();
  if (a === "save") save();
  if (a === "del") remove(id);
  if (a === "docs") { const x = ctx.incomes().find((y) => y.id === id); if (x) openDocs(incomeEntry(x)); }
}
