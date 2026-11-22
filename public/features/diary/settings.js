// Dearly's AI & privacy page (#diary/ai): the writer model, About you and its suggestions, writing style,
// privacy notes, text export, paper colour and Recently deleted.
import { doc, setDoc, updateDoc } from "../../core/fs.js";
import { titleOf, live, prettyDate } from "../../logic/diary.js";
import { MIN_STYLE, ABOUT_MAX, aboutSuggestions, addToAbout, styleSource, styleProfile, describeStyle } from "../../logic/writestyle.js";
import * as ai from "./localai.js";
import { MOODS, isMood } from "../../logic/mood.js";
import { confirmDelete } from "../../core/confirm.js";
import { $, esc, today } from "../../core/util.js";
import { S, store, pid, person, mine, find, styleOf } from "./state.js";
import { removeForever } from "./data.js";
import { device, aiState, aiKey, probe, whereHtml, styleHtml, cloudAskHtml, sizeOf, barHtml } from "./writer.js";

const PAPERS = { cream: "Cream", rose: "Rose", sage: "Sage" };

// Suggested lines for About you, from this person's own entries (not ones left out of style learning).
export const suggestions = () => aboutSuggestions(live(mine()).filter((e) => !e.noStyle).map((e) => e.body), styleOf().about || "", styleOf().dismissed || []);
function suggHtml() {
  const sg = suggestions();
  if (!sg.length) return "";
  return `<div class="dy-sugg"><h3>Suggestions from your entries</h3>
    <p class="note">Spotted on this device by counting what you write, not guessed. Nothing is added unless you tap Add.</p>
    <ul>${sg.map((x) => `<li data-key="${esc(x.key)}"><p>${esc(x.text)}</p>
      ${x.kind === "ask" ? `<input type="text" class="dy-sugin" maxlength="80" placeholder="${esc(x.hint)}" aria-label="${esc(x.text)}" autocomplete="off">` : `<p class="note">Adds: "${esc(x.line)}"</p>`}
      <div class="actions"><button type="button" class="mini go" data-dy="sugg-add">Add</button><button type="button" class="mini" data-dy="sugg-no">Not now</button></div></li>`).join("")}</ul></div>`;
}

export function renderSettings() {
  const host = $("diary"), p = person(), st = styleOf(), m = ai.modelOf(aiKey());
  const src = styleSource(S.list, pid(), st.since || ""), profile = styleProfile(src.map((e) => e.body));
  const excluded = live(mine()).filter((e) => e.noStyle), deleted = mine().filter((e) => e.deleted).sort((a, b) => b.deleted - a.deleted);
  const paperNow = store.get("journal-paper", "cream");
  host.innerHTML = `<div class="fdtop"><a class="btn" href="#diary">← Back</a></div>
    <section class="panel" aria-labelledby="dyAiTitle" data-title="Dearly's writer">
      <p class="eyebrow">Dearly AI</p><h2 id="dyAiTitle">Your writing helper</h2>
      <p class="note">Turns a few words about your day into a diary entry that sounds like you. It runs on this device's graphics chip, inside the browser. Nothing you write is sent anywhere, there's no account or key, and it's free to use as much as you like.</p>
      <div id="dyAiWhere"></div>
      <div id="dyAiPage"></div>
      <fieldset class="dy-models"><legend>Model size</legend>
        ${ai.MODELS.map((x) => `<label class="dy-model"><input type="radio" name="dyModel" value="${x.key}"${x.key === m.key ? " checked" : ""}>
          <span><b>${esc(x.name)}</b> · ${esc(x.size)} download · needs about ${x.mem} GB of graphics memory${device?.ok && x.key === ai.suggestKey(device) ? ' <span class="pill" style="--c:var(--good)">Suits this device</span>' : ""}<small>${esc(x.note)}</small></span></label>`).join("")}
      </fieldset>
      <div class="actions" id="dyAiActs"></div>
      <p class="note">The model is kept in this browser's storage. Clearing the site's data or browsing history, or the browser running short of space, removes it, and it downloads again next time. On iPhone, add the app to the home screen so Safari keeps it.</p>
    </section>
    <section class="panel" aria-labelledby="dyStyleTitle" data-title="Writing style">
      <h2 id="dyStyleTitle">Your writing style</h2>
      <p class="note">With this on, the writer looks at how ${esc(p.name)} writes (sentence length, favourite words, how English and Malay are mixed, slang) so new entries sound the same. It only learns from entries you wrote yourself, never from ones the helper wrote, and it never judges what you feel. All of this happens on this device.</p>
      <label for="dyAbout"><b>About you</b> <small>In your own words, any language. The writer reads this in the background so entries sound like you and it knows who people are. It never adds anything from here as something that happened.</small></label>
      <textarea id="dyAbout" rows="4" maxlength="${ABOUT_MAX}" placeholder="Aku Amir, kerja engineer kat KL. Wife aku Lina, aku panggil dia sayang. Suka run pagi weekend. Cakap rojak, banyak guna lah dengan haha.">${esc(st.about || "")}</textarea>
      <div class="actions"><button type="button" data-dy="about">Save About you</button><span class="note" id="dyAboutMsg" role="status">${esc(S.aboutMsg)}</span></div>
      ${suggHtml()}
      <label class="dy-switch"><input type="checkbox" id="dyStyleOn"${st.on ? " checked" : ""}><span>Learn my writing style from my past entries</span></label>
      ${st.on ? profile ? `<h3>What Dearly noticed</h3><ul class="dy-dna">${describeStyle(profile).map((l) => `<li>${esc(l)}</li>`).join("")}</ul><p class="note">From ${src.length} ${src.length === 1 ? "entry" : "entries"}${st.since ? ` written since ${esc(prettyDate(st.since).date)}` : ""}.</p>`
        : `<p class="note">Write ${MIN_STYLE - src.length} more ${MIN_STYLE - src.length === 1 ? "entry" : "entries"} yourself and Dearly starts matching your style.</p>` : ""}
      ${excluded.length ? `<details class="dy-excl"><summary>${excluded.length} ${excluded.length === 1 ? "entry is" : "entries are"} left out of style learning</summary>
        <ul>${excluded.map((e) => `<li><a href="#diary/read/${esc(e.id)}">${esc(titleOf(e))}</a> <small>${esc(e.date)}</small> <button type="button" class="mini" data-dy="include" data-id="${esc(e.id)}">Use again</button></li>`).join("")}</ul></details>` : ""}
      <p class="note">To leave one entry out, tick "Don't use this entry to learn my writing style" when you write or edit it.</p>
      <div class="actions"><button type="button" data-dy="reset">Reset my writing style</button></div>
    </section>
    <section class="panel" aria-labelledby="dyPrivTitle" data-title="Privacy and your data">
      <h2 id="dyPrivTitle">Privacy and your data</h2>
      <ul class="dy-priv">
        <li><b>Your entries</b> are saved in this journal's private database (Google Firebase), where only your family login can read them, with a copy on this device so it works offline.</li>
        <li><b>The writer on this device</b> runs on its graphics chip. Your notes never leave it. The only thing downloaded is the model itself, once.</li>
        <li><b>The cloud writer</b> (only if you pick it) sends that entry's notes, plus About you and your style if they're on, to the family's own server on Modal. It writes the entry and keeps nothing. No AI company sees it.</li>
        <li><b>Shared login:</b> both of you sign in with the same family password, so each of you could open the other's diary. Nobody outside the family can.</li>
        <li><b>No tracking:</b> no ads, no analytics, nothing about your diary is logged.</li>
        <li><b>Photos</b> are made smaller on this device and saved with the entry.</li>
      </ul>
      <div class="actions"><button type="button" data-dy="export">Download ${esc(p.name)}'s diary as text</button></div>
      <p class="note">For a full backup you can load back in, use Backup (round button, then ⋯). It includes the diary.</p>
      <div class="lbl"><span>Paper colour on this device</span><div class="chips">${Object.entries(PAPERS).map(([k, v]) => `<button type="button" class="chip" data-paper="${k}" aria-pressed="${paperNow === k}">${v}</button>`).join("")}</div></div>
    </section>
    <section class="panel" aria-labelledby="dyBinTitle" data-title="Recently deleted">
      <h2 id="dyBinTitle">Recently deleted</h2>
      ${deleted.length ? `<p class="note">Deleted entries stay here for 30 days, then go for good.</p><ul class="dy-bin">${deleted.map((e) => `<li><div><b>${esc(titleOf(e))}</b><small>${esc(prettyDate(e.date).date)}</small></div><span class="btns"><button type="button" class="mini" data-dy="restore" data-id="${esc(e.id)}">Restore</button><button type="button" class="mini" data-dy="gone" data-id="${esc(e.id)}">Delete forever</button></span></li>`).join("")}</ul>`
        : `<p class="note">Nothing here. Deleted entries wait here for 30 days, so a slip of the finger can be undone.</p>`}
    </section>`;
  paintAiPage();
  if (!device) probe();
}

// The model status and buttons on this page, redrawn while a download runs.
export function paintAiPage() {
  const host = $("dyAiPage"), acts = $("dyAiActs"); if (!host) return;
  if ($("dyAiWhere")) $("dyAiWhere").innerHTML = S.modelUi === "cloud-ask" ? cloudAskHtml() : whereHtml() + styleHtml();
  const key = aiKey(), m = ai.modelOf(key);
  let s = "";
  if (!device || device.checking) s = `<p class="note">Checking this device…</p>`;
  else if (!device.ok) s = `<div class="dy-box"><p><b>Not available on this device.</b> ${esc(ai.whyText(device.why))}</p><p class="note">The diary works fully without it. You can write yourself on this device and use the writer on another one.</p></div>`;
  else {
    const loaded = ai.isLoaded(key, device.f16);
    s = `<p class="dy-status"><span class="dy-dot ${device.downloaded ? "on" : ""}"></span>${device.downloaded ? `${esc(m.name)} model is on this device${loaded ? " and ready" : ""}.` : "Not downloaded on this device yet."}${device.soft ? " No graphics chip was found, so it will be slow." : ""}${device.memGB ? ` This device reports about ${device.memGB} GB of memory.` : ""}</p>`;
    if (aiState.phase === "download" || aiState.phase === "open") s += barHtml();
    if (aiState.msg) s += `<p class="note dy-err" role="alert">${esc(aiState.msg)}</p>`;
  }
  host.innerHTML = s;
  if (acts) acts.innerHTML = device?.ok ? `${device.downloaded
      ? `<button type="button" data-dy="test"${aiState.busy ? " disabled" : ""}>Get it ready now</button><button type="button" data-dy="remove"${aiState.busy ? " disabled" : ""}>Remove from this device</button>`
      : `<button type="button" class="primary" data-dy="download"${aiState.busy ? " disabled" : ""}>Download and turn on (about ${esc(sizeOf(m))})</button>`}` : "";
  storageLine();
}
async function storageLine() {
  const info = await ai.storageInfo(), acts = $("dyAiActs"); if (!info || !acts || !device?.ok) return;
  const gb = (n) => (n / 1e9).toFixed(n > 1e9 ? 1 : 2);
  let el = $("dyStore");
  if (!el) { el = document.createElement("p"); el.id = "dyStore"; el.className = "note"; acts.after(el); }
  el.textContent = `This site uses ${gb(info.used)} GB of this device's storage. ${info.kept ? "The browser has agreed to keep it." : "The browser may clear it if space runs low."}`;
}

function exportText() {
  const p = person(), es = live(mine()).sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
  const txt = `${p.name}'s diary\nSaved ${prettyDate(today()).date}\n\n` + es.map((e) => {
    const pd = prettyDate(e.date);
    return [`${pd.day}, ${pd.date}`, e.title ? e.title : "", isMood(e.mood) ? `Mood: ${MOODS[e.mood].word}` : "", (e.tags || []).length ? `Tags: ${e.tags.join(", ")}` : "", "", e.body.trim()].filter((x, i) => x || i === 4).join("\n");
  }).join("\n\n— — —\n\n");
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([txt], { type: "text/plain;charset=utf-8" }));
  a.download = `dearly-${p.name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "-")}-${today()}.txt`;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

// Paper colour of the whole diary view, per device.
export function paper() { $("diary").dataset.paper = store.get("journal-paper", "cream"); }

// ---------- events (dispatched from diaryui.js) ----------
const saveStyle = (fields) => S.commit(() => setDoc(doc(S.styleCol, pid()), fields, { merge: true }));
const strip = ({ id, ...rest }) => rest;

export function click(ev) {
  const pap = ev.target.closest("button[data-paper]"); // #diary itself carries data-paper, so match the buttons only
  if (!pap) return false;
  store.set("journal-paper", pap.dataset.paper); paper();
  $("diary").querySelectorAll("[data-paper]").forEach((b) => b.setAttribute("aria-pressed", b === pap));
  return true;
}

export const actions = {
  async remove() {
    aiState.busy = true; paintAiPage();
    try { await ai.remove(aiKey(), device.f16); device.downloaded = false; aiState.msg = ""; } catch (_) { aiState.msg = "Couldn't remove it. Try again."; }
    aiState.busy = false; paintAiPage();
  },
  include: (b) => S.commit(() => updateDoc(doc(S.diaryCol, b.dataset.id), { noStyle: false })),
  async reset() {
    const ok = await confirmDelete({ title: "Reset your writing style?", yes: "Reset style", note: "Nothing is deleted. Your entries all stay.",
      body: "<p>Dearly starts learning fresh from today. Entries written before today stop being used for your style.</p>" });
    if (!ok) return;
    S.styles[pid()] = { ...styleOf(), since: today() }; renderSettings();
    await saveStyle({ on: !!styleOf().on, since: today() });
  },
  export: exportText,
  "sugg-add": (b) => suggestion(b, true),
  "sugg-no": (b) => suggestion(b, false),
  async about() {
    const about = $("dyAbout").value.trim().slice(0, ABOUT_MAX);
    S.styles[pid()] = { ...styleOf(), about };
    S.aboutMsg = about ? "Saved. The writer will use it from your next entry." : "Cleared."; $("dyAboutMsg").textContent = S.aboutMsg;
    await saveStyle({ about });
  },
  async restore(b) { const e = find(b.dataset.id); if (e) { delete e.deleted; renderSettings(); await S.commit(() => setDoc(doc(S.diaryCol, e.id), strip(e))); } },
  async gone(b) {
    const e = find(b.dataset.id); if (!e) return;
    const n = (e.photos || []).length;
    const ok = await confirmDelete({ title: `Delete "${titleOf(e)}" forever?`, yes: "Delete forever",
      body: `<p>The entry for ${esc(prettyDate(e.date).date)}${n ? ` and its ${n} photo${n === 1 ? "" : "s"}` : ""} goes for good.</p>` });
    if (ok) { S.list = S.list.filter((x) => x.id !== e.id); renderSettings(); await removeForever(e); }
  },
};

// "Add" or "Not now" on a suggestion for About you.
async function suggestion(b, add) {
  const li = b.closest("li[data-key]"), key = li.dataset.key, x = suggestions().find((y) => y.key === key); if (!x) return;
  const st = styleOf();
  if (!add) {
    const dismissed = [...(st.dismissed || []), key].slice(-50);
    S.styles[pid()] = { ...st, dismissed }; renderSettings();
    await saveStyle({ dismissed });
    return;
  }
  let line = x.line;
  if (x.kind === "ask") {
    const v = li.querySelector(".dy-sugin").value.trim();
    if (!v) { li.querySelector(".dy-sugin").focus(); return; }
    line = v.toLowerCase().includes(x.name.toLowerCase()) ? v : `${x.name}: ${v}`; // "my wife" -> "Lina: my wife."
    if (!/[.!?]$/.test(line)) line += ".";
  }
  const about = addToAbout(st.about, line);
  if (about == null) { S.aboutMsg = "About you is full. Shorten it a little, then add this."; renderSettings(); return; }
  // "Words you use" and "language" are asked once; names can each be asked about.
  const dismissed = x.kind === "add" ? [...(st.dismissed || []), key].slice(-50) : st.dismissed || [];
  S.styles[pid()] = { ...st, about, dismissed }; S.aboutMsg = "Added to About you."; renderSettings();
  await saveStyle({ about, dismissed });
}

export async function change(t) {
  if (t.name === "dyModel") {
    store.set("journal-ai-model", t.value);
    if (device?.ok) device.downloaded = await ai.isDownloaded(t.value, device.f16);
    aiState.msg = ""; paintAiPage();
  }
  if (t.id === "dyStyleOn") {
    const on = t.checked; S.styles[pid()] = { ...styleOf(), on }; renderSettings();
    const body = { on }; if (styleOf().since) body.since = styleOf().since;
    await S.commit(() => setDoc(doc(S.styleCol, pid()), body, { merge: true }));
  }
}
