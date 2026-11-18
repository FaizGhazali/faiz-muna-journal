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
export const SIMILAR_BPM = 5;   // "Similar effort only" keeps runs within this many bpm of the usual heart rate
export const SIMILAR_DAYS = 15; // "usual" = median heart rate of the runs within this many days either side (a month)

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
// → [{ date, paceSec, weightKg, hr, km, note, weightDate, gapDays }] oldest first, for every run.
// Runs with no weigh-in close enough have weightKg, weightDate and gapDays set to null.
export function runsWithWeight(entries, personId, maxGapDays = MAX_GAP_DAYS) {
  const weighIns = list(entries)
    .filter((e) => e && e.person === personId && ok(e.weight) && /^\d{4}-\d{2}-\d{2}$/.test(e.date || ""))
    .map((e) => ({ date: e.date, day: dayNum(e.date), kg: e.weight }));
  return runEntries(entries, personId).map((e) => {
    let weightKg = ok(e.weight) ? e.weight : null, weightDate = e.date, gapDays = 0;
    if (weightKg == null) {
      const day = dayNum(e.date);
      let best = null;
      for (const w of weighIns) {
        const gap = Math.abs(w.day - day);
        if (gap > maxGapDays) continue;
        if (!best || gap < best.gap || (gap === best.gap && w.date < best.date)) best = { ...w, gap };
      }
      if (best) ({ kg: weightKg, date: weightDate, gap: gapDays } = best);
      else weightDate = gapDays = null;
    }
    return {
      date: e.date, paceSec: runPace(e.run), weightKg, hr: e.run.hr ?? null, km: ok(e.run.km) ? e.run.km : null,
      note: e.note || "", weightDate, gapDays,
    };
  });
}

// Only the runs that have a weight (see runsWithWeight).
export const pairRunsWithWeight = (entries, personId, maxGapDays = MAX_GAP_DAYS) =>
  runsWithWeight(entries, personId, maxGapDays).filter((r) => r.weightKg != null);

// Band size for grouping runs by weight: the smallest of 0.5 / 1 / 2 / 5 kg that keeps it to about 10 bars.
export function bandWidth(weights) {
  const w = weights.filter(Number.isFinite);
  if (!w.length) return 1;
  const span = Math.max(...w) - Math.min(...w);
  return [0.5, 1, 2, 5].find((s) => span / s < 10) || 10;
}

// Runs grouped by weight band, for the Weight vs distance bars. points: [{ date, weightKg, km }].
// → [{ lo, hi, n, avgKm, maxKm, from, to, avgDay }] lightest first, with every band between the lightest
// and heaviest (empty bands have n 0 and null values) so gaps in weight show as gaps.
export function weightBands(points, width = 1) {
  const pts = (points || []).filter((p) => Number.isFinite(p?.weightKg) && Number.isFinite(p?.km))
    .sort((a, b) => a.date.localeCompare(b.date));
  if (!pts.length) return [];
  const idx = (p) => Math.floor(p.weightKg / width + 1e-9);
  const first = Math.min(...pts.map(idx)), last = Math.max(...pts.map(idx)), out = [];
  for (let i = first; i <= last; i++) {
    const rs = pts.filter((p) => idx(p) === i), n = rs.length;
    out.push({
      lo: +(i * width).toFixed(2), hi: +((i + 1) * width).toFixed(2), n,
      avgKm: n ? rs.reduce((a, p) => a + p.km, 0) / n : null,
      maxKm: n ? Math.max(...rs.map((p) => p.km)) : null,
      from: n ? rs[0].date : null, to: n ? rs[n - 1].date : null,
      avgDay: n ? rs.reduce((a, p) => a + dayNum(p.date), 0) / n : null,
    });
  }
  return out;
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

// Age on a date from a birth date, both "YYYY-MM-DD": completed years and months. null if unknown.
export function ageOn(born, date) {
  const re = /^(\d{4})-(\d{2})-(\d{2})$/, b = re.exec(born || ""), d = re.exec(date || "");
  if (!b || !d || date < born) return null;
  let years = d[1] - b[1], months = d[2] - b[2];
  if (+d[3] < +b[3]) months -= 1;
  if (months < 0) { years -= 1; months += 12; }
  return { years, months };
}
export const ageText = (a) => (a ? `${a.years}y ${a.months}m` : "");

export function median(nums) {
  const s = nums.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Usual heart rate around a date: median average HR of the runs within ±days of it.
// runs: [{ date, hr }]. Using nearby runs (not all runs ever) means a heart rate that drops as the person
// gets fitter doesn't push their early or recent runs out of "similar effort".
export function usualHr(runs, date, days = SIMILAR_DAYS) {
  const day = dayNum(date);
  return median((runs || []).filter((r) => Math.abs(dayNum(r.date) - day) <= days).map((r) => r.hr));
}

// Keep runs at a similar effort: average heart rate within ±bpm of the usual heart rate at that time.
export function similarEffort(pairs, runs, bpm = SIMILAR_BPM, days = SIMILAR_DAYS) {
  return pairs.filter((p) => {
    const usual = Number.isFinite(p.hr) ? usualHr(runs, p.date, days) : null;
    return usual != null && Math.abs(p.hr - usual) <= bpm;
  });
}
