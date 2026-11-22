// "Your Next Move": picks ONE thing to do next.
// Pure rules only: no Firebase and no DOM, so this file can be tuned and tested on its own.
import { iso, parse, dayNum, addDays } from "../core/util.js";

export const TYPES = {
  skill: { label: "Skill", color: "--accent" },
  task: { label: "One-time task", color: "--under" },
  explore: { label: "Explore", color: "--over" },
  cook: { label: "Cooking", color: "--obese" },
  habit: { label: "Habit", color: "--good" },
};
export const ALL_DAYS = [0, 1, 2, 3, 4, 5, 6];

// ---- local calendar dates as "YYYY-MM-DD" ----
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
// ctx: { today, hour, logs, recent: [ids, newest first], all: [this person's activities], profile?: learn(...), exercised?: bool }
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

  // What this person has actually done: nudges the rules, never outweighs a due date.
  const L = learned(a, ctx);
  score += L.bonus;
  if (L.why && (!why || GENERIC.has(why))) why = L.why;

  score += jitter(a.id + today); // a little daily variety, but stable within a day
  return { score, why };
}

// ---- learning from history ----
// events: [{ item, type, act: "done"|"later"|"another", date, hour }] for one person.
// Recent events count more (half weight after HALF_LIFE days). Nothing older than MAX_AGE days is used.
const HALF_LIFE = 45, MAX_AGE = 180;
export const partOfDay = (h) => (h < 12 ? 0 : h < 17 ? 1 : 2);
const PARTS = ["morning", "afternoon", "evening"];
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const VERB = { skill: "practise", task: "get jobs done", explore: "go out", cook: "cook", habit: "do your habits" };
const GENERIC = new Set(["On today's list", "Keep it moving", "A small first step", "Just for fun", "Time for something just for fun"]);
const blank = () => ({ n: 0, passed: 0, part: [0, 0, 0], dow: [0, 0, 0, 0, 0, 0, 0] });

export function learn(events, today) {
  const items = {}, types = {};
  for (const e of events) {
    const age = dayNum(today) - dayNum(e.date);
    if (!(age >= 0 && age <= MAX_AGE)) continue;
    const w = 0.5 ** (age / HALF_LIFE);
    const it = (items[e.item] ||= blank());
    if (e.act === "done") {
      const t = (types[e.type] ||= blank());
      for (const x of [it, t]) { x.n += w; x.part[partOfDay(e.hour)] += w; x.dow[parse(e.date).getDay()] += w; }
    } else it.passed += w * (e.act === "later" ? 1 : 0.5); // "Suggest another" is a softer no than "Not now"
  }
  return { items, types };
}

const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, Math.round(x)));

// Returns { bonus, why } from ctx.profile (made by learn) and ctx.exercised (logged exercise today).
export function learned(a, ctx) {
  let bonus = 0, why = "", best = 5; // a reason only shows when its nudge is above 5
  const say = (b, text) => { if (b > best) { best = b; why = text; } };
  const p = ctx.profile, it = p?.items[a.id], t = p?.types[a.type];

  // Said yes or no to this one before?
  if (it && it.n + it.passed >= 2) {
    const rate = (it.n + 1) / (it.n + it.passed + 2); // 0.5 means no lean either way
    const b = clamp((rate - 0.5) * 30, -15, 15);
    bonus += b;
    say(b, a.type === "habit" ? "You rarely miss this one" : "You usually go for this one");
  }

  // When does it usually get done? Its own history if there is enough, else this kind of thing in general.
  const own = it && it.n >= 4, src = own ? it : t && t.n >= 4 ? t : null;
  if (src) {
    const part = partOfDay(ctx.hour), pb = clamp((src.part[part] / src.n - 1 / 3) * 18, -6, 10);
    bonus += pb;
    say(pb, own ? `You usually do this in the ${PARTS[part]}` : `You usually ${VERB[a.type]} in the ${PARTS[part]}`);
    if (src.n >= 6) {
      const day = parse(ctx.today).getDay(), db = clamp((src.dow[day] / src.n - 1 / 7) * 20, -4, 8);
      bonus += db;
      say(db, own ? `${DAYS[day]} is usually when you do this` : `${DAYS[day]} is usually when you ${VERB[a.type]}`);
    }
  }

  // Already exercised today: lean toward something lighter.
  if (ctx.exercised && a.type !== "habit") {
    if (a.minutes >= 60) bonus -= 6;
    else if (a.minutes && a.minutes <= 30) { bonus += 4; say(6, "You've exercised today. Something light"); }
  }
  return { bonus, why };
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
