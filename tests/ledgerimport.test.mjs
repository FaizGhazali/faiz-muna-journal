// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { pageLines, parseStatement, parsePasted, checkTotals, suggestPattern, reconcile, tally, candidates } from "../public/logic/ledgerimport.js";
import { SEED_ALIASES, toSen, signed, cycleOf } from "../public/logic/ledger.js";
import { STATEMENT, ROWS } from "./fixtures/cimb-2026-11.mjs";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
const dm = (mmdd) => `${mmdd.slice(3)} ${MON[Number(mmdd.slice(0, 2)) - 1]}`;

// The fixture written out the way pdf.js lines come out of a CIMB statement (made-up card number).
// split = true puts each payment's amount on its own line, the way other PDF readers order it.
function statementText(split = false) {
  const lines = ["CREDIT CARD STATEMENT / PENYATA KAD KREDIT", "Statement / Invoice Date Payment Due Date", "MY 20 NOV 2026 10 DEC 2026",
    "1111-2222-3333-4444 PETRONAS VISA 12,825.00 4,500.00 132.42 50.00", "1111-2222-3333-4444 PETRONAS VISA 0.00 25.00 25.00 0.00",
    "XXXX-XXXX-XXXX-4444 PRINCIPAL", "Posting Date Transaction Date Transaction Description Amount (RM)", "PREVIOUS BALANCE 34.50"];
  for (const [p, d, raw, amt] of ROWS) {
    const cr = amt.endsWith("CR");
    if (cr && split) lines.push(`${dm(p)} ${dm(d)} ${raw}`, "FROM SOMEONE", "Payment Desc", amt);
    else lines.push(`${dm(p)} ${dm(d)} ${raw} ${amt}`, ...(cr ? ["FROM SOMEONE", "Payment Desc"] : []));
    if (raw.startsWith("0001-7-ELEVEN")) lines.push("30% off on normal-priced jewellery. T&C apply.");
  }
  lines.push("CONTINUED ON NEXT PAGE..", "STATEMENT BALANCE 132.42", "IMPORTANT INFORMATION / MAKLUMAT PENTING");
  return lines;
}

test("pageLines groups pdf.js items into lines, top to bottom, left to right", () => {
  const it = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
  assert.deepEqual(pageLines([it("45.31", 500, 700), it("12 NOV", 50, 700.8), it("ECS* SETEL", 200, 700), it(" ", 300, 700), it("STATEMENT BALANCE", 200, 650), it("132.42", 500, 650)]),
    ["12 NOV ECS* SETEL 45.31", "STATEMENT BALANCE 132.42"]);
});

for (const split of [false, true]) {
  test(`parseStatement reads the 20 Nov statement${split ? " (amounts on their own line)" : ""}`, () => {
    const s = parseStatement(statementText(split), SEED_ALIASES);
    assert.deepEqual([s.statement, s.due, s.last4, s.prevSen, s.balanceSen, s.minPaySen], ["2026-11-20", "2026-12-10", "4444", 3450, 13242, 5000]);
    assert.equal(s.rows.length, ROWS.length);
    assert.deepEqual(s.check, { ok: true, sumSen: 13242, diffSen: 0 });
    assert.deepEqual(s.rows[0], { posted: "2026-10-21", date: "2026-10-18", raw: "SERVICE TAX", amountSen: 2500, type: "tax", card: "4444" });
    const pays = s.rows.filter((r) => r.type === "payment");
    assert.deepEqual(pays.map((r) => [r.date, r.amountSen]), [["2026-10-23", -3450], ["2026-11-11", -352047], ["2026-11-18", -30792]]);
    assert.equal(s.rows.filter((r) => r.type === "purchase").reduce((a, r) => a + r.amountSen, 0) + 2500, toSen(STATEMENT.chargesRm));
  });
}

test("parseStatement: a December line on a January statement is last year; no date means no statement", () => {
  const s = parseStatement(["20 JAN 2027 10 FEB 2027", "PREVIOUS BALANCE 0.00", "28 DEC 27 DEC SHOP A 10.00", "02 JAN 01 JAN REFUND SHOP A 4.00 CR", "STATEMENT BALANCE 6.00"]);
  assert.deepEqual(s.rows.map((r) => [r.date, r.type, r.amountSen]), [["2026-12-27", "purchase", 1000], ["2027-01-01", "refund", -400]]);
  assert.equal(s.check.ok, true);
  assert.equal(parseStatement(["no dates here"]).error, "no-date");
});

test("checkTotals spots a line the reader missed", () => {
  assert.deepEqual(checkTotals({ prevSen: 0, balanceSen: 1000, rows: [{ amountSen: 600 }] }), { ok: false, sumSen: 600, diffSen: 400 });
  assert.equal(checkTotals({ prevSen: null, balanceSen: 1000, rows: [] }), null);
});

test("parsePasted: CSV lines in several date styles, credits, and statement-style lines", () => {
  const text = ["2026-10-21, 2026-10-18, SERVICE TAX, 25.00", "23/10/2026,23/10/2026,Card payment,34.50 CR", "25/10, 23/10, PSS-STATION B MY, 43.75",
    "01/11\t31/10\tRefund, shop\t-5.00", "25 OCT 22 OCT 99 SPEEDMART-0001 MY 23.95", "not a line", ""].join("\n");
  const r = parsePasted(text, "2026-11-20", SEED_ALIASES);
  assert.deepEqual(r.rows.map((x) => [x.posted, x.date, x.raw, x.amountSen, x.type]), [
    ["2026-10-25", "2026-10-22", "99 SPEEDMART-0001 MY", 2395, "purchase"],
    ["2026-10-21", "2026-10-18", "SERVICE TAX", 2500, "tax"],
    ["2026-10-23", "2026-10-23", "CARD PAYMENT", -3450, "payment"],
    ["2026-10-25", "2026-10-23", "PSS-STATION B MY", 4375, "purchase"],
    ["2026-11-01", "2026-10-31", "REFUND, SHOP", -500, "refund"],
  ]);
  assert.deepEqual(r.bad, [6]);
});

test("suggestPattern keeps the stable start of a shop name", () => {
  const cases = {
    "CARING PHARMACY-S.CITY SHAH ALAM MY": "CARING PHARMACY", "ECS* SETEL VENTURES Kuala Lumpur MY": "ECS* SETEL",
    "99 SPEEDMART-1498 SELANGOR MY": "99 SPEEDMART", "2185-7-ELEVEN-SETIA MURNISELANGO MY": "7-ELEVEN", "ECONSAVE SETIA ALAM SHAH ALAM MY": "ECONSAVE",
    "ISLAND HOSPITAL 2 GEORGETOWN MY": "ISLAND HOSPITAL", "SUSHI KING-SETIA CITY MALSELANGO MY": "SUSHI KING", "MCDONALDS-KLANG S00236180KLANG MY": "MCDONALDS",
    "APSB_LATAR_IJOK_TOLL BTG": "APSB", "MR D.I.Y (M)-STI SHAH ALAM MY": "MR D.I.Y", "SERVICE TAX": "SERVICE TAX", "RVM*ANSA Digital Sdn": "RVM*ANSA",
  };
  for (const [raw, want] of Object.entries(cases)) assert.equal(suggestPattern(raw), want, raw);
});

// Hand-logged items for the cycle, the way a person would type them: shop names their own way, swipe dates.
const L = (id, date, raw, rmText, cat, type = "purchase", extra = {}) => ({ id, account: "cimb", date, raw, cat, type, amountSen: signed(type, toSen(rmText)), reconciled: false, ...extra });

test("reconcile: matched, amount mismatch, category conflict, new on statement, missing from statement", () => {
  const rows = parseStatement(statementText(), SEED_ALIASES).rows;
  const logged = [
    L("setel", "2026-10-20", "Setel", "479.75", "fuel-petronas"),                 // ✅ exact
    L("econ", "2026-10-19", "ECONSAVE", "111.00", "groceries"),                    // ⚠️ typed 111.00, statement 111.20
    L("mcd", "2026-10-18", "MCDONALDS", "34.45", "other"),                         // 🏷️ rules say dining
    L("pay", "2026-11-12", "Card payment", "3520.47", "payment", "payment"),       // ✅ 1 day off
    L("ghost", "2026-11-19", "Kopi", "12.00", "dining"),                           // ❌ near cut-off, may post next cycle
    L("old", "2026-10-02", "Somewhere", "9.99", "other"),                          // ❌ not on statement
  ];
  const res = reconcile(rows, logged, { rules: SEED_ALIASES, statement: "2026-11-20" });
  const by = (id) => res.find((x) => x.txn?.id === id);
  assert.equal(by("setel").kind, "matched");
  assert.equal(by("econ").kind, "amount");
  assert.equal(by("econ").row.amountSen, 11120);
  assert.equal(by("mcd").kind, "category");
  assert.equal(by("mcd").suggest, "dining");
  assert.equal(by("pay").kind, "matched");
  assert.deepEqual([by("ghost").kind, by("ghost").late], ["missing", true]);
  assert.deepEqual([by("old").kind, by("old").late], ["missing", false]);
  const t = tally(res);
  assert.deepEqual(t, { category: 1, matched: 2, amount: 1, new: ROWS.length - 4, missing: 2 });
  const fresh = res.find((x) => x.kind === "new" && x.row.raw.startsWith("PSS-STATION B"));
  assert.equal(fresh.cat, "fuel-petronas");
  assert.equal(res.find((x) => x.kind === "new" && x.row.type === "payment").cat, "payment");
});

test("reconcile: two same-amount items go to the closest dates, not the first found", () => {
  const rows = [{ date: "2026-11-05", raw: "SHOP A", amountSen: 1000, type: "purchase" }, { date: "2026-11-08", raw: "SHOP A", amountSen: 1000, type: "purchase" }];
  const logged = [L("b", "2026-11-08", "shop a", "10", "other"), L("a", "2026-11-05", "shop a", "10", "other")];
  const res = reconcile(rows, logged);
  assert.deepEqual(res.map((x) => x.txn?.id), ["a", "b"]);
});

test("candidates: this card's unreconciled items in the cycle, and the last 3 days before it", () => {
  const cycle = cycleOf({ id: "cimb", statementDay: 20, dueDay: 10 }, "2026-11-20");
  const txns = [L("in", "2026-11-01", "x", "1", "other"), L("early", "2026-10-18", "x", "1", "other"), L("tooearly", "2026-10-16", "x", "1", "other"),
    L("after", "2026-11-21", "x", "1", "other"), L("done", "2026-11-02", "x", "1", "other", "purchase", { reconciled: true }), { ...L("other", "2026-11-02", "x", "1", "other"), account: "x" }];
  assert.deepEqual(candidates(txns, "cimb", cycle).map((t) => t.id), ["in", "early"]);
});

test("reconcile: a swipe from before the cycle that isn't on it is not 'missing' (it was on the last statement)", () => {
  const rows = [{ date: "2026-10-22", raw: "SHOP A", amountSen: 1000, type: "purchase" }];
  const logged = [L("late", "2026-10-19", "shop b", "7", "other"), L("posted", "2026-10-20", "shop a", "10", "other"), L("gone", "2026-10-25", "shop c", "5", "other")];
  const res = reconcile(rows, logged, { start: "2026-10-21", statement: "2026-11-20" });
  assert.deepEqual(res.map((x) => [x.kind, x.txn?.id]), [["matched", "posted"], ["missing", "gone"]]);
});

// ---------- spreadsheet history ----------
import { parseSheet, sheetDate, sheetDupes } from "../public/logic/ledgerimport.js";

// Made-up rows in the layout of the family's tracker tab: a title block, then the table (copied from Google Sheets = tabs).
const SHEET = [
  "\tCard Tracker", "", "\tStatement month\tCurrent cycle\tStatement date (day)\t20", "\tTransactions",
  "\tDate\tPosted date\tMerchant\tCategory\tAmount\tCashback type\tThis cycle\tNotes\t\tCounts as",
  "\t18 Oct 2026\t20 Oct 2026\tKopi A\tDining\tRM16.00\tLifestyle 1–2%\t\t\t\t20 Oct 2026",
  "\t19 Oct 2026\t21 Oct 2026\tCar Insurance\tOther\tRM619.23\tNo cashback",
  "\t20 Oct 2026\t22 Oct 2026\tSetel\tPETRONAS Fuel / Setel / EV\tRM479.75\tPetrol 4–8%",
  "\t21 Oct 2026\t23 Oct 2026\tSpayLater\tOther\tRM1,469.05\tNo cashback",
  "\t22 Oct 2026\t24 Oct 2026\tShop B\tGroceries\tRM23.95\tLifestyle 1–2%\t\tCheck it earns groceries cashback",
  "\t23 Oct 2026\t25 Oct 2026\tCIMB\tPayment\tRM34.50\tPayment",
  "\t26 Oct 2026\t27 Oct 2026\tParking A\tCashless Parking\tRM5.00\tLifestyle 1–2%",
  "\t12 Nov 2026\t\tPetronas\tPETRONAS Fuel / Setel / EV\tRM5.04\tPetrol 4–8%",
  "\tnot a date\t\tSomewhere\tOther\tRM1.00",
  "\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t\t19 Oct 2026",
].join("\n");

test("sheetDate reads the sheet's date styles", () => {
  assert.equal(sheetDate("18 Oct 2026"), "2026-10-18");
  assert.equal(sheetDate("1 November 2026"), "2026-11-01");
  assert.equal(sheetDate("18/10/2026"), "2026-10-18");
  assert.equal(sheetDate("2026-10-18"), "2026-10-18");
  assert.equal(sheetDate("Oct 18"), null);
});

test("parseSheet finds the table under the title block and maps columns and categories", () => {
  const r = parseSheet(SHEET, SEED_ALIASES);
  assert.equal(r.found, true);
  assert.deepEqual(r.bad, [14]);
  assert.deepEqual(r.rows.map((x) => [x.date, x.posted, x.postedGuess, x.merchant, x.cat, x.type, x.amountSen]), [
    ["2026-10-18", "2026-10-20", false, "Kopi A", "dining", "purchase", 1600],
    ["2026-10-19", "2026-10-21", false, "Car Insurance", "other", "purchase", 61923],
    ["2026-10-20", "2026-10-22", false, "Setel", "fuel-petronas", "purchase", 47975],
    ["2026-10-21", "2026-10-23", false, "SpayLater", "bnpl", "purchase", 146905], // "Other" + merchant rules
    ["2026-10-22", "2026-10-24", false, "Shop B", "groceries", "purchase", 2395],
    ["2026-10-23", "2026-10-25", false, "CIMB", "payment", "payment", -3450],
    ["2026-10-26", "2026-10-27", false, "Parking A", "parking", "purchase", 500],
    ["2026-11-12", "2026-11-12", true, "Petronas", "fuel-petronas", "purchase", 504],
  ]);
  assert.equal(r.rows[4].notes, "Check it earns groceries cashback");
  assert.equal(r.rows[0].raw, "KOPI A");
});

test("parseSheet takes CSV too, and says when there's no table", () => {
  const r = parseSheet('Date,Merchant,Category,Amount\n2026-10-18,"Shop, Inc",Medical,"RM1,000.00"\n2026-10-19,Shop,Refund,12.00 CR');
  assert.deepEqual(r.rows.map((x) => [x.merchant, x.cat, x.type, x.amountSen]), [["Shop, Inc", "medical", "purchase", 100000], ["Shop", "other", "refund", -1200]]);
  assert.equal(parseSheet("just some text\nno table").found, false);
});

test("sheetDupes skips rows already in Ledger (same amount within 3 days), each match used once", () => {
  const rows = parseSheet(SHEET, SEED_ALIASES).rows;
  const existing = [{ id: "s1", date: "2026-10-20", amountSen: 47975 }, { id: "s2", date: "2026-10-23", amountSen: -3450 }, { id: "s3", date: "2026-10-30", amountSen: 1600 }];
  const { fresh, dupes } = sheetDupes(rows, existing);
  assert.deepEqual(dupes.map((d) => [d.row.merchant, d.txn.id]), [["Setel", "s1"], ["CIMB", "s2"]]);
  assert.equal(fresh.length, rows.length - 2);
});
