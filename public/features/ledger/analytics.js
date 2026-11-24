// Ledger: the Analytics page (#ledger/analytics, section #ledgerAnalytics), opened by "📊 Analytics" beside
// "Arrange cards". Graphs that are good to look at now and then but don't need a place on the everyday board
// (decided 24 Nov 2026: "Next 12 months, free after bills" was a board card the family found little use for).
// For now: the next 12 months (income less bills) and the debt-free countdown. Maths in logic/moneyplan.js.
import { $, esc } from "../../core/util.js";
import { rm } from "../../logic/ledger.js";
import { outlook, countdown, planView, monthName, addMonths } from "../../logic/moneyplan.js";
import { planState } from "./plan.js";

export const ANALYTICS = "#ledger/analytics";
const COUNTDOWN_SHOWN = 6; // instalments listed before "and N more"
let ctx;

export function initAnalytics(c) {
  ctx = c;
  addEventListener("hashchange", () => { renderAnalytics(); if (location.hash === ANALYTICS) scrollTo({ top: 0 }); });
}

export function renderAnalytics() {
  const on = location.hash === ANALYTICS, host = $("ledgerAnalytics");
  $("ledger").classList.toggle("anpage", on);
  if (!on || !host || !ctx.people().length) return;
  const { plan, commitments, paid } = planState();
  const head = `<div class="lhead"><a class="btn mini" href="#ledger">← Ledger</a></div><h2 id="laTitle">Analytics</h2>`;
  if (!plan || !commitments.length) {
    host.innerHTML = `${head}<p class="note">Nothing to show yet. Set up your money plan and add your bills on the Ledger page, and the next 12 months shows up here.</p>`;
    return;
  }
  const v = planView({ plan, commitments, paid, txns: ctx.txns(), day: ctx.today() });
  host.innerHTML = `${head}${ahead(v, commitments)}`;
}

// The next 12 months: income less bills each month, with a "+N" over each month where an instalment ends.
function ahead(v, commitments) {
  const o = outlook(commitments, v.incomeSen, v.month), cd = countdown(commitments, v.month);
  const W = 300, H = 112, L = 24, B = 92, top = 22, bw = (W - L - 4) / o.length;
  const max = Math.max(...o.map((x) => Math.abs(x.freeSen)), 1), y = (sen) => B - (Math.max(0, sen) / max) * (B - top);
  const steps = o.map((x, i) => (i && x.freeSen > o[i - 1].freeSen ? x.freeSen - o[i - 1].freeSen : 0));
  const shown = cd.ending.slice(0, COUNTDOWN_SHOWN), more = cd.ending.length - shown.length;
  return `<h3 class="lph">Next 12 months <span class="note">free after bills</span></h3>
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
    <p class="note">${more ? `And ${more} more. ` : ""}All instalments done after ${esc(monthName(cd.last))} · ${rm(v.owedSen, { whole: true })} still to pay on them.</p>` : `<p class="note">No instalments with a final payment month yet.</p>`}`;
}
