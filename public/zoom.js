// Zoom any graph (every `.chart svg` in the app). Phones: pinch with two fingers, drag with one finger once zoomed,
// double-tap to go back. Computers: Ctrl + scroll (or a trackpad pinch) zooms at the pointer, drag to look around,
// double-click zooms in or back out. A "Reset" button shows while zoomed.
// It only changes the SVG's viewBox, so charts need no changes of their own; anything that turns a pointer into chart
// coordinates (tooltips) goes through toChart() / toScreen(). Charts are redrawn with innerHTML (new data, a resize), so
// the zoom is remembered by the chart's id and put back on the new drawing when it has the same size.

const CHARTS = "#app .chart svg";
const MAX = 5;
const kept = new Map(); // chart host id → { s, x, y, W, H }

function view(svg) {
  const v = svg.viewBox.baseVal, W = svg.width.baseVal.value, H = svg.height.baseVal.value;
  return { x: v ? v.x : 0, y: v ? v.y : 0, s: v && v.width ? W / v.width : 1, W, H };
}
// Pointer → chart units (what the chart drew with), and chart units → pixels inside the chart's box.
export function toChart(svg, ev) {
  const r = svg.getBoundingClientRect(), v = view(svg);
  return { x: (ev.clientX - r.left) / v.s + v.x, y: (ev.clientY - r.top) / v.s + v.y };
}
export function toScreen(svg, x, y) {
  const v = view(svg);
  return { x: (x - v.x) * v.s, y: (y - v.y) * v.s };
}

function set(svg, s, x, y) {
  const { W, H } = view(svg);
  s = Math.min(MAX, Math.max(1, s));
  if (s < 1.02) { s = 1; x = 0; y = 0; }
  const w = W / s, h = H / s;
  x = Math.min(W - w, Math.max(0, x)); y = Math.min(H - h, Math.max(0, y));
  svg.setAttribute("viewBox", `${x} ${y} ${w} ${h}`);
  const host = svg.parentElement, zoomed = s > 1;
  if (host.id) { if (zoomed) kept.set(host.id, { s, x, y, W, H }); else kept.delete(host.id); }
  svg.classList.toggle("zoomed", zoomed);
  svg.style.setProperty("--z", s); // styles.css keeps the words their normal size
  const tip = host.querySelector(".tip"); if (tip) tip.hidden = true; // it would point at the old spot
  let btn = host.querySelector(":scope > .zreset");
  if (zoomed && !btn) {
    btn = document.createElement("button");
    btn.type = "button"; btn.className = "zreset"; btn.textContent = "Reset zoom";
    btn.addEventListener("click", (ev) => { ev.stopPropagation(); set(svg, 1, 0, 0); });
    host.append(btn);
  } else if (!zoomed && btn) btn.remove();
}
// Zoom by k, keeping the point under (px, py) (pixels inside the chart) in place.
function zoomAt(svg, k, px, py) {
  const v = view(svg), ux = px / v.s + v.x, uy = py / v.s + v.y, s = Math.min(MAX, Math.max(1, v.s * k));
  set(svg, s, ux - px / s, uy - py / s);
}
const local = (svg, x, y) => { const r = svg.getBoundingClientRect(); return { x: x - r.left, y: y - r.top }; };
const isZoomed = (svg) => svg.classList.contains("zoomed");

export function initZoom() {
  new MutationObserver(() => {
    for (const [id, k] of kept) {
      const svg = document.getElementById(id)?.querySelector(":scope > svg");
      if (!svg || svg.classList.contains("zoomed")) continue;
      const v = view(svg);
      if (v.W === k.W && v.H === k.H) set(svg, k.s, k.x, k.y); else kept.delete(id);
    }
  }).observe(document.getElementById("app"), { childList: true, subtree: true });

  // Touch: two fingers pinch (and move), one finger drags once zoomed, a double tap goes back.
  let pinch = null, pan = null, lastTap = { t: 0, svg: null }, lastTouch = 0;
  document.addEventListener("touchstart", (ev) => {
    lastTouch = Date.now();
    const svg = ev.target.closest?.(CHARTS);
    if (!svg) return;
    if (ev.touches.length === 2) {
      ev.preventDefault();
      const [a, b] = ev.touches, mid = local(svg, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2), v = view(svg);
      pinch = { svg, d: Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) || 1, s: v.s, ux: mid.x / v.s + v.x, uy: mid.y / v.s + v.y };
      pan = null;
    } else if (ev.touches.length === 1) {
      const t = ev.touches[0], now = Date.now();
      if (isZoomed(svg) && lastTap.svg === svg && now - lastTap.t < 300) { ev.preventDefault(); set(svg, 1, 0, 0); lastTap.t = 0; return; }
      lastTap = { t: now, svg };
      pan = isZoomed(svg) ? { svg, sx: t.clientX, sy: t.clientY, v: view(svg) } : null;
    }
  }, { passive: false });
  document.addEventListener("touchmove", (ev) => {
    if (pinch && ev.touches.length >= 2) {
      ev.preventDefault();
      const [a, b] = ev.touches, svg = pinch.svg, mid = local(svg, (a.clientX + b.clientX) / 2, (a.clientY + b.clientY) / 2);
      const s = Math.min(MAX, Math.max(1, pinch.s * Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / pinch.d));
      set(svg, s, pinch.ux - mid.x / s, pinch.uy - mid.y / s);
      lastTap.t = 0;
    } else if (pan && ev.touches.length === 1) {
      ev.preventDefault();
      const t = ev.touches[0], { svg, v } = pan, dx = t.clientX - pan.sx, dy = t.clientY - pan.sy;
      if (Math.abs(dx) + Math.abs(dy) > 6) lastTap.t = 0;
      set(svg, v.s, v.x - dx / v.s, v.y - dy / v.s);
    }
  }, { passive: false });
  const end = (ev) => {
    if (ev.touches.length < 2) pinch = null;
    if (ev.touches.length === 0) pan = null;
  };
  document.addEventListener("touchend", end);
  document.addEventListener("touchcancel", end);

  // Computer: Ctrl + scroll (a trackpad pinch arrives as this too) zooms at the pointer.
  let hinted = false;
  document.addEventListener("wheel", (ev) => {
    const svg = ev.target.closest?.(CHARTS);
    if (!svg) return;
    if (!ev.ctrlKey) {
      if (!hinted && !isZoomed(svg)) { hinted = true; hint(svg, "Ctrl + scroll to zoom"); }
      return;
    }
    ev.preventDefault();
    const dy = ev.deltaMode === 1 ? ev.deltaY * 30 : ev.deltaY, p = local(svg, ev.clientX, ev.clientY);
    zoomAt(svg, Math.exp(-Math.max(-60, Math.min(60, dy)) * 0.01), p.x, p.y);
  }, { passive: false });

  // Mouse drag to look around while zoomed.
  let drag = null;
  document.addEventListener("pointerdown", (ev) => {
    if (ev.pointerType !== "mouse" || ev.button !== 0) return;
    const svg = ev.target.closest?.(CHARTS);
    if (svg && isZoomed(svg)) { drag = { svg, sx: ev.clientX, sy: ev.clientY, v: view(svg) }; ev.preventDefault(); }
  });
  addEventListener("pointermove", (ev) => {
    if (!drag) return;
    const { svg, v } = drag;
    set(svg, v.s, v.x - (ev.clientX - drag.sx) / v.s, v.y - (ev.clientY - drag.sy) / v.s);
  });
  addEventListener("pointerup", () => { drag = null; });

  // Double-click: zoom in there, or back out when already zoomed.
  document.addEventListener("dblclick", (ev) => {
    if (Date.now() - lastTouch < 800) return; // phones use double-tap above
    const svg = ev.target.closest?.(CHARTS);
    if (!svg) return;
    ev.preventDefault();
    if (isZoomed(svg)) set(svg, 1, 0, 0);
    else { const p = local(svg, ev.clientX, ev.clientY); zoomAt(svg, 2.5, p.x, p.y); }
  });
}

function hint(svg, text) {
  const host = svg.parentElement;
  if (host.querySelector(":scope > .zhint")) return;
  const el = document.createElement("div");
  el.className = "zhint"; el.textContent = text;
  host.append(el);
  setTimeout(() => el.remove(), 1800);
}
