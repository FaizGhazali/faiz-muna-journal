// Ledger: reading a card statement and checking it against what was logged by hand.
// Pure: no Firebase, no DOM, no pdf.js (ledgerui.js loads pdf.js and hands the text items here).
// Tests: tests/ledgerimport.test.mjs.
import { pad } from "../core/util.js";
import { toSen, norm, categorise, daysBetween, SYSTEM_CATEGORIES } from "./ledger.js";

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const AMT = "-?[\\d,]+\\.\\d{2}";

// pdf.js text items of one page -> lines, top to bottom, words left to right.
// items: [{ str, transform: [a, b, c, d, x, y] }]
export function pageLines(items) {
  const rows = [];
  for (const it of items) {
    if (!it.str || !it.str.trim()) continue;
    const x = it.transform[4], y = it.transform[5];
    let r = rows.find((q) => Math.abs(q.y - y) < 2.5);
    if (!r) rows.push((r = { y, parts: [] }));
    r.parts.push({ x, s: it.str.trim() });
  }
  return rows.sort((a, b) => b.y - a.y).map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.s).join(" ").replace(/\s+/g, " "));
}

// "20 NOV 2026" -> "2026-11-20"
const fullDate = (s) => { const [d, m, y] = s.split(" "); return `${y}-${pad(MONTHS.indexOf(m) + 1)}-${pad(d)}`; };
// "21 OCT" on a statement dated 2026-11-20 -> "2026-10-21" (a Dec line on a Jan statement is last year).
function rowDate(dm, statement) {
  const [d, m] = dm.split(" "), mi = MONTHS.indexOf(m) + 1, sy = Number(statement.slice(0, 4)), sm = Number(statement.slice(5, 7));
  return `${mi > sm ? sy - 1 : sy}-${pad(mi)}-${pad(d)}`;
}
// What kind of line it is, from its text and whether it's a credit.
function kindOf(raw, credit, rules) {
  const r = categorise(raw, rules);
  if (credit) return r.type === "payment" || /PAYMENT|THANK YOU|BAYARAN/.test(raw) ? "payment" : /REBATE|CASHBACK/.test(raw) ? "rebate_credit" : "refund";
  if (/^SERVICE TAX|^CUKAI/.test(raw)) return "tax";
  if (/\b(FEE|CAJ|CHARGE)\b/.test(raw) && !r.rule) return "fee";
  return "purchase";
}

// A CIMB-style statement as text lines -> what it says. Works on pdf.js lines or pasted text.
// Returns { statement, due, last4, prevSen, balanceSen, minPaySen, rows: [{ posted, date, raw, amountSen, type, card }], check }
export function parseStatement(lines, rules = []) {
  const out = { statement: null, due: null, last4: null, prevSen: null, balanceSen: null, minPaySen: null, rows: [] };
  let card = null, open = null; // open: a row whose amount is on a later line
  const rowRe = new RegExp(`^(\\d{2} [A-Z]{3}) (\\d{2} [A-Z]{3}) (.+?)(?:\\s+(${AMT})(\\s*CR)?)?$`);
  const loneAmt = new RegExp(`^(${AMT})(\\s*CR)?$`);
  const pending = [];
  const finish = (r, amt, cr) => {
    const credit = !!cr || amt.startsWith("-");
    const sen = Math.abs(toSen(amt));
    pending.push({ ...r, sen, credit });
  };
  for (const raw0 of lines) {
    const line = String(raw0).trim().replace(/\s+/g, " ");
    if (!line) continue;
    if (!out.statement) {
      const m = line.match(/(\d{2} [A-Z]{3} \d{4}) (\d{2} [A-Z]{3} \d{4})/);
      if (m) { out.statement = fullDate(m[1]); out.due = fullDate(m[2]); continue; }
    }
    if (out.minPaySen == null) {
      const m = line.match(new RegExp(`\\d{4}-\\d{4}-\\d{4}-(\\d{4})\\b.*?(${AMT}) (${AMT}) (${AMT}) (${AMT})$`));
      if (m) { out.last4 = m[1]; out.balanceSen = toSen(m[4]); out.minPaySen = toSen(m[5]); continue; }
    }
    const sec = line.match(/X{4}-X{4}-X{4}-(\d{4})/);
    if (sec) { card = sec[1]; out.last4 ??= card; continue; }
    const prev = line.match(new RegExp(`^PREVIOUS BALANCE (${AMT})(\\s*CR)?$`));
    if (prev) { out.prevSen = toSen(prev[1]) * (prev[2] ? -1 : 1); continue; }
    const bal = line.match(new RegExp(`^STATEMENT BALANCE (${AMT})(\\s*CR)?$`));
    if (bal) { out.balanceSen = toSen(bal[1]) * (bal[2] ? -1 : 1); open = null; continue; }
    const m = line.match(rowRe);
    if (m) {
      const r = { posted: m[1], date: m[2], raw: norm(m[3]), card };
      if (m[4]) { finish(r, m[4], m[5]); open = null; } else open = r;
      continue;
    }
    const a = line.match(loneAmt);
    if (a && open) { finish(open, a[1], a[2]); open = null; }
  }
  if (!out.statement) return { ...out, error: "no-date" };
  out.rows = pending.map((r) => {
    const type = kindOf(r.raw, r.credit, rules);
    return { posted: rowDate(r.posted, out.statement), date: rowDate(r.date, out.statement), raw: r.raw, amountSen: r.credit ? -r.sen : r.sen, type, card: r.card };
  });
  out.check = checkTotals(out);
  return out;
}

// Previous balance + every line should equal the statement balance. null when either end is missing.
export function checkTotals({ prevSen, balanceSen, rows }) {
  if (prevSen == null || balanceSen == null) return null;
  const sumSen = rows.reduce((s, r) => s + r.amountSen, prevSen);
  return { ok: sumSen === balanceSen, sumSen, diffSen: balanceSen - sumSen };
}

// Fallback when there's no readable PDF: one line per item, "posted, date, description, amount".
// Dates as YYYY-MM-DD, DD/MM/YYYY or DD/MM (year from the statement). Credits as "34.50 CR" or "-34.50".
// Lines in the statement's own layout ("21 OCT 18 OCT SHOP 12.00") work too.
export function parsePasted(text, statement, rules = []) {
  const lines = String(text ?? "").split(/\r?\n/);
  const asStatement = parseStatement([`${fmtLong(statement)} ${fmtLong(statement)}`, ...lines], rules);
  const rows = [...asStatement.rows], bad = [];
  const dateOf = (s) => {
    s = s.trim();
    let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return s;
    m = s.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
    if (!m) return null;
    const mm = Number(m[2]), y = m[3] ? (m[3].length === 2 ? 2000 + Number(m[3]) : Number(m[3])) : Number(statement.slice(0, 4)) - (mm > Number(statement.slice(5, 7)) ? 1 : 0);
    return `${y}-${pad(mm)}-${pad(m[1])}`;
  };
  lines.forEach((l, i) => {
    if (!l.trim() || /^\d{2} [A-Z]{3} \d{2} [A-Z]{3} /.test(l.trim().toUpperCase())) return;
    const parts = l.split(/[,\t;]/).map((p) => p.trim());
    if (parts.length < 4) { bad.push(i + 1); return; }
    const amt = parts.at(-1).toUpperCase(), credit = /CR$/.test(amt) || amt.startsWith("-");
    const sen = Math.abs(toSen(amt.replace(/CR$/, "").trim()));
    const posted = dateOf(parts[0]), date = dateOf(parts[1]), raw = norm(parts.slice(2, -1).join(", "));
    if (!posted || !date || !raw || !(sen > 0)) { bad.push(i + 1); return; }
    const type = kindOf(raw, credit, rules);
    rows.push({ posted, date, raw, amountSen: credit ? -sen : sen, type, card: null });
  });
  return { rows, bad };
}
const fmtLong = (iso) => `${iso.slice(8, 10)} ${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

// ---------- merchant patterns ----------

// A short, reusable pattern from a statement line, for "Always categorise … as …":
// e.g. "CARING PHARMACY-S.CITY SHAH ALAM MY" -> "CARING PHARMACY", "ECS* SETEL VENTURES" -> "ECS* SETEL".
// Drops a leading store code ("2185-"), stops at a branch separator (a dash or underscore after a name, like
// "SUSHI KING-SETIA") or a word with digits, then keeps one long word (8+ letters: "ECONSAVE") or two
// ("ISLAND HOSPITAL", "99 SPEEDMART", "ECS* SETEL"). The person can edit it before saving.
export function suggestPattern(raw) {
  const s = norm(raw).replace(/^\d{3,}-/, "");
  const words = [];
  for (const w of s.split(" ")) {
    if (words.length && /\d/.test(w.split(/[-_]/)[0])) break; // "SPEEDMART-1498" is still a name; "S00236180KLANG" isn't
    const m = w.match(/^(.*?[A-Z'.*&]{3,})[-_]/);
    if (m) { words.push(m[1]); break; }
    words.push(w);
    if (words.length === 2) break;
  }
  if (!words.length || !words[0]) return s.slice(0, 20);
  const one = words[0].length >= 8 && !words[0].endsWith("*");
  return words.slice(0, one ? 1 : 2).join(" ");
}

const sameShop = (raw, t, rules) => {
  const a = categorise(raw, rules), b = categorise(t.raw ?? "", rules);
  if (a.rule && a.rule === b.rule) return true;
  if (t.merchant && norm(raw).includes(norm(t.merchant))) return true;
  return suggestPattern(raw) === suggestPattern(t.raw ?? "");
};

// ---------- reconciliation ----------

// Statement lines vs hand-logged items for the same card. Returns one entry per statement line, then the logged leftovers:
//   { kind: "matched" | "category" | "amount" | "new", row, txn?, cat }   cat = category to use for the row
//   { kind: "missing", txn, late }   logged but not on this statement (late: swiped near the cut-off, may post next time)
// A match: same amount (and sign) within `days` of the swipe date, closest date first.
// "amount": same shop, same sign, within `days`, but a different amount.
// "category": matched, but the merchant rules put the statement line in a different category than the one logged.
export function reconcile(rows, logged, { days = 3, rules = [], statement = null, start = null } = {}) {
  const used = new Set(), out = new Array(rows.length);
  const near = (r, t) => Math.abs(daysBetween(t.date, r.date)) <= days;
  rows.forEach((r, i) => {
    let best = null, bd = Infinity;
    for (const t of logged) {
      if (used.has(t.id) || t.amountSen !== r.amountSen || !near(r, t)) continue;
      const d = Math.abs(daysBetween(t.date, r.date)) - (sameShop(r.raw, t, rules) ? 0.5 : 0);
      if (d < bd) { best = t; bd = d; }
    }
    if (!best) return;
    used.add(best.id);
    const c = categorise(r.raw, rules);
    const conflict = r.type !== "payment" && c.rule && c.cat !== best.cat && c.cat !== "payment";
    out[i] = { kind: conflict ? "category" : "matched", row: r, txn: best, cat: best.cat, suggest: conflict ? c.cat : null };
  });
  rows.forEach((r, i) => {
    if (out[i]) return;
    let best = null, bd = Infinity;
    for (const t of logged) {
      if (used.has(t.id) || Math.sign(t.amountSen) !== Math.sign(r.amountSen) || !near(r, t) || !sameShop(r.raw, t, rules)) continue;
      const d = Math.abs(t.amountSen - r.amountSen);
      if (d < bd) { best = t; bd = d; }
    }
    if (best) { used.add(best.id); out[i] = { kind: "amount", row: r, txn: best, cat: best.cat }; return; }
    const c = categorise(r.raw, rules);
    out[i] = { kind: "new", row: r, cat: r.type === "payment" ? "payment" : c.cat === "payment" ? "other" : c.cat, merchant: c.merchant };
  });
  // Only items swiped inside the cycle can be "missing"; earlier ones were only here in case they posted late.
  const missing = logged.filter((t) => !used.has(t.id) && (!start || t.date >= start))
    .map((t) => ({ kind: "missing", txn: t, late: !!statement && t.date <= statement && daysBetween(t.date, statement) < LATE_DAYS }));
  return [...out, ...missing];
}

// Counts per kind, for the summary line.
export const tally = (res) => res.reduce((o, x) => ({ ...o, [x.kind]: (o[x.kind] ?? 0) + 1 }), {});

// Swipes this many days before a cycle starts may still post in it.
export const LATE_DAYS = 3;
// Which logged items a statement should be checked against: same card, not yet reconciled, swiped in the cycle
// or in the last LATE_DAYS before it.
export const candidates = (txns, accountId, cycle) =>
  txns.filter((t) => t.account === accountId && !t.reconciled && t.date <= cycle.statement && daysBetween(t.date, cycle.start) <= LATE_DAYS);


// ---------- spreadsheet history (one-time) ----------

// A tracker sheet copied from Google Sheets (tab-separated) or saved as CSV. Finds the header row with Date,
// Merchant (or Shop / Description) and Amount, then reads every row under it. Optional columns: Posted date,
// Category, Notes. Returns { rows: [{ date, posted, postedGuess, merchant, raw, cat, type, amountSen, notes? }], bad: [line numbers], found }.
// Category names from the sheet map onto Ledger's (SHEET_CATS, or a category's own name); "Other" or unknown
// goes through the merchant rules, so "SpayLater" still lands in BNPL.
export const SHEET_CATS = {
  "petronas fuel setel ev": "fuel-petronas", petronas: "fuel-petronas", "fuel petronas": "fuel-petronas", petrol: "fuel-petronas",
  "cashless parking": "parking", parking: "parking", payment: "payment", "card payment": "payment", refund: "refund",
};
const DMY = { jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12 };
// "18 Oct 2026", "18/10/2026", "2026-10-18" -> "2026-10-18"; anything else -> null.
export function sheetDate(s) {
  s = String(s ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (m) return s;
  m = s.match(/^(\d{1,2})[\s-]([A-Za-z]{3})[A-Za-z]*[\s-](\d{4})$/);
  if (m && DMY[m[2].toLowerCase()]) return `${m[3]}-${pad(DMY[m[2].toLowerCase()])}-${pad(m[1])}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}`;
  return null;
}
// One line -> cells: tabs (copied from Google Sheets) or CSV with "quoted, cells".
const splitRow = (line) => (line.includes("\t") ? line.split("\t")
  : line.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map((c) => c.replace(/^"|"$/g, "").replace(/""/g, '"')));
const cellKey = (c) => String(c ?? "").trim().toLowerCase().replace(/[^a-z ]/g, " ").replace(/\s+/g, " ").trim();

export function parseSheet(text, rules = []) {
  const lines = String(text ?? "").split(/\r?\n/);
  let col = null, start = -1;
  for (let i = 0; i < lines.length && !col; i++) {
    const cells = splitRow(lines[i]).map(cellKey), find = (...names) => cells.findIndex((c) => names.includes(c));
    const date = find("date", "transaction date", "txn date"), merchant = find("merchant", "shop", "description"), amount = find("amount", "amount rm");
    if (date >= 0 && merchant >= 0 && amount >= 0) {
      col = { date, merchant, amount, posted: find("posted date", "posting date", "posted"), cat: find("category"), notes: find("notes", "note") };
      start = i + 1;
    }
  }
  if (!col) return { rows: [], bad: [], found: false };
  const rows = [], bad = [];
  const known = Object.fromEntries(SYSTEM_CATEGORIES.flatMap((c) => [[cellKey(c.name), c.id], [cellKey(c.id), c.id]]));
  for (let i = start; i < lines.length; i++) {
    const c = splitRow(lines[i]), get = (k) => (col[k] >= 0 ? String(c[col[k]] ?? "").trim() : "");
    const date = sheetDate(get("date")), merchant = get("merchant"), amtText = get("amount");
    if (!get("date") && !merchant && !amtText) continue; // empty or helper-only row
    const sen = toSen(amtText.replace(/\s*CR$/i, ""));
    if (!date || !merchant || !Number.isInteger(sen) || sen === 0) { bad.push(i + 1); continue; }
    const sheetCat = cellKey(get("cat")), mapped = SHEET_CATS[sheetCat] ?? known[sheetCat] ?? null;
    const credit = /CR$/i.test(amtText) || sen < 0;
    const type = mapped === "payment" ? "payment" : mapped === "refund" || credit ? "refund" : "purchase";
    let cat = mapped && mapped !== "refund" ? mapped : null;
    if (!cat || cat === "other") { const r = categorise(merchant, rules); cat = r.cat === "payment" ? "other" : r.cat; }
    if (type === "payment") cat = "payment";
    const posted = sheetDate(get("posted"));
    const row = { date, posted: posted || date, postedGuess: !posted, merchant, raw: norm(merchant), cat, type, amountSen: type === "purchase" ? Math.abs(sen) : -Math.abs(sen) };
    const notes = get("notes"); if (notes) row.notes = notes;
    rows.push(row);
  }
  return { rows, bad, found: true };
}

// Which sheet rows are already in Ledger (logged by hand, from a statement, or a sheet imported before):
// same amount within 3 days, each existing item used once. Returns { fresh: [rows], dupes: [{ row, txn }] }.
export function sheetDupes(rows, existing) {
  const used = new Set(), fresh = [], dupes = [];
  for (const r of rows) {
    let best = null, bd = Infinity;
    for (const t of existing) {
      if (used.has(t.id) || t.amountSen !== r.amountSen) continue;
      const d = Math.abs(daysBetween(t.date, r.date));
      if (d <= 3 && d < bd) { best = t; bd = d; }
    }
    if (best) { used.add(best.id); dupes.push({ row: r, txn: best }); } else fresh.push(r);
  }
  return { fresh, dupes };
}
