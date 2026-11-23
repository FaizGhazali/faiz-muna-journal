// Small shared helpers used across the app: DOM lookup, HTML escaping and
// local calendar dates as "YYYY-MM-DD" strings. Pure except for `$` and `today`.

export const $ = (id) => document.getElementById(id);

// Everything user-entered that goes into innerHTML must pass through esc().
export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

export const pad = (n) => String(n).padStart(2, "0");
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const dayNum = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
export const today = () => iso(new Date());
export const fmt = (s, o) => parse(s).toLocaleDateString(undefined, o);

// The last choice made for `field` (newest doc that has one, by `date` then `at` / `created`), or "" if there's none yet.
// Forms start from it, so the family picks a shop, kind or unit once and it's there next time (great-ux skill).
export function lastUsed(docs, field) {
  let best = null;
  const when = (d) => [d.date || "", d.at || d.created || 0];
  for (const d of docs || []) {
    if (d?.[field] == null || d[field] === "") continue;
    if (!best) { best = d; continue; }
    const [a, x] = when(d), [b, y] = when(best);
    if (a > b || (a === b && x >= y)) best = d;
  }
  return best ? best[field] : "";
}
// One key for names that mean the same thing (diary tags, Stocky kinds): case, spaces, dashes and a plural "s"
// don't count, so "part time", "Part-time", "parttime" and "parts times" are all one.
export function tagKey(t) {
  return String(t || "").toLowerCase().split(/[\s\-_.]+/).filter(Boolean)
    .map((w) => (w.length > 3 && /[^s]s$/.test(w) ? w.slice(0, -1) : w)).join("");
}
