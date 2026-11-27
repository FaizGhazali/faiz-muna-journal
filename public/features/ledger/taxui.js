import { collection, doc, setDoc, updateDoc, deleteDoc } from "../../core/fs.js";
import { $, esc } from "../../core/util.js";
import { canEdit } from "../../core/owner.js";
import { confirmDelete } from "../../core/confirm.js";
import { rm, shortDate } from "../../logic/ledger.js";
import { EA_FIELDS, RELIEFS, employerKey, inputAmount, readAmounts, taxCsv, taxOverview } from "../../logic/tax.js";
import { docsOn, openDocs } from "./docsui.js";

export const TAX = "#ledger/tax";

const RELIEF_FIELDS = [["amount", "Recorded amount"]];
let ctx, owner, person, year, tab = "overview", draft, busy = false;
const page = () => $("ledgerTax");
const report = () => taxOverview(ctx.incomes(), ctx.taxRecords(), person, year);
const cash = (item) => item?.count ? rm(item.amount) : "Not entered";

export function initTax(context) {
  ctx = context;
  page().addEventListener("click", (event) => {
    const button = event.target.closest("button[data-tax]");
    if (button && !busy) act(button);
  });
  page().addEventListener("change", (event) => {
    if (event.target.id === "taxPerson") person = event.target.value;
    else if (event.target.id === "taxYear") year = event.target.value;
    else return;
    renderTax();
  });
  page().addEventListener("submit", (event) => {
    event.preventDefault();
    if (draft && !busy) save(new FormData(event.target), event.target);
  });
  addEventListener("hashchange", () => {
    const entering = location.hash === TAX;
    if (!entering && !busy) draft = null;
    refreshTax();
    if (entering) {
      scrollTo({ top: 0 });
      $("ledgerTaxTitle")?.focus({ preventScroll: true });
    }
  });
}

export function refreshTax() {
  const active = location.hash === TAX;
  $("ledger").classList.toggle("taxpage", active);
  if (!active || !ctx.people().length || draft || busy) return;
  const signedIn = ctx.me() || ctx.people()[0].id;
  if (!person || signedIn !== owner) {
    owner = person = signedIn;
    year = ctx.today().slice(0, 4);
    tab = "overview";
  }
  renderTax();
}

function button(action, label, attrs = "") {
  return `<button type="button" class="mini" data-tax="${action}" ${attrs}>${esc(label)}</button>`;
}
const metric = (label, item) => `<div><span class="note">${label}</span><strong>${cash(item)}</strong></div>`;
const select = (id, label, items, value) => `<label>${label}<select id="${id}">${items.map(([key, name]) =>
  `<option value="${esc(key)}"${key === value ? " selected" : ""}>${esc(name)}</option>`).join("")}</select></label>`;

function renderTax() {
  const current = Number(ctx.today().slice(0, 4));
  const years = [...new Set([year, ...Array.from({ length: 8 }, (_, i) => String(current - i)),
    ...ctx.incomes().map((item) => item.date.slice(0, 4)), ...ctx.taxRecords().map((item) => item.year)])].sort().reverse();
  const data = report();
  if (location.hash !== TAX) return;
  page().innerHTML = `<div class="taxsheet">
    <div class="lhead taxheading">
      <a class="btn mini" href="#ledger">← Ledger</a>
      <a class="btn mini" href="#ledger/analytics">Analytics</a>
    </div>
    <h2 id="ledgerTaxTitle" tabindex="-1">Income Tax</h2>
    ${draft ? editForm(data) : `
      <div class="taxfilters">
        ${select("taxPerson", "Person", ctx.people().map((p) => [p.id, p.name]), person)}
        ${select("taxYear", "Year of Assessment", years.map((y) => [y, y]), year)}
      </div>
      <nav class="chips" aria-label="Income tax sections">
        ${[["overview", "Year overview"], ["ea", "Compare EA"], ["relief", "Relief checklist"]].map(([key, label]) =>
          button(key, label, `aria-pressed="${tab === key}"`)).join("")}
      </nav>
      ${tab === "ea" ? compare(data) : tab === "relief" ? reliefs(data) : tab === "payroll" ? payrollHistory(data) : overview(data)}
      <div class="actions">${button("export", "Export CSV")}</div>
    `}
    <p id="taxMsg" class="msg" role="status"></p>
  </div>`;
}

function overview(data) {
  const { totals, payroll, employers, otherIncome } = data;
  const flags = employers.flatMap((group) =>
    group.comparison.filter((row) => row.difference).map((row) => [group.name, row]));
  const missing = employers.filter((group) => group.payslips.length && !group.ea);
  const partial = payroll.length && EA_FIELDS.some(([key]) => totals[key].count < payroll.length);
  return `<div class="taxmetrics">${metric("Gross pay logged", totals.gross)}${metric("PCB withheld", totals.pcb)}</div>
    <p class="note">${payroll.length} payroll ${payroll.length === 1 ? "entry" : "entries"} by calendar year of Date received.</p>
    ${payroll.length ? `<div class="actions">${button("payroll", "Review payroll entries")}</div>` : ""}
    <section class="taxgroup"><h3>Needs review</h3>
      ${flags.length || missing.length || partial ? `<ul class="taxreview">
        ${flags.map(([name, row]) => `<li><b>${esc(row.label)} differs by ${rm(Math.abs(row.difference))}</b><span>${esc(name)} · EA ${rm(row.declared)} · Payslips ${cash(row.logged)}</span></li>`).join("")}
        ${missing.map((group) => `<li><b>EA form pending</b><span>${esc(group.name)}</span></li>`).join("")}
        ${partial ? "<li><b>Some payroll fields are missing</b><span>Open Income to complete the payroll details on existing entries.</span></li>" : ""}
      </ul>` : `<p class="note">${payroll.length ? "No differences flagged in the available comparisons." : "Add employment income and payroll details to start this year."}</p>`}
    </section>
    <section class="taxgroup"><h3>Payroll contributions</h3>
      <dl class="taxlines">${[["epf", "Employee EPF"], ["socso", "Employee SOCSO"], ["eis", "Employee EIS"]].map(([key,label]) =>
        `<div><dt>${label}</dt><dd>${cash(totals[key])}</dd></div>`).join("")}</dl>
    </section>
    ${otherIncome.length ? `<p class="note">${otherIncome.length} other income ${otherIncome.length === 1 ? "entry" : "entries"} included in the export for review.</p>` : ""}`;
}

function payrollHistory(data) {
  return `<section class="taxgroup"><h3>Payroll entries</h3><dl class="taxlines">
    ${[...data.payroll].sort((a,b) => b.date.localeCompare(a.date)).map((item) => `<div>
      <dt>${esc(item.from || "Employer not entered")} <small>${esc(shortDate(item.date))}${item.payroll?.period ? ` · Pay period ${esc(item.payroll.period)}` : ""}</small></dt>
      <dd>${rm(item.amountSen)} ${canEdit(person) ? button("edit-income", "Edit", `data-id="${esc(item.id)}"`) : ""}
      ${docsOn() && item.docs?.length ? button("income-docs", "Payslip", `data-id="${esc(item.id)}"`) : ""}</dd>
    </div>`).join("")}
  </dl></section>`;
}

function compare(data) {
  return `<p class="note">Enter each employer's EA totals as printed. Payroll totals may differ from EA remuneration. Check benefits, adjustments, and missing payslips before filing.</p>
    ${canEdit(person) ? `<div class="actions">${button("new-ea", "Add EA form")}</div>` : ""}
    ${data.employers.map((group) => `<section class="taxgroup">
      <div class="mhead"><h3>${esc(group.name)}</h3><span class="note">${group.payslips.length} payroll ${group.payslips.length === 1 ? "entry" : "entries"}</span></div>
      <div class="taxtable"><table><thead><tr><th scope="col">Item</th><th scope="col">Payslips</th><th scope="col">EA</th><th scope="col">Review</th></tr></thead>
        <tbody>${group.comparison.map((row) => `<tr>
          <th scope="row">${row.label}</th><td>${cash(row.logged)}${row.logged?.count < group.payslips.length ? `<small>${row.logged.count}/${group.payslips.length} entered</small>` : ""}</td>
          <td>${row.declared == null ? "—" : rm(row.declared)}</td>
          <td>${row.difference == null ? "Incomplete" : row.difference ? `<b class="taxdiff">${row.difference > 0 ? "+" : "−"}${rm(Math.abs(row.difference))}</b>` : "Match"}</td>
        </tr>`).join("")}</tbody></table></div>
      <div class="actions">${canEdit(person) ? button(group.ea ? "edit" : "new-ea", group.ea ? "Edit EA totals" : "Enter EA totals",
        group.ea ? `data-id="${esc(group.ea.id)}"` : `data-name="${esc(group.name === "Employer not entered" ? "" : group.name)}"`) : ""}
        ${group.ea ? docButton(group.ea) : ""}</div>
    </section>`).join("") || '<p class="note">No employers recorded for this year.</p>'}`;
}

function docButton(item) {
  const n = item.docs?.length || 0;
  return docsOn() && (canEdit(item.person) || n) ? button("docs", n ? `Attachments (${n})` : "Attach document", `data-id="${esc(item.id)}"`) : "";
}

function reliefs(data) {
  return `<p class="note">Record amounts and evidence for review. Check eligibility and limits for YA ${esc(year)} before filing.</p>
    <dl class="taxlines">
      <div><dt>Employee EPF recorded in payroll</dt><dd>${cash(data.totals.epf)}</dd></div>
      <div><dt>Employee SOCSO + EIS recorded in payroll</dt><dd>${cash(data.totals.social)}</dd></div>
    </dl>
    <div class="actions">${canEdit(person) ? button("new-relief", "Add relief evidence") : ""}</div>
    ${data.reliefs.map((item) => `<section class="taxgroup">
      <div class="mhead"><h3>${esc(item.name)}</h3><span class="note">${item.checked ? "Reviewed" : "To review"}</span></div>
      <p class="note">${esc(item.category)} · ${item.amounts?.amount == null ? "Amount not entered" : rm(item.amounts.amount)}</p>
      <div class="actions">${canEdit(person) ? button("edit", "Edit", `data-id="${esc(item.id)}"`) : ""}${docButton(item)}</div>
    </section>`).join("") || '<p class="note">No additional relief evidence recorded.</p>'}`;
}

function editForm(data) {
  const ea = draft.taxType === "ea";
  const names = ea ? `<datalist id="taxEmployers">${data.employers.filter((item) => item.name !== "Employer not entered").map((item) =>
    `<option value="${esc(item.name)}"></option>`).join("")}</datalist>` : "";
  return `<form id="taxForm">
    <h3>${ea ? "EA form totals" : "Relief evidence"}</h3>
    <label>${ea ? "Employer" : "Description"}<input type="text" name="name" required maxlength="100" value="${esc(draft.name || "")}"${ea ? ' list="taxEmployers"' : ""}></label>
    ${names}
    ${ea ? "" : `<label>Category<select name="category">${RELIEFS.map((label) =>
      `<option${draft.category === label ? " selected" : ""}>${esc(label)}</option>`).join("")}</select></label>`}
    <div class="lnpayfields">${(ea ? EA_FIELDS : RELIEF_FIELDS).map(([key, label]) =>
      `<label>${label} (RM)<input type="text" name="${key}" inputmode="decimal" autocomplete="off" value="${inputAmount(draft.amounts?.[key])}"></label>`).join("")}</div>
    ${ea ? "" : `<label class="taxcheck"><input type="checkbox" name="checked"${draft.checked ? " checked" : ""}> Reviewed for filing</label>`}
    <div class="actions"><button class="primary" type="submit">Save</button>${button("back", "Cancel")}${draft.id ? button("delete", "Delete") : ""}</div>
  </form>`;
}

export function taxDocEntry(item) {
  const name = ctx.people().find((p) => p.id === item.person)?.name || "";
  return { coll: "ledgerIncome", id: item.id, kind: item.taxType === "ea" ? "ea" : "relief",
    date: `${item.year}-01-01`, what: item.name, person: name, docs: item.docs,
    title: `YA ${item.year} · ${item.name}`, canEdit: canEdit(item.person) };
}

function act(control) {
  const action = control.dataset.tax;
  if (action === "export") return exportCsv();
  if (["overview", "ea", "relief", "payroll"].includes(action)) tab = action;
  if (action === "edit-income" || action === "income-docs") {
    const item = report().payroll.find((row) => row.id === control.dataset.id);
    if (!item) return;
    if (action === "income-docs") return openDocs(ctx.incomeEntry(item));
    if (canEdit(person)) {
      location.hash = "#ledger";
      requestAnimationFrame(() => ctx.openIncome(item.id));
    }
    return;
  }
  if (action === "new-ea" && canEdit(person)) draft = { taxType: "ea", name: control.dataset.name };
  if (action === "new-relief" && canEdit(person)) draft = { taxType: "relief" };
  if (action === "back") draft = null;
  if (action === "delete") return remove();
  if (["edit", "docs"].includes(action)) {
    const item = ctx.taxRecords().find((row) => row.id === control.dataset.id && row.person === person && row.year === year);
    if (!item) return;
    if (action === "docs") return openDocs(taxDocEntry(item));
    if (canEdit(person)) draft = item;
  }
  renderTax();
  if (draft) $("taxForm").elements.name.focus();
}

async function save(values, form) {
  if (!canEdit(person)) return;
  const ea = draft.taxType === "ea", name = String(values.get("name")).trim();
  if (!name) { $("taxMsg").textContent = "Enter a name."; return; }
  const { amounts, error } = readAmounts(ea ? EA_FIELDS : RELIEF_FIELDS, Object.fromEntries(values));
  if (error) { $("taxMsg").textContent = error; return; }
  if (ea && ctx.taxRecords().some((item) => item.taxType === "ea" && item.year === year && item.person === person &&
    item.id !== draft.id && employerKey(item.name) === employerKey(name))) {
    $("taxMsg").textContent = "An EA record already exists for this employer. Open it to edit.";
    return;
  }
  const data = { person, year, taxType: draft.taxType, name, amounts, updated: Date.now(),
    ...(ea ? {} : { category: String(values.get("category")), checked: values.has("checked") }) };
  const id = draft.id || (ea ? `ea-${person}-${year}-${encodeURIComponent(employerKey(name))}` : null);
  const ref = id ? doc(ctx.db(), "ledgerIncome", id) : doc(collection(ctx.db(), "ledgerIncome"));
  busy = true;
  form.querySelector('button[type="submit"]').disabled = true;
  try {
    await ctx.commit(() => draft.id ? updateDoc(ref, data) : setDoc(ref, data, { merge: true }), "Saved.");
    draft = null;
    renderTax();
  } catch (_) {
    $("taxMsg").textContent = "Couldn't save. Try again.";
    form.querySelector('button[type="submit"]').disabled = false;
  } finally { busy = false; }
}

async function remove() {
  if (!draft?.id || !canEdit(person)) return;
  const item = draft;
  if (!await confirmDelete({ title: `Delete ${item.name}?`, body: "<p>Files already uploaded stay in OneDrive.</p>" }) || draft !== item) return;
  busy = true;
  try {
    await ctx.commit(() => deleteDoc(doc(ctx.db(), "ledgerIncome", item.id)), "Deleted.");
    draft = null;
    renderTax();
  } catch (_) { $("taxMsg").textContent = "Couldn't delete this record."; }
  finally { busy = false; }
}

function exportCsv() {
  const name = ctx.people().find((p) => p.id === person)?.name || "";
  const url = URL.createObjectURL(new Blob(["\ufeff", taxCsv(report(), year, name)], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `Ledger-Income-Tax-${year}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
