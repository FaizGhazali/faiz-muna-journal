// Ledger: money, statement cycles, merchant rules and the card rebate engine.
// Pure: no Firebase, no DOM. Tests: tests/ledger.test.mjs, tests/ledgertrends.test.mjs.
import { pad, addDays, dayNum } from "../core/util.js";
//
// Money is always whole sen (integers). Spend is positive; payments, refunds and credits are negative.
// Dates are local "YYYY-MM-DD" strings (the family is in Asia/Kuala_Lumpur, so local time is MYT).
//
// Firestore collections (the star-schema shape; every chart groups ledgerTxns by one of these):
//   ledgerAccounts/{id}   { owner, type, name, issuer?, last4?, limitSen?, statementDay, dueDay, cycleBasis, openingSen, openingDate, active, program?, created, updated }
//   ledgerCategories/{id} { name, parent?, module }                 user-added only; SYSTEM_CATEGORIES live here in code
//   ledgerMerchants/{id}  { name, cat }
//   ledgerAliases/{id}    { pattern, match, merchant?, cat, priority, from: seed|user, created }
//   ledgerCycles/{account}_{statement} { account, start, statement, due, balanceSen?, minPaySen?, prevSen?, status: open|closed, importedAt?, updated }
//   ledgerTxns/{id}       { account, spentBy, date, posted, postedGuess?, cycle, merchant? (display name), cat, raw, amountSen, type, source, batch?, reconciled, notes?, tags?: [{type, value}], bucket? (money plan bucket picked by hand; null = by category), updated?, at }
//   ledgerPrograms/{id}   { account, name, qualifier, rounding, credited, needsMinPay, from, to?, tiers: [{ minSen, maxSen?, rates: [{ cat, bps, capSen?, capGroup? }] }], exclusions: [{ cat } | { pattern, match }], created, updated }
//   ledgerRebates/{cycle} { cycle, account, program, tier, qualifierSen, totalSen, groups, cats, projection, at }   snapshot written when a cycle closes

// ---------- money ----------

// "3,520.47", "RM 12", 34.5 -> sen. Anything unreadable -> NaN.
export function toSen(v) {
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : NaN;
  const s = String(v ?? "").replace(/rm/i, "").replace(/[,\s]/g, "");
  if (!/^-?\d+(\.\d{1,2})?$/.test(s)) return NaN;
  const neg = s.startsWith("-"), [whole, frac = ""] = s.replace("-", "").split(".");
  const n = Number(whole) * 100 + Number((frac + "00").slice(0, 2));
  return neg ? -n : n;
}

// 352047 -> "RM3,520.47"; { whole: true } -> "RM3,520" (cents dropped, not rounded, like the bank's floor).
export function rm(sen, { whole = false } = {}) {
  const neg = sen < 0, a = Math.abs(Math.trunc(sen));
  const r = Math.floor(a / 100).toLocaleString("en-MY");
  return `${neg ? "−" : ""}RM${r}${whole ? "" : "." + String(a % 100).padStart(2, "0")}`;
}

// ---------- dates ----------

const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
const split = (s) => s.split("-").map(Number);
const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Whole days from a to b ("YYYY-MM-DD"), negative when b is earlier.
export const daysBetween = (a, b) => dayNum(b) - dayNum(a);
// "2026-11-20" -> "20 Nov"
export const shortDate = (s) => { const [, m, d] = split(s); return `${d} ${MONTHS[m - 1]}`; };

// The date dimension, worked out instead of stored: everything a chart might group by.
export function dateParts(s) {
  const [y, m, d] = split(s), t = new Date(Date.UTC(y, m - 1, d)), dow = t.getUTCDay();
  // ISO week: the week belongs to the year its Thursday is in.
  const th = new Date(Date.UTC(y, m - 1, d + 3 - ((dow + 6) % 7)));
  const week = 1 + Math.floor((th - Date.UTC(th.getUTCFullYear(), 0, 1)) / 6048e5);
  return { key: y * 10000 + m * 100 + d, year: y, month: m, day: d, ym: `${y}-${pad(m)}`, quarter: Math.ceil(m / 3), week, weekYear: th.getUTCFullYear(), dow, weekend: dow === 0 || dow === 6 };
}

// ---------- categories ----------

// System categories. Ids are fixed forever (transactions and rules point at them). `module` lets
// later Ledger parts (tax relief, savings, crypto) add their own without changing this shape.
export const SYSTEM_CATEGORIES = [
  { id: "fuel-petronas", name: "Fuel – PETRONAS", module: "spending", icon: "fuel" },
  { id: "fuel-other", name: "Fuel – Other", module: "spending", icon: "fuel" },
  { id: "groceries", name: "Groceries", module: "spending", icon: "cart" },
  { id: "dining", name: "Dining", module: "spending", icon: "bowl" },
  { id: "parking", name: "Cashless Parking", module: "spending", icon: "parking" },
  { id: "tolls", name: "Tolls", module: "spending", icon: "road" },
  { id: "medical", name: "Medical", module: "spending", icon: "medical" },
  { id: "insurance", name: "Insurance", module: "spending", icon: "shield" },
  { id: "bnpl", name: "BNPL Repayment", module: "spending", icon: "receipt" },
  { id: "shopping", name: "Shopping", module: "spending", icon: "bag" },
  { id: "utilities", name: "Utilities", module: "spending", icon: "bulb" },
  { id: "gov-tax", name: "Government / Tax", module: "spending", icon: "bank" },
  { id: "other", name: "Other", module: "spending", icon: "tag" },
  { id: "payment", name: "Card payment", module: "spending", icon: "undo", hidden: true },
];
export const catName = (id, extra = []) => [...SYSTEM_CATEGORIES, ...extra].find((c) => c.id === id)?.name ?? "Other";

// ---------- transactions ----------

export const TXN_TYPES = ["purchase", "payment", "refund", "fee", "tax", "rebate_credit", "cash_advance"];
const CREDIT = new Set(["payment", "refund", "rebate_credit"]);
export const isCredit = (type) => CREDIT.has(type);
// Puts the sign on an amount from its type, whatever sign it was typed with.
export const signed = (type, sen) => (isCredit(type) ? -Math.abs(sen) : Math.abs(sen));
// Money that counts as spending (for trends): purchases, fees, tax, cash advances, less refunds.
export const isSpend = (t) => t.type !== "payment" && t.type !== "rebate_credit";

// ---------- merchant rules ----------

// Statement text -> one comparable form: upper case, single spaces.
export const norm = (s) => String(s ?? "").toUpperCase().replace(/\s+/g, " ").trim();

// Seed rules (from: "seed"); people can edit or delete them like their own.
// match: prefix | contains | regex. Higher priority wins; on a tie, the longer pattern.
export const SEED_ALIASES = [
  { id: "seed-setel", pattern: "ECS* SETEL", match: "prefix", merchant: "Setel", cat: "fuel-petronas", priority: 50 },
  { id: "seed-pss", pattern: "PSS-", match: "prefix", merchant: "PETRONAS", cat: "fuel-petronas", priority: 50 },
  { id: "seed-petronas", pattern: "PETRONAS ", match: "prefix", merchant: "PETRONAS", cat: "fuel-petronas", priority: 50 },
  { id: "seed-petron", pattern: "PETRON ", match: "prefix", merchant: "Petron", cat: "fuel-other", priority: 50 },
  { id: "seed-shell", pattern: "SHELL ", match: "prefix", merchant: "Shell", cat: "fuel-other", priority: 40 },
  { id: "seed-caltex", pattern: "CALTEX", match: "prefix", merchant: "Caltex", cat: "fuel-other", priority: 40 },
  { id: "seed-bhp", pattern: "BHP", match: "prefix", merchant: "BHP", cat: "fuel-other", priority: 40 },
  { id: "seed-hospital", pattern: "HOSPITAL", match: "contains", cat: "medical", priority: 30 },
  { id: "seed-klinik", pattern: "KLINIK", match: "contains", cat: "medical", priority: 30 },
  { id: "seed-clinic", pattern: "CLINIC", match: "contains", cat: "medical", priority: 30 },
  { id: "seed-pharmacy", pattern: "PHARMACY", match: "contains", cat: "medical", priority: 30 },
  { id: "seed-toll", pattern: "^APSB_.*TOLL", match: "regex", merchant: "Toll", cat: "tolls", priority: 50 },
  { id: "seed-tng", pattern: "TOUCH N GO", match: "contains", cat: "tolls", priority: 20 },
  { id: "seed-spaylater", pattern: "SPAYLATER", match: "prefix", merchant: "SPayLater", cat: "bnpl", priority: 50 },
  { id: "seed-atome", pattern: "ATOME", match: "contains", merchant: "Atome", cat: "bnpl", priority: 40 },
  { id: "seed-ansa", pattern: "RVM*ANSA", match: "prefix", merchant: "Ansa", cat: "insurance", priority: 50 },
  { id: "seed-takaful", pattern: "TAKAFUL", match: "contains", cat: "insurance", priority: 30 },
  { id: "seed-servicetax", pattern: "SERVICE TAX", match: "prefix", merchant: "Service tax", cat: "gov-tax", priority: 60 },
  { id: "seed-lhdn", pattern: "LHDN", match: "contains", cat: "gov-tax", priority: 40 },
  { id: "seed-payment", pattern: "TRANSFER / TOP-UP THANK YOU", match: "prefix", cat: "payment", priority: 60, type: "payment" },
  { id: "seed-econsave", pattern: "ECONSAVE", match: "prefix", merchant: "Econsave", cat: "groceries", priority: 40 },
  { id: "seed-speedmart", pattern: "99 SPEEDMART", match: "prefix", merchant: "99 Speedmart", cat: "groceries", priority: 40 },
  { id: "seed-7eleven", pattern: "7-ELEVEN", match: "contains", merchant: "7-Eleven", cat: "groceries", priority: 40 },
  { id: "seed-aeon", pattern: "AEON", match: "prefix", merchant: "AEON", cat: "groceries", priority: 30 },
  { id: "seed-lotus", pattern: "LOTUS'S", match: "prefix", merchant: "Lotus's", cat: "groceries", priority: 40 },
  { id: "seed-mydin", pattern: "MYDIN", match: "prefix", merchant: "Mydin", cat: "groceries", priority: 40 },
  { id: "seed-jaya", pattern: "JAYA GROCER", match: "prefix", merchant: "Jaya Grocer", cat: "groceries", priority: 40 },
  { id: "seed-mrdiy", pattern: "MR D.I.Y", match: "prefix", merchant: "MR DIY", cat: "shopping", priority: 40 },
  { id: "seed-mcd", pattern: "MCDONALDS", match: "prefix", merchant: "McDonald's", cat: "dining", priority: 40 },
  { id: "seed-kfc", pattern: "KFC", match: "prefix", merchant: "KFC", cat: "dining", priority: 40 },
  { id: "seed-dominos", pattern: "DOMINOS", match: "prefix", merchant: "Domino's", cat: "dining", priority: 40 },
  { id: "seed-sushiking", pattern: "SUSHI KING", match: "prefix", merchant: "Sushi King", cat: "dining", priority: 40 },
  { id: "seed-coffeebean", pattern: "MYCBTL", match: "prefix", merchant: "Coffee Bean", cat: "dining", priority: 40 },
  { id: "seed-zus", pattern: "ZUS COFFEE", match: "prefix", merchant: "ZUS Coffee", cat: "dining", priority: 40 },
  { id: "seed-tealive", pattern: "TEALIVE", match: "prefix", merchant: "Tealive", cat: "dining", priority: 40 },
  { id: "seed-grabfood", pattern: "GRABFOOD", match: "contains", merchant: "GrabFood", cat: "dining", priority: 40 },
  { id: "seed-foodpanda", pattern: "FOODPANDA", match: "contains", merchant: "foodpanda", cat: "dining", priority: 40 },
  { id: "seed-parking", pattern: "PARKING", match: "contains", cat: "parking", priority: 30 },
  { id: "seed-tnb", pattern: "TNB", match: "prefix", merchant: "TNB", cat: "utilities", priority: 40 },
  { id: "seed-unifi", pattern: "UNIFI", match: "contains", merchant: "unifi", cat: "utilities", priority: 40 },
].map((r) => ({ ...r, from: "seed" }));

export function ruleMatches(rule, desc) {
  const d = norm(desc), p = rule.match === "regex" ? rule.pattern : norm(rule.pattern);
  if (!p) return false;
  if (rule.match === "prefix") return d.startsWith(p);
  if (rule.match === "contains") return d.includes(p);
  if (rule.match === "regex") { try { return new RegExp(p, "i").test(d); } catch (_) { return false; } }
  return false;
}

// The rule that decides a description's merchant and category, or null.
export function matchAlias(desc, rules) {
  let best = null;
  for (const r of rules) {
    if (!ruleMatches(r, desc)) continue;
    const better = !best || (r.priority ?? 0) > (best.priority ?? 0)
      || ((r.priority ?? 0) === (best.priority ?? 0) && (r.from === "user") > (best.from === "user"))
      || ((r.priority ?? 0) === (best.priority ?? 0) && (r.from === "user") === (best.from === "user") && r.pattern.length > best.pattern.length);
    if (better) best = r;
  }
  return best;
}

// Fills cat / merchant / type for a raw statement line from the rules (a payment line becomes type "payment").
export function categorise(desc, rules) {
  const r = matchAlias(desc, rules);
  return { cat: r?.cat ?? "other", merchant: r?.merchant ?? null, type: r?.type ?? null, rule: r?.id ?? null };
}

// ---------- statement cycles ----------

// The statement date for a month: the account's statement day, or the month's last day if shorter.
const stmtIn = (y, m, day) => ymd(y, m, Math.min(day, daysIn(y, m)));
const nextMonth = (y, m) => (m === 12 ? [y + 1, 1] : [y, m + 1]);
const prevMonth = (y, m) => (m === 1 ? [y - 1, 12] : [y, m - 1]);

// The cycle a date falls in. A cycle runs from the day after last statement to this statement date.
// Due date: the account's dueDay in the month after the statement (CIMB: statement 20th, due 10th).
export function cycleOf(account, date) {
  const [y, m, d] = split(date), day = account.statementDay;
  let [sy, sm] = [y, m];
  if (d > Math.min(day, daysIn(y, m))) [sy, sm] = nextMonth(y, m);
  const statement = stmtIn(sy, sm, day);
  const [py, pm] = prevMonth(sy, sm);
  const start = addDays(stmtIn(py, pm, day), 1);
  let due;
  if (account.dueDay) {
    const [dy, dm] = Number(account.dueDay) > Math.min(day, daysIn(sy, sm)) ? [sy, sm] : nextMonth(sy, sm);
    due = ymd(dy, dm, Math.min(account.dueDay, daysIn(dy, dm)));
  } else due = addDays(statement, account.graceDays ?? 20);
  return { id: `${account.id}_${statement}`, account: account.id, start, statement, due };
}

// The date that decides a transaction's cycle: posting date for CIMB ("posted"), or the swipe date.
export const cycleDate = (account, txn) => ((account.cycleBasis ?? "posted") === "txn" ? txn.date : txn.posted || txn.date);
export const cycleForTxn = (account, txn) => cycleOf(account, cycleDate(account, txn));

// The cycle just before the one ending on `statement`.
export const prevStatement = (account, statement) => cycleOf(account, addDays(cycleOf(account, statement).start, -1)).statement;
// The latest statement date on or before a day (the "last statement" when adding a card).
export const lastStatement = (account, day) => prevStatement(account, cycleOf(account, day).statement);

// A swipe logged by hand gets its swipe date as posting date until a statement says otherwise.
// Swipes in the last CUTOFF_DAYS before the statement date may post in the next cycle.
export const CUTOFF_DAYS = 2;
export const nearCutoff = (account, t) => !!t.postedGuess && (account.cycleBasis ?? "posted") === "posted" && t.amountSen > 0
  && daysBetween(t.date, cycleOf(account, t.date).statement) < CUTOFF_DAYS;

// ---------- statement balance ----------

// What the statement will say: last balance, plus every signed amount posted in this cycle.
export const projectedBalance = (prevSen, txns) => txns.reduce((s, t) => s + t.amountSen, prevSen);

// The balance a cycle starts from: the real statement balance when that statement was imported, else worked out
// from the balance typed when the card was added (account.openingSen on account.openingDate) plus everything since.
// cycles: { "<account>_<statement>": { balanceSen? } }. txns: all of this account's transactions.
export function openingBalance(account, cycles, txns, statement) {
  const prev = prevStatement(account, statement);
  if (!account.openingDate || prev < account.openingDate) return 0;
  if (prev === account.openingDate) return cycles[`${account.id}_${prev}`]?.balanceSen ?? account.openingSen ?? 0;
  const known = cycles[`${account.id}_${prev}`]?.balanceSen;
  if (known != null) return known;
  const inPrev = txns.filter((t) => t.account === account.id && cycleForTxn(account, t).statement === prev);
  return projectedBalance(openingBalance(account, cycles, txns, prev), inPrev);
}

// Everything the rebate card needs for one account's current (or given) cycle.
export function cycleView(account, { programs = [], cycles = {}, txns = [], day }) {
  const cycle = cycleOf(account, day);
  const mine = txns.filter((t) => t.account === account.id);
  const inCycle = mine.filter((t) => cycleForTxn(account, t).id === cycle.id);
  const prevSen = openingBalance(account, cycles, mine, cycle.statement);
  // owedSen: last statement still to pay (by prevDue). balanceSen: the statement to expect once that's paid.
  const owedSen = owedPrev(prevSen, inCycle), balanceSen = expectedBalance(prevSen, inCycle);
  const prevDue = cycleOf(account, prevStatement(account, cycle.statement)).due;
  const program = programs.find((p) => p.id === account.program) ?? programFor(programs, account.id, cycle.statement);
  const rebate = program ? computeRebate(program, { txns: inCycle, balanceSen }) : null;
  return {
    cycle, prevSen, owedSen, prevDue, balanceSen, txns: inCycle, program, rebate,
    daysLeft: daysBetween(day, cycle.statement), next: program ? toNextTier(program, balanceSen) : null,
    safeSen: program ? owedSen + safeToPay(program, balanceSen) : null,
    risky: inCycle.filter((t) => nearCutoff(account, t)),
  };
}

// A hand-logged transaction, ready to save. f: { account, spentBy, date, amount (RM text), type, raw, cat, merchant?, notes? }
export function manualTxn(account, f, at) {
  const amountSen = signed(f.type, toSen(f.amount));
  const t = { account: account.id, spentBy: f.spentBy, date: f.date, posted: f.date, postedGuess: true, merchant: f.merchant || null,
    cat: f.type === "payment" ? "payment" : f.cat || "other", raw: norm(f.raw), amountSen, type: f.type, source: "manual", reconciled: false, at };
  if (f.notes) t.notes = String(f.notes).trim();
  t.cycle = cycleForTxn(account, t).id;
  return t;
}

// ---------- spending (person card, trends) ----------

// Spending in [from, to] (inclusive), optionally one person's, per category, biggest first.
export function spendByCat(txns, { from, to, person } = {}) {
  const out = {};
  for (const t of txns) {
    if (!isSpend(t) || (from && t.date < from) || (to && t.date > to) || (person && t.spentBy !== person)) continue;
    out[t.cat] = (out[t.cat] ?? 0) + t.amountSen;
  }
  return Object.entries(out).map(([cat, sen]) => ({ cat, sen })).filter((x) => x.sen > 0).sort((a, b) => b.sen - a.sen);
}
export const spendTotal = (rows) => rows.reduce((s, r) => s + r.sen, 0);

// ---------- rebate programs ----------

// CIMB PETRONAS Visa Platinum-i: tier by statement balance; 8% / 4% PETRONAS (RM50 cap) and
// 2% / 1% on groceries, dining and cashless parking sharing one RM50 cap. Rebate floored to whole RM per group,
// credited on the next statement, only if the minimum payment was made on time.
export const CIMB_PETRONAS = {
  name: "CIMB PETRONAS Visa Platinum-i",
  qualifier: "statement_balance", rounding: "floor_rm", credited: "next_statement", needsMinPay: true,
  from: "2020-01-01", to: null,
  tiers: [
    { minSen: 0, maxSen: 49999, rates: [] },
    { minSen: 50000, maxSen: 199999, rates: [
      { cat: "fuel-petronas", bps: 400, capSen: 5000, capGroup: "petronas" },
      { cat: "groceries", bps: 100, capSen: 5000, capGroup: "lifestyle" },
      { cat: "dining", bps: 100, capSen: 5000, capGroup: "lifestyle" },
      { cat: "parking", bps: 100, capSen: 5000, capGroup: "lifestyle" },
    ] },
    { minSen: 200000, maxSen: null, rates: [
      { cat: "fuel-petronas", bps: 800, capSen: 5000, capGroup: "petronas" },
      { cat: "groceries", bps: 200, capSen: 5000, capGroup: "lifestyle" },
      { cat: "dining", bps: 200, capSen: 5000, capGroup: "lifestyle" },
      { cat: "parking", bps: 200, capSen: 5000, capGroup: "lifestyle" },
    ] },
  ],
  // Not eligible even if a rate's category would match. Non-PETRONAS fuel, BNPL, tax etc. simply have no rate.
  exclusions: [
    { pattern: "DUITNOW", match: "contains" },
    { pattern: "JOMPAY", match: "contains" },
    { pattern: "FPX", match: "contains" },
    { pattern: "INSTALMENT", match: "contains" },
    { pattern: "EZYPAY", match: "contains" },
    { pattern: "^(TNG|TOUCH N GO|BOOST|GRABPAY|SHOPEEPAY).*(TOP.?UP|RELOAD)", match: "regex" },
    { cat: "gov-tax" },
  ],
};

export const PRESETS = { "cimb-petronas": CIMB_PETRONAS };

// The program in force for an account on a date.
export const programFor = (programs, accountId, date) =>
  programs.find((p) => p.account === accountId && p.from <= date && (!p.to || date <= p.to)) ?? null;

export function tierIndex(program, qualifierSen) {
  let hit = 0;
  program.tiers.forEach((t, i) => { if (qualifierSen >= t.minSen && (t.maxSen == null || qualifierSen <= t.maxSen)) hit = i; });
  return hit;
}
// "8% / 2%", or "0%" for a tier with no rates.
export function tierLabel(tier) {
  const pcts = [...new Set(tier.rates.map((r) => r.bps))].sort((a, b) => b - a).map((b) => `${b / 100}%`);
  return pcts.length ? pcts.join(" / ") : "0%";
}
export const nextTier = (program, i) => program.tiers[i + 1] ?? null;

const excluded = (program, t) => (program.exclusions ?? []).some((x) => (x.cat ? x.cat === t.cat : ruleMatches(x, t.raw)));

// Spend that counts toward the rebate, per category: purchases less refunds, minus exclusions.
export function eligibleByCat(program, txns) {
  const out = {};
  for (const t of txns) {
    if (t.type !== "purchase" && t.type !== "refund") continue;
    if (excluded(program, t)) continue;
    out[t.cat] = (out[t.cat] ?? 0) + t.amountSen;
  }
  return out;
}

// What the qualifier is for a cycle: statement balance, or this cycle's retail spend.
export function qualifierOf(program, { balanceSen, txns }) {
  if (program.qualifier === "statement_balance") return balanceSen;
  if (program.qualifier === "cycle_retail_spend") return txns.filter((t) => t.type === "purchase" || t.type === "refund").reduce((s, t) => s + t.amountSen, 0);
  return Infinity; // "none": always the top tier
}

// The rebate for one cycle. txns = the cycle's transactions; balanceSen = (projected or real) statement balance.
// Each cap group's rebate is capped, then floored to whole ringgit (CIMB floors per group).
// Maths is done in 1/10000 sen so nothing rounds up across a ringgit by accident.
export function computeRebate(program, { txns, balanceSen }) {
  const qualifierSen = qualifierOf(program, { balanceSen, txns });
  const tier = tierIndex(program, qualifierSen), rates = program.tiers[tier].rates;
  const elig = eligibleByCat(program, txns);
  const cats = [], groups = new Map();
  for (const r of rates) {
    const eligibleSen = Math.max(0, elig[r.cat] ?? 0), exact = eligibleSen * r.bps; // sen × bps
    cats.push({ cat: r.cat, eligibleSen, bps: r.bps, rawSen: Math.round(exact / 1e4), group: r.capGroup ?? r.cat });
    const key = r.capGroup ?? r.cat, g = groups.get(key) ?? { id: key, cats: [], exact: 0, capSen: null };
    g.cats.push(r.cat); g.exact += exact;
    if (r.capSen != null) g.capSen = g.capSen == null ? r.capSen : Math.min(g.capSen, r.capSen);
    groups.set(key, g);
  }
  const out = [...groups.values()].map((g) => {
    const capped = g.capSen == null ? g.exact : Math.min(g.exact, g.capSen * 1e4);
    const finalSen = program.rounding === "floor_rm" ? Math.floor(capped / 1e6) * 100 : Math.floor(capped / 1e4);
    return { id: g.id, cats: g.cats, rawSen: Math.round(g.exact / 1e4), capSen: g.capSen, cappedSen: Math.round(capped / 1e4), finalSen, capUse: g.capSen ? Math.min(1, g.exact / (g.capSen * 1e4)) : null };
  });
  return { tier, tierLabel: tierLabel(program.tiers[tier]), qualifierSen, cats, groups: out, totalSen: out.reduce((s, g) => s + g.finalSen, 0) };
}

// How far the qualifier is from the next tier (null at the top).
export function toNextTier(program, qualifierSen) {
  const i = tierIndex(program, qualifierSen), n = nextTier(program, i);
  return n ? { tier: i + 1, label: tierLabel(n), needSen: n.minSen - qualifierSen } : null;
}

// How much can be paid before the statement date without dropping a tier.
export function safeToPay(program, balanceSen) {
  if (program.qualifier !== "statement_balance") return Infinity;
  const t = program.tiers[tierIndex(program, balanceSen)];
  return t.minSen === 0 ? balanceSen : Math.max(0, balanceSen - t.minSen);
}

// What's still unpaid from the last statement. It falls due inside this cycle (CIMB: due 10th, statement 20th),
// so paying it is never "early": the projection assumes it's paid in full by its due date.
export const owedPrev = (prevSen, txns) => Math.max(0, prevSen + txns.filter((t) => t.type === "payment").reduce((s, t) => s + t.amountSen, 0));

// The statement balance to expect: what's posted so far, with the last statement paid off on time.
export const expectedBalance = (prevSen, txns) => projectedBalance(prevSen, txns) - owedPrev(prevSen, txns);

// "Don't pay yet": checks a payment before it's saved. Returns null when it's fine (after the statement date,
// a balance-free program, only paying off the last statement, or no tier drop).
// txns = the cycle's transactions logged so far (not the new payment).
export function payWarning({ program, cycle, prevSen, txns, payment }) {
  if (!program || program.qualifier !== "statement_balance") return null;
  if ((payment.posted || payment.date) > cycle.statement) return null;
  const paySen = Math.abs(payment.amountSen), owedSen = owedPrev(prevSen, txns), early = paySen - owedSen;
  if (early <= 0) return null;
  const beforeSen = expectedBalance(prevSen, txns), afterSen = beforeSen - early;
  const before = computeRebate(program, { txns, balanceSen: beforeSen });
  const after = computeRebate(program, { txns, balanceSen: afterSen });
  if (after.tier >= before.tier) return null;
  return {
    paySen, owedSen, beforeSen, afterSen,
    tierBefore: before.tierLabel, tierAfter: after.tierLabel,
    lossSen: before.totalSen - after.totalSen,
    safeSen: owedSen + safeToPay(program, beforeSen),
    payAfter: cycle.statement, payBy: cycle.due,
  };
}

// The warning in words (rounded down to whole ringgit, as people say it).
export function warningText(w) {
  const owed = w.owedSen > 0 ? ` (${rm(w.owedSen)} of it pays your last statement — that part is fine now.)` : "";
  const loss = w.lossSen > 0 ? ` You'd lose about ${rm(w.lossSen, { whole: true })} rebate.` : "";
  const safe = w.safeSen > 0 ? ` Safe to pay now: ${rm(w.safeSen)}.` : "";
  return `Paying ${rm(w.paySen)} now drops your statement balance to ${rm(w.afterSen, { whole: true })} (${w.tierAfter} tier).${owed}${loss} Pay ${w.owedSen > 0 ? "the rest " : ""}after ${shortDate(w.payAfter)}, before ${shortDate(w.payBy)} — no profit charge if paid in full.${safe}`;
}

// The snapshot saved to ledgerRebates/{cycle} when a cycle is closed with its real balance.
export function rebateSnapshot(cycle, program, result, { projection = false, at = 0 } = {}) {
  return {
    cycle: cycle.id, account: cycle.account, program: program.id ?? null, tier: result.tier, tierLabel: result.tierLabel,
    qualifierSen: result.qualifierSen, totalSen: result.totalSen, projection, at,
    groups: result.groups.map(({ id, cats, rawSen, capSen, cappedSen, finalSen }) => ({ id, cats, rawSen, capSen, cappedSen, finalSen })),
    cats: result.cats.map(({ cat, eligibleSen, bps, rawSen, group }) => ({ cat, eligibleSen, bps, rawSen, group })),
  };
}

// ---------- trends ----------

// Does a transaction pass the trend filters? person / account: id, or null for everyone / every account.
export const passes = (t, { person = null, account = null } = {}) => isSpend(t) && (!person || t.spentBy === person) && (!account || t.account === account);

// The last n months up to the one `day` is in, oldest first: ["2026-06", …, "2026-11"].
export function monthsBack(day, n) {
  let [y, m] = split(day);
  const out = [];
  for (let i = 0; i < n; i++) { out.unshift(`${y}-${pad(m)}`); [y, m] = prevMonth(y, m); }
  return out;
}

// Spending per month and category: [{ ym, totalSen, cats: { cat: sen } }], refunds netted, payments left out.
export function monthlyByCat(txns, months, filter = {}) {
  const rows = months.map((ym) => ({ ym, totalSen: 0, cats: {} })), at = Object.fromEntries(months.map((m, i) => [m, i]));
  for (const t of txns) {
    const i = at[t.date.slice(0, 7)];
    if (i == null || !passes(t, filter)) continue;
    rows[i].cats[t.cat] = (rows[i].cats[t.cat] ?? 0) + t.amountSen;
    rows[i].totalSen += t.amountSen;
  }
  return rows;
}

// Where the money went in [from, to]: [{ name, sen, n }], biggest first. Shops are grouped by their display name.
export function topMerchants(txns, { from, to, limit = 8, ...filter } = {}) {
  const by = new Map();
  for (const t of txns) {
    if (!passes(t, filter) || (from && t.date < from) || (to && t.date > to)) continue;
    const name = String(t.merchant || t.raw || "").trim() || "Unknown", key = norm(name);
    const m = by.get(key) ?? { name, sen: 0, n: 0 };
    m.sen += t.amountSen; if (t.amountSen > 0) m.n++;
    by.set(key, m);
  }
  return [...by.values()].filter((m) => m.sen > 0).sort((a, b) => b.sen - a.sen).slice(0, limit);
}

// The two stretches to compare: this cycle so far vs the same number of days into the last one (a card),
// or this month so far vs the same days of last month (everything together).
export function comparePeriods(day, account = null) {
  if (account) {
    const now = cycleOf(account, day), prev = cycleOf(account, addDays(now.start, -1));
    const into = daysBetween(now.start, day);
    return { kind: "cycle", now: [now.start, day], before: [prev.start, minDate(addDays(prev.start, into), prev.statement)], full: [prev.start, prev.statement] };
  }
  const [y, m, d] = split(day), [py, pm] = prevMonth(y, m);
  return { kind: "month", now: [`${y}-${pad(m)}-01`, day], before: [`${py}-${pad(pm)}-01`, ymd(py, pm, Math.min(d, daysIn(py, pm)))], full: [`${py}-${pad(pm)}-01`, ymd(py, pm, daysIn(py, pm))] };
}
const minDate = (a, b) => (a < b ? a : b);

// Category by category, now vs before: { rows: [{ cat, nowSen, beforeSen }], nowSen, beforeSen }.
export function compareSpend(txns, periods, filter = {}) {
  const sum = ([from, to]) => {
    const o = {};
    for (const t of txns) if (passes(t, filter) && t.date >= from && t.date <= to) o[t.cat] = (o[t.cat] ?? 0) + t.amountSen;
    return o;
  };
  const a = sum(periods.now), b = sum(periods.before);
  const rows = [...new Set([...Object.keys(a), ...Object.keys(b)])].map((cat) => ({ cat, nowSen: a[cat] ?? 0, beforeSen: b[cat] ?? 0 }))
    .filter((r) => r.nowSen > 0 || r.beforeSen > 0).sort((x, y) => y.nowSen - x.nowSen || y.beforeSen - x.beforeSen);
  return { rows, nowSen: rows.reduce((s, r) => s + r.nowSen, 0), beforeSen: rows.reduce((s, r) => s + r.beforeSen, 0) };
}

// ---------- rule editor ----------

// Checks a program typed in the rule editor and tidies it: tiers sorted, each tier ending where the next starts,
// rates in basis points, a cap group's rates all sharing the smallest cap typed for it.
// Returns { errors: [text], program }. Nothing is saved while there are errors.
export function checkProgram(p) {
  const errors = [], known = new Set(SYSTEM_CATEGORIES.map((c) => c.id));
  const out = { ...p, name: String(p.name ?? "").trim() };
  if (!out.name) errors.push("Give the rules a name.");
  if (!["statement_balance", "cycle_retail_spend", "none"].includes(out.qualifier)) errors.push("Pick what the tiers depend on.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(out.from ?? "")) errors.push("Pick the date the rules start.");
  if (out.to && out.to < out.from) errors.push("The end date is before the start date.");
  const tiers = [...(p.tiers ?? [])].map((t) => ({ ...t, rates: (t.rates ?? []).map((r) => ({ ...r })) })).sort((a, b) => a.minSen - b.minSen);
  if (!tiers.length) errors.push("Add at least one tier.");
  else if (tiers[0].minSen !== 0) errors.push("The first tier has to start at RM0.");
  tiers.forEach((t, i) => {
    if (!Number.isInteger(t.minSen) || t.minSen < 0) errors.push(`Tier ${i + 1}: the starting amount isn't a number.`);
    if (i && t.minSen === tiers[i - 1].minSen) errors.push(`Two tiers start at ${rm(t.minSen, { whole: true })}.`);
    t.maxSen = tiers[i + 1] ? tiers[i + 1].minSen - 1 : null;
    const seen = new Set(), caps = {};
    t.rates.forEach((r) => {
      if (!known.has(r.cat)) errors.push(`Tier ${i + 1}: pick a category for every rate.`);
      else if (seen.has(r.cat)) errors.push(`Tier ${i + 1}: ${catName(r.cat)} has two rates.`);
      seen.add(r.cat);
      if (!Number.isInteger(r.bps) || r.bps < 0 || r.bps > 10000) errors.push(`Tier ${i + 1}: rates are 0 to 100%.`);
      if (r.capSen != null && (!Number.isInteger(r.capSen) || r.capSen < 0)) errors.push(`Tier ${i + 1}: a cap isn't a number.`);
      if (r.capGroup) { r.capGroup = String(r.capGroup).trim().toLowerCase(); if (r.capSen != null) caps[r.capGroup] = Math.min(caps[r.capGroup] ?? Infinity, r.capSen); }
      if (!r.capGroup) delete r.capGroup;
    });
    t.rates = t.rates.map((r) => (r.capGroup && caps[r.capGroup] != null ? { ...r, capSen: caps[r.capGroup] } : r));
  });
  out.tiers = tiers;
  out.exclusions = (p.exclusions ?? []).filter((x) => (x.cat ? known.has(x.cat) : String(x.pattern ?? "").trim()))
    .map((x) => (x.cat ? { cat: x.cat } : { pattern: x.match === "regex" ? x.pattern : norm(x.pattern), match: x.match || "contains" }));
  return { errors: [...new Set(errors)], program: out };
}
