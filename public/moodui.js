// The "Yesterday" mood card on the dashboard and the Mood history page at #mood.
// Each person rates their own day (1 to 5); it's saved as `mood` on entries/{person}_{date} (merged, so
// weight, run and note on that day are untouched). The numbers are worked out in mood.js.
import { doc, setDoc } from "./fs.js";
import { MOODS, isMood, quoteFor, moodMap, lastSeven, periods, boosters, yearGrid, moodMix, VIEWS, MIN_DAYS } from "./mood.js";
import { iso, parse, addDays } from "./suggest.js";

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const today = () => iso(new Date());
const fmt = (s, o) => parse(s).toLocaleDateString(undefined, o);
const MONTHS = Array.from({ length: 12 }, (_, m) => new Date(2000, m, 1).toLocaleDateString(undefined, { month: "short" }));

let db, people, entries, me, habitFacts, commit;
let pickDay = null, year = null, fromApp = false, lastPid = null;
// Mood mix card inside Year in pixels: closed until a day is tapped. First tap → that month, same day again → its week.
let mixOpen = false, view = "month", anchor = null;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

// A small face: colour and mouth by mood, an outline when not rated.
const MOUTH = { 1: "M7.5 17 Q12 12.5 16.5 17", 2: "M8 16.5 Q12 14.2 16 16.5", 3: "M8 15.5 H16", 4: "M7.8 14.5 Q12 18 16.2 14.5", 5: "M7 13.6 Q12 20.5 17 13.6 Z" };
export function face(v, size = 40) {
  const on = isMood(v), ink = !on ? "var(--muted)" : v === 1 ? "#fff" : "#1b1e2c";
  return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="${on ? `var(--m${v})` : "none"}" stroke="${on ? "none" : "var(--muted)"}" stroke-width="1.2" ${on ? "" : 'stroke-dasharray="2.5 2"'}/>
    <circle cx="8.5" cy="10" r="1.3" fill="${ink}"/><circle cx="15.5" cy="10" r="1.3" fill="${ink}"/>
    <path d="${MOUTH[on ? v : 3]}" fill="${v === 5 ? ink : "none"}" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
const faces = (sel, attr) => `<div class="mfaces" role="group" aria-label="Pick a mood">${[1, 2, 3, 4, 5].map((v) =>
  `<button type="button" class="mface" ${attr}="${v}" aria-pressed="${sel === v}" aria-label="${MOODS[v].label}">${face(v, 34)}</button>`).join("")}</div>`;
const one = (n) => (n == null ? "–" : n.toFixed(1));

export function initMood(opts) {
  ({ db, people, entries, me, habitFacts, commit } = opts);
  window.addEventListener("hashchange", (ev) => {
    if (location.hash !== "#mood") return;
    if (new URL(ev.oldURL).hash !== "#mood") { fromApp = true; window.scrollTo(0, 0); }
    pickDay = null; year = null; mixOpen = false;
    refreshMood();
  });
  $("moodCard").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-mood]");
    if (b) rate(addDays(today(), -1), Number(b.dataset.mood));
  });
  $("mdBack").addEventListener("click", () => { if (fromApp) { fromApp = false; history.back(); } else location.hash = ""; });
  $("mdYear").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pick], [data-year], [data-rate], [data-step], [data-view], [data-go], [data-close]");
    if (!b) return;
    if (b.dataset.pick) {
      const d = b.dataset.pick, again = mixOpen && d === pickDay;
      if (!again) view = "month";
      else if (view === "month") view = "week";
      pickDay = anchor = d;
      if (!mixOpen) { mixOpen = true; requestAnimationFrame(() => $("mdMix").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "nearest" })); }
    }
    if (b.dataset.year) { year = Number(b.dataset.year); pickDay = null; mixOpen = false; }
    if (b.dataset.step) {
      const d = addDays(pickDay, Number(b.dataset.step));
      if (d <= today()) { pickDay = d; year = parse(d).getFullYear(); if (mixOpen) anchor = d; }
    }
    if (b.dataset.view) view = b.dataset.view;
    if (b.dataset.go) anchor = b.dataset.go;
    if ("close" in b.dataset) mixOpen = false;
    if (b.dataset.rate) { rate(pickDay, Number(b.dataset.rate)); return; }
    renderPage();
  });
}

function rate(date, v) {
  const pid = me();
  if (!pid || !isMood(v) || date > today()) return;
  commit(() => setDoc(doc(db, "entries", `${pid}_${date}`), { person: pid, date, mood: v }, { merge: true }));
}

// Called when entries, habits or the selected person change.
export function refreshMood() {
  if (!people().length || !me()) return;
  if (me() !== lastPid) { lastPid = me(); pickDay = null; }
  renderCard();
  if (location.hash === "#mood") renderPage();
}

// What else happened on each day, for the card's reminder line and for "What goes with good days".
function dayFacts(pid) {
  const out = habitFacts(pid);
  for (const e of entries()) {
    if (e.person !== pid) continue;
    const f = (out[e.date] ||= {});
    if (e.run || e.minutes > 0) { f.ran = true; f.km = e.run?.km; f.minutes = e.minutes; }
    if (typeof e.weight === "number") f.weighed = true;
  }
  return out;
}

function renderCard() {
  const pid = me(), y = addDays(today(), -1), map = moodMap(entries(), pid), v = map[y] ?? null;
  const f = dayFacts(pid)[y] || {}, bits = [];
  if (f.ran) bits.push(f.km ? `${f.km} km run` : `${f.minutes} min exercise`);
  if (f.habitsDue) bits.push(`${f.habitsDone} of ${f.habitsDue} habits`);
  const week = lastSeven(map, y);
  $("moodCard").innerHTML = `<div class="hhead"><p class="eyebrow">Yesterday</p><span class="mdate">${esc(fmt(y, { weekday: "short", day: "numeric", month: "short" }))}</span></div>
    <div class="mnow">${face(v, 46)}<div><strong${v ? "" : ' class="unrated"'}>${v ? MOODS[v].label : "Not rated yet"}</strong><small>${esc(bits.join(" · ") || "Nothing logged")}</small></div></div>
    <p class="mquote">“${esc(quoteFor(v, today(), pid))}”</p>
    <div class="mpick"><p class="mask">${v ? "Change your answer" : "How was yesterday?"}</p>${faces(v, "data-mood")}</div>
    <div class="mfoot"><span>${week == null ? "" : `7-day average ${one(week)}`}</span><a href="#mood">Mood history →</a></div>`;
}

function renderPage() {
  const pid = me(), p = people().find((x) => x.id === pid), map = moodMap(entries(), pid), t = today();
  if (!pickDay) pickDay = year && year < parse(t).getFullYear() ? `${year}-12-31` : addDays(t, -1);
  if (!year) year = parse(pickDay).getFullYear();
  // While the Mood mix is open, Year in pixels shows its year and lights up only the days it counts.
  const mix = mixOpen ? moodMix(map, view, anchor || t, t) : null;
  if (mix) year = parse(anchor || t).getFullYear();
  const inMix = (d) => (mix && d >= mix.from && d <= mix.to ? " inmix" : "");
  $("mdTitle").textContent = `${p.name}'s mood`;

  // How you've been: this week, month and year.
  const P = periods(map, t);
  const delta = (now, before, what) => now == null || before == null ? `<small>&nbsp;</small>`
    : Math.abs(now - before) < 0.05 ? `<small>Same as ${what}</small>`
    : `<small class="${now > before ? "up" : "down"}">${now > before ? "▲" : "▼"} ${Math.abs(now - before).toFixed(1)} vs ${what}</small>`;
  const tile = (tag, n, extra) => `<div class="fdtile"><span class="fdtag">${tag}</span><div class="mtile">${n == null ? "" : face(Math.round(n), 22)}<strong>${one(n)}</strong></div>${extra}</div>`;
  $("mdTiles").innerHTML = tile("This week", P.week.now, delta(P.week.now, P.week.before, "last week"))
    + tile("This month", P.month.now, delta(P.month.now, P.month.before, "last month"))
    + tile("This year", P.year.now, P.year.good == null ? `<small>&nbsp;</small>` : `<small>${Math.round(P.year.good * 100)}% good or great</small>`);

  // Year in pixels: one row per month, one square per day.
  const years = Object.keys(map).map((d) => Number(d.slice(0, 4)));
  const first = Math.min(parse(t).getFullYear(), ...years), last = parse(t).getFullYear();
  const grid = yearGrid(map, year, t);
  const rated = Object.keys(map).filter((d) => d.startsWith(year + "-")).length;
  const pv = map[pickDay] ?? null;
  if (!$("mdPix")) $("mdYear").innerHTML = `<div id="mdPix" class="fd"></div><div id="mdMix" class="mmix" hidden></div><div id="mdDay" class="mday"></div>`;
  $("mdPix").innerHTML = `<div class="fdhead"><h3 class="fdtitle">Year in pixels</h3>
      <div class="myear"><button type="button" class="mini" data-year="${year - 1}"${year > first ? "" : " disabled"} aria-label="Previous year">‹</button><b>${year}</b><button type="button" class="mini" data-year="${year + 1}"${year < last ? "" : " disabled"} aria-label="Next year">›</button></div></div>
    <p class="note">${rated ? `${rated} day${rated > 1 ? "s" : ""} rated. ` : ""}Tap a day to see the mood mix for its month, and again for its week.</p>
    <div class="pixels${mix ? " mixing" : ""}" role="grid" aria-label="Mood for each day of ${year}">
      <span class="pxmon"></span>${Array.from({ length: 31 }, (_, i) => `<span class="pxday">${[1, 10, 20, 30].includes(i + 1) ? i + 1 : ""}</span>`).join("")}
      ${grid.map((days, m) => `<span class="pxmon">${esc(MONTHS[m])}</span>${days.map((c) => c.future
        ? `<i class="px future${inMix(c.date)}"></i>`
        : `<button type="button" class="px${c.date === pickDay ? " on" : ""}${inMix(c.date)}" data-pick="${c.date}" style="${c.mood ? `background:var(--m${c.mood})` : ""}" aria-label="${esc(fmt(c.date, { day: "numeric", month: "long" }))}: ${c.mood ? MOODS[c.mood].word : "not rated"}"></button>`).join("")}`).join("")}
    </div>
    <div class="mlegend">${[5, 4, 3, 2, 1].map((v) => `<span><i style="background:var(--m${v})"></i>${MOODS[v].word}</span>`).join("")}<span><i class="none"></i>Not rated</span></div>
`;
  renderMix(map, t);
  $("mdDay").innerHTML = `
      <div class="mdayhead"><button type="button" class="mini" data-step="-1" aria-label="Day before">‹</button>
        <div class="mnow">${face(pv, 34)}<div><strong>${esc(fmt(pickDay, { weekday: "long", day: "numeric", month: "long" }))}</strong><small>${pv ? MOODS[pv].label : "Not rated"}</small></div></div>
        <button type="button" class="mini" data-step="1"${pickDay < t ? "" : " disabled"} aria-label="Day after">›</button></div>
      ${faces(pv, "data-rate")}`;

  // What goes with good days.
  const B = boosters(map, dayFacts(pid)), bar = (v, cls) => `<div class="mbar ${cls}"><i style="width:${((v - 1) / 4) * 100}%"></i></div><span>${v.toFixed(1)}</span>`;
  $("mdBoost").innerHTML = `<h3 class="fdtitle">What goes with your good days</h3>
    <p class="note">Your average mood on days with and without each thing.</p>
    ${B.days < MIN_DAYS
      ? `<p class="mwait">Rate ${MIN_DAYS - B.days} more day${MIN_DAYS - B.days > 1 ? "s" : ""} to see this. It needs about two weeks of ratings to be fair.</p>`
      : B.rows.length ? B.rows.map((r) => `<div class="mboost">
          <div class="mbhead"><span>${esc(r.label)}</span><b class="${r.diff >= 0.15 ? "up" : r.diff <= -0.15 ? "down" : ""}">${Math.abs(r.diff) < 0.15 ? "No real difference" : `${r.diff > 0 ? "+" : "−"}${Math.abs(r.diff).toFixed(1)}`}</b></div>
          <div class="mbrow"><small>With</small>${bar(r.with, "with")}</div>
          <div class="mbrow"><small>Without</small>${bar(r.without, "without")}</div>
        </div>`).join("") + `<p class="note">Based on ${B.days} rated days. It shows what tends to go together, not what causes what.</p>`
      : `<p class="mwait">Not enough mixed days yet. Keep rating and logging, and this fills in.</p>`}`;
}

// Mood mix card: one bar per mood (hard → great), height = how many days of it in the week, month or year.
// Built once and then updated in place, so bars grow and numbers count smoothly when the period changes.
function renderMix(map, t) {
  const box = $("mdMix");
  if (!mixOpen) { box.hidden = true; return; }
  if (!box.firstChild) box.innerHTML = `<div class="fdhead"><h4 class="mmtitle">Mood mix</h4><button type="button" class="mini" data-close aria-label="Close mood mix">✕</button></div>
    <div class="chips" role="group" aria-label="Show">${VIEWS.map((v) => `<button type="button" class="chip" data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
    <div class="myear"><button type="button" class="mini" data-go aria-label="Before">‹</button><b class="mmrange" aria-live="polite"></b><button type="button" class="mini" data-go aria-label="After">›</button></div>
    <div class="mmbars">${[1, 2, 3, 4, 5].map((v) => `<div class="mmcol" data-v="${v}"><b class="mmn">0</b><span class="mmbar" style="background:var(--m${v})"></span>${face(v, 26)}<small>${MOODS[v].word}</small></div>`).join("")}</div>
    <p class="note mmsum"></p>`;
  const wasHidden = box.hidden;
  box.hidden = false;
  if (wasHidden && !calm()) box.animate([{ opacity: 0, transform: "translateY(-6px)" }, { opacity: 1, transform: "none" }], { duration: 260, easing: "ease-out" });

  const c = moodMix(map, view, anchor || t, t), first = Object.keys(map).sort()[0] || t;
  const range = view === "year" ? c.from.slice(0, 4)
    : view === "month" ? fmt(c.from, { month: "long", year: "numeric" })
    : `${fmt(c.from, { day: "numeric", month: "short" })} – ${fmt(c.to, { day: "numeric", month: "short" })}`;
  box.querySelectorAll("[data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === view));
  const [prev, next] = box.querySelectorAll("[data-go]");
  prev.dataset.go = c.prev; prev.disabled = c.from <= first;
  next.dataset.go = c.next || ""; next.disabled = !c.next;
  swap(box.querySelector(".mmrange"), range);

  // Opening: start every bar at zero so they grow in.
  if (wasHidden) { box.querySelectorAll(".mmcol").forEach((col) => { col.querySelector(".mmbar").style.height = "calc((100% - 80px) * 0)"; col.querySelector(".mmn").textContent = "0"; }); box.offsetHeight; }
  const top = Math.max(1, ...c.counts.slice(1));
  box.querySelectorAll(".mmcol").forEach((col) => {
    const v = Number(col.dataset.v), n = c.counts[v];
    col.querySelector(".mmbar").style.height = `calc((100% - 80px) * ${(n / top).toFixed(3)})`;
    col.classList.toggle("zero", !n);
    count(col.querySelector(".mmn"), n);
    col.setAttribute("aria-label", `${MOODS[v].word}: ${n} day${n === 1 ? "" : "s"}`);
  });
  const hint = view === "month" ? "Tap the same day again to see its week." : view === "week" ? "Tap another day to see its month." : "";
  swap(box.querySelector(".mmsum"), c.rated
    ? `${c.rated} of ${c.days} day${c.days === 1 ? "" : "s"} rated, average ${one(c.avg)} (${MOODS[Math.round(c.avg)].word.toLowerCase()}). ${hint}`
    : `No days rated here yet. ${hint}`);
}

// Fade in new text only when it changes.
function swap(el, text) {
  if (el.textContent === text) return;
  el.textContent = text;
  if (!calm()) el.animate([{ opacity: 0, transform: "translateY(3px)" }, { opacity: 1, transform: "none" }], { duration: 220, easing: "ease-out" });
}
// Count a number up or down to its new value.
function count(el, to) {
  const from = Number(el.textContent) || 0;
  cancelAnimationFrame(el._raf);
  if (from === to || calm()) { el.textContent = to; return; }
  const t0 = performance.now(), step = (now) => {
    const k = Math.min(1, (now - t0) / 450), e = 1 - (1 - k) ** 3;
    el.textContent = Math.round(from + (to - from) * e);
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}
