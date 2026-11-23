// The "Write today's entry" form: weight, a COROS run picture (read on the device by coros.js), a note.
// One entry per person per day (entries/{person}_{date}); saving again that day fills in only what was typed.
// Also the Edit / Delete buttons in the feed (drawn by weightui.js).
import { doc, setDoc, deleteDoc } from "../../core/fs.js";
import { clock, toSecs } from "../../logic/fitness.js";
import { readCoros, parseCoros } from "./coros.js";
import { isMood } from "../../logic/mood.js";
import { r1 } from "../../logic/bmi.js";
import { confirmDelete } from "../../core/confirm.js";
import { $, esc, parse, today, fmt } from "../../core/util.js";

let entriesCol, people = () => [], entries = () => [], commit;
let editingId = null; // the entry being edited, or null for a new one
let runExtra = null; // numbers from the picture that have no box in the form (cadence, power, ...)

export function initEntryForm(opts) {
  ({ entriesCol, people, entries, commit } = opts);
  $("runPick").addEventListener("click", () => $("runFile").click());
  $("runRemove").addEventListener("click", () => { showRun(null); $("runMsg").textContent = ""; });
  $("runFile").addEventListener("change", readPicture);
  $("form").addEventListener("submit", save);
  $("cancelEdit").addEventListener("click", () => { resetForm(); $("formMsg").textContent = ""; });
  $("feed").addEventListener("click", feedClick);
}

// The person radio buttons, once the people are known.
export function setPeople(list) {
  $("who").innerHTML = list.map((p, i) => `<input type="radio" name="person" id="person-${p.id}" value="${p.id}"${i ? "" : " checked"}><label for="person-${p.id}">${esc(p.name)}</label>`).join("");
  resetForm();
}

// ---------- the run boxes. Paces and time are typed as 9:29 and 40:37. ----------
const RUN_NUMS = ["km", "hr", "hrMax", "hrr", "load"], RUN_TIMES = ["secs", "pace", "effort"];
function showRun(run) {
  $("runFields").hidden = !run;
  $("runPick").textContent = run ? "Use another picture" : "Add run picture";
  runExtra = null;
  if (!run) return;
  RUN_NUMS.forEach((k) => { $("run-" + k).value = run[k] ?? ""; });
  RUN_TIMES.forEach((k) => { $("run-" + k).value = run[k] ? clock(run[k]) : ""; });
  const { cadence, stride, power, ground, kcal } = run;
  runExtra = { cadence, stride, power, ground, kcal };
}
// Returns { run } from the boxes, or { error } with what to fix.
function readRun() {
  const run = { source: "coros" }, lim = { km: [0.1, 100], hr: [60, 220], hrMax: [100, 220], hrr: [1, 120], load: [1, 2000] };
  for (const k of RUN_NUMS) {
    const v = $("run-" + k).value.trim(); if (v === "") continue;
    const n = Number(v);
    if (!(n >= lim[k][0] && n <= lim[k][1])) return { error: `Check the run's ${$("run-" + k).labels[0].firstChild.textContent.toLowerCase()}.` };
    run[k] = k === "km" ? Math.round(n * 100) / 100 : Math.round(n);
  }
  for (const k of RUN_TIMES) {
    const v = $("run-" + k).value.trim(); if (v === "") continue;
    const n = toSecs(v);
    if (!n) return { error: k === "secs" ? "Write the run time like 40:37." : "Write the pace like 9:29." };
    run[k] = n;
  }
  if (!run.km || !run.secs || !run.hr) return { error: "The run needs a distance, a time and an average heart rate." };
  Object.entries(runExtra || {}).forEach(([k, v]) => { if (typeof v === "number") run[k] = v; });
  return { run };
}
async function readPicture() {
  const file = $("runFile").files[0], msg = $("runMsg"), bar = $("runBar");
  if (!file) return;
  msg.textContent = "Reading the picture. This can take a minute…";
  bar.value = 0; bar.hidden = false; $("runPick").disabled = true;
  try {
    const found = parseCoros(await readCoros(file, (v) => { bar.value = v; }));
    if (!found.km && !found.secs && !found.hr) { msg.textContent = "That doesn't look like a COROS run picture. Share the run from the COROS app and try again."; return; }
    const { date, ...run } = found;
    showRun(run);
    if (date && date <= today() && !editingId) $("date").value = date;
    const missing = !run.km || !run.secs || !run.hr;
    msg.textContent = `${missing ? "Some numbers couldn't be read. Fill them in below" : "Done. Check the numbers below"}, then save. The picture wasn't kept.`;
  } catch (e) {
    msg.textContent = e.message === "small" ? "That picture is too small to read. Use the full picture shared from the COROS app."
      : navigator.onLine ? "That picture couldn't be read. Try again." : "The picture reader needs the internet the first time. Try again when you're online.";
  } finally { $("runFile").value = ""; bar.hidden = true; $("runPick").disabled = false; } // nothing of the picture is kept once it's read
}

// ---------- new / edit ----------
function selectedPerson() { return document.querySelector("input[name=person]:checked")?.value; }
export function resetForm() {
  editingId = null;
  $("form").reset();
  showRun(null);
  $("runMsg").textContent = "";
  $("date").value = today();
  try { const last = localStorage.getItem("journal-person"); if (last && $("person-" + last)) $("person-" + last).checked = true; } catch (_) {}
  $("formTitle").textContent = "Write today's entry";
  $("save").textContent = "Save entry";
  $("cancelEdit").hidden = true;
}
function startEdit(id) {
  const e = entries().find((x) => x.id === id); if (!e) return;
  editingId = id;
  $("person-" + e.person).checked = true;
  $("date").value = e.date;
  $("weight").value = typeof e.weight === "number" ? e.weight : "";
  showRun(e.run || null);
  $("runMsg").textContent = "";
  $("note").value = e.note || "";
  $("formTitle").textContent = "Edit entry";
  $("save").textContent = "Save changes";
  $("cancelEdit").hidden = false;
  $("formMsg").textContent = "";
  $("formPanel").scrollIntoView({ behavior: "smooth", block: "nearest" });
}

async function save(ev) {
  ev.preventDefault();
  const all = entries(), msg = $("formMsg"), person = selectedPerson(), date = $("date").value;
  const ws = $("weight").value.trim(), note = $("note").value.trim();
  const weight = ws === "" ? null : r1(Number(ws));
  const typed = $("runFields").hidden ? {} : readRun();
  if (!date) { msg.textContent = "Pick a date for this entry."; return; }
  if (weight !== null && !(weight >= 30 && weight <= 250)) { msg.textContent = "Enter a weight between 30 and 250 kg."; return; }
  if (typed.error) { msg.textContent = typed.error; return; }
  const id = `${person}_${date}`, existing = all.find((e) => e.id === id), wasEditing = editingId;
  const body = { person, date };
  // A new entry on a day that already has one fills in only what was typed, so nothing written earlier is lost.
  const keep = !wasEditing && existing ? existing : {};
  const before = wasEditing ? all.find((e) => e.id === wasEditing) || {} : keep;
  const run = typed.run || keep.run;
  // Minutes come from the run. Entries from before run pictures keep the minutes they had.
  const w = weight ?? keep.weight, mn = run ? Math.round(run.secs / 60) : before.run ? null : before.minutes, n = note || keep.note;
  if (typeof w === "number") body.weight = w;
  if (typeof mn === "number") body.minutes = mn;
  if (run) body.run = run;
  if (Object.keys(body).length === 2 && !n) { msg.textContent = "Add a weight, a run picture or a note first."; return; }
  if (n) body.note = n;
  const md = (wasEditing ? before : keep).mood; // the mood is rated on its own card, so keep it
  if (isMood(md)) body.mood = md;
  const was = wasEditing ? before : keep, now = Date.now(); // when it was written, for looking back later
  body.created = was.created || now; body.updated = now;
  if (was.moodAt) body.moodAt = was.moodAt;
  $("save").disabled = true;
  const who = people().find((p) => p.id === person).name;
  const done = `${existing || wasEditing ? "Updated" : "Saved"} ${who}'s entry for ${fmt(date, { day: "numeric", month: "short" })}.`;
  try { await commit(() => setDoc(doc(entriesCol, id), body), done); } catch (_) { $("save").disabled = false; return; }
  if (wasEditing && wasEditing !== id) await commit(() => deleteDoc(doc(entriesCol, wasEditing)));
  try { localStorage.setItem("journal-person", person); } catch (_) {}
  resetForm();
  msg.textContent = done;
  $("save").disabled = false;
}

// ---------- Edit / Delete in the feed ----------
async function feedClick(ev) {
  const b = ev.target.closest("button[data-act]"); if (!b) return;
  const act = b.dataset.act, id = b.dataset.id;
  if (act === "edit") startEdit(id);
  if (act === "del") {
    const e = entries().find((x) => x.id === id); if (!e) return;
    const p = people().find((x) => x.id === e.person);
    const what = [typeof e.weight === "number" && "weight", (e.run || typeof e.minutes === "number") && "exercise", e.mood && "mood", e.note && "note"].filter(Boolean);
    const ok = await confirmDelete({ title: `Delete ${p ? `${p.name}'s` : "this"} entry for ${parse(e.date).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}?`, yes: "Delete entry",
      body: what.length ? `<p>The day's ${esc(what.join(", ").replace(/, ([^,]*)$/, " and $1"))} go${what.length === 1 ? "es" : ""} with it.</p>` : "" });
    if (!ok) return;
    if (editingId === id) resetForm();
    await commit(() => deleteDoc(doc(entriesCol, id)));
  }
}
