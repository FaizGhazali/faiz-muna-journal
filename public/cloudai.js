// Dearly's cloud writer: the family's own Modal server (modal/dearly_writer.py), for phones whose graphics chip can't
// run the writer. Free: Modal's monthly free credit, with a $0 spending limit. The model is open (Qwen2.5-7B).
// Family writes send a sign-in token and the full prompt to /write. The demo has no sign-in: it sends only the notes to
// /demo, which builds its own prompt and is capped per visitor and per day. Nothing is stored on the server.

// The address `modal deploy modal/dearly_writer.py` prints. Empty = the cloud writer is hidden.
export const CLOUD_URL = "";

// A Modal address, or a localhost stand-in while developing.
export const cloudReady = () => /^(https:\/\/[a-z0-9-]+\.modal\.run|http:\/\/localhost:\d+)\/?$/.test(CLOUD_URL);
const base = () => CLOUD_URL.replace(/\/$/, "");

async function post(path, body, token, signal) {
  const headers = { "Content-Type": "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  const r = await fetch(base() + path, { method: "POST", headers, body: JSON.stringify(body || {}), signal });
  if (!r.ok) {
    let detail = "";
    try { detail = (await r.json()).detail || ""; } catch (_) {}
    throw Object.assign(new Error(`cloud-${r.status}`), { status: r.status, detail });
  }
  return r;
}

// Write, calling onText with everything so far. token = family sign-in; null = demo (notes only).
export async function cloudWrite({ token, messages, notes, signal }, onText) {
  const r = token ? await post("/write", { messages }, token, signal) : await post("/demo", { notes: String(notes).slice(0, 600) }, null, signal);
  const reader = r.body.getReader(), dec = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += dec.decode(value, { stream: true });
    onText(out);
  }
  return out + dec.decode();
}

// Wake the GPU in the background so the first write is quicker (family only; the demo wakes it by writing).
export function cloudWarm(token) { if (cloudReady() && token) post("/warm", {}, token).catch(() => {}); }
// Demo writes this visitor has left today, or null if unknown.
export async function demoLeft() {
  try { return (await (await post("/demo-left", {})).json()).left; } catch (_) { return null; }
}

export function cloudErrorText(e, demo) {
  const s = e?.status;
  if (s === 401 || s === 403) return "The cloud writer only works when you're signed in to the journal. Sign out and back in, then try again.";
  if (s === 429) return demo ? "The demo's cloud writer has had its turns for today. Try again tomorrow, or write it yourself." : "That's a lot of writing this hour. Try again in a little while.";
  if (s === 413 || s === 400) return demo ? "Keep the notes under 600 characters for the demo." : "Those notes are too long for the cloud writer. Shorten them a little.";
  if (s >= 500) return "The cloud writer is having trouble or is out of free credit for this month. Try again later, or write it yourself.";
  return navigator.onLine ? "Couldn't reach the cloud writer. Try again in a moment." : "The cloud writer needs the internet. You can still write it yourself.";
}
