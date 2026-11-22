// Offers the Android home-screen widget (android/, "Next Move"): after the app is installed, and from the wheel's ⋯ menu.
// Android phones only, never in the demo (the widget signs in with the family password).
import { $ } from "./util.js";

const APK = "https://github.com/FaizGhazali/faiz-muna-journal/releases/latest/download/next-move.apk";

export const canWidget = () => /Android/i.test(navigator.userAgent) && sessionStorage.getItem("journal-demo") !== "1";

const OFFERED = "journal-widget-offered";
const standalone = () => matchMedia("(display-mode: standalone)").matches;

/** auto: also start the download (right after "Install app", while the tap still counts). */
export function offerWidget({ auto = false } = {}) {
  const sheet = $("widgetSheet");
  if (!sheet || !canWidget() || sheet.open) return;
  try { localStorage.setItem(OFFERED, "1"); } catch {}
  sheet.innerHTML = `<form method="dialog" class="gsin">
    <div class="gshead"><span class="gico big" aria-hidden="true">📲</span>
      <div><p class="eyebrow">Android widget</p><h3 id="wsTitle">Your next move on the home screen</h3></div></div>
    <p>A small card on your home screen shows your next move without opening the journal. Tap it to open the journal.</p>
    <ol class="glearn">
      <li><span>Tap <b>Download widget</b> and open the file when it's done.</span></li>
      <li><span>If your phone asks, allow installing from your browser. You only do this once.</span></li>
      <li><span>Open <b>Next Move</b>, type the family password and pick your name.</span></li>
      <li><span>Tap <b>Add to home screen</b>.</span></li>
    </ol>
    <div class="actions">
      <a class="btn primary" href="${APK}" download="next-move.apk">Download widget</a>
      <button value="close">Not now</button>
    </div>
  </form>`;
  sheet.querySelector("a.primary").addEventListener("click", () => setTimeout(() => sheet.close(), 300));
  sheet.showModal();
  sheet.querySelector("a.primary").focus();
  if (auto) {
    location.href = APK; // the sheet stays open with the steps; the button is there if the download didn't start
    sheet.querySelector("li span").innerHTML = "The download has started. Open <b>next-move.apk</b> when it's done (or tap <b>Download widget</b> again).";
  }
}

/** First time the installed app opens on Android (any install path, also Chrome's own menu): offer the widget once. */
function firstOpen() {
  if (!canWidget() || !standalone()) return;
  try { if (localStorage.getItem(OFFERED)) return; } catch { return; }
  const app = $("app");
  if (!app) return;
  const go = () => { if (!app.hidden) { obs.disconnect(); setTimeout(offerWidget, 1200); } };
  const obs = new MutationObserver(go);
  obs.observe(app, { attributes: true, attributeFilter: ["hidden"] });
  go();
}

export function initWidget() {
  const sheet = $("widgetSheet");
  sheet?.addEventListener("click", (ev) => { if (ev.target === sheet) sheet.close(); }); // tap outside closes
  // The wheel's ⋯ menu entry only shows where the widget can be installed.
  document.querySelectorAll("[data-go=widget]").forEach((b) => { b.hidden = !canWidget(); });
  firstOpen();
}
