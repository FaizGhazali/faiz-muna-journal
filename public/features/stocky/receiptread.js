// Stocky receipt scanning, the device part: get a picture, shrink it, and have the family's Modal server
// (modal/receipt_reader.py) read it with Gemini. The picture is never stored, only sent there and dropped.
// Android phones with the widget app scan in it (ML Kit document scanner: crop, deskew, clean up) and share the
// picture back to the installed journal, which the service worker hands to #stocky/scan. Everyone else picks or
// takes a photo with a file input. Plan: docs/receipt-scan-plan.md.

// The address `modal deploy modal/receipt_reader.py` prints. Empty = scanning is hidden (the demo still has it).
export const READER_URL = "";
export const readerReady = () => /^(https:\/\/[a-z0-9-]+\.modal\.run|http:\/\/localhost:\d+)\/?$/.test(READER_URL);

export const LONG_EDGE = 1600; // px; plenty for receipt text, a few hundred KB as JPEG
export const QUALITY = 0.85;
export const INBOX = "receipt-inbox"; // the cache sw.js keeps a shared picture in (not "journal-*", which updates clear)
export const INBOX_KEY = "/receipt-inbox/latest";
const WIDGET_PKG = "com.faizmuna.journal.widget";

// A picture (File / Blob) → a JPEG no longer than LONG_EDGE on its long side, as base64 (no data: prefix).
export async function shrink(file) {
  const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
  const k = Math.min(1, LONG_EDGE / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  const g = c.getContext("2d");
  g.fillStyle = "#fff"; g.fillRect(0, 0, c.width, c.height);
  g.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close?.();
  const url = c.toDataURL("image/jpeg", QUALITY);
  return url.slice(url.indexOf(",") + 1);
}

// Ask the reader. fallback = the stronger model, for a second try when the first answer doesn't add up.
export async function readPicture(b64, token, fallback = false) {
  const r = await fetch(READER_URL.replace(/\/$/, "") + "/read", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify({ image: b64, fallback }),
  });
  if (!r.ok) throw Object.assign(new Error(`reader-${r.status}`), { status: r.status });
  return r.json(); // { model, receipt }
}

export function readerErrorText(e) {
  const s = e?.status;
  if (s === 401 || s === 403) return "Scanning only works when you're signed in. Sign out and back in, then try again.";
  if (s === 429) return "The receipt reader is busy or has had enough for today. Try again later.";
  if (s === 413) return "That picture is too big. Try again with a closer photo of just the receipt.";
  if (s === 400) return "That picture couldn't be sent. Try another photo.";
  if (s >= 500) return "The receipt reader couldn't read it. Try a clearer, flatter photo, or try again later.";
  return navigator.onLine ? "Couldn't reach the receipt reader. Try again in a moment." : "Scanning needs the internet.";
}

// A picture the widget app shared to the journal (sw.js put it in the inbox), taken out so it's read once. null if none.
export async function takeShared() {
  try {
    const c = await caches.open(INBOX), hit = await c.match(INBOX_KEY);
    if (!hit) return null;
    const blob = await hit.blob();
    await c.delete(INBOX_KEY);
    return blob;
  } catch (_) { return null; }
}

// Is the widget app on this phone? (Chrome on Android, with related_applications in the manifest and the site
// in the app's asset statements.) false when the browser can't tell.
export async function hasScannerApp() {
  try {
    const apps = await navigator.getInstalledRelatedApps?.();
    return !!apps?.some((a) => a.id === WIDGET_PKG);
  } catch (_) { return false; }
}
// The link that opens the widget app's scanner; back to this page if it isn't there after all.
export const scannerLink = () => `intent://scan#Intent;scheme=journalscan;package=${WIDGET_PKG};S.browser_fallback_url=${encodeURIComponent(location.origin + "/#stocky/receipts")};end`;

// The demo never calls the reader: a made-up answer, as Gemini would give it, from the demo's own shops and items.
export const SAMPLE = {
  store_name: "PASAR RAYA SEGAR",
  store_branch: "Taman Contoh",
  date: "",
  currency: "MYR",
  items: [
    { raw_name: "BERAS PUTIH TEMPATAN 5KG", qty: 1, unit_price: 19.9, line_total: 19.9 },
    { raw_name: "TELUR AYAM GRED B 30S", qty: 1, unit_price: 12.6, line_total: 12.6 },
    { raw_name: "PROMO TELUR", qty: 1, line_total: -0.8 },
    { raw_name: "SUSU SEGAR PENUH 1L", qty: 2, unit_price: 6.9, line_total: 13.8 },
    { raw_name: "BAWANG MERAH 500G", qty: 1, unit_price: 3.5, line_total: 3.5 },
    { raw_name: "TISU KOTAK 5X200", qty: 1, unit_price: 9.9, line_total: 9.9 },
  ],
  subtotal: 58.9,
  discounts: 0,
  rounding: 0,
  total: 58.9,
};
