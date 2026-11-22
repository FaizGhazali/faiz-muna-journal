// Landing story under the sign-in form. Each .scene gets --p from 0 to 1 while its top travels one
// screen up the page, so every animation starts as it scrolls in and is finished one scroll later.
// Inside a scene: [data-at] gets .on once --p passes that value; [data-from][data-to] counts a number.
const landing = document.getElementById("landing");
const scenes = [...landing.querySelectorAll(".scene")];
const still = matchMedia("(prefers-reduced-motion: reduce)");

const parts = scenes.map((el) => ({
  el,
  steps: [...el.querySelectorAll("[data-at]")].map((n) => ({ n, at: +n.dataset.at })),
  counts: [...el.querySelectorAll("[data-from]")].map((n) => ({ n, from: +n.dataset.from, to: +n.dataset.to, dp: +n.dataset.dp || 0 })),
  last: -1,
}));

function paint(s, p) {
  if (Math.abs(p - s.last) < 0.002) return;
  s.last = p;
  s.el.style.setProperty("--p", p.toFixed(3));
  s.steps.forEach(({ n, at }) => n.classList.toggle("on", p >= at));
  s.counts.forEach(({ n, from, to, dp }) => { n.textContent = (from + (to - from) * p).toFixed(dp); });
}

let queued = false;
function frame() {
  queued = false;
  if (!landing.offsetParent) return; // hidden while loading or signed in
  const vh = innerHeight;
  parts.forEach((s) => {
    if (still.matches) return paint(s, 1);
    const top = s.el.getBoundingClientRect().top;
    // Starts when the top is 90% down the screen, done when it reaches 15%.
    paint(s, Math.min(1, Math.max(0, (vh * 0.9 - top) / (vh * 0.75))));
  });
}
const queue = () => { if (!queued) { queued = true; requestAnimationFrame(frame); } };

landing.classList.add("live"); // CSS shows everything finished until this script runs
addEventListener("scroll", queue, { passive: true });
addEventListener("resize", queue);
still.addEventListener?.("change", queue);
// The landing appears only after app.js decides nobody is signed in.
new MutationObserver(queue).observe(document.getElementById("login"), { attributes: true, attributeFilter: ["hidden"] });
queue();

const smooth = () => (still.matches ? "auto" : "smooth");
document.getElementById("tourGo").addEventListener("click", () => scenes[0].scrollIntoView({ behavior: smooth() }));
document.getElementById("tourBack").addEventListener("click", () => {
  scrollTo({ top: 0, behavior: smooth() });
  setTimeout(() => document.getElementById("password").focus({ preventScroll: true }), still.matches ? 0 : 500);
});
