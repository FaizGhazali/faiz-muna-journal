// The "Fitness detail" page at #fitness/<person id>: weight vs pace for one person. Read-only.
// The pairing and the line are worked out in runweight.js; this file only draws them.
import { pairRunsWithWeight, linearRegression, runEntries, similarEffort, MAX_GAP_DAYS, MIN_TREND, CONFIDENT, SIMILAR_BPM } from "./runweight.js";
import { clock } from "./fitness.js";
import { parse } from "./suggest.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s, o) => parse(s).toLocaleDateString(undefined, o);
const short = (s) => fmt(s, { day: "numeric", month: "short" });
const long = (s) => fmt(s, { day: "numeric", month: "short", year: "numeric" });
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;

let people, entries, pid = null, fromApp = false, lastWidth = 0;

export const onFitnessPage = () => location.hash.startsWith("#fitness");
const hashPerson = () => decodeURIComponent(location.hash.split("/")[1] || "");

export function initFitDetail(opts) {
  ({ people, entries } = opts);
  window.addEventListener("hashchange", (ev) => {
    if (!onFitnessPage()) return;
    // Came here from another page of the app, so Back can simply go back to it.
    if (!new URL(ev.oldURL).hash.startsWith("#fitness")) { fromApp = true; window.scrollTo(0, 0); }
    pid = null;
    refreshFitDetail();
  });
  $("fdBack").addEventListener("click", () => { if (fromApp) { fromApp = false; history.back(); } else location.hash = ""; });
  $("fdWho").addEventListener("change", (ev) => {
    pid = ev.target.value;
    history.replaceState(null, "", "#fitness/" + encodeURIComponent(pid));
    refreshFitDetail();
  });
  $("fdSimilar").addEventListener("change", draw);
  new ResizeObserver(() => { const w = $("fdChart")?.clientWidth || 0; if (w && w !== lastWidth) { lastWidth = w; draw(); } }).observe($("fitness"));
}

// Called on page changes and whenever the journal's data changes.
export function refreshFitDetail() {
  const ps = people();
  if (!ps.length || !onFitnessPage()) return;
  if (!ps.some((p) => p.id === pid)) pid = ps.some((p) => p.id === hashPerson()) ? hashPerson() : ps[0].id;
  $("fdWho").innerHTML = ps.map((p) => `<input type="radio" name="fdWho" id="fd-${p.id}" value="${p.id}"${p.id === pid ? " checked" : ""}><label for="fd-${p.id}">${esc(p.name)}</label>`).join("");
  draw();
}

function draw() {
  const p = people().find((x) => x.id === pid);
  if (!p || !onFitnessPage()) return;
  const all = entries(), runs = runEntries(all, pid), pairs = pairRunsWithWeight(all, pid);
  const similar = $("fdSimilar").checked;
  const pts = similar ? similarEffort(pairs, runs.map((e) => ({ date: e.date, hr: e.run.hr }))) : pairs, n = pts.length;
  const fit = linearRegression(pts.map((q) => ({ x: q.weightKg, y: q.paceSec })));

  const counts = [];
  if (runs.length > pairs.length) counts.push(`${plural(runs.length - pairs.length, "run")} excluded (no weight within ${MAX_GAP_DAYS} days)`);
  if (similar && pairs.length > n) counts.push(`${plural(pairs.length - n, "run")} left out by "Similar effort only" (more than ${SIMILAR_BPM} bpm from your usual heart rate that month)`);
  const countHtml = counts.length ? `<p class="note">${esc(counts.join(". "))}.</p>` : "";

  if (!n) {
    const empty = similar && pairs.length ? `No runs within ${SIMILAR_BPM} bpm of your usual heart rate that month. Turn off "Similar effort only" to see them all.` : "Log your weight on run days to see this graph.";
    $("fdBody").innerHTML = `<p class="fdempty">${esc(empty)}</p>${countHtml}`;
    return;
  }

  let summary;
  if (n < MIN_TREND) summary = `<p class="fdsum"><strong>Need at least ${MIN_TREND} runs with weight for a trend.</strong></p>`;
  else if (fit.slope == null) summary = `<p class="fdsum"><strong>All these runs have the same weight, so there's no trend yet.</strong></p>`;
  else {
    const b = Math.round(fit.slope * 10) / 10;
    const head = b === 0 ? "Weight makes no clear difference to pace yet" : `Each extra 1 kg ≈ ${Math.abs(b).toFixed(1)} s/km ${b > 0 ? "slower" : "faster"}`;
    const from = pts[0].date, to = pts[n - 1].date;
    const span = from === to ? long(from) : `${from.slice(0, 4) === to.slice(0, 4) ? short(from) : long(from)} to ${long(to)}`;
    summary = `<div class="fdsum">
      <strong>${esc(head)}</strong>
      <p class="note">${plural(n, "run")} used · R² ${fit.r2.toFixed(2)} · ${esc(span)}</p>
      ${n < CONFIDENT ? `<span class="badge">Low confidence, keep logging</span>` : ""}
    </div>`;
  }
  $("fdBody").innerHTML = `<div class="chart scatter" id="fdChart"></div>
    <p class="legend"><span class="key same"></span>Weighed that day <span class="key near"></span>Weight from a nearby day</p>
    ${summary}${countHtml}`;
  scatter($("fdChart"), p, pts, fit.slope == null ? null : fit);
}

// Nice round steps for an axis that covers lo..hi with about `ticks` lines.
function axis(lo, hi, steps, ticks) {
  const step = steps.find((s) => (hi - lo) / s <= ticks) || steps[steps.length - 1];
  return { step, min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step };
}

function scatter(host, p, pts, fit) {
  const W = host.clientWidth || 320, H = 280, m = { l: 46, r: 14, t: 28, b: 44 };
  lastWidth = W;
  const ws = pts.map((q) => q.weightKg), ps = pts.map((q) => q.paceSec);
  const wRoom = Math.max(0.5, (Math.max(...ws) - Math.min(...ws)) * 0.12), pRoom = Math.max(10, (Math.max(...ps) - Math.min(...ps)) * 0.12);
  const xa = axis(Math.min(...ws) - wRoom, Math.max(...ws) + wRoom, [0.5, 1, 2, 5, 10, 20], W < 420 ? 4 : 6);
  const ya = axis(Math.min(...ps) - pRoom, Math.max(...ps) + pRoom, [5, 10, 15, 30, 60, 120, 300], 5);
  const X = (v) => m.l + ((v - xa.min) / (xa.max - xa.min)) * (W - m.l - m.r);
  const Y = (v) => m.t + ((v - ya.min) / (ya.max - ya.min)) * (H - m.t - m.b); // faster (fewer seconds) at the top
  let g = "";
  for (let v = ya.min; v <= ya.max + 1e-9; v += ya.step) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${clock(v)}</text>`;
  for (let v = xa.min; v <= xa.max + 1e-9; v += xa.step) g += `<line class="grid" x1="${X(v)}" x2="${X(v)}" y1="${m.t}" y2="${H - m.b}"/><text x="${X(v)}" y="${H - m.b + 16}" text-anchor="middle">${+v.toFixed(1)}</text>`;
  let line = "";
  if (fit) {
    const a = Math.min(...ws), b = Math.max(...ws);
    line = `<line class="trend" x1="${X(a)}" y1="${Y(fit.intercept + fit.slope * a)}" x2="${X(b)}" y2="${Y(fit.intercept + fit.slope * b)}"/>`;
  }
  const dots = pts.map((q) => `<circle class="${q.gapDays ? "run" : "pt"}" cx="${X(q.weightKg)}" cy="${Y(q.paceSec)}" r="5"/>`).join("");
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.name)}'s pace against body weight, ${plural(pts.length, "run")}.">
    ${g}${line}${dots}
    <text x="${m.l}" y="14">Pace per km · faster ↑</text>
    <text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">Body weight, kg</text>
    <circle class="ring" r="9" visibility="hidden"/>
  </svg><div class="tip fdtip" hidden></div>`;

  const svg = host.querySelector("svg"), tip = host.querySelector(".tip"), ring = host.querySelector(".ring");
  const show = (ev) => {
    const r = svg.getBoundingClientRect(), px = ev.clientX - r.left, py = ev.clientY - r.top;
    const d = (q) => (X(q.weightKg) - px) ** 2 + (Y(q.paceSec) - py) ** 2;
    const q = pts.reduce((best, x) => (d(x) < d(best) ? x : best));
    const cx = X(q.weightKg), cy = Y(q.paceSec);
    ring.setAttribute("cx", cx); ring.setAttribute("cy", cy); ring.setAttribute("visibility", "visible");
    const kg = `${q.weightKg.toFixed(1)} kg, ${q.gapDays ? `weighed ${short(q.weightDate)} (${plural(q.gapDays, "day")} ${q.weightDate < q.date ? "before" : "after"})` : "weighed the same day"}`;
    const lines = [long(q.date), `${q.km != null ? `${q.km} km at ` : ""}${clock(q.paceSec)} /km${q.hr ? `, avg ${q.hr} bpm` : ""}`, kg];
    if (q.note) lines.push(q.note.length > 80 ? q.note.slice(0, 79) + "…" : q.note);
    tip.textContent = lines.join("\n");
    tip.hidden = false;
    tip.style.left = Math.max(0, Math.min(W - tip.offsetWidth, cx - tip.offsetWidth / 2)) + "px";
    tip.style.top = (cy - tip.offsetHeight - 12 >= 0 ? cy - tip.offsetHeight - 12 : cy + 14) + "px";
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; ring.setAttribute("visibility", "hidden"); });
}
