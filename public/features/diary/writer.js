// Dearly's writer box in the editor: turns the notes into an entry with the on-device model (localai.js, WebLLM)
// or the family's cloud writer (cloudai.js). Also the shared pieces of the writer settings (where, style, sizes,
// download bar) that the AI & privacy page (settings.js) shows too.
import { words, bodyText } from "../../logic/diary.js";
import { styleSource, styleProfile, samplesFor, buildMessages, cleanOutput, unsupported, dropped, looksGarbled } from "../../logic/writestyle.js";
import * as ai from "./localai.js";
import * as cloud from "./cloudai.js";
import { $, esc } from "../../core/util.js";
import { S, store, pid, person, styleOf } from "./state.js";
import { count, saveDraft, offerUndo } from "./editor.js";
import { renderSettings, paintAiPage } from "./settings.js";
import { ico } from "../../core/icons.js";

// What this device can do (localai.js checkSupport), checked once when the writer is first needed.
export let device = null;
// msg = problem (red), note = calm news, detail = technical text to copy, flags / lost = words to check after writing.
export let aiState = { busy: false, progress: 0, mb: 0, phase: "", msg: "", note: "", flags: [], lost: [] };
let abort = null; // stops a write in progress
let demoLeftN = null; // demo writes left today on the shared cloud writer

export async function probe() {
  device = { checking: true };
  paintAi();
  device = await ai.checkSupport();
  if (device.why === "mobile" && await ai.clearAll()) aiState.note = "The on-phone writer is now off on phones, so its download was removed to free space. Use the cloud writer or write it yourself.";
  // The faster 16-bit build scrambles words on some phone graphics chips even when they claim support, so phones
  // (and any device where scrambling was seen, journal-ai-f32) use the 32-bit build. A bit bigger, always correct.
  if (device.ok) {
    const had16 = device.f16;
    // "journal-ai-build": "f16" when the person chose the faster build on a phone (with the scramble guard watching).
    device.f16raw = had16;
    device.f16 = device.f16 && (!device.mobile || store.get("journal-ai-build", "") === "f16") && !store.get("journal-ai-f32", false);
    // A phone that downloaded the 16-bit build before this change: remove it and say why, once.
    if (had16 && !device.f16) {
      let removed = false;
      for (const x of ai.MODELS) if (await ai.isDownloaded(x.key, true)) { try { await ai.remove(x.key, true); removed = true; } catch (_) {} }
      if (removed) aiState.note = "Dearly now uses a safer version of the writer on this phone (the old one could scramble words). Please download it once more.";
    }
  }
  const key = aiKey();
  device.downloaded = device.ok ? await ai.isDownloaded(key, device.f16) : false;
  paintAi();
  if (S.route === "ai") renderSettings();
}
export const aiKey = () => store.get("journal-ai-model", null) || ai.suggestKey(device);

// The writer box under the notes in the editor.
export function paintAi() {
  const host = $("dyAi"); if (!host) return;
  const btn = $("dyWrite"), stop = $("dyStop");
  const m = ai.modelOf(aiKey());
  let html = "";
  if (S.modelUi === "cloud-ask") html = cloudAskHtml();
  else if (useCloud()) html = whereHtml() + cloudLineHtml();
  else if (!device || device.checking) html = whereHtml() + `<p class="note">Checking whether this device can run the writer…</p>`;
  else if (!device.ok) html = whereHtml() + `<div class="dy-box"><p><b>The writer can't run on this device.</b> ${esc(ai.whyText(device.why))}</p><p class="note">Everything else works. Tap "Write it myself" and your notes stay in the box above to help you.</p>${cloudOffer()}</div>`;
  else if (aiState.phase === "download" || aiState.phase === "open") {
    html = `<div class="dy-box">${barHtml()}
      <p class="note">${aiState.phase === "download" ? "One time only. Stay on this page and keep writing if you like. If it stops, tap Download again: finished parts are kept." : "This takes a few seconds each time the app opens."}</p></div>`;
  } else if (!device.downloaded && !ai.isLoaded(aiKey(), device.f16)) {
    html = whereHtml() + `<div class="dy-box"><p><b>Turn on Dearly's writer.</b> It runs entirely on this ${device.mobile ? "phone" : "device"}: your notes never leave it, and it's free.</p>
      <p class="note">Pick a size. It downloads once${device.mobile ? ", best on Wi-Fi" : ""}.</p>
      ${sizesHtml()}
      <p class="note">${esc(m.note)}</p>
      <div class="actions"><button type="button" class="primary" data-dy="download">Download ${esc(sizeOf(m))}</button></div>${cloud.cloudReady() ? `<p class="note">No download? Pick Cloud above.</p>` : ""}</div>`;
  } else if (S.modelUi === "sizes") {
    // Changing size while one is already downloaded: same buttons, right here.
    html = `<div class="dy-box"><p><b>Pick a writer size</b></p>${sizesHtml()}<p class="note">${esc(m.note)}</p>
      <div class="actions"><button type="button" class="primary" data-dy="sizes-done">Done</button></div></div>`;
  } else if (S.modelUi === "remove") {
    html = `<div class="dy-box"><p><b>Remove the ${esc(m.name)} writer from this ${device.mobile ? "phone" : "device"}?</b></p>
      <p class="note">Frees about ${esc(sizeOf(m))}. Your diary isn't touched, and you can download it again any time.</p>
      <div class="actions"><button type="button" class="danger" data-dy="remove-here">Remove it</button><button type="button" data-dy="model-keep">Keep it</button></div></div>`;
  } else {
    if (!aiState.busy) html += whereHtml();
    if (device.soft) html += `<p class="note">This device has no graphics chip for AI, so writing will be slow.</p>`;
    // One quiet line so the writer can be changed or removed without leaving the page.
    if (!aiState.busy) html += `<div class="dy-modelline"><span>Model: <b>${esc(m.name)}</b> · about ${esc(sizeOf(m))} on this ${device.mobile ? "phone" : "device"}</span>
      <span class="btns"><button type="button" class="mini" data-dy="sizes-open">Change size</button><button type="button" class="mini" data-dy="model-remove">Remove</button></span></div>` + styleHtml();
  }
  if (aiState.note) html = `<p class="note dy-note" role="status">✓ ${esc(aiState.note)}</p>` + html;
  if (aiState.msg) html += `<p class="note dy-err" role="alert">${esc(aiState.msg)}</p>`;
  if (aiState.detail && !aiState.busy) html += failHtml();
  if ((aiState.flags.length || aiState.lost?.length) && !aiState.busy) html += `<div class="dy-box dy-check">
    ${aiState.flags.length ? `<p><b>${aiState.story ? "Added by the writer.</b> Keep what's true, delete what didn't happen:" : "Check these.</b> They weren't in your notes:"} ${aiState.flags.map((f) => `<mark>${esc(f)}</mark>`).join(" ")}</p>` : ""}
    ${aiState.lost?.length ? `<p><b>Your own words that went missing:</b> ${aiState.lost.map((f) => `<mark>${esc(f)}</mark>`).join(" ")}</p>` : ""}
    <p class="note">The writer is small and makes slips. Change anything that didn't happen, isn't how you felt, or isn't how you'd say it.</p></div>`;
  host.innerHTML = html;
  const ed = S.ed;
  if (btn) { btn.disabled = aiState.busy || (!useCloud() && device && !device.checking && !device.ok); btn.innerHTML = aiState.busy && aiState.phase === "write" ? "Writing…" : `${ico("sparkle")} ${ed && ed.ai && bodyText(ed.body) ? "Write it again" : "Write it for me"}`; }
  if (stop) stop.hidden = !(aiState.busy && aiState.phase === "write");
}
const repaint = () => { paintAi(); paintAiPage(); };

// The model wrote scrambled text: this graphics chip mishandles the 16-bit build. Remember that on this device,
// throw away the broken download, and offer the safe 32-bit build. Returns the message to show.
async function switchToSafe() {
  const key = aiKey(), wasF16 = device.f16;
  store.set("journal-ai-f32", true); store.set("journal-ai-build", "");
  device.f16 = false;
  if (wasF16) { try { await ai.remove(key, true); } catch (_) {} }
  device.downloaded = await ai.isDownloaded(key, false);
  const m = ai.modelOf(key);
  return wasF16
    ? `This ${device.mobile ? "phone" : "device"}'s graphics chip scrambled the words. Nothing was saved. Dearly has switched to the safe version of the writer: download it once (about ${sizeOf(m)}) and try again.`
    : `The writer scrambled the words even with the safe build. Nothing was saved. Some phone graphics chips (Qualcomm Adreno included) don't run it reliably in the browser yet. You can write yourself here, or use the writer on a laptop. Copy the details below if you'd like it looked into.`;
}

// ---------- the cloud writer (cloudai.js): the family's own Modal server, for phones that can't run the writer ----------
// Chosen per device ("journal-ai-where"); the first time, it says what leaves the phone and asks ("journal-ai-cloud-ok").
export const useCloud = () => cloud.cloudReady() && store.get("journal-ai-where", "device") === "cloud";
export async function wakeCloud() {
  if (S.demo) { demoLeftN = await cloud.demoLeft(); paintAi(); }
  else cloud.cloudWarm(await S.getToken().catch(() => null));
}
const cloudOffer = (lead = "") => cloud.cloudReady()
  ? `<div class="dy-cloudoffer"><span class="note">${esc(lead)}The cloud writer works on any phone, with nothing to download.</span><button type="button" data-dy="cloud-use">${ico("cloud")} Use the cloud writer</button></div>` : "";
export function cloudAskHtml() {
  return `<div class="dy-box"><p><b>Use the cloud writer?</b></p>
    <p class="note">${S.demo ? "In the demo, only your notes go to a shared server that writes the entry and keeps nothing. Everyone trying the demo shares a few writes a day."
      : "This entry's notes, plus About you and your style if they're on, go to your family's own server on Modal. It writes the entry and keeps nothing. Nothing to download, and it's free."}</p>
    <div class="actions"><button type="button" class="primary" data-dy="cloud-yes">Use the cloud writer</button><button type="button" data-dy="cloud-no">Not now</button></div></div>`;
}
// Which writer: this device (WebLLM) or the cloud. Always shown at the top of the writer box (when the cloud is set
// up), so either one can be picked at any time. Phones can't run the device writer (localai.js checkSupport).
export function whereHtml() {
  if (!cloud.cloudReady() || aiState.busy) return "";
  const c = useCloud(), phone = (device?.mobile ?? /Android|iPhone|iPad|Mobile/i.test(navigator.userAgent));
  return `<div class="dy-style dy-where" role="group" aria-label="Which writer"><span>Writer</span>
    <button type="button" class="mini" data-dy="device-use" aria-pressed="${!c}"${phone ? ` disabled title="Not on phones"` : ""}>${ico("laptop")} This ${phone ? "phone" : "device"}${phone ? " (off on phones)" : ""}</button>
    <button type="button" class="mini" data-dy="cloud-use" aria-pressed="${c}">${ico("cloud")} Cloud</button></div>`;
}
function cloudLineHtml() {
  const left = S.demo && demoLeftN != null ? `${demoLeftN} demo ${demoLeftN === 1 ? "write" : "writes"} left today` : "";
  return aiState.busy ? "" : (left ? `<p class="note">${esc(left)}</p>` : "") + styleHtml();
}
// Story or Close to my notes: the same two styles on the cloud writer and the device writer.
export function styleHtml() {
  if (aiState.busy) return "";
  const story = storyOn();
  return `<div class="dy-style" role="group" aria-label="Writing style"><span>Style</span>
      <button type="button" class="mini" data-dy="style-story" aria-pressed="${story}">${ico("story")} Story</button>
      <button type="button" class="mini" data-dy="style-close" aria-pressed="${!story}">${ico("note")} Close to my notes</button></div>
    <p class="note">${story ? `Tells your points as a story. It may add small details${useCloud() ? "" : " (more often with the small model on this device)"}, so you'll see what it added to check.` : "Tidies each point into a sentence, with nothing added."}</p>`;
}
// Story (default) or Close to my notes, per device ("journal-ai-style"), for both writers.
const storyOn = () => store.get("journal-ai-style", "story") === "story";

async function writeInCloud(notes) {
  const ed = S.ed, st = styleOf(), src = st.on ? styleSource(S.list, pid(), st.since || "") : [];
  const profile = st.on ? styleProfile(src.map((e) => e.body)) : null, about = st.about || "";
  const tok = S.demo ? null : await S.getToken().catch(() => null);
  if (!S.demo && !tok) { aiState.msg = "The cloud writer only works when you're signed in to the journal."; paintAi(); return; }
  // Family: the full prompt, built here. Demo: only the notes; the server builds a fixed prompt.
  const story = storyOn();
  const messages = tok ? buildMessages({ notes, profile, samples: profile ? samplesFor(src, 2) : [], name: person().name, about, story }) : null;
  const before = ed.body, page = $("dyBody");
  aiState = { busy: true, phase: "write", progress: 0, msg: "", note: "Waking the cloud writer… the first write after a quiet spell can take up to a minute.", detail: "", flags: [], lost: [], story };
  paintAi();
  abort = new AbortController();
  let first = true;
  try {
    const out = await cloud.cloudWrite({ token: tok, messages, notes, story, signal: abort.signal }, (t) => {
      if (first && t.trim()) { first = false; aiState.note = ""; paintAi(); }
      const c = cleanOutput(t, notes, false, story); if (c && page) page.value = c;
    });
    if (looksGarbled(out, notes)) throw new Error("jumbled");
    const clean = cleanOutput(out, notes, true, story);
    if (!clean || words(bodyText(clean)) < 3) throw new Error("empty");
    ed.body = clean; ed.ai = true;
    if (page) page.value = clean;
    aiState.flags = unsupported(notes, clean, about);
    aiState.lost = dropped(notes, clean);
    offerUndo(before);
  } catch (e) {
    if (page) page.value = ed.body;
    const stopped = abort?.signal.aborted;
    aiState.msg = stopped ? "" : e.message === "empty" ? "The writer came back empty. Try again, or add a little more to your notes."
      : e.message === "jumbled" ? "The cloud writer's reply came out jumbled. Nothing was saved. Try again." : cloud.cloudErrorText(e, S.demo);
    // Daily limits and sign-in problems explain themselves; details only for real failures.
    if (!stopped && (!e.status || e.status >= 500) && !["empty", "jumbled"].includes(e.message)) aiState.detail = `Cloud writer: ${e.status ? `HTTP ${e.status} ${e.detail || ""}` : String(e.message || e)}\nBrowser: ${navigator.userAgent}`;
  } finally {
    aiState.busy = false; aiState.phase = ""; aiState.note = ""; abort = null;
    if (S.ed) { count(); saveDraft(); }
    paintAi();
    if (S.demo) wakeCloud();
  }
}

// When the writer won't start: offer the phone's other build right here, and the real error to copy and send.
function failHtml() {
  const other = useCloud() ? "" : device?.f16 ? "safe" : device?.f16raw ? "fast" : ""; // builds are for the on-phone writer only
  return `<div class="dy-box dy-fail">
    ${other ? `<p class="note">${other === "fast" ? "This phone also has a faster build. It sometimes scrambles words on phones, but Dearly watches for that and stops it." : "Try the safe build instead. It's a little bigger but works on more graphics chips."}</p>
      <div class="actions"><button type="button" class="primary" data-dy="other-build">${other === "fast" ? "Try the faster build" : "Try the safe build"}</button></div>` : ""}
    <details><summary>Show technical details</summary><pre class="dy-detail">${esc(aiState.detail)}</pre>
      <div class="actions"><button type="button" class="mini" data-dy="copy-detail">Copy details</button><span class="note" id="dyCopied" role="status"></span></div></details>${useCloud() ? "" : cloudOffer()}</div>`;
}

// Download size for this device: the safe 32-bit build used on phones is about 15% bigger.
export const sizeOf = (x) => `${(x.gb * (device?.f16 === false ? 1.15 : 1)).toFixed(1)} GB`;
// Size picker shown right in the editor, so choosing a size never leaves the page you're writing on.
function sizesHtml() {
  const key = aiKey(), fit = ai.suggestKey(device);
  return `<div class="dy-sizes" role="radiogroup" aria-label="Model size">${ai.MODELS.map((x) => `<button type="button" role="radio" class="dy-size" data-size="${x.key}" aria-checked="${x.key === key}">
    <b>${esc(x.name)}</b><small>${esc(sizeOf(x))}</small>${x.key === fit ? `<em>Suits this ${device?.mobile ? "phone" : "device"}</em>` : ""}</button>`).join("")}</div>`;
}
// The download / opening bar: a big percentage, a thick bar and how many MB so far. Updated in place while it runs.
const barTotal = () => Math.round(ai.modelOf(aiKey()).gb * 1000 * (device?.f16 === false ? 1.15 : 1));
function barText() {
  const dl = aiState.phase === "download", pct = Math.round(aiState.progress * 100);
  return { pct, title: dl ? "Downloading the writer" : "Getting the writer ready",
    detail: dl ? (aiState.mb ? `${Math.round(aiState.mb)} of about ${barTotal()} MB` : "Starting the download…") : "Opening it from this device…" };
}
export function barHtml() {
  const t = barText();
  return `<div class="dy-prog" data-prog>
    <div class="dy-proghead"><b data-prog-title>${esc(t.title)}</b><span class="dy-pct" data-prog-pct>${t.pct}%</span></div>
    <div class="dy-bar${t.pct ? "" : " wait"}" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${t.pct}" aria-label="${esc(t.title)}"><i style="width:${t.pct}%"></i></div>
    <p class="note" data-prog-detail>${esc(t.detail)}</p></div>`;
}
// Move the bars without redrawing the box, so it doesn't flicker on a phone.
function updateBars() {
  const bars = document.querySelectorAll("#diary [data-prog]");
  if (!bars.length) return false;
  const t = barText();
  bars.forEach((b) => {
    b.querySelector("[data-prog-title]").textContent = t.title;
    b.querySelector("[data-prog-pct]").textContent = `${t.pct}%`;
    b.querySelector("[data-prog-detail]").textContent = t.detail;
    const bar = b.querySelector(".dy-bar"); bar.classList.toggle("wait", !t.pct); bar.setAttribute("aria-valuenow", t.pct); bar.setAttribute("aria-label", t.title);
    bar.firstElementChild.style.width = `${t.pct}%`;
  });
  return true;
}

async function startModel() {
  const key = aiKey();
  aiState = { ...aiState, busy: true, phase: device.downloaded ? "open" : "download", progress: 0, mb: 0, msg: "", note: "", detail: "" };
  paintAi();
  ai.keepStorage();
  try {
    await ai.load(key, device.f16, (r) => {
      const was = aiState.phase, mb = /([\d.]+)\s*MB fetched/i.exec(r.text);
      aiState.phase = device.downloaded ? "open" : r.phase === "download" ? "download" : aiState.phase;
      aiState.progress = r.progress; if (mb) aiState.mb = +mb[1];
      if (aiState.phase !== was || !updateBars()) repaint();
    });
    device.downloaded = true;
    store.set("journal-ai-model", key);
    return true;
  } catch (e) {
    aiState.msg = ai.errorText(e);
    aiState.detail = `${String(e?.message || e || "unknown").slice(0, 500)}

Model: ${ai.idOf(key, device.f16)}
GPU: ${device.gpu || "?"}
Browser: ${navigator.userAgent}`;
    device.downloaded = await ai.isDownloaded(key, device.f16);
    return false;
  } finally { aiState.busy = false; aiState.phase = ""; repaint(); }
}

async function writeForMe() {
  const ed = S.ed;
  if (!ed || aiState.busy) return;
  const notes = ed.notes.trim();
  if (words(notes) < 2) { aiState.msg = "Jot down a few words about your day first."; paintAi(); $("dyNotes")?.focus(); return; }
  if (useCloud()) return writeInCloud(notes);
  if (!device || device.checking) await probe();
  if (!device.ok) return;
  if (!ai.isLoaded(aiKey(), device.f16) && !(await startModel())) return;
  // Style comes only from this person's own entries, and only when they turned it on.
  const st = styleOf(), src = st.on ? styleSource(S.list, pid(), st.since || "") : [];
  const profile = st.on ? styleProfile(src.map((e) => e.body)) : null;
  const about = st.about || ""; // "About you" is always used: the person wrote it for exactly this
  // Phones get shorter instructions: a long first step can trip the phone GPU's watchdog, which drops the job.
  const compact = !!device.mobile, story = storyOn();
  const messages = buildMessages({ notes, profile, samples: profile && !compact ? samplesFor(src, 2) : [], name: person().name, about, compact, story });
  const before = ed.body;
  aiState = { busy: true, phase: "write", progress: 0, msg: "", flags: [], lost: [], story };
  paintAi();
  const page = $("dyBody");
  let garbled = false, sample = "";
  // One go at writing. The scramble guard stops it the moment the text turns to junk.
  const run = async () => {
    abort = new AbortController();
    garbled = false;
    const out = await ai.write(messages, (t) => {
      if (garbled) return;
      if (looksGarbled(t, notes)) { garbled = true; sample = bodyText(t).slice(0, 120); abort.abort(); if (page) page.value = before; return; }
      const c = cleanOutput(t, notes, false, story); if (c && page) page.value = c;
    }, abort.signal, { story });
    if (garbled || looksGarbled(out, notes)) { sample ||= bodyText(out).slice(0, 120); throw new Error("garbled"); }
    return out;
  };
  try {
    let out;
    try { out = await run(); }
    catch (e) {
      // The GPU dropped the job (not our guard, not the Stop button): start the writer fresh and try once more.
      if (garbled || e.message !== "gpu-lost") throw e;
      if (page) page.value = before;
      aiState.phase = ""; aiState.note = "The phone's graphics chip stopped the writer partway. Starting it fresh and trying once more…"; paintAi();
      if (!(await startModel())) throw e;
      aiState = { ...aiState, busy: true, phase: "write", note: "" }; paintAi();
      out = await run();
    }
    const clean = cleanOutput(out, notes, true, story);
    if (!clean || words(bodyText(clean)) < 3) throw new Error("empty");
    ed.body = clean; ed.ai = true;
    if (page) page.value = clean;
    aiState.flags = unsupported(notes, clean, about);
    aiState.lost = dropped(notes, clean);
    aiState.note = "";
    offerUndo(before);
  } catch (e0) {
    // Our own guard stopping a scrambled run can surface as a GPU error; it's still "scrambled".
    const e = garbled ? new Error("garbled") : e0, stopped = abort?.signal.aborted && !garbled;
    if (page) page.value = ed.body;
    aiState.note = "";
    aiState.msg = e.message === "garbled" ? await switchToSafe()
      : e.message === "empty" ? "The writer came back empty. Try again, or add a little more to your notes." : stopped ? "" : ai.errorText(e0);
    if (e.message !== "empty" && !stopped)
      aiState.detail = `${e.message === "garbled" ? `Scrambled output, e.g.: ${sample}` : String(e0?.cause?.message || e0?.message || e0 || "unknown").slice(0, 500)}

Model: ${ai.idOf(aiKey(), device.f16)}
GPU: ${device.gpu || "?"}
Browser: ${navigator.userAgent}`;
  } finally {
    aiState.busy = false; aiState.phase = ""; abort = null;
    if (S.ed) { count(); saveDraft(); }
    paintAi();
  }
}

// Download (or open) the model: the editor's Download button and the AI page's buttons.
export async function getModel() { if (!device || device.checking) await probe(); if (device.ok) await startModel(); }

// ---------- events (dispatched from diaryui.js) ----------
export function click(ev) {
  const size = ev.target.closest("button[data-size]");
  if (!size) return false;
  if (aiState.busy) return true;
  store.set("journal-ai-model", size.dataset.size); aiState.msg = "";
  paintAi();
  if (device?.ok) ai.isDownloaded(size.dataset.size, device.f16).then((d) => { device.downloaded = d; if (!d) S.modelUi = ""; paintAi(); });
  return true;
}

const clearProblem = () => { aiState.msg = ""; aiState.detail = ""; };
export const actions = {
  write: () => writeForMe(),
  stop: () => abort?.abort(),
  download: getModel,
  test: getModel,
  async "other-build"() {
    const fast = !device.f16;
    store.set("journal-ai-build", fast ? "f16" : ""); store.set("journal-ai-f32", !fast);
    device.f16 = fast; clearProblem();
    device.downloaded = await ai.isDownloaded(aiKey(), device.f16);
    aiState.note = `Switched to the ${fast ? "faster" : "safe"} build. ${device.downloaded ? "Tap Write it for me." : "Download it below, then try again."}`;
    paintAi();
  },
  async "copy-detail"() {
    try { await navigator.clipboard.writeText(aiState.detail); $("dyCopied").textContent = "Copied. Paste it in a message to whoever helps you with the app."; }
    catch (_) { $("dyCopied").textContent = "Couldn't copy. Take a screenshot instead."; }
  },
  "cloud-use"() { clearProblem(); if (store.get("journal-ai-cloud-ok", false)) { store.set("journal-ai-where", "cloud"); S.modelUi = ""; wakeCloud(); } else S.modelUi = "cloud-ask"; repaint(); },
  "cloud-yes"() { store.set("journal-ai-cloud-ok", true); store.set("journal-ai-where", "cloud"); S.modelUi = ""; aiState.note = "Using the cloud writer on this device."; repaint(); wakeCloud(); },
  "cloud-no"() { S.modelUi = ""; repaint(); },
  "style-story"() { store.set("journal-ai-style", "story"); repaint(); },
  "style-close"() { store.set("journal-ai-style", "close"); repaint(); },
  "device-use"() { store.set("journal-ai-where", "device"); S.modelUi = ""; aiState.note = ""; clearProblem(); repaint(); if (!device) probe(); },
  "sizes-open"() { S.modelUi = "sizes"; paintAi(); },
  "sizes-done"() { S.modelUi = ""; paintAi(); },
  "model-remove"() { S.modelUi = "remove"; paintAi(); },
  "model-keep"() { S.modelUi = ""; paintAi(); },
  async "remove-here"(b) {
    const m = ai.modelOf(aiKey());
    b.disabled = true; b.textContent = "Removing…";
    try { await ai.remove(aiKey(), device.f16); device.downloaded = false; aiState.msg = ""; aiState.note = `Removed. The ${m.name} writer is off this ${device.mobile ? "phone" : "device"}. Download any size below when you want it back.`; }
    catch (_) { aiState.msg = "Couldn't remove it. Try again."; }
    S.modelUi = ""; paintAi();
  },
};
