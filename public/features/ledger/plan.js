// Ledger: the money plan at the top of #ledger (#ledgerPlan): where this month's income goes, what's
// left to spend (and per day), the plan's buckets, this month's bills to tick off, the next 12 months
// with the instalments that end, and a small rebate tile per credit card. Bills are ticked by hand
// ("Typed"); a statement import can later mark them checked. All maths is in logic/moneyplan.js.
import { collection, doc, setDoc, deleteDoc, onSnapshot, writeBatch } from "../../core/fs.js";
import { $, esc } from "../../core/util.js";
import { confirmDelete } from "../../core/confirm.js";
import { rm, toSen, shortDate, cycleView } from "../../logic/ledger.js";
import {
  DEFAULT_BUCKETS, bucketsOf, checkPlan, planView, outlook, countdown, checkCommitment, paidRecord, paidKey,
  monthOf, monthName, addMonths, liveIn, dueDate,
} from "../../logic/moneyplan.js";

const AHEAD_SHOWN = 4; // instalments listed under the 12-month chart before "and N more"
// Each default bucket keeps one colour slot from the chart palette (--s1…--s8); added buckets take the free ones.
const SLOT = { essentials: 1, fun: 4, debt: 8, savings: 3, invest: 7 };
const SPARE = [2, 5, 6];

let ctx, plan = null, commitments = [], paid = {};
// What's open: "plan" (editing the plan), "bill:<id>" / "bill:new" (a bill form), manage (all bills listed).
let editing = null, manage = false, sumMsg = "", billMsg = "";

const colourOf = (buckets) => {
  const out = {}; let spare = 0;
  for (const b of buckets) out[b.id] = `var(--s${SLOT[b.id] ?? SPARE[spare++ % SPARE.length]})`;
  return out;
};

// For the bucket spending page (spend.js): the live plan, bills and ticks, and each bucket's colour.
export const planState = () => ({ plan, commitments, paid });
export const bucketColours = () => colourOf(bucketsOf(plan));

export function initPlan(c) {
  ctx = c;
  const host = $("ledgerPlan");
  host.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) click(b); });
  host.addEventListener("input", (ev) => { if (ev.target.closest("[data-form]")) ev.target.closest("[data-form]").dataset.dirty = "1"; if (ev.target.dataset.pct != null) paintSum(); });
}
// Live data: returns the unsubscribe functions for ledgerui's list.
export function planSubs(db) {
  const redraw = () => renderPlan();
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
  const day = ctx.today(), v = planView({ plan, commitments, paid, txns: ctx.txns(), day });
  host.innerHTML = `
    <section class="panel lpsum" data-title="Money plan" aria-labelledby="lpTitle">${!plan || editing === "plan" ? planForm() : summary(v)}</section>
    ${plan ? `<section class="panel lpbills" data-title="Bills this month" aria-labelledby="lpbTitle">${bills(v)}</section>` : ""}
    ${plan && commitments.length ? `<section class="panel lpahead" data-title="Next 12 months" aria-labelledby="lpaTitle">${ahead(v)}</section>` : ""}
    ${rebateTiles(day)}`;
}

// ---------- where the money goes ----------
function summary(v) {
  const col = colourOf(v.buckets), used = v.buckets.filter((b) => b.usedSen > 0);
  const over = v.freeSen < 0, end = shortDate(dueDate({ dueDay: 31 }, v.month));
  return `<div class="lhead"><h2 id="lpTitle">Where ${rm(v.incomeSen, { whole: true })} goes</h2><span class="note">${esc(monthName(v.month))}</span>
      <span class="lbtnrow"><button type="button" class="mini" data-lp="edit-plan">Edit plan</button></span></div>
    <div class="lpring">
      ${ring(v, used, col, over)}
      <ul class="lpleg">${used.map((b) => `<li><a href="#ledger/spend/${b.id}"><span class="dot" style="--c:${col[b.id]}"></span><span>${esc(b.name)}</span><b>${rm(b.usedSen, { whole: true })}</b></a></li>`).join("")}${over ? "" : `<li><span class="dot free"></span><span>Free</span><b>${rm(v.freeSen, { whole: true })}</b></li>`}</ul>
    </div>
    <div class="lpleft">
      <div><small>${over ? "Over your income by" : "Can still spend"}</small><b class="${over ? "over" : ""}">${rm(Math.abs(v.freeSen), { whole: true })}</b></div>
      ${over ? "" : `<div><small>a day, to ${end}</small><b class="sm">${rm(v.perDaySen, { whole: true })}</b></div>`}
    </div>
    <p class="note">Bills ${rm(v.committedSen, { whole: true })} (${v.sharePct}% of income) · spent day to day ${rm(v.spentSen, { whole: true })}</p>
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
    <label>Monthly income (take-home), RM<input type="text" id="lpIncome" inputmode="decimal" autocomplete="off" placeholder="4000" value="${plan ? (plan.incomeSen / 100).toFixed(2).replace(/\.00$/, "") : ""}"></label>
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
  const r = checkPlan({ incomeSen: toSen($("lpIncome").value), buckets });
  if (!r.ok) { sumMsg = r.error; document.querySelector("#ledgerPlan .lpsum .msg").textContent = r.error; return; }
  const now = Date.now();
  editing = null; sumMsg = ""; clearDirty();
  await ctx.commit(() => setDoc(doc(ctx.db(), "ledgerPlan", "main"), { ...r.plan, created: plan?.created ?? now, updated: now }));
  renderPlan();
}

// ---------- bills this month ----------
function bills(v) {
  const people = Object.fromEntries(ctx.people().map((p) => [p.id, p.name]));
  const list = v.bills;
  const form = editing?.startsWith("bill:") ? billForm(editing.slice(5)) : "";
  return `<div class="lhead"><h2 id="lpbTitle">Bills this month</h2><span class="note">${list.length ? (v.toPaySen ? `${rm(v.toPaySen)} still to pay` : "All paid ✓") : ""}</span>
      <span class="lbtnrow">${commitments.length ? `<button type="button" class="mini" data-lp="manage" aria-pressed="${manage}">All bills</button>` : ""}<button type="button" class="mini" data-lp="new-bill">＋ Add a bill</button></span></div>
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
    <button type="button" class="mini" data-lp="unpay" data-id="${c.id}" aria-label="Untick ${esc(c.name)}">Undo</button>
  </div>`;
}
// Every bill, including ones not live this month (finished, or starting later), to edit.
function manageList() {
  const m = monthOf(ctx.today()), bs = Object.fromEntries(bucketsOf(plan).map((b) => [b.id, b.name]));
  const sorted = [...commitments].sort((a, b) => Number(liveIn(b, m)) - Number(liveIn(a, m)) || a.name.localeCompare(b.name));
  return `<div class="lpbl">${sorted.map((c) => `<div class="lpb">
    <span class="lpbn"><b>${esc(c.name)}</b><small>${esc(bs[c.bucket] ?? "")} · due ${c.dueDay}${c.endMonth ? ` · final ${esc(monthName(c.endMonth))}` : ""}${!liveIn(c, m) ? (c.endMonth && c.endMonth < m ? " · finished" : ` · starts ${esc(monthName(c.startMonth))}`) : ""}</small></span>
    <span class="lpba">${rm(c.amountSen)}</span>
    <button type="button" class="mini" data-lp="edit-bill" data-id="${c.id}">Edit</button>
  </div>`).join("")}</div>`;
}
function billForm(id) {
  const c = commitments.find((x) => x.id === id) ?? null, m = monthOf(ctx.today());
  return `<div class="lpbform" data-form="bill">
    <h3>${c ? `Edit ${esc(c.name)}` : "Add a bill"}</h3>
    <div class="two">
      <label>Name<input type="text" id="lpbName" maxlength="40" autocomplete="off" placeholder="Car" value="${esc(c?.name ?? "")}"></label>
      <label>Monthly, RM<input type="text" id="lpbAmt" inputmode="decimal" autocomplete="off" placeholder="490" value="${c ? (c.amountSen / 100).toFixed(2) : ""}"></label>
    </div>
    <div class="two">
      <label>Bucket<select id="lpbBucket">${bucketsOf(plan).map((b) => `<option value="${b.id}"${b.id === (c?.bucket ?? "essentials") ? " selected" : ""}>${esc(b.name)}</option>`).join("")}</select></label>
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
  const m = monthOf(ctx.today());
  const r = checkCommitment({ name: $("lpbName").value, amountSen: toSen($("lpbAmt").value), bucket: $("lpbBucket").value, dueDay: $("lpbDue").value, endMonth: $("lpbEnd").value, startMonth: $("lpbStart").value }, plan, m);
  if (!r.ok) { $("lpbMsg").textContent = r.error; return; }
  const old = commitments.find((x) => x.id === id), now = Date.now(), db = ctx.db();
  const ref = old ? doc(db, "ledgerCommitments", id) : doc(collection(db, "ledgerCommitments"));
  editing = null; clearDirty(); billMsg = `${old ? "Saved" : "Added"} ${r.c.name}.`;
  await ctx.commit(() => setDoc(ref, { ...r.c, created: old?.created ?? now, updated: now }));
  renderPlan();
}
async function pay(id) {
  const c = commitments.find((x) => x.id === id); if (!c) return;
  const day = ctx.today(), month = monthOf(day);
  billMsg = `${c.name} ticked as paid.`;
  await ctx.commit(() => setDoc(doc(ctx.db(), "ledgerPaid", paidKey(id, month)), paidRecord(c, { month, date: day, by: ctx.me(), at: Date.now() })));
}
// Unticking deletes the paid record, so it asks first (safe-delete).
async function unpay(id) {
  const c = commitments.find((x) => x.id === id), month = monthOf(ctx.today()); if (!c) return;
  const ok = await confirmDelete({ title: `Untick ${c.name}?`, body: `<p>It goes back to not paid for ${esc(monthName(month))}.</p>`, yes: "Untick" });
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

// ---------- the next 12 months ----------
function ahead(v) {
  const o = outlook(commitments, v.incomeSen, v.month), cd = countdown(commitments, v.month);
  const W = 300, H = 112, L = 24, B = 92, top = 22, bw = (W - L - 4) / o.length;
  const max = Math.max(...o.map((x) => Math.abs(x.freeSen)), 1), y = (sen) => B - (Math.max(0, sen) / max) * (B - top);
  // A label over each month where more money frees up than the month before.
  const steps = o.map((x, i) => (i && x.freeSen > o[i - 1].freeSen ? x.freeSen - o[i - 1].freeSen : 0));
  const shown = cd.ending.slice(0, AHEAD_SHOWN), more = cd.ending.length - shown.length;
  return `<div class="lhead"><h2 id="lpaTitle">Next 12 months</h2><span class="note">free after bills</span></div>
    <svg class="lpchart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Free after bills: ${o.map((x) => `${monthName(x.month, { short: true })} ${rm(x.freeSen, { whole: true })}`).join(", ")}">
      <line x1="${L}" y1="${B}" x2="${W}" y2="${B}" class="axis"></line>
      ${o.map((x, i) => {
        const x0 = L + i * bw + 2, h = B - y(x.freeSen);
        return `<rect x="${x0.toFixed(1)}" y="${y(x.freeSen).toFixed(1)}" width="${(bw - 4).toFixed(1)}" height="${Math.max(h, 1).toFixed(1)}" rx="3" class="${i ? "bar" : "bar now"}${x.freeSen < 0 ? " neg" : ""}"></rect>
          ${steps[i] ? `<text x="${(x0 + (bw - 4) / 2).toFixed(1)}" y="${(y(x.freeSen) - 4).toFixed(1)}" class="up">+${Math.round(steps[i] / 100)}</text>` : ""}`;
      }).join("")}
      ${[0, Math.floor(o.length / 2), o.length - 1].map((i) => `<text x="${(L + i * bw + bw / 2).toFixed(1)}" y="${H - 6}" class="lab">${monthName(o[i].month, { short: true })}</text>`).join("")}
      <text x="${L - 4}" y="${B + 3}" class="lab end">0</text>
    </svg>
    <p class="note">Income less bills: ${rm(o[0].freeSen, { whole: true })} this month${o.at(-1).freeSen !== o[0].freeSen ? `, ${rm(o.at(-1).freeSen, { whole: true })} by ${esc(monthName(o.at(-1).month))}` : ""}. Day-to-day spending comes out of this.</p>
    ${cd.ending.length ? `<h3 class="lph">Debt-free countdown</h3>
    <div class="lpbl">${shown.map((c) => `<div class="lpb">
      <span class="lpdue ok">${esc(monthName(c.endMonth, { short: true }))}${c.endMonth.slice(0, 4) !== v.month.slice(0, 4) ? ` ’${c.endMonth.slice(2, 4)}` : ""}</span>
      <span class="lpbn"><b>${esc(c.name)} ends</b><small>from ${esc(monthName(addMonths(c.endMonth, 1)))}</small></span>
      <span class="lpba ok">+${rm(c.amountSen, { whole: true })}/mo</span>
    </div>`).join("")}</div>
    <p class="note">${more ? `And ${more} more. ` : ""}All instalments done after ${esc(monthName(cd.last))} · ${rm(v.owedSen, { whole: true })} still to pay on them.</p>` : ""}`;
}

// ---------- the small rebate tile ----------
// One per credit card with rebate rules; the full card is further down.
function rebateTiles(day) {
  const tiles = ctx.accounts().filter((a) => a.type === "credit_card").map((a) => {
    const v = cycleView(a, { programs: ctx.programs(), cycles: ctx.cycles(), txns: ctx.txns(), day });
    if (!v.program) return "";
    return `<button type="button" class="lptile" data-lp="to-card" data-id="${a.id}">
      <span class="lptl"><small>Card rebate · ${esc(a.name)}</small><b>${rm(v.rebate.totalSen, { whole: true })}</b></span>
      <span class="lptag">${v.next ? `${rm(v.next.needSen, { whole: true })} to next tier` : "Top tier"}</span>
      <small class="lptl2">${v.daysLeft === 0 ? "statement today" : `${v.daysLeft} ${v.daysLeft === 1 ? "day" : "days"} to statement`}</small>
    </button>`;
  }).join("");
  return tiles ? `<div class="lptiles">${tiles}</div>` : "";
}

// ---------- events ----------
function click(b) {
  const a = b.dataset.lp, id = b.dataset.id;
  if (!a) return;
  if (a === "edit-plan") { editing = "plan"; sumMsg = ""; renderPlan(); paintSum(); }
  if (a === "reset-plan") pctInputs().forEach((i, n) => { i.value = DEFAULT_BUCKETS[n]?.pct ?? 0; paintSum(); });
  if (a === "save-plan") savePlan();
  if (a === "cancel") { editing = null; clearDirty(); renderPlan(); }
  if (a === "new-bill") { editing = "bill:new"; manage = false; billMsg = ""; clearDirty(); renderPlan(); $("lpbName")?.focus(); }
  if (a === "edit-bill") { editing = `bill:${id}`; billMsg = ""; clearDirty(); renderPlan(); }
  if (a === "manage") { manage = !manage; editing = null; clearDirty(); renderPlan(); }
  if (a === "save-bill") saveBill(id);
  if (a === "del-bill") removeBill(id);
  if (a === "pay") pay(id);
  if (a === "unpay") unpay(id);
  if (a === "to-card") document.getElementById(`lcard-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
}
const clearDirty = () => document.querySelectorAll("#ledgerPlan [data-form]").forEach((f) => delete f.dataset.dirty);
