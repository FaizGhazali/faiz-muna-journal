// Dearly dashboard (#diary): welcome and stats, On this day, and the memories list (search, month, tag,
// favourites, order, "Show more").
import { PAGE, words, bodyText, titleOf, preview, live, diaryStats, onThisDay, tagsOf, filterEntries, tagStats, showTags, looksLike,
  prettyDate, ago, lineFor, greeting } from "../diary.js";
import { MOODS, isMood } from "../mood.js";
import { face } from "../face.js";
import { $, esc, today, tagKey } from "../util.js";
import { S, store, person, mine } from "./state.js";
import { draftKey } from "./editor.js";
import { suggestions } from "./settings.js";

export function renderDash(fresh) {
  const host = $("diary"), filt = S.filt;
  if (fresh || !$("dyList")) {
    host.innerHTML = `<section class="panel paper dy-hero" id="dyHero" aria-label="Today" data-title="Dearly"></section>
      <section class="panel paper dy-otd" id="dyOtd" aria-labelledby="dyOtdTitle" hidden></section>
      <section class="panel dy-mem" aria-labelledby="dyMemTitle" data-title="Your memories">
        <div class="dy-memhead"><h2 id="dyMemTitle">Your memories</h2><a class="btn mini" href="#diary/ai">✨ AI &amp; privacy<span class="dy-badge" id="dyBadge" hidden></span></a></div>
        <div class="dy-tools" id="dyTools">
          <input type="search" id="dyQ" class="gsearch" placeholder="Search your diary" aria-label="Search your diary" autocomplete="off" enterkeyhint="search" value="${esc(filt.q)}">
          <div class="dy-filters">
            <label class="inline">Month <input type="month" id="dyMonth" value="${esc(filt.month)}" max="${today().slice(0, 7)}"></label>
            <select id="dyTag" aria-label="Tag"></select>
            <button type="button" class="chip" id="dyFav" aria-pressed="${filt.fav}">★ Favourites</button>
            <select id="dySort" aria-label="Order"><option value="new"${filt.sort === "new" ? " selected" : ""}>Newest first</option><option value="old"${filt.sort === "old" ? " selected" : ""}>Oldest first</option></select>
          </div>
        </div>
        <div id="dyList" class="dy-list" aria-live="polite"></div>
      </section>`;
  }
  paintHero(); paintOtd(); paintList();
}

function paintHero() {
  const p = person(), t = today(), st = diaryStats(mine(), t), pd = prettyDate(t), draft = store.get(draftKey(null), null);
  const has = draft && words(bodyText(draft.body)) + words(draft.notes) > 0;
  $("dyHero").innerHTML = `<p class="dy-day">${esc(pd.day)}</p>
    <h2 class="dy-greet">${esc(greeting(new Date().getHours()))}, ${esc(p.name)}</h2>
    <p class="dy-date">${esc(pd.date)}</p>
    <p class="dy-line">${esc(lineFor(t))}</p>
    <div class="actions"><a class="btn primary dy-go" href="#diary/write">${has ? "✍️ Continue your draft" : "✍️ Write today's diary"}</a></div>
    ${st.total ? `<dl class="dy-stats">
      <div><dt>Entries</dt><dd>${st.total}</dd></div>
      <div><dt>Day streak</dt><dd>${st.streak}</dd></div>
      <div><dt>This month</dt><dd>${st.month}</dd></div>
      <div><dt>Last written</dt><dd>${st.last ? esc(ago(st.last, t)) : "–"}</dd></div>
    </dl>` : ""}`;
  const badge = $("dyBadge"), n = suggestions().length;
  if (badge) { badge.hidden = !n; badge.textContent = n; badge.setAttribute("aria-label", `${n} ${n === 1 ? "suggestion" : "suggestions"} for About you`); }
}

function paintOtd() {
  const host = $("dyOtd"), items = onThisDay(mine(), today());
  host.hidden = !items.length;
  if (!items.length) { host.innerHTML = ""; return; }
  const yr = +today().slice(0, 4);
  host.innerHTML = `<h2 id="dyOtdTitle">On this day</h2>
    <div class="dy-otdlist">${items.slice(0, 3).map((e) => `<a class="dy-otditem" href="#diary/read/${esc(e.id)}">
      <small>${yr - +e.date.slice(0, 4) === 1 ? "A year ago" : `${yr - +e.date.slice(0, 4)} years ago`}</small>
      <b>${esc(titleOf(e))}</b><span>${esc(preview(e, 110))}</span></a>`).join("")}</div>`;
}

function paintList() {
  const host = $("dyList"); if (!host) return;
  const filt = S.filt, tags = tagsOf(mine());
  $("dyTag").innerHTML = `<option value="">All tags</option>${tags.map((t) => `<option value="${esc(t)}"${filt.tag && tagKey(t) === tagKey(filt.tag) ? " selected" : ""}>#${esc(t)}</option>`).join("")}`;
  $("dyTag").hidden = !tags.length;
  if (!S.ready) { host.innerHTML = `<p class="note">Opening your diary…</p>`; return; }
  if (!live(mine()).length) {
    $("dyTools").hidden = true;
    host.innerHTML = `<div class="dy-empty"><p class="dy-emptyicon" aria-hidden="true">📔</p>
      <h3>Your diary is waiting</h3>
      <p class="note">No need for full sentences. Jot a few words about your day, in English, Malay or both, and Dearly can turn them into an entry that sounds like you. Or write it all yourself.</p>
      <a class="btn primary" href="#diary/write">Write your first entry</a></div>`;
    return;
  }
  $("dyTools").hidden = false;
  const found = filterEntries(mine(), filt), some = found.slice(0, S.shown), left = found.length - some.length;
  const filtered = filt.q || filt.month || filt.tag || filt.fav;
  host.innerHTML = found.length ? `${filtered ? `<p class="note">${found.length} ${found.length === 1 ? "entry" : "entries"} found. <button type="button" class="linkbtn" data-dy="clear">Clear</button></p>` : ""}
    ${some.map(cardHtml).join("")}
    ${left > 0 ? `<button type="button" class="dy-more" data-dy="more">Show more (${left} left)</button>` : ""}`
    : `<div class="dy-empty"><p>Nothing matches.</p>${meant(filt.q)}<button type="button" data-dy="clear">Clear search and filters</button></div>`;
}

// "mkan" found nothing, but there's a #makan tag: offer it.
function meant(q) {
  const k = tagKey(q); if (!k) return "";
  const hit = tagStats(mine()).filter((s) => looksLike(k, s.key)).slice(0, 3);
  return hit.length ? `<p class="dy-sugrow dy-meant">Did you mean ${hit.map((s) => `<button type="button" class="dy-sugtag same" data-dy="tag" data-tag="${esc(s.tag)}">#${esc(s.tag)}</button>`).join("")}</p>` : "";
}

function cardHtml(e) {
  const pd = prettyDate(e.date);
  return `<a class="dy-card" href="#diary/read/${esc(e.id)}">
    <div class="dy-cdate"><b>${+e.date.slice(8)}</b><small>${esc(new Date(e.date + "T12:00").toLocaleDateString(undefined, { month: "short" }))}</small><small>${e.date.slice(0, 4)}</small></div>
    <div class="dy-cbody"><h3>${e.fav ? '<span class="dy-star" aria-label="Favourite">★</span> ' : ""}${esc(titleOf(e))}</h3>
      <p>${esc(preview(e))}</p>
      ${(e.tags || []).length ? `<p class="dy-tags">${showTags(e.tags, tagStats(mine())).map((t) => `<span>#${esc(t)}</span>`).join("")}</p>` : ""}
      <span class="sr">${esc(pd.day)}, ${esc(pd.date)}</span></div>
    ${e.cover ? `<img class="dy-cover" src="${esc(e.cover)}" alt="" loading="lazy">` : isMood(e.mood) ? `<span class="dy-cmood" title="${MOODS[e.mood].label}">${face(e.mood, 30)}</span>` : ""}
  </a>`;
}

// ---------- events (dispatched from diaryui.js) ----------
const refilter = () => { S.shown = PAGE; paintList(); };

export function click(ev) {
  const d = ev.target.closest("#dyFav");
  if (!d) return false;
  S.filt.fav = !S.filt.fav; d.setAttribute("aria-pressed", S.filt.fav); refilter();
  return true;
}

export const actions = {
  more() { S.shown += PAGE; paintList(); },
  clear() { Object.assign(S.filt, { q: "", month: "", tag: "", fav: false }); S.shown = PAGE; renderDash(true); },
  // A tag tapped anywhere (reading view, "Did you mean") shows the memories with that tag.
  tag(b) { Object.assign(S.filt, { q: "", month: "", fav: false, tag: b.dataset.tag }); S.shown = PAGE; location.hash = "#diary"; },
};

export function input(t) {
  if (t.id === "dyQ") { S.filt.q = t.value; refilter(); }
}

export function change(t) {
  if (t.id === "dyMonth") { S.filt.month = t.value; refilter(); }
  if (t.id === "dyTag") { S.filt.tag = t.value; refilter(); }
  if (t.id === "dySort") { S.filt.sort = t.value; paintList(); }
}
