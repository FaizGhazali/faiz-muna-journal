// OneDrive for the family's documents (receipts, bills, payslips): sign in with Microsoft and upload into the
// app's own folder, Apps/Our Journal (scope Files.ReadWrite.AppFolder, so the app can't see anything else there).
// No library and no server: the standard sign-in for a web app (authorization code + PKCE) straight from the
// phone, then Microsoft Graph. Names and folders come from logic/docs.js. Setup: docs/onedrive-setup.md.
//
// CLIENT_ID empty = the feature is hidden (like the cloud writer's CLOUD_URL). The demo never connects.
// Tokens stay on this phone (localStorage "journal-onedrive"); Microsoft keeps a web app signed in for about a
// day, after which the next upload asks to connect again. The file never touches Firestore.
import { DEMO } from "./demo.js";
import { SIMPLE_MAX, fitSize } from "../logic/docs.js";

export const CLIENT_ID = "74f1dd19-aec4-4814-a0a6-3122cd8dd330"; // the app's "Application (client) ID" from Microsoft Entra (docs/onedrive-setup.md)
const AUTH = "https://login.microsoftonline.com/common/oauth2/v2.0";
const GRAPH = "https://graph.microsoft.com/v1.0/me/drive/special/approot";
const SCOPE = "Files.ReadWrite.AppFolder offline_access";
const KEY = "journal-onedrive", PENDING = "journal-onedrive-pkce";
const CHUNK = 10 * 320 * 1024; // pieces for a big file (a multiple of 320 KiB, as OneDrive asks)

const redirect = () => `${location.origin}/`;
const store = {
  get(k, s = localStorage) { try { return JSON.parse(s.getItem(k) || "null"); } catch (_) { return null; } },
  set(k, v, s = localStorage) { try { v == null ? s.removeItem(k) : s.setItem(k, JSON.stringify(v)); } catch (_) {} },
};

// Shown at all? (set up, not the demo)
export const available = () => !!CLIENT_ID && !DEMO;
// Connected on this phone? (a token, or a refresh token to get one)
export const connected = () => !!store.get(KEY)?.refresh;

// ---------- sign in ----------
const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const random = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));

// Goes to Microsoft's sign-in page; it comes back to this page (finishSignIn) and then to `back` (a hash).
export async function connect(back = location.hash) {
  const verifier = random(48), state = random(16);
  const challenge = b64url(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)));
  store.set(PENDING, { verifier, state, back }, sessionStorage);
  const q = new URLSearchParams({
    client_id: CLIENT_ID, response_type: "code", redirect_uri: redirect(), scope: SCOPE, state,
    code_challenge: challenge, code_challenge_method: "S256", prompt: "select_account",
  });
  location.assign(`${AUTH}/authorize?${q}`);
}

// Called once when the app opens: if Microsoft just sent us back with a code, swap it for tokens.
// Returns "connected", "failed" (with the reason) or null when this wasn't a sign-in return.
export async function finishSignIn() {
  const q = new URLSearchParams(location.search), p = store.get(PENDING, sessionStorage);
  if (!p || !(q.has("code") || q.has("error"))) return null;
  store.set(PENDING, null, sessionStorage);
  history.replaceState(null, "", `${location.pathname}${p.back || ""}`); // the code never stays in the address bar
  dispatchEvent(new HashChangeEvent("hashchange")); // back to the page it started on
  if (q.get("state") !== p.state) return { result: "failed", why: "The sign-in didn't match. Try again." };
  if (q.has("error")) return { result: "failed", why: q.get("error") === "access_denied" ? "OneDrive wasn't connected." : "Microsoft sign-in didn't finish. Try again." };
  try {
    await tokenFrom({ grant_type: "authorization_code", code: q.get("code"), code_verifier: p.verifier, redirect_uri: redirect() });
    return { result: "connected" };
  } catch (e) { return { result: "failed", why: e.message }; }
}

async function tokenFrom(params) {
  const r = await fetch(`${AUTH}/token`, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: CLIENT_ID, scope: SCOPE, ...params }) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) {
    if (params.grant_type === "refresh_token") store.set(KEY, null); // expired: connect again
    throw new Error("OneDrive needs you to connect again.");
  }
  store.set(KEY, { access: j.access_token, refresh: j.refresh_token ?? params.refresh_token, until: Date.now() + (j.expires_in - 120) * 1000 });
  return j.access_token;
}

async function token() {
  const t = store.get(KEY);
  if (!t?.refresh) throw Object.assign(new Error("Connect OneDrive first."), { connect: true });
  if (t.access && t.until > Date.now()) return t.access;
  try { return await tokenFrom({ grant_type: "refresh_token", refresh_token: t.refresh }); }
  catch (e) { throw Object.assign(e, { connect: true }); }
}

// Forget OneDrive on this phone (the files stay in OneDrive).
export const disconnect = () => store.set(KEY, null);

// ---------- upload ----------
const enc = (path) => path.split("/").map(encodeURIComponent).join("/");

// A phone photo redrawn at most SHRINK_PX on its longest side, as JPEG. The original if the browser can't open it.
export async function shrink(file) {
  try {
    const bmp = await createImageBitmap(file);
    const { w, h } = fitSize(bmp.width, bmp.height), c = document.createElement("canvas");
    c.width = w; c.height = h; c.getContext("2d").drawImage(bmp, 0, 0, w, h); bmp.close?.();
    const blob = await new Promise((ok) => c.toBlob(ok, "image/jpeg", 0.85));
    return blob && blob.size < file.size ? blob : file;
  } catch (_) { return file; }
}

// Uploads `blob` to `path` (inside the app folder); OneDrive adds " 1" to the name if it's taken.
// onProgress(0..1). Returns { id, name, path, size, url }.
export async function upload(blob, path, onProgress = () => {}) {
  const auth = { Authorization: `Bearer ${await token()}` };
  let item;
  if (blob.size <= SIMPLE_MAX) {
    const r = await fetch(`${GRAPH}:/${enc(path)}:/content?@microsoft.graph.conflictBehavior=rename`, { method: "PUT", headers: { ...auth, "Content-Type": blob.type || "application/octet-stream" }, body: blob });
    if (!r.ok) throw await failed(r);
    item = await r.json();
  } else {
    const s = await fetch(`${GRAPH}:/${enc(path)}:/createUploadSession`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({ item: { "@microsoft.graph.conflictBehavior": "rename" } }) });
    if (!s.ok) throw await failed(s);
    const { uploadUrl } = await s.json();
    for (let at = 0; at < blob.size; at += CHUNK) {
      const end = Math.min(at + CHUNK, blob.size);
      const r = await fetch(uploadUrl, { method: "PUT", headers: { "Content-Range": `bytes ${at}-${end - 1}/${blob.size}` }, body: blob.slice(at, end) });
      if (!r.ok) throw await failed(r);
      onProgress(end / blob.size);
      if (end === blob.size) item = await r.json();
    }
  }
  onProgress(1);
  const folder = path.split("/").slice(0, -1).join("/");
  return { id: item.id, name: item.name, path: `${folder}/${item.name}`, size: item.size ?? blob.size, url: item.webUrl ?? "" };
}

async function failed(r) {
  if (r.status === 401) { const t = store.get(KEY); if (t) store.set(KEY, { ...t, until: 0 }); }
  const j = await r.json().catch(() => ({}));
  const why = r.status === 401 ? "OneDrive needs you to connect again." : r.status === 507 ? "Your OneDrive is full." : j.error?.message || `OneDrive said no (${r.status}).`;
  return Object.assign(new Error(why), { connect: r.status === 401 });
}
