// Reads the numbers out of a COROS run picture (the long image the COROS app shares).
// The picture is read on this device and never uploaded or stored; only the numbers are kept.

// Text reader (Tesseract). Loaded only when a picture is added. The version is pinned so sw.js can keep it offline.
const READER = "https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.esm.min.js";

const Q = "['’‘′`´°]"; // what the minute mark in 9'29" may be read as
const PACE = new RegExp(`(\\d{1,2})\\s*${Q}\\s*(\\d{2})`);
const PACES = new RegExp(PACE.source, "g");
const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
const pad = (n) => String(n).padStart(2, "0");
const within = (n, lo, hi) => (Number.isFinite(n) && n >= lo && n <= hi ? n : undefined);
const clockSecs = (t) => t.split(":").map(Number).reduce((a, n) => a * 60 + n, 0);

// text: what the reader saw, one line per row of the picture. Returns only the numbers it is sure it found.
export function parseCoros(text) {
  const lines = text.split(/\r?\n/).map((l) => l.replace(/\s+/g, " ").trim()).filter(Boolean);
  const all = lines.join("\n");
  const first = (re) => { const m = all.match(re); return m ? m : null; };
  const above = (re) => { const i = lines.findIndex((l) => re.test(l)); return i > 0 ? lines[i - 1] : ""; }; // values sit above their labels
  const num = (m, lo, hi, i = 1) => (m ? within(Number(String(m[i]).replace(",", ".")), lo, hi) : undefined);
  const pace = (m, i = 1) => (m ? within(Number(m[i]) * 60 + Number(m[i + 1]), 150, 1500) : undefined);
  const out = {};

  const d = first(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.? (\d{1,2}),? (20\d{2})\b/i);
  if (d && Number(d[2]) >= 1 && Number(d[2]) <= 31) out.date = `${d[3]}-${pad(MONTHS.indexOf(d[1].toLowerCase()) + 1)}-${pad(Number(d[2]))}`;

  // The last row of the lap table has distance, time, pace and heart rate together.
  const total = first(new RegExp(`Total\\s+(\\d{1,3}[.,]\\d{1,2})\\s+(\\d{1,3}:\\d{2}(?::\\d{2})?)\\S*\\s+${PACE.source}\\S*\\s+(\\d{2,3})\\b`, "i"));
  if (total) {
    out.km = num(total, 0.1, 100);
    out.secs = within(clockSecs(total[2]), 60, 86400);
    out.pace = pace(total, 3);
    out.hr = num(total, 60, 220, 5);
  }
  out.km ??= num(first(/(\d{1,3}[.,]\d{2})\s*km\b/i), 0.1, 100);
  if (out.secs == null) { const t = above(/Activity Time/i).match(/(\d{1,3}:\d{2}(?::\d{2})?)/); if (t) out.secs = within(clockSecs(t[1]), 60, 86400); }
  out.pace ??= pace(first(new RegExp(`Average\\s+${PACE.source}`, "i"))) ?? pace(above(/Avg\.? ?Pace/i).match(PACE));
  const eff = [...above(/Effort/i).matchAll(PACES)].pop();
  out.effort = pace(eff);

  const hr = first(/Heart Rate\s*\(?bpm\)?\s+Max\s+(\d{2,3})\s+Average\s+(\d{2,3})/i);
  out.hrMax = num(hr, 100, 220);
  out.hr ??= num(hr, 60, 220, 2) ?? num(above(/Average Heart|Heart Rate$/i).match(/(\d{2,3})\s*bpm/i), 60, 220) ?? num(first(/(\d{2,3})\s*bpm\b/i), 60, 220);
  out.hrr = num(first(/\bHRR\s+(\d{1,3})\b/), 1, 120);

  out.cadence = num(first(/Cadence.*?Average\s+(\d{2,3})/i), 60, 260);
  out.stride = num(first(/Stride Length.*?Average\s+(\d{2,3})/i), 20, 250);
  out.power = num(first(/Running Power.*?Average\s+(\d{2,4})/i), 20, 1000);
  out.ground = num(first(/Ground Time.*?Average\s+(\d{2,3})/i), 100, 600);
  out.kcal = num(first(/(\d{2,4})\s*k?cal\b/i), 10, 9999);
  const load = above(/Training Load/i).replace(/\d+\s*%/g, "").match(/\d+/g);
  if (load) out.load = within(Number(load[load.length - 1]), 1, 2000);

  Object.keys(out).forEach((k) => out[k] === undefined && delete out[k]);
  return out;
}

async function decode(file) {
  if (window.createImageBitmap) { try { return await createImageBitmap(file); } catch (_) {} }
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally { URL.revokeObjectURL(url); }
}

// Turns the picture into text, a screenful at a time. onProgress gets 0..1.
export async function readCoros(file, onProgress = () => {}) {
  const img = await decode(file);
  const w = img.width, h = img.height;
  if (w < 400 || h < w) throw new Error("small");
  const lib = await import(READER), { createWorker } = lib.default || lib;
  const worker = await createWorker("eng");
  try {
    await worker.setParameters({ tessedit_pageseg_mode: "6", preserve_interword_spaces: "1" }); // read straight across each row
    const scale = w < 1000 ? 1200 / w : w > 1600 ? 1600 / w : 1;
    const STRIP = Math.round(1500 / scale), OVERLAP = Math.round(140 / scale);
    const canvas = document.createElement("canvas"), ctx = canvas.getContext("2d", { willReadFrequently: true });
    let text = "";
    for (let y = 0; y < h; y += STRIP - OVERLAP) {
      const sh = Math.min(STRIP, h - y);
      canvas.width = Math.round(w * scale); canvas.height = Math.round(sh * scale);
      ctx.drawImage(img, 0, y, w, sh, 0, 0, canvas.width, canvas.height);
      // COROS is bright text (white, orange, green) on black. The reader wants dark on white.
      const px = ctx.getImageData(0, 0, canvas.width, canvas.height), a = px.data;
      for (let i = 0; i < a.length; i += 4) { const v = 255 - Math.max(a[i], a[i + 1], a[i + 2]); a[i] = a[i + 1] = a[i + 2] = v; }
      ctx.putImageData(px, 0, 0);
      text += (await worker.recognize(canvas)).data.text + "\n";
      onProgress(Math.min(1, (y + sh) / h));
      if (y + sh >= h) break;
    }
    canvas.width = canvas.height = 0; // let go of the picture
    return text;
  } finally {
    img.close?.();
    await worker.terminate();
  }
}
