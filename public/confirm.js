// The one delete prompt for the whole app (see .claude/skills/safe-delete/SKILL.md).
// confirmDelete({ title, body, yes }) opens a sheet and resolves true only when the red button is tapped.
// "Keep" has the focus, so Enter, Esc, tapping outside or the back gesture all keep the thing.
// `title` and `yes` are plain text (escaped here); `body` is HTML, so callers esc() anything user-typed in it.
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
let sheet = null, settle = null;

export function confirmDelete({ title, body = "", yes = "Delete" }) {
  if (!sheet) {
    sheet = document.createElement("dialog");
    sheet.className = "gsheet cdel";
    sheet.setAttribute("aria-labelledby", "cdelTitle");
    sheet.addEventListener("close", () => { const s = settle; settle = null; s?.(sheet.returnValue === "yes"); });
    sheet.addEventListener("click", (ev) => { if (ev.target === sheet) sheet.close("no"); }); // tap on the dimmed backdrop
    document.body.append(sheet);
  }
  if (settle) { settle(false); settle = null; } // an older prompt still open: it keeps
  sheet.innerHTML = `<form method="dialog" class="gsin">
    <h2 id="cdelTitle">${esc(title)}</h2>
    ${body ? `<div class="cdel-body">${body}</div>` : ""}
    <p class="note">This can't be undone.</p>
    <div class="actions"><button value="no" class="primary" autofocus>Keep</button><button value="yes" class="danger">${esc(yes)}</button></div>
  </form>`;
  sheet.returnValue = "";
  return new Promise((resolve) => {
    settle = resolve;
    if (!sheet.open) sheet.showModal();
    sheet.querySelector('button[value="no"]').focus();
  });
}
