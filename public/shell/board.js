// Card boards: lets the family arrange a journal's cards on their phone, like home-screen widgets.
// Each card (any element with data-card="<id>" inside `host`, which is a CSS grid) has a place and a size:
// Small (half a row: one number that answers one question), Medium (the everyday part) or Large (everything).
// Sizes change what a card shows, not just how big it is: the journal's own code draws each size, asking
// sizeOf(id). Tapping a small tile or a medium card's "More" pops the card out large (peek): it floats as a
// sheet over a blurred page (class bd-pop), still in its own place in the DOM, so all its buttons keep working
// and live redraws keep it current. ✕, Escape or tapping outside puts it back (outside not while a form there
// has been typed in, data-dirty). One at a time.
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
  let scrim = null, back = null; // the blur behind a popped-out card; where focus goes back to
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
      pop(el, peek.has(x.id));
      controls(el, x, i, layout.length);
    });
    // The card that was popped out is gone (deleted elsewhere, or a hash change hid it): close the blur.
    if (peek.size && ![...peek].some((id) => els.has(id))) { peek.clear(); pop(null, false); }
  }
  // A popped-out card floats over the page as a sheet; the page behind can't scroll.
  function pop(el, on) {
    if (el && el.classList.contains("bd-pop") !== on) {
      el.classList.toggle("bd-pop", on);
      if (on) { el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); }
      else { el.removeAttribute("role"); el.removeAttribute("aria-modal"); }
    }
    const any = peek.size > 0;
    scrim.hidden = !any;
    document.documentElement.classList.toggle("bd-locked", any);
  }
  function closePop() {
    if (!peek.size) return;
    const id = [...peek][0];
    peek.clear();
    host.querySelectorAll(".bd-pop").forEach((el) => pop(el, false));
    redraw(); apply();
    (back?.isConnected ? back : find(id)?.querySelector("[data-bd=peek]"))?.focus({ preventScroll: true });
    back = null;
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
    if (a === "peek") {
      back = b; peek.clear(); peek.add(id); redraw(); apply();
      const el = find(id); if (el) {
        // Slides up once; later redraws (a bill ticked as paid) don't replay it.
        el.classList.add("bd-popin"); setTimeout(() => el.classList.remove("bd-popin"), 300); el.scrollTop = 0; (el.querySelector(".bd-less") || el).focus({ preventScroll: true }); }
    }
    if (a === "less") closePop();
  }

  function start() {
    scrim = document.createElement("div");
    scrim.className = "bd-scrim"; scrim.hidden = true;
    document.body.append(scrim);
    // Tapping outside closes it, unless something's been typed in a form on the card.
    scrim.addEventListener("click", () => { if (!host.querySelector(".bd-pop [data-dirty]")) closePop(); });
    addEventListener("keydown", (ev) => { if (ev.key === "Escape" && peek.size) closePop(); });
    addEventListener("hashchange", () => { if (peek.size) closePop(); });
    paintBar();
    host.addEventListener("click", click);
    // Straight away (before the browser paints), so a redrawn popped-out card never flashes back into the page.
    new MutationObserver(() => apply()).observe(host, { childList: true, subtree: true, attributes: true, attributeFilter: ["hidden", "data-force"] });
    addEventListener("resize", later);
    apply();
  }

  // For the journal's own drawing code: a small card's whole face opens it; "More" and "Show less" buttons.
  const tile = (id, inner, label) => `<button type="button" class="bd-tile" data-bd="peek" data-id="${esc(id)}" aria-label="${esc(label)}: show more">${inner}</button>`;
  const more = (id, label = "More") => `<button type="button" class="mini bd-more" data-bd="peek" data-id="${esc(id)}">${esc(label)}</button>`;
  const less = (id) => (peek.has(id) ? `<button type="button" class="mini bd-less" data-bd="less" data-id="${esc(id)}" aria-label="Close">✕</button>` : "");
  return { start, sizeOf, tile, more, less, apply: later, close: closePop };
}
