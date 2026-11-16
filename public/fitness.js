// Fitness score from a run. Pure: no Firebase, no DOM. Tune the numbers here.
//
// The idea: a fitter body covers more ground for each heartbeat. So the score looks at how fast the
// run was (effort pace, which already allows for hills) against how hard the heart worked for it.
//
//   speed      = metres per minute, from effort pace (or average pace)
//   oxygenCost = 3.5 + 0.2 × speed                 (ACSM running equation, ml/kg/min)
//   heartUsed  = (avg HR − resting HR) ÷ (max HR − resting HR)
//   engine     = 3.5 + (oxygenCost − 3.5) ÷ heartUsed   (roughly an estimated VO2max)
//   score      = engine × recovery bonus            (±5% from heart rate recovery, when the watch has it)
//
// "Fitness" on the graph is a moving average of run scores, so one hot or tired day doesn't swing it.

export const REST_HR = 60;      // assumed resting heart rate; the picture doesn't include one
export const HRR_TYPICAL = 25;  // heart rate recovery (bpm) that earns no bonus or penalty
export const HRR_WEIGHT = 0.05; // the most recovery can move a score, up or down
export const SMOOTH = 0.35;     // share of the newest run in the fitness line
export const MIN_SECS = 300;    // shorter runs don't give a steady heart rate

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// Highest heart rate we can expect: age formula (Tanaka), or the highest the watch has ever seen if that's more.
export function maxHr(age, runs) {
  const seen = runs.map((r) => r.hrMax).filter((n) => n >= 100 && n <= 220);
  return Math.max(Math.round(208 - 0.7 * (age || 35)), ...seen);
}

export const paceOf = (r) => r.effort || r.pace || (r.km > 0 && r.secs > 0 ? r.secs / r.km : null); // seconds per km
export const perBeat = (r) => { const p = paceOf(r); return p && r.hr ? 60000 / p / r.hr : null; }; // metres per heartbeat

export function runScore(r, hrMax) {
  const p = paceOf(r);
  if (!p || !r.hr || !(r.secs >= MIN_SECS) || hrMax <= REST_HR) return null;
  const speed = 60000 / p;
  const heartUsed = clamp((r.hr - REST_HR) / (hrMax - REST_HR), 0.4, 1);
  let score = 3.5 + (0.2 * speed) / heartUsed;
  if (r.hrr > 0) score *= 1 + clamp((r.hrr - HRR_TYPICAL) / HRR_TYPICAL, -1, 1) * HRR_WEIGHT;
  return score;
}

// runs: [{ date, km, secs, hr, ... }] → [{ date, run, score, trend }] oldest first; runs with no score are left out.
export function fitnessSeries(runs, age) {
  const top = maxHr(age, runs);
  let trend = null;
  return [...runs].sort((a, b) => a.date.localeCompare(b.date)).flatMap((run) => {
    const score = runScore(run, top);
    if (score == null) return [];
    trend = trend == null ? score : trend + SMOOTH * (score - trend);
    return [{ date: run.date, run, score, trend }];
  });
}

// 2437 → "40:37", 3723 → "1:02:03"
export function clock(secs) {
  const s = Math.round(secs), h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), p = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${p(m)}:${p(s % 60)}` : `${m}:${p(s % 60)}`;
}
// "40:37", "1:02:03", "9'29" → seconds, or null
export function toSecs(text) {
  const parts = String(text).trim().split(/[^\d]+/).filter(Boolean).map(Number);
  if (!parts.length || parts.length > 3 || parts.slice(1).some((n) => n > 59)) return null;
  return parts.reduce((a, n) => a * 60 + n, 0);
}
