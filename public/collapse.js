// Fold any card: hold the round button at its top right until the ring fills; tap a folded card to open it.
// Which cards are folded is kept per device in localStorage "journal-folded". A tutorial card explains it
// until the person ticks "Got it" ("journal-foldhint").
// Cards are often redrawn with innerHTML, so a MutationObserver puts the button and the folded state back.

const $ = (id) => document.getElementById(id);
const CARDS = "#app .view .panel, #app .person";
const HOLD_MS = 550;
const FOLDED_H = 62;

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

const BTN = `<svg viewBox="0 0 36 36" aria-hidden="true"><circle class="ftrack" cx="18" cy="18" r="16"/><circle class="fring" cx="18" cy="18" r="16" pathLength="100"/><path class="fchev" d="M12 15.5l6 6 6-6"/></svg>`;

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
    if (el.classList.contains("folded") !== on) el.classList.toggle("folded", on);
    const label = on ? "Folded card. Tap to open" : "Hold to fold this card";
    if (b.getAttribute("aria-label") !== label) { b.setAttribute("aria-label", label); b.setAttribute("aria-expanded", String(!on)); }
  });
}

function setFold(el, on) {
  const k = el.dataset.fold || keyOf(el);
  if (on) folded.add(k); else folded.delete(k);
  save();
  const from = el.getBoundingClientRect().height;
  el.classList.toggle("folded", on);
  scan();
  if (!reduced() && el.animate) {
    const to = on ? FOLDED_H : el.scrollHeight;
    el.style.overflow = "hidden";
    el.animate([{ maxHeight: `${from}px` }, { maxHeight: `${to}px` }], { duration: on ? 320 : 380, easing: "cubic-bezier(.2,.8,.2,1)" })
      .finished.finally(() => { el.style.overflow = ""; });
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

  // Hold to fold. A short tap only reminds you to hold, so a card never folds by accident while scrolling.
  let timer = 0, held = null, sx = 0, sy = 0;
  const stop = () => { clearTimeout(timer); held?.classList.remove("holding"); held = null; };
  app.addEventListener("pointerdown", (ev) => {
    const b = ev.target.closest(".fold");
    if (!b || ev.button > 0) return;
    const card = b.parentElement;
    if (card.classList.contains("folded")) return; // a tap opens it (click below)
    held = b; sx = ev.clientX; sy = ev.clientY;
    b.classList.add("holding");
    timer = setTimeout(() => {
      const c = held?.parentElement;
      stop();
      if (!c) return;
      navigator.vibrate?.(12);
      setFold(c, true);
      b.dataset.done = Date.now();
    }, HOLD_MS);
  });
  addEventListener("pointermove", (ev) => { if (held && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 14) stop(); });
  addEventListener("pointerup", () => {
    if (!held) return;
    const b = held; stop();
    b.classList.remove("nudge"); void b.offsetWidth; b.classList.add("nudge"); // "Hold me" bubble
    clearTimeout(b._nt); b._nt = setTimeout(() => b.classList.remove("nudge"), 1600);
  });
  addEventListener("pointercancel", stop);
  app.addEventListener("contextmenu", (ev) => { if (ev.target.closest(".fold")) ev.preventDefault(); });

  // A folded card opens with a tap anywhere on it; nothing inside it is pressed by that tap.
  app.addEventListener("click", (ev) => {
    const b = ev.target.closest(".fold");
    if (b && Date.now() - (b.dataset.done || 0) < 500) { ev.preventDefault(); ev.stopPropagation(); return; }
    const card = ev.target.closest(".folded");
    if (card) { ev.preventDefault(); ev.stopPropagation(); setFold(card, false); return; }
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
