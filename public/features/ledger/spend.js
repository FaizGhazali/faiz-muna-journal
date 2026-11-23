// Ledger: what a money-plan bucket was spent on (#ledger/spend/<bucket id>, or "all"), opened by tapping
// a bucket on the money plan. Pick a month or All months, Both or one person, search a shop or category;
// tap a shop to see its whole history (every month, a usual visit, the last 12 months as bars).
// The page loads every Ledger item once (the live list only holds the last LOAD_DAYS). Sums: logic/bucketspend.js.
import { collection, getDocs } from "../../core/fs.js";
import { $, esc } from "../../core/util.js";
import { SYSTEM_CATEGORIES, rm, shortDate } from "../../logic/ledger.js";
import { bucketsOf, bucketFor, monthOf, monthName, monthBills } from "../../logic/moneyplan.js";
import { ALL, bucketItems, byMonth, byShop, byCat, totals, shopTrack, monthsWith, shopKey } from "../../logic/bucketspend.js";
import { planState, bucketColours } from "./plan.js";

const ROUTE = /^#ledger\/spend\/([\w-]+)$/;
export const spendRoute = () => location.hash.match(ROUTE)?.[1] ?? null;
const SHOPS_SHOWN = 6, PAGE = 40;
const cat = (id) => SYSTEM_CATEGORIES.find((c) => c.id === id) ?? SYSTEM_CATEGORIES.find((c) => c.id === "other");
const money = (sen) => `${rm(Math.abs(sen))}${sen < 0 ? " CR" : ""}`;
const times = (n) => `${n} ${n === 1 ? "time" : "times"}`;

let ctx, history = null, loading = false, frameKey = "";
// month: "YYYY-MM" or ALL (null = this month); who: "" = both; shop: the shop being followed (its key).
const st = { month: null, who: "", q: "", shop: null, allShops: false, shown: PAGE, route: null };

export function initSpend(c) {
  ctx = c;
  const host = $("ledgerSpend");
  host.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) click(b); });
  host.addEventListener("input", (ev) => { if (ev.target.id === "lsQ") { st.q = ev.target.value; st.shown = PAGE; st.allShops = false; paintBody(); } });
  host.addEventListener("change", (ev) => { if (ev.target.id === "lsMonth") { st.month = ev.target.value; st.shown = PAGE; renderSpend(); } });
  addEventListener("hashchange", () => {
    if (spendRoute() !== st.route) { st.shop = null; st.allShops = false; st.shown = PAGE; frameKey = ""; }
    renderSpend();
    if (spendRoute()) scrollTo({ top: 0 });
  });
}

// Every item: the full history for older months, the live list for the loaded ones (so edits and deletes show).
function all() {
  const live = ctx.txns(); if (!history) return live;
  const from = ctx.loadedFrom();
  return [...history.filter((t) => t.date < from), ...live];
}
async function loadHistory() {
  if (history || loading) return;
  loading = true;
  try {
    const s = await getDocs(collection(ctx.db(), "ledgerTxns"));
    history = s.docs.map((d) => ({ id: d.id, ...d.data() })).filter((t) => /^\d{4}-\d{2}-\d{2}$/.test(t.date || "") && Number.isInteger(t.amountSen));
  } catch (_) { /* offline: the loaded months still show */ }
  loading = false;
  if (history) renderSpend();
}

export function renderSpend() {
  const id = spendRoute(), host = $("ledgerSpend");
  $("ledger").classList.toggle("spendpage", !!id);
  st.route = id;
  if (!id || !host || !ctx.people().length) return;
  loadHistory();
  const { plan } = planState(), buckets = bucketsOf(plan), now = monthOf(ctx.today());
  const bucket = id === ALL ? ALL : bucketFor(plan, id);
  if (!st.month) st.month = now;
  if (st.who && !ctx.people().some((p) => p.id === st.who)) st.who = "";
  const months = monthsWith(all(), plan, bucket, now);
  if (st.month !== ALL && !months.includes(st.month)) st.month = now;
  // The frame (with the search box) is drawn once per shape, so typing keeps its place.
  const key = [bucket, st.month, st.who, months.join(), buckets.map((b) => b.id + b.name).join(), ctx.people().map((p) => p.id + p.name).join()].join("|");
  if (key !== frameKey || !$("lsQ")) { frameKey = key; host.innerHTML = frame(bucket, buckets, months, now); }
  paintBody();
}

function frame(bucket, buckets, months, now) {
  const col = bucketColours(), b = buckets.find((x) => x.id === bucket);
  return `<div class="lhead"><a class="btn mini" href="#ledger">← Money plan</a></div>
    <h2 id="lsTitle">${b ? `<span class="dot" style="--c:${col[b.id]}"></span>${esc(b.name)}` : "All spending"}</h2>
    ${b?.about ? `<p class="note">${esc(b.about)}</p>` : ""}
    <div class="chips" role="group" aria-label="Bucket">${[...buckets.map((x) => [x.id, x.name]), [ALL, "All"]].map(([i, n]) => `<button type="button" class="chip" data-lsb="${i}" aria-pressed="${i === bucket}">${esc(n)}</button>`).join("")}</div>
    <div class="ltf">
      <div class="chips" role="group" aria-label="Whose spending">${[["", "Both"], ...ctx.people().map((p) => [p.id, p.name])].map(([i, n]) => `<button type="button" class="chip" data-lsw="${i}" aria-pressed="${st.who === i}">${esc(n)}</button>`).join("")}</div>
      <select id="lsMonth" aria-label="Which month"><option value="${ALL}"${st.month === ALL ? " selected" : ""}>All months</option>${months.map((m) => `<option value="${m}"${m === st.month ? " selected" : ""}>${m === now ? "This month" : esc(monthName(m))}</option>`).join("")}</select>
    </div>
    <input type="search" id="lsQ" placeholder="Search a shop or category" autocomplete="off" aria-label="Search a shop or category" value="${esc(st.q)}">
    <div id="lsBody" class="lsbody"></div>`;
}

function paintBody() {
  const el = $("lsBody"); if (!el) return;
  const { plan } = planState(), bucket = st.route === ALL ? ALL : bucketFor(plan, st.route);
  el.innerHTML = st.shop ? tracker(plan, bucket) : body(plan, bucket);
}

// ---------- the bucket ----------
function body(plan, bucket) {
  const now = monthOf(ctx.today()), month = st.month === ALL ? null : st.month, q = st.q.trim();
  const items = bucketItems(all(), plan, bucket, { month, person: st.who || null, q });
  const t = totals(items, now), b = bucketsOf(plan).find((x) => x.id === bucket);
  const { commitments, paid } = planState();
  const bills = month && b && !q ? monthBills(commitments, paid, month).filter((r) => bucketFor(plan, r.c.bucket) === bucket) : [];
  const billSen = bills.reduce((s, r) => s + r.amountSen, 0), planSen = b && plan ? Math.round((plan.incomeSen * b.pct) / 100) : 0;
  const shops = byShop(items), cats = byCat(items);
  const shopList = st.allShops ? shops : shops.slice(0, SHOPS_SHOWN);
  const big = Math.max(shops[0]?.sen ?? 0, 1), bigCat = Math.max(cats[0]?.sen ?? 0, 1);
  const tiles = `<div class="stats">
      <div class="stat"><small>${q ? `Spent on “${esc(q)}”` : month ? "Spent day to day" : "Spent, all months"}</small><b>${rm(t.sen, { whole: true })}</b></div>
      <div class="stat"><small>How many times</small><b class="sm">${t.n}</b></div>
      ${!month && t.months ? `<div class="stat"><small>a month on average</small><b class="sm">${rm(t.perMonthSen, { whole: true })}</b></div>` : ""}
    </div>
    ${!month && t.first ? `<p class="note">Since ${esc(monthName(monthOf(t.first)))}${loading ? " · loading older months…" : ""}.</p>` : ""}
    ${month && b && plan && !q ? `<p class="note">With ${bills.length ? `${rm(billSen, { whole: true })} of bills` : "no bills"}: ${rm(t.sen + billSen, { whole: true })} of the ${rm(planSen, { whole: true })} planned for ${esc(b.name)}${t.sen + billSen > planSen ? ` <span class="lpover">+${rm(t.sen + billSen - planSen, { whole: true })} over</span>` : ""}.</p>` : ""}`;
  if (!items.length) {
    const dayToDay = [bucketFor(plan, "essentials"), bucketFor(plan, "fun")].includes(bucket);
    const none = q ? `Nothing matches “${esc(q)}”${month ? " in this month. Try All months." : "."}`
      : b && !dayToDay ? `Day-to-day spending doesn't go in ${esc(b.name)}: only bills do.`
      : "Nothing spent here yet.";
    return `${tiles}${bills.length ? billsHtml(bills) : ""}<p class="note">${none}</p>`;
  }
  return `${tiles}
    ${bills.length ? billsHtml(bills) : ""}
    <h3 class="lth">Where it went <span class="note">tap a shop to follow it</span></h3>
    <div class="lsshops">${shopList.map((s) => `<button type="button" class="lsshop" data-lshop="${esc(s.key)}">
      <span class="lmain"><b>${esc(s.name)}</b><small>${times(s.n)} · last ${shortDate(s.last)}</small></span>
      <span class="lamt">${money(s.sen)}</span>
      <span class="lbarbg thin"><i style="width:${Math.max(2, Math.round((Math.max(0, s.sen) / big) * 100))}%"></i></span>
    </button>`).join("")}</div>
    ${shops.length > SHOPS_SHOWN ? `<button type="button" class="mini" data-ls="allshops">${st.allShops ? "Show fewer" : `Show all ${shops.length} shops`}</button>` : ""}
    ${cats.length > 1 ? `<h3 class="lth">By category</h3>
    <div class="lcats">${cats.map((c) => `<div class="lcat"><span>${cat(c.cat).icon} ${esc(cat(c.cat).name)}</span><i style="width:${Math.max(3, Math.round((Math.max(0, c.sen) / bigCat) * 100))}%"></i><b>${rm(c.sen, { whole: true })}</b></div>`).join("")}</div>` : ""}
    <h3 class="lth">Every item</h3>
    ${itemsHtml(items)}`;
}
function billsHtml(bills) {
  return `<h3 class="lth">Bills this month</h3>
    <div class="lpbl">${bills.map((r) => `<div class="lpb lsrow">
      <span class="lpbn"><b>${esc(r.c.name)}</b><small>${r.paid ? `✓ paid ${shortDate(r.paid.date)}` : `due ${shortDate(r.due)}`}</small></span>
      <span class="lpba">${rm(r.amountSen)}</span>
    </div>`).join("")}</div>`;
}
// Items grouped by month (newest first), a page at a time. Tapping one follows its shop.
function itemsHtml(items) {
  const names = Object.fromEntries(ctx.people().map((p) => [p.id, p.name]));
  const whole = Object.fromEntries(byMonth(items).map((g) => [g.month, g]));
  return `${byMonth(items.slice(0, st.shown)).map((g) => `<div class="lsmonth">
      <h4>${esc(monthName(g.month))} <span>${rm(whole[g.month].sen)} · ${times(whole[g.month].n)}</span></h4>
      <div class="llist">${g.items.map((t) => `<div class="lrow"><button type="button" class="lopen" data-lshop="${esc(shopKey(t))}">
        <span class="lic" aria-hidden="true">${cat(t.cat).icon}</span>
        <span class="lmain"><b>${esc(t.merchant || t.raw || cat(t.cat).name)}</b><small>${shortDate(t.date)} · ${esc(names[t.spentBy] ?? "")} · ${esc(cat(t.cat).name)}</small></span>
        <span class="lamt${t.amountSen < 0 ? " cr" : ""}">${money(t.amountSen)}</span>
      </button></div>`).join("")}</div>
    </div>`).join("")}
    ${items.length > st.shown ? `<button type="button" class="mini" data-ls="more">Show more (${items.length - st.shown} left)</button>` : ""}`;
}

// ---------- one shop, its whole life ----------
function tracker(plan, bucket) {
  const now = monthOf(ctx.today()), s = shopTrack(all(), plan, st.shop, { person: st.who || null, month: now });
  const b = bucketsOf(plan).find((x) => x.id === bucket);
  const back = `<button type="button" class="mini" data-ls="unshop">← ${b ? esc(b.name) : "All spending"}</button>`;
  if (!s.n) return `${back}<p class="note">Nothing at ${esc(s.name)}${st.who ? " for this person" : ""}.</p>`;
  const thisMonth = s.recent.at(-1).sen, big = Math.max(...s.recent.map((m) => m.sen), 1), diff = thisMonth - s.perMonthSen;
  return `${back}
    <h3 class="lsname">${esc(s.name)}</h3>
    <div class="stats">
      <div class="stat"><small>All time</small><b>${rm(s.sen, { whole: true })}</b></div>
      <div class="stat"><small>a month on average</small><b class="sm">${rm(s.perMonthSen, { whole: true })}</b></div>
      <div class="stat"><small>a usual visit</small><b class="sm">${rm(s.perVisitSen)}</b></div>
    </div>
    <p class="note">${times(s.n)} since ${shortDate(s.first)} ${esc(s.first.slice(0, 4))} · last ${shortDate(s.last)}${s.n > 1 ? ` · ${rm(s.lowSen)} to ${rm(s.highSen)} a visit` : ""}.</p>
    ${s.months.length > 1 ? `<p class="note">This month so far: <b>${rm(thisMonth, { whole: true })}</b>, ${diff === 0 ? "the same as" : `${rm(Math.abs(diff), { whole: true })} ${diff > 0 ? "more than" : "less than"}`} a usual month.</p>` : ""}
    <h3 class="lth">Last 12 months</h3>
    <div class="lsbars" role="img" aria-label="${s.recent.map((m) => `${monthName(m.month)} ${rm(m.sen, { whole: true })}`).join(", ")}">${s.recent.map((m) => `<div class="lsbar${m.month === now ? " now" : ""}">
      <i style="height:${m.sen > 0 ? Math.max(3, Math.round((m.sen / big) * 100)) : 0}%"></i><small>${esc(monthName(m.month, { short: true }))}</small>
    </div>`).join("")}</div>
    <h3 class="lth">Each month</h3>
    <div class="lpbl">${s.months.map((g) => `<div class="lpb lsrow"><span class="lpbn"><b>${esc(monthName(g.month))}</b><small>${times(g.n)}</small></span><span class="lpba">${rm(g.sen)}</span></div>`).join("")}</div>
    <h3 class="lth">Every visit</h3>
    ${itemsHtml(s.items)}`;
}

function click(b) {
  if (b.dataset.lsb) { location.hash = `#ledger/spend/${b.dataset.lsb}`; return; }
  if (b.dataset.lsw != null) { st.who = b.dataset.lsw; st.shown = PAGE; renderSpend(); return; }
  if (b.dataset.lshop) { st.shop = b.dataset.lshop; st.shown = PAGE; paintBody(); $("ledgerSpend").scrollIntoView({ block: "start" }); return; }
  const a = b.dataset.ls;
  if (a === "unshop") { st.shop = null; st.shown = PAGE; paintBody(); }
  if (a === "allshops") { st.allShops = !st.allShops; paintBody(); }
  if (a === "more") { st.shown += PAGE; paintBody(); }
}
