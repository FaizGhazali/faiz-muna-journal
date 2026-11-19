// The "Fitness detail" page at #fitness/<person id>: up to four graph cards for one person. Read-only.
// Which cards show (any, all or none) is picked with the chips at the top and remembered on this device.
// The pairing, bands and lines are worked out in runweight.js; this file only draws them.
import { runsWithWeight, linearRegression, runEntries, similarEffort, weightBands, bandWidth, ageOn, ageText, MAX_GAP_DAYS, MIN_TREND, CONFIDENT, SIMILAR_BPM } from "./runweight.js";
import { clock } from "./fitness.js";
import { toChart, toScreen } from "./zoom.js";
import { parse, dayNum, iso } from "./suggest.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmt = (s, o) => parse(s).toLocaleDateString(undefined, o);
const short = (s) => fmt(s, { day: "numeric", month: "short" });
const long = (s) => fmt(s, { day: "numeric", month: "short", year: "numeric" });
const month = (s) => fmt(s, { month: "short", year: "numeric" });
const dayIso = (d) => new Date(Math.round(d) * 864e5).toISOString().slice(0, 10); // inverse of dayNum
// Dot colour by date: oldest run pale, newest run full colour, so you can see how you moved over time.
const OLD_PCT = 18;
const shade = (t) => `color-mix(in srgb, var(--accent) ${Math.round(OLD_PCT + (100 - OLD_PCT) * t)}%, var(--line))`;
const plural = (n, one, many = one + "s") => `${n} ${n === 1 ? one : many}`;
const km1 = (v) => (Math.round(v * 10) / 10).toFixed(1);
const MONTH_DAYS = 30.44;
const THIN = 3; // bars with fewer runs than this are drawn faint

// What goes up the side of a graph.
const Y = {
  pace: { key: "paceSec", fmt: clock, unit: " /km", low: true, best: "Best", axis: "Pace per km · faster ↑", steps: [5, 10, 15, 30, 60, 120, 300], room: 10 },
  km: { key: "km", fmt: km1, unit: " km", low: false, best: "Longest", axis: "Distance, km · longer ↑", steps: [0.5, 1, 2, 5, 10, 20], room: 0.5 },
};
// What goes along the bottom.
const X = {
  weight: { get: (q) => q.weightKg, label: (v) => +v.toFixed(1), axis: "Body weight, kg", steps: [0.5, 1, 2, 5, 10, 20], room: 0.5 },
  date: { get: (q) => dayNum(q.date), axis: "Date", room: 4 },
};
export const GRAPHS = [
  { id: "pace", title: "Weight vs pace", x: "weight", y: "pace", about: "One dot per run, with your weight from that day or the nearest weigh-in within a week. Higher dots are faster runs." },
  { id: "dist", title: "Weight vs distance", bars: true, y: "km", about: "Runs grouped by your weight at the time. Each bar is how far you ran on average at that weight; taller is further." },
  { id: "pacetime", title: "Pace over time", x: "date", y: "pace", about: "Every run in date order. Higher dots are faster runs." },
  { id: "disttime", title: "Distance over time", x: "date", y: "km", about: "Every run in date order. Higher dots are longer runs." },
];
const PICK_KEY = "journal-fitgraphs";
const DEFAULT_PICK = ["pace", "dist"];

let people, entries, saveBorn, pid = null, fromApp = false, lastWidth = 0, editingBorn = false, picked = loadPick();

function loadPick() {
  try {
    const v = JSON.parse(localStorage.getItem(PICK_KEY));
    return Array.isArray(v) ? GRAPHS.map((g) => g.id).filter((id) => v.includes(id)) : DEFAULT_PICK; // [] = none, on purpose
  } catch (_) { return DEFAULT_PICK; }
}
function savePick() { try { localStorage.setItem(PICK_KEY, JSON.stringify(picked)); } catch (_) {} }

export const onFitnessPage = () => location.hash.startsWith("#fitness");
const hashPerson = () => decodeURIComponent(location.hash.split("/")[1] || "");

export function initFitDetail(opts) {
  ({ people, entries, saveBorn } = opts);
  window.addEventListener("hashchange", (ev) => {
    if (!onFitnessPage()) return;
    // Came here from another page of the app, so Back can simply go back to it.
    if (!new URL(ev.oldURL).hash.startsWith("#fitness")) { fromApp = true; window.scrollTo(0, 0); }
    pid = null;
    editingBorn = false;
    refreshFitDetail();
  });
  $("fdBack").addEventListener("click", () => { if (fromApp) { fromApp = false; history.back(); } else location.hash = ""; });
  $("fdWho").addEventListener("change", (ev) => {
    pid = ev.target.value;
    editingBorn = false;
    history.replaceState(null, "", "#fitness/" + encodeURIComponent(pid));
    refreshFitDetail();
  });
  $("fdPick").addEventListener("click", (ev) => {
    const id = ev.target.closest("[data-graph]")?.dataset.graph;
    if (!id) return;
    if (picked.includes(id)) picked = picked.filter((x) => x !== id);
    else picked = GRAPHS.map((g) => g.id).filter((x) => x === id || picked.includes(x));
    savePick();
    drawPick();
    draw();
  });
  $("fdSimilar").addEventListener("change", draw);
  $("fdAge").addEventListener("click", (ev) => {
    if (ev.target.id === "fdBornEdit") { editingBorn = true; drawAge(); $("fdBornIn").focus(); }
    if (ev.target.id === "fdBornCancel") { editingBorn = false; drawAge(); }
  });
  $("fdAge").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const born = $("fdBornIn").value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(born) || born > iso(new Date())) { $("fdBornMsg").textContent = "Pick a birth date in the past."; return; }
    editingBorn = false;
    await saveBorn(pid, born);
    draw();
  });
  new ResizeObserver(() => { const w = $("fdBody").querySelector(".chart")?.clientWidth || 0; if (w && w !== lastWidth) { lastWidth = w; draw(); } }).observe($("fitness"));
}

// Called on page changes and whenever the journal's data changes.
export function refreshFitDetail() {
  const ps = people();
  if (!ps.length || !onFitnessPage()) return;
  if (!ps.some((p) => p.id === pid)) pid = ps.some((p) => p.id === hashPerson()) ? hashPerson() : ps[0].id;
  $("fdWho").innerHTML = ps.map((p) => `<input type="radio" name="fdWho" id="fd-${p.id}" value="${p.id}"${p.id === pid ? " checked" : ""}><label for="fd-${p.id}">${esc(p.name)}</label>`).join("");
  drawPick();
  draw();
}

function drawPick() {
  $("fdPick").innerHTML = GRAPHS.map((g) => {
    const on = picked.includes(g.id);
    return `<button type="button" class="chip" data-graph="${g.id}" aria-pressed="${on}">${esc(g.title)}</button>`;
  }).join("");
}

// The birth date line. Kept out of draw()'s re-render while it is being typed in.
function drawAge() {
  const p = people().find((x) => x.id === pid);
  if (!p) return;
  if (!editingBorn && p.born) {
    $("fdAge").innerHTML = `<p class="note">Age on each run is from ${esc(p.name)}'s birth date, ${esc(long(p.born))}. <button type="button" class="link" id="fdBornEdit">Change</button></p>`;
    return;
  }
  $("fdAge").innerHTML = `<form class="fdborn">
    <label for="fdBornIn">${p.born ? "Birth date" : `Add ${esc(p.name)}'s birth date to see the age on each run`}</label>
    <div class="fdbornrow"><input type="date" id="fdBornIn" value="${esc(p.born || "")}" max="${iso(new Date())}" required>
    <button type="submit" class="primary">Save</button>${p.born ? `<button type="button" id="fdBornCancel">Cancel</button>` : ""}</div>
    <p class="note" id="fdBornMsg" role="alert"></p>
  </form>`;
}

function draw() {
  const p = people().find((x) => x.id === pid);
  if (!p || !onFitnessPage()) return;
  if (!editingBorn) drawAge();
  const all = entries(), runs = runEntries(all, pid), rows = runsWithWeight(all, pid);
  const similar = $("fdSimilar").checked;
  const kept = similar ? similarEffort(rows, runs.map((e) => ({ date: e.date, hr: e.run.hr }))) : rows;
  const ctx = { p, rows, kept, similar };
  const cards = GRAPHS.filter((g) => picked.includes(g.id));
  $("fdBody").innerHTML = cards.length ? cards.map((g) => card(g, ctx)).join("") : `<p class="fdempty">No graphs picked. Tap one above to show it.</p>`;
  for (const g of cards) g.render?.();
}

// One graph card: heading, First / Best / Now tiles, the chart, legend and summary.
function card(g, { p, rows, kept, similar }) {
  const y = Y[g.y], needW = g.bars || g.x === "weight", needKm = g.y === "km";
  const usable = (q) => (!needW || q.weightKg != null) && (!needKm || q.km != null);
  const pts = kept.filter(usable), base = rows.filter(usable), n = pts.length;
  g.render = null;

  const counts = [];
  const noW = needW ? rows.filter((q) => q.weightKg == null).length : 0;
  const noKm = needKm ? rows.filter((q) => q.km == null && (!needW || q.weightKg != null)).length : 0;
  if (noW) counts.push(`${plural(noW, "run")} excluded (no weight within ${MAX_GAP_DAYS} days)`);
  if (noKm) counts.push(`${plural(noKm, "run")} excluded (no distance saved)`);
  if (similar && base.length > n) counts.push(`${plural(base.length - n, "run")} left out by "Similar effort only" (more than ${SIMILAR_BPM} bpm from your usual heart rate that month)`);
  const countHtml = counts.length ? `<p class="note">${esc(counts.join(". "))}.</p>` : "";
  const top = `<h3 class="fdtitle">${esc(g.title)}</h3><p class="note">${esc(g.about)}</p>`;

  if (!n) {
    const empty = similar && base.length ? `No runs within ${SIMILAR_BPM} bpm of your usual heart rate that month. Turn off "Similar effort only" to see them all.`
      : needW ? "Log your weight on run days to see this graph." : "Add a run to see this graph.";
    return `<section class="panel fd">${top}<p class="fdempty">${esc(empty)}</p>${countHtml}</section>`;
  }

  // First run, best run and latest run, written out in full so a screenshot reads at a glance.
  const better = (a, b) => (y.low ? a <= b : a >= b);
  const best = pts.reduce((b, q, i) => (better(q[y.key], pts[b][y.key]) ? i : b), 0), last = n - 1, B = y.best;
  const tags = new Map();
  if (n === 1) tags.set(0, "Only run");
  else {
    tags.set(0, best === 0 ? `First · ${B.toLowerCase()}` : "First");
    if (best !== 0 && best !== last) tags.set(best, B);
    tags.set(last, best === last ? `Now · ${B.toLowerCase()}` : "Now");
  }
  const tile = (i) => {
    const q = pts[i], age = p.born ? ageText(ageOn(p.born, q.date)) : "";
    return `<div class="fdtile${i === best ? " best" : ""}">
      <span class="fdtag">${esc(tags.get(i))}</span>
      <strong>${y.fmt(q[y.key])}<small>${y.unit}</small></strong>
      <span class="fdkg">${q.weightKg != null ? `${q.weightKg.toFixed(1)} kg` : "&nbsp;"}</span>
      <span class="note">${age ? `Age ${esc(age)}<br>` : ""}${esc(long(q.date))}</span>
    </div>`;
  };
  let change = "";
  if (n > 1) {
    const a = pts[0], z = pts[last], gap = ageOn(a.date, z.date), days = dayNum(z.date) - dayNum(a.date);
    const over = gap.years ? `${gap.years}y ${gap.months}m` : gap.months ? plural(gap.months, "month") : plural(Math.max(1, Math.round(days / 7)), "week");
    const bits = [];
    if (a.weightKg != null && z.weightKg != null) {
      const dKg = z.weightKg - a.weightKg;
      bits.push(`<b>${esc(Math.abs(dKg) < 0.05 ? "same weight" : `${dKg < 0 ? "−" : "+"}${Math.abs(dKg).toFixed(1)} kg`)}</b>`);
    }
    if (y.low) {
      const d = Math.round(a.paceSec - z.paceSec);
      bits.push(`<b class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${esc(d === 0 ? "same pace" : `${clock(Math.abs(d))} /km ${d > 0 ? "faster" : "slower"}`)}</b>`);
    } else {
      const d = Math.round((z.km - a.km) * 10) / 10;
      bits.push(`<b class="${d > 0 ? "up" : d < 0 ? "down" : ""}">${esc(d === 0 ? "same distance" : `${km1(Math.abs(d))} km ${d > 0 ? "longer" : "shorter"}`)}</b>`);
    }
    change = `<p class="fdchange">First to latest run, ${esc(over)}: ${bits.join(" · ")}</p>`;
  }
  const head = `<div class="fdcard">
      <p class="fdwho">${esc(p.name)}'s running</p>
      <div class="fdtiles">${[...tags.keys()].sort((a, b) => a - b).map(tile).join("")}</div>
      ${change}
    </div>`;
  const from = pts[0].date, to = pts[last].date;
  const span = from === to ? long(from) : `${from.slice(0, 4) === to.slice(0, 4) ? short(from) : long(from)} to ${long(to)}`;
  const id = `fdChart-${g.id}`;
  const ramp = (what) => `<p class="legend"><span>${esc(what)}</span><span>${esc(month(from))}</span><span class="ramp" style="background:linear-gradient(to right, ${shade(0)}, ${shade(1)})"></span><span>${esc(month(to))}</span></p>`;

  if (g.bars) {
    const bands = weightBands(pts, bandWidth(pts.map((q) => q.weightKg))), full = bands.filter((b) => b.n);
    let summary;
    if (full.length < 2) summary = `<p class="fdsum"><strong>All these runs are in one weight band (${esc(bandName(full[0]))}), so there's nothing to compare yet.</strong></p>`;
    else {
      const most = full.reduce((a, b) => (b.avgKm > a.avgKm ? b : a));
      summary = `<div class="fdsum">
        <strong>Furthest on average at ${esc(bandName(most))}: ${km1(most.avgKm)} km</strong>
        <p class="note">${plural(n, "run")} in ${plural(full.length, "weight band")} · ${esc(span)}</p>
        ${n < CONFIDENT || most.n < THIN ? `<span class="badge">Low confidence, keep logging</span>` : ""}
      </div>`;
    }
    g.render = () => bars($(id), p, bands, from, to);
    return `<section class="panel fd">${top}${head}<div class="chart scatter" id="${id}"></div>
      ${ramp("Bar colour:")}
      <p class="legend"><span class="key bar"></span>${THIN}+ runs <span class="key bar thin"></span>Fewer than ${THIN} runs, a rough guide</p>
      ${summary}${countHtml}</section>`;
  }

  const x = X[g.x];
  const fit = linearRegression(pts.map((q) => ({ x: x.get(q), y: q[y.key] })));
  let summary;
  if (n < MIN_TREND) summary = `<p class="fdsum"><strong>Need at least ${MIN_TREND} runs${needW ? " with weight" : ""} for a trend.</strong></p>`;
  else if (fit.slope == null) summary = `<p class="fdsum"><strong>${g.x === "weight" ? "All these runs have the same weight" : "All these runs are on one day"}, so there's no trend yet.</strong></p>`;
  else {
    let headline;
    if (g.x === "weight") {
      const b = Math.round(fit.slope * 10) / 10;
      headline = b === 0 ? "Weight makes no clear difference to pace yet" : `Each extra 1 kg ≈ ${Math.abs(b).toFixed(1)} s/km ${b > 0 ? "slower" : "faster"}`;
    } else if (y.low) {
      const b = Math.round(fit.slope * MONTH_DAYS);
      headline = b === 0 ? "Pace is holding steady" : `Getting ${b < 0 ? "faster" : "slower"} by about ${clock(Math.abs(b))} /km a month`;
    } else {
      const b = Math.round(fit.slope * MONTH_DAYS * 10) / 10;
      headline = b === 0 ? "Run distance is holding steady" : `Runs getting ${b > 0 ? "longer" : "shorter"} by about ${km1(Math.abs(b))} km a month`;
    }
    summary = `<div class="fdsum">
      <strong>${esc(headline)}</strong>
      <p class="note">${plural(n, "run")} used · R² ${fit.r2.toFixed(2)} · ${esc(span)}</p>
      ${n < CONFIDENT ? `<span class="badge">Low confidence, keep logging</span>` : ""}
    </div>`;
  }
  g.render = () => scatter($(id), p, pts, x, y, fit.slope == null ? null : fit, tags);
  const keys = g.x === "weight" ? `<p class="legend"><span class="key same"></span>Weighed that day <span class="key near"></span>Weight from a nearby day</p>` : "";
  return `<section class="panel fd">${top}${head}<div class="chart scatter" id="${id}"></div>
    ${g.x === "weight" ? ramp("Dot colour:") : ""}${keys}${summary}${countHtml}</section>`;
}

const bandName = (b) => `${+b.lo.toFixed(1)}–${+b.hi.toFixed(1)} kg`;

// Nice round steps for an axis that covers lo..hi with about `ticks` lines.
function axis(lo, hi, steps, ticks) {
  const step = steps.find((s) => (hi - lo) / s <= ticks) || steps[steps.length - 1];
  return { step, min: Math.floor(lo / step) * step, max: Math.ceil(hi / step) * step };
}

// Date axis marks on the 1st of a month, every 1, 2, 3, 6 or 12 months so there are at most `max`.
// January (and the first mark) shows the year.
function monthTicks(lo, hi, max) {
  const a = parse(dayIso(lo)), b = parse(dayIso(hi));
  const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
  const every = [1, 2, 3, 6, 12].find((k) => months / k <= max) || 12, out = [];
  const d = new Date(a.getFullYear(), a.getMonth() + 1, 1);
  while (d.getMonth() % every) d.setMonth(d.getMonth() + 1);
  for (; dayNum(iso(d)) <= hi; d.setMonth(d.getMonth() + every)) {
    const s = iso(d);
    out.push([dayNum(s), fmt(s, out.length && d.getMonth() ? { month: "short" } : { month: "short", year: "2-digit" })]);
  }
  return out;
}

// Tap tip: placed above the point, or below it when there's no room.
function placeTip(tip, W, cx, cy, text) {
  tip.textContent = text;
  tip.hidden = false;
  tip.style.left = Math.max(0, Math.min(W - tip.offsetWidth, cx - tip.offsetWidth / 2)) + "px";
  tip.style.top = (cy - tip.offsetHeight - 12 >= 0 ? cy - tip.offsetHeight - 12 : cy + 14) + "px";
}

function scatter(host, p, pts, xm, ym, fit, tags) {
  const W = host.clientWidth || 320, H = 280, m = { l: 46, r: 14, t: 28, b: 44 };
  lastWidth = W;
  const xs = pts.map(xm.get), ys = pts.map((q) => q[ym.key]);
  const xRoom = Math.max(xm.room, (Math.max(...xs) - Math.min(...xs)) * (xm === X.date ? 0.05 : 0.12)), yRoom = Math.max(ym.room, (Math.max(...ys) - Math.min(...ys)) * 0.12);
  const xa = xm === X.date ? { min: Math.min(...xs) - xRoom, max: Math.max(...xs) + xRoom } : axis(Math.min(...xs) - xRoom, Math.max(...xs) + xRoom, xm.steps, W < 420 ? 4 : 6);
  const ya = axis(Math.max(0, Math.min(...ys) - yRoom), Math.max(...ys) + yRoom, ym.steps, 5);
  const xSpan = xa.max - xa.min;
  const XP = (v) => m.l + ((v - xa.min) / xSpan) * (W - m.l - m.r);
  // Better runs at the top: fewer seconds for pace, more km for distance.
  const YP = (v) => { const t = (v - ya.min) / (ya.max - ya.min); return m.t + (ym.low ? t : 1 - t) * (H - m.t - m.b); };
  const px = (q) => XP(xm.get(q)), py = (q) => YP(q[ym.key]);
  let g = "";
  for (let v = ya.min; v <= ya.max + 1e-9; v += ya.step) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${YP(v)}" y2="${YP(v)}"/><text x="${m.l - 6}" y="${YP(v) + 4}" text-anchor="end">${ym.low ? clock(v) : +v.toFixed(1)}</text>`;
  const xt = (v, t) => `<line class="grid" x1="${XP(v)}" x2="${XP(v)}" y1="${m.t}" y2="${H - m.b}"/><text x="${XP(v)}" y="${H - m.b + 16}" text-anchor="middle">${esc(t)}</text>`;
  if (xm === X.date) g += monthTicks(xa.min, xa.max, W < 420 ? 4 : 7).map(([v, t]) => xt(v, t)).join("");
  else for (let v = xa.min; v <= xa.max + 1e-9; v += xa.step) g += xt(v, +v.toFixed(1));
  let line = "";
  if (fit) {
    const a = Math.min(...xs), b = Math.max(...xs);
    line = `<line class="trend" x1="${XP(a)}" y1="${YP(fit.intercept + fit.slope * a)}" x2="${XP(b)}" y2="${YP(fit.intercept + fit.slope * b)}"/>`;
  }
  // Labels beside the dots: the tagged runs (First / Best / Now) first, then the rest newest first, each with
  // the age when a birth date is set. A label that would overlap another label, a dot or the edge is tried
  // on each side and skipped if it fits nowhere; the tap tip still shows it.
  const boxes = pts.map((q) => ({ x1: px(q) - 6, x2: px(q) + 6, y1: py(q) - 6, y2: py(q) + 6 }));
  const hit = (a) => a.x1 < m.l || a.x2 > W - m.r || a.y1 < m.t || a.y2 > H - m.b || boxes.some((b) => a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2);
  const order = [...tags.keys()].reverse().concat(pts.map((_, i) => i).reverse().filter((i) => !tags.has(i)));
  const labels = order.map((i) => {
    const q = pts[i], age = p.born ? ageText(ageOn(p.born, q.date)) : "", tag = tags.get(i);
    const t = tag ? (age ? `${tag} · ${age}` : tag) : age;
    if (!t) return "";
    const cx = px(q), cy = py(q), w = t.length * 6.4, h = 13;
    for (const [x, y, anchor] of [[cx + 9, cy + 4, "start"], [cx - 9, cy + 4, "end"], [cx, cy - 10, "middle"], [cx, cy + 18, "middle"]]) {
      const x1 = anchor === "start" ? x : anchor === "end" ? x - w : x - w / 2, box = { x1, x2: x1 + w, y1: y - h + 3, y2: y + 3 };
      if (hit(box)) continue;
      boxes.push(box);
      return `<text class="age${tag ? " tagged" : ""}" x="${x}" y="${y}" text-anchor="${anchor}">${esc(t)}</text>`;
    }
    return "";
  }).join("");
  const rings = [...tags.keys()].map((i) => `<circle class="keyring" cx="${px(pts[i])}" cy="${py(pts[i])}" r="9"/>`).join("");
  // Oldest first, so the newest runs sit on top. Hollow dots: weight taken from a nearby day.
  const d0 = dayNum(pts[0].date), span = dayNum(pts[pts.length - 1].date) - d0, hollow = (q) => xm === X.weight && q.gapDays;
  const dots = pts.map((q) => {
    const c = shade(span ? (dayNum(q.date) - d0) / span : 1);
    return `<circle class="${hollow(q) ? "dot near" : "dot"}" style="${hollow(q) ? "stroke" : "fill"}:${c}" cx="${px(q)}" cy="${py(q)}" r="5"/>`;
  }).join("");
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.name)}'s ${ym.low ? "pace" : "distance"} against ${xm === X.weight ? "body weight" : "date"}, ${plural(pts.length, "run")}.">
    ${g}${line}${labels}${rings}${dots}
    <text x="${m.l}" y="14">${esc(ym.axis)}</text>
    <text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">${esc(xm.axis)}</text>
    <circle class="ring" r="9" visibility="hidden"/>
  </svg><div class="tip fdtip" hidden></div>`;

  const svg = host.querySelector("svg"), tip = host.querySelector(".tip"), ring = host.querySelector(".ring");
  const show = (ev) => {
    const { x: ex, y: ey } = toChart(svg, ev);
    const d = (q) => (px(q) - ex) ** 2 + (py(q) - ey) ** 2;
    const q = pts.reduce((best, x) => (d(x) < d(best) ? x : best));
    const cx = px(q), cy = py(q);
    ring.setAttribute("cx", cx); ring.setAttribute("cy", cy); ring.setAttribute("visibility", "visible");
    const kg = q.weightKg == null ? `No weigh-in within ${MAX_GAP_DAYS} days`
      : `${q.weightKg.toFixed(1)} kg, ${q.gapDays ? `weighed ${short(q.weightDate)} (${plural(q.gapDays, "day")} ${q.weightDate < q.date ? "before" : "after"})` : "weighed the same day"}`;
    const age = p.born ? ageText(ageOn(p.born, q.date)) : "";
    const lines = [long(q.date) + (age ? ` · age ${age}` : ""), `${q.km != null ? `${q.km} km at ` : ""}${clock(q.paceSec)} /km${q.hr ? `, avg ${q.hr} bpm` : ""}`, kg];
    if (q.note) lines.push(q.note.length > 80 ? q.note.slice(0, 79) + "…" : q.note);
    const at = toScreen(svg, cx, cy); placeTip(tip, W, at.x, at.y, lines.join("\n"));
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; ring.setAttribute("visibility", "hidden"); });
}

// Weight vs distance: one bar per weight band, height = average km per run, coloured by when those runs were.
function bars(host, p, bands, from, to) {
  const W = host.clientWidth || 320, H = 280, m = { l: 40, r: 14, t: 28, b: 44 };
  lastWidth = W;
  const ya = axis(0, Math.max(...bands.map((b) => b.avgKm || 0)) * 1.18, Y.km.steps, 5);
  const slot = (W - m.l - m.r) / bands.length, bw = Math.max(6, Math.min(56, slot * 0.72));
  const XL = (i) => m.l + i * slot, YP = (v) => H - m.b - (v / ya.max) * (H - m.t - m.b);
  const d0 = dayNum(from), span = dayNum(to) - d0;
  let g = "";
  for (let v = 0; v <= ya.max + 1e-9; v += ya.step) g += `<line class="grid" x1="${m.l}" x2="${W - m.r}" y1="${YP(v)}" y2="${YP(v)}"/><text x="${m.l - 6}" y="${YP(v) + 4}" text-anchor="end">${+v.toFixed(1)}</text>`;
  // Weight marks on the band edges; skip some when the bars are narrow so the numbers don't touch.
  const every = Math.ceil(30 / slot);
  for (let i = 0; i <= bands.length; i += every) {
    const v = i < bands.length ? bands[i].lo : bands[bands.length - 1].hi;
    g += `<text x="${XL(i)}" y="${H - m.b + 16}" text-anchor="middle">${+v.toFixed(1)}</text>`;
  }
  const body = bands.map((b, i) => {
    if (!b.n) return "";
    const cx = XL(i) + slot / 2, top = YP(b.avgKm), c = shade(span ? (b.avgDay - d0) / span : 1);
    const runs = slot >= 40 ? plural(b.n, "run") : `×${b.n}`;
    return `<rect class="bar${b.n < THIN ? " thin" : ""}" x="${cx - bw / 2}" y="${top}" width="${bw}" height="${H - m.b - top}" rx="3" style="fill:${c}"/>
      <text class="val" x="${cx}" y="${top - 18}" text-anchor="middle">${km1(b.avgKm)}</text>
      <text x="${cx}" y="${top - 5}" text-anchor="middle">${runs}</text>`;
  }).join("");
  host.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(p.name)}'s average run distance by body weight, ${plural(bands.filter((b) => b.n).length, "weight band")}.">
    ${g}${body}<line class="axisln" x1="${m.l}" x2="${W - m.r}" y1="${H - m.b}" y2="${H - m.b}"/>
    <rect class="hover" visibility="hidden"/>
    <text x="${m.l}" y="14">Average distance per run, km</text>
    <text x="${(m.l + W - m.r) / 2}" y="${H - 6}" text-anchor="middle">Body weight, kg</text>
  </svg><div class="tip fdtip" hidden></div>`;

  const svg = host.querySelector("svg"), tip = host.querySelector(".tip"), hover = host.querySelector(".hover");
  const show = (ev) => {
    const i = Math.floor((toChart(svg, ev).x - m.l) / slot), b = bands[i];
    if (!b) { tip.hidden = true; hover.setAttribute("visibility", "hidden"); return; }
    for (const [k, v] of Object.entries({ x: XL(i), y: m.t, width: slot, height: H - m.t - m.b })) hover.setAttribute(k, v);
    hover.setAttribute("visibility", "visible");
    const lines = [bandName(b)];
    if (!b.n) lines.push("No runs at this weight");
    else {
      lines.push(`${plural(b.n, "run")}, average ${km1(b.avgKm)} km`);
      if (b.n > 1) lines.push(`Longest ${km1(b.maxKm)} km`);
      lines.push(b.from === b.to ? long(b.from) : `${long(b.from)} to ${long(b.to)}`);
      if (b.n < THIN) lines.push("Few runs, a rough guide");
    }
    const at = toScreen(svg, XL(i) + slot / 2, b.n ? YP(b.avgKm) : H - m.b); placeTip(tip, W, at.x, at.y, lines.join("\n"));
  };
  svg.addEventListener("pointermove", show);
  svg.addEventListener("pointerdown", show);
  svg.addEventListener("pointerleave", () => { tip.hidden = true; hover.setAttribute("visibility", "hidden"); });
}
