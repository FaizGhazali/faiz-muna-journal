// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { extOf, fileType, shrinkable, cleanName, docName, docFolder, docPlan, fitSize, NAME_MAX } from "../public/logic/docs.js";

test("file types: photos, PDFs and everything else, by name or by type", () => {
  assert.equal(fileType("IMG_2041.HEIC"), "image");
  assert.equal(fileType("scan", "image/png"), "image");
  assert.equal(fileType("Statement.PDF"), "pdf");
  assert.equal(fileType("blob", "application/pdf"), "pdf");
  assert.equal(fileType("payslip.docx"), "file");
  assert.equal(extOf("a.JPEG"), "jpeg");
  assert.equal(extOf("blob", "image/jpeg"), "jpg");
  assert.equal(extOf("noext"), "");
  assert.equal(shrinkable("IMG.jpg"), true);
  assert.equal(shrinkable("IMG.heic"), false);
  assert.equal(shrinkable("x.pdf"), false);
});

test("names are safe for OneDrive and never too long", () => {
  assert.equal(cleanName('AEON: "Big" / Mall*?  '), "AEON Big Mall");
  assert.equal(cleanName("Shop..."), "Shop");
  assert.equal(cleanName("x".repeat(100)).length, NAME_MAX);
});

test("a receipt's name: date, shop, amount, who", () => {
  assert.equal(docName({ date: "2026-11-24", what: "Kedai Runcit Maju", amountSen: 1843, person: "Faiz", ext: "jpg" }), "2026-11-24 Kedai Runcit Maju RM18.43 Faiz.jpg");
  assert.equal(docName({ date: "2026-11-25", what: "Salary", person: "Muna", ext: "pdf" }), "2026-11-25 Salary Muna.pdf");
  assert.equal(docName({ date: "2026-12-01", what: "Car", amountSen: 52000, ext: "pdf" }), "2026-12-01 Car RM520.pdf");
  assert.equal(docName({ date: "2026-12-01", what: "  ", ext: "pdf" }), "2026-12-01 Document.pdf");
  assert.equal(docName({ date: "2026-12-02", what: "Refund", amountSen: -2500 }), "2026-12-02 Refund RM25");
});

test("folders by year, month and what the entry is", () => {
  assert.equal(docFolder({ date: "2026-11-24", kind: "purchase" }), "Ledger/2026/2026-11/Receipts");
  assert.equal(docFolder({ date: "2027-01-03", kind: "bill" }), "Ledger/2027/2027-01/Bills");
  assert.equal(docFolder({ date: "2026-11-25", kind: "salary" }), "Ledger/2026/2026-11/Payslips");
  assert.equal(docFolder({ date: "2026-11-25", kind: "nope" }), "Ledger/2026/2026-11/Other");
});

test("docPlan: a phone photo is shrunk and saved as .jpg; a PDF and a HEIC keep their own", () => {
  const photo = docPlan({ file: { name: "IMG_1.PNG", type: "image/png" }, date: "2026-11-24", kind: "purchase", what: "Toll", amountSen: 504, person: "Faiz" });
  assert.deepEqual(photo, { folder: "Ledger/2026/2026-11/Receipts", name: "2026-11-24 Toll RM5.04 Faiz.jpg", path: "Ledger/2026/2026-11/Receipts/2026-11-24 Toll RM5.04 Faiz.jpg", type: "image", ext: "jpg", shrink: true });
  const pdf = docPlan({ file: { name: "bill.pdf", type: "application/pdf" }, date: "2026-12-01", kind: "bill", what: "Car", amountSen: 52000 });
  assert.equal(pdf.name, "2026-12-01 Car RM520.pdf");
  assert.equal(pdf.shrink, false);
  const heic = docPlan({ file: { name: "IMG.HEIC", type: "" }, date: "2026-12-01", kind: "purchase", what: "Kopi" });
  assert.equal(heic.name, "2026-12-01 Kopi.heic");
  assert.equal(heic.type, "image");
  const kept = docPlan({ file: { name: "IMG_1.PNG", type: "image/png" }, date: "2026-11-24", kind: "purchase", what: "Toll", asIs: true });
  assert.equal(kept.name, "2026-11-24 Toll.png");
  assert.equal(kept.shrink, false);
});

test("fitSize keeps the shape and never grows a small photo", () => {
  assert.deepEqual(fitSize(4000, 3000), { w: 2000, h: 1500 });
  assert.deepEqual(fitSize(1200, 1600), { w: 1200, h: 1600 });
});
