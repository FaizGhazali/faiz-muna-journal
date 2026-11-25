// Stocky receipt scanning, the pages: #stocky/receipts (scan + history), #stocky/scan (a picture the widget app
// shared) and #stocky/receipt/<id> (check the lines, then save them as buys). stockyui.js routes to these and
// passes the Stocky data in through initReceipts(); the rules (reading, checking, matching, buys) are pure in
// logic/receipt.js, the picture and the reader in receiptread.js. Plan: docs/receipt-scan-plan.md.
import { collection, doc, setDoc, updateDoc, deleteDoc, onSnapshot } from "../../core/fs.js";
import { confirmDelete } from "../../core/confirm.js";
import { $, esc, parse, today } from "../../core/util.js";
import { ico } from "../../core/icons.js";
import { UNITS, amount, money, readItem } from "../../logic/stocky.js";
import { readReceipt, checkReceipt, matchAll, toBuys, newAliases, niceName, receiptList, buyQty, num, STATUS } from "../../logic/receipt.js";
import { ledgerShopOf, shopLabel } from "../../logic/shops.js";
import { readerReady, shrink, readPicture, readerErrorText, takeShared, hasScannerApp, scannerLink, SAMPLE } from "./receiptread.js";

const day = (d) => parse(d).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
let S, cols = {}, receipts = [], aliases = [], unsubs = [];
let scan = null; // { step: "reading" | "error", msg } while a picture is being read
let filter = ""; // history filter: "" (all) | needs_review | confirmed (kept in memory)
let scannerApp = false; // the widget app's scanner is on this phone
const drafts = new Map(); // receipt id → the copy being checked; typing lives here until Save

// S: { db, commit, me, demo, token, pantry(), kinds(), list(), ledgerShops(), lastKind(), refresh(force), shopsHtml() }
export function initReceipts(opts) {
  S = opts;
  for (const c of ["receipts", "receiptAliases", "pantry", "buys", "shopList", "kinds"]) cols[c] = collection(S.db, c);
  hasScannerApp().then((on) => { scannerApp = on; });
}
export function startReceipts() {
  const on = (c, set) => unsubs.push(onSnapshot(cols[c], (s) => { set(s.docs.map((d) => ({ id: d.id, ...d.data() }))); S.refresh(); }));
  on("receipts", (v) => { receipts = v; });
  on("receiptAliases", (v) => { aliases = v; });
}
export function stopReceipts() { unsubs.forEach((u) => u()); unsubs = []; }
// Scanning shows for the family once the reader's address is set, and always in the demo (a made-up answer).
export const canScan = () => S?.demo || readerReady();

// ---------- reading a picture ----------
async function readFile(file) {
  scan = { step: "reading", msg: "Reading your receipt…" };
  if (!location.hash.startsWith("#stocky/receipts")) location.hash = "#stocky/receipts"; else S.refresh(true);
  try {
    let answer, model = "sample";
    if (S.demo) { await new Promise((r) => setTimeout(r, 900)); answer = { ...SAMPLE, date: today() }; }
    else {
      const b64 = await shrink(file), token = await S.token();
      ({ receipt: answer, model } = await readPicture(b64, token));
      // Doesn't add up (or nothing readable)? Ask once more with the stronger model.
      const first = readReceipt(answer, today());
      if (first.error || !checkReceipt(first.receipt).ok) {
        scan.msg = "Checking it again more carefully…"; S.refresh(true);
        try {
          const again = await readPicture(b64, token, true), second = readReceipt(again.receipt, today());
          if (!second.error && (first.error || checkReceipt(second.receipt).ok)) ({ receipt: answer, model } = again);
        } catch (_) { /* keep the first answer */ }
      }
    }
    const { receipt, error } = readReceipt(answer, today());
    if (error) { scan = { step: "error", msg: `${error} Try a flatter, closer photo of the whole receipt.` }; S.refresh(true); return; }
    const ok = checkReceipt(receipt).ok, sh = ledgerShopOf(receipt.shop, S.ledgerShops());
    const shop = sh ? shopLabel(sh).main : niceName(receipt.shop);
    const ref = doc(cols.receipts), now = Date.now();
    const body = {
      shop, ...(receipt.branch ? { branch: receipt.branch } : {}), date: receipt.date, total: receipt.total ?? null,
      discounts: receipt.discounts, rounding: receipt.rounding,
      status: ok ? STATUS.parsed : STATUS.review, lines: matchAll(receipt.lines, shop, aliases, S.pantry()),
      raw: JSON.stringify(answer).slice(0, 20000), model, by: S.me(), created: now, updated: now,
    };
    await S.commit(() => setDoc(ref, strip(body)), ok ? "Receipt read. Check it, then save." : "Receipt read, but it doesn't add up. Check the lines.");
    scan = null;
    location.hash = `#stocky/receipt/${ref.id}`;
  } catch (e) {
    scan = { step: "error", msg: e?.status != null || e?.message?.startsWith("reader-") || e instanceof TypeError ? readerErrorText(e) : "That picture couldn't be opened. Try another one." };
    S.refresh(true);
  }
}
// Firestore refuses undefined anywhere in a doc.
const strip = (o) => JSON.parse(JSON.stringify(o));

// #stocky/scan: the widget app shared a picture and the service worker kept it for us. Read once, then the
// receipts page shows how it's going.
let taking = false;
export function scanPage() {
  if (!taking && scan?.step !== "reading") {
    taking = true;
    scan = { step: "reading", msg: "Opening the picture…" };
    takeShared().then((blob) => {
      if (blob) return readFile(blob);
      scan = { step: "error", msg: "No receipt picture came through. Scan it again." };
      location.hash = "#stocky/receipts";
    }).finally(() => { taking = false; });
  }
  return receiptsPage();
}

// ---------- pages ----------
const PILLS = { [STATUS.parsed]: ["--under", "To check"], [STATUS.review]: ["--over", "Doesn't add up"], [STATUS.confirmed]: ["--good", "Saved"] };
const pill = (s) => `<span class="pill" style="--c:var(${(PILLS[s] || PILLS.parsed)[0]})">${(PILLS[s] || PILLS.parsed)[1]}</span>`;
const scanButtons = () => {
  if (S.demo) return `<button type="button" class="primary" data-rc="sample">${ico("receipt")} Try a sample receipt</button>`;
  const pick = `<label class="btn${scannerApp ? "" : " primary"} rc-pick">${ico("camera")} ${scannerApp ? "Take a photo instead" : "Scan receipt"}<input type="file" accept="image/*" capture="environment" data-rc-file hidden></label>
    <label class="btn rc-pick">${ico("image")} Choose a picture<input type="file" accept="image/*" data-rc-file hidden></label>`;
  return scannerApp ? `<a class="btn primary" href="${esc(scannerLink())}">${ico("receipt")} Scan receipt</a>${pick}` : pick;
};

export function receiptsPage() {
  const all = receiptList(receipts), shown = receiptList(receipts, filter), todo = all.filter((r) => r.status !== STATUS.confirmed).length;
  const chip = (v, t) => `<button type="button" class="chip" data-rc="filter" data-v="${v}" aria-pressed="${filter === v}">${t}</button>`;
  return `<div class="fdtop"><a class="btn" href="#stocky">← Back</a></div>
  <section class="panel rc-scan" aria-labelledby="rcScanTitle" data-title="Scan a receipt">
    <h2 id="rcScanTitle">Scan a receipt</h2>
    <p class="note">Take a photo of a shop receipt and Stocky adds what you bought, with the prices. You check every line before anything is saved. The photo isn't kept.</p>
    ${scan ? `<p class="rc-status${scan.step === "error" ? " bad" : ""}" role="status">${scan.step === "reading" ? `<span class="rc-spin" aria-hidden="true"></span>` : ico("alert")} ${esc(scan.msg)}</p>` : ""}
    ${scan?.step === "reading" ? "" : `<div class="actions">${scanButtons()}</div>`}
    ${S.demo ? `<p class="note">In the demo a made-up receipt is read instead of a photo.</p>` : ""}
  </section>
  <section class="panel" aria-labelledby="rcListTitle" data-title="Receipts">
    <div class="mhead"><h2 id="rcListTitle">Receipts</h2></div>
    ${all.length ? `<div class="chips" role="group" aria-label="Show">${chip("", "All")}${chip(STATUS.review, "Doesn't add up")}${chip(STATUS.parsed, `To check${todo ? ` (${todo})` : ""}`)}${chip(STATUS.confirmed, "Saved")}</div>` : ""}
    ${shown.length ? `<div class="mlist">${shown.map((r) => `<a class="mitem sk-link" href="#stocky/receipt/${esc(r.id)}"><div><b>${esc(r.shop || "Shop not read")}</b><small>${esc(day(r.date))} · ${r.lines.filter((l) => l.lineTotal > 0).length} lines</small></div><span>${r.total != null ? money(r.total) : ""} ${pill(r.status)}</span></a>`).join("")}</div>`
      : `<p class="note">${all.length ? "None like that." : "No receipts yet."}</p>`}
  </section>`;
}

function draftOf(r) {
  if (!drafts.has(r.id) || drafts.get(r.id).updated !== r.updated) {
    drafts.set(r.id, { ...structuredClone(r), news: {} }); // news: line index → { name, unit, pack } for a new item
  }
  return drafts.get(r.id);
}
const asReceipt = (d) => ({ ...d, total: num(d.total), lines: d.lines.map((l) => ({ ...l, qty: num(l.qty) ?? 1, lineTotal: num(l.lineTotal) ?? 0 })) });

function checkHtml(d) {
  const all = checkReceipt(asReceipt(d)), skipped = d.lines.some((l) => l.skip);
  if (all.total == null) return `<p class="rc-check bad">${ico("alert")} No total was read. Type the printed total to check the lines.</p>`;
  if (all.ok) return `<p class="rc-check good">${ico("ok")} The lines add up to the printed total, ${money(all.total)}.</p>`;
  const off = all.diff > 0 ? `${money(all.diff)} more than` : `${money(-all.diff)} less than`;
  return `<p class="rc-check bad">${ico("alert")} The lines come to ${money(all.sum)}, ${off} the printed ${money(all.total)}.${all.badLines.length ? ` Check the line${all.badLines.length === 1 ? "" : "s"} marked.` : " A line may be misread or missing."}${skipped ? " Skipped lines still count here." : ""}</p>`;
}
const STATE = { alias: ["ok", "Known"], suggested: ["help", "Is this right?"], manual: ["check", "Picked"] };
function lineHtml(d, l, i, bad, done) {
  if (num(l.lineTotal) < 0) return `<div class="rc-line disc" data-i="${i}"><div class="rc-top"><span class="rc-raw">${esc(l.raw)}</span><b>${money(num(l.lineTotal))}</b></div><small class="note">Discount, taken off the line above.</small></div>`;
  const p = S.pantry().find((x) => x.id === l.item), st = l.item ? STATE[l.match] || STATE.manual : null, nw = d.news[i];
  if (done) return `<div class="rc-line${l.skip ? " skip" : ""}"><div class="rc-top"><span class="rc-raw">${esc(l.raw)}</span><b>${money(num(l.lineTotal))}</b></div>
    <small>${l.skip ? "Skipped" : p ? `<a href="#stocky/item/${esc(p.id)}">${esc(p.name)}</a>` : "Not saved"}</small></div>`;
  const opts = S.pantry().map((x) => `<option value="${esc(x.id)}"${x.id === l.item ? " selected" : ""}>${esc(x.name)}</option>`).join("");
  return `<div class="rc-line${l.skip ? " skip" : ""}${bad ? " bad" : ""}" data-i="${i}">
    <div class="rc-edit">
      <input type="text" name="raw" value="${esc(l.raw)}" maxlength="80" aria-label="Name on the receipt">
      <label class="rc-n">×<input type="number" name="qty" inputmode="decimal" min="0" step="any" value="${esc(l.qty)}" aria-label="How many"></label>
      <label class="rc-n">RM<input type="number" name="lineTotal" inputmode="decimal" step="0.01" value="${esc(l.lineTotal)}" aria-label="Line total"></label>
    </div>
    ${l.skip ? `<p class="note">Skipped: not added to Stocky. <button type="button" class="linkbtn" data-rc="skip" data-i="${i}">Add it after all</button></p>` : `
    <div class="rc-pickrow">
      <select name="item" aria-label="Stocky item for ${esc(l.raw)}"><option value=""${l.item || nw ? "" : " selected"}>Pick an item…</option>${opts}<option value="new"${nw ? " selected" : ""}>+ New item</option></select>
      ${st ? `<span class="rc-state is-${l.match || "manual"}">${ico(st[0])} ${st[1]}</span>` : ""}
      ${l.match === "suggested" ? `<button type="button" class="mini primary" data-rc="yes" data-i="${i}" aria-label="Yes, it's ${esc(p?.name || "")}">${ico("check")} Yes</button>` : ""}
      <button type="button" class="mini" data-rc="skip" data-i="${i}" aria-pressed="false">Skip</button>
    </div>
    ${nw ? `<div class="rc-new two3">
      <label>Name<input type="text" name="newName" maxlength="60" value="${esc(nw.name)}"></label>
      <label>Counted in<select name="newUnit">${nw.unit ? "" : `<option value="" selected disabled>Pick one</option>`}${Object.keys(UNITS).map((u) => `<option value="${u}"${nw.unit === u ? " selected" : ""}>${{ g: "grams", ml: "ml", pcs: "pieces" }[u]}</option>`).join("")}</select></label>
      <label>One pack<input type="number" name="newPack" inputmode="decimal" min="0" value="${esc(nw.pack)}" placeholder="5000 g, 30 pcs"></label>
    </div>` : p ? `<label class="rc-amt">Adds<input type="number" name="amount" inputmode="decimal" min="0" step="any" value="${esc(l.amount ?? buyQty(num(l.qty), p))}"><span>${esc(p.unit)}</span><small>${esc(amount(Number(l.amount ?? buyQty(num(l.qty), p)) || 0, p.unit))} to ${esc(p.name)}</small></label>` : ""}`}
  </div>`;
}

export function receiptPage(id) {
  const r = receipts.find((x) => x.id === id);
  if (!r) return `<div class="fdtop"><a class="btn" href="#stocky/receipts">← Receipts</a></div><section class="panel"><p>${receipts.length ? "This receipt isn't here any more." : "Opening…"}</p></section>`;
  const done = r.status === STATUS.confirmed, d = draftOf(r), bad = new Set(checkReceipt(asReceipt(d)).badLines);
  const count = d.lines.filter((l, i) => num(l.lineTotal) > 0 && !l.skip && (l.item || d.news[i])).length;
  return `<div class="fdtop"><a class="btn" href="#stocky/receipts">← Receipts</a></div>
  <form class="panel mform rc-review" data-rcform="${esc(r.id)}" aria-labelledby="rcTitle" data-title="Receipt" novalidate>
    <div class="mhead"><h2 id="rcTitle">${done ? esc(r.shop || "Receipt") : "Check your receipt"}</h2>${pill(r.status)}</div>
    ${done ? `<p class="note">${esc(day(r.date))}${r.total != null ? ` · ${money(r.total)}` : ""} · saved as ${r.buys ?? count} buy${(r.buys ?? count) === 1 ? "" : "s"}.</p>`
      : `<div class="two3"><label>Shop<input type="text" name="shop" list="skShops" maxlength="60" value="${esc(d.shop)}"></label>
      <label>Date<input type="date" name="date" value="${esc(d.date)}" max="${today()}"></label>
      <label>Printed total, RM<input type="number" name="total" inputmode="decimal" step="0.01" value="${esc(d.total ?? "")}"></label></div>
      ${S.shopsHtml()}
      <div data-rc-check>${checkHtml(d)}</div>`}
    <div class="rc-lines">${d.lines.map((l, i) => lineHtml(d, l, i, bad.has(i), done)).join("")}</div>
    ${done ? "" : `<p class="note sk-msg" role="status" data-rc-msg></p>
    <div class="actions"><button type="submit" class="primary" data-rc-save>Save ${count} buy${count === 1 ? "" : "s"}</button></div>`}
    <div class="actions"><button type="button" class="danger mini" data-rc="del">Delete this receipt</button></div>
  </form>`;
}

// ---------- saving ----------
async function save(f) {
  const r = receipts.find((x) => x.id === f.dataset.rcform); if (!r) return;
  const d = draftOf(r), say = (t) => { const m = f.querySelector("[data-rc-msg]"); if (m) m.textContent = t; };
  const rec = asReceipt(d);
  if (!rec.date) { say("Pick the receipt's date."); return; }
  const open = rec.lines.map((l, i) => ({ l, i })).filter(({ l, i }) => l.lineTotal > 0 && !l.skip && !l.item && !d.news[i]);
  if (open.length) { say(`Pick an item for ${open.length} line${open.length === 1 ? "" : "s"}, or Skip ${open.length === 1 ? "it" : "them"}.`); f.querySelector(`[data-i="${open[0].i}"] select`)?.focus(); return; }
  // New items first, so their lines have ids.
  const kinds = S.kinds().map((k) => k.id), made = [], pantry = [...S.pantry()];
  for (const [i, nw] of Object.entries(d.news)) {
    if (rec.lines[i].skip) continue;
    const same = pantry.find((p) => p.name.toLowerCase() === String(nw.name).trim().toLowerCase());
    if (same) { rec.lines[i].item = same.id; continue; }
    if (!nw.unit) { say(`Pick what ${nw.name || "the new item"} is counted in.`); return; }
    const { item, error } = readItem({ name: nw.name, kind: S.lastKind() || "food", unit: nw.unit, pack: nw.pack || (nw.unit === "pcs" ? 1 : ""), links: [] }, kinds);
    if (error) { say(`${nw.name || "New item"}: ${error}`); return; }
    const ref = doc(cols.pantry), body = { ...item, created: Date.now(), updated: Date.now() };
    made.push([ref, body]); pantry.push({ id: ref.id, ...body }); rec.lines[i].item = ref.id; rec.lines[i].match = "manual";
  }
  const buys = toBuys(rec, pantry, r.id), now = Date.now(), al = newAliases(rec, aliases);
  const bought = new Set(buys.map((b) => b.item)), ticked = S.list().filter((x) => x.item && bought.has(x.item));
  const lines = rec.lines.map((l) => strip(l));
  drafts.delete(r.id);
  const shopTxt = rec.shop ? ` from ${rec.shop}` : "";
  await S.commit(() => Promise.all([
    ...made.map(([ref, body]) => setDoc(ref, body)),
    ...buys.map((b) => setDoc(doc(cols.buys), { ...b, by: S.me(), at: now })),
    ...al.map((a) => setDoc(doc(cols.receiptAliases, a.id), { shop: a.shop, raw: a.raw, item: a.item, by: S.me(), created: aliases.find((x) => x.id === a.id)?.created || now, updated: now })),
    ...ticked.map((x) => deleteDoc(doc(cols.shopList, x.id))),
    updateDoc(doc(cols.receipts, r.id), { shop: rec.shop, date: rec.date, total: rec.total ?? null, lines, status: STATUS.confirmed, buys: buys.length, updated: now }),
  ]), `Saved ${buys.length} buy${buys.length === 1 ? "" : "s"}${shopTxt}.${ticked.length ? ` ${ticked.length} ticked off the list.` : ""}`);
  S.refresh(true);
  $("stocky").querySelector(".rc-review")?.scrollIntoView({ behavior: "smooth", block: "start" }); // stay on it, now saved
}
// Every delete asks first (safe-delete skill). A saved receipt's buys go with it, so the stock guess forgets them too.
async function remove(id) {
  const r = receipts.find((x) => x.id === id); if (!r) return;
  const mine = S.buys().filter((b) => b.receipt === id);
  const ok = await confirmDelete({ title: `Delete the ${r.shop || "shop"} receipt?`, yes: "Delete it",
    body: mine.length ? `<p>Its ${mine.length} buy${mine.length === 1 ? "" : "s"} go too, and the days-left guesses are worked out again without them.</p>` : `<p>Nothing was saved from it yet.</p>` });
  if (!ok) return;
  drafts.delete(id);
  location.hash = "#stocky/receipts";
  await S.commit(() => Promise.all([deleteDoc(doc(cols.receipts, id)), ...mine.map((b) => deleteDoc(doc(cols.buys, b.id)))]), "Receipt deleted.");
}

// ---------- events (on #stocky; only data-rc / data-rcform things) ----------
export function wireReceipts(host) {
  const draftFor = (el) => { const f = el.closest("[data-rcform]"); const r = f && receipts.find((x) => x.id === f.dataset.rcform); return r && { f, d: draftOf(r) }; };
  host.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-rc]"); if (!b) return;
    const act = b.dataset.rc, x = draftFor(b), i = Number(b.dataset.i);
    if (act === "sample") readFile(null);
    if (act === "filter") { filter = b.dataset.v; S.refresh(true); }
    if (act === "del") await remove(b.closest("[data-rcform]").dataset.rcform);
    if (!x) return;
    if (act === "yes") { x.d.lines[i].match = "manual"; x.f.dataset.dirty = "1"; S.refresh(true); }
    if (act === "skip") { x.d.lines[i].skip = !x.d.lines[i].skip; x.f.dataset.dirty = "1"; S.refresh(true); }
  });
  host.addEventListener("change", (ev) => {
    if (ev.target.matches("[data-rc-file]")) { const file = ev.target.files?.[0]; ev.target.value = ""; if (file) readFile(file); return; }
    const x = draftFor(ev.target); if (!x) return;
    const row = ev.target.closest("[data-i]"), i = row ? Number(row.dataset.i) : null, l = i != null ? x.d.lines[i] : null;
    if (ev.target.name === "item") {
      delete x.d.news[i]; delete l.amount;
      if (ev.target.value === "new") { x.d.news[i] = { name: niceName(l.raw), unit: "", pack: "" }; delete l.item; delete l.match; }
      else if (ev.target.value) { l.item = ev.target.value; l.match = "manual"; }
      else { delete l.item; delete l.match; }
      S.refresh(true);
      host.querySelector(`[data-i="${i}"] ${x.d.news[i] ? '[name="newUnit"]' : "select"}`)?.focus();
    }
    if (ev.target.name === "newUnit") x.d.news[i].unit = ev.target.value;
  });
  host.addEventListener("input", (ev) => {
    const x = draftFor(ev.target); if (!x) return;
    x.f.dataset.dirty = "1";
    const n = ev.target.name, row = ev.target.closest("[data-i]"), i = row ? Number(row.dataset.i) : null;
    if (["shop", "date", "total"].includes(n)) x.d[n] = ev.target.value;
    if (i != null && ["raw", "qty", "lineTotal", "amount"].includes(n)) {
      x.d.lines[i][n] = ev.target.value;
      if (n === "qty") { delete x.d.lines[i].amount; const a = row.querySelector('[name="amount"]'), p = S.pantry().find((q) => q.id === x.d.lines[i].item); if (a && p) a.value = buyQty(num(ev.target.value), p); }
    }
    if (i != null && n === "newName") x.d.news[i].name = ev.target.value;
    if (i != null && n === "newPack") x.d.news[i].pack = ev.target.value;
    if (["total", "qty", "lineTotal"].includes(n)) { const c = x.f.querySelector("[data-rc-check]"); if (c) c.innerHTML = checkHtml(x.d); }
  });
  host.addEventListener("submit", (ev) => { if (ev.target.matches("[data-rcform]")) { ev.preventDefault(); save(ev.target); } });
}
