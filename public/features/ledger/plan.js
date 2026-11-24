// Ledger: the money plan at the top of #ledger (#ledgerPlan): where this month's income goes, what's
// left to spend (and per day), the plan's buckets and this month's bills to tick off (the next 12 months
// moved to the Analytics page, analytics.js). Each is a card on the Ledger board (shell/board.js) with a small, medium and
// large version (sizeOf); a form always shows large (data-force). Bills are ticked by hand
// ("Typed"); a statement import can later mark them checked. All maths is in logic/moneyplan.js.
import { collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch } from "../../core/fs.js";
import { $, esc, lastUsed } from "../../core/util.js";
import { confirmDelete } from "../../core/confirm.js";
import { openDocs, docsOn } from "./docsui.js";
import { monthIncome } from "../../logic/income.js";
import { rm, toSen, shortDate } from "../../logic/ledger.js";
import {
  DEFAULT_BUCKETS, DEFAULT_PAY_DAY, PAY_DAY_MAX, bucketsOf, checkPlan, planView, checkCommitment, paidRecord, paidKey,
  monthOf, monthName, liveIn, payOf, billTasks,
} from "../../logic/moneyplan.js";

// Each default bucket keeps one colour slot from the chart palette (--s1…--s8); added buckets take the free ones.
const SLOT = { essentials: 1, fun: 4, debt: 8, savings: 3, invest: 7 };
const SPARE = [2, 5, 6];

let ctx, plan = null, commitments = [], paid = {};
// What's open: "plan" (editing the plan), "bill:<id>" / "bill:new" (a bill form), manage (all bills listed).
let editing = null, manage = false, sumMsg = "", billMsg = "";
// The bill row just saved glows (great-ux: stay put and show the change); kept so a live redraw carries it on.
const GLOW_MS = 1800;
let glow = null; // { id, at }

const colourOf = (buckets) => {
  const out = {}; let spare = 0;
  for (const b of buckets) out[b.id] = `var(--s${SLOT[b.id] ?? SPARE[spare++ % SPARE.length]})`;
  return out;
};

// For the bucket spending page (spend.js): the live plan, bills and ticks, and each bucket's colour.
export const planState = () => ({ plan, commitments, paid });
export const bucketColours = () => colourOf(bucketsOf(plan));

// For "Your next move" (activities.js, through app.js): debt bills due soon, and ticking one from there.
export const billsDue = (day = ctx?.today()) => (ctx ? billTasks(commitments, paid, day, payOf(plan)) : []);
export async function payBill(id, month, ok) {
  const c = commitments.find((x) => x.id === id); if (!c) return;
  await ctx.commit(() => setDoc(doc(ctx.db(), "ledgerPaid", paidKey(id, month)), paidRecord(c, { month, date: ctx.today(), by: ctx.me(), at: Date.now() })), ok);
}
// Only Undo right after "Paid" on the card uses this, so it doesn't ask again.
export const undoPayBill = (id, month) => ctx.commit(() => deleteDoc(doc(ctx.db(), "ledgerPaid", paidKey(id, month))));

export function initPlan(c) {
  ctx = c;
  const host = $("ledgerPlan");
  host.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) click(b); });
  host.addEventListener("input", (ev) => { if (ev.target.closest("[data-form]")) ev.target.closest("[data-form]").dataset.dirty = "1"; if (ev.target.dataset.pct != null) paintSum(); });
}
// Live data: returns the unsubscribe functions for ledgerui's list.
export function planSubs(db) {
  const redraw = () => { renderPlan(); ctx.planChanged?.(); ctx.billsChanged?.(); };
  return [
    onSnapshot(doc(db, "ledgerPlan", "main"), (s) => { plan = s.exists() ? s.data() : null; redraw(); }),
    onSnapshot(collection(db, "ledgerCommitments"), (s) => { commitments = s.docs.map((d) => ({ id: d.id, ...d.data() })); redraw(); }),
    onSnapshot(collection(db, "ledgerPaid"), (s) => { paid = Object.fromEntries(s.docs.map((d) => [d.id, { id: d.id, ...d.data() }])); redraw(); }),
  ];
}

export function renderPlan() {
  const host = $("ledgerPlan"); if (!host || !ctx.people().length) return;
  // A form someone has started typing in isn't redrawn by the other phone's changes.
  if (host.querySelector("[data-form][data-dirty]")) return;
  const day = ctx.today(), v = planView({ plan, commitments, paid, txns: ctx.txns(), day, incomeSen: realIncome(day).totalSen });
  const size = (id) => ctx.board.sizeOf(id);
  const sumForm = !plan || editing === "plan", billOpen = editing?.startsWith("bill:") || manage;
  host.innerHTML = `
    <section class="panel lpsum" data-card="sum" data-title="Money plan" aria-labelledby="lpTitle"${sumForm ? ` data-force="l"` : ""}>${sumForm ? planForm() : summary(v, size("sum"))}</section>
    ${plan ? `<section class="panel lpbills" data-card="bills" data-title="Bills this month" aria-labelledby="lpbTitle"${billOpen ? ` data-force="l"` : ""}>${bills(v, billOpen ? "l" : size("bills"))}</section>` : ""}`;
}

// The month's real income (logged salaries and extras; the plan's until a salary is logged), logic/income.js.
export function realIncome(day = ctx.today()) {
  const pay = payOf(plan);
  return monthIncome(ctx.incomes(), plan?.incomeSen ?? 0, monthOf(day, pay), pay);
}

// ---------- where the money goes ----------
function summary(v, size = "l") {
  const col = colourOf(v.buckets), used = v.buckets.filter((b) => b.usedSen > 0);
  const over = v.freeSen < 0, end = shortDate(v.to);
  const left = `${rm(Math.abs(v.freeSen), { whole: true })}`, label = over ? "Over your income by" : "Can still spend";
  if (size === "s") return ctx.board.tile("sum", `<small id="lpTitle">${label}</small><b class="bdbig${over ? " over" : ""}">${left}</b><small>${over ? `in ${esc(v.label)}` : `${rm(v.perDaySen, { whole: true })} a day`}</small>`, label);
  // Medium (the family's favourite, 24 Nov 2026): the ring and where each ringgit went; Large adds the rest.
  const top = `<div class="lhead"><h2 id="lpTitle">Where ${rm(v.incomeSen, { whole: true })} goes</h2><span class="note">${esc(v.label)}</span>
      <span class="lbtnrow"><button type="button" class="mini" data-lp="edit-plan">Edit plan</button>${ctx.board.less("sum")}</span></div>
    <div class="lpring">
      ${ring(v, used, col, over)}
      <ul class="lpleg">${used.map((b) => `<li><a href="#ledger/spend/${b.id}"><span class="dot" style="--c:${col[b.id]}"></span><span>${esc(b.name)}</span><b>${rm(b.usedSen, { whole: true })}</b></a></li>`).join("")}${over ? "" : `<li><span class="dot free"></span><span>Free</span><b>${rm(v.freeSen, { whole: true })}</b></li>`}</ul>
    </div>`;
  if (size === "m") return `${top}<p class="note">${over ? "" : `${rm(v.perDaySen, { whole: true })} a day to ${end}. `}${ctx.board.more("sum", "See your plan")}</p>`;
  return `${top}
    <div class="lpleft">
      <div><small>${over ? "Over your income by" : "Can still spend"}</small><b class="${over ? "over" : ""}">${rm(Math.abs(v.freeSen), { whole: true })}</b></div>
      ${over ? "" : `<div><small>a day, to ${end}</small><b class="sm">${rm(v.perDaySen, { whole: true })}</b></div>`}
    </div>
    <p class="note">${realIncome().fromPlan ? `Income from your plan until a salary is logged in Income.` : `Income is what you logged this month${realIncome().salaries.some((s) => s.expected) ? " (last month's salary until this month's is in)" : ""}.`} Bills ${rm(v.committedSen, { whole: true })} (${v.sharePct}% of income) · spent day to day ${rm(v.spentSen, { whole: true })}</p>
    <h3 class="lph">Your plan <span class="note">tap one to see what it went on</span></h3>
    <div class="lprows">${v.buckets.map((b) => `<a class="lprow" href="#ledger/spend/${b.id}" aria-label="${esc(b.name)}: see what it went on">
      <span class="dot" style="--c:${col[b.id]}"></span>
      <span class="lpname">${esc(b.name)} <small>${b.pct}%</small>${b.overSen ? ` <span class="lpover">+${rm(b.overSen, { whole: true })} over</span>` : ""}</span>
      <span class="lpamt${b.overSen ? " over" : ""}">${rm(b.usedSen, { whole: true })} <small>/ ${rm(b.planSen, { whole: true })}</small></span>
      <span class="lbarbg thin"><i style="width:${b.planSen ? Math.min(100, Math.round((b.usedSen / b.planSen) * 100)) : b.usedSen ? 100 : 0}%;--c:${b.overSen ? "var(--obese)" : col[b.id]}"></i></span>
    </a>`).join("")}<a class="lpall" href="#ledger/spend/all">Search all spending →</a></div>
    <p class="note">Day-to-day spending from Ledger counts too: dining and shopping as ${esc(v.buckets.find((b) => b.id === "fun")?.name ?? "Fun")}, the rest as ${esc(v.buckets.find((b) => b.id === "essentials")?.name ?? v.buckets[0].name)}. PayLater on a card is left out, since it's a bill here.</p>`;
}

// The income ring: one arc per bucket's use this month, starting at the top and going clockwise; the
// grey track left over is what's free. Over the income, the arcs share the whole ring.
// The circle's radius makes its length 100, so each arc's dash is simply its percentage.
const R = 15.915, GAP = 0.8;
function ring(v, used, col, over) {
  const total = Math.max(v.incomeSen, v.committedSen + v.spentSen, 1);
  let at = 0;
  const arcs = used.map((b) => {
    const len = (b.usedSen / total) * 100, dash = Math.max(len - (used.length > 1 || !over ? GAP : 0), 0.3);
    const arc = `<circle cx="21" cy="21" r="${R}" class="arc" style="--c:${col[b.id]}" stroke-dasharray="${dash.toFixed(2)} ${(100 - dash).toFixed(2)}" stroke-dashoffset="${(25 - at).toFixed(2)}"></circle>`;
    at += len;
    return arc;
  }).join("");
  return `<svg class="lpdonut" viewBox="0 0 42 42" role="img" aria-label="${used.map((b) => `${esc(b.name)} ${rm(b.usedSen, { whole: true })}`).join(", ")}${over ? `, ${rm(-v.freeSen, { whole: true })} over income` : `, free ${rm(v.freeSen, { whole: true })}`}">
    <circle cx="21" cy="21" r="${R}" class="track"></circle>${arcs}
    <text x="21" y="20.5" class="big${over ? " over" : ""}">${rm(Math.abs(v.freeSen), { whole: true })}</text>
    <text x="21" y="26" class="small">${over ? "over" : "left"}</text>
  </svg>`;
}

// The plan form: first run (defaults from the family's sheet) or "Edit plan".
function planForm() {
  const bs = bucketsOf(plan), first = !plan;
  return `<div data-form="plan">
    <h2 id="lpTitle">${first ? "Plan your month" : "Edit your plan"}</h2>
    ${first ? `<p class="note">Split your monthly income into buckets, then add your bills. Ledger shows what's left to spend each month and when each instalment ends.</p>` : ""}
    <div class="two">
      <label>Usual monthly income, RM<input type="text" id="lpIncome" inputmode="decimal" autocomplete="off" placeholder="4000" value="${plan ? (plan.incomeSen / 100).toFixed(2).replace(/\.00$/, "") : ""}"></label>
      <label>Payday <small>your month starts here</small><input type="number" id="lpPayDay" min="1" max="${PAY_DAY_MAX}" step="1" inputmode="numeric" value="${payOf(plan)}"></label>
    </div>
    <p class="note">Your money month runs from payday to the day before the next one (use 1 for calendar months). Once you log salaries in Income, the real amounts are used instead of this one.</p>
    <div class="lpform">${bs.map((b, i) => `<div class="lpfrow">
      <input type="text" data-name="${i}" value="${esc(b.name)}" aria-label="Bucket name" maxlength="30">
      <label class="lppct"><input type="number" data-pct="${i}" min="0" max="100" step="1" inputmode="numeric" value="${b.pct}" aria-label="${esc(b.name)} percent">%</label>
    </div>`).join("")}</div>
    <p class="note" id="lpSum"></p>
    <div class="actions"><button type="button" class="primary" data-lp="save-plan">Save plan</button>${first ? "" : `<button type="button" data-lp="cancel">Cancel</button>`}${first ? "" : `<button type="button" class="mini" data-lp="reset-plan">Use 55 · 5 · 10 · 15 · 15</button>`}</div>
    <p class="msg" aria-live="polite">${esc(sumMsg)}</p>
  </div>`;
}
const pctInputs = () => [...document.querySelectorAll("#ledgerPlan [data-pct]")];
function paintSum() {
  const el = $("lpSum"); if (!el) return;
  const sum = pctInputs().reduce((s, i) => s + (Number(i.value) || 0), 0);
  el.textContent = sum === 100 ? "Adds up to 100%." : `Adds up to ${sum}%: make it 100%.`;
  el.classList.toggle("over", sum !== 100);
}
async function savePlan() {
  const bs = bucketsOf(plan);
  const buckets = bs.map((b, i) => ({ id: b.id, name: document.querySelector(`#ledgerPlan [data-name="${i}"]`).value, pct: Number(document.querySelector(`#ledgerPlan [data-pct="${i}"]`).value), ...(b.about ? { about: b.about } : {}) }));
  const r = checkPlan({ incomeSen: toSen($("lpIncome").value), payDay: Number($("lpPayDay").value || DEFAULT_PAY_DAY), buckets });
  if (!r.ok) { sumMsg = r.error; document.querySelector("#ledgerPlan .lpsum .msg").textContent = r.error; return; }
  const now = Date.now();
  editing = null; sumMsg = ""; clearDirty();
  await ctx.commit(() => setDoc(doc(ctx.db(), "ledgerPlan", "main"), { ...r.plan, created: plan?.created ?? now, updated: now }));
  renderPlan();
}

// ---------- bills this month ----------
const BILLS_M = 3; // unpaid bills on the medium card
function bills(v, size = "l") {
  const people = Object.fromEntries(ctx.people().map((p) => [p.id, p.name]));
  const list = v.bills, due = list.filter((r) => !r.paid);
  if (size === "s") return ctx.board.tile("bills", `<small id="lpbTitle">Bills this month</small><b class="bdbig">${list.length ? (due.length ? `${due.length} to pay` : "All paid ✓") : "None yet"}</b><small>${due.length ? `${rm(v.toPaySen, { whole: true })} · next ${shortDate(due[0].due)}` : list.length ? `${list.length} paid` : "Tap to add one"}</small>`, "Bills this month");
  if (size === "m") return `<div class="lhead"><h2 id="lpbTitle">Bills this month</h2><span class="note">${list.length ? (v.toPaySen ? `${rm(v.toPaySen)} still to pay` : "All paid ✓") : ""}</span></div>
    ${due.length ? `<div class="lpbl">${due.slice(0, BILLS_M).map((r) => billRow(r, people)).join("")}</div>` : `<p class="note">${list.length ? "Every bill this month is paid." : "No bills yet."}</p>`}
    <p class="note">${due.length > BILLS_M ? `And ${due.length - BILLS_M} more to pay. ` : ""}${ctx.board.more("bills", list.length - due.length ? `All bills, ${list.length - due.length} paid` : "All bills")}</p>
    <p class="msg" aria-live="polite">${esc(billMsg)}</p>`;
  const form = editing === "bill:new" ? billForm("new") : ""; // editing a bill opens in its own row (manageList)
  return `<div class="lhead"><h2 id="lpbTitle">Bills this month</h2><span class="note">${list.length ? (v.toPaySen ? `${rm(v.toPaySen)} still to pay` : "All paid ✓") : ""}</span>
      <span class="lbtnrow">${commitments.length ? `<button type="button" class="mini" data-lp="manage" aria-pressed="${manage}">All bills</button>` : ""}<button type="button" class="mini" data-lp="new-bill">＋ Add a bill</button>${ctx.board.less("bills")}</span></div>
    ${form}
    ${manage ? manageList() : list.length ? `<div class="lpbl">${list.map((r) => billRow(r, people)).join("")}</div>`
      : `<p class="note">${commitments.length ? "No bills this month." : "Add what you pay every month: house, car, loans, PayLater. For an instalment, add its final payment month so Ledger counts down."}</p>`}
    <p class="msg" aria-live="polite">${esc(billMsg)}</p>`;
}
function billRow(r, people) {
  const c = r.c, p = r.paid;
  const left = r.left == null ? "" : r.left === 0 ? "last one done" : `${r.left} left`;
  if (!p) return `<div class="lpb">
    <span class="lpdue">${shortDate(r.due)}</span>
    <span class="lpbn"><b>${esc(c.name)}</b><small>${left || "every month"}</small></span>
    <b class="lpba">${rm(r.amountSen)}</b>
    <button type="button" class="mini go" data-lp="pay" data-id="${c.id}">Paid</button>
  </div>`;
  return `<div class="lpb paid">
    <span class="lpdue ok">✓ ${shortDate(p.date)}</span>
    <span class="lpbn"><b>${esc(c.name)}</b><small>${p.source === "statement" ? `<span class="lptag ok">On statement</span>` : `<span class="lptag">Typed</span>`}${people[p.by] ? ` by ${esc(people[p.by])}` : ""}${left ? ` · ${left}` : ""}</small></span>
    <span class="lpba">${rm(r.amountSen)}</span>
    ${docsOn() ? `<button type="button" class="mini" data-lp="docs" data-id="${c.id}" aria-label="Receipts for ${esc(c.name)}">📎${p.docs?.length ? ` ${p.docs.length}` : ""}</button>` : ""}
    <button type="button" class="mini" data-lp="unpay" data-id="${c.id}" aria-label="Untick ${esc(c.name)}">Undo</button>
  </div>`;
}
// Every bill, including ones not live this month (finished, or starting later), to edit.
function manageList() {
  const pay = payOf(plan), m = monthOf(ctx.today(), pay), cal = ctx.today().slice(0, 7), bs = Object.fromEntries(bucketsOf(plan).map((b) => [b.id, b.name]));
  const sorted = [...commitments].sort((a, b) => Number(liveIn(b, m, pay)) - Number(liveIn(a, m, pay)) || a.name.localeCompare(b.name));
  const lit = (id) => glow?.id === id && Date.now() - glow.at < GLOW_MS;
  return `<div class="lpbl">${sorted.map((c) => editing === `bill:${c.id}` ? billForm(c.id) : `<div class="lpb${lit(c.id) ? " lflash" : ""}" data-bill="${c.id}"${lit(c.id) ? ` style="animation-delay:-${Date.now() - glow.at}ms"` : ""}>
    <span class="lpbn"><b>${esc(c.name)}</b><small>${esc(bs[c.bucket] ?? "")} · due ${c.dueDay}${c.endMonth ? ` · final ${esc(monthName(c.endMonth))}` : ""}${!liveIn(c, m, pay) ? (c.endMonth && c.endMonth < cal ? " · finished" : ` · starts ${esc(monthName(c.startMonth))}`) : ""}</small></span>
    <span class="lpba">${rm(c.amountSen)}</span>
    <button type="button" class="mini" data-lp="edit-bill" data-id="${c.id}">Edit</button>
  </div>`).join("")}</div>`;
}
function billForm(id) {
  const c = commitments.find((x) => x.id === id) ?? null, m = ctx.today().slice(0, 7); // start / final are calendar months
  // A new bill starts in the last bill's bucket (great-ux: start from the last choice); none yet = pick one.
  const last = lastUsed(commitments, "bucket"), bucketSel = c?.bucket ?? (bucketsOf(plan).some((b) => b.id === last) ? last : "");
  return `<div class="lpbform" data-form="bill">
    <h3>${c ? `Edit ${esc(c.name)}` : "Add a bill"}</h3>
    <div class="two">
      <label>Name<input type="text" id="lpbName" maxlength="40" autocomplete="off" placeholder="Car" value="${esc(c?.name ?? "")}"></label>
      <label>Monthly, RM<input type="text" id="lpbAmt" inputmode="decimal" autocomplete="off" placeholder="490" value="${c ? (c.amountSen / 100).toFixed(2) : ""}"></label>
    </div>
    <div class="two">
      <label>Bucket<select id="lpbBucket">${bucketSel ? "" : `<option value="" selected disabled>Pick one</option>`}${bucketsOf(plan).map((b) => `<option value="${b.id}"${b.id === bucketSel ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
      <label>Due day<input type="number" id="lpbDue" min="1" max="31" inputmode="numeric" value="${c?.dueDay ?? 1}"></label>
    </div>
    <div class="two">
      <label>Final payment <small>for instalments</small><input type="month" id="lpbEnd" min="${esc(c?.startMonth ?? m)}" value="${esc(c?.endMonth ?? "")}"></label>
      <label>Starts<input type="month" id="lpbStart" value="${esc(c?.startMonth ?? m)}"></label>
    </div>
    <div class="actions"><button type="button" class="primary" data-lp="save-bill" data-id="${c?.id ?? ""}">Save</button><button type="button" data-lp="cancel">Cancel</button>${c ? `<button type="button" class="mini" data-lp="del-bill" data-id="${c.id}">Delete</button>` : ""}</div>
    <p class="msg" id="lpbMsg" aria-live="polite"></p>
  </div>`;
}
async function saveBill(id) {
  const m = ctx.today().slice(0, 7);
  if (!$("lpbBucket").value) { $("lpbMsg").textContent = "Pick which bucket it comes out of."; return; }
  const r = checkCommitment({ name: $("lpbName").value, amountSen: toSen($("lpbAmt").value), bucket: $("lpbBucket").value, dueDay: $("lpbDue").value, endMonth: $("lpbEnd").value, startMonth: $("lpbStart").value }, plan, m);
  if (!r.ok) { $("lpbMsg").textContent = r.error; return; }
  const old = commitments.find((x) => x.id === id), now = Date.now(), db = ctx.db();
  const ref = old ? doc(db, "ledgerCommitments", id) : doc(collection(db, "ledgerCommitments"));
  editing = null; clearDirty(); billMsg = `${old ? "Saved" : "Added"} ${r.c.name}.`;
  if (old) glow = { id, at: now };
  await ctx.commit(() => setDoc(ref, { ...r.c, created: old?.created ?? now, updated: now }), billMsg);
  renderPlan();
}
async function pay(id) {
  const c = commitments.find((x) => x.id === id); if (!c) return;
  const day = ctx.today(), month = monthOf(day, payOf(plan));
  billMsg = `${c.name} ticked as paid.`;
  await ctx.commit(() => setDoc(doc(ctx.db(), "ledgerPaid", paidKey(id, month)), paidRecord(c, { month, date: day, by: ctx.me(), at: Date.now() })));
}
// Unticking deletes the paid record, so it asks first (safe-delete).
async function unpay(id) {
  const c = commitments.find((x) => x.id === id), month = monthOf(ctx.today(), payOf(plan)); if (!c) return;
  const ok = await confirmDelete({ title: `Untick ${c.name}?`, body: `<p>It goes back to not paid for this month.</p>`, yes: "Untick" });
  if (!ok) return;
  billMsg = "";
  await ctx.commit(() => deleteDoc(doc(ctx.db(), "ledgerPaid", paidKey(id, month))));
}
async function removeBill(id) {
  const c = commitments.find((x) => x.id === id); if (!c) return;
  const ticks = Object.values(paid).filter((p) => p.commitment === id);
  const ok = await confirmDelete({
    title: `Delete ${c.name}?`,
    body: `<p>${rm(c.amountSen)} a month${ticks.length ? `, and its ${ticks.length} paid ${ticks.length === 1 ? "tick" : "ticks"}` : ""}. To stop a bill that's finished, set its final payment month instead, which keeps its history.</p>`,
    yes: "Delete it",
  });
  if (!ok) return;
  const b = writeBatch(ctx.db());
  b.delete(doc(ctx.db(), "ledgerCommitments", id));
  ticks.forEach((p) => b.delete(doc(ctx.db(), "ledgerPaid", p.id)));
  editing = null; clearDirty(); billMsg = `Deleted ${c.name}.`;
  await ctx.commit(() => b.commit());
  renderPlan();
}

// The 📎 sheet's entry for a paid bill (docsui.js). Bills are shared, so either of you can add the receipt.
export function billEntry(p, c) {
  const by = ctx.people().find((x) => x.id === p.by)?.name ?? "";
  return { coll: "ledgerPaid", id: p.id, kind: "bill", date: p.date, what: c.name, amountSen: p.amountSen, person: by,
    docs: p.docs, canEdit: true, title: `${c.name} · ${rm(p.amountSen)} · paid ${shortDate(p.date)}` };
}

// ---------- events ----------
function click(b) {
  const a = b.dataset.lp, id = b.dataset.id;
  if (!a) return;
  if (a === "edit-plan") { editing = "plan"; sumMsg = ""; renderPlan(); paintSum(); }
  if (a === "reset-plan") pctInputs().forEach((i, n) => { i.value = DEFAULT_BUCKETS[n]?.pct ?? 0; paintSum(); });
  if (a === "save-plan") savePlan();
  if (a === "cancel") {
    const was = editing?.startsWith("bill:") && editing.slice(5);
    editing = null; clearDirty(); renderPlan();
    if (was) document.querySelector(`#ledgerPlan [data-bill="${was}"]`)?.scrollIntoView({ block: "nearest" }); // back where it was
  }
  if (a === "new-bill") { editing = "bill:new"; manage = false; billMsg = ""; clearDirty(); renderPlan(); $("lpbName")?.focus(); }
  if (a === "edit-bill") {
    editing = `bill:${id}`; billMsg = ""; clearDirty(); renderPlan();
    const f = document.querySelector('#ledgerPlan [data-form="bill"]');
    f?.scrollIntoView({ block: "nearest", behavior: "smooth" }); $("lpbName")?.focus({ preventScroll: true });
  }
  if (a === "manage") { manage = !manage; editing = null; clearDirty(); renderPlan(); }
  if (a === "save-bill") saveBill(id);
  if (a === "del-bill") removeBill(id);
  if (a === "pay") pay(id);
  if (a === "unpay") unpay(id);
  if (a === "docs") { const p = paid[paidKey(id, monthOf(ctx.today(), payOf(plan)))], c = commitments.find((x) => x.id === id); if (p && c) openDocs(billEntry(p, c)); }
}
const clearDirty = () => document.querySelectorAll("#ledgerPlan [data-form]").forEach((f) => delete f.dataset.dirty);
