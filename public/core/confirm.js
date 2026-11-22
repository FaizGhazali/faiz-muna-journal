// The one delete prompt for the whole app (see .claude/skills/safe-delete/SKILL.md).
// confirmDelete({ title, body, yes, note }) opens a sheet and resolves true only when the red button is tapped.
// "Keep" has the focus, so Enter, Esc, tapping outside or the back gesture all keep the thing.
// `note` replaces "This can't be undone." when it can (a bin to restore from).
// `title`, `yes` and `note` are plain text (escaped here); `body` is HTML, so callers esc() anything user-typed in it.
import { esc } from "./util.js";
let sheet = null, settle = null;
// Resolve the open prompt once and close it.
function answer(yes) {
  const s = settle; settle = null;
  if (sheet?.open) sheet.close(yes ? "yes" : "no");
  s?.(yes);
}

export function confirmDelete({ title, body = "", yes = "Delete", note = "This can't be undone." }) {
  if (!sheet) {
    sheet = document.createElement("dialog");
    sheet.className = "gsheet cdel";
    sheet.setAttribute("aria-labelledby", "cdelTitle");
    // Answer from the tap itself, not the dialog's "close" event: some browsers skip that event, and a late
    // one could answer the next prompt.
    sheet.addEventListener("click", (ev) => {
      const b = ev.target.closest("button[value]");
      if (b) { ev.preventDefault(); answer(b.value === "yes"); }
      else if (ev.target === sheet) answer(false); // tap on the dimmed backdrop
    });
    sheet.addEventListener("cancel", (ev) => { ev.preventDefault(); answer(false); }); // Esc / back gesture
    document.body.append(sheet);
  }
  if (settle) { settle(false); settle = null; } // an older prompt still open: it keeps
  sheet.innerHTML = `<form method="dialog" class="gsin">
    <h2 id="cdelTitle">${esc(title)}</h2>
    ${body ? `<div class="cdel-body">${body}</div>` : ""}
    <p class="note">${esc(note)}</p>
    <div class="actions"><button value="no" class="primary" autofocus>Keep</button><button value="yes" class="danger">${esc(yes)}</button></div>
  </form>`;
  sheet.returnValue = "";
  sheet.querySelector("form").addEventListener("submit", (ev) => { ev.preventDefault(); answer(false); }); // Enter: Keep
  return new Promise((resolve) => {
    settle = resolve;
    if (!sheet.open) sheet.showModal();
    sheet.querySelector('button[value="no"]').focus();
  });
}
