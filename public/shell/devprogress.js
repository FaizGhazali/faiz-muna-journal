// Development progress on the landing page (#devprog): a lifetime wheel of the five journals and a dotted
// calendar of each day's development. The data is /devlog.json, made from the git history on every deploy by
// tools/devlog.js (sums in logic/devlog.js). Missing file = "not available", drawn apart from a day with nothing.
import { wheel, waiting, agoText, calendar, weeksFor, kindLine } from "../logic/devlog.js";
import { $, esc, fmt, today } from "../core/util.js";

const COLOUR = { weight: "--s1", meals: "--s2", diary: "--s5", stocky: "--s3", ledger: "--s4" };
const SIZE = 300, C = SIZE / 2, R0 = 38, R1 = 104, RING = 110, LABEL = 128, GAP = 1.6; // wheel geometry (viewBox units)

const long = (d) => fmt(d, { weekday: "short", day: "numeric", month: "short", year: "numeric" });
const short = (d) => fmt(d, { day: "numeric", month: "short" });
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

let log = null, picked = null;

/** Draws once, when the section first comes near the screen (it is display:none while signed in). */
export function devProgress() {
  const host = $("devprog");
  if (!host) return;
  const io = new IntersectionObserver((seen) => {
    if (!seen.some((e) => e.isIntersecting)) return;
    io.disconnect();
    load();
  }, { rootMargin: "600px 0px" });
  io.observe(host);
}

async function load() {
  try {
    const res = await fetch("/devlog.json", { cache: "no-cache" });
    if (res.ok) log = await res.json();
  } catch (_) {}
  if (!log?.items) log = null;
  $("dpNote").textContent = log
    ? `From the app's change history, recorded automatically since ${long(log.since)}.`
    : "The development record isn't available right now, so nothing is shown as done or not done.";
  drawWheel();
  drawCalendar();
  wire();
}

// ---------- Lifetime wheel ----------

const pt = (r, deg) => { const a = (deg - 90) * Math.PI / 180; return [C + r * Math.cos(a), C + r * Math.sin(a)]; };
function slice(r0, r1, a0, a1) {
  const [x0, y0] = pt(r1, a0), [x1, y1] = pt(r1, a1), [x2, y2] = pt(r0, a1), [x3, y3] = pt(r0, a0);
  const f = (n) => n.toFixed(2);
  return `M${f(x0)} ${f(y0)}A${r1} ${r1} 0 0 1 ${f(x1)} ${f(y1)}L${f(x2)} ${f(y2)}A${r0} ${r0} 0 0 0 ${f(x3)} ${f(y3)}Z`;
}

// Each slice's label says when it was last worked on, and the journal left longest gets a dashed ring and
// "Next up?" in the list beside it: the point of the wheel is to show which journal is waiting for its turn.
function drawWheel() {
  const wait = waiting(wheel(log), today());
  const byId = Object.fromEntries(wait.map((m) => [m.id, m]));
  const mods = wheel(log).map((m) => byId[m.id]);
  const max = Math.max(1, ...mods.map((m) => m.points));
  const step = 360 / mods.length;
  const parts = mods.map((m, i) => {
    const a0 = i * step + GAP, a1 = (i + 1) * step - GAP, mid = (a0 + a1) / 2;
    const r = m.points ? R0 + (R1 - R0) * Math.sqrt(m.points / max) : R0 + 3; // area grows with the work done
    const [lx, ly] = pt(LABEL, mid);
    const anchor = Math.abs(lx - C) < 12 ? "middle" : lx > C ? "start" : "end";
    const y = ly > C + 40 ? ly - 2 : ly - 8; // two lines, kept clear of the wheel
    const when = log ? agoText(m.ago, true) : "";
    return `<g class="dw-seg${picked === m.id ? " on" : ""}${m.due ? " due" : ""}" data-mod="${m.id}" style="--c: var(${COLOUR[m.id]})" tabindex="0" role="button"
        aria-pressed="${picked === m.id}" aria-label="${esc(m.name)}: ${plural(m.updates, "update")}${when ? `, last worked on ${agoText(m.ago)}` : ""}${m.due ? ", waiting longest" : ""}">
      ${m.due ? `<path class="dw-ring" d="${slice(R1 + 2.5, RING, a0, a1)}"/>` : ""}
      <path class="dw-track" d="${slice(R0, R1, a0, a1)}"/>
      <path class="dw-fill" d="${slice(R0, r, a0, a1)}"/>
      <text x="${lx.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="${anchor}" dominant-baseline="middle">${esc(m.name)}${when
        ? `<tspan class="dw-when" x="${lx.toFixed(1)}" dy="15">${esc(when)}</tspan>` : ""}</text>
    </g>`;
  }).join("");
  const sel = mods.find((m) => m.id === picked);
  const total = log ? log.items.length : null;
  const mid = sel
    ? `<text class="dw-big" x="${C}" y="${C - 4}" text-anchor="middle">${sel.updates}</text><text class="dw-small" x="${C}" y="${C + 16}" text-anchor="middle">${sel.updates === 1 ? "update" : "updates"}</text>`
    : total == null
      ? `<text class="dw-small" x="${C}" y="${C + 4}" text-anchor="middle">No data</text>`
      : `<text class="dw-big" x="${C}" y="${C - 4}" text-anchor="middle">${total}</text><text class="dw-small" x="${C}" y="${C + 16}" text-anchor="middle">updates</text>`;
  $("dpWheel").innerHTML = `<svg viewBox="-34 -6 ${SIZE + 68} ${SIZE + 12}" role="group" aria-label="Development by journal">${parts}${mid}</svg>`;
  $("dpWheelInfo").innerHTML = wheelInfo(sel, wait);
}

function wheelInfo(m, wait) {
  if (!log) return `<p class="note">No development record to show yet.</p>`;
  if (!m) return `<p class="dp-lead">Each slice is one journal. The further it reaches out, the more work has gone into it.</p>
      ${waitList(wait)}
      <p class="note">Tap a journal or a slice to see its story.</p>`;
  if (!m.updates) return `<h3><i class="dp-dot" style="--c: var(${COLOUR[m.id]})"></i>${esc(m.name)}</h3><p class="note">No development recorded yet.</p>`;
  const recent = log.items.filter((it) => it.modules.includes(m.id)).at(-1);
  return `<h3><i class="dp-dot" style="--c: var(${COLOUR[m.id]})"></i>${esc(m.name)}${m.due ? `<span class="dp-due">Waiting longest</span>` : ""}</h3>
    <p><b>${plural(m.updates, "update")}</b> on ${plural(m.days, "day")} · ${esc(kindLine(m))}</p>
    <p class="note">Since ${short(m.first)} · last worked on ${m.ago > 1 ? `${short(m.last)} (${agoText(m.ago)})` : agoText(m.ago)}</p>
    <p class="note dp-last">Latest: ${esc(recent.what.replace(/^[^:]{1,40}:\s*/, ""))}</p>`;
}

/** "Last worked on": the journal waiting longest at the top; each bar is how long it has waited. */
function waitList(wait) {
  const most = Math.max(1, ...wait.map((m) => m.ago ?? 0));
  const rows = wait.map((m) => `<li><button type="button" class="dp-wait${m.due ? " due" : ""}" data-mod="${m.id}"
      style="--c: var(${COLOUR[m.id]}); --w: ${Math.round((m.ago == null ? 1 : m.ago / most) * 100)}%">
      <i class="dp-dot"></i><b>${esc(m.name)}</b><span class="dp-bar" aria-hidden="true"><i></i></span>
      <span class="dp-ago">${m.ago > 1 ? `${short(m.last)} · ` : ""}${esc(agoText(m.ago))}</span>
      ${m.due ? `<span class="dp-due">Next up?</span>` : ""}
    </button></li>`).join("");
  return `<h3 class="dp-wh">Last worked on</h3><ol class="dp-waits">${rows}</ol>`;
}

// ---------- Daily calendar ----------

function drawCalendar() {
  const now = today();
  const weeks = calendar(log, now, weeksFor(log, now));
  const months = weeks.map((w, i) => {
    const first = w.find((d) => d.date.endsWith("-01")) || (i === 0 ? w[0] : null);
    return first ? `<span style="grid-column: ${i + 2}">${fmt(first.date, { month: "short" })}</span>` : "";
  }).join("");
  const days = ["Mon", "", "Wed", "", "Fri", "", ""].map((t, i) => `<span style="grid-row: ${i + 2}">${t}</span>`).join("");
  const cells = weeks.map((w, c) => w.map((d, r) =>
    `<i class="dg-d ${d.state}" data-l="${d.level}" data-date="${d.date}" style="grid-area: ${r + 2} / ${c + 2}"></i>`).join("")).join("");
  const grid = $("dpGrid");
  grid.style.setProperty("--weeks", weeks.length);
  grid.innerHTML = `<div class="dg-m">${months}</div>${days}${cells}<div class="dg-tip" id="dpTip" hidden></div>`;
  grid._days = new Map(weeks.flat().map((d) => [d.date, d]));
  const tracked = weeks.flat().filter((d) => d.state === "tracked");
  const active = tracked.filter((d) => d.count).length;
  grid.setAttribute("aria-label", log
    ? `Development on ${active} of the ${tracked.length} days since tracking began.`
    : "No development record available.");
}

function tip(cell) {
  const grid = $("dpGrid"), box = $("dpTip");
  const d = cell && grid._days?.get(cell.dataset.date);
  grid.querySelectorAll(".dg-d.on").forEach((n) => n.classList.remove("on"));
  if (!d || d.state === "future") { box.hidden = true; return; }
  cell.classList.add("on");
  const body = d.state === "unknown"
    ? log ? "Before tracking began" : "Not available"
    : d.count
      ? `${plural(d.count, "update")} · ${d.modules.map((m) => `${esc(m.name)}${m.n > 1 && d.modules.length > 1 ? ` ×${m.n}` : ""}`).join(", ")}`
      : "No development";
  box.innerHTML = `<b>${long(d.date)}</b><span>${body}</span>`;
  box.hidden = false;
  const g = grid.getBoundingClientRect(), c = cell.getBoundingClientRect();
  const x = Math.min(Math.max(c.left + c.width / 2 - g.left, box.offsetWidth / 2), g.width - box.offsetWidth / 2);
  box.style.left = `${x}px`;
  box.style.top = `${c.top - g.top}px`;
}

function wire() {
  const w = $("dpWheel"), grid = $("dpGrid");
  const pick = (id, toggle) => { picked = toggle && picked === id ? null : id; drawWheel(); };
  w.addEventListener("click", (e) => { const s = e.target.closest(".dw-seg"); pick(s ? s.dataset.mod : null, true); });
  $("dpWheelInfo").addEventListener("click", (e) => { const b = e.target.closest(".dp-wait"); if (b) pick(b.dataset.mod); });
  w.addEventListener("pointerover", (e) => { const s = e.target.closest(".dw-seg"); if (e.pointerType === "mouse" && s && s.dataset.mod !== picked) pick(s.dataset.mod); });
  w.addEventListener("keydown", (e) => { const s = e.target.closest(".dw-seg"); if (s && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); pick(s.dataset.mod, true); w.querySelector(`[data-mod="${s.dataset.mod}"]`)?.focus(); } });
  grid.addEventListener("pointerover", (e) => tip(e.target.closest(".dg-d")));
  grid.addEventListener("click", (e) => tip(e.target.closest(".dg-d")));
  grid.addEventListener("pointerleave", (e) => { if (e.pointerType === "mouse") tip(null); });
}
