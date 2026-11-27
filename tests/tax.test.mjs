import test from "node:test";
import assert from "node:assert/strict";
import { taxOverview, payslipPayroll, scannedPayroll, taxCsv } from "../public/logic/tax.js";
import { docPlan } from "../public/logic/docs.js";
import { monthIncome } from "../public/logic/income.js";

test("payroll suggestions keep employee figures only, retain zero, and omit conflicts", () => {
  const result = payslipPayroll(["Gross pay RM 1500.00", "EE EPF (KWSP) 165.00", "Employer EPF 180.00",
    "EE SOCSO (PERKESO) 7.50", "EE EIS 0.00", "Tax PCB 19.50", "PCB 20.00"]);
  assert.deepEqual(result, { gross: "1500.00", epf: "165.00", socso: "7.50", eis: "0.00", pcb: "", other: "" });
  assert.equal(scannedPayroll({ pcb_sen: 0 }).pcb, "0.00");
  assert.equal(scannedPayroll({ epf_sen: -25 }).epf, "");
});

test("annual overview scopes by person and date, and flags only comparable differences", () => {
  const base = { person: "p1", date: "2026-02-25", kind: "salary", from: "Example, Sdn. Bhd.", amountSen: 850 };
  const rows = [
    { ...base, payroll: { gross: 1000, epf: 0, pcb: 50, socso: 0, eis: 25 } },
    { ...base, payroll: { gross: 1000, pcb: 50, socso: 0 } },
    { ...base, person: "p2", payroll: { gross: 1000 } },
    { ...base, date: "2025-12-28", payroll: { gross: 1000 } },
    { ...base, kind: "side" },
  ];
  const ea = { person: "p1", year: "2026", taxType: "ea", name: "Example SDN BHD", amounts: { gross: 2100, epf: 0, pcb: 100, social: 25 } };
  const data = taxOverview(rows, [ea], "p1", "2026");
  assert.equal(data.employers.length, 1);
  assert.deepEqual(data.employers[0].comparison.map(({ difference }) => difference), [100, null, null, 0]);
  assert.deepEqual(data.totals.epf, { amount: 0, count: 1 });
  assert.equal(data.otherIncome.length, 1);
  assert.equal(monthIncome(rows.filter((r) => r.person === "p1" && r.kind === "salary"), 0, "2026-02").totalSen, 1700);
  assert.match(taxCsv(data, "2026", "@formula"), /"'@formula"/);
});

test("tax documents are stored separately from ordinary income proofs", () => {
  const plan = docPlan({ income: true, kind: "ea", date: "2026-01-01", what: "Example Co", person: "Faiz", file: { name: "ea.pdf" } });
  assert.equal(plan.path, "Ledger/Income Tax/Faiz/2026/EA forms/2026 - Example Co - EA form.pdf");
});
