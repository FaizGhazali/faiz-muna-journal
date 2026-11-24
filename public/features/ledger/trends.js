// Ledger: the "Spending trends" card (#ledgerTrends): spending per month by category (stacked bars),
// this cycle (or month) so far vs the last one, and the top shops. Filters: who spent it, which card.
// The sums are pure (ledger.js: monthlyByCat, compareSpend, topMerchants); this file draws them.
import { SYSTEM_CATEGORIES, rm, shortDate, monthsBack, monthlyByCat, comparePeriods, compareSpend, topMerchants, daysBetween } from "../../logic/ledger.js";
import { $, esc } from "../../core/util.js";

const MONTHS = 6;
const KEY = "journal-ledger-trends"; // per device: { who, acct }
const MON = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Each category keeps its own colour slot whatever is shown (colour follows the category, never its rank).
// Eight slots (checked with the palette validator on both themes); the rest fold into "Other".
const SLOT = { "fuel-petronas": 1, dining: 2, groceries: 3, shopping: 4, insurance: 5, utilities: 6, bnpl: 7, medical: 8 };
const series = (cat) => (SLOT[cat] ? cat : "other");
const ORDER = [...Object.keys(SLOT), "other"];
const colour = (s) => (s === "other" ? "var(--s-other)" : `var(--s${SLOT[s]})`);
const label = (s) => (s === "other" ? "Other" : SYSTEM_CATEGORIES.find((c) => c.id === s)?.name ?? s);

let ctx, filt = { who: "", acct: "" };

export function initTrends(c) {
  ctx = c;
  try { filt = { ...filt, ...JSON.parse(localStorage.getItem(KEY) || "{}") }; } catch (_) {}
  const host = $("ledgerTrends");
  host.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-who]"); if (!b) return;
    filt.who = b.dataset.who; keep(); renderTrends();
  });
  host.addEventListener("change", (ev) => { if (ev.target.id === "ltAcct") { filt.acct = ev.target.value; keep(); renderTrends(); } });
  let w = 0;
  new ResizeObserver(() => { const nw = host.clientWidth; if (nw && nw !== w) { w = nw; drawChart(); } }).observe(host);
}
const keep = () => { try { localStorage.setItem(KEY, JSON.stringify(filt)); } catch (_) {} };

export function renderTrends() {
  const host = $("ledgerTrends"); if (!host || !ctx.people().length) return;
  const people = ctx.people(), accounts = ctx.accounts();
  if (filt.who && !people.some((p) => p.id === filt.who)) filt.who = "";
  if (filt.acct && !accounts.some((a) => a.id === filt.acct)) filt.acct = "";
  const day = ctx.today(), f = { person: filt.who || null, account: filt.acct || null };
  const acc = accounts.find((a) => a.id === filt.acct);
  const per = comparePeriods(day, acc && acc.type === "credit_card" ? acc : null);
  const cmp = compareSpend(ctx.txns(), per, f);
  const months = monthsBack(day, MONTHS), from = `${months[0]}-01`;
  const shops = topMerchants(ctx.txns(), { from, to: day, limit: 6, ...f });
  const big = shops[0]?.sen || 1, days = daysBetween(per.now[0], per.now[1]) + 1;
  const diff = (now, before) => {
    if (!before) return now ? "new" : "";
    const d = Math.round(((now - before) / before) * 100);
    return d === 0 ? "same" : `${d > 0 ? "▲" : "▼"} ${Math.abs(d)}%`;
  };
  // Small: this month vs last, one tile. Medium: the monthly chart. Large: everything (shell/board.js).
  const size = ctx.board.sizeOf("trends"), what = per.kind === "cycle" ? "This statement so far" : "This month so far";
  const change = diff(cmp.nowSen, cmp.beforeSen);
  if (size === "s") { host.innerHTML = ctx.board.tile("trends", `<small id="ltTitle">${what}</small><b class="bdbig">${rm(cmp.nowSen, { whole: true })}</b><small>${rm(cmp.beforeSen, { whole: true })} by this day last time${change && change !== "new" ? ` · ${change}` : ""}</small>`, "Spending trends"); return; }
  if (size === "m") {
    host.innerHTML = `<div class="lhead"><h2 id="ltTitle">Spending trends</h2><span class="note">${filt.who || filt.acct ? "filtered" : "both of you"}</span></div>
      <ul class="lleg" id="ltLeg"></ul>
      <div class="chart ltchart" id="ltChart"></div>
      <p class="week"><b>${rm(cmp.nowSen)}</b> ${what.toLowerCase()} · ${rm(cmp.beforeSen)} by the same day last time ${ctx.board.more("trends", "Shops and categories")}</p>`;
    drawChart();
    return;
  }
  host.innerHTML = `<div class="lhead"><h2 id="ltTitle">Spending trends</h2>${ctx.board.less("trends")}</div>
    <div class="ltf">
      <div class="chips" role="group" aria-label="Whose spending">${[["", "Both"], ...people.map((p) => [p.id, p.name])].map(([id, n]) => `<button type="button" class="chip" data-who="${id}" aria-pressed="${filt.who === id}">${esc(n)}</button>`).join("")}</div>
      <select id="ltAcct" aria-label="Which card or wallet"><option value="">All cards and wallets</option>${accounts.map((a) => `<option value="${a.id}"${a.id === filt.acct ? " selected" : ""}>${esc(a.name)}</option>`).join("")}</select>
    </div>
    <h3 class="lth">Each month</h3>
    <ul class="lleg" id="ltLeg"></ul>
    <div class="chart ltchart" id="ltChart"></div>
    <details class="ltnum"><summary>Show numbers</summary><div id="ltTable"></div></details>
    <h3 class="lth">${per.kind === "cycle" ? "This statement so far vs last one" : "This month so far vs last month"}</h3>
    <p class="week"><b>${rm(cmp.nowSen)}</b> in ${days} ${days === 1 ? "day" : "days"} (${shortDate(per.now[0])} – ${shortDate(per.now[1])}) · ${rm(cmp.beforeSen)} by the same day last time</p>
    ${cmp.rows.length ? `<div class="ltcmp" role="table" aria-label="Spending by category, now and last time">
      <div class="ltrow lthead" role="row"><span role="columnheader">Category</span><span role="columnheader">Now</span><span role="columnheader">Last time</span><span role="columnheader">Change</span></div>
      ${cmp.rows.slice(0, 6).map((r) => `<div class="ltrow" role="row"><span role="cell"><i class="sw" style="--c:${colour(series(r.cat))}"></i>${esc(SYSTEM_CATEGORIES.find((c) => c.id === r.cat)?.name ?? r.cat)}</span><span role="cell">${rm(r.nowSen, { whole: true })}</span><span role="cell">${rm(r.beforeSen, { whole: true })}</span><span role="cell" class="ltd">${diff(r.nowSen, r.beforeSen)}</span></div>`).join("")}
    </div>` : `<p class="note">Nothing logged in either stretch yet.</p>`}
    <h3 class="lth">Top shops · last ${MONTHS} months</h3>
    ${shops.length ? `<div class="ltshops">${shops.map((s) => `<div class="ltshop"><span class="ltsn">${esc(s.name)}<small>${s.n} ${s.n === 1 ? "time" : "times"}</small></span><i style="width:${Math.max(2, Math.round((s.sen / big) * 100))}%"></i><b>${rm(s.sen, { whole: true })}</b></div>`).join("")}</div>`
      : `<p class="note">No spending logged in the last ${MONTHS} months.</p>`}`;
  drawChart();
}

// Stacked bars: one per month, categories bottom-up in their fixed order, 2px gaps, rounded top, total above.
function drawChart() {
  const host = $("ltChart"); if (!host || !host.clientWidth) return;
  const f = { person: filt.who || null, account: filt.acct || null };
  const rows = monthlyByCat(ctx.txns(), monthsBack(ctx.today(), MONTHS), f).map((r) => {
    const s = {};
    for (const [cat, sen] of Object.entries(r.cats)) if (sen > 0) s[series(cat)] = (s[series(cat)] ?? 0) + sen;
    return { ...r, s };
  });
  const used = ORDER.filter((k) => rows.some((r) => r.s[k]));
  $("ltLeg").innerHTML = used.map((k) => `<li><i class="sw" style="--c:${colour(k)}"></i>${esc(label(k))}</li>`).join("");
  const W = host.clientWidth, H = 190, L = 46, R = 6, T = 18, B = 22, ph = H - T - B;
  const max = Math.max(...rows.map((r) => r.totalSen), 1), step = niceStep(max / 3), ticks = Math.max(1, Math.ceil(max / step)), nice = step * ticks;
  const band = (W - L - R) / rows.length, bw = Math.min(40, band * 0.62);
  const Y = (sen) => T + ph - (sen / nice) * ph;
  let svg = "";
  for (let g = 0; g <= ticks; g++) {
    const v = step * g, y = Y(v);
    svg += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y}" y2="${y}"/><text x="${L - 6}" y="${y + 4}" text-anchor="end">${rmShort(v)}</text>`;
  }
  rows.forEach((r, i) => {
    const x = L + band * i + (band - bw) / 2;
    let base = Y(0);
    const segs = used.filter((k) => r.s[k]);
    segs.forEach((k, j) => {
      const h = (r.s[k] / nice) * ph, top = base - h, gap = j ? 2 : 0, hh = Math.max(0, h - gap);
      const yTop = top, yBot = base - gap;
      if (j === segs.length - 1 && hh > 4) {
        const rr = 4;
        svg += `<path d="M${x},${yBot} V${yTop + rr} Q${x},${yTop} ${x + rr},${yTop} H${x + bw - rr} Q${x + bw},${yTop} ${x + bw},${yTop + rr} V${yBot} Z" fill="${colour(k)}"/>`;
      } else if (hh > 0) svg += `<rect x="${x}" y="${yTop}" width="${bw}" height="${hh}" fill="${colour(k)}"/>`;
      base = top;
    });
    if (r.totalSen > 0) svg += `<text class="val" x="${x + bw / 2}" y="${Y(r.totalSen) - 5}" text-anchor="middle">${rmShort(r.totalSen)}</text>`;
    const [y, m] = r.ym.split("-").map(Number);
    svg += `<text x="${x + bw / 2}" y="${H - 6}" text-anchor="middle">${MON[m - 1]}${m === 1 ? ` ${String(y).slice(2)}` : ""}</text>`;
    svg += `<rect class="hit" data-i="${i}" x="${L + band * i}" y="${T}" width="${band}" height="${ph}" fill="transparent"/>`;
  });
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Spending per month for the last ${MONTHS} months, by category. ${rows.map((r) => `${label2(r.ym)}: ${rm(r.totalSen, { whole: true })}`).join(". ")}.">${svg}</svg><div class="tip" hidden></div>`;
  const tip = host.querySelector(".tip");
  const show = (ev) => {
    const hit = ev.target.closest?.(".hit"); if (!hit) return;
    const r = rows[Number(hit.dataset.i)];
    tip.hidden = false;
    tip.innerHTML = `<b>${label2(r.ym)}: ${rm(r.totalSen)}</b>${used.filter((k) => r.s[k]).reverse().map((k) => `<br><i class="sw" style="--c:${colour(k)}"></i>${esc(label(k))} ${rm(r.s[k])}`).join("")}`;
    const bx = Number(hit.getAttribute("x")) + band / 2, tw = tip.offsetWidth;
    tip.style.left = `${Math.max(0, Math.min(W - tw, bx - tw / 2))}px`;
  };
  const svgEl = host.querySelector("svg");
  svgEl.addEventListener("pointermove", show);
  svgEl.addEventListener("pointerdown", show);
  svgEl.addEventListener("pointerleave", () => { tip.hidden = true; });
  // The same numbers as a table (for screen readers and the colours that are light on white).
  if ($("ltTable")) $("ltTable").innerHTML = `<table class="lttable"><thead><tr><th>Month</th>${used.map((k) => `<th>${esc(label(k))}</th>`).join("")}<th>Total</th></tr></thead>
    <tbody>${rows.map((r) => `<tr><th>${label2(r.ym)}</th>${used.map((k) => `<td>${r.s[k] ? rm(r.s[k], { whole: true }) : "–"}</td>`).join("")}<td><b>${rm(r.totalSen, { whole: true })}</b></td></tr>`).join("")}</tbody></table>`;
}
const label2 = (ym) => { const [y, m] = ym.split("-").map(Number); return `${MON[m - 1]} ${y}`; };
// A round step for the scale (in sen): 1, 2 or 5 × a power of ten ringgit, at least RM1.
function niceStep(sen) {
  const v = Math.max(sen / 100, 1), p = 10 ** Math.floor(Math.log10(v));
  return [1, 2, 5, 10].find((k) => k * p >= v) * p * 100;
}
const rmShort = (sen) => { const v = sen / 100; return v >= 1000 ? `RM${(v / 1000).toFixed(v >= 10000 ? 0 : 1).replace(/\.0$/, "")}k` : `RM${Math.round(v)}`; };
