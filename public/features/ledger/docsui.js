// Ledger: receipts and documents on an entry (#ldSheet, a <dialog class="gsheet"> outside #ledger), opened by
// The paperclip on a Recent item or a paid bill. Take a photo or choose any file (several at once); each goes to the
// family's OneDrive (shell/onedrive.js) under a name and folder from logic/docs.js, and the entry keeps a link
// (`docs` on ledgerTxns / ledgerPaid). Adding later is the point: open the entry any time and add the official
// receipt. Removing takes away the link only; the file stays in OneDrive. Only your own entries can be changed.
import { doc, updateDoc, arrayUnion, arrayRemove } from "../../core/fs.js";
import { $, esc } from "../../core/util.js";
import { confirmDelete } from "../../core/confirm.js";
import { docPlan, docIcon, DOCS_MAX } from "../../logic/docs.js";
import { available, connected, connect, finishSignIn, shrink, upload } from "../../shell/onedrive.js";
import { toast } from "../../core/toast.js";
import { ico } from "../../core/icons.js";

const REOPEN = "journal-docs-reopen"; // the entry to come back to after connecting OneDrive (this tab only)
let ctx, cur = null, busy = "", msg = "", pending = null, uploaded = [];

export const docsOn = () => available();

export function initDocs(c) {
  ctx = c;
  const sheet = $("ldSheet");
  sheet.addEventListener("click", (ev) => {
    if (ev.target === sheet && !busy) return close();
    const b = ev.target.closest("button"); if (!b) return;
    if (b.dataset.ld === "close") close();
    if (b.dataset.ld === "retry") add(pending ? [pending] : []);
    if (b.dataset.ld === "connect") { try { sessionStorage.setItem(REOPEN, JSON.stringify({ coll: cur.coll, id: cur.id })); } catch (_) {} connect(location.hash); }
    if (b.dataset.ld === "remove") remove(Number(b.dataset.i));
  });
  sheet.addEventListener("change", (ev) => { if (ev.target.matches("input[type=file]") && ev.target.files.length) add([...ev.target.files]); });
  sheet.addEventListener("close", () => { if (!sheet.open) close(); });
  sheet.addEventListener("cancel", (ev) => { if (busy) ev.preventDefault(); }); // Escape doesn't stop an upload halfway
  addEventListener("hashchange", () => { if (!busy) close(); });
}

// Back from Microsoft's sign-in: say so, and reopen the entry once its data has loaded (ledgerui asks with `find`).
export async function afterSignIn() {
  const r = await finishSignIn();
  if (r?.result === "connected") toast("OneDrive connected.");
  if (r?.result === "failed") toast(r.why);
}
export function resumeDocs(find) {
  let want; try { want = JSON.parse(sessionStorage.getItem(REOPEN) || "null"); } catch (_) {}
  if (!want || !connected()) return;
  const e = find(want.coll, want.id); if (!e) return;
  try { sessionStorage.removeItem(REOPEN); } catch (_) {}
  openDocs(e);
}

// e: { coll, id, kind, date, what, amountSen, person, docs, canEdit, title }
export function openDocs(e, file = null) {
  if (busy) return;
  pending = file; uploaded = [];
  cur = { ...e, docs: [...(e.docs ?? [])] }; msg = "";
  paint();
  const d = $("ldSheet"); if (!d.open) d.showModal();
  if (pending && connected()) add([pending]);
}
// The live data changed (the other phone, or our own save): keep the sheet's list current.
export function refreshDocs(find) {
  if (!cur || busy || !$("ldSheet").open) return;
  const e = find(cur.coll, cur.id);
  if (!e) return close();
  cur = { ...cur, ...e, docs: [...(e.docs ?? [])] }; paint();
}
function close() { cur = null; pending = null; uploaded = []; busy = ""; const d = $("ldSheet"); if (d.open) d.close(); d.innerHTML = ""; }

function paint() {
  const e = cur, full = e.docs.length >= DOCS_MAX;
  const retry = uploaded.length || pending;
  $("ldSheet").innerHTML = `<div class="gsin">
    <div class="mhead"><h3 id="ldSheetTitle">Receipts and documents</h3><button type="button" class="mini lsx" data-ld="close" aria-label="Close"${busy ? " disabled" : ""}>✕</button></div>
    <p class="note">${esc(e.title)}</p>
    ${e.docs.length ? `<ul class="ldlist">${e.docs.map((x, i) => `<li>
      <a href="${esc(x.url)}" target="_blank" rel="noopener">${ico(docIcon(x.type))}<span><b>${esc(x.name)}</b><small>${esc(x.path.split("/").slice(0, -1).join(" › "))}</small></span></a>
      ${e.canEdit ? `<button type="button" class="mini" data-ld="remove" data-i="${i}" aria-label="Remove ${esc(x.name)}"${busy ? " disabled" : ""}>Remove</button>` : ""}
    </li>`).join("")}</ul>` : `<p class="note">Nothing yet. ${e.canEdit ? "Add the receipt now, or come back any time." : ""}</p>`}
    ${!e.canEdit ? "" : !connected() && !uploaded.length ? `<p class="note">Files go to your OneDrive, in Apps › Our Journal › Ledger, named for you.</p>
      <div class="actions"><button type="button" class="primary" data-ld="connect">Connect OneDrive</button></div>`
      : retry ? `<p class="note">${pending ? `Income saved &middot; ${esc(pending.name)}` : "File uploaded. Save its link to this entry."}</p>
        <div class="actions"><button type="button" class="primary" data-ld="retry"${busy ? " disabled" : ""}>Retry attachment</button></div>`
      : full ? `<p class="note">That's ${DOCS_MAX} files, the most for one entry.</p>`
      : `<div class="actions ldadd">
        <label class="btn primary${busy ? " disabled" : ""}">${ico("camera")} Take a photo<input type="file" accept="image/*" capture="environment" hidden${busy ? " disabled" : ""}></label>
        <label class="btn${busy ? " disabled" : ""}">${ico("folder")} Choose files<input type="file" multiple hidden${busy ? " disabled" : ""}></label>
      </div>
      <p class="note">Photos, PDFs or any document. Photos are made smaller so they upload quickly; PDFs and other files stay as they are.</p>`}
    <p class="msg" aria-live="polite">${esc(busy || msg)}</p>
  </div>`;
}

async function add(files) {
  const e = cur; if (!e || busy) return;
  const room = DOCS_MAX - e.docs.length, list = files.slice(0, room);
  msg = "";
  try {
    for (const [n, file] of (uploaded.length ? [] : list).entries()) {
      const spec = { file, income: e.coll === "ledgerIncome", date: e.date, kind: e.kind, what: e.what, amountSen: e.amountSen, person: e.person };
      const of = list.length > 1 ? ` (${n + 1} of ${list.length})` : "";
      busy = `Getting it ready${of}…`; paint();
      let plan = docPlan(spec), blob = file;
      if (plan.shrink) { blob = await shrink(file); if (blob === file) plan = docPlan({ ...spec, asIs: true }); } // the name always matches what's sent
      busy = `Uploading${of}…`; paint();
      const item = await upload(blob, plan.path, (p) => { busy = `Uploading${of}… ${Math.round(p * 100)}%`; const m = $("ldSheet").querySelector(".msg"); if (m) m.textContent = busy; });
      uploaded.push({ ...item, folder: plan.folder, type: plan.type, at: Date.now(), by: ctx.me() });
    }
  } catch (err) {
    msg = err.connect ? "OneDrive needs you to connect again." : err.message || "That didn't upload. Check your connection and try again.";
  }
  if (uploaded.length) {
    busy = "Saving attachment link.";
    paint();
    const added = uploaded;
    try {
      await ctx.commit(() => updateDoc(doc(ctx.db(), e.coll, e.id), { docs: arrayUnion(...added), updated: Date.now() }),
        added.length === 1 ? `Saved to OneDrive: ${added[0].name}` : `${added.length} files saved to OneDrive.`);
      pending = null;
      uploaded = [];
      if (cur === e) { cur.docs = [...e.docs.filter((x) => !added.some((item) => item.id === x.id)), ...added]; if (!msg) msg = files.length > room ? `Only ${room} more fit on one entry.` : ""; }
    } catch (_) { msg = "Uploaded, but the link didn't save. Try again."; }
  }
  busy = "";
  if (cur) paint();
}

// Takes the link off the entry; the file stays in OneDrive (safe-delete: it asks first).
async function remove(i) {
  const e = cur, x = e?.docs[i]; if (!x || busy) return;
  const ok = await confirmDelete({ title: `Remove ${x.name}?`, body: `<p>It comes off this entry. The file stays in your OneDrive, in ${esc(x.path.split("/").slice(0, -1).join(" › "))}.</p>`, yes: "Remove", note: "You can add it again any time." });
  if (!ok || cur !== e) return;
  const docs = e.docs.filter((_, j) => j !== i);
  try {
    await ctx.commit(() => updateDoc(doc(ctx.db(), e.coll, e.id), { docs: arrayRemove(x), updated: Date.now() }), "Removed from this entry.");
    cur.docs = docs; msg = ""; paint();
  } catch (_) {}
}
