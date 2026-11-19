// Made-up sample journal for the demo: two invented people, about 12 weeks of history ending today.
// Pure: no Firebase, no DOM. The numbers are random but repeatable, so every visitor sees the same story.
// Never put real family data here.
import { iso, addDays, parse } from "./suggest.js";

const DAYS = 84;

export function sampleData(now = new Date()) {
  const T = iso(now), ago = (n) => addDays(T, -n), dow = (d) => parse(d).getDay();
  let seed = 20261119;
  const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const jitter = (n) => (rnd() - 0.5) * 2 * n;
  const r1 = (v) => Math.round(v * 10) / 10;

  const born = iso(new Date(now.getFullYear() - 34, now.getMonth() - 4, 12));
  const people = [
    { id: "p1", name: "Amir", age: 34, sex: "Male", cm: 172, born },
    { id: "p2", name: "Lina", age: 31, sex: "Female", cm: 160 },
  ];
  // Weight from → to over the 12 weeks, runs on which weekdays, pace (s/km) from → to, average HR from → to, km range.
  const plan = {
    p1: { kg: [84.2, 79.1], runDays: [2, 4, 6], pace: [452, 398], hr: [152, 147], km: [3.5, 8] },
    p2: { kg: [66.4, 62.2], runDays: [1, 3, 6], pace: [528, 468], hr: [158, 152], km: [2.5, 5.5] },
  };
  const notes = ["Slept well.", "Hot day, took it easy.", "Big lunch with family.", "Felt strong today.", "Rainy, ran indoors.", "Tired after work.", "Walked to the market too."];

  const entries = {};
  for (const p of people) {
    const c = plan[p.id];
    for (let i = DAYS; i >= 0; i--) {
      const d = ago(i), t = 1 - i / DAYS, e = { person: p.id, date: d };
      const weighIn = i === DAYS || (i === 0 ? p.id === "p1" : rnd() < 0.6);
      if (weighIn) e.weight = r1(c.kg[0] + (c.kg[1] - c.kg[0]) * t + jitter(0.45));
      if (i > 0 && c.runDays.includes(dow(d)) && rnd() < 0.8) {
        const km = Math.round((c.km[0] + rnd() * (c.km[1] - c.km[0])) * 100) / 100;
        const pace = Math.round(c.pace[0] + (c.pace[1] - c.pace[0]) * t + jitter(14));
        const hr = Math.round(c.hr[0] + (c.hr[1] - c.hr[0]) * t + jitter(4));
        const secs = Math.round(km * pace);
        e.run = {
          source: "coros", km, secs, hr, pace, effort: pace - Math.round(rnd() * 8),
          hrMax: hr + 14 + Math.round(rnd() * 10), hrr: Math.round(20 + t * 8 + jitter(4)), load: Math.round(km * (11 + rnd() * 4)),
          cadence: Math.round(162 + t * 6 + jitter(3)), kcal: Math.round(km * (p.id === "p1" ? 72 : 58)),
        };
        e.minutes = Math.round(secs / 60);
      }
      // Mood 1-5: better on run days and weekends, a little better over the weeks. Today isn't over, and Lina hasn't rated yesterday yet.
      if (i > 0 && !(i === 1 && p.id === "p2") && rnd() < 0.88) {
        const lift = (e.run ? 0.7 : 0) + ([0, 6].includes(dow(d)) ? 0.5 : 0) + t * 0.4;
        e.mood = Math.max(1, Math.min(5, Math.round(2.7 + lift + jitter(1.3))));
      }
      if (i === DAYS) e.note = "Starting weight.";
      else if ((e.weight || e.run) && rnd() < 0.14) e.note = notes[Math.floor(rnd() * notes.length)];
      if (Object.keys(e).length > 2) entries[`${p.id}_${d}`] = e;
    }
  }

  const stamp = (daysAgo) => now.getTime() - daysAgo * 864e5;
  const act = (id, owner, title, type, status, created, { age = created, ...extra } = {}) =>
    [id, { owner, title, type, status, created: ago(created), updated: stamp(age), ...(status === "inbox" ? {} : { started: ago(created) }), ...extra }];
  const activities = Object.fromEntries([
    act("d-water1", "p1", "Drink 2.5L water", "habit", "active", 40),
    act("d-steps", "p1", "10,000 steps", "habit", "active", 30, { days: [1, 2, 3, 4, 5] }),
    act("d-stretch", "p1", "Stretch before bed", "habit", "active", 20),
    act("d-guitar", "p1", "Learn basic guitar chords", "skill", "active", 35, { minutes: 20, lastDone: ago(3), steps: [{ text: "Learn G, C and D", done: true }, { text: "Switch chords in time", done: true }, { text: "Play one full song", done: false }] }),
    act("d-dentist", "p1", "Book a dental check-up", "task", "active", 6, { minutes: 10, due: ago(-3) }),
    act("d-cafe", "p1", "Try the new café in town", "explore", "active", 12, { minutes: 60, location: "Old town" }),
    act("d-sambal", "p1", "Grilled chicken with sambal", "cook", "active", 25, { minutes: 45, favourite: true, note: "Less oil, more lime." }),
    act("d-hike", "p1", "Plan a weekend hike", "explore", "inbox", 4),
    act("d-bike", "p1", "Fix the bike brakes", "task", "inbox", 2),
    act("d-photo", "p1", "Learn to edit photos", "skill", "paused", 50, { minutes: 30 }),
    act("d-shoes", "p1", "Buy new running shoes", "task", "done", 60, { doneOn: ago(45), lastDone: ago(45), age: 45 }),
    act("d-read", "p2", "Read 10 pages", "habit", "active", 45),
    act("d-water2", "p2", "Drink 2L water", "habit", "active", 30),
    act("d-yoga", "p2", "Yoga, 15 minutes", "habit", "active", 21, { days: [1, 3, 5] }),
    act("d-japan", "p2", "Practise Japanese", "skill", "active", 40, { minutes: 15, lastDone: ago(2), steps: [{ text: "Learn hiragana", done: true }, { text: "Learn katakana", done: false }, { text: "Order food in Japanese", done: false }] }),
    act("d-passport", "p2", "Renew passport", "task", "active", 9, { minutes: 30, due: ago(-10) }),
    act("d-garden", "p2", "Visit the botanical garden", "explore", "active", 15, { minutes: 90 }),
    act("d-oats", "p2", "Overnight oats", "cook", "active", 18, { minutes: 10, favourite: true }),
    act("d-banana", "p2", "Bake banana bread", "cook", "inbox", 3),
    act("d-funrun", "p2", "Sign up for a 5 km fun run", "task", "done", 70, { doneOn: ago(28), lastDone: ago(28), age: 28 }),
  ]);

  // Habit ticks for the last few weeks, and the "moves" history that teaches suggestions each person's routine.
  const habitHour = { "d-water1": 10, "d-steps": 19, "d-stretch": 22, "d-read": 21, "d-water2": 11, "d-yoga": 7 };
  const habitDays = {}, moves = {};
  let m = 0;
  const move = (owner, item, type, act, date, hour) => { moves[`d-m${m++}`] = { owner, item, type, act, date, hour }; };
  for (let i = 28; i >= 0; i--) {
    const d = ago(i);
    for (const owner of ["p1", "p2"]) {
      const done = [];
      for (const [id, a] of Object.entries(activities)) {
        if (a.owner !== owner || a.type !== "habit" || a.created > d) continue;
        if (a.days && !a.days.includes(dow(d))) continue;
        if (i === 0 ? id !== "d-water1" : rnd() > 0.72) continue; // today only Amir's water is ticked so far
        done.push(id);
        move(owner, id, "habit", "done", d, habitHour[id] + Math.round(jitter(1)));
      }
      if (done.length) habitDays[`${owner}_${d}`] = { owner, date: d, done, skipped: [] };
    }
    if (i % 4 === 1) move("p1", "d-guitar", "skill", rnd() < 0.7 ? "done" : "later", d, 20);
    if (i % 3 === 2) move("p2", "d-japan", "skill", rnd() < 0.75 ? "done" : "later", d, 8);
    if (i % 9 === 0 && i) move("p1", "d-sambal", "cook", "done", d, 18);
  }

  return { config: { people: { people } }, entries, activities, habitDays, moves };
}
