// The "Yesterday" mood card and the "Reflect" card on the dashboard, and the Mood history page at #mood.
// Each person rates their own day (1 to 5); it's saved as `mood` on entries/{person}_{date} (merged, so
// weight, run and note on that day are untouched). A mood picked on a diary entry (Dearly) counts too: the day's
// mood is the average of every mood given that day (dayMoods / moodMap in mood.js). Tapping a day on Year in
// pixels opens its flashcard: the mood plus what happened (diary, run, weight, habits). Reflections: reflect.js.
import { doc, setDoc } from "../../core/fs.js";
import { MOODS, isMood, quoteFor, moodMap, dayMoods, lastSeven, periods, boosters, yearGrid, moodMix, VIEWS, MIN_DAYS } from "../../logic/mood.js";
import { reflections, pickReflection } from "../../logic/reflect.js";
import { face } from "../../core/face.js";
import { canEdit, viewOnly } from "../../core/owner.js";
import { titleOf, bodyText, prettyDate, words } from "../../logic/diary.js";
import { $, esc, iso, parse, addDays, today, fmt } from "../../core/util.js";
import { ico } from "../../core/icons.js";

const MONTHS = Array.from({ length: 12 }, (_, m) => new Date(2000, m, 1).toLocaleDateString(undefined, { month: "short" }));

let db, people, entries, diary, me, habitFacts, commit;
let pickDay = null, year = null, fromApp = false, lastPid = null, pendingDay = null, shownDay = null, skip = 0;
// Mood mix card inside Year in pixels: closed until a day is tapped. First tap → that month, same day again → its week.
let mixOpen = false, view = "month", anchor = null;
// The day's diary list shows FEW entries until "Show all" is tapped; tapping one opens it in a pop-up (readEntry).
const FEW = 3;
let allPages = false;
const calm = () => matchMedia("(prefers-reduced-motion: reduce)").matches;

const faces = (sel, attr) => `<div class="mfaces" role="group" aria-label="Pick a mood">${[1, 2, 3, 4, 5].map((v) =>
  `<button type="button" class="mface" ${attr}="${v}" aria-pressed="${sel === v}" aria-label="${MOODS[v].label}">${face(v, 34)}</button>`).join("")}</div>`;
const one = (n) => (n == null ? "–" : n.toFixed(1));

export function initMood(opts) {
  ({ db, people, entries, me, habitFacts, commit } = opts);
  diary = opts.diary || (() => []);
  window.addEventListener("hashchange", (ev) => {
    if (location.hash !== "#mood") return;
    if (new URL(ev.oldURL).hash !== "#mood") { fromApp = true; window.scrollTo(0, 0); }
    pickDay = pendingDay; year = null; mixOpen = false; shownDay = null;
    refreshMood();
    if (pendingDay) { pendingDay = null; requestAnimationFrame(() => $("mdDay")?.scrollIntoView({ behavior: "auto", block: "center" })); }
  });
  // Dashboard reflection: "Another" shows the next one; "See the day" opens its flashcard on the Mood page.
  $("reflectCard").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-another], [data-day], [data-read]");
    if (!b) return;
    if ("another" in b.dataset) { skip++; renderReflect(); return; }
    if (b.dataset.read) { readEntry(b.dataset.read); return; }
    openDay(b.dataset.day);
  });
  $("mdReflect").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-day], [data-read]");
    if (!b) return;
    if (b.dataset.read) { readEntry(b.dataset.read); return; }
    pickDay = b.dataset.day; year = parse(pickDay).getFullYear();
    renderPage();
    $("mdDay").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "center" });
  });
  $("moodCard").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-mood]");
    if (b) rate(addDays(today(), -1), Number(b.dataset.mood));
  });
  $("mdBack").addEventListener("click", () => { if (fromApp) { fromApp = false; history.back(); } else location.hash = ""; });
  $("mdYear").addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-pick], [data-year], [data-rate], [data-step], [data-view], [data-go], [data-close], [data-read], [data-allpages]");
    if (!b) return;
    if (b.dataset.read) { readEntry(b.dataset.read); return; }
    if ("allpages" in b.dataset) { allPages = !allPages; renderDay(me(), moods(), today()); return; }
    if (b.dataset.pick) {
      const d = b.dataset.pick, again = mixOpen && d === pickDay;
      if (!again) view = "month";
      else if (view === "month") view = "week";
      pickDay = anchor = d;
      mixOpen = true;
      requestAnimationFrame(() => $("mdDay").scrollIntoView({ behavior: calm() ? "auto" : "smooth", block: "nearest" }));
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

// Open the Mood page on one day's flashcard.
export function openDay(date) {
  if (location.hash === "#mood") { pickDay = date; year = parse(date).getFullYear(); renderPage(); $("mdDay").scrollIntoView({ block: "center" }); return; }
  pendingDay = date; location.hash = "#mood";
}

function rate(date, v) {
  const pid = me();
  if (!pid || !canEdit(pid) || !isMood(v) || date > today()) return; // each person rates only their own days
  commit(() => setDoc(doc(db, "entries", `${pid}_${date}`), { person: pid, date, mood: v, moodAt: Date.now() }, { merge: true }));
}

// Called when entries, habits or the selected person change.
export function refreshMood() {
  if (!people().length || !me()) return;
  if (me() !== lastPid) { lastPid = me(); pickDay = null; }
  renderCard();
  renderReflect();
  if (location.hash === "#mood") renderPage();
}

const mine = () => diary().filter((e) => e.person === me() && !e.deleted);
const moods = () => moodMap(entries(), me(), diary());
// "Average 3.5 of 2 diary entries and your rating", "From your diary", or "".
function madeOf(m) {
  if (!m || m.n < 2) return m?.diary.length === 1 && !m.rating ? "From your diary" : "";
  const d = m.diary.length, bits = [d ? `${d} diary ${d === 1 ? "entry" : "entries"}` : "", m.rating ? "your rating" : ""].filter(Boolean);
  return `Average ${m.avg.toFixed(1)} of ${bits.join(" and ")}`;
}

// The reflection cards for this person, from reflect.js.
const cards = () => reflections({ map: moods(), diary: mine(), facts: dayFacts(me()), today: today() });
const ICON = { comfort: "heart", past: "story", bright: "sun", trend: "trend", pattern: "search", streak: "pen", month: "calendar", empty: "sprout" };
function reflectHtml(c, dash) {
  const go = [c.entry ? `<button type="button" class="rgo" data-read="${esc(c.entry)}">Read entry</button>` : "", c.date ? `<button type="button" class="rgo" data-day="${esc(c.date)}">See the day</button>` : ""].join("");
  const h = dash ? "h3" : "h4";
  return `<article class="rcard" style="--rc:${isMood(c.mood) ? `var(--m${c.mood})` : "var(--line)"}">
    <div class="rhead"><span class="ricon" aria-hidden="true">${ico(ICON[c.kind] || "thought")}</span><${h} class="rtitle">${esc(c.title)}</${h}>${isMood(c.mood) ? face(c.mood, 22) : ""}</div>
    <p class="rtext">${esc(c.text)}</p>${go ? `<div class="rgos">${go}</div>` : ""}</article>`;
}
function renderReflect() {
  const all = cards(), c = pickReflection(all, today(), me(), skip);
  $("reflectCard").innerHTML = `<div class="hhead"><p class="eyebrow">Reflect</p>${all.length > 1 ? `<button type="button" class="mini" data-another>Another</button>` : ""}</div>
    ${c ? reflectHtml(c, true) : ""}
    <div class="mfoot"><span>${all.length > 1 ? `${all.indexOf(c) + 1} of ${all.length}` : ""}</span><a href="#mood">All reflections →</a></div>`;
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
  const pid = me(), y = addDays(today(), -1), map = moods(), v = map[y] ?? null;
  const m = dayMoods(entries(), pid, diary())[y], f = dayFacts(pid)[y] || {}, bits = [];
  if (madeOf(m)) bits.push(madeOf(m));
  if (f.ran) bits.push(f.km ? `${f.km} km run` : `${f.minutes} min exercise`);
  if (f.habitsDue) bits.push(`${f.habitsDone} of ${f.habitsDue} habits`);
  const week = lastSeven(map, y);
  $("moodCard").innerHTML = `<div class="hhead"><p class="eyebrow">Yesterday</p><span class="mdate">${esc(fmt(y, { weekday: "short", day: "numeric", month: "short" }))}</span></div>
    <div class="mnow">${face(v, 46)}<div><strong${v ? "" : ' class="unrated"'}>${v ? MOODS[v].label : "Not rated yet"}</strong><small>${esc(bits.join(" · ") || "Nothing logged")}</small></div></div>
    ${v || canEdit(pid) ? `<p class="mquote">“${esc(quoteFor(v, today(), pid))}”</p>` : ""}
    ${canEdit(pid) ? `<div class="mpick"><p class="mask">${m?.rating ? "Change your answer" : v ? "Add your own rating" : "How was yesterday?"}</p>${faces(m?.rating ?? null, "data-mood")}</div>` : viewOnly(pid, "mood")}
    <div class="mfoot"><span>${week == null ? "" : `7-day average ${one(week)}`}</span><a href="#mood">Mood history →</a></div>`;
}

function renderPage() {
  const pid = me(), p = people().find((x) => x.id === pid), map = moods(), t = today();
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
  if (!$("mdPix")) $("mdYear").innerHTML = `<div id="mdPix" class="fd"></div><div id="mdDay" class="mday"></div><div id="mdMix" class="mmix" hidden></div>`;
  $("mdPix").innerHTML = `<div class="fdhead"><h3 class="fdtitle">Year in pixels</h3>
      <div class="myear"><button type="button" class="mini" data-year="${year - 1}"${year > first ? "" : " disabled"} aria-label="Previous year">‹</button><b>${year}</b><button type="button" class="mini" data-year="${year + 1}"${year < last ? "" : " disabled"} aria-label="Next year">›</button></div></div>
    <p class="note">${rated ? `${rated} day${rated > 1 ? "s" : ""} rated. ` : ""}Tap a day to see what happened and the mood mix for its month; tap it again for its week.</p>
    <div class="pixels${mix ? " mixing" : ""}" role="grid" aria-label="Mood for each day of ${year}">
      <span class="pxmon"></span>${Array.from({ length: 31 }, (_, i) => `<span class="pxday">${[1, 10, 20, 30].includes(i + 1) ? i + 1 : ""}</span>`).join("")}
      ${grid.map((days, m) => `<span class="pxmon">${esc(MONTHS[m])}</span>${days.map((c) => c.future
        ? `<i class="px future${inMix(c.date)}"></i>`
        : `<button type="button" class="px${c.date === pickDay ? " on" : ""}${inMix(c.date)}" data-pick="${c.date}" style="${c.mood ? `background:var(--m${c.mood})` : ""}" aria-label="${esc(fmt(c.date, { day: "numeric", month: "long" }))}: ${c.mood ? MOODS[c.mood].word : "not rated"}"></button>`).join("")}`).join("")}
    </div>
    <div class="mlegend">${[5, 4, 3, 2, 1].map((v) => `<span><i style="background:var(--m${v})"></i>${MOODS[v].word}</span>`).join("")}<span><i class="none"></i>Not rated</span></div>
`;
  renderMix(map, t);
  renderDay(pid, map, t);

  // Reflections: every looking-back card the engine has for this person.
  $("mdReflect").innerHTML = `<h3 class="fdtitle">Reflections</h3>
    <p class="note">Looking back over your moods, diary and logs. They change as you write and rate.</p>
    <div class="rlist">${cards().map((c) => reflectHtml(c, false)).join("")}</div>`;

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

// The day's flashcard: its mood (and what it's an average of) and what happened: diary entries, run, weight,
// note, habits, Next Move. It flips in each time a new day is picked.
function renderDay(pid, map, t) {
  const d = pickDay, pv = map[d] ?? null, m = dayMoods(entries(), pid, diary())[d];
  const e = entries().find((x) => x.person === pid && x.date === d) || {}, f = dayFacts(pid)[d] || {};
  const pages = mine().filter((x) => x.date === d).sort((a, b) => (a.created || 0) - (b.created || 0));
  const did = [];
  if (e.run) did.push(["pulse", `Ran ${e.run.km} km${e.run.secs ? ` in ${Math.round(e.run.secs / 60)} min` : ""}${e.run.hr ? `, ${e.run.hr} bpm` : ""}`]);
  else if (e.minutes > 0) did.push(["pulse", `${e.minutes} min exercise`]);
  if (typeof e.weight === "number") did.push(["scale", `Weighed ${e.weight} kg`]);
  if (f.habitsDue) did.push(["ok", `${f.habitsDone} of ${f.habitsDue} habits`]);
  if (f.move) did.push(["next", "Did a Next Move"]);
  if (e.note) did.push(["note", e.note]);
  if (shownDay !== d) allPages = false;
  const box = $("mdDay");
  box.innerHTML = `<div class="flash">
      <div class="mdayhead"><button type="button" class="mini" data-step="-1" aria-label="Day before">‹</button>
        <div class="mnow">${face(pv, 40)}<div><strong>${esc(fmt(d, { weekday: "long", day: "numeric", month: "long" }))}</strong><small>${pv ? MOODS[pv].label : "Not rated"}${madeOf(m) ? ` · ${esc(madeOf(m))}` : ""}</small></div></div>
        <button type="button" class="mini" data-step="1"${d < t ? "" : " disabled"} aria-label="Day after">›</button></div>
      ${pages.length ? `<div class="fpages">
        ${pages.length > 1 ? `<p class="fphead">${ico("book")} ${pages.length} diary entries</p>` : ""}
        ${(allPages ? pages : pages.slice(0, FEW)).map((x) => `<button type="button" class="fpage" data-read="${esc(x.id)}">${isMood(x.mood) ? face(x.mood, 22) : `<span class="fdot" aria-hidden="true">${ico("book")}</span>`}<b>${esc(titleOf(x))}</b><span class="fgo" aria-hidden="true">›</span></button>`).join("")}
        ${pages.length > FEW ? `<button type="button" class="linkbtn fmore" data-allpages aria-expanded="${allPages}">${allPages ? "Show fewer" : `Show all ${pages.length}`}</button>` : ""}
      </div>` : ""}
      ${did.length ? `<ul class="fdid">${did.map(([i, s]) => `<li><span aria-hidden="true">${ico(i)}</span>${esc(s)}</li>`).join("")}</ul>` : ""}
      ${!pages.length && !did.length ? `<p class="note">Nothing written or logged this day.</p>` : ""}
      ${canEdit(pid) ? `<p class="mask">${m?.rating ? "Your rating for the day" : "Rate this day"}</p>${faces(m?.rating ?? null, "data-rate")}` : viewOnly(pid, "mood")}
    </div>`;
  if (shownDay !== d && shownDay !== null && !calm()) box.firstElementChild.animate([{ opacity: 0, transform: "perspective(700px) rotateX(-70deg)" }, { opacity: 1, transform: "none" }], { duration: 380, easing: "cubic-bezier(.2,.8,.2,1)" });
  shownDay = d;
}

// Mood mix card: one bar per mood (hard → great), height = how many days of it in the week, month or year.
// Built once and then updated in place, so bars grow and numbers count smoothly when the period changes.
function renderMix(map, t) {
  const box = $("mdMix");
  if (!mixOpen) { box.hidden = true; return; }
  if (!box.firstChild) box.innerHTML = `<div class="fdhead"><h4 class="mmtitle">Mood mix</h4><button type="button" class="mini" data-close aria-label="Close mood mix">✕</button></div>
    <div class="chips" role="group" aria-label="Show">${VIEWS.map((v) => `<button type="button" class="chip" data-view="${v}">${v[0].toUpperCase() + v.slice(1)}</button>`).join("")}</div>
    <div class="myear"><button type="button" class="mini" data-go aria-label="Before">‹</button><b class="mmrange" aria-live="polite"></b><button type="button" class="mini" data-go aria-label="After">›</button></div>
    <div class="mmbars">${[1, 2, 3, 4, 5].map((v) => `<div class="mmcol" data-v="${v}"><b class="mmn">0%</b><span class="mmbar" style="background:var(--m${v})"></span>${face(v, 26)}<small>${MOODS[v].word}</small></div>`).join("")}</div>
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
  if (wasHidden) { box.querySelectorAll(".mmcol").forEach((col) => { col.querySelector(".mmbar").style.height = "calc((100% - 80px) * 0)"; col.querySelector(".mmn").textContent = "0%"; }); box.offsetHeight; }
  const top = Math.max(1, ...c.counts.slice(1));
  box.querySelectorAll(".mmcol").forEach((col) => {
    const v = Number(col.dataset.v), n = c.counts[v], p = c.pct[v];
    col.querySelector(".mmbar").style.height = `calc((100% - 80px) * ${(n / top).toFixed(3)})`;
    col.classList.toggle("zero", !n);
    count(col.querySelector(".mmn"), p, "%");
    col.setAttribute("aria-label", `${MOODS[v].word}: ${p}% (${n} day${n === 1 ? "" : "s"})`);
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
function count(el, to, unit = "") {
  const from = parseFloat(el.textContent) || 0;
  cancelAnimationFrame(el._raf);
  if (from === to || calm()) { el.textContent = to + unit; return; }
  const t0 = performance.now(), step = (now) => {
    const k = Math.min(1, (now - t0) / 450), e = 1 - (1 - k) ** 3;
    el.textContent = Math.round(from + (to - from) * e) + unit;
    if (k < 1) el._raf = requestAnimationFrame(step);
  };
  el._raf = requestAnimationFrame(step);
}

// A diary entry in a pop-up over the Mood page, so you stay on the day. ‹ › step through that day's entries;
// "Open in Dearly" goes to the full page (photos, edit, older / newer).
let reading = null;
function readEntry(id) {
  let dlg = $("dayReader");
  if (!dlg) {
    dlg = document.createElement("dialog");
    dlg.id = "dayReader"; dlg.className = "gsheet rdpop"; dlg.setAttribute("aria-labelledby", "rdDate");
    document.body.append(dlg);
    dlg.addEventListener("click", (ev) => {
      if (ev.target === dlg) { dlg.close(); return; } // tap outside closes
      const b = ev.target.closest("[data-rd], a");
      if (!b) return;
      if (b.tagName === "A") { dlg.close(); return; }
      if (b.dataset.rd === "close") dlg.close();
      else readEntry(b.dataset.rd);
    });
    dlg.addEventListener("close", () => { reading = null; });
  }
  const e = diary().find((x) => x.id === id && !x.deleted);
  if (!e) return;
  const day = mine().filter((x) => x.date === e.date).sort((a, b) => (a.created || 0) - (b.created || 0));
  const i = day.findIndex((x) => x.id === id), prev = day[i - 1], next = day[i + 1], pd = prettyDate(e.date);
  const paras = bodyText(e.body).split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
  const n = (e.photos || []).length;
  dlg.innerHTML = `<div class="gsin rdin">
      <div class="rdhead"><div><small>${esc(pd.day)}</small><h3 id="rdDate">${esc(pd.date)}</h3></div>
        ${isMood(e.mood) ? `<span class="rdmood">${face(e.mood, 30)}<small>${MOODS[e.mood].word}</small></span>` : ""}
        <button type="button" class="mini" data-rd="close" aria-label="Close">✕</button></div>
      ${e.title ? `<h4 class="rdtitle">${esc(e.title)}</h4>` : ""}
      <div class="rdtext">${paras || `<p class="note">This entry is empty.</p>`}</div>
      <p class="note">${[n ? `${ico("camera")} ${n} photo${n > 1 ? "s" : ""} in Dearly` : "", `${words(bodyText(e.body))} words`].filter(Boolean).join(" · ")}</p>
      <div class="rdfoot">
        ${day.length > 1 ? `<div class="rdstep"><button type="button" class="mini" data-rd="${prev ? esc(prev.id) : ""}"${prev ? "" : " disabled"} aria-label="Earlier entry">‹</button><span>${i + 1} of ${day.length}</span><button type="button" class="mini" data-rd="${next ? esc(next.id) : ""}"${next ? "" : " disabled"} aria-label="Later entry">›</button></div>` : "<span></span>"}
        <a class="btn" href="#diary/read/${esc(e.id)}">Open in Dearly</a>
      </div>
    </div>`;
  dlg.querySelector(".rdtext").scrollTop = 0;
  if (!dlg.open) dlg.showModal();
  if (reading !== null && reading !== id && !calm()) dlg.querySelector(".rdin").animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 180 });
  reading = id;
}
