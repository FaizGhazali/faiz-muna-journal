// Each person has their own login. Pure rules only (no Firebase, no DOM); tests in tests/account.test.mjs.
// The sign-in form asks for a password only: the app tries it on each person's login and the one it opens
// says who signed in. So the two passwords must be different.

export const PERSON_IDS = ["p1", "p2"];
export const MIN_PASSWORD = 8;
const DOMAIN = "journal.invalid"; // login names only; no mail is ever sent

export const emailOf = (pid) => `${pid}@${DOMAIN}`;
// "p1@journal.invalid" → "p1"; any other login → null.
export function personOf(email) {
  const m = /^(p\d)@journal\.invalid$/i.exec(email || "");
  return m && PERSON_IDS.includes(m[1].toLowerCase()) ? m[1].toLowerCase() : null;
}

// Who to try first: the person last signed in on this device, then the other.
export function tryOrder(last) {
  return PERSON_IDS.includes(last) ? [last, ...PERSON_IDS.filter((p) => p !== last)] : [...PERSON_IDS];
}

// Firebase answers a wrong password on an existing login with one of these, so try the next person.
const WRONG = new Set(["auth/invalid-credential", "auth/invalid-login-credentials", "auth/wrong-password", "auth/user-not-found", "auth/invalid-email"]);
export const isWrongPassword = (code) => WRONG.has(code);

// The first-time password: "" when it's fine, else what to fix (plain words for the form).
export function checkNewPassword(pw, again, old) {
  if (!pw) return "Type a new password.";
  if (pw.length < MIN_PASSWORD) return `Use at least ${MIN_PASSWORD} characters.`;
  if (old && pw === old) return "Pick a password different from the one you were given.";
  if (pw !== again) return "The two passwords don't match.";
  return "";
}
