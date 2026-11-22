// Zoom a graph into its data: pinching (phones) or Ctrl + scroll / trackpad pinch (computers) narrows the dates (or kg)
// along the bottom, and the chart redraws just that stretch with its side scale fitted to the points in view, so small
// changes become readable. One finger (or the mouse) drags along the time line once zoomed; double-tap, double-click
// or "Reset zoom" shows everything again.
// A chart opts in by calling zoomable(host, plotLeft, plotRight, redraw) after drawing, and reads xWindow(host) —
// the visible part of its full range as fractions { a, b } of 0..1 — while drawing. The window is kept by host id, so
// it survives redraws.

const wins = new Map(); // chart host id → { a, b }
const MIN = 0.03;       // narrowest window: 3% of the whole range

export const xWindow = (host) => wins.get(host.id) || { a: 0, b: 1 };
export const isZoomed = (host) => wins.has(host.id);

export function zoomable(host, l, r, redraw) {
  host._zoom = { l, r, redraw };
  const on = isZoomed(host);
  host.classList.toggle("zoomed", on);
  if (on && !host.querySelector(":scope > .zreset")) {
    const btn = document.createElement("button");
    btn.type = "button"; btn.className = "zreset"; btn.textContent = "Reset zoom";
    btn.addEventListener("click", (ev) => { ev.stopPropagation(); apply(host, 0, 1); });
    host.append(btn);
  }
}

let frame = 0, pending = null;
function apply(host, a, b) {
  const w = Math.max(MIN, Math.min(1, b - a));
  a = Math.max(0, Math.min(1 - w, a));
  if (w > 0.995) wins.delete(host.id); else wins.set(host.id, { a, b: a + w });
  pending = host;
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; const h = pending; pending = null; h?._zoom?.redraw(); });
}
// Where clientX falls across the plot, 0..1.
function frac(host, clientX) {
  const z = host._zoom, r = host.getBoundingClientRect();
  return Math.max(0, Math.min(1, (clientX - r.left - z.l) / Math.max(1, z.r - z.l)));
}
function zoomAt(host, k, clientX) {
  const { a, b } = xWindow(host), f = frac(host, clientX), at = a + f * (b - a);
  const w = Math.max(MIN, Math.min(1, (b - a) / k));
  apply(host, at - f * w, at - f * w + w);
}
const hostOf = (el) => { const h = el?.closest?.("#app .chart"); return h && h._zoom && el.closest("svg") ? h : null; };

export function initZoom() {
  // Touch. The chart is redrawn while the fingers move, which takes the touched element out of the page; touch events
  // keep going to that element, so the move / end listeners sit on it rather than on the document.
  let g = null, lastTap = { t: 0, host: null };
  const move = (ev) => {
    if (!g) return;
    const host = g.host, t = ev.touches;
    if (g.pinch && t.length >= 2) {
      ev.preventDefault();
      const d = Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1;
      const w = Math.max(MIN, Math.min(1, g.w * g.d / d)), f = frac(host, (t[0].clientX + t[1].clientX) / 2);
      apply(host, g.at - f * w, g.at - f * w + w);
      lastTap.t = 0;
    } else if (!g.pinch && t.length === 1) {
      ev.preventDefault();
      const z = host._zoom, dx = t[0].clientX - g.x, s = g.a - dx / Math.max(1, z.r - z.l) * g.w;
      if (Math.abs(dx) > 6) lastTap.t = 0;
      apply(host, s, s + g.w);
    }
  };
  const end = (ev) => {
    if (!g) return;
    if (ev.touches.length === 0) {
      g.els.forEach((el) => { el.removeEventListener("touchmove", move); el.removeEventListener("touchend", end); el.removeEventListener("touchcancel", end); });
      g = null;
    } else if (g.pinch && ev.touches.length < 2) {
      const { a, b } = xWindow(g.host);
      Object.assign(g, { pinch: false, x: ev.touches[0].clientX, a, w: b - a });
    }
  };
  const listen = (el) => {
    if (g.els.has(el)) return;
    g.els.add(el);
    el.addEventListener("touchmove", move, { passive: false }); el.addEventListener("touchend", end); el.addEventListener("touchcancel", end);
  };
  document.addEventListener("touchstart", (ev) => {
    const host = hostOf(ev.target);
    if (!host) return;
    const t = ev.touches, { a, b } = xWindow(host);
    if (t.length >= 2) {
      ev.preventDefault();
      const f = frac(host, (t[0].clientX + t[1].clientX) / 2);
      g = { host, els: g?.els || new Set(), pinch: true, d: Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY) || 1, w: b - a, at: a + f * (b - a) };
      for (const x of t) listen(x.target);
    } else if (t.length === 1) {
      const now = Date.now();
      if (isZoomed(host) && lastTap.host === host && now - lastTap.t < 300) { ev.preventDefault(); lastTap.t = 0; apply(host, 0, 1); return; }
      lastTap = { t: now, host };
      if (!isZoomed(host)) return; // not zoomed: the page scrolls and taps work as always
      g = { host, els: new Set(), pinch: false, x: t[0].clientX, a, w: b - a };
      listen(t[0].target);
    }
  }, { passive: false });

  // Computer: Ctrl + scroll (a trackpad pinch arrives as this too) zooms at the pointer.
  let hinted = false, lastTouch = 0;
  document.addEventListener("touchend", () => { lastTouch = Date.now(); });
  document.addEventListener("wheel", (ev) => {
    const host = hostOf(ev.target);
    if (!host) return;
    if (!ev.ctrlKey) { if (!hinted && !isZoomed(host)) { hinted = true; hint(host, "Ctrl + scroll to zoom"); } return; }
    ev.preventDefault();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 30 : ev.deltaY;
    zoomAt(host, Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.01), ev.clientX);
  }, { passive: false });

  // Mouse drag along the time line while zoomed.
  let drag = null;
  document.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "mouse" || ev.button !== 0) return;
    const host = hostOf(ev.target);
    if (host && isZoomed(host)) { const { a, b } = xWindow(host); drag = { host, x: ev.clientX, a, w: b - a }; ev.preventDefault(); }
  });
  addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const z = drag.host._zoom, s = drag.a - (ev.clientX - drag.x) / Math.max(1, z.r - z.l) * drag.w;
    apply(drag.host, s, s + drag.w);
  });
  addEventListener("pointerup", () => { drag = null; });

  // Double-click: zoom in there, or back out when already zoomed.
  document.addEventListener("dblclick", (ev) => {
    if (Date.now() - lastTouch < 800) return; // phones use double-tap above
    const host = hostOf(ev.target);
    if (!host) return;
    ev.preventDefault();
    if (isZoomed(host)) apply(host, 0, 1); else zoomAt(host, 3, ev.clientX);
  });
}

function hint(host, text) {
  if (host.querySelector(":scope > .zhint")) return;
  const el = document.createElement("div");
  el.className = "zhint"; el.textContent = text;
  host.append(el);
  setTimeout(() => el.remove(), 1800);
}
