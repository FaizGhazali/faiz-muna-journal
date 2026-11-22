// The weight dashboard: one card per person (weight, BMI scale, goal, weight chart, then the part for the
// journal picked on the wheel), the feed of entries below the form, and the BMI notes in the footer.
import { fitnessSeries, perBeat, clock } from "./fitness.js";
import { MOODS, isMood } from "./mood.js";
import { PACE, WEEKLY_MINUTES, r1, bmiOf, range, statusOf } from "./bmi.js";
import { drawWeight, drawFit } from "./weightcharts.js";
import { $, esc, iso, today, fmt } from "./util.js";

let people = () => [], entries = () => [];

export function initWeight(opts) {
  ({ people, entries } = opts);
  let lastWidth = "";
  new ResizeObserver(() => { const w = `${$("people").clientWidth}`; if (w !== lastWidth) { lastWidth = w; drawCharts(); } }).observe($("people"));
  // The fitness chart is hidden in other journals; draw it again at its real width when it shows.
  addEventListener("journalchange", () => drawCharts());
}

function weighIns(p) {
  return entries().filter((e) => e.person === p.id && typeof e.weight === "number").sort((a, b) => a.date.localeCompare(b.date));
}
function weekMinutes(p) {
  const t = new Date(), mon = new Date(t.getFullYear(), t.getMonth(), t.getDate() - ((t.getDay() + 6) % 7));
  const from = iso(mon);
  return entries().filter((e) => e.person === p.id && e.date >= from && e.date <= today() && typeof e.minutes === "number").reduce((a, e) => a + e.minutes, 0);
}
// One point per run that has enough numbers for a score, oldest first.
function fitness(p) {
  return fitnessSeries(entries().filter((e) => e.person === p.id && e.run).map((e) => ({ ...e.run, date: e.date })), p.age);
}

function fitHtml(p) {
  const s = fitness(p), last = s[s.length - 1], prev = s[s.length - 2];
  if (!last) return `<div class="fit"><h3>Fitness</h3><p class="note">Add a COROS run picture to start your fitness line.</p></div>`;
  const d = prev ? r1(last.trend) - r1(prev.trend) : 0;
  const delta = !prev ? `<span class="delta">First run. The line starts here.</span>`
    : Math.abs(d) < 0.05 ? `<span class="delta">Same as last run</span>`
    : `<span class="delta ${d > 0 ? "up" : "down"}">${d > 0 ? "▲" : "▼"} ${Math.abs(d).toFixed(1)} since last run</span>`;
  const facts = [`This run ${last.score.toFixed(1)}`, `${perBeat(last.run).toFixed(2)} m per heartbeat`];
  if (last.run.hrr) facts.push(`recovery ${last.run.hrr} bpm`);
  return `<div class="fit">
    <div class="fithead"><div class="stat"><small>Fitness score</small><b>${last.trend.toFixed(1)}</b></div>${delta}</div>
    <div class="chart" id="fit-${p.id}"></div>
    <p class="week">${esc(facts.join(" · "))}</p>
    <a class="btn more" href="#fitness/${encodeURIComponent(p.id)}">Show more detail</a>
  </div>`;
}

function goalHtml(p, w) {
  const { lo, hi } = range(p);
  if (w == null) return `<strong>Goal: ${lo.toFixed(1)} to ${hi.toFixed(1)} kg</strong><p>Add a weigh-in to see the distance left.</p>`;
  const first = weighIns(p)[0], change = r1(w - first.weight);
  const since = change === 0 ? "" : ` ${change < 0 ? "Down" : "Up"} ${Math.abs(change).toFixed(1)} kg since ${fmt(first.date, { day: "numeric", month: "short" })}.`;
  if (w >= lo && w <= hi) return `<strong>In the normal range</strong><p>Goal met. Stay between ${lo.toFixed(1)} and ${hi.toFixed(1)} kg.${since}</p>`;
  const target = w > hi ? hi : lo, gap = r1(Math.abs(w - target)), weeks = Math.ceil(gap / PACE);
  const t = new Date(); t.setDate(t.getDate() + weeks * 7);
  const when = t.toLocaleDateString(undefined, { month: "short", year: "numeric" });
  return `<strong>${gap.toFixed(1)} kg to ${w > hi ? "lose" : "gain"}</strong><p>Goal: ${target.toFixed(1)} kg, BMI ${w > hi ? "24.9" : "18.5"}. About ${weeks} weeks at ${PACE} kg a week, around ${when}.${since}</p>`;
}

// Each person has one card: weight and BMI on top (every journal), then a part for the journal picked on the wheel.
// #people[data-journal] shows only the matching .pextra. A new journal adds its id here and fills "<id>Slot-<person>".
const JOURNAL_PARTS = ["weight", "meals"];
export function renderPeople() {
  $("people").innerHTML = people().map((p) => {
    const pts = weighIns(p), w = pts.length ? pts[pts.length - 1].weight : null;
    const b = w == null ? null : bmiOf(p, w), s = b == null ? null : statusOf(b);
    const pos = b == null ? 0 : Math.max(0, Math.min(100, ((b - 15) / 20) * 100));
    return `<article class="person">
      <div class="who"><h2>${esc(p.name)}</h2><span>${esc(p.age)} · ${esc(p.sex)} · ${esc(p.cm)} cm</span></div>
      <div class="stats">
        <div class="stat"><small>Weight</small><b>${w == null ? "–" : w.toFixed(1)}</b><i>kg</i></div>
        <div class="stat"><small>BMI</small><b>${b == null ? "–" : b.toFixed(1)}</b></div>
        ${s ? `<span class="pill" style="--c:var(${s.c})">${s.t}</span>` : ""}
      </div>
      <div class="scale" aria-label="BMI scale${b == null ? "" : `, currently ${b.toFixed(1)}, ${s.t}`}">
        <div class="bands">
          <div style="--c:var(--under)">Under</div><div style="--c:var(--good)">Normal</div><div style="--c:var(--over)">Over</div><div style="--c:var(--obese)">Obese</div>
        </div>
        ${b == null ? "" : `<div class="marker" style="left:${pos}%"></div>`}
        <span class="cut" style="left:17.5%">18.5</span><span class="cut" style="left:50%">25</span><span class="cut" style="left:75%">30</span>
      </div>
      <div class="goal">${goalHtml(p, w)}</div>
      <div class="chart" id="chart-${p.id}"></div>
      ${JOURNAL_PARTS.map((j) => `<div class="pextra" data-journal="${j}" data-pid="${p.id}"${j === "weight" ? "" : ` id="${j}Slot-${p.id}"`}>${j === "weight" ? `${fitHtml(p)}
        <p class="week"><b>${weekMinutes(p)}</b> of ${WEEKLY_MINUTES} exercise minutes this week</p>` : ""}</div>`).join("")}
    </article>`;
  }).join("");
  drawCharts();
}

export function drawCharts() {
  people().forEach((p) => {
    const el = $("chart-" + p.id), fit = $("fit-" + p.id);
    if (el) drawWeight(el, p, weighIns(p));
    if (fit) drawFit(fit, p, fitness(p));
  });
}

// Every entry, newest day first, with Edit / Delete (handled by entryform.js).
export function renderFeed() {
  const feed = $("feed"), list = entries();
  if (!list.length) { feed.innerHTML = `<p class="note">No entries yet. Save your first entry with the form.</p>`; return; }
  const days = [...new Set(list.map((e) => e.date))].sort().reverse();
  feed.innerHTML = days.map((d) => `<section class="day"><h3>${esc(fmt(d, { weekday: "long", day: "numeric", month: "long", year: "numeric" }))}</h3>
    ${list.filter((e) => e.date === d).sort((a, b) => a.person.localeCompare(b.person)).map(entryHtml).join("")}</section>`).join("");
}
function entryHtml(e) {
  const p = people().find((x) => x.id === e.person), facts = [];
  if (typeof e.weight === "number") facts.push(`${e.weight.toFixed(1)} kg, BMI ${bmiOf(p, e.weight).toFixed(1)}`);
  if (e.run) facts.push(`${e.run.km} km run in ${clock(e.run.secs)}${e.run.hr ? `, ${e.run.hr} bpm` : ""}`);
  else if (typeof e.minutes === "number") facts.push(`${e.minutes} min exercise`);
  if (isMood(e.mood)) facts.push(`${facts.length ? "felt" : "Felt"} ${MOODS[e.mood].word.toLowerCase()}`);
  const btns = `<button class="mini" data-act="edit" data-id="${esc(e.id)}">Edit</button><button class="mini" data-act="del" data-id="${esc(e.id)}">Delete</button>`;
  return `<div class="entry"><div class="name">${esc(p.name)}</div>
    <div><div class="facts">${esc(facts.join(" · ") || "Note")}</div>${e.note ? `<p class="text">${esc(e.note)}</p>` : ""}</div>
    <div class="btns">${btns}</div></div>`;
}

export function renderFoot() {
  $("foot").innerHTML = `<p>BMI is weight in kg divided by height in metres squared. Ranges follow the WHO adult cut-offs. Many Asian guidelines, including Malaysia's, put the top of normal lower at 22.9, which is ${people().map((p) => `${range(p).asian.toFixed(1)} kg for ${esc(p.name)}`).join(" and ")}.</p>
    <p>The fitness score compares how fast a run was with how hard the heart worked for it, with a small bonus for quick heart rate recovery. Faster at the same heart rate, or the same pace at a lower one, moves it up. It's an estimate for watching your own trend, not a medical measure.</p>
    <p>BMI doesn't separate muscle from fat, so read it alongside how you feel and what a doctor tells you.</p>`;
}
