// A small mood face as SVG: colour and mouth by mood (1 hard … 5 great), an outline when not rated.
// Used by the mood pages (moodui.js) and the diary (diaryui.js).
import { isMood } from "../logic/mood.js";

const MOUTH = { 1: "M7.5 17 Q12 12.5 16.5 17", 2: "M8 16.5 Q12 14.2 16 16.5", 3: "M8 15.5 H16", 4: "M7.8 14.5 Q12 18 16.2 14.5", 5: "M7 13.6 Q12 20.5 17 13.6 Z" };

export function face(v, size = 40) {
  const on = isMood(v), ink = !on ? "var(--muted)" : v === 1 ? "#fff" : "#1b1e2c";
  return `<svg class="face" width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">
    <circle cx="12" cy="12" r="11" fill="${on ? `var(--m${v})` : "none"}" stroke="${on ? "none" : "var(--muted)"}" stroke-width="1.2" ${on ? "" : 'stroke-dasharray="2.5 2"'}/>
    <circle cx="8.5" cy="10" r="1.3" fill="${ink}"/><circle cx="15.5" cy="10" r="1.3" fill="${ink}"/>
    <path d="${MOUTH[on ? v : 3]}" fill="${v === 5 ? ink : "none"}" stroke="${ink}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
  </svg>`;
}
