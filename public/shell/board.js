// Card boards: lets the family arrange a journal's cards on their phone, like home-screen widgets.
// Each card (any element with data-card="<id>" inside `host`, which is a CSS grid) has a place and a size:
// Small (half a row: one number that answers one question), Medium (the everyday part) or Large (everything).
// Sizes change what a card shows, not just how big it is: the journal's own code draws each size, asking
// sizeOf(id). Tapping a small or medium card's "More" opens it large for now (peek), "Show less" puts it back.
// "Arrange cards" in `bar` shows ↑ ↓ and S / M / L on every card. The layout is kept per device in
// localStorage "journal-board-<key>". Order is CSS `order`, so cards are never moved in the DOM and
// redraws (innerHTML) never fight it; a MutationObserver puts the controls back after a redraw.
// A card can say data-force="l" while it shows a form, so the form always gets the full width.
// Order and row-filling rules are pure, in logic/board.js.
import { esc } from "../core/util.js";
import { toast } from "../core/toast.js";
import { resolve, move, resize, merge, spans, sizeOf as sizeFor, allowed } from "../logic/board.js";

const NAMES = { s: "Small", m: "Medium", l: "Large" };
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
const titleOf = (el) => (el.dataset.title || el.querySelector("h2, h3")?.textContent || "card").replace(/\s+/g, " ").trim();

export function makeBoard({ host, bar, key, defaults, sizes = {}, redraw }) {
  const KEY = `journal-board-${key}`;
  let saved = store.get(KEY, []);
  if (!Array.isArray(saved)) saved = [];
  let arranging = false, queued = false;
  const peek = new Set();
  const cfg = () => ({ defaults, saved, sizes });

  const sizeOf = (id) => (peek.has(id) ? "l" : sizeFor(id, cfg()));
  const cards = () => [...host.querySelectorAll("[data-card]")].filter((el) => !el.hidden && !el.parentElement?.closest("[hidden]"));
  const find = (id) => cards().find((el) => el.dataset.card === id);
  const layoutNow = () => resolve(cards().map((el) => el.dataset.card), cfg());
  const cols = () => Math.max(1, getComputedStyle(host).gridTemplateColumns.split(" ").filter(Boolean).length);

  function apply() {
    queued = false;
    const els = new Map(cards().map((el) => [el.dataset.card, el]));
    const layout = resolve([...els.keys()], cfg());
    const shown = layout.map((x) => els.get(x.id).dataset.force || (peek.has(x.id) ? "l" : x.size));
    const sp = spans(shown, cols());
    layout.forEach((x, i) => {
      const el = els.get(x.id);
      if (el.style.order !== String(i + 1)) el.style.order = i + 1;
      if (el.style.gridColumn !== `span ${sp[i]}`) el.style.gridColumn = `span ${sp[i]}`;
      if (el.dataset.size !== shown[i]) el.dataset.size = shown[i];
      controls(el, x, i, layout.length);
    });
  }
  const later = () => { if (!queued) { queued = true; requestAnimationFrame(apply); } };

  // The ↑ ↓ and size buttons at the top of each card while arranging. Rebuilt only when something changed,
  // so the observer that calls apply() never loops.
  function controls(el, x, i, n) {
    let c = el.querySelector(":scope > .bd-ctl");
    if (!arranging) { c?.remove(); return; }
    const ok = allowed(sizes, x.id), sig = `${i}|${n}|${x.size}|${ok.join("")}`;
    if (c && c.dataset.sig === sig) return;
    if (!c) { c = document.createElement("div"); c.className = "bd-ctl"; c.setAttribute("role", "group"); el.prepend(c); }
    const t = esc(titleOf(el)), id = esc(x.id);
    c.dataset.sig = sig;
    c.setAttribute("aria-label", `Arrange ${titleOf(el)}`);
    c.innerHTML = `<span class="bd-mv">
        <button type="button" data-bd="up" data-id="${id}" aria-label="Move ${t} up"${i ? "" : " disabled"}>↑</button>
        <button type="button" data-bd="down" data-id="${id}" aria-label="Move ${t} down"${i < n - 1 ? "" : " disabled"}>↓</button></span>
      ${ok.length > 1 ? `<span class="bd-sz">${ok.map((s) => `<button type="button" data-bd="size" data-id="${id}" data-to="${s}" aria-pressed="${s === x.size}" aria-label="${NAMES[s]}">${s.toUpperCase()}</button>`).join("")}</span>` : `<span class="note">Full width only</span>`}`;
  }

  function paintBar() {
    bar.classList.toggle("on", arranging);
    bar.innerHTML = arranging
      ? `<p class="note">Move cards with ↑ ↓ and pick a size: S, M or L. It's kept on this phone.</p>
         <span class="bd-acts"><button type="button" class="mini" data-bd="reset">Start over</button><button type="button" class="primary" data-bd="done">Done</button></span>`
      : `<button type="button" class="mini" data-bd="arrange" aria-label="Arrange cards: move them and pick their sizes">⇅ Arrange cards</button>`;
  }

  // After a change, keep the card in view and let it glow briefly so the eye finds it.
  function settle(id) {
    apply();
    const el = find(id); if (!el) return;
    // A card that grew past the screen shows from its top, else it just comes into view.
    const tall = el.getBoundingClientRect().height > innerHeight * 0.8;
    el.scrollIntoView({ block: tall ? "start" : "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
    el.classList.remove("bd-moved"); void el.offsetWidth; el.classList.add("bd-moved");
    setTimeout(() => el.classList.remove("bd-moved"), 1200);
  }
  const keep = (layout) => { saved = merge(saved, layout); store.set(KEY, saved); };

  function click(ev) {
    const b = ev.target.closest("[data-bd]"); if (!b || !host.contains(b)) return;
    const a = b.dataset.bd, id = b.dataset.id;
    if (a === "arrange") { arranging = true; host.classList.add("arranging"); paintBar(); apply(); }
    if (a === "done") { arranging = false; host.classList.remove("arranging"); paintBar(); apply(); toast("Cards arranged. Kept on this phone."); }
    if (a === "reset") { saved = []; store.set(KEY, saved); peek.clear(); redraw(); apply(); toast("Back to the starting layout."); }
    if (a === "up" || a === "down") { keep(move(layoutNow(), id, a === "up" ? -1 : 1)); settle(id); }
    if (a === "size") { keep(resize(layoutNow(), id, b.dataset.to)); peek.delete(id); redraw(); settle(id); }
    if (a === "peek") { peek.add(id); redraw(); settle(id); }
    if (a === "less") { peek.delete(id); redraw(); settle(id); }
  }

  function start() {
    paintBar();
    host.addEventListener("click", click);
    new MutationObserver(later).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "data-force"] });
    addEventListener("resize", later);
    apply();
  }

  // For the journal's own drawing code: a small card's whole face opens it; "More" and "Show less" buttons.
  const tile = (id, inner, label) => `<button type="button" class="bd-tile" data-bd="peek" data-id="${esc(id)}" aria-label="${esc(label)}: show more">${inner}</button>`;
  const more = (id, label = "More") => `<button type="button" class="mini bd-more" data-bd="peek" data-id="${esc(id)}">${esc(label)}</button>`;
  const less = (id) => (peek.has(id) ? `<button type="button" class="mini bd-less" data-bd="less" data-id="${esc(id)}">Show less</button>` : "");
  return { start, sizeOf, tile, more, less, apply: later };
}
