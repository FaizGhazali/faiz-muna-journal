// Save the whole journal to a file, and load such a file back in.
// Loading adds or replaces items with the same id. It never deletes anything.
import { collection, doc, getDocs, writeBatch } from "./fs.js";

const APP = "our-journal";
const VERSION = 1;
const COLS = ["config", "entries", "activities", "habitDays", "moves", "foods", "mealSets", "meals", "burns", "diary", "diaryPhotos", "diaryStyle", "pantry", "buys", "prices", "shopList"];
const LABELS = { entries: "journal entries", diary: "diary entries", diaryPhotos: "diary photos", activities: "activities", habitDays: "habit days", moves: "history items" };
const BATCH = 400; // Firestore allows 500 writes per batch

const $ = (id) => document.getElementById(id);
const pad = (n) => String(n).padStart(2, "0");
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const okId = (id) => typeof id === "string" && id.length > 0 && id.length <= 150 && !id.includes("/") && id !== "." && id !== "..";
const isObj = (v) => v && typeof v === "object" && !Array.isArray(v);

let db, pending = null;

export function initBackup(opts) {
  db = opts.db;
  $("exportBtn").addEventListener("click", exportData);
  $("importBtn").addEventListener("click", () => { $("importFile").value = ""; $("importFile").click(); });
  $("importFile").addEventListener("change", (ev) => { const f = ev.target.files[0]; if (f) readFile(f); });
  $("importYes").addEventListener("click", importData);
  $("importNo").addEventListener("click", () => { pending = null; showConfirm(false); say(""); });
}

function say(text) { $("dataMsg").textContent = text; }
function showConfirm(on) {
  $("importAsk").hidden = !on;
  $("exportBtn").disabled = $("importBtn").disabled = on;
}

async function exportData() {
  const btn = $("exportBtn");
  btn.disabled = true;
  say("Getting your data…");
  try {
    const data = {};
    for (const name of COLS) {
      const snap = await getDocs(collection(db, name));
      data[name] = {};
      snap.forEach((d) => { data[name][d.id] = d.data(); });
    }
    const file = { app: APP, version: VERSION, exported: new Date().toISOString(), data };
    const blob = new Blob([JSON.stringify(file, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `journal-backup-${stamp(new Date())}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
    const n = Object.keys(data.entries).length;
    say(`Saved a backup with ${n} journal ${n === 1 ? "entry" : "entries"}. Keep the file somewhere safe.`);
  } catch (_) {
    say("Couldn't make the backup. Check your connection and try again.");
  } finally { btn.disabled = false; }
}

async function readFile(file) {
  pending = null;
  let parsed;
  try { parsed = JSON.parse(await file.text()); } catch (_) { say("That file isn't a journal backup."); return; }
  if (!isObj(parsed) || parsed.app !== APP || !isObj(parsed.data)) { say("That file isn't a journal backup."); return; }
  if (parsed.version > VERSION) { say("That backup is from a newer version of the app. Reload the app and try again."); return; }

  const writes = [];
  for (const name of COLS) {
    const docs = parsed.data[name];
    if (!isObj(docs)) continue;
    for (const [id, body] of Object.entries(docs)) {
      if (!okId(id) || !isObj(body)) continue;
      if (name === "config" && (id !== "people" || !Array.isArray(body.people))) continue;
      writes.push({ name, id, body });
    }
  }
  if (!writes.length) { say("That backup is empty."); return; }

  const counts = {};
  writes.forEach((w) => { counts[w.name] = (counts[w.name] || 0) + 1; });
  const parts = Object.keys(LABELS).filter((k) => counts[k]).map((k) => `${counts[k]} ${LABELS[k]}`);
  if (counts.config) parts.push("names and heights");
  const when = typeof parsed.exported === "string" && !isNaN(Date.parse(parsed.exported))
    ? new Date(parsed.exported).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" }) : "an unknown date";

  pending = writes;
  $("importText").textContent = `This backup from ${when} has ${parts.join(", ")}. Items already in the journal with the same date or id will be replaced by the backup copy. Nothing is deleted.`;
  say("");
  showConfirm(true);
}

async function importData() {
  if (!pending) return;
  const writes = pending;
  pending = null;
  $("importYes").disabled = $("importNo").disabled = true;
  say("Loading the backup…");
  try {
    for (let i = 0; i < writes.length; i += BATCH) {
      const batch = writeBatch(db);
      writes.slice(i, i + BATCH).forEach((w) => batch.set(doc(db, w.name, w.id), w.body));
      await batch.commit();
    }
    say(`Done. Loaded ${writes.length} items from the backup.`);
  } catch (_) {
    say("Part of the backup didn't load. Check your connection and load the same file again.");
  } finally {
    $("importYes").disabled = $("importNo").disabled = false;
    showConfirm(false);
  }
}
