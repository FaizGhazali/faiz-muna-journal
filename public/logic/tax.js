import { toSen } from "./ledger.js";

export const PAYROLL = [
  ["gross", "Gross pay"], ["epf", "Employee EPF"], ["socso", "Employee SOCSO"],
  ["eis", "Employee EIS"], ["pcb", "PCB withheld"], ["other", "Other deductions"],
];
export const EA_FIELDS = [PAYROLL[0], PAYROLL[1], ["social", "Employee SOCSO + EIS"], PAYROLL[4]];
export const RELIEFS = ["Life insurance / takaful", "Medical and education insurance", "Medical expenses", "Lifestyle", "Education", "Other"];

const positive = (value) => Number.isSafeInteger(value) && value >= 0;
export const periodValid = (s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s || "");
export const inputAmount = (value) => positive(value) ? (value / 100).toFixed(2) : "";

export function readAmounts(fields, values) {
  const amounts = {};
  for (const [key, label] of fields) {
    if (!String(values[key] ?? "").trim()) continue;
    const sen = toSen(values[key]);
    if (!positive(sen)) return { error: `Enter a valid amount for ${label}.` };
    amounts[key] = sen;
  }
  return { amounts };
}

const PAY_LABELS = {
  gross: "gross (?:pay|salary|earnings)|gaji kasar",
  epf: "(?:ee|employee) (?:epf|kwsp)|(?:epf|kwsp) pekerja",
  socso: "(?:ee|employee) (?:socso|perkeso)|(?:socso|perkeso) pekerja",
  eis: "(?:ee|employee) (?:eis|sip)|(?:eis|sip) pekerja",
  pcb: "(?:tax )?pcb|mtd|potongan cukai berjadual",
  other: "other deductions|potongan lain",
};

export function payslipPayroll(lines) {
  return Object.fromEntries(PAYROLL.map(([key]) => {
    const pattern = new RegExp(`^\\s*(?:${PAY_LABELS[key]})(?:\\s*\\([^)]*\\))?\\s*[:=]?\\s*(?:RM|MYR)?\\s*([\\d,]+(?:\\.\\d{2})?)\\s*$`, "i");
    const values = new Set(lines.map((line) => toSen(line.match(pattern)?.[1])).filter(positive));
    return [key, values.size === 1 ? inputAmount([...values][0]) : ""];
  }));
}

export function scannedPayroll(result) {
  return Object.fromEntries(PAYROLL.map(([key]) => [key, inputAmount(result?.[`${key}_sen`])]));
}

export const employerKey = (name) => String(name ?? "").trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ");

export function taxOverview(income, records, person, year) {
  const included = income.filter((entry) => entry.person === person && entry.date.slice(0, 4) === year);
  const payroll = included.filter((entry) => ["salary", "parttime", "bonus"].includes(entry.kind) || entry.payroll);
  const recordsForYear = records.filter((entry) => entry.person === person && entry.year === year);
  const groups = new Map();
  const group = (name) => {
    const key = employerKey(name);
    if (!groups.has(key)) groups.set(key, { name: name || "Employer not entered", payslips: [], ea: null });
    return groups.get(key);
  };
  for (const entry of payroll) group(entry.from).payslips.push(entry);
  for (const ea of recordsForYear.filter((entry) => entry.taxType === "ea")) group(ea.name).ea = ea;
  const totals = sumPayroll(payroll);
  const employers = [...groups.values()].map((item) => {
    const sums = sumPayroll(item.payslips);
    const comparison = EA_FIELDS.map(([key, label]) => {
      const logged = sums[key];
      const declared = item.ea?.amounts?.[key];
      return { key, label, logged, declared,
        difference: logged?.count === item.payslips.length && logged.count && positive(declared) ? declared - logged.amount : null };
    });
    return { ...item, comparison };
  }).sort((a, b) => a.name.localeCompare(b.name));
  return { payroll, totals, employers, reliefs: recordsForYear.filter((entry) => entry.taxType === "relief"),
    otherIncome: included.filter((entry) => !payroll.includes(entry)) };
}

function sumPayroll(entries) {
  const keys = [...PAYROLL.map(([key]) => key), "social"];
  return Object.fromEntries(keys.map((key) => {
    const recorded = entries.map(({ payroll: p }) =>
      key === "social" ? (positive(p?.socso) && positive(p?.eis) ? p.socso + p.eis : null) : p?.[key]).filter(positive);
    return [key, { amount: recorded.reduce((a, b) => a + b, 0), count: recorded.length }];
  }));
}

export function taxCsv(report, year, name) {
  const rows = [["Year of assessment", year], ["Person", name],
    ["Employer", "Item", "Payslips RM", "EA RM", "EA minus payslips RM", "Values entered", "Payroll entries"]];
  for (const group of report.employers) {
    for (const row of group.comparison) rows.push([group.name, row.label, row.logged?.count ? inputAmount(row.logged.amount) : "",
      inputAmount(row.declared), row.difference == null ? "" : (row.difference / 100).toFixed(2),
      row.logged?.count ?? 0, group.payslips.length]);
  }
  rows.push([], ["Date received", "Pay period", "Employer", "Net received RM", ...PAYROLL.map(([, label]) => `${label} RM`)]);
  for (const item of [...report.payroll].sort((a,b) => a.date.localeCompare(b.date))) {
    rows.push([item.date, item.payroll?.period, item.from, inputAmount(item.amountSen),
      ...PAYROLL.map(([key]) => inputAmount(item.payroll?.[key]))]);
  }
  rows.push([], ["Relief evidence", "Category", "Recorded RM", "Reviewed", "Attachments"]);
  for (const item of report.reliefs) rows.push([item.name, item.category, inputAmount(item.amounts?.amount), item.checked ? "Yes" : "No", item.docs?.length ?? 0]);
  rows.push([], ["Other income source", "Date received", "Amount received RM"]);
  for (const item of report.otherIncome) rows.push([item.from || item.kind, item.date, inputAmount(item.amountSen)]);
  return rows.map((row) => row.map((cell) => {
    const value = String(cell ?? "");
    const safe = /^[\s]*[=+@-]/.test(value) && !/^-\d+\.\d+$/.test(value) ? "'" + value : value;
    return '"' + safe.replace(/"/g, '""') + '"';
  }).join(",")).join("\r\n");
}
