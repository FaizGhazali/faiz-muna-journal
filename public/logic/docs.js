// Documents (receipts, bills, payslips) kept in the family's OneDrive: where each file goes and what it's called,
// so nobody ever types a file name. Pure: no DOM, no network. Tests: tests/docs.test.mjs.
//
// A file lands in the app's own OneDrive folder (Apps/Our Journal, shell/onedrive.js) at
//   Ledger/<year>/<YYYY-MM>/<folder>/<YYYY-MM-DD> <what> RM<amount> <person>.<ext>
// e.g. Ledger/2026/2026-11/Receipts/2026-11-24 Kedai Runcit Maju RM18.43 Faiz.jpg
// The folder comes from what the entry is (FOLDERS), the extension from the file. Year and month are the
// calendar month of the entry's date (what the paper says), not the pay month. OneDrive renames on a clash.
//
// Firestore keeps only a link on the entry (ledgerTxns / ledgerPaid): docs: [{ id (drive item id), name, path,
// folder, type: image|pdf|file, size, url (OneDrive web link), at, by }]. The file itself never touches Firestore.

export const FOLDERS = {
  purchase: "Receipts", refund: "Receipts", payment: "Card payments",
  bill: "Bills", salary: "Payslips", income: "Income", statement: "Statements",
};
export const ROOT = "Ledger";
export const NAME_MAX = 60; // characters of the "what" part
export const DOCS_MAX = 10; // files on one entry
export const SHRINK_PX = 2000; // a phone photo's longest side after shrinking
export const SIMPLE_MAX = 4 * 1024 * 1024; // bigger files go up in pieces (OneDrive's limit for one request)

const IMAGE = ["jpg", "jpeg", "png", "heic", "heif", "webp", "gif"];
const pad = (n) => String(n).padStart(2, "0");

// The file's extension, lower case ("" if none): from its name, else its type.
export function extOf(name = "", mime = "") {
  const m = String(name).match(/\.([a-z0-9]{1,8})$/i);
  if (m) return m[1].toLowerCase();
  const sub = String(mime).split("/")[1] ?? "";
  return { jpeg: "jpg", "svg+xml": "svg", plain: "txt" }[sub] ?? (/^[a-z0-9]{1,8}$/.test(sub) ? sub : "");
}

// image | pdf | file
export function fileType(name = "", mime = "") {
  const ext = extOf(name, mime);
  if (String(mime).startsWith("image/") || IMAGE.includes(ext)) return "image";
  if (mime === "application/pdf" || ext === "pdf") return "pdf";
  return "file";
}

// Photos a browser can redraw smaller (not HEIC, which most browsers can't open; not GIF, which may move).
export const shrinkable = (name = "", mime = "") => ["jpg", "jpeg", "png", "webp"].includes(extOf(name, mime));

// Safe for a OneDrive file name: no \ / : * ? " < > | # %, no control characters, single spaces, no dot or
// space at the end, at most `max` characters.
export function cleanName(s, max = NAME_MAX) {
  return String(s ?? "").replace(/[\\/:*?"<>|#%\u0000-\u001f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max).replace(/[. ]+$/, "");
}

const money = (sen) => `RM${(Math.abs(sen) / 100).toFixed(2).replace(/\.00$/, "")}`;

// "2026-11-24 Kedai Runcit Maju RM18.43 Faiz.jpg"
export function docName({ date, what, amountSen = null, person = "", ext = "" }) {
  const parts = [date, cleanName(what) || "Document", Number.isInteger(amountSen) && amountSen !== 0 ? money(amountSen) : "", cleanName(person, 30)];
  const base = parts.filter(Boolean).join(" ");
  return ext ? `${base}.${ext}` : base;
}

// "Ledger/2026/2026-11/Receipts"
export function docFolder({ date, kind }) {
  const [y, m] = String(date).split("-");
  return [ROOT, y, `${y}-${pad(Number(m))}`, FOLDERS[kind] ?? "Other"].join("/");
}

// Everything needed to upload one file for an entry: { folder, name, path, type, ext, shrink }.
// A photo that will be shrunk is saved as .jpg; asIs (shrinking didn't help) keeps the file's own type.
export function docPlan({ file: { name = "", type: mime = "" } = {}, date, kind, what, amountSen = null, person = "", asIs = false }) {
  const shrink = !asIs && shrinkable(name, mime), ext = shrink ? "jpg" : extOf(name, mime);
  const folder = docFolder({ date, kind }), file = docName({ date, what, amountSen, person, ext });
  return { folder, name: file, path: `${folder}/${file}`, type: fileType(name, mime), ext, shrink };
}

// Icon name (core/icons.js) for a link on an entry.
export const docIcon = (type) => ({ image: "image", pdf: "file" }[type] ?? "clip");

// The size to redraw a photo at, keeping its shape: { w, h } (unchanged when already small enough).
export function fitSize(w, h, max = SHRINK_PX) {
  const k = Math.min(1, max / Math.max(w, h, 1));
  return { w: Math.round(w * k), h: Math.round(h * k) };
}
