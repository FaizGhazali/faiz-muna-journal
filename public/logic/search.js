// Search by name, for any long list (great-ux skill: a list that can grow past SEARCH_MIN gets a search box).
// Pure: no DOM. Ignores case, accents, dashes and extra spaces; every typed word must be in the name, in any order.
import { looksLike } from "./diary.js";

// A list this long (or longer) shows a search box.
export const SEARCH_MIN = 8;

export const searchKey = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "")
  .toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const words = (s) => searchKey(s).split(" ").filter(Boolean);

// hits: items whose name has every typed word, the name starting with it first, then a word starting with it,
//       then anywhere (ties keep the list's own order).
// close: "Did you mean" (up to 3), only when nothing hits: names with a word that looks like each typed word
//       (texting short form like "bwg" -> "bawang", or a typo like "ayma" -> "ayam").
export function findByName(items, query, nameOf = (x) => x.name) {
  const q = words(query);
  if (!q.length) return { hits: items, close: [] };
  const rank = (x) => {
    const k = searchKey(nameOf(x)), ws = k.split(" ");
    if (!q.every((w) => k.includes(w))) return -1;
    return k.startsWith(q[0]) ? 0 : ws.some((t) => t.startsWith(q[0])) ? 1 : 2;
  };
  const hits = items.map((x, i) => ({ x, i, r: rank(x) })).filter((h) => h.r >= 0)
    .sort((a, b) => a.r - b.r || a.i - b.i).map((h) => h.x);
  if (hits.length) return { hits, close: [] };
  const close = items.filter((x) => {
    const ws = words(nameOf(x));
    return q.every((w) => ws.some((t) => t.includes(w) || looksLike(w, t) || looksLike(w, t.slice(0, w.length + 1))));
  }).slice(0, 3);
  return { hits, close };
}
