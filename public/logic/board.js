// Card boards (pure): the order and size of a journal's cards, as the person arranged them on this device.
// A layout is a list of { id, size } with size "s" | "m" | "l". `defaults` is the starting layout; an id ending
// in "*" (like "card:*") stands for every card whose id starts with what's before it (one per credit card).
// `sizes` gives each id (or "card:*") the sizes it can take, as a string like "sml"; missing = "sml".

export const SIZES = ["s", "m", "l"];

const wild = (pat, id) => pat.endsWith("*") && id.startsWith(pat.slice(0, -1));
const ruleFor = (map, id) => map[id] ?? Object.entries(map).find(([k]) => wild(k, id))?.[1];
export const allowed = (sizes, id) => (ruleFor(sizes || {}, id) ?? "sml").split("").filter((s) => SIZES.includes(s));

// Where an id sits in the defaults: its own entry, else its wildcard's.
const slotOf = (defaults, id) => {
  const i = defaults.findIndex((d) => d.id === id);
  return i >= 0 ? i : defaults.findIndex((d) => wild(d.id, id));
};

// The size a card shows at: what was saved if it's still allowed, else its default, else its largest.
export function sizeOf(id, { defaults = [], saved = [], sizes = {} } = {}) {
  const ok = allowed(sizes, id);
  const mine = saved.find((x) => x.id === id)?.size;
  if (ok.includes(mine)) return mine;
  const d = defaults[slotOf(defaults, id)]?.size;
  return ok.includes(d) ? d : ok.at(-1) ?? "l";
}

// The cards that are on the page (`ids`), in order: saved ones in their saved order, then each new one placed
// right after the card before it in the defaults (so a new credit card joins the other cards). Never loses an id.
export function resolve(ids, { defaults = [], saved = [], sizes = {} } = {}) {
  const here = new Set(ids);
  const out = saved.map((x) => x.id).filter((id, i, a) => here.has(id) && a.indexOf(id) === i);
  const rank = (id) => { const s = slotOf(defaults, id); return s < 0 ? Infinity : s; };
  const fresh = ids.filter((id) => !out.includes(id)).sort((a, b) => rank(a) - rank(b) || ids.indexOf(a) - ids.indexOf(b));
  for (const id of fresh) {
    const r = rank(id);
    // After its own kind (the other credit cards) if any is placed, else after the last card whose default
    // slot comes before this one's.
    let at = -1, kin = -1;
    out.forEach((o, i) => { if (rank(o) <= r) at = i; if (rank(o) === r) kin = i; });
    if (kin >= 0) at = kin;
    out.splice(at + 1, 0, id);
  }
  return out.map((id) => ({ id, size: sizeOf(id, { defaults, saved, sizes }) }));
}

// Move one card a step up (-1) or down (+1) among the cards shown.
export function move(layout, id, dir) {
  const i = layout.findIndex((x) => x.id === id), j = i + dir;
  if (i < 0 || j < 0 || j >= layout.length) return layout;
  const out = layout.slice();
  [out[i], out[j]] = [out[j], out[i]];
  return out;
}
export const resize = (layout, id, size) => layout.map((x) => (x.id === id ? { ...x, size } : x));

// Keeps what was saved for cards not on the page right now (an import panel, a card removed for now), so
// arranging today's cards never forgets the others.
export function merge(saved, layout) {
  const ids = new Set(layout.map((x) => x.id));
  return [...layout, ...saved.filter((x) => !ids.has(x.id))];
}

// How many grid columns each card spans, so rows never leave a hole: small = 1 column, medium = 2, large = all.
// The last card in a row stretches over what's left of it (a small tile on its own becomes full width).
export function spans(sizes, cols) {
  const want = (s) => Math.min(cols, s === "s" ? 1 : s === "m" ? 2 : cols);
  const out = [];
  let x = 0;
  sizes.forEach((s, i) => {
    const w = want(s);
    if (x + w > cols) { out[i - 1] += cols - x; x = 0; }
    out.push(w);
    x += w;
    if (x === cols) x = 0;
  });
  if (x) out[out.length - 1] += cols - x;
  return out;
}
