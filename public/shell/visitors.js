// Visitor count on the landing page: counts each new device once, by country guessed from its time zone
// (see visits.js, pure), then shows the totals in #visitors. The only public collection: visits/{country}.
import { collection, doc, setDoc, getDocs, increment } from "../core/fs.js";
import { countryOf, flagOf, isBot, summarise, UNKNOWN } from "../logic/visits.js";
import { $, esc } from "../core/util.js";

let done = false;

export async function visitors(db) {
  if (done) return;
  done = true;
  let zone = "";
  try { zone = Intl.DateTimeFormat().resolvedOptions().timeZone || ""; } catch (_) {}
  const mine = countryOf(zone);
  const names = (() => { try { return new Intl.DisplayNames([navigator.language || "en", "en"], { type: "region" }); } catch (_) { return null; } })();
  const nameOf = (cc) => (cc === UNKNOWN ? "Somewhere else" : names?.of(cc) || cc);
  try {
    let seen = false;
    try { seen = localStorage.getItem("journal-visited") === "1"; } catch (_) { seen = true; }
    if (!seen && !isBot(navigator.userAgent, navigator.webdriver)) {
      await setDoc(doc(db, "visits", mine), { n: increment(1) }, { merge: true });
      try { localStorage.setItem("journal-visited", "1"); } catch (_) {}
    }
  } catch (_) {} // refused or offline: still show what we can
  try {
    const snap = await getDocs(collection(db, "visits"));
    const { total, countries } = summarise(snap.docs.map((d) => ({ id: d.id, n: d.data().n })));
    if (!total) return;
    const top = countries.slice(0, 12), rest = countries.length - top.length;
    $("visTotal").textContent = total.toLocaleString();
    $("visPeople").textContent = total === 1 ? "person has" : "people have";
    const known = countries.filter((c) => c.cc !== UNKNOWN).length;
    $("visCount").textContent = `${known} ${known === 1 ? "country" : "countries"}`;
    $("visList").innerHTML = top.map((c) => `<li${c.cc === mine ? ' class="you"' : ""}><span aria-hidden="true">${flagOf(c.cc)}</span> ${esc(nameOf(c.cc))}<b>${c.n.toLocaleString()}</b></li>`).join("")
      + (rest > 0 ? `<li class="more">and ${rest} more ${rest === 1 ? "country" : "countries"}</li>` : "");
    $("visYou").textContent = mine === UNKNOWN ? "" : `You're visiting from ${nameOf(mine)}.`;
    $("visitors").hidden = false;
  } catch (_) {}
}
