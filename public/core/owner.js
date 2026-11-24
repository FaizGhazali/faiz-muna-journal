// Who is signed in on this phone, and so what they may change. Each person changes only their own things
// (weight entries, mood, activities and habits, meals and watch burns, their diary, their Ledger spending,
// their birthday); the other person's show read-only. Shared things (Stocky, foods and meal sets, the Ledger
// plan, cards and bills) both can change. app.js calls setSelf() after sign-in (the demo plays the first person).
import { esc } from "./util.js";

let self = null, nameOf = () => "";

export function setSelf(pid, name = () => "") { self = pid || null; nameOf = name; }
export const selfId = () => self;
// Nobody known yet (still starting up) = nothing is locked.
export const canEdit = (pid) => !self || pid === self;

// The field that says whose a doc is, per collection. firestore.rules enforces the same list: keep them in step.
// Docs keyed by person id (diaryStyle, nextMove, accounts, prefs) are theirs by id. Ledger items with no spentBy are anyone's.
export const OWNED = { entries: "person", activities: "owner", habitDays: "owner", moves: "owner", meals: "person", burns: "person",
  diary: "person", diaryPhotos: "person", ledgerTxns: "spentBy" };
const BY_ID = ["diaryStyle", "nextMove", "accounts", "prefs"];
export function mayWrite(col, id, body) {
  if (BY_ID.includes(col)) return canEdit(id);
  const f = OWNED[col], v = f && body?.[f];
  return !f || (f === "spentBy" && !v) || canEdit(v);
}

// The line shown where the edit controls would be: "Muna's mood. Only Muna can change it."
export function viewOnly(pid, what) {
  const n = esc(nameOf(pid) || "They");
  return `<p class="viewonly" role="note"><span aria-hidden="true">👀</span> ${n}'s ${esc(what)}. Only ${n} can change ${what.endsWith("s") ? "them" : "it"}.</p>`;
}
