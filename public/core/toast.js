// Short "it worked" / "it didn't" notes that slide up above the wheel button and go away on their own.
// toast(text, { kind: "ok" | "error" | "info", ms }) — one at a time; a new one replaces the old.
// Errors stay until tapped (ms: 0 by default for errors). Read out by screen readers (role="status" / "alert").
const ICONS = { ok: "✓", error: "!", info: "i" };
const OK_MS = 3200;
let host = null, timer = 0;

function ensureHost() {
  if (host?.isConnected) return host;
  host = document.createElement("div");
  host.className = "toasts";
  document.body.append(host);
  host.addEventListener("click", (ev) => { if (ev.target.closest(".toast")) hide(); });
  return host;
}

export function toast(text, { kind = "ok", ms = kind === "error" ? 0 : OK_MS } = {}) {
  if (!text) return;
  const h = ensureHost();
  clearTimeout(timer);
  const el = document.createElement("div");
  el.className = `toast is-${kind}`;
  el.setAttribute("role", kind === "error" ? "alert" : "status");
  el.innerHTML = `<span class="toasticon" aria-hidden="true"></span><span class="toasttext"></span><button type="button" class="toastx" aria-label="Dismiss">✕</button>`;
  el.querySelector(".toasticon").textContent = ICONS[kind] ?? ICONS.info;
  el.querySelector(".toasttext").textContent = text; // textContent: safe for anything typed by the family
  h.replaceChildren(el);
  requestAnimationFrame(() => el.classList.add("in"));
  if (ms > 0) timer = setTimeout(hide, ms);
}

export function hide() {
  clearTimeout(timer);
  const el = host?.querySelector(".toast"); if (!el) return;
  el.classList.remove("in");
  setTimeout(() => el.remove(), 220);
}
