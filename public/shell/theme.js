import { ico } from "../core/icons.js";
// Day / night switch (.theme buttons). With no saved choice ("journal-theme") the app follows the phone's own setting.
// The inline script in index.html applies the saved choice before the page paints.
export function initTheme() {
  const darkQuery = matchMedia("(prefers-color-scheme: dark)");
  const isDark = () => (document.documentElement.dataset.theme || (darkQuery.matches ? "dark" : "light")) === "dark";
  const buttons = document.querySelectorAll(".theme");
  const show = () => buttons.forEach((b) => { b.innerHTML = isDark() ? `${ico("sun")} Day` : `${ico("moon")} Night`; b.setAttribute("aria-label", isDark() ? "Switch to day mode" : "Switch to night mode"); });
  buttons.forEach((b) => b.addEventListener("click", () => {
    const next = isDark() ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("journal-theme", next); } catch (_) {}
    show();
  }));
  darkQuery.addEventListener("change", show);
  show();
}
