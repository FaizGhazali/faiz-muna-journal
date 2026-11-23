// Dearly reading view (#diary/read/<id>): one entry with its photos, older / newer, favourite and delete.
import { doc, updateDoc } from "../../core/fs.js";
import { OPENING, words, bodyText, titleOf, tagStats, showTags, neighbours, prettyDate, KEEP_DELETED_DAYS } from "../../logic/diary.js";
import { MOODS, isMood } from "../../logic/mood.js";
import { face } from "../../core/face.js";
import { confirmDelete } from "../../core/confirm.js";
import { $, esc } from "../../core/util.js";
import { S, mine, find, parseRoute } from "./state.js";
import { canEdit, viewOnly } from "../../core/owner.js";
import { loadPhotos } from "./data.js";

function paras(body) {
  return bodyText(body).split(/\n\s*\n/).filter(Boolean).map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`).join("");
}

export function renderRead(id) {
  const e = find(id), host = $("diary");
  if (!e || e.deleted) {
    host.innerHTML = `<div class="fdtop"><a class="btn" href="#diary">← All memories</a></div>
      <section class="panel"><p>${S.ready ? "This entry isn't here any more. It may have been deleted." : "Opening…"}</p></section>`;
    return;
  }
  const pd = prettyDate(e.date), { older, newer } = neighbours(mine(), id), own = canEdit(e.person);
  host.innerHTML = `<div class="fdtop dy-readtop"><a class="btn" href="#diary">← All memories</a>
      <span class="dy-pager">${newer ? `<a class="btn mini" href="#diary/read/${esc(newer.id)}" aria-label="Newer entry">← Newer</a>` : ""}${older ? `<a class="btn mini" href="#diary/read/${esc(older.id)}" aria-label="Older entry">Older →</a>` : ""}</span></div>
    <article class="panel paper dy-read" aria-labelledby="dyReadDate" data-title="Diary entry">
      <header class="dy-rhead">
        <div><p class="dy-day">${esc(pd.day)}</p><h2 class="dy-date" id="dyReadDate">${esc(pd.date)}</h2></div>
        <div class="dy-rside">${isMood(e.mood) ? `<span class="dy-rmood">${face(e.mood, 30)}<small>${MOODS[e.mood].word}</small></span>` : ""}
          ${own ? `<button type="button" class="dy-favbtn" data-dy="fav" aria-pressed="${!!e.fav}" aria-label="${e.fav ? "Remove from favourites" : "Add to favourites"}">${e.fav ? "★" : "☆"}</button>` : e.fav ? `<span class="dy-favbtn" aria-label="A favourite">★</span>` : ""}</div>
      </header>
      ${e.title ? `<h3 class="dy-title">${esc(e.title)}</h3>` : ""}
      <p class="dy-dear">${esc(OPENING)}</p>
      <div class="dy-text">${paras(e.body)}</div>
      <div class="dy-photos" id="dyPhotos"></div>
      ${(e.tags || []).length ? `<p class="dy-tags">${showTags(e.tags, tagStats(mine())).map((t) => `<button type="button" class="linkbtn" data-dy="tag" data-tag="${esc(t)}">#${esc(t)}</button>`).join("")}</p>` : ""}
      <p class="dy-meta">${[e.ai ? "Written with Dearly's helper, from your notes" : "", e.noStyle ? "Not used to learn your style" : "", `${words(bodyText(e.body))} words`].filter(Boolean).map(esc).join(" · ")}</p>
      ${own ? `<div class="actions" id="dyReadActs"><a class="btn" href="#diary/edit/${esc(e.id)}">Edit</a><button type="button" data-dy="del">Delete</button></div>` : viewOnly(e.person, "diary")}
      ${S.flash?.id === id ? `<p class="note dy-flash" role="status">${esc(S.flash.text)}</p>` : ""}
    </article>
    <nav class="dy-nav" aria-label="More entries">
      ${older ? `<a href="#diary/read/${esc(older.id)}"><small>Older</small>${esc(titleOf(older))}</a>` : "<span></span>"}
      ${newer ? `<a href="#diary/read/${esc(newer.id)}" class="r"><small>Newer</small>${esc(titleOf(newer))}</a>` : "<span></span>"}
    </nav>`;
  if ((e.photos || []).length) loadPhotos(e).then((ph) => {
    const box = $("dyPhotos"); if (!box || parseRoute().id !== id) return;
    box.innerHTML = ph.map((p) => `<button type="button" class="dy-photo" data-dy="zoom" aria-label="Show photo bigger"><img src="${esc(p.data)}" alt="Photo from this day" loading="lazy"></button>`).join("");
  });
}

// ---------- events (dispatched from diaryui.js) ----------
export const actions = {
  async fav() {
    const id = parseRoute().id, e = find(id); if (!e || !canEdit(e.person)) return;
    e.fav = !e.fav; renderRead(id);
    await S.commit(() => updateDoc(doc(S.diaryCol, id), { fav: e.fav, updated: Date.now() }));
  },
  async del() {
    const id = parseRoute().id, e = find(id); if (!e || !canEdit(e.person)) return;
    const n = (e.photos || []).length;
    const ok = await confirmDelete({ title: `Delete "${titleOf(e)}"?`, yes: "Delete entry", note: `You can bring it back from Recently deleted (AI & privacy) for ${KEEP_DELETED_DAYS} days.`,
      body: `<p>The entry for ${esc(prettyDate(e.date).date)}${n ? `, with its ${n} photo${n === 1 ? "" : "s"},` : ""} moves to Recently deleted.</p>` });
    if (!ok) return;
    const { older, newer } = neighbours(mine(), id), next = older || newer;
    e.deleted = Date.now();
    S.flash = { id: next?.id || null, text: "Moved to Recently deleted. You can restore it from AI & privacy." };
    location.hash = next ? `#diary/read/${next.id}` : "#diary";
    await S.commit(() => updateDoc(doc(S.diaryCol, id), { deleted: e.deleted }));
  },
  zoom(b) { b.classList.toggle("big"); },
};
