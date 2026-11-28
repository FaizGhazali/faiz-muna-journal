// One shop list for Stocky and Ledger. Pure: no Firebase, no DOM. Tests: tests/shops.test.mjs.
// The shared record is Ledger's shop name, ledgerShops/{auto id} { key, name (statement name), nick }:
// Ledger items carry the statement name ("LOTUS'S STORES SDN BHD"), Stocky buys and prices carry what
// was typed ("Lotus's"). A Stocky shop is the same shop as a Ledger one when its name matches the
// shop's nick or statement name, ignoring case, spaces and punctuation. Nothing is copied: the link is
// worked out when drawing, and renaming a shop in Ledger renames the Stocky rows that used the old name.

import { shopName, shopKey } from "./moneyplan.js";

// "Lotus's", "LOTUS'S " and "lotuss" are one shop.
export const shopId = (s) => String(s ?? "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, "");
export const sameShop = (a, b) => !!shopId(a) && shopId(a) === shopId(b);

// The Ledger shop a typed name means (its nick first, then its statement name), or null.
export function ledgerShopOf(name, ledgerShops = []) {
  const k = shopId(name);
  if (!k) return null;
  return ledgerShops.find((s) => s.nick && shopId(s.nick) === k) ?? ledgerShops.find((s) => s.name && shopId(s.name) === k) ?? null;
}

// The names a shop goes by in Stocky: its nick and its statement name.
export const namesOf = (shop) => [shop?.nick, shop?.name].filter((s) => shopId(s));

// One list of shop names for a picker: Ledger's named shops (by the name shown first), then the other
// names, in order, with no two meaning the same shop: a Stocky "Lotus's" is left out when a Ledger shop
// goes by it, under either of its names.
export function shopChoices(ledgerShops = [], others = []) {
  const seen = new Set(), out = [];
  const add = (s) => { const k = shopId(s); if (!k || seen.has(k)) return; seen.add(k); out.push(String(s).trim()); };
  const named = ledgerShops.filter((s) => s.nick).map((s) => ({ s, main: shopLabel(s).main })).sort((a, b) => a.main.localeCompare(b.main));
  for (const { s, main } of named) { add(main); seen.add(shopId(s.nick)); seen.add(shopId(s.name)); }
  others.forEach(add);
  return out;
}

// Every shop Ledger has spending at (not card payments), most recent first, each once, by the name
// shown first (shopLabel), so Stocky can pick a shop that so far only Ledger knows.
export function ledgerShopNames(txns = [], ledgerShops = []) {
  const docs = new Map(ledgerShops.filter((s) => s.key).map((s) => [s.key, s])), seen = new Set(), out = [];
  for (const t of [...txns].filter((x) => x.type !== "payment" && (x.merchant || x.raw)).sort((a, b) => String(b.date).localeCompare(String(a.date)))) {
    const k = shopKey(t);
    if (seen.has(k)) continue;
    seen.add(k); out.push(shopLabel(docs.get(k), shopName(t)).main);
  }
  return out;
}

// Ledger's "Where" suggestions in Add spending: [{ value, label }], each shop name once (by shopId).
// Your names for shops first (A–Z, the statement name as label), then every shop with spending, most
// recent first (a named shop's statement name too, labelled with your name, so typing either finds it),
// then saved shops with no spending loaded, then Stocky's shops (label "Stocky"). No cap: the list
// filters as you type, and a cut-off hid saved shops once a statement import brought in many names.
export function whereChoices(txns = [], ledgerShops = [], stocky = []) {
  const out = [], seen = new Set();
  const add = (value, label = "") => {
    const v = String(value ?? "").trim(), k = shopId(v);
    if (!k || seen.has(k)) return;
    seen.add(k); out.push({ value: v, label: String(label ?? "").trim() });
  };
  const named = ledgerShops.filter((s) => s.nick && s.name && !sameShop(s.nick, s.name));
  const nickOf = new Map(named.map((s) => [shopId(s.name), s.nick]));
  [...named].sort((a, b) => a.nick.localeCompare(b.nick)).forEach((s) => add(s.nick, s.name));
  const spent = txns.filter((t) => t.type !== "payment" && (t.merchant || t.raw)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  for (const t of spent) { const s = t.merchant || t.raw; add(s, nickOf.get(shopId(s))); }
  for (const s of ledgerShops) add(s.name || s.nick, s.name && nickOf.get(shopId(s.name)));
  stocky.forEach((s) => add(s, "Stocky"));
  return out;
}

// What Stocky has from a shop (any of `names`): buys newest first, what was spent (RM, buys with a price),
// and the items bought most often. { n, spent, last, items: [{ id, name, n, last }] }
export function stockyAt(names, buys = [], pantry = []) {
  const ids = new Set(names.map(shopId).filter(Boolean));
  const mine = buys.filter((b) => ids.has(shopId(b.shop))).sort((a, b) => b.date.localeCompare(a.date) || (b.at || 0) - (a.at || 0));
  const byItem = new Map(), names2 = new Map(pantry.map((p) => [p.id, p.name]));
  for (const b of mine) {
    if (!names2.has(b.item)) continue;
    const r = byItem.get(b.item) ?? { id: b.item, name: names2.get(b.item), n: 0, last: b.date };
    r.n++; byItem.set(b.item, r);
  }
  return {
    n: mine.length,
    spent: mine.reduce((s, b) => s + (Number(b.price) > 0 ? Number(b.price) : 0), 0),
    last: mine[0]?.date ?? null,
    items: [...byItem.values()].sort((a, b) => b.n - a.n || b.last.localeCompare(a.last) || a.name.localeCompare(b.name)),
  };
}

// Stocky rows (buys, prices) to rename when a shop's name changes in Ledger: those that used the old
// nick, so they stay with the shop. [{ id, shop }] (the collection is the caller's).
export function renames(oldName, newName, rows = []) {
  const to = String(newName ?? "").trim();
  if (!shopId(oldName) || !to || sameShop(oldName, to)) return [];
  return rows.filter((r) => sameShop(r.shop, oldName)).map((r) => ({ id: r.id, shop: to }));
}

// ---------- two names, one shop ----------
// A shop can have two names: the card statement's (`name`) and the one you gave it (`nick`). Both find
// it everywhere. Whichever came in first is shown first and the other is its remark, under `first`
// ("nick" | "name"; missing = "name", the statement's). Swapped in Ledger's shop Edit popup.
// { main, remark, mainIsNick }; remark "" when there's only one name.
export function shopLabel(shop, name = shop?.name) {
  const nick = String(shop?.nick ?? "").trim(), stmt = String(name ?? "").trim();
  if (!nick || sameShop(nick, stmt)) return { main: stmt || nick, remark: "", mainIsNick: !stmt };
  return shop.first === "nick" ? { main: nick, remark: stmt, mainIsNick: true } : { main: stmt, remark: nick, mainIsNick: false };
}
// Which name came first, from the first day each was used (YYYY-MM-DD or null): "nick" only when the
// given name was used (in Stocky) before the statement name (in Ledger); a tie goes to the statement.
export const whichFirst = (nickSince, nameSince) => (nickSince && (!nameSince || nickSince < nameSince) ? "nick" : "name");
// The first day Stocky used any of `names` (buys and prices), or null.
export function firstUsed(names, rows = []) {
  const ids = new Set(names.map(shopId).filter(Boolean));
  return rows.filter((r) => r.date && ids.has(shopId(r.shop))).map((r) => r.date).sort()[0] ?? null;
}
