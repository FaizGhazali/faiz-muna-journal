// Stocky receipt scanning: the pure rules. No DOM, no Firestore. Tests: tests/receipt.test.mjs.
// A picture of a shop receipt is read by Gemini on the family's Modal server (modal/receipt_reader.py), which
// answers with JSON. Here: tidy that answer (readReceipt), check it adds up (checkReceipt), match each printed
// name to a Stocky item (matchLine: an alias learned earlier, else a suggestion), and turn the confirmed lines
// into Stocky buys (toBuys). Plan and decisions: docs/receipt-scan-plan.md.
//
// Shapes:
//   receipts/{auto id}  { shop, branch?, date, total, status: parsed|needs_review|confirmed,
//                         lines: [{ raw, qty, unitPrice?, lineTotal, item?, match?: alias|suggested|manual, skip?, amount? }],
//                         raw (Gemini's JSON as text), model, by, created, updated }
//   receiptAliases/{aliasId(shop, raw)}  { shop, raw, item, by, created, updated }
//   buys get `receipt: <receipt id>`.
import { searchKey, findByName } from "./search.js";
import { shopId } from "./shops.js";
import { looksLike } from "./diary.js";

export const TOTAL_SLACK = 0.05; // RM: the lines may be this far off the printed total and still add up
export const LINE_SLACK = 0.02; // RM: qty × unit price vs the line total
export const LINES_MAX = 120; // a receipt longer than this is cut (nobody buys more at once)
export const STATUS = { parsed: "parsed", review: "needs_review", confirmed: "confirmed" };

const r2 = (n) => Math.round(n * 100) / 100;
// "RM 4.50", "4,50", "-1.00", 4.5 → 4.5; nothing readable → null.
export function num(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v !== "string") return null;
  let s = v.replace(/rm|myr|\s/gi, "");
  const neg = /^-|-$|^\(.*\)$/.test(s);
  s = s.replace(/[()\-]/g, "");
  if (/^\d+,\d{2}$/.test(s)) s = s.replace(",", ".");
  s = s.replace(/,/g, "");
  const n = Number(s);
  return s && Number.isFinite(n) ? (neg ? -n : n) : null;
}
const text = (v, max = 80) => String(v ?? "").replace(/\s+/g, " ").trim().slice(0, max);
// "2026-11-25", "25/11/2026", "25-11-26" → "2026-11-25"; anything else → null.
export function readDate(v) {
  const s = text(v, 20);
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return ok(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/);
  if (m) return ok(m[3].length === 2 ? 2000 + +m[3] : +m[3], +m[2], +m[1]); // Malaysian receipts: day first
  return null;
  function ok(y, mo, d) {
    if (mo < 1 || mo > 12 || d < 1 || d > 31 || y < 2000 || y > 2100) return null;
    return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  }
}

// Gemini's answer (an object or its JSON text) → a tidy receipt, or { error }.
// { shop, branch, date, currency, lines: [{ raw, qty, unitPrice?, lineTotal }], subtotal, discounts, rounding, total }
export function readReceipt(answer, today) {
  let a = answer;
  if (typeof a === "string") {
    try { a = JSON.parse(a.replace(/^```(?:json)?\s*|\s*```$/g, "")); } catch (_) { return { error: "The reader's answer wasn't readable." }; }
  }
  if (!a || typeof a !== "object" || !Array.isArray(a.items)) return { error: "No items were found on the receipt." };
  const lines = a.items.slice(0, LINES_MAX).map((it) => {
    const raw = text(it?.raw_name, 80), lineTotal = num(it?.line_total), unitPrice = num(it?.unit_price);
    let qty = num(it?.qty);
    if (!(qty > 0)) qty = unitPrice > 0 && lineTotal > 0 ? r2(lineTotal / unitPrice) || 1 : 1;
    return { raw, qty, ...(unitPrice != null && unitPrice !== 0 ? { unitPrice: r2(unitPrice) } : {}), lineTotal: lineTotal == null ? null : r2(lineTotal) };
  }).filter((l) => l.raw && l.lineTotal != null);
  if (!lines.length) return { error: "No items were found on the receipt." };
  const z = (v) => { const n = num(v); return n == null ? 0 : r2(n); };
  return {
    receipt: {
      shop: text(a.store_name, 60), branch: text(a.store_branch, 60), date: readDate(a.date) || today,
      currency: text(a.currency, 5).toUpperCase() || "MYR", lines,
      subtotal: num(a.subtotal), discounts: z(a.discounts) ? -Math.abs(z(a.discounts)) : 0, rounding: z(a.rounding), total: num(a.total),
    },
  };
}

// Does it add up? Lines (discount lines are negative) + bill discounts + rounding ≈ the printed total, and
// qty × unit price ≈ each line total where a unit price is printed.
// { ok, sum, total, diff, badLines: [index] }
export function checkReceipt(r) {
  const sum = r2(r.lines.reduce((s, l) => s + (Number(l.lineTotal) || 0), 0) + (Number(r.discounts) || 0) + (Number(r.rounding) || 0));
  const total = num(r.total);
  const diff = total == null ? null : r2(sum - total);
  const badLines = r.lines.map((l, i) => (l.unitPrice && l.lineTotal > 0 && Math.abs(l.qty * l.unitPrice - l.lineTotal) > LINE_SLACK + 1e-9 ? i : -1)).filter((i) => i >= 0);
  return { ok: diff != null && Math.abs(diff) <= TOTAL_SLACK + 1e-9 && !badLines.length, sum, total, diff, badLines };
}

// ---------- matching printed names to Stocky items ----------
// The printed name as a key: case, spaces and punctuation don't count ("GARDENIA  WHITE-400G" = "gardenia white 400g").
export const nameKey = (raw) => searchKey(raw);
// One alias per shop and printed name: the same words at another shop may be something else.
export function aliasId(shop, raw) {
  return `${shopId(shop) || "any"}_${nameKey(raw).replace(/ /g, "-")}`.slice(0, 140);
}
// A Stocky item for a printed line: an alias learned before (that shop's, else any shop's), else a suggestion:
// the item whose every name word is on the line ("Telur" in "TELUR GRED A 30BIJI"; longest name wins), else
// a "Did you mean" from findByName. Discount lines never match. { item, match: "alias"|"suggested" } or {}.
export function matchLine(line, shop, aliases = [], pantry = []) {
  if (!(line.lineTotal > 0)) return {};
  const live = (id) => pantry.some((p) => p.id === id);
  const k = nameKey(line.raw), here = shopId(shop);
  const al = aliases.find((a) => nameKey(a.raw) === k && shopId(a.shop) === here && live(a.item))
    ?? aliases.find((a) => nameKey(a.raw) === k && live(a.item));
  if (al) return { item: al.item, match: "alias" };
  const ws = k.split(" ").filter(Boolean);
  const has = (w) => ws.some((t) => t === w || (w.length > 3 && (t.startsWith(w) || looksLike(w, t))));
  const inLine = pantry.filter((p) => { const n = nameKey(p.name).split(" ").filter(Boolean); return n.length && n.every(has); })
    .sort((a, b) => nameKey(b.name).length - nameKey(a.name).length);
  if (inLine[0]) return { item: inLine[0].id, match: "suggested" };
  const { hits, close } = findByName(pantry, line.raw);
  const pick = hits[0] || close[0];
  return pick ? { item: pick.id, match: "suggested" } : {};
}
// Every line of a receipt with its match filled in (kept as it is once someone picked by hand).
export function matchAll(lines, shop, aliases, pantry) {
  return lines.map((l) => (l.match === "manual" || l.skip ? l : { ...stripMatch(l), ...matchLine(l, shop, aliases, pantry) }));
}
const stripMatch = ({ item, match, ...l }) => l;

// ---------- saving ----------
// A receipt line counts packs ("2 × Beras 5kg"); a buy counts the item's unit: qty × the item's usual pack,
// unless the person typed how much it was (`amount` on the line, in the item's unit).
export function buyQty(qty, item) {
  const q = Number(qty) > 0 ? Number(qty) : 1, pack = Number(item?.pack);
  return r2(pack > 0 ? q * pack : q);
}
// Discount lines (negative) belong to the item line just above them, the way receipts print them: its price drops
// and the buy is marked as on sale. A discount with nothing above it is left out.
export function foldDiscounts(lines) {
  const out = [];
  for (const l of lines) {
    if (l.skip) { out.push({ ...l }); continue; }
    const prev = [...out].reverse().find((x) => !x.skip && x.lineTotal > 0);
    if (l.lineTotal < 0 && prev) { prev.lineTotal = r2(prev.lineTotal + l.lineTotal); prev.sale = true; continue; }
    if (l.lineTotal > 0) out.push({ ...l });
  }
  return out;
}
// The Stocky buys a confirmed receipt makes: one per line with an item, not skipped.
// [{ item, date, qty, price, shop, sale?, receipt }] (the caller adds by / at).
export function toBuys(receipt, pantry, receiptId) {
  const byId = new Map(pantry.map((p) => [p.id, p]));
  return foldDiscounts(receipt.lines).filter((l) => !l.skip && l.item && byId.has(l.item) && l.lineTotal > 0).map((l) => ({
    item: l.item, date: receipt.date, qty: Number(l.amount) > 0 ? r2(Number(l.amount)) : buyQty(l.qty, byId.get(l.item)), price: r2(Math.max(0, l.lineTotal)),
    ...(receipt.shop ? { shop: receipt.shop } : {}), ...(l.sale ? { sale: true } : {}), receipt: receiptId,
  }));
}
// The aliases to remember: every line given an item, not already remembered as that item for this shop.
// [{ id, shop, raw, item }]
export function newAliases(receipt, aliases = []) {
  const known = new Map(aliases.map((a) => [aliasId(a.shop, a.raw), a.item])), out = new Map();
  for (const l of receipt.lines) {
    if (l.skip || !l.item || !(l.lineTotal > 0)) continue;
    const id = aliasId(receipt.shop, l.raw);
    if (known.get(id) !== l.item) out.set(id, { id, shop: receipt.shop, raw: l.raw, item: l.item });
  }
  return [...out.values()];
}
// "Beras faiza" from "BERAS FAIZA 5KG": a printed name as a starting name for a new item, without its size or count
// (the item's pack says that), first letter capital like the rest of Stocky.
const SIZE = /^(\d+([.,]\d+)?(kg|g|gm|gr|mg|ml|l|ltr|s|pcs?|biji|pk|pkt)?|\d+x\d+\w*|x\d+)$/i;
export function niceName(raw) {
  const ws = text(raw, 60).split(" "), kept = ws.filter((w) => !SIZE.test(w));
  const s = (kept.length ? kept : ws).join(" ").toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Receipts newest first, optionally only one status.
export const receiptList = (receipts, status) => receipts.filter((r) => !status || r.status === status)
  .sort((a, b) => String(b.date).localeCompare(String(a.date)) || (b.created || 0) - (a.created || 0));
