// Weight vs pace for the Fitness detail page. Pure: no Firebase, no DOM.
//
// Each run is paired with a weight: from the same day if there is one, otherwise the nearest weigh-in
// within maxGapDays (a tie goes to the earlier date). Runs with no weigh-in close enough are left out.
// Weights are never interpolated or made up. A straight line (least squares) then shows how pace moves
// with weight.

import { dayNum } from "./suggest.js";

export const MAX_GAP_DAYS = 7;  // furthest a weigh-in can be from a run and still count
export const MIN_TREND = 3;     // fewer runs than this: dots only, no line
export const CONFIDENT = 8;     // fewer runs than this: line shown with a "low confidence" badge
export const SIMILAR_BPM = 5;   // "Similar effort only" keeps runs within this many bpm of the median

const list = (entries) => (Array.isArray(entries) ? entries : Object.values(entries || {}));
const ok = (n) => typeof n === "number" && Number.isFinite(n) && n > 0;

// Average pace of a run in seconds per km: the stored pace, or time ÷ distance for runs saved without one.
export const runPace = (run) => (ok(run?.pace) ? run.pace : ok(run?.km) && ok(run?.secs) ? run.secs / run.km : null);

// The person's entries that have a run with a pace, oldest first.
export function runEntries(entries, personId) {
  return list(entries)
    .filter((e) => e && e.person === personId && /^\d{4}-\d{2}-\d{2}$/.test(e.date || "") && runPace(e.run) != null)
    .sort((a, b) => a.date.localeCompare(b.date));
}

// entries: array of entries, or the export's { id: entry } map.
// → [{ date, paceSec, weightKg, hr, km, note, weightDate, gapDays }] oldest first.
export function pairRunsWithWeight(entries, personId, maxGapDays = MAX_GAP_DAYS) {
  const weighIns = list(entries)
    .filter((e) => e && e.person === personId && ok(e.weight) && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ""))
    .map((e) => ({ date: e.date, day: dayNum(e.date), kg: e.weight }));
  return runEntries(entries, personId).flatMap((e) => {
    let weightKg = ok(e.weight) ? e.weight : null, weightDate = e.date, gapDays = 0;
    if (weightKg == null) {
      const day = dayNum(e.date);
      let best = null;
      for (const w of weighIns) {
        const gap = Math.abs(w.day - day);
        if (gap > maxGapDays) continue;
        if (!best || gap < best.gap || (gap === best.gap && w.date < best.date)) best = { ...w, gap };
      }
      if (!best) return [];
      ({ kg: weightKg, date: weightDate, gap: gapDays } = best);
    }
    return [{
      date: e.date, paceSec: runPace(e.run), weightKg, hr: e.run.hr ?? null, km: e.run.km ?? null,
      note: e.note || "", weightDate, gapDays,
    }];
  });
}

// points: [{ x, y }] → { slope, intercept, r2, n }. slope, intercept and r2 are null with fewer than
// MIN_TREND points, or when every x is the same (no line can be drawn).
export function linearRegression(points) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.x) && Number.isFinite(p?.y)), n = pts.length;
  const none = { slope: null, intercept: null, r2: null, n };
  if (n < MIN_TREND) return none;
  const mx = pts.reduce((a, p) => a + p.x, 0) / n, my = pts.reduce((a, p) => a + p.y, 0) / n;
  let sxx = 0, sxy = 0, syy = 0;
  for (const p of pts) { sxx += (p.x - mx) ** 2; sxy += (p.x - mx) * (p.y - my); syy += (p.y - my) ** 2; }
  if (sxx < 1e-12) return none;
  const slope = sxy / sxx, intercept = my - slope * mx;
  const r2 = syy < 1e-12 ? 1 : (sxy * sxy) / (sxx * syy);
  return { slope, intercept, r2, n };
}

export function median(nums) {
  const s = nums.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Keep runs at a similar effort: average heart rate within ±bpm of the median of the person's runs.
export function similarEffort(pairs, medianHr, bpm = SIMILAR_BPM) {
  if (medianHr == null) return [];
  return pairs.filter((p) => Number.isFinite(p.hr) && Math.abs(p.hr - medianHr) <= bpm);
}
