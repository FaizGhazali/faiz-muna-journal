// Each person's own login (rules in logic/account.js). The sign-in form asks for a password only; signIn()
// tries it on each person's login and the one that opens says who it is. The first time someone signs in
// they must pick their own password (#newpass) before the journal opens; accounts/{person} → { person,
// changed, updated } records that they did (delete that doc to ask them again).
import { signInWithEmailAndPassword, updatePassword, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { doc, getDoc, setDoc } from "../core/fs.js";
import { emailOf, personOf, tryOrder, isWrongPassword, checkNewPassword } from "../logic/account.js";
import { $ } from "../core/util.js";
import { toast } from "../core/toast.js";

const LAST = "journal-login"; // per device: who signed in here last, tried first next time
let typed = ""; // the password just typed at sign-in, kept in memory only so the new one can't be the same

export { personOf };

// Signs in whoever owns this password. Throws the Firebase error (wrong password, too many tries, offline).
export async function signIn(auth, password) {
  let last = null;
  try { last = localStorage.getItem(LAST); } catch (_) {}
  let wrong;
  for (const pid of tryOrder(last)) {
    try {
      const cred = await signInWithEmailAndPassword(auth, emailOf(pid), password);
      typed = password;
      try { localStorage.setItem(LAST, pid); } catch (_) {}
      return cred.user;
    } catch (e) {
      if (!isWrongPassword(e.code)) throw e;
      wrong = e;
    }
  }
  throw wrong;
}

// True when this person still has to choose their own password. Offline with nothing cached: don't lock them out.
export async function mustChoosePassword(db, pid) {
  try { return !(await getDoc(doc(db, "accounts", pid))).data()?.changed; } catch (_) { return false; }
}

// Shows the "choose your own password" screen; resolves once it's saved.
export function choosePassword({ auth, db, pid, name, show }) {
  $("npHello").textContent = name ? `Hi ${name}` : "Welcome";
  $("np1").value = $("np2").value = "";
  $("npMsg").textContent = "";
  show("newpass");
  $("np1").focus();
  return new Promise((done) => {
    const form = $("newPassForm");
    form.onsubmit = async (ev) => {
      ev.preventDefault();
      const pw = $("np1").value, msg = $("npMsg");
      msg.textContent = checkNewPassword(pw, $("np2").value, typed);
      if (msg.textContent) return;
      $("npSave").disabled = true;
      try {
        await updatePassword(auth.currentUser, pw);
      } catch (e) {
        $("npSave").disabled = false;
        if (e.code === "auth/requires-recent-login") {
          await signOut(auth);
          $("loginMsg").textContent = "Sign in again, then choose your password.";
          return;
        }
        msg.textContent = e.code === "auth/network-request-failed" ? "No connection. Check your internet and try again."
          : e.code === "auth/weak-password" ? "That password is too easy to guess. Try a longer one."
          : "That didn't work. Try again.";
        return;
      }
      typed = "";
      const now = Date.now();
      setDoc(doc(db, "accounts", pid), { person: pid, changed: now, updated: now }, { merge: true }).catch((e) => console.error(e));
      $("npSave").disabled = false;
      $("np1").value = $("np2").value = "";
      toast("Password saved. Only you know it now.");
      done();
    };
  });
}

export function initAccount({ auth }) {
  $("npShow").addEventListener("change", (ev) => { ["np1", "np2"].forEach((id) => { $(id).type = ev.target.checked ? "text" : "password"; }); });
  $("npOut").addEventListener("click", () => { typed = ""; signOut(auth); });
}
