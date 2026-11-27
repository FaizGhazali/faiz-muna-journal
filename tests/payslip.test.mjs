import { test } from "node:test";
import assert from "node:assert/strict";
import { payslipFields, scannedPayslipFields } from "../public/logic/payslip.js";
import { docPlan } from "../public/logic/docs.js";

test("payslip autofill extracts labeled net pay, payer and payment date", () => {
  assert.deepEqual(payslipFields([
    "Example Sdn. Bhd.", "Gross pay: RM 4,890.34",
    "Gaji Bersih RM 4,200.00", "Tarikh Bayaran 27/11/2026",
  ]), { amount: "4200.00", date: "2026-11-27", from: "Example Sdn. Bhd.", periodEnd: "" });
});

test("payslip autofill omits conflicting amounts, invalid dates and payroll periods", () => {
  assert.deepEqual(payslipFields([
    "Net pay: 1000.00", "Net pay: 2000.00", "Pay period 01/11/2026 - 30/11/2026",
    "Pay date: 31/11/2026", "Payment date: 01/11/2026 - 30/11/2026",
  ]), { amount: "", date: "", from: "", periodEnd: "" });
});

test("income proof files are grouped by person and year without amounts in the name", () => {
  const spec = { income: true, file: { name: "pay.pdf" }, date: "2026-11-27", what: "ACME / Group", person: "Faiz", amountSen: 420000 };
  assert.equal(docPlan({ ...spec, kind: "salary" }).path,
    "Ledger/Income/Faiz/2026/Payslips/2026-11-27 - ACME Group - Payslip.pdf");
  assert.equal(docPlan({ ...spec, kind: "income", what: "" }).path,
    "Ledger/Income/Faiz/2026/Other proof/2026-11-27 - Income proof.pdf");
});

test("Gemini payslip results accept whole sen and a valid ISO date", () => {
  assert.deepEqual(scannedPayslipFields({ net_pay_sen: 412305, payment_date: "2026-11-27", employer: " Example   Company " }),
    { amount: "4123.05", date: "2026-11-27", from: "Example Company", periodEnd: "" });
  assert.deepEqual(scannedPayslipFields({ net_pay_sen: 4123.05, payment_date: "2026-11-31", employer: null }),
    { amount: "", date: "", from: "", periodEnd: "" });
});

test("a pay period supplies a month end separately from an explicit payment date", () => {
  assert.deepEqual(payslipFields(["PAY PERIOD : ADD-OCTOBER-2026", "NETT PAY RM 123.45", "Paid on: 02/11/2026"]),
    { amount: "123.45", date: "2026-11-02", from: "", periodEnd: "2026-10-31" });
  assert.equal(scannedPayslipFields({ pay_period: "2028-02" }).periodEnd, "2028-02-29");
  assert.equal(scannedPayslipFields({ pay_period: "2028-13" }).periodEnd, "");
});
