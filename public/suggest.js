// "Your Next Move": picks ONE thing to do next.
// Pure rules only: no Firebase and no DOM, so this file can be tuned and tested on its own.

export const TYPES = {
  skill: { label: "Skill", color: "--accent" },
  task: { label: "One-time task", color: "--under" },
  explore: { label: "Explore", color: "--over" },
  cook: { label: "Cooking", color: "--obese" },
  habit: { label: "Habit", color: "--good" },
};
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// ---- local calendar dates as "YYYY-MM-DD" ----
const pad = (n) => String(n).padStart(2, "0");
export const iso = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
export const parse = (s) => { const [y, m, d] = s.split("-").map(Number); return new Date(y, m - 1, d); };
export const dayNum = (s) => { const [y, m, d] = s.split("-").map(Number); return Date.UTC(y, m - 1, d) / 864e5; };
export const addDays = (s, n) => { const d = parse(s); d.setDate(d.getDate() + n); return iso(d); };
const short = (s) => parse(s).toLocaleDateString(undefined, { day: "numeric", month: "short" });

// ---- category guess for the quick-add box (the user can always change it) ----
const RULES = [
  ["habit", /\b(daily|every ?day|each day|per day|a day|every (morning|night|evening|week)|weekly|habit|drink|sleep|wake up|stretch|floss|meditate|pages?)\b/i],
  ["cook", /\b(cook|bake|baking|recipe|nasi|mee|rendang|pasta|curry|sambal|soup|kuih|dish|grill|roast|bread|cake)\b/i],
  ["explore", /\b(visit|cafe|café|coffee|restaurant|eatery|eat at|explore|hike|trip|museum|beach|kedai|warung|mamak|food|try)\b/i],
  ["skill", /\b(learn|practi[cs]e|improve|study|course|master|get better|photograph\w*|programming|coding|language|english|editing|guitar|piano|drawing|programme)\b/i],
];
export function guessType(title) {
  for (const [type, re] of RULES) if (re.test(title)) return type;
  return "task";
}

// ---- habits ----
// logs: { "YYYY-MM-DD": { done: [ids], skipped: [ids] } } for one person.
export const isScheduled = (h, date) => (h.days?.length ? h.days : ALL_DAYS).includes(parse(date).getDay());
export function habitState(h, logs, date) {
  const l = logs[date];
  return l?.done?.includes(h.id) ? "done" : l?.skipped?.includes(h.id) ? "skipped" : null;
}
// "Done 5 of the last 7 days", counting only days the habit was due and not skipped. Today counts only once ticked.
export function habitWeek(h, logs, today) {
  let due = 0, done = 0;
  for (let i = 0; i < 7; i++) {
    const d = addDays(today, -i);
    if (h.created && d < h.created) break;
    if (!isScheduled(h, d)) continue;
    const s = habitState(h, logs, d);
    if (s === "skipped" || (i === 0 && s !== "done")) continue;
    due++; if (s === "done") done++;
  }
  return { due, done };
}

// ---- what to show on the card ----
export function firstOpenStep(a) { return (a.steps || []).find((s) => !s.done) || null; }
export function describe(a) {
  const step = firstOpenStep(a);
  const detail = {
    skill: step ? `Next step: ${step.text}` : a.note || `Spend ${a.minutes || 20} focused minutes on it.`,
    task: a.note || "One job, done once. Then it's off your mind.",
    explore: [a.location ? `At ${a.location}.` : "", a.note || "Something to enjoy. Go when it suits you."].filter(Boolean).join(" "),
    cook: a.note || "Pick an evening with time to spare and give it a go.",
    habit: a.note || "Still open today. Tick it off when it's done.",
  }[a.type];
  return { detail, minutes: a.minutes || (a.type === "skill" ? 20 : null) };
}

// ---- scoring ----
// Returns { score, why } for an activity that can be suggested now, or null if it can't.
// ctx: { today, hour, logs, recent: [ids, newest first], all: [this person's activities] }
export function scoreOf(a, ctx) {
  const { today } = ctx;
  if (a.status !== "active") return null; // ideas, paused, done and archived never show
  if (a.snoozed && a.snoozed >= today) return null; // "Not now" hides it for a few days
  let score, why = "";
  const since = (d) => dayNum(today) - dayNum(d || a.created || today);

  if (a.type === "habit") {
    if (!isScheduled(a, today) || habitState(a, ctx.logs, today)) return null;
    score = ctx.hour >= 17 ? 45 : 15; // habits mostly live in the checklist; nudge only later in the day
    why = ctx.hour >= 17 ? "Still open today" : "On today's list";
  } else if (a.type === "task") {
    score = 35;
    if (a.due) {
      const left = dayNum(a.due) - dayNum(today);
      if (left < 0) { score += 40; why = `Was due ${short(a.due)}`; }
      else if (left === 0) { score += 35; why = "Due today"; }
      else if (left <= 3) { score += 22; why = `Due in ${left} day${left > 1 ? "s" : ""}`; }
      else if (left <= 7) { score += 8; why = `Due ${short(a.due)}`; }
    }
  } else if (a.type === "skill") {
    if (a.lastDone === today) { score = 5; why = "Already worked on today, only if you want more"; }
    else {
      const gap = since(a.lastDone);
      score = 32 + Math.min(30, gap * 3); // neglected skills rise slowly, capped so nothing turns urgent
      why = !a.lastDone ? "A small first step" : gap >= 7 ? `Not touched for ${gap} days` : "Keep it moving";
    }
  } else { // explore, cook: the enjoyable side
    score = 30;
    const weekend = [0, 6].includes(parse(today).getDay());
    const funDates = ctx.all.filter((x) => (x.type === "explore" || x.type === "cook") && x.doneOn).map((x) => x.doneOn).sort();
    const funGap = since(funDates[funDates.length - 1]);
    if (weekend) { score += 15; why = "It's the weekend. Something enjoyable"; }
    if (funGap >= 7) { score += 12; why ||= "Time for something just for fun"; }
    if (a.favourite) score += 4;
    why ||= "Just for fun";
  }

  if (a.minutes && a.minutes <= 30) score += 8; // prefer small, doable things
  if (a.minutes && a.minutes >= 120) score -= 8;
  const r = (ctx.recent || []).indexOf(a.id);
  if (r >= 0) score -= 25 - r * 4; // shown recently: let something else have a turn
  score += jitter(a.id + today); // a little daily variety, but stable within a day
  return { score, why };
}

function jitter(s) { let h = 0; for (const c of s) h = (h * 31 + c.charCodeAt(0)) | 0; return Math.abs(h) % 10; }

// Best candidate not in ctx.skip (ids passed over with "Suggest another" today), or null.
export function pickNext(all, ctx) {
  const c = { ...ctx, all };
  let best = null;
  for (const a of all) {
    if (ctx.skip?.has(a.id)) continue;
    const s = scoreOf(a, c);
    if (s && (!best || s.score > best.score)) best = { a, ...s };
  }
  return best;
}
