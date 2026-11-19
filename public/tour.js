// "Show me how": a searchable list of how-tos (#guide), and walkthroughs that dim the screen, light up the one
// thing to tap and point at it with a dotted arrow. A walkthrough is a list of steps (WEIGH below). Each step names
// the part to light up (spot), what the arrow points at (point, else spot), and when it is finished:
// done() for something the person does, or a Next button. If the person wanders off (lost() stays true for
// LOST_MS), the walkthrough goes back to the step named by backTo. Nothing is saved except what the person
// saves themselves; the walkthrough only watches the page.
import { unfold } from "./collapse.js";

const $ = (id) => document.getElementById(id);
const LOST_MS = 600;
const reduced = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const wheelOpen = () => $("wheel").classList.contains("open");
const onWeight = () => !$("home").hidden;
const weightSlot = () => document.querySelector('#wheelRing .wslot[data-j="weight"]');
const form = () => $("formPanel");
const typedWeight = () => { const v = Number($("weight").value); return $("weight").value.trim() !== "" && v >= 30 && v <= 250; };

const WEIGH = [
  { title: "Open the journal menu", text: "Tap the round button in the corner. It holds all your journals.", spot: () => $("wheelBtn"), round: true, tap: "Tap here", done: wheelOpen },
  { title: "Pick Weight", text: "These are your journals. Tap Weight.", spot: weightSlot, round: true, tap: "Tap here",
    done: () => !wheelOpen() && onWeight(), lost: () => !wheelOpen() && !onWeight(), backTo: 0 },
  { title: "Find today's entry", text: "Scroll down. We'll stop at the card where your weight goes.", scroll: true, spot: form,
    enter: () => unfold(form()),
    done: () => { const r = form().getBoundingClientRect(); return r.height > 0 && (r.top < innerHeight * 0.55 || scrollY + innerHeight >= document.documentElement.scrollHeight - 4); },
    lost: () => !onWeight(), backTo: 0 },
  { title: "Here it is", text: "Everything for one day goes on this card. Let's fill it in.", spot: form, next: "Next",
    enter: () => setTimeout(() => scrollTo({ top: form().getBoundingClientRect().top + scrollY - 20, behavior: reduced() ? "auto" : "smooth" }), 350), lost: () => !onWeight(), backTo: 0 },
  { title: "Who is it for?", text: "Tap your name.", spot: form, point: () => $("who"), tap: "Tap your name", next: "Next", lost: () => !onWeight(), backTo: 0 },
  { title: "Which day?", text: "It starts on today. Tap it only if you're writing an earlier day.", spot: form, point: () => $("date"), tap: "Today", next: "Next", lost: () => !onWeight(), backTo: 0 },
  { title: "Type your weight", text: "In kilograms, like 68.4.", spot: form, point: () => $("weight"), tap: "Type here",
    next: "Next", ready: typedWeight, wait: "Type a weight first", lost: () => !onWeight(), backTo: 0 },
  { title: "Save it", text: "Tap Save entry. Runs and notes can wait for another day.", spot: form, point: () => $("save"), tap: "Tap here",
    enter: () => { $("formMsg").textContent = ""; }, done: () => /^(Saved|Updated)/.test($("formMsg").textContent), lost: () => !onWeight(), backTo: 0 },
];

// The how-to list. Ones with steps get a "Show me" button; the rest are quick tips for now.
const GUIDES = [
  { id: "weigh", icon: "⚖️", title: "Log your weight", blurb: "Write today's weight in the Weight journal.", time: "1 min", steps: WEIGH,
    about: "We'll open the Weight journal together, find the entry card and fill it in. Your weight is saved for real, so have today's number ready. You can stop any time.",
    learn: ["Switch journals with the round button", "Find the entry card", "Pick who, the day and the weight", "Save it"],
    words: "weigh weigh-in scale kg kilo bmi entry log record today" },
  { id: "meal", icon: "🍽️", title: "Log a meal", blurb: "Pick the meal, add foods or a meal set, save.", words: "food eat calories kcal breakfast lunch dinner snack set plate" },
  { id: "run", icon: "🏃", title: "Add a run", blurb: "In the Weight journal's entry card, add a picture of your COROS run and check the numbers.", words: "exercise coros watch running picture photo pace heart fitness" },
  { id: "mood", icon: "🙂", title: "Rate your day", blurb: "Tap a face on the Yesterday card.", words: "mood face feeling yesterday happy" },
  { id: "fold", icon: "✋", title: "Fold a card", blurb: "Hold the knob on a card's top edge to tuck it away. Tap it to open again.", words: "hide collapse tidy close card" },
  { id: "zoom", icon: "🔍", title: "Zoom a graph", blurb: "Pinch with two fingers. Double-tap to see it all again.", words: "chart graph pinch closer detail" },
];

// ---------- the list ----------
function drawList(ev) {
  $("guideList").classList.toggle("intro", !ev); // cards slide in when the page opens, not on every key typed
  const q = $("guideSearch").value.trim().toLowerCase();
  const words = q.split(/\s+/).filter(Boolean);
  const hits = GUIDES.filter((g) => { const hay = `${g.title} ${g.blurb} ${g.words}`.toLowerCase(); return words.every((w) => hay.includes(w)); })
    .sort((a, b) => !!b.steps - !!a.steps);
  $("guideList").innerHTML = hits.map((g, i) => `<li style="--i:${i}"><button type="button" class="gcard${g.steps ? " live" : ""}" data-g="${g.id}">
    <span class="gico" aria-hidden="true">${g.icon}</span>
    <span class="gtxt"><b>${g.title}</b><span>${g.blurb}</span></span>
    <span class="gtag">${g.steps ? `<i aria-hidden="true">▶</i> Show me · ${g.time}` : "Quick tip"}</span></button></li>`).join("");
  const empty = $("guideEmpty");
  empty.hidden = hits.length > 0;
  empty.textContent = hits.length ? "" : `Nothing for "${q}" yet. Try weight, meal or run.`;
}

function openSheet(g) {
  const sheet = $("guideSheet");
  sheet.innerHTML = `<form method="dialog" class="gsin">
    <div class="gshead"><span class="gico big" aria-hidden="true">${g.icon}</span>
      <div><p class="eyebrow">${g.steps ? `Walkthrough · about ${g.time}` : "Quick tip"}</p><h3 id="gsTitle">${g.title}</h3></div></div>
    <p>${g.about || g.blurb}</p>
    ${g.learn ? `<ol class="glearn">${g.learn.map((l) => `<li>${l}</li>`).join("")}</ol>` : `<p class="note">A step-by-step walkthrough for this is on the way.</p>`}
    <div class="actions">${g.steps ? `<button value="start" class="primary">Start walkthrough</button><button value="close">Not now</button>` : `<button value="close" class="primary">OK</button>`}</div>
  </form>`;
  sheet.returnValue = "";
  sheet.onclose = () => { if (sheet.returnValue === "start") setTimeout(() => startTour(g), 150); };
  sheet.showModal();
  sheet.querySelector(".primary").focus();
}

// ---------- the walkthrough ----------
let T = null; // { g, i, lostSince, raf }
let ui = null;

function build() {
  const root = document.createElement("div");
  root.className = "tour"; root.id = "tour"; root.hidden = true;
  root.innerHTML = `<div class="tblock"></div><div class="tspot"></div><div class="tring"></div>
    <svg class="tarrow" aria-hidden="true"><defs><marker id="tHead" viewBox="0 0 10 10" refX="6" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z"/></marker></defs><path class="tline" marker-end="url(#tHead)"/></svg>
    <span class="ttap" aria-hidden="true"></span>
    <div class="tbubble" role="dialog" aria-modal="false" aria-labelledby="tTitle">
      <div class="tdots" aria-hidden="true"></div>
      <p class="tcount"></p>
      <h3 id="tTitle"></h3>
      <p class="ttext" aria-live="polite"></p>
      <div class="tswipe" aria-hidden="true"><i></i></div>
      <div class="tact"><button type="button" class="tstop">Stop</button><button type="button" class="primary tnext"></button></div>
    </div>`;
  $("app").append(root);
  const q = (s) => root.querySelector(s);
  ui = { root, block: q(".tblock"), spot: q(".tspot"), ring: q(".tring"), svg: q(".tarrow"), line: q(".tline"), tap: q(".ttap"), bubble: q(".tbubble"),
    dots: q(".tdots"), count: q(".tcount"), title: q("#tTitle"), text: q(".ttext"), swipe: q(".tswipe"), act: q(".tact"), stop: q(".tstop"), next: q(".tnext") };
  ui.stop.addEventListener("click", () => endTour());
  ui.next.addEventListener("click", () => {
    if (!T) return;
    if (T.i >= T.g.steps.length) { const back = ui.next.dataset.go === "guide"; endTour(); if (back) { location.hash = "#guide"; scrollTo({ top: 0 }); } return; }
    const s = T.g.steps[T.i];
    if (!s.ready || s.ready()) go(T.i + 1);
  });
  // Escape stops the walkthrough, except while the wheel is open: there it only closes the wheel.
  // (T.wheel is the wheel as of the last frame, because the wheel may already have closed itself by now.)
  addEventListener("keydown", (ev) => { if (T && ev.key === "Escape" && !T.wheel && !wheelOpen()) endTour(); });
}

export function startTour(g) {
  if (!ui) build();
  if (location.hash === "#guide") { location.hash = ""; }
  T = { g, i: -1, lostSince: 0 };
  document.documentElement.classList.add("touring");
  ui.root.hidden = false;
  ui.dots.innerHTML = g.steps.map(() => "<i></i>").join("");
  go(0);
  cancelAnimationFrame(T.raf);
  const loop = () => { if (!T) return; frame(); T.raf = requestAnimationFrame(loop); };
  T.raf = requestAnimationFrame(loop);
}

function endTour() {
  if (!T) return;
  cancelAnimationFrame(T.raf);
  T = null;
  document.documentElement.classList.remove("touring");
  ui.root.classList.remove("show", "light", "finish", "pop");
  ui.root.hidden = true;
}

function go(i) {
  T.i = i; T.lostSince = 0;
  const steps = T.g.steps;
  if (i >= steps.length) return finish();
  const s = steps[i];
  s.enter?.();
  ui.root.classList.toggle("light", !!s.scroll);
  ui.root.classList.remove("finish");
  ui.count.textContent = `Step ${i + 1} of ${steps.length}`;
  [...ui.dots.children].forEach((d, k) => d.className = k < i ? "on" : k === i ? "now" : "");
  ui.title.textContent = s.title;
  ui.text.textContent = s.text;
  ui.swipe.hidden = !s.scroll;
  ui.next.hidden = !s.next;
  ui.next.dataset.go = "";
  ui.tap.textContent = s.tap || "";
  ui.stop.textContent = "Stop";
  // Replay the little "pop" so each new step catches the eye.
  ui.bubble.classList.remove("pop"); void ui.bubble.offsetWidth; ui.bubble.classList.add("pop");
}

function finish() {
  ui.root.classList.remove("light");
  ui.root.classList.add("finish");
  [...ui.dots.children].forEach((d) => d.className = "on");
  ui.count.textContent = "All done";
  ui.title.textContent = "🎉 Your weight is in!";
  ui.text.textContent = "It shows on your card at the top and in your graph. Do this whenever you step on the scale.";
  ui.swipe.hidden = true;
  ui.next.hidden = false;
  ui.next.textContent = "More how-tos";
  ui.next.dataset.go = "guide";
  ui.stop.textContent = "Look around";
  ui.bubble.classList.remove("pop"); void ui.bubble.offsetWidth; ui.bubble.classList.add("pop");
  ui.next.focus({ preventScroll: true });
}

const px = (n) => `${Math.round(n)}px`;

// Runs every frame while a walkthrough is on: things move (scrolling, the wheel flying open, the keyboard),
// so the light, the arrow and the bubble follow them.
function frame() {
  const steps = T.g.steps, s = steps[T.i];
  T.wheel = wheelOpen();
  if (!s) return place(null, null, null);
  if (s.done?.()) return go(T.i + 1);
  if (s.lost?.()) {
    T.lostSince ||= performance.now();
    if (performance.now() - T.lostSince > LOST_MS) return go(s.backTo ?? Math.max(0, T.i - 1));
  } else T.lostSince = 0;
  if (s.next) {
    const ok = !s.ready || s.ready();
    ui.next.disabled = !ok;
    const label = ok ? (T.i === steps.length - 1 ? "Finish" : s.next) : s.wait;
    if (ui.next.textContent !== label) ui.next.textContent = label;
  }
  const spotEl = s.spot?.(), pointEl = (s.point || s.spot)?.();
  place(spotEl, s, s.scroll ? null : pointEl);
}

function place(spotEl, s, pointEl) {
  const vv = visualViewport, vTop = vv ? vv.offsetTop : 0, vH = vv ? vv.height : innerHeight, W = innerWidth;
  const r = spotEl?.getBoundingClientRect();
  const has = r && r.width > 0;
  // The lit-up hole and the dimmed rest.
  if (has) {
    const pad = s.round ? 6 : 10;
    const x1 = r.left - pad, y1 = r.top - pad, x2 = r.right + pad, y2 = r.bottom + pad;
    Object.assign(ui.spot.style, { transform: `translate(${px(x1)}, ${px(y1)})`, width: px(x2 - x1), height: px(y2 - y1), borderRadius: s.round ? "999px" : "18px" });
    ui.spot.hidden = false;
    ui.block.style.clipPath = s.scroll ? "none"
      : `polygon(evenodd, 0 0, 100% 0, 100% 100%, 0 100%, 0 0, ${px(x1)} ${px(y1)}, ${px(x2)} ${px(y1)}, ${px(x2)} ${px(y2)}, ${px(x1)} ${px(y2)}, ${px(x1)} ${px(y1)})`;
  } else {
    ui.spot.hidden = !s; // between steps keep the last light; the finish card dims everything
    ui.block.style.clipPath = "none";
  }
  ui.block.classList.toggle("pass", !!s?.scroll);
  // The ring around the field the arrow points at (when that's smaller than the lit part).
  const p = pointEl?.getBoundingClientRect();
  const ringOn = !!(p && p.width && s?.point);
  ui.ring.hidden = !ringOn;
  if (ringOn) Object.assign(ui.ring.style, { transform: `translate(${px(p.left - 5)}, ${px(p.top - 5)})`, width: px(p.width + 10), height: px(p.height + 10) });

  // The bubble sits above or below the target, wherever there is more room on screen.
  const b = ui.bubble, bh = b.offsetHeight, bw = Math.min(420, W - 32), left = (W - bw) / 2;
  let top;
  if (!s) top = vTop + (vH - bh) / 2;
  else if (s.scroll) top = vTop + vH - bh - 16;
  else {
    const t = p && p.width ? p : r;
    const above = t ? t.top - vTop : 0, below = t ? vTop + vH - t.bottom : vH;
    top = below >= above ? Math.max(vTop + 12, Math.min(vTop + vH - bh - 16, (t ? t.bottom : 0) + 40)) : Math.max(vTop + 12, Math.min(vTop + vH - bh - 16, t.top - bh - 40));
    // A field inside a lit card, or a big target with no room beside it: dock against the far edge of the
    // screen so the card stays readable, and let the arrow make the trip.
    if (t && (s.point || (top < t.bottom && top + bh > t.top))) top = t.top + t.height / 2 > vTop + vH / 2 ? vTop + 12 : vTop + vH - bh - 16;
  }
  Object.assign(b.style, { transform: `translate(${px(left)}, ${px(top)})`, width: px(bw) });

  // The dotted arrow from the bubble to the target, with the "Tap here" label riding on it.
  const showArrow = !!(p && p.width && s && !s.scroll && (s.tap || s.point));
  ui.svg.style.display = showArrow ? "" : "none";
  ui.tap.hidden = !showArrow || !s.tap;
  if (!showArrow) return;
  const down = p.top + p.height / 2 > top + bh / 2; // target is below the bubble
  const sy = down ? top + bh + 4 : top - 4;
  const ex = p.left + p.width / 2, ey = down ? p.top - 10 : p.bottom + 10;
  if (down ? ey - sy < 24 : sy - ey < 24) { ui.svg.style.display = "none"; ui.tap.hidden = true; return; }
  const sx = Math.max(left + 36, Math.min(left + bw - 36, ex + (ex > W / 2 ? -70 : 70)));
  const cx = (sx + ex) / 2 + (ex > sx ? -40 : 40), cy = (sy + ey) / 2;
  ui.line.setAttribute("d", `M${sx.toFixed(1)} ${sy.toFixed(1)} Q${cx.toFixed(1)} ${cy.toFixed(1)} ${ex.toFixed(1)} ${ey.toFixed(1)}`);
  const mx = 0.25 * sx + 0.5 * cx + 0.25 * ex, my = 0.25 * sy + 0.5 * cy + 0.25 * ey;
  ui.tap.style.transform = `translate(${px(Math.max(8, Math.min(W - ui.tap.offsetWidth - 8, mx + (ex > sx ? -ui.tap.offsetWidth - 10 : 10))))}, ${px(my - 14)})`;
}

export function initGuides() {
  $("guideSearch").addEventListener("input", drawList);
  $("guideSearch").addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); $("guideList").querySelector(".gcard")?.click(); }
  });
  $("guideList").addEventListener("click", (ev) => {
    const g = GUIDES.find((x) => x.id === ev.target.closest(".gcard")?.dataset.g);
    if (g) openSheet(g);
  });
  $("guideSheet").addEventListener("click", (ev) => { if (ev.target === $("guideSheet")) $("guideSheet").close(); }); // tap outside closes
  drawList();
  addEventListener("hashchange", () => { if (location.hash === "#guide") drawList(); });
}
