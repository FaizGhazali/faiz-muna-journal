// Ledger: import a card statement (PDF read on this device, or pasted lines), check it against what was
// logged, accept in one go, then close the cycle with the real balance and save its rebate.
// The parsing and matching are pure (ledgerimport.js); this file is the #ledgerImport panel.
import { collection, doc, writeBatch } from "../../core/fs.js";
import { $, esc } from "../../core/util.js";
import { confirmDelete } from "../../core/confirm.js";
import { toast } from "../../core/toast.js";
import { SYSTEM_CATEGORIES, rm, shortDate, cycleOf, cycleForTxn, lastStatement, toSen, computeRebate, rebateSnapshot, programFor } from "../../logic/ledger.js";
import { pageLines, parseStatement, parsePasted, checkTotals, reconcile, tally, candidates, suggestPattern, parseSheet, sheetDupes } from "../../logic/ledgerimport.js";

// pdf.js, pinned (sw.js keeps cdn.jsdelivr.net files offline once fetched). Loaded only when a PDF is picked.
const PDFJS = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.min.mjs";
const PDF_WORKER = "https://cdn.jsdelivr.net/npm/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
const BATCH = 400;

const CATS = SYSTEM_CATEGORIES.filter((c) => !c.hidden);
const cat = (id) => SYSTEM_CATEGORIES.find((c) => c.id === id) ?? SYSTEM_CATEGORIES.find((c) => c.id === "other");
const MARK = { matched: "✅", category: "🏷️", amount: "⚠️", new: "➕", missing: "❌" };
const ORDER = ["amount", "category", "new", "missing", "matched"];
const HEAD = {
  amount: "Different amount", category: "Different category", new: "On the statement, not logged", missing: "Logged, not on this statement", matched: "Matched",
};

let ctx, imp = null, pdfLib = null;
// imp: { account, step: "pick" | "password" | "reading" | "review" | "done", file, msg, parsed, res, pick: [{ on, cat }], spentBy, cycle, done }

export function initImport(c) {
  ctx = c;
  const host = $("ledgerImport");
  host.addEventListener("change", onChange);
  host.addEventListener("click", onClick);
  host.addEventListener("submit", (ev) => { ev.preventDefault(); if (ev.target.id === "liPwForm") openPdf($("liPw").value); });
}
export const importing = () => !!imp;
export function startImport(accountId) {
  imp = { account: accountId, step: "pick", msg: "" };
  render();
  $("ledgerImport").scrollIntoView({ behavior: "smooth", block: "start" });
}
const account = () => ctx.accounts().find((a) => a.id === imp?.account);

export function renderImport() {
  const host = $("ledgerImport");
  if (!imp || !account()) { host.hidden = true; host.innerHTML = ""; imp = null; return; }
  host.hidden = false;
  if (imp.step === "review" && $("liList")) return paintSummary(); // keep ticks and choices while data updates
  if (imp.step === "sheet" && $("lsList")) return;
  render();
}

function render() {
  const host = $("ledgerImport"), a = account();
  host.hidden = false;
  const top = `<div class="lhead"><h2 id="liTitle">Import a statement</h2><span class="note">${esc(a.name)}${a.last4 ? ` ··${esc(a.last4)}` : ""}</span></div>`;
  if (imp.step === "pick" || imp.step === "reading") {
    host.innerHTML = `${top}
      <p class="note">Pick the statement PDF from your bank. It's read here on this phone: it's never uploaded or kept.</p>
      <div class="actions">
        <label class="btn primary lfile">📄 Choose statement PDF<input type="file" id="liFile" accept="application/pdf,.pdf"></label>
        <button type="button" id="liCancel">Cancel</button>
      </div>
      <p class="msg" id="liMsg" aria-live="polite">${imp.step === "reading" ? "Reading the statement…" : esc(imp.msg)}</p>
      <details class="lpaste"${imp.paste ? " open" : ""}><summary>No PDF, or it won't read? Paste the lines</summary>
        <p class="note">One item per line: posted date, date, shop, amount. For example <code>21/10/2026, 18/10/2026, ECONSAVE SETIA ALAM, 111.20</code>. Write credits as <code>34.50 CR</code>.</p>
        <div class="two">
          <label>Statement date<input type="date" id="liStmt" value="${esc(imp.pStmt ?? lastStatement(a, ctx.today()))}" max="${ctx.today()}"></label>
          <label>Statement balance, RM<input type="text" id="liBal" inputmode="decimal" autocomplete="off" value="${esc(imp.pBal ?? "")}"></label>
        </div>
        <label>Previous balance, RM <small>optional, to check the total</small><input type="text" id="liPrev" inputmode="decimal" autocomplete="off" value="${esc(imp.pPrev ?? "")}"></label>
        <label>Lines<textarea id="liPaste" rows="6" spellcheck="false">${esc(imp.pText ?? "")}</textarea></label>
        <div class="actions"><button type="button" id="liPasteGo">Check these lines</button></div>
      </details>
      <details class="lpaste"${imp.sheet ? " open" : ""}><summary>Bring in history from a spreadsheet (one-time)</summary>
        <p class="note">In Google Sheets, open your tracker tab, select everything (Ctrl + A, or ⌘ + A), copy it and paste it here. Ledger finds the table with Date, Merchant and Amount (Posted date, Category and Notes are used if they're there), skips anything it already has, and adds the rest to this card.</p>
        <div class="lbl mwho"><span>Spent by</span><div class="seg">${ctx.people().map((q) => `<input type="radio" name="liSheetWho" id="lsw-${q.id}" value="${q.id}"${q.id === (imp.sheetWho ?? ctx.me()) ? " checked" : ""}><label for="lsw-${q.id}">${esc(q.name)}</label>`).join("")}</div></div>
        <label>Copied rows<textarea id="liSheet" rows="6" spellcheck="false">${esc(imp.sheetText ?? "")}</textarea></label>
        <div class="actions"><button type="button" id="liSheetGo">Check these rows</button></div>
      </details>`;
    return;
  }
  if (imp.step === "sheet") return renderSheet(top);
  if (imp.step === "password") {
    host.innerHTML = `${top}
      <form id="liPwForm" class="lpw">
        <p class="note">This PDF is locked. Type the password your bank gave you for statements (often from your IC or birth date). It's used only to open the file here and isn't saved.</p>
        <label>PDF password<input type="password" id="liPw" autocomplete="off"></label>
        <div class="actions"><button type="submit" class="primary">Open</button><button type="button" id="liCancel">Cancel</button></div>
        <p class="msg" id="liMsg" aria-live="polite">${esc(imp.msg)}</p>
      </form>`;
    $("liPw").focus();
    return;
  }
  if (imp.step === "done") {
    host.innerHTML = `${top}<p class="ok">✓ ${esc(imp.done)}</p><div class="actions"><button type="button" id="liClose">Done</button></div>`;
    return;
  }
  renderReview(top);
}

// ---------- reading ----------
async function loadPdf() {
  if (!pdfLib) { pdfLib = await import(PDFJS); pdfLib.GlobalWorkerOptions.workerSrc = PDF_WORKER; }
  return pdfLib;
}
async function openPdf(password) {
  const file = imp?.file; if (!file) return;
  const back = imp.step;
  imp.step = "reading"; imp.msg = ""; render();
  let lines = [];
  try {
    const lib = await loadPdf();
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()), password: password || undefined, isEvalSupported: false }).promise;
    for (let p = 1; p <= pdf.numPages; p++) lines.push(...pageLines((await (await pdf.getPage(p)).getTextContent()).items));
    await pdf.destroy();
  } catch (e) {
    if (e?.name === "PasswordException") { imp.step = "password"; imp.msg = password ? "That password didn't open it. Try again." : ""; return render(); }
    imp.step = back === "password" ? "password" : "pick";
    imp.msg = navigator.onLine === false && !pdfLib ? "The PDF reader needs the internet the first time. Connect and try again." : "This file couldn't be read. Is it the statement PDF? You can also paste the lines below.";
    return render();
  }
  const parsed = parseStatement(lines, ctx.aliases());
  if (parsed.error || !parsed.rows.length) {
    imp.step = "pick"; imp.paste = true;
    imp.msg = lines.join("").trim().length < 50
      ? "This PDF has no text in it (it may be a scanned picture). Paste the lines below instead."
      : "No statement lines were found in this PDF. Paste the lines below instead.";
    return render();
  }
  review(parsed);
}
function readPasted() {
  const a = account(), stmt = $("liStmt").value, bal = $("liBal").value.trim(), prev = $("liPrev").value.trim();
  Object.assign(imp, { pStmt: stmt, pBal: bal, pPrev: prev, pText: $("liPaste").value, paste: true });
  const say = (t) => { imp.msg = t; $("liMsg").textContent = t; };
  if (!stmt) return say("Pick the statement date.");
  if (Number.isNaN(toSen(bal))) return say("Type the statement balance, like 132.42.");
  if (prev && Number.isNaN(toSen(prev))) return say("Type the previous balance like 34.50, or leave it empty.");
  const { rows, bad } = parsePasted(imp.pText, stmt, ctx.aliases());
  if (!rows.length) return say("No lines could be read. Use: posted date, date, shop, amount.");
  const cyc = cycleOf(a, stmt);
  const parsed = { statement: stmt, due: cyc.due, last4: null, prevSen: prev ? toSen(prev) : null, balanceSen: toSen(bal), minPaySen: null, rows, bad };
  parsed.check = checkTotals(parsed);
  review(parsed);
}

// ---------- review ----------
function review(parsed) {
  const a = account();
  const cyc = { ...cycleOf(a, parsed.statement), id: `${a.id}_${parsed.statement}`, statement: parsed.statement, due: parsed.due ?? cycleOf(a, parsed.statement).due };
  // Items saved by an earlier import of this same statement match again (so nothing is added twice).
  const again = ctx.txns().filter((t) => t.stmt === cyc.id);
  const logged = [...candidates(ctx.txns(), a.id, cyc), ...again.filter((t) => t.reconciled)];
  const res = reconcile(parsed.rows, logged, { rules: ctx.aliases(), statement: parsed.statement, start: cyc.start });
  const pick = res.map((x) => ({
    on: x.kind !== "missing",
    cat: x.kind === "category" ? (x.txn.cat === "other" ? x.suggest : x.txn.cat) : x.cat ?? x.txn?.cat ?? "other",
  }));
  const owner = ctx.people().some((p) => p.id === a.owner) ? a.owner : ctx.me();
  Object.assign(imp, { step: "review", parsed, res, pick, cycle: cyc, spentBy: owner, again: again.length > 0, msg: "" });
  render();
}

function renderReview(top) {
  const { parsed: p, res, cycle } = imp, a = account();
  const wrongCard = p.last4 && a.last4 && p.last4 !== a.last4;
  const odd = cycleOf(a, p.statement).statement !== p.statement;
  const t = tally(res);
  const groups = ORDER.filter((k) => t[k]).map((k) => {
    const items = res.map((x, i) => ({ x, i })).filter(({ x }) => x.kind === k);
    const body = items.map(({ x, i }) => rowHtml(x, i)).join("");
    return k === "matched"
      ? `<details class="lgrp"><summary>${MARK[k]} ${HEAD[k]} <b>${items.length}</b></summary>${body}</details>`
      : `<div class="lgrp"><h3>${MARK[k]} ${HEAD[k]} <b>${items.length}</b></h3>${k === "missing" ? `<p class="note">Tick one to remove it from your log. Left alone, it stays and is checked again next statement.</p>` : ""}${body}</div>`;
  }).join("");
  $("ledgerImport").innerHTML = `${top}
    <p class="lcycle">Statement ${shortDate(p.statement)} · ${shortDate(cycle.start)} – ${shortDate(p.statement)} · due ${shortDate(cycle.due)}</p>
    ${wrongCard ? `<p class="lwarn">This statement is for card ··${esc(p.last4)}, not ··${esc(a.last4)}. Check you picked the right card before saving.</p>` : ""}
    ${odd ? `<p class="lwarn calm">This statement's date doesn't match the card's statement day (${a.statementDay}). It's saved under ${shortDate(p.statement)} anyway.</p>` : ""}
    ${imp.again ? `<p class="lwarn calm">This statement was imported before. Items already saved match again, so nothing is added twice.</p>` : ""}
    <dl class="dy-stats lsum">
      <div><dt>Statement balance</dt><dd>${p.balanceSen == null ? "–" : rm(p.balanceSen)}</dd></div>
      <div><dt>Minimum payment</dt><dd>${p.minPaySen == null ? "–" : rm(p.minPaySen)}</dd></div>
      <div><dt>Lines</dt><dd>${p.rows.length}</dd></div>
    </dl>
    <p class="note" id="liCheck">${p.check == null ? "" : p.check.ok ? "✓ The lines add up to the statement balance." : `⚠️ The lines add up to ${rm(p.check.sumSen)}, but the statement says ${rm(p.balanceSen)}. A line may be missing.`}${p.bad?.length ? ` Lines ${p.bad.join(", ")} couldn't be read.` : ""}</p>
    <div class="lbl mwho"><span>New items spent by</span><div class="seg">${ctx.people().map((q) => `<input type="radio" name="liWho" id="liw-${q.id}" value="${q.id}"${q.id === imp.spentBy ? " checked" : ""}><label for="liw-${q.id}">${esc(q.name)}</label>`).join("")}</div></div>
    <div id="liOffer"></div>
    <div class="lrev" id="liList">${groups}</div>
    <p class="note" id="liTotal"></p>
    <div class="actions"><button type="button" class="primary" id="liSave">Save and close this statement</button><button type="button" id="liCancel">Cancel</button></div>
    <p class="msg" id="liMsg" aria-live="polite">${esc(imp.msg)}</p>`;
  ctx.paintOffer("liOffer");
  paintSummary();
}
function rowHtml(x, i) {
  const r = x.row, t = x.txn, pk = imp.pick[i], amt = (r ?? t).amountSen;
  const name = r ? r.raw : t.merchant || t.raw;
  const line = r ? `${shortDate(r.date)}${r.posted !== r.date ? ` · posted ${shortDate(r.posted)}` : ""}` : `${shortDate(t.date)} · logged${x.late ? " · may post next statement" : ""}`;
  const extra = x.kind === "amount" ? `<small class="lnote">You logged ${rm(Math.abs(t.amountSen))}. Tick to use the statement's amount.</small>`
    : x.kind === "category" ? `<small class="lnote">You logged it as ${esc(cat(t.cat).name)}; the shop rules say ${esc(cat(x.suggest).name)}.</small>`
    : "";
  const choose = (x.kind === "new" || x.kind === "category") && r?.type !== "payment"
    ? `<select class="licat" data-i="${i}" aria-label="Category for ${esc(name)}">${CATS.map((c) => `<option value="${c.id}"${c.id === pk.cat ? " selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}</select>` : "";
  const tick = x.kind === "matched" ? "" : `<input type="checkbox" class="lion" data-i="${i}"${pk.on ? " checked" : ""} aria-label="${x.kind === "missing" ? "Remove from log" : "Accept"}: ${esc(name)}">`;
  return `<div class="lrrow k-${x.kind}">
    ${tick || `<span aria-hidden="true">✓</span>`}
    <div class="lmain"><b>${esc(name)}</b><small>${line}</small>${extra}${choose}</div>
    <span class="lamt${amt < 0 ? " cr" : ""}">${rm(Math.abs(amt))}${amt < 0 ? " CR" : ""}</span>
  </div>`;
}
// The rebate this statement will give with the choices as they stand (real balance, so it's not a projection).
function outcome() {
  const { parsed: p, res, pick, cycle } = imp, a = account();
  const prog = ctx.programs().find((x) => x.id === a.program) ?? programFor(ctx.programs(), a.id, p.statement);
  if (!prog || p.balanceSen == null) return null;
  const rows = res.map((x, i) => (x.row ? { ...x.row, cat: x.row.type === "payment" ? "payment" : pick[i].cat } : null)).filter(Boolean);
  return { prog, result: computeRebate(prog, { txns: rows, balanceSen: p.balanceSen }), cycle };
}
function paintSummary() {
  const el = $("liTotal"); if (!el) return;
  const o = outcome();
  const n = imp.res.reduce((s, x, i) => s + (x.kind !== "matched" && imp.pick[i].on ? 1 : 0), 0);
  el.innerHTML = `${n} ${n === 1 ? "change" : "changes"} ticked.${o ? ` Rebate for this statement: <b>${rm(o.result.totalSen)}</b> (${esc(o.result.tierLabel)} tier), paid on the next statement.` : ""}`;
}

// ---------- saving ----------
async function save() {
  const { parsed: p, res, pick, cycle } = imp, a = account(), at = Date.now(), batchId = `imp-${at}`;
  const gone = res.filter((x, i) => x.kind === "missing" && pick[i].on);
  if (gone.length) {
    const ok = await confirmDelete({
      title: `Remove ${gone.length} ${gone.length === 1 ? "item" : "items"} from your log?`,
      body: `<p>Not on this statement: ${gone.slice(0, 5).map((x) => `${esc(x.txn.merchant || x.txn.raw || "")} ${rm(Math.abs(x.txn.amountSen))}`).join(", ")}${gone.length > 5 ? "…" : ""}. The rest of the statement is saved either way.</p>`,
      yes: "Remove them",
    });
    if (!ok) return;
  }
  const btn = $("liSave"); btn.disabled = true;
  const ops = []; // [ref, data, merge] or [ref, null] for delete
  const col = collection(ctx.db(), "ledgerTxns");
  let added = 0, fixed = 0, removed = 0;
  res.forEach((x, i) => {
    const pk = pick[i];
    if (x.kind === "missing") { if (pk.on) { ops.push([doc(col, x.txn.id), null]); removed++; } return; }
    const r = x.row, base = { posted: r.posted, postedGuess: false, raw: r.raw, reconciled: true, stmt: cycle.id, batch: batchId };
    base.cycle = cycleForTxn(a, { ...r }).id;
    if (x.kind === "new") {
      if (!pk.on) return;
      ops.push([doc(col), { account: a.id, spentBy: imp.spentBy, date: r.date, ...base, merchant: x.merchant || suggestPattern(r.raw), cat: r.type === "payment" ? "payment" : pk.cat, amountSen: r.amountSen, type: r.type, source: "statement_import", at }, false]);
      added++;
      return;
    }
    if ((x.kind === "amount" || x.kind === "category") && !pk.on) return; // left for later
    const patch = { ...base };
    if (x.kind === "amount") patch.amountSen = r.amountSen;
    if (x.kind === "category") patch.cat = pk.cat;
    if (x.kind !== "matched") fixed++;
    ops.push([doc(col, x.txn.id), patch, true]);
  });
  const o = outcome();
  ops.push([doc(ctx.db(), "ledgerCycles", cycle.id), {
    account: a.id, start: cycle.start, statement: p.statement, due: cycle.due, status: "closed", importedAt: at, updated: at, batch: batchId,
    ...(p.balanceSen != null ? { balanceSen: p.balanceSen } : {}), ...(p.minPaySen != null ? { minPaySen: p.minPaySen } : {}),
    ...(p.prevSen != null ? { prevSen: p.prevSen } : {}),
  }, true]);
  if (o) ops.push([doc(ctx.db(), "ledgerRebates", cycle.id), rebateSnapshot(cycle, o.prog, o.result, { at }), false]);
  try {
    for (let s = 0; s < ops.length; s += BATCH) {
      const b = writeBatch(ctx.db());
      for (const [ref, data, merge] of ops.slice(s, s + BATCH)) data ? b.set(ref, data, merge ? { merge: true } : undefined) : b.delete(ref);
      await ctx.commit(() => b.commit());
    }
  } catch (_) { btn.disabled = false; imp.msg = "That didn't save. Check your connection and try again."; $("liMsg").textContent = imp.msg; return; }
  imp.step = "done";
  toast(`Statement ${shortDate(p.statement)} saved.`);
  imp.done = `Statement ${shortDate(p.statement)} saved: ${added} added, ${fixed} fixed${removed ? `, ${removed} removed` : ""}.${o ? ` Rebate ${rm(o.result.totalSen)} (${o.result.tierLabel} tier).` : ""}`;
  render();
  ctx.refresh();
}

// ---------- history from a spreadsheet (one-time) ----------
function readSheet() {
  imp.sheetText = $("liSheet").value; imp.sheet = true;
  imp.sheetWho = document.querySelector('input[name="liSheetWho"]:checked')?.value ?? ctx.me();
  const say = (t) => { imp.msg = t; $("liMsg").textContent = t; };
  const parsed = parseSheet(imp.sheetText, ctx.aliases());
  if (!parsed.found) return say("No table with Date, Merchant and Amount columns was found. Copy the whole tab and paste it again.");
  if (!parsed.rows.length) return say("The table was found, but no rows could be read.");
  const a = account(), mine = ctx.txns().filter((t) => t.account === a.id);
  const { fresh, dupes } = sheetDupes(parsed.rows, mine);
  Object.assign(imp, { step: "sheet", sheetRows: fresh.map((row) => ({ row, on: true, cat: row.cat })), sheetDupes: dupes, sheetBad: parsed.bad, msg: "" });
  render();
}
function renderSheet(top) {
  const { sheetRows: rows, sheetDupes: dupes, sheetBad: bad } = imp;
  const first = rows.map((x) => x.row.date).sort()[0], last = rows.map((x) => x.row.date).sort().at(-1);
  $("ledgerImport").innerHTML = `${top}
    <p class="lcycle">From a spreadsheet${rows.length ? ` · ${shortDate(first)} – ${shortDate(last)}` : ""} · spent by ${esc(ctx.people().find((p) => p.id === imp.sheetWho)?.name ?? "")}</p>
    <p class="note">${rows.length} new ${rows.length === 1 ? "item" : "items"} to add. ${dupes.length ? `${dupes.length} already in Ledger (same amount within 3 days), so ${dupes.length === 1 ? "it's" : "they're"} skipped.` : ""}${bad.length ? ` ${bad.length === 1 ? "Row" : "Rows"} ${bad.slice(0, 8).join(", ")}${bad.length > 8 ? "…" : ""} couldn't be read.` : ""}</p>
    <div id="liOffer"></div>
    <div class="lrev" id="lsList">${rows.length ? `<div class="lgrp"><h3>➕ To add <b>${rows.length}</b></h3>${rows.map((x, i) => {
      const r = x.row;
      return `<div class="lrrow k-new"><input type="checkbox" class="lson" data-i="${i}"${x.on ? " checked" : ""} aria-label="Add ${esc(r.merchant)}">
        <div class="lmain"><b>${esc(r.merchant)}</b><small>${shortDate(r.date)}${r.postedGuess ? "" : ` · posted ${shortDate(r.posted)}`}${r.notes ? ` · ${esc(r.notes)}` : ""}</small>
        ${r.type === "payment" ? "" : `<select class="lscat" data-i="${i}" aria-label="Category for ${esc(r.merchant)}">${CATS.map((c) => `<option value="${c.id}"${c.id === x.cat ? " selected" : ""}>${c.icon} ${esc(c.name)}</option>`).join("")}</select>`}</div>
        <span class="lamt${r.amountSen < 0 ? " cr" : ""}">${rm(Math.abs(r.amountSen))}${r.amountSen < 0 ? " CR" : ""}</span></div>`;
    }).join("")}</div>` : ""}
    ${dupes.length ? `<details class="lgrp"><summary>✅ Already in Ledger <b>${dupes.length}</b></summary>${dupes.map((d) => `<div class="lrrow k-matched"><span aria-hidden="true">✓</span><div class="lmain"><b>${esc(d.row.merchant)}</b><small>${shortDate(d.row.date)} · matches ${esc(d.txn.merchant || d.txn.raw || "")} on ${shortDate(d.txn.date)}</small></div><span class="lamt">${rm(Math.abs(d.row.amountSen))}</span></div>`).join("")}</details>` : ""}
    </div>
    <div class="actions">${rows.length ? `<button type="button" class="primary" id="lsSave">Add ticked items</button>` : ""}<button type="button" id="liCancel">${rows.length ? "Cancel" : "Close"}</button></div>
    <p class="msg" id="liMsg" aria-live="polite">${esc(imp.msg)}</p>`;
  ctx.paintOffer("liOffer");
}
async function saveSheet() {
  const a = account(), at = Date.now(), batchId = `sheet-${at}`, col = collection(ctx.db(), "ledgerTxns");
  const pick = imp.sheetRows.filter((x) => x.on);
  $("lsSave").disabled = true;
  try {
    for (let s = 0; s < pick.length; s += BATCH) {
      const b = writeBatch(ctx.db());
      for (const { row: r, cat: c } of pick.slice(s, s + BATCH)) {
        const t = { account: a.id, spentBy: imp.sheetWho, date: r.date, posted: r.posted, postedGuess: r.postedGuess, merchant: r.merchant, raw: r.raw,
          cat: r.type === "payment" ? "payment" : c, amountSen: r.amountSen, type: r.type, source: "sheet_import", batch: batchId, reconciled: false, at };
        if (r.notes) t.notes = r.notes;
        t.cycle = cycleForTxn(a, t).id;
        b.set(doc(col), t);
      }
      await ctx.commit(() => b.commit());
    }
  } catch (_) { $("lsSave").disabled = false; imp.msg = "That didn't save. Check your connection and try again."; $("liMsg").textContent = imp.msg; return; }
  imp.step = "done";
  toast(`Added ${pick.length} ${pick.length === 1 ? "item" : "items"} from the spreadsheet.`);
  imp.done = `Added ${pick.length} ${pick.length === 1 ? "item" : "items"} from the spreadsheet${imp.sheetDupes.length ? `; ${imp.sheetDupes.length} ${imp.sheetDupes.length === 1 ? "was" : "were"} already here` : ""}. When the statement comes, import it: these are checked against it.`;
  render();
  ctx.refresh();
}

// ---------- events ----------
function onChange(ev) {
  const el = ev.target;
  if (el.id === "liFile" && el.files[0]) { imp.file = el.files[0]; openPdf(""); }
  if (el.classList.contains("lson")) imp.sheetRows[Number(el.dataset.i)].on = el.checked;
  if (el.classList.contains("lscat")) {
    const x = imp.sheetRows[Number(el.dataset.i)];
    x.cat = el.value; x.on = true;
    const box = el.closest(".lrrow")?.querySelector(".lson"); if (box) box.checked = true;
    ctx.offer(x.row.raw, el.value, "liOffer");
  }
  if (el.name === "liWho") imp.spentBy = el.value;
  if (el.classList.contains("lion")) { imp.pick[Number(el.dataset.i)].on = el.checked; paintSummary(); }
  if (el.classList.contains("licat")) {
    const i = Number(el.dataset.i), x = imp.res[i];
    imp.pick[i].cat = el.value; imp.pick[i].on = true;
    const box = el.closest(".lrrow")?.querySelector(".lion"); if (box) box.checked = true;
    ctx.offer(x.row.raw, el.value, "liOffer");
    paintSummary();
  }
}
function onClick(ev) {
  const b = ev.target.closest("button"); if (!b) return;
  if (b.id === "liCancel" || b.id === "liClose") { imp = null; renderImport(); return; }
  if (b.id === "liPasteGo") readPasted();
  if (b.id === "liSheetGo") readSheet();
  if (b.id === "lsSave") saveSheet();
  if (b.id === "liSave") save();
}
