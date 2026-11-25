// Ledger: the rebate rule editor (#ledgerRules), opened by "Rules" on a card.
// Edits a copy; checkProgram() in ledger.js checks and tidies it before anything is saved.
import { collection, doc, setDoc, writeBatch } from "../../core/fs.js";
import { $, esc } from "../../core/util.js";
import { SYSTEM_CATEGORIES, PRESETS, rm, toSen, norm, checkProgram, cycleView } from "../../logic/ledger.js";
import { ico } from "../../core/icons.js";

const CATS = SYSTEM_CATEGORIES.filter((c) => !c.hidden);
const QUAL = { statement_balance: "Statement balance", cycle_retail_spend: "Spending in the cycle", none: "Nothing (one rate for all)" };

let ctx, ed = null; // ed: { account, programId, p (draft), errors, msg }

export function initRules(c) {
  ctx = c;
  const host = $("ledgerRules");
  host.addEventListener("input", onInput);
  host.addEventListener("change", onInput);
  host.addEventListener("click", onClick);
}
export function startRules(accountId) {
  const a = ctx.accounts().find((x) => x.id === accountId); if (!a) return;
  const prog = ctx.programs().find((p) => p.id === a.program);
  const blank = { name: `${a.name} rebate`, qualifier: "statement_balance", rounding: "floor_rm", credited: "next_statement", needsMinPay: true, from: "2020-01-01", to: null, tiers: [{ minSen: 0, rates: [] }], exclusions: [] };
  const { id, account, ...p } = prog ?? blank;
  ed = { account: a.id, programId: prog?.id ?? null, p: structuredClone(p), errors: [], msg: "" };
  render();
  $("ledgerRules").scrollIntoView({ behavior: "smooth", block: "start" });
}
export function renderRules() {
  const host = $("ledgerRules");
  if (!ed || !ctx.accounts().some((a) => a.id === ed.account)) { ed = null; host.hidden = true; host.innerHTML = ""; return; }
  if (!$("lrName")) render(); else paintPreview();
}

const pct = (bps) => (Number.isFinite(bps) ? String(bps / 100) : "");
const money = (sen) => (sen == null || Number.isNaN(sen) ? "" : (sen / 100).toFixed(2).replace(/\.00$/, ""));

function render() {
  const host = $("ledgerRules"), a = ctx.accounts().find((x) => x.id === ed.account), p = ed.p;
  host.hidden = false;
  const exclCats = new Set(p.exclusions.filter((x) => x.cat).map((x) => x.cat));
  const words = p.exclusions.filter((x) => x.pattern && (x.match ?? "contains") === "contains").map((x) => x.pattern);
  const advanced = p.exclusions.filter((x) => x.pattern && x.match && x.match !== "contains").length;
  host.innerHTML = `<div class="lhead"><h2 id="lrTitle">Rebate rules</h2><span class="note">${esc(a.name)}</span></div>
    <p class="note">These rules work out the rebate on this card. Change them when the bank changes its terms. Statements you've already closed keep the rebate they had.</p>
    <label>Name<input type="text" id="lrName" autocomplete="off" value="${esc(p.name)}"></label>
    <label>Tiers depend on<select id="lrQual">${Object.entries(QUAL).map(([k, v]) => `<option value="${k}"${k === p.qualifier ? " selected" : ""}>${v}</option>`).join("")}</select></label>
    <div class="two">
      <label>Rebate is<select id="lrRound"><option value="floor_rm"${p.rounding === "floor_rm" ? " selected" : ""}>Rounded down to whole RM</option><option value="none"${p.rounding !== "floor_rm" ? " selected" : ""}>Kept to the sen</option></select></label>
      <label>Paid on<select id="lrCred"><option value="next_statement"${p.credited !== "same_statement" ? " selected" : ""}>The next statement</option><option value="same_statement"${p.credited === "same_statement" ? " selected" : ""}>The same statement</option></select></label>
    </div>
    <label class="inline"><input type="checkbox" id="lrMin"${p.needsMinPay ? " checked" : ""}> Only if the minimum payment is made on time</label>
    <div class="two">
      <label>Rules start<input type="date" id="lrFrom" value="${esc(p.from ?? "")}"></label>
      <label>Rules end <small>optional</small><input type="date" id="lrTo" value="${esc(p.to ?? "")}"></label>
    </div>
    <h3 class="lth">Tiers</h3>
    ${p.tiers.map((t, i) => `<fieldset class="ltier"><legend>Tier ${i + 1}</legend>
      <label class="inline">From RM <input type="text" inputmode="decimal" class="lrsmall" data-tmin="${i}" value="${money(t.minSen)}"${i === 0 ? " disabled" : ""} aria-label="Tier ${i + 1} starts at, RM"> ${p.qualifier === "statement_balance" ? "statement balance" : p.qualifier === "cycle_retail_spend" ? "spent in the cycle" : ""}</label>
      ${t.rates.length ? `<div class="lrates">${t.rates.map((r, j) => `<div class="lrate">
          <select data-rcat="${i}.${j}" aria-label="Category"><option value="">Pick a category…</option>${CATS.map((c) => `<option value="${c.id}"${c.id === r.cat ? " selected" : ""}>${esc(c.name)}</option>`).join("")}</select>
          <button type="button" class="mini" data-rdel="${i}.${j}" aria-label="Remove this rate">✕</button>
          <label class="lrf"><small>Rate %</small><input type="text" inputmode="decimal" data-rbps="${i}.${j}" value="${pct(r.bps)}"></label>
          <label class="lrf"><small>Cap group</small><input type="text" data-rgroup="${i}.${j}" value="${esc(r.capGroup ?? "")}" placeholder="none" autocomplete="off"></label>
          <label class="lrf"><small>Cap RM</small><input type="text" inputmode="decimal" data-rcap="${i}.${j}" value="${money(r.capSen)}" placeholder="none"></label>
        </div>`).join("")}</div>` : `<p class="note">No rebate in this tier.</p>`}
      <div class="actions"><button type="button" class="mini" data-radd="${i}">＋ Rate</button>${i ? `<button type="button" class="mini" data-tdel="${i}">Remove tier</button>` : ""}</div>
    </fieldset>`).join("")}
    <div class="actions"><button type="button" class="mini" id="lrTierAdd">＋ Tier</button></div>
    <p class="note">Rates with the same cap group share one cap, like groceries, dining and parking sharing RM50.</p>
    <h3 class="lth">Never earns a rebate</h3>
    <div class="chips">${CATS.map((c) => `<label class="chip"><input type="checkbox" data-xcat="${c.id}"${exclCats.has(c.id) ? " checked" : ""}> ${ico(c.icon)} ${esc(c.name)}</label>`).join("")}</div>
    <label>Shop names containing <small>one per line, e.g. DUITNOW, JOMPAY</small><textarea id="lrWords" rows="4" spellcheck="false">${esc(words.join("\n"))}</textarea></label>
    ${advanced ? `<p class="note">Plus ${advanced} advanced ${advanced === 1 ? "rule" : "rules"} from the preset (kept as they are).</p>` : ""}
    <p class="note" id="lrPreview"></p>
    <div class="lwarn" id="lrErr" role="alert" hidden></div>
    <div class="actions"><button type="button" class="primary" id="lrSave">Save rules</button><button type="button" id="lrCancel">Cancel</button>
      ${Object.keys(PRESETS).map((k) => `<button type="button" class="mini" data-preset="${k}">Start from ${esc(PRESETS[k].name)}</button>`).join("")}</div>
    <p class="msg" aria-live="polite">${esc(ed.msg)}</p>`;
  paintPreview();
}

// What this cycle would earn with the rules as typed (only when they check out).
function paintPreview() {
  const el = $("lrPreview"), err = $("lrErr"); if (!el) return;
  const { errors, program } = checkProgram(ed.p);
  err.hidden = !ed.errors.length;
  err.innerHTML = ed.errors.map((e) => `• ${esc(e)}`).join("<br>");
  if (errors.length) { el.textContent = ""; return; }
  const a = ctx.accounts().find((x) => x.id === ed.account);
  const v = cycleView({ ...a, program: "draft" }, { programs: [{ ...program, id: "draft", account: a.id }], cycles: ctx.cycles(), txns: ctx.txns(), day: ctx.today() });
  el.innerHTML = v.rebate ? `With these rules, this statement so far earns <b>${rm(v.rebate.totalSen)}</b> (${esc(v.rebate.tierLabel)} tier).` : "";
}

const at = (key) => key.split(".").map(Number);
function onInput(ev) {
  const el = ev.target, p = ed?.p; if (!p) return;
  const d = el.dataset;
  if (el.id === "lrName") p.name = el.value;
  else if (el.id === "lrQual") { p.qualifier = el.value; if (ev.type === "change") return render(); }
  else if (el.id === "lrRound") p.rounding = el.value;
  else if (el.id === "lrCred") p.credited = el.value;
  else if (el.id === "lrMin") p.needsMinPay = el.checked;
  else if (el.id === "lrFrom") p.from = el.value;
  else if (el.id === "lrTo") p.to = el.value || null;
  else if (d.tmin) p.tiers[Number(d.tmin)].minSen = el.value.trim() ? toSen(el.value) : NaN;
  else if (d.rcat) { const [i, j] = at(d.rcat); p.tiers[i].rates[j].cat = el.value; }
  else if (d.rbps) { const [i, j] = at(d.rbps); const v = Number(el.value); p.tiers[i].rates[j].bps = el.value.trim() && Number.isFinite(v) ? Math.round(v * 100) : NaN; }
  else if (d.rgroup) { const [i, j] = at(d.rgroup); p.tiers[i].rates[j].capGroup = el.value.trim() || undefined; }
  else if (d.rcap) { const [i, j] = at(d.rcap); p.tiers[i].rates[j].capSen = el.value.trim() ? toSen(el.value) : null; }
  else if (d.xcat) {
    p.exclusions = p.exclusions.filter((x) => x.cat !== d.xcat);
    if (el.checked) p.exclusions.push({ cat: d.xcat });
  } else if (el.id === "lrWords") {
    const keep = p.exclusions.filter((x) => x.cat || (x.match && x.match !== "contains"));
    p.exclusions = [...keep, ...el.value.split(/\r?\n/).map((w) => norm(w)).filter(Boolean).map((pattern) => ({ pattern, match: "contains" }))];
  } else return;
  ed.errors = [];
  paintPreview();
}
function onClick(ev) {
  const b = ev.target.closest("button"); if (!b || !ed) return;
  const p = ed.p, d = b.dataset;
  if (d.radd) { p.tiers[Number(d.radd)].rates.push({ cat: "", bps: NaN, capSen: null }); return render(); }
  if (d.rdel) { const [i, j] = at(d.rdel); p.tiers[i].rates.splice(j, 1); return render(); }
  if (d.tdel) { p.tiers.splice(Number(d.tdel), 1); return render(); }
  if (b.id === "lrTierAdd") {
    const last = p.tiers.at(-1), rates = structuredClone(last.rates);
    p.tiers.push({ minSen: (Number.isFinite(last.minSen) ? last.minSen : 0) + 100000, rates });
    return render();
  }
  if (d.preset) { const { name, ...rest } = structuredClone(PRESETS[d.preset]); ed.p = { ...rest, name: p.name || name }; ed.errors = []; return render(); }
  if (b.id === "lrCancel") { ed = null; return renderRules(); }
  if (b.id === "lrSave") save();
}
async function save() {
  const { errors, program } = checkProgram(ed.p);
  if (errors.length) { ed.errors = errors; return paintPreview(); }
  const now = Date.now(), db = ctx.db(), body = { ...program, account: ed.account, created: program.created ?? now, updated: now };
  delete body.id; delete body.at;
  if (ed.programId) await ctx.commit(() => setDoc(doc(db, "ledgerPrograms", ed.programId), body));
  else {
    const ref = doc(collection(db, "ledgerPrograms")), b = writeBatch(db);
    b.set(ref, body);
    b.set(doc(db, "ledgerAccounts", ed.account), { program: ref.id }, { merge: true });
    await ctx.commit(() => b.commit());
  }
  ed = null;
  renderRules();
  ctx.refresh();
}
