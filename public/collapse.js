// Fold any card: hold the round knob on its top edge until the ring fills (on a phone or tablet, hold anywhere on the
// card's top row); hold or tap a folded card to open it.
// Which cards are folded is kept per device in localStorage "journal-folded". A tutorial card explains it
// until the person ticks "Got it" ("journal-foldhint").
// Cards are often redrawn with innerHTML, so a MutationObserver puts the button and the folded state back.

const $ = (id) => document.getElementById(id);
const CARDS = "#app .view .panel, #app .person";
const HOLD_MS = 550;

const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (_) { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (_) {} },
};
let folded = new Set(store.get("journal-folded", []));
const save = () => store.set("journal-folded", [...folded]);
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// A stable name for a card, so its folded state survives redraws.
function keyOf(el) {
  if (el.id) return el.id;
  const by = el.getAttribute("aria-labelledby") || el.getAttribute("aria-label");
  if (by) return by;
  if (el.classList.contains("person")) return `person-${[...el.parentElement.children].indexOf(el)}`;
  const t = el.querySelector(".fdtitle, h2, h3");
  if (t?.textContent.trim()) return `card:${t.textContent.trim().slice(0, 40)}`;
  return `${el.parentElement?.id || el.closest(".view")?.id || "x"}-${[...el.parentElement.children].indexOf(el)}`;
}

// The words shown on a folded card: its heading, else its small label, else a generic name.
function titleOf(el) {
  const label = el.getAttribute("aria-label");
  const h = el.querySelector(":scope > h2, :scope > .who h2, :scope h2, .fdtitle, h3, .eyebrow");
  const text = (h?.textContent || label || "Card").replace(/\s+/g, " ").trim();
  return text.length > 40 ? `${text.slice(0, 38)}…` : text;
}

const BTN =`<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ftrack" cx="18" cy="18" r="16"/><circle class="fring" cx="18" cy="18" r="16" pathLength="100"/><path class="fchev" d="M12 15.5l6 6 6-6"/></svg>`;

function scan() {
  document.querySelectorAll(CARDS).forEach((el) => {
    let b = el.querySelector(":scope > .fold");
    if (!b) {
      b = document.createElement("button");
      b.type = "button"; b.className = "fold"; b.innerHTML = BTN;
      el.prepend(b);
      el.classList.add("foldable");
    }
    const k = keyOf(el), on = folded.has(k);
    if (el.dataset.fold !== k) el.dataset.fold = k;
    const t = titleOf(el);
    if (el.dataset.title !== t) el.dataset.title = t;
    if (el.classList.contains("folded") !== on) el.classList.toggle("folded", on);
    const label = on ? "Folded card. Tap to open" : "Hold to fold this card";
    if (b.getAttribute("aria-label") !== label) { b.setAttribute("aria-label", label); b.setAttribute("aria-expanded", String(!on)); }
  });
}

function setFold(el, on) {
  const k = el.dataset.fold || keyOf(el);
  if (on) folded.add(k); else folded.delete(k);
  save();
  const top = el.getBoundingClientRect().top;
  el.classList.toggle("folded", on);
  scan();
  // Keep the card where it was on screen, so the page doesn't jump under your finger.
  const moved = el.getBoundingClientRect().top - top;
  if (moved) scrollBy(0, moved);
  if (!reduced() && el.animate) {
    const ease = "cubic-bezier(.2,.9,.3,1.2)";
    if (on) el.animate([{ transform: "scaleY(1.6)", transformOrigin: "top", opacity: 0.4 }, { transform: "none", transformOrigin: "top", opacity: 1 }], { duration: 320, easing: ease });
    else [...el.children].filter((c) => !c.classList.contains("fold")).forEach((c, i) =>
      c.animate([{ opacity: 0, transform: "translateY(-8px)" }, { opacity: 1, transform: "none" }], { duration: 300, delay: Math.min(i, 6) * 30, easing: "ease-out", fill: "backwards" }));
  }
  if (!on) dispatchEvent(new Event("resize")); // charts drawn while folded get their real width
}

export function initCollapse() {
  const app = $("app");
  if (!app) return;
  // Runs before the browser paints, so a redrawn card never flashes without its button. scan() only adds what's missing,
  // so its own changes settle after one more pass.
  new MutationObserver(scan).observe(app, { childList: true, subtree: true });
  scan();

  // Hold to fold, hold to open. On a phone or tablet the whole top of a card (its title row) can be held, not just the
  // knob; with a mouse only the knob. A short tap on the knob only reminds you to hold, and moving the finger (scrolling)
  // cancels, so a card never folds by accident.
  let timer = 0, card = null, sx = 0, sy = 0, swallowUntil = 0;
  const stop = () => { clearTimeout(timer); card?.classList.remove("pressing"); card?.querySelector(":scope > .fold")?.classList.remove("holding"); card = null; };
  const ACTIVE = "button:not(.fold), a, input, select, textarea, label, summary, [contenteditable], .chart, canvas";
  // How far down a card counts as its top: the first row of content, at least 56px, at most 120px.
  function inTop(c, y) {
    if (c.classList.contains("folded")) return true;
    const top = c.getBoundingClientRect().top;
    const first = [...c.children].find((x) => !x.classList.contains("fold") && x.offsetHeight);
    const edge = first ? first.getBoundingClientRect().bottom - top + 10 : 56;
    return y - top <= Math.min(120, Math.max(56, edge));
  }
  app.addEventListener("pointerdown", (ev) => {
    if (ev.button > 0) return;
    const knob = ev.target.closest(".fold");
    const touch = ev.pointerType === "touch" || ev.pointerType === "pen";
    let c = knob?.parentElement;
    if (!c && touch) {
      c = ev.target.closest(".foldable");
      if (!c || (!c.classList.contains("folded") && ev.target.closest(ACTIVE)) || !inTop(c, ev.clientY)) c = null;
    }
    if (!c) return;
    // A folded card already opens with a tap; with the mouse there is nothing to hold.
    if (c.classList.contains("folded") && !touch) return;
    stop();
    card = c; sx = ev.clientX; sy = ev.clientY;
    c.classList.add("pressing");
    c.querySelector(":scope > .fold")?.classList.add("holding");
    timer = setTimeout(() => {
      const target = card;
      stop();
      if (!target?.isConnected) return;
      navigator.vibrate?.(12);
      swallowUntil = Date.now() + 600; // the click that follows lifting the finger does nothing
      setFold(target, !target.classList.contains("folded"));
    }, HOLD_MS);
  });
  addEventListener("pointermove", (ev) => { if (card && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 12) stop(); });
  addEventListener("pointerup", (ev) => {
    if (!card) return;
    const c = card, knob = ev.target.closest?.(".fold");
    stop();
    if (!knob || c.classList.contains("folded")) return;
    knob.classList.remove("nudge"); void knob.offsetWidth; knob.classList.add("nudge"); // "Hold me" bubble
    clearTimeout(knob._nt); knob._nt = setTimeout(() => knob.classList.remove("nudge"), 1600);
  });
  addEventListener("pointercancel", stop);
  addEventListener("scroll", () => { if (card) stop(); }, { passive: true });
  // No text selection or long-press menu while holding a card's top.
  app.addEventListener("contextmenu", (ev) => { if (ev.target.closest(".fold, .pressing, .folded")) ev.preventDefault(); });

  // A folded card also opens with a tap anywhere on it; nothing inside it is pressed by that tap.
  app.addEventListener("click", (ev) => {
    if (Date.now() < swallowUntil && ev.target.closest(".foldable")) { ev.preventDefault(); ev.stopPropagation(); swallowUntil = 0; return; }
    const b = ev.target.closest(".fold");
    const folded = ev.target.closest(".folded");
    if (folded) { ev.preventDefault(); ev.stopPropagation(); setFold(folded, false); return; }
    if (b && ev.detail === 0) setFold(b.parentElement, true); // keyboard: Enter / Space folds at once
  }, true);

  initHint();
}

// ---------- the tutorial card ----------
function initHint() {
  const h = $("foldHint");
  if (!h) return;
  if (store.get("journal-foldhint", false)) { h.remove(); return; }
  h.hidden = false;
  $("foldGot").addEventListener("change", (ev) => {
    if (!ev.target.checked) return;
    store.set("journal-foldhint", true);
    h.classList.add("bye");
    const done = () => h.remove();
    if (reduced()) done(); else setTimeout(done, 650);
  });
}
