// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  toSen, rm, dateParts, shortDate, signed, norm, matchAlias, categorise, SEED_ALIASES, SYSTEM_CATEGORIES,
  cycleOf, cycleForTxn, projectedBalance, CIMB_PETRONAS, programFor, tierIndex, tierLabel, computeRebate, eligibleByCat,
  toNextTier, safeToPay, payWarning, warningText, rebateSnapshot,
} from "../public/logic/ledger.js";
import { STATEMENT, ROWS } from "./fixtures/cimb-2026-11.mjs";
import { addDays } from "../public/core/util.js";

const CARD = { id: "cimb", statementDay: 20, dueDay: 10, cycleBasis: "posted" };
const P = CIMB_PETRONAS;
const buy = (cat, rmText, raw = "SHOP") => ({ type: "purchase", cat, raw, amountSen: toSen(rmText) });

// The fixture as transactions, categorised by the seed rules unless the row says otherwise.
const TXNS = ROWS.map(([posted, date, raw, amt, cat]) => {
  const credit = amt.endsWith("CR"), c = categorise(raw, SEED_ALIASES);
  const type = credit ? "payment" : raw.startsWith("SERVICE TAX") ? "tax" : "purchase";
  return { posted: `2026-${posted}`, date: `2026-${date}`, raw, cat: cat ?? c.cat, type, amountSen: signed(type, toSen(amt.replace("CR", ""))) };
});
const sum = (xs) => xs.reduce((s, t) => s + t.amountSen, 0);
const byCat = (cat) => sum(TXNS.filter((t) => t.cat === cat && t.type === "purchase"));

// ---------- money and dates ----------

test("toSen reads statement amounts exactly", () => {
  assert.equal(toSen("3,520.47"), 352047);
  assert.equal(toSen("RM 12"), 1200);
  assert.equal(toSen("0.1"), 10);
  assert.equal(toSen(34.5), 3450);
  assert.equal(toSen("-5.05"), -505);
  assert.ok(Number.isNaN(toSen("abc")));
  assert.ok(Number.isNaN(toSen("1.234")));
});

test("rm formats sen, and whole ringgit drops cents", () => {
  assert.equal(rm(352047), "RM3,520.47");
  assert.equal(rm(13242, { whole: true }), "RM132");
  assert.equal(rm(5), "RM0.05");
  assert.equal(rm(-3450), "−RM34.50");
});

test("dateParts gives the date dimension", () => {
  const d = dateParts("2026-11-20");
  assert.deepEqual([d.key, d.ym, d.quarter, d.dow, d.weekend], [20261120, "2026-11", 4, 5, false]);
  assert.equal(dateParts("2026-11-21").weekend, true);
  assert.equal(dateParts("2026-01-01").week, 1);   // Thursday: week 1 of 2026
  assert.deepEqual([dateParts("2027-01-01").week, dateParts("2027-01-01").weekYear], [53, 2026]);
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(shortDate("2026-12-10"), "10 Dec");
});

// ---------- cycles ----------

test("cycleOf: CIMB cycle 21 Oct → 20 Nov, due 10 Dec", () => {
  const c = cycleOf(CARD, "2026-11-20");
  assert.deepEqual(c, { id: "cimb_2026-11-20", account: "cimb", start: "2026-10-21", statement: "2026-11-20", due: "2026-12-10" });
  assert.equal(cycleOf(CARD, "2026-10-21").statement, "2026-11-20");
  assert.equal(cycleOf(CARD, "2026-11-21").statement, "2026-12-20");
  assert.equal(cycleOf(CARD, "2026-12-25").due, "2027-02-10");
});

test("cycleOf: a statement day past the month's end uses the last day", () => {
  const c = cycleOf({ id: "x", statementDay: 31 }, "2027-02-15");
  assert.equal(c.statement, "2027-02-28");
  assert.equal(c.start, "2027-02-01");
  assert.equal(c.due, "2027-03-20"); // no dueDay: 20 days' grace
});

test("cycle assignment follows the posting date (CIMB), or the swipe date when set", () => {
  const t = { date: "2026-11-20", posted: "2026-11-22" };
  assert.equal(cycleForTxn(CARD, t).statement, "2026-12-20");
  assert.equal(cycleForTxn({ ...CARD, cycleBasis: "txn" }, t).statement, "2026-11-20");
  // The fixture's last Setel fill was swiped 18 Nov and posted 20 Nov: still this cycle.
  assert.equal(cycleForTxn(CARD, TXNS.at(-1)).statement, "2026-11-20");
  assert.ok(TXNS.every((x) => cycleForTxn(CARD, x).id === "cimb_2026-11-20"));
});

// ---------- merchant rules ----------

test("seed rules: PETRONAS vs Petron, Setel, tolls, payments", () => {
  assert.equal(categorise("PSS-PERSIARAN X MY", SEED_ALIASES).cat, "fuel-petronas");
  assert.equal(categorise("PETRONAS TAMAN X MY", SEED_ALIASES).cat, "fuel-petronas");
  assert.equal(categorise("PETRON BEHRANG MY", SEED_ALIASES).cat, "fuel-other");
  assert.equal(categorise("ecs*  setel ventures", SEED_ALIASES).merchant, "Setel");
  assert.equal(categorise("APSB_LATAR_IJOK_TOLL BTG", SEED_ALIASES).cat, "tolls");
  assert.equal(categorise("ISLAND HOSPITAL 2 GEORGETOWN", SEED_ALIASES).cat, "medical");
  assert.equal(categorise("TRANSFER / TOP-UP THANK YOU-CLICKS", SEED_ALIASES).type, "payment");
  assert.equal(categorise("SOMEWHERE NEW", SEED_ALIASES).cat, "other");
  assert.ok(SEED_ALIASES.every((r) => SYSTEM_CATEGORIES.some((c) => c.id === r.cat)));
});

test("matchAlias: higher priority wins, then a person's own rule, then the longer pattern", () => {
  const rules = [
    { id: "a", pattern: "AEON", match: "prefix", cat: "groceries", priority: 30, from: "seed" },
    { id: "b", pattern: "AEON BIG", match: "prefix", cat: "groceries", priority: 30, from: "seed" },
    { id: "c", pattern: "AEON", match: "prefix", cat: "shopping", priority: 30, from: "user" },
    { id: "d", pattern: "CINEMA", match: "contains", cat: "other", priority: 90, from: "seed" },
  ];
  assert.equal(matchAlias("AEON BIG MALL", rules).id, "c");
  assert.equal(matchAlias("AEON BIG MALL", rules.filter((r) => r.id !== "c")).id, "b");
  assert.equal(matchAlias("AEON CINEMA", rules).id, "d");
  assert.equal(matchAlias("x", [{ pattern: "(", match: "regex", cat: "other" }]), null); // bad regex never throws
  assert.equal(norm("  a   b "), "A B");
});

// ---------- tiers, caps, flooring ----------

test("tier selection at the RM500 and RM2,000 edges", () => {
  assert.equal(tierIndex(P, 49999), 0);
  assert.equal(tierIndex(P, 50000), 1);
  assert.equal(tierIndex(P, 199999), 1);
  assert.equal(tierIndex(P, 200000), 2);
  assert.equal(tierIndex(P, -500), 0);
  assert.deepEqual(P.tiers.map(tierLabel), ["0%", "4% / 1%", "8% / 2%"]);
  assert.deepEqual(toNextTier(P, 180000), { tier: 2, label: "8% / 2%", needSen: 20000 });
  assert.equal(toNextTier(P, 250000), null);
});

test("groceries, dining and parking share one RM50 cap", () => {
  const r = computeRebate(P, { balanceSen: 500000, txns: [buy("groceries", "2000"), buy("dining", "1000"), buy("parking", "500")] });
  const g = r.groups.find((x) => x.id === "lifestyle");
  assert.deepEqual(g.cats, ["groceries", "dining", "parking"]);
  assert.equal(g.rawSen, 7000);
  assert.equal(g.finalSen, 5000);
  assert.equal(g.capUse, 1);
  assert.equal(r.totalSen, 5000);
});

test("PETRONAS has its own cap, separate from the lifestyle group", () => {
  const r = computeRebate(P, { balanceSen: 500000, txns: [buy("fuel-petronas", "1000"), buy("dining", "100")] });
  assert.deepEqual(r.groups.map((g) => [g.id, g.finalSen]), [["petronas", 5000], ["lifestyle", 200]]);
});

test("flooring is per group and never rounds up across a ringgit", () => {
  // RM749.80 × 2% = RM14.996: rounding to sen first would give RM15.00; the bank gives RM14.
  const r = computeRebate(P, { balanceSen: 300000, txns: [buy("groceries", "749.80")] });
  assert.equal(r.groups.find((g) => g.id === "lifestyle").finalSen, 1400);
  assert.equal(computeRebate({ ...P, rounding: "none" }, { balanceSen: 300000, txns: [buy("groceries", "749.80")] }).totalSen, 1499);
});

test("refunds cut eligible spend; exclusions and uncovered categories earn nothing", () => {
  const txns = [
    buy("groceries", "100"), { type: "refund", cat: "groceries", raw: "SHOP", amountSen: -2000 },
    buy("dining", "50", "DUITNOW QR CAFE"), buy("fuel-other", "80"), buy("gov-tax", "25"),
    { type: "payment", cat: "payment", raw: "PAY", amountSen: -100000 },
  ];
  assert.deepEqual(eligibleByCat(P, txns), { groceries: 8000, "fuel-other": 8000 });
  assert.equal(computeRebate(P, { balanceSen: 300000, txns }).totalSen, 100); // RM1.60 → RM1
});

test("programFor picks the program in force on the date", () => {
  const progs = [{ ...P, id: "old", account: "cimb", from: "2020-01-01", to: "2026-06-30" }, { ...P, id: "new", account: "cimb", from: "2026-07-01" }];
  assert.equal(programFor(progs, "cimb", "2026-06-30").id, "old");
  assert.equal(programFor(progs, "cimb", "2026-11-20").id, "new");
  assert.equal(programFor(progs, "other", "2026-11-20"), null);
});

test("cycle_retail_spend programs ignore payments", () => {
  const prog = { ...P, qualifier: "cycle_retail_spend" };
  const txns = [buy("groceries", "600")];
  assert.equal(computeRebate(prog, { txns, balanceSen: 0 }).tier, 1);
  assert.equal(payWarning({ program: prog, cycle: cycleOf(CARD, "2026-11-01"), prevSen: 0, txns, payment: { date: "2026-11-01", amountSen: 60000 } }), null);
});

// ---------- the 20 Nov 2026 statement ----------

test("fixture: charges, categories and the statement balance match the statement", () => {
  assert.equal(TXNS.length, 59);
  assert.equal(sum(TXNS.filter((t) => t.type !== "payment")), toSen(STATEMENT.chargesRm));
  assert.equal(byCat("fuel-petronas"), 72577);
  assert.equal(byCat("groceries"), 31235);
  assert.equal(byCat("dining"), 44832);
  assert.equal(byCat("insurance"), 61923);
  assert.equal(byCat("bnpl"), 146905 + 19366);
  assert.equal(projectedBalance(toSen(STATEMENT.prevRm), TXNS), toSen(STATEMENT.balanceRm));
});

test("fixture: RM132.42 is the 0% tier, so the rebate is RM0", () => {
  const r = computeRebate(P, { txns: TXNS, balanceSen: 13242 });
  assert.equal(r.tierLabel, "0%");
  assert.equal(r.totalSen, 0);
});

test("fixture: without the early payments it would have been RM65", () => {
  const early = new Set([352047, 30792]);
  const kept = TXNS.filter((t) => !(t.type === "payment" && early.has(-t.amountSen)));
  const balanceSen = projectedBalance(3450, kept);
  assert.equal(balanceSen, 396081);
  const r = computeRebate(P, { txns: TXNS, balanceSen });
  assert.equal(r.tierLabel, "8% / 2%");
  const pet = r.groups.find((g) => g.id === "petronas"), life = r.groups.find((g) => g.id === "lifestyle");
  assert.equal(pet.rawSen, 5806);   // RM58.06 …
  assert.equal(pet.finalSen, 5000); // … capped at RM50
  assert.equal(life.rawSen, 1521);  // RM15.21 …
  assert.equal(life.finalSen, 1500); // … floored to RM15
  assert.equal(r.totalSen, 6500);
});

test("fixture: the 11 Nov payment sets off the 'don't pay yet' warning", () => {
  const cycle = cycleOf(CARD, "2026-11-11");
  const pay = TXNS.find((t) => t.amountSen === -352047);
  const sofar = TXNS.filter((t) => t !== pay && t.posted <= "2026-11-11");
  const w = payWarning({ program: P, cycle, prevSen: 3450, txns: sofar, payment: { date: "2026-11-11", posted: "2026-11-11", amountSen: 352047 } });
  assert.ok(w, "warning fires");
  assert.equal(w.beforeSen, 378883);  // RM3,788.83 posted by 11 Nov (RM3,960.81 less RM171.98 posted later)
  assert.equal(w.afterSen, 26836);    // RM268.36 left
  assert.equal(w.tierBefore, "8% / 2%");
  assert.equal(w.tierAfter, "0%");
  assert.equal(w.lossSen, 6300);      // RM50 PETRONAS (RM53.59, capped) + RM13 lifestyle (RM13.06) on spend so far
  assert.equal(w.safeSen, 178883);    // could have paid RM1,788.83 and stayed at 8% / 2%
  assert.equal(warningText(w),
    "Paying RM3,520.47 now drops your statement balance to RM268 (0% tier). You'd lose about RM63 rebate. Pay after 20 Nov, before 10 Dec — no profit charge if paid in full. Safe to pay now: RM1,788.83.");
});

test("payWarning stays quiet after the statement date, or when the tier holds", () => {
  const cycle = cycleOf(CARD, "2026-11-11");
  const txns = [buy("fuel-petronas", "3000")].map((t) => ({ ...t, posted: "2026-11-01" }));
  assert.equal(payWarning({ program: P, cycle, prevSen: 0, txns, payment: { date: "2026-11-21", amountSen: 300000 } }), null);
  assert.equal(payWarning({ program: P, cycle, prevSen: 0, txns, payment: { date: "2026-11-10", amountSen: 50000 } }), null);
  assert.ok(payWarning({ program: P, cycle, prevSen: 0, txns, payment: { date: "2026-11-10", amountSen: 100001 } }));
  assert.equal(safeToPay(P, 300000), 100000);
  assert.equal(safeToPay(P, 30000), 30000); // already 0%: nothing to lose
});

test("rebateSnapshot keeps what trend charts need", () => {
  const c = cycleOf(CARD, "2026-11-20");
  const s = rebateSnapshot(c, { ...P, id: "prog1" }, computeRebate(P, { txns: TXNS, balanceSen: 13242 }), { at: 1 });
  assert.deepEqual([s.cycle, s.account, s.program, s.totalSen, s.projection, s.tierLabel], ["cimb_2026-11-20", "cimb", "prog1", 0, false, "0%"]);
});

// ---------- milestone 2 helpers ----------
import { openingBalance, cycleView, manualTxn, nearCutoff, lastStatement, prevStatement, spendByCat, spendTotal } from "../public/logic/ledger.js";

test("lastStatement / prevStatement step back one cycle", () => {
  assert.equal(lastStatement(CARD, "2026-11-23"), "2026-11-20");
  assert.equal(lastStatement(CARD, "2026-11-20"), "2026-10-20");
  assert.equal(prevStatement(CARD, "2027-01-20"), "2026-12-20");
});

test("openingBalance: typed balance, then worked out, then a real statement wins", () => {
  const acc = { ...CARD, openingSen: 3450, openingDate: "2026-10-20" };
  assert.equal(openingBalance(acc, {}, [], "2026-11-20"), 3450);
  assert.equal(openingBalance(acc, {}, [], "2026-10-20"), 0); // before the card was added
  const txns = TXNS.map((t) => ({ ...t, account: "cimb" }));
  assert.equal(openingBalance(acc, {}, txns, "2026-12-20"), 13242); // projected 20 Nov balance
  assert.equal(openingBalance(acc, { "cimb_2026-11-20": { balanceSen: 13000 } }, txns, "2026-12-20"), 13000);
  assert.equal(openingBalance({ ...CARD }, {}, txns, "2026-12-20"), 0); // no opening date: start from zero
});

test("cycleView puts the fixture together for the rebate card", () => {
  const acc = { ...CARD, openingSen: 3450, openingDate: "2026-10-20", program: "prog" };
  const txns = TXNS.map((t) => ({ ...t, account: "cimb" }));
  const v = cycleView(acc, { programs: [{ ...P, id: "prog", account: "cimb" }], txns, day: "2026-11-15" });
  assert.equal(v.cycle.statement, "2026-11-20");
  assert.equal(v.daysLeft, 5);
  assert.equal(v.balanceSen, 13242);
  assert.equal(v.rebate.totalSen, 0);
  assert.deepEqual(v.next, { tier: 1, label: "4% / 1%", needSen: 50000 - 13242 });
  assert.equal(v.safeSen, 13242);
});

test("manualTxn signs, normalises and files the row in its cycle", () => {
  const t = manualTxn(CARD, { spentBy: "p1", date: "2026-11-19", amount: "45.31", type: "purchase", raw: " ecs* setel  ventures ", cat: "fuel-petronas", merchant: "Setel" }, 1);
  assert.deepEqual([t.amountSen, t.raw, t.posted, t.postedGuess, t.cycle, t.source], [4531, "ECS* SETEL VENTURES", "2026-11-19", true, "cimb_2026-11-20", "manual"]);
  const p = manualTxn(CARD, { spentBy: "p1", date: "2026-11-21", amount: "100", type: "payment", raw: "Payment", cat: "dining" }, 2);
  assert.deepEqual([p.amountSen, p.cat, p.cycle], [-10000, "payment", "cimb_2026-12-20"]);
  assert.equal(nearCutoff(CARD, t), true);   // 1 day before cut-off
  assert.equal(nearCutoff(CARD, { ...t, date: "2026-11-15", postedGuess: true }), false);
  assert.equal(nearCutoff(CARD, { ...t, postedGuess: false }), false);
});

test("spendByCat: one person's spending by category, payments left out", () => {
  const txns = [
    { spentBy: "p1", date: "2026-11-02", cat: "dining", type: "purchase", amountSen: 1000 },
    { spentBy: "p1", date: "2026-11-03", cat: "groceries", type: "purchase", amountSen: 3000 },
    { spentBy: "p1", date: "2026-11-04", cat: "dining", type: "refund", amountSen: -400 },
    { spentBy: "p2", date: "2026-11-04", cat: "dining", type: "purchase", amountSen: 9900 },
    { spentBy: "p1", date: "2026-11-05", cat: "payment", type: "payment", amountSen: -5000 },
    { spentBy: "p1", date: "2026-10-31", cat: "dining", type: "purchase", amountSen: 700 },
  ];
  const rows = spendByCat(txns, { from: "2026-11-01", to: "2026-11-30", person: "p1" });
  assert.deepEqual(rows, [{ cat: "groceries", sen: 3000 }, { cat: "dining", sen: 600 }]);
  assert.equal(spendTotal(rows), 3600);
});

import { owedPrev, expectedBalance } from "../public/logic/ledger.js";

test("paying off the last statement is never 'early'; only the extra is", () => {
  // Last statement RM1,983.32 still unpaid (due 10 Dec), RM500 of new spending so far in the 21 Nov → 20 Dec cycle.
  const cycle = cycleOf(CARD, "2026-12-02");
  const txns = [{ ...buy("fuel-petronas", "500"), posted: "2026-11-25" }];
  assert.equal(owedPrev(198332, txns), 198332);
  assert.equal(expectedBalance(198332, txns), 50000);
  const pay = (rmText) => payWarning({ program: P, cycle, prevSen: 198332, txns, payment: { date: "2026-12-02", amountSen: toSen(rmText) } });
  assert.equal(pay("1983.32"), null);           // just the bill
  const w = pay("2283.32");                      // the bill + RM300 of this cycle's spending
  assert.ok(w);
  assert.deepEqual([w.owedSen, w.beforeSen, w.afterSen, w.tierBefore, w.tierAfter, w.lossSen, w.safeSen], [198332, 50000, 20000, "4% / 1%", "0%", 2000, 198332]);
  assert.match(warningText(w), /RM1,983\.32 of it pays your last statement/);
  assert.match(warningText(w), /Pay the rest after 20 Dec, before 10 Jan/);
  // Part-paid already: only what's left of the bill is "owed".
  assert.equal(owedPrev(198332, [...txns, { type: "payment", amountSen: -100000 }]), 98332);
  // The rebate card works from the expected balance, not one that still counts the unpaid bill.
  const acc = { ...CARD, openingSen: 198332, openingDate: "2026-11-20", program: "prog" };
  const v = cycleView(acc, { programs: [{ ...P, id: "prog", account: "cimb" }], txns: txns.map((t) => ({ ...t, account: "cimb", date: "2026-11-25" })), day: "2026-12-02" });
  assert.deepEqual([v.owedSen, v.prevDue, v.balanceSen, v.rebate.tierLabel, v.safeSen], [198332, "2026-12-10", 50000, "4% / 1%", 198332]);
});
