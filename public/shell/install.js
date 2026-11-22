// "Install app" button (the browser's install prompt) and, once installed on Android, the home-screen widget offer.
import { offerWidget } from "./widget.js";
import { $ } from "../core/util.js";

export function initInstall() {
  let installEvent = null;
  addEventListener("beforeinstallprompt", (e) => { e.preventDefault(); installEvent = e; $("install").hidden = false; });
  $("install").addEventListener("click", async () => {
    if (!installEvent) return;
    installEvent.prompt();
    const { outcome } = await installEvent.userChoice;
    installEvent = null; $("install").hidden = true;
    if (outcome === "accepted") offerWidget({ auto: true }); // Android: download the home-screen widget too (widget.js)
  });
  // Also fires when the app is installed from the browser's own menu. offerWidget() won't open twice.
  addEventListener("appinstalled", () => { $("install").hidden = true; setTimeout(offerWidget, 800); });
}
