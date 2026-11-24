// Smooth changes after a tap (decided 24 Nov 2026: "don't just pop out"). When a tap opens or closes something
// (an Edit form, "All bills", Show all…), the card it's in grows or shrinks to its new height instead of
// jumping, its new content fades in, and a form that appears slides in. Pages are redrawn with innerHTML, so
// this watches the DOM; only changes within WINDOW_MS of a tap or key press move, so live updates from the
// other phone never animate. Cards folding (core/collapse.js) have their own animation and are left alone.
// Calm, not rushed (24 Nov 2026: 280 ms felt too quick): sizes ease over DUR, forms slide in over FORM_MS.
const WINDOW_MS = 900, DUR = 460, FORM_MS = 420, FADE_MS = 380, EASE = "cubic-bezier(.16, 1, .3, 1)";
const CARDS = "#app .view .panel, #app .person, dialog[open]";
const ENTER = "[data-form], form, .lpbform, .editor"; // things that open
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

let tapAt = -1e9, queued = false, unpin = 0;
let anchor = null; // { key, top }: the card that was tapped and where its top was, so it stays put on screen
let cards = new Map(); // card key -> { h, folded } at the tap (updated after each step, so chained redraws ease on)
let forms = new Set(); // keys of the forms already open at the tap: only new ones slide in
const added = new Set();

const keyOf = (f) => `${f.dataset.form || f.id || f.className}@${f.closest("[data-card]")?.dataset.card || f.closest("[id]")?.id || ""}`;
const visible = (el) => el.getClientRects().length > 0;
// Many cards are rebuilt by a redraw, so a card is known by its data-card or id (else by the element itself).
const cardKey = (el) => (el.dataset.card ? `c:${el.dataset.card}` : el.id ? `#${el.id}` : el);

export function initMotion() {
  if (!Element.prototype.animate) return;
  document.addEventListener("pointerdown", snap, true);
  document.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") snap(); }, true);
  new MutationObserver((recs) => {
    if (performance.now() - tapAt > WINDOW_MS || reduced()) return;
    for (const r of recs) for (const n of r.addedNodes) if (n.nodeType === 1) added.add(n);
    if (!queued) { queued = true; requestAnimationFrame(play); }
  }).observe(document.body, { childList: true, subtree: true });
}

function snap(e) {
  tapAt = performance.now();
  // The browser keeps whatever is below a changing card still on screen ("scroll anchoring"), so a card that
  // grew seemed to grow upwards while the view stayed at its bottom. For a tap, the tapped card's top stays put
  // instead and it grows downwards: anchoring is off until the change has eased in.
  document.documentElement.style.overflowAnchor = "none";
  clearTimeout(unpin); unpin = setTimeout(() => { document.documentElement.style.overflowAnchor = ""; }, WINDOW_MS + DUR + 100);
  const card = e?.target?.closest?.(CARDS);
  anchor = card && getComputedStyle(card).position !== "fixed" ? { key: cardKey(card), top: card.getBoundingClientRect().top } : null;
  cards = new Map();
  for (const el of document.querySelectorAll(CARDS)) if (visible(el)) cards.set(cardKey(el), { h: el.getBoundingClientRect().height, sh: el.scrollHeight, folded: el.classList.contains("folded") });
  forms = new Set([...document.querySelectorAll(ENTER)].filter(visible).map(keyOf));
}

function play() {
  queued = false;
  const grown = [];
  // Put the tapped card's top back where it was if anything moved it (a redraw above it, a list that shrank).
  const at = anchor && [...document.querySelectorAll(CARDS)].find((el) => cardKey(el) === anchor.key);
  if (at && visible(at) && getComputedStyle(at).position !== "fixed") {
    const moved = at.getBoundingClientRect().top - anchor.top;
    if (Math.abs(moved) > 1) scrollBy(0, moved);
  }
  for (const el of document.querySelectorAll(CARDS)) {
    const k = cardKey(el), was = cards.get(k);
    if (!was || !visible(el) || el.classList.contains("folded") !== was.folded) continue;
    // Still easing from an earlier step: carry on from where it is on screen, else from the height at the tap.
    const running = el.getAnimations().filter((x) => x.id === "mo-h"), start = running.length ? el.getBoundingClientRect().height : was.h;
    running.forEach((x) => x.cancel());
    const to = el.getBoundingClientRect().height, sh = el.scrollHeight;
    cards.set(k, { ...was, h: to, sh });
    if (Math.abs(sh - was.sh) >= 6) grown.push(el); // its content changed size (a popped-out card scrolls instead of growing)
    if (Math.abs(to - start) < 6) continue;
    el.style.overflow = "clip"; el.style.overflowClipMargin = "24px"; // the fold knob sits on the top edge
    const a = el.animate([{ height: `${start}px` }, { height: `${to}px` }], { duration: DUR, easing: EASE });
    a.id = "mo-h";
    a.onfinish = a.oncancel = () => { el.style.overflow = ""; el.style.overflowClipMargin = ""; };
    if (!grown.includes(el)) grown.push(el);
  }
  for (const n of added) {
    if (!n.isConnected) continue;
    // A form that wasn't open before slides in; other new content in a card that changed size fades in.
    const fs = [...(n.matches(ENTER) ? [n] : []), ...n.querySelectorAll(ENTER)].filter((f) => !forms.has(keyOf(f)));
    fs.forEach((f) => { forms.add(keyOf(f)); f.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: FORM_MS, easing: EASE }); });
    if (!fs.length && grown.some((c) => c !== n && c.contains(n))) n.animate([{ opacity: 0 }, { opacity: 1 }], { duration: FADE_MS, easing: "ease-out" });
  }
  added.clear();
}
