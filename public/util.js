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
