// Ledger: what a money-plan bucket was spent on (#ledger/spend/<bucket id>, or "all"), opened by tapping
// a bucket on the money plan. Pick a month or All months, Both or one person, search a shop or category;
// tap a shop to see its whole history (every month, a usual visit, the last 12 months as bars).
// A shop's page has Edit (top right): a popup (#lsSheet) puts the whole shop in another bucket (a rule on
// the plan, `shopBuckets`, so new purchases follow) and/or another category (every item, plus a merchant
// rule so new purchases get it too).
// The page loads every Ledger item once (the live list only holds the last LOAD_DAYS). Sums: logic/bucketspend.js.
import { collection, doc, getDocs, updateDoc, writeBatch } from "../../core/fs.js";
import { $, esc } from "../../core/util.js";
import { SYSTEM_CATEGORIES, rm, shortDate, categorise, norm } from "../../logic/ledger.js";
import { suggestPattern } from "../../logic/ledgerimport.js";
import { bucketsOf, bucketFor, monthOf, monthName, monthBills, txnBucket, catBucket, shopBucketsWith } from "../../logic/moneyplan.js";
import { ALL, bucketItems, byMonth, byShop, byCat, totals, shopTrack, monthsWith, shopKey, shopName, usualCat } from "../../logic/bucketspend.js";
import { planState, bucketColours } from "./plan.js";

const ROUTE = /^#ledger\/spend\/([\w-]+)$/;
export const spendRoute = () => location.hash.match(ROUTE)?.[1] ?? null;
const SHOPS_SHOWN = 6, PAGE = 40;
const CATS = SYSTEM_CATEGORIES.filter((c) => !c.hidden);
const BATCH = 400; // writes per batch
const cat = (id) => SYSTEM_CATEGORIES.find((c) => c.id === id) ?? SYSTEM_CATEGORIES.find((c) => c.id === "other");
const money = (sen) => `${rm(Math.abs(sen))}${sen < 0 ? " CR" : ""}`;
const times = (n) => `${n} ${n === 1 ? "time" : "times"}`;

let ctx, history = null, loading = false, frameKey = "";
// month: "YYYY-MM" or ALL (null = this month); who: "" = both; shop: the shop being followed (its key).
// msg: what the last Edit did. ed: the Edit popup's choices { key, bucket, cat, touched }.
const st = { month: null, who: "", q: "", shop: null, allShops: false, shown: PAGE, route: null, msg: "" };
let ed = null;

export function initSpend(c) {
  ctx = c;
  const host = $("ledgerSpend");
  host.addEventListener("click", (ev) => { const b = ev.target.closest("button"); if (b) click(b); });
  host.addEventListener("input", (ev) => { if (ev.target.id === "lsQ") { st.q = ev.target.value; st.shown = PAGE; st.allShops = false; paintBody(); } });
  host.addEventListener("change", (ev) => { if (ev.target.id === "lsMonth") { st.month = ev.target.value; st.shown = PAGE; renderSpend(); } });
  const sheet = $("lsSheet");
  sheet.addEventListener("click", (ev) => {
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.lsebucket) { ed.bucket = b.dataset.lsebucket; ed.touched = true; paintSheet(); }
    if (b.dataset.lse === "close") closeEdit();
    if (b.dataset.lse === "save") saveEdit();
  });
  sheet.addEventListener("change", (ev) => {
    if (ev.target.id !== "lseCat") return;
    ed.cat = ev.target.value;
    // Until a bucket is picked here, it follows the new category (or the shop's own rule).
    if (!ed.touched) ed.bucket = planState().plan?.shopBuckets?.[ed.key] ?? catBucket(ed.cat, planState().plan);
    paintSheet();
  });
  addEventListener("hashchange", () => {
    if (spendRoute() !== st.route) { st.shop = null; st.msg = ""; st.allShops = false; st.shown = PAGE; frameKey = ""; }
    closeEdit();
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
  el.innerHTML = `${st.msg ? `<p class="lsmsg" role="status">${esc(st.msg)}</p>` : ""}${st.shop ? tracker(plan, bucket) : body(plan, bucket)}`;
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

// ---------- Edit: a whole shop's bucket and category ----------
const bucketName = (id) => bucketsOf(planState().plan).find((b) => b.id === id)?.name ?? id;
const shopItems = (key) => all().filter((t) => t.type !== "payment" && shopKey(t) === key);
function openEdit() {
  const items = shopItems(st.shop); if (!items.length) return;
  const c = usualCat(items), plan = planState().plan;
  ed = { key: st.shop, name: shopName(items[0]), cat: c, bucket: txnBucket({ ...items[0], cat: c, bucket: null }, plan) ?? catBucket(c, plan), touched: false, from: c };
  paintSheet();
  const d = $("lsSheet"); if (!d.open) d.showModal();
}
function closeEdit() { ed = null; const d = $("lsSheet"); if (d?.open) d.close(); }
function paintSheet() {
  const plan = planState().plan, items = shopItems(ed.key);
  const mix = Object.entries(items.reduce((o, t) => ({ ...o, [t.cat]: (o[t.cat] ?? 0) + 1 }), {}));
  const own = ed.bucket !== catBucket(ed.cat, plan);
  $("lsSheet").innerHTML = `<div class="gsin">
    <div class="mhead"><h3 id="lsSheetTitle">Edit ${esc(ed.name)}</h3><button type="button" class="mini lsx" data-lse="close" aria-label="Close">✕</button></div>
    <p class="note">For all ${items.length} ${items.length === 1 ? "purchase" : "purchases"} here, and new ones.</p>
    ${plan ? `<div class="lbl"><span>Counts in</span><div class="chips" role="group" aria-label="Counts in which bucket">${bucketsOf(plan).map((b) => `<button type="button" class="chip" data-lsebucket="${b.id}" aria-pressed="${b.id === ed.bucket}">${esc(b.name)}</button>`).join("")}</div></div>`
      : `<p class="note">Save your money plan first to pick a bucket.</p>`}
    <label>Category<select id="lseCat">${CATS.map((c) => `<option value="${c.id}"${c.id === ed.cat ? " selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}</select></label>
    <p class="note">${mix.length > 1 ? `Now: ${mix.map(([c, n]) => `${esc(cat(c).name)} ${n}`).join(", ")}. All become ${esc(cat(ed.cat).name)}. ` : ""}${plan ? (own ? `${esc(cat(ed.cat).name)} usually counts in ${esc(bucketName(catBucket(ed.cat, plan)))}; this shop goes in ${esc(bucketName(ed.bucket))}.` : `${esc(cat(ed.cat).name)} counts in ${esc(bucketName(ed.bucket))}.`) : ""}</p>
    <div class="actions"><button type="button" class="primary" data-lse="save">Save</button><button type="button" data-lse="close">Cancel</button></div>
    <p class="msg" id="lseMsg" aria-live="polite"></p>
  </div>`;
}
// Saves the popup: every item gets the category (and loses an older per-item bucket, so the shop rule leads),
// a merchant rule gives new purchases the category, and the plan's shopBuckets gives them the bucket.
async function saveEdit() {
  if (!ed) return;
  const e = ed, plan = planState().plan, items = shopItems(e.key), db = ctx.db(), now = Date.now();
  const patches = items.filter((t) => t.cat !== e.cat || t.bucket != null).map((t) => [t.id, { cat: e.cat, bucket: null, updated: now }]);
  const raw = items[0]?.raw || items[0]?.merchant || "", pattern = norm(suggestPattern(raw));
  const rule = e.cat !== e.from || items.some((t) => t.cat !== e.cat) ? (categorise(raw, ctx.aliases()).cat !== e.cat && pattern.length >= 3) : false;
  const shops = plan ? shopBucketsWith(plan, e.key, e.bucket, e.cat) : null;
  const planChanged = plan && JSON.stringify(shops) !== JSON.stringify(plan.shopBuckets ?? {});
  $("lsSheet").querySelector("[data-lse=save]").disabled = true;
  await ctx.commit(async () => {
    for (let i = 0; i < patches.length || (i === 0 && rule); i += BATCH) {
      const b = writeBatch(db);
      patches.slice(i, i + BATCH).forEach(([id, p]) => b.set(doc(db, "ledgerTxns", id), p, { merge: true }));
      if (i === 0 && rule) b.set(doc(collection(db, "ledgerAliases")), { pattern, match: "prefix", cat: e.cat, priority: 70, from: "user", created: now });
      await b.commit();
    }
    if (planChanged) await updateDoc(doc(db, "ledgerPlan", "main"), { shopBuckets: shops, updated: now });
  });
  // Older items (not in the live list) are patched in the fetched history too, so they move at once.
  const byId = Object.fromEntries(patches);
  history?.forEach((t) => { if (byId[t.id]) Object.assign(t, byId[t.id]); });
  st.msg = `Saved: ${e.name} is ${cat(e.cat).name}${plan ? `, counted in ${bucketName(e.bucket)}` : ""}.`;
  closeEdit();
  renderSpend();
}

// ---------- one shop, its whole life ----------
function tracker(plan, bucket) {
  const now = monthOf(ctx.today()), s = shopTrack(all(), plan, st.shop, { person: st.who || null, month: now });
  const b = bucketsOf(plan).find((x) => x.id === bucket);
  const back = `<button type="button" class="mini" data-ls="unshop">← ${b ? esc(b.name) : "All spending"}</button>`;
  if (!s.n) return `${back}<p class="note">Nothing at ${esc(s.name)}${st.who ? " for this person" : ""}.</p>`;
  const thisMonth = s.recent.at(-1).sen, big = Math.max(...s.recent.map((m) => m.sen), 1), diff = thisMonth - s.perMonthSen;
  return `${back}
    <div class="lsnamerow"><h3 class="lsname">${esc(s.name)}</h3><button type="button" class="mini" data-ls="edit">✎ Edit</button></div>
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
  if (b.dataset.lshop) { st.shop = b.dataset.lshop; st.msg = ""; st.shown = PAGE; paintBody(); $("ledgerSpend").scrollIntoView({ block: "start" }); return; }
  const a = b.dataset.ls;
  if (a === "edit") openEdit();
  if (a === "unshop") { st.shop = null; st.msg = ""; st.shown = PAGE; paintBody(); }
  if (a === "allshops") { st.allShops = !st.allShops; paintBody(); }
  if (a === "more") { st.shown += PAGE; paintBody(); }
}
