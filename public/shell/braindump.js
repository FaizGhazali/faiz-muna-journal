// Brain dump (✎ above the wheel button, and the home-screen shortcut /#idea): a sheet over whatever page is open,
// one box and Bug / Improve / Idea chips. Saving adds it to the signed-in person's Ideas (Activities inbox) and
// you stay exactly where you were. Typing is kept per device until it's saved (localStorage journal-dump-draft).
import { collection, doc, setDoc } from "../core/fs.js";
import { selfId } from "../core/owner.js";
import { journalView } from "../core/journal.js";
import { $, today } from "../core/util.js";
import { DUMP_KINDS, DEFAULT_KIND, dumpDoc } from "../logic/braindump.js";

const DRAFT = "journal-dump-draft", KIND = "journal-dump-kind", HASH = "#idea";
const get = (k) => { try { return localStorage.getItem(k) || ""; } catch (_) { return ""; } };
const put = (k, v) => { try { v ? localStorage.setItem(k, v) : localStorage.removeItem(k); } catch (_) {} };

let col, commit, kind = DEFAULT_KIND, from = "";

export function initBrainDump(opts) {
  ({ commit } = opts);
  col = collection(opts.db, "activities");
  kind = DUMP_KINDS[get(KIND)] ? get(KIND) : DEFAULT_KIND;
  $("dumpBtn").addEventListener("click", openDump);
  const sheet = $("dumpSheet");
  // Tapping outside closes it; what's typed stays as a draft for next time.
  sheet.addEventListener("click", (ev) => { if (ev.target === sheet) sheet.close(); });
  // The home-screen shortcut opens the app at /#idea: show the sheet once the journal is on screen.
  // Underneath it is the page you were last on ("journal-page", see showView() in activities.js).
  const fromHash = (ev) => {
    if (location.hash !== HASH) return;
    if (ev && history.length > 1) history.back(); // reached in-app: back to the page it was typed over
    else { let last = ""; try { last = JSON.parse(localStorage.getItem("journal-page")) || ""; } catch (_) {} history.replaceState(null, "", location.pathname + location.search + last); }
    whenAppShows(openDump);
  };
  addEventListener("hashchange", fromHash);
  fromHash();
}

function whenAppShows(fn) {
  const app = $("app");
  if (!app.hidden) return fn();
  const obs = new MutationObserver(() => { if (!app.hidden) { obs.disconnect(); setTimeout(fn, 300); } });
  obs.observe(app, { attributes: true, attributeFilter: ["hidden"] });
}

function openDump() {
  const sheet = $("dumpSheet");
  if (sheet.open || !selfId()) return;
  from = location.hash || "#" + journalView(); // where the thought came up, shown under it in Ideas
  sheet.innerHTML = `<form class="gsin dump" id="dumpForm" novalidate data-form>
    <div class="gshead"><span class="gico big" aria-hidden="true">✎</span>
      <div><p class="eyebrow">Brain dump</p><h3 id="dumpTitle">What's on your mind?</h3></div></div>
    <div class="chips" role="group" aria-label="What is it?">${Object.entries(DUMP_KINDS).map(([k, v]) =>
      `<button type="button" class="chip" data-kind="${k}" aria-pressed="${k === kind}">${v.icon} ${v.label}</button>`).join("")}</div>
    <label class="sr" for="dumpText">Your note</label>
    <textarea id="dumpText" rows="3" maxlength="1200" placeholder="e.g. Ledger: the Save button jumps when the keyboard opens" enterkeyhint="done"></textarea>
    <p class="note dhint">Enter saves · Shift + Enter for a new line. It goes to your Ideas.</p>
    <p class="msg" id="dumpMsg" role="status"></p>
    <div class="actions"><button type="submit" class="primary">Save to Ideas</button><button type="button" data-close>Close</button></div>
  </form>`;
  const box = $("dumpText"), form = $("dumpForm");
  box.value = get(DRAFT);
  box.addEventListener("input", () => { put(DRAFT, box.value); $("dumpMsg").textContent = ""; });
  box.addEventListener("keydown", (ev) => { if (ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); form.requestSubmit(); } });
  form.addEventListener("click", (ev) => {
    const chip = ev.target.closest("[data-kind]");
    if (chip) {
      kind = chip.dataset.kind; put(KIND, kind);
      form.querySelectorAll("[data-kind]").forEach((c) => c.setAttribute("aria-pressed", String(c === chip)));
      box.focus(); return;
    }
    if (ev.target.closest("[data-close]")) sheet.close();
  });
  form.addEventListener("submit", save);
  sheet.showModal();
  box.focus();
  box.setSelectionRange(box.value.length, box.value.length);
}

async function save(ev) {
  ev.preventDefault();
  const box = $("dumpText"), data = dumpDoc({ text: box.value, kind, owner: selfId(), from, day: today(), now: Date.now() });
  if (!data) { $("dumpMsg").textContent = "Type something first."; box.focus(); return; }
  const btn = ev.target.querySelector(".primary");
  btn.disabled = true;
  try {
    await commit(() => setDoc(doc(col), data), `${DUMP_KINDS[data.dump].icon} Saved to your Ideas.`);
    put(DRAFT, "");
    $("dumpSheet").close();
  } catch (_) {
    btn.disabled = false; // the error toast has shown; the note stays as typed
  }
}
