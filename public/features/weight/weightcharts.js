// The line charts on each person card: weight over time and the fitness score. SVG, zoomable (zoom.js),
// with a real date axis and a touch / hover read-out of the nearest point.
import { clock, paceOf } from "../../logic/fitness.js";
import { range, bmiOf } from "../../logic/bmi.js";
import { zoomable, xWindow, isZoomed } from "../../core/zoom.js";
import { esc, iso, dayNum, fmt } from "../../core/util.js";

// Touch or hover a chart to read the nearest point.
function hover(host, W, pts, X, label) {
  const svg = host.querySelector("svg"), cross = host.querySelector(".cross"), tip = host.querySelector(".tip");
  if (!pts.length) return;
  const showTip = (ev) => {
    const px = ev.clientX - svg.getBoundingClientRect().left;
    let best = pts[0];
    pts.forEach((e) => { if (Math.abs(X(e.date) - px) < Math.abs(X(best.date) - px)) best = e; });
    const bx = X(best.date);
    cross.setAttribute("x1", bx); cross.setAttribute("x2", bx); cross.setAttribute("visibility", "visible");
    tip.hidden = false;
    tip.textContent = `${fmt(best.date, { day: "numeric", month: "short", year: "numeric" })}: ${label(best)}`;
    tip.style.left = Math.max(0, Math.min(W - tip.offsetWidth, bx - tip.offsetWidth / 2)) + "px";
  };
  svg.addEventListener("pointermove", showTip);
  svg.addEventListener("pointerdown", showTip);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; cross.setAttribute("visibility", "hidden"); });
}

// Zoom (zoom.js): the part of the full date range f0..f1 in view, the points inside it, and the line's points
// (one more on each side so the line runs off the edges).
function zoomSpan(host, list, f0, f1) {
  const { a, b } = xWindow(host), x0 = f0 + a * (f1 - f0), x1 = f0 + b * (f1 - f0);
  const inView = (e) => { const d = dayNum(e.date); return d >= x0 && d <= x1; };
  let i0 = list.findIndex(inView), i1 = list.length - 1 - [...list].reverse().findIndex(inView);
  if (i0 < 0) { i0 = list.findIndex((e) => dayNum(e.date) > x1); if (i0 < 0) i0 = list.length; i1 = i0 - 1; }
  return { x0, x1, zoomed: isZoomed(host), vis: list.slice(i0, i1 + 1), line: list.slice(Math.max(0, i0 - 1), i1 + 2) };
}
// A side scale that hugs lo..hi with about 4 round lines.
function niceScale(lo, hi, minRoom) {
  const room = Math.max(minRoom, (hi - lo) * 0.15);
  const step = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20].find((n) => (hi - lo + 2 * room) / n <= 4) || 50;
  return { step, min: Math.floor((lo - room) / step) * step, max: Math.ceil((hi + room) / step) * step };
}
// A real time axis along the bottom: evenly spaced days / weeks / months / years (whichever fits the width),
// with faint up-down lines, so the gaps between weigh-ins show and zooming in brings finer dates.
function dateMarks(x0, x1, H, m, W) {
  const span = x1 - x0, room = W - m.l - m.r, fit = Math.max(2, Math.floor(room / 64));
  const X = (n) => m.l + ((n - x0) / span) * room;
  const D = (n) => new Date(Math.round(n) * 864e5);
  const lbl = (n, o) => D(n).toLocaleDateString(undefined, { ...o, timeZone: "UTC" });
  const ticks = [];
  const daySteps = [1, 2, 7, 14].find((s) => span / s <= fit);
  if (daySteps) {
    // weeks start on Monday (1970-01-01, day 0, was a Thursday)
    let n = daySteps >= 7 ? Math.ceil((x0 - 4) / 7) * 7 + 4 : Math.ceil(x0);
    if (daySteps === 14 && Math.floor((n - 4) / 7) % 2) n += 7;
    for (; n <= x1 + 1e-9; n += daySteps) ticks.push([n, lbl(n, { day: "numeric", month: "short" })]);
  } else {
    const ms = [1, 2, 3, 6, 12, 24, 60].find((s) => span / (30.44 * s) <= fit) || 120;
    const s = D(x0); let y = s.getUTCFullYear(), mo = s.getUTCMonth();
    if (Date.UTC(y, mo, 1) / 864e5 < x0 - 1e-9) mo++;
    mo = Math.ceil(mo / ms) * ms; // line up on Jan / Apr / Jul…
    for (let i = 0; i < 400; i++, mo += ms) {
      const n = Date.UTC(y, mo, 1) / 864e5;
      if (n > x1 + 1e-9) break;
      const d = D(n), first = !ticks.length;
      ticks.push([n, ms >= 12 ? String(d.getUTCFullYear())
        : d.getUTCMonth() === 0 || first ? lbl(n, { month: "short", year: "numeric" }) : lbl(n, { month: "short" })]);
    }
  }
  return ticks.map(([n, t]) => {
    const x = X(n), anchor = x < m.l + 24 ? "start" : x > W - m.r - 24 ? "end" : "middle";
    return `<line class="vgrid" x1="${x}" x2="${x}" y1="${m.t}" y2="${H - m.b}"/><text x="${x}" y="${H - 6}" text-anchor="${anchor}">${esc(t)}</text>`;
  }).join("");
}
const clipRect = (id, m, W, H) => `<defs><clipPath id="${id}"><rect x="${m.l - 6}" y="${m.t - 8}" width="${W - m.l - m.r + 12}" height="${H - m.t - m.b + 16}"/></clipPath></defs>`;

// Fitness: a ring for each run's own score, and the line for the moving average. The scale hugs the data so small gains show.
// `all` = fitnessSeries() for this person, oldest first.
export function drawFit(host, p, all) {
  const W = host.clientWidth || 320, H = 170, m = { l: 34, r: 12, t: 22, b: 24 };
  if (!all.length) return;
  const f0 = dayNum(all[0].date), f1 = Math.max(dayNum(all[all.length - 1].date), f0 + 14);
  const z = zoomSpan(host, all, f0, f1), seen = z.vis.length ? z.vis : z.line;
  const vals = seen.flatMap((x) => [x.score, x.trend]), lo = Math.min(...vals), hi = Math.max(...vals);
  let yMin, yMax, step;
  if (z.zoomed) ({ min: yMin, max: yMax, step } = niceScale(lo, hi, 0.2));
  else {
    const room = Math.max(0.6, (hi - lo) * 0.2);
    step = [0.2, 0.5, 1, 2, 5, 10].find((n) => (hi - lo + 2 * room) / n <= 4) || 20;
    yMin = Math.floor((lo - room) / step) * step; yMax = Math.ceil((hi + room) / step) * step;
  }
  const X = (d) => m.l + ((dayNum(d) - z.x0) / (z.x1 - z.x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + ((yMax - v) / (yMax - yMin)) * (H - m.t - m.b);
  let g = "";
  for (let i = 0; yMin + i * step <= yMax + 1e-9; i++) { const v = yMin + i * step; g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${v.toFixed(step < 1 ? 1 : 0)}</text>`; }
  const path = z.line.map((e, i) => `${i ? "L" : "M"}${X(e.date).toFixed(1)} ${Y(e.trend).toFixed(1)}`).join("");
  const rings = (z.zoomed ? z.vis : all.slice(-60)).map((e) => `<circle class="run" cx="${X(e.date)}" cy="${Y(e.score)}" r="3.5"/>`).join("");
  const last = all[all.length - 1], tag = z.zoomed ? z.vis[z.vis.length - 1] : last;
  const lx = tag ? X(tag.date) : 0, ly = tag ? Y(tag.trend) : 0, clip = `clip-${host.id}`;
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.name)}'s fitness score over time. Now ${last.trend.toFixed(1)}.">
    ${clipRect(clip, m, W, H)}${g}${dateMarks(z.x0, z.x1, H, m, W)}<g clip-path="url(#${clip})">${rings}
    <path class="ln" d="${path}"/></g>
    ${tag ? `<circle class="pt" cx="${lx}" cy="${ly}" r="5"/>
    <text class="val" x="${lx}" y="${ly - 10}" text-anchor="${lx > W / 2 ? "end" : "start"}">${tag.trend.toFixed(z.zoomed ? 2 : 1)}</text>` : ""}
    <line class="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
  </svg><div class="tip" hidden></div>`;
  hover(host, W, z.vis, X, (e) => `fitness ${e.trend.toFixed(2)}. This run ${e.score.toFixed(1)}, ${e.run.km} km at ${clock(paceOf(e.run))} per km, ${e.run.hr} bpm`);
  zoomable(host, m.l, W - m.r, () => drawFit(host, p, all));
}

// Weight: the line, the dots, the normal-range band and the goal line. `all` = this person's weigh-ins, oldest first.
export function drawWeight(host, p, all) {
  const W = host.clientWidth || 320, H = 170;
  if (!all.length) { host.innerHTML = `<p class="note">Your weight line starts with the first weigh-in.</p>`; return; }
  const { lo, hi } = range(p), m = { l: 34, r: 10, t: 22, b: 24 };
  // the time axis runs to today, so a long gap since the last weigh-in shows as a gap
  const f0 = dayNum(all[0].date), f1 = Math.max(dayNum(all[all.length - 1].date), dayNum(iso(new Date())), f0 + 28);
  const z = zoomSpan(host, all, f0, f1), pts = z.vis, seen = pts.length ? pts : z.line;
  const ws = seen.map((e) => e.weight), wMin = Math.min(...ws), wMax = Math.max(...ws);
  let yMin, yMax, step;
  if (z.zoomed) ({ min: yMin, max: yMax, step } = niceScale(wMin, wMax, 0.3)); // fit the weights in view, down to 0.1 kg
  else {
    const inRange = wMax <= hi && wMin >= lo, anchorLo = inRange || wMin < lo ? lo : hi;
    yMin = Math.floor(Math.min(anchorLo, wMin - 1) / 5) * 5; yMax = Math.ceil(Math.max(hi, wMax + 1) / 5) * 5;
    step = yMax - yMin > 40 ? 10 : 5;
  }
  const X = (d) => m.l + ((dayNum(d) - z.x0) / (z.x1 - z.x0)) * (W - m.l - m.r);
  const Y = (v) => m.t + ((yMax - v) / (yMax - yMin)) * (H - m.t - m.b);
  let g = "";
  for (let i = 0; yMin + i * step <= yMax + 1e-9; i++) { const v = yMin + i * step; g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${Y(v)}" y2="${Y(v)}"/><text x="${m.l - 6}" y="${Y(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`; }
  let band = "";
  const bt = Y(Math.min(hi, yMax)), bb = Y(Math.max(lo, yMin));
  if (bb > bt) band = `<rect class="band" x="${m.l}" width="${W - m.l - m.r}" y="${bt}" height="${bb - bt}"/>`;
  if (wMax > hi && hi > yMin && hi < yMax) band += `<line class="goalline" x1="${m.l}" x2="${W - m.r}" y1="${bt}" y2="${bt}"/><text x="${W - m.r}" y="${bt - 5}" text-anchor="end">Goal ${hi.toFixed(1)} kg</text>`;
  else if (bb - bt > 20) band += `<text x="${W - m.r}" y="${bt + 15}" text-anchor="end">Normal range</text>`;
  const path = z.line.map((e, i) => `${i ? "L" : "M"}${X(e.date).toFixed(1)} ${Y(e.weight).toFixed(1)}`).join("");
  const last = all[all.length - 1], tag = z.zoomed ? pts[pts.length - 1] : last;
  const dots = pts.length <= 40 ? pts.filter((e) => e !== tag).map((e) => `<circle class="pt" cx="${X(e.date)}" cy="${Y(e.weight)}" r="4"/>`).join("") : "";
  const lx = tag ? X(tag.date) : 0, ly = tag ? Y(tag.weight) : 0, clip = `clip-${host.id}`;
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.name)}'s weight over time. Latest ${last.weight.toFixed(1)} kg. Normal range ${lo.toFixed(1)} to ${hi.toFixed(1)} kg.">
    ${clipRect(clip, m, W, H)}${band}${g}${dateMarks(z.x0, z.x1, H, m, W)}
    <g clip-path="url(#${clip})"><path class="ln" d="${path}"/>${dots}</g>
    ${tag ? `<circle class="pt" cx="${lx}" cy="${ly}" r="5"/>
    <text class="val" x="${lx}" y="${ly - 10}" text-anchor="${lx > W / 2 ? "end" : "start"}">${tag.weight.toFixed(1)} kg</text>` : ""}
    <line class="cross" y1="${m.t}" y2="${H - m.b}" visibility="hidden"/>
  </svg><div class="tip" hidden></div>`;
  hover(host, W, pts, X, (e) => `${e.weight.toFixed(1)} kg, BMI ${bmiOf(p, e.weight).toFixed(1)}`);
  zoomable(host, m.l, W - m.r, () => drawWeight(host, p, all));
}
