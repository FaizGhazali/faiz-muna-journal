// The demo ("Try the demo"): made-up data in this tab only (memdb.js + sample.js). app.js never starts Firebase
// sign-in or the real database while it's on. This file is the switch: the buttons and the "Start over" / "Exit demo" bar.
import { $ } from "../core/util.js";

export const DEMO = (() => { try { return sessionStorage.getItem("journal-demo") === "1"; } catch (_) { return false; } })();

// Clears the demo's own keys in this tab. journal-theme stays so the day/night choice carries on.
function clearDemo(keepOn) {
  try {
    Object.keys(sessionStorage).filter((k) => k.startsWith("journal-") && k !== "journal-theme" && !(keepOn && k === "journal-demo")).forEach((k) => sessionStorage.removeItem(k));
  } catch (_) {}
}
const restart = () => { scrollTo(0, 0); location.replace(location.pathname); }; // start at the dashboard, not a #page

export function initDemo() {
  document.querySelectorAll("[data-demo]").forEach((b) => b.addEventListener("click", () => {
    try { sessionStorage.setItem("journal-demo", "1"); } catch (_) { $("loginMsg").textContent = "The demo needs this browser to allow site storage."; return; }
    restart();
  }));
  $("demoReset").addEventListener("click", () => { clearDemo(true); restart(); });
  $("demoExit").addEventListener("click", () => { clearDemo(false); restart(); });
  if (DEMO) { $("demoBar").hidden = false; $("signOut").hidden = true; }
}
