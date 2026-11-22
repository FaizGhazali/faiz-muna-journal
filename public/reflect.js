// Reflections: short cards that look back over one person's mood, diary (Dearly) and logs.
// Pure (no Firebase, no DOM); tests in tests/reflect.test.mjs. The "Reflect" card on the dashboard shows one,
// picked by pickReflection(); the Mood history page lists them all. Our own words, never the model's.
// Each card: { key, kind, score, title, text, date?, entry? (diary id), mood? (1..5) }. Higher score = shown first.
import { MOODS, periods, boosters, MIN_DAYS } from "./mood.js";
import { onThisDay, diaryStats, titleOf, preview, live, tagStats, showTags } from "./diary.js";
import { parse, addDays } from "./util.js";

const short = (d) => parse(d).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });
const plural = (n, w) => `${n} ${w}${n === 1 ? "" : "s"}`;
// "Title — the start of the entry", or just the start when it has no title of its own.
const story = (e) => (e.title?.trim() ? `${e.title.trim()} — ${preview(e, 110)}` : preview(e, 140) || titleOf(e));
// The newest entry on a day (several a day are fine).
const lastOn = (list, d) => list.filter((e) => e.date === d).sort((a, b) => (b.created || 0) - (a.created || 0))[0] || null;

// map: { date: 1..5 } (moodMap), diary: this person's entries, facts: { date: { ran, habits, move, weighed } }.
export function reflections({ map = {}, diary = [], facts = {}, today }) {
  const out = [], list = live(diary).filter((e) => e.date <= today), y = addDays(today, -1);
  const add = (c) => out.push(c);

  // A hard day just now: bring back a great day they wrote about. Comfort, never "cheer up".
  const recent = map[today] ?? map[y];
  if (recent && recent <= 2) {
    const great = Object.keys(map).filter((d) => map[d] === 5 && d < y && d >= addDays(today, -365)).sort().reverse();
    const d = great.find((x) => lastOn(list, x)) || great[0];
    if (d) {
      const e = lastOn(list, d);
      add({ key: `comfort-${d}`, kind: "comfort", score: 95, date: d, entry: e?.id, mood: 5, title: "Hard days pass",
        text: e ? `Remember ${short(d)}? It was a great day. ${story(e)}` : `Your last great day was ${short(d)}. There will be more.` });
    }
  }

  // On this day in earlier years.
  for (const e of onThisDay(list, today).slice(0, 2)) {
    add({ key: `otd-${e.id}`, kind: "past", score: 90, date: e.date, entry: e.id, mood: e.mood, title: `On this day, ${e.date.slice(0, 4)}`, text: story(e) });
  }

  // A week and a month ago.
  for (const [n, when] of [[7, "A week ago"], [30, "A month ago"]]) {
    const e = lastOn(list, addDays(today, -n));
    if (e) add({ key: `ago${n}-${e.id}`, kind: "past", score: n === 7 ? 62 : 60, date: e.date, entry: e.id, mood: e.mood, title: `${when} you wrote`, text: story(e) });
  }

  // The best day of the last seven.
  const week = Object.keys(map).filter((d) => d >= addDays(today, -6) && d <= today && map[d] >= 4).sort((a, b) => map[b] - map[a] || b.localeCompare(a));
  if (week.length) {
    const d = week[0], e = lastOn(list, d);
    add({ key: `bright-${d}`, kind: "bright", score: 58, date: d, entry: e?.id, mood: map[d], title: "Bright spot this week",
      text: e ? `${short(d)} was a ${MOODS[map[d]].word.toLowerCase()} day. ${story(e)}` : `${short(d)} was a ${MOODS[map[d]].word.toLowerCase()} day.${facts[d]?.ran ? " You exercised that day." : ""}` });
  }

  // This week compared with last week.
  const P = periods(map, today);
  if (P.week.now != null && P.week.before != null) {
    const diff = P.week.now - P.week.before;
    if (Math.abs(diff) >= 0.2) add({ key: "trend", kind: "trend", score: Math.abs(diff) >= 0.5 ? 70 : 40, mood: Math.round(P.week.now),
      title: diff > 0 ? "A lighter week" : "A heavier week",
      text: diff > 0 ? `Your mood is up ${diff.toFixed(1)} on last week (${P.week.now.toFixed(1)} vs ${P.week.before.toFixed(1)}). What's been helping?`
        : `Your mood is down ${(-diff).toFixed(1)} on last week (${P.week.now.toFixed(1)} vs ${P.week.before.toFixed(1)}). Be gentle with yourself, and do one small thing that usually helps.` });
  }

  // What tends to go with good days (needs MIN_DAYS rated days, same as the Mood page).
  const B = boosters(map, facts), top = B.rows[0];
  if (B.days >= MIN_DAYS && top && top.diff >= 0.3) {
    add({ key: `boost-${top.key}`, kind: "pattern", score: 65, title: "What lifts your days",
      text: `Days you ${{ ran: "exercised", habits: "did most habits", move: "did a Next Move", weighed: "weighed in" }[top.key]} average ${top.with.toFixed(1)}, other days ${top.without.toFixed(1)}. It goes together, it doesn't prove why.` });
  }

  // A tag that keeps turning up on good days.
  const good = list.filter((e) => map[e.date] >= 4), count = {}, stats = tagStats(list);
  for (const e of good) for (const t of new Set(showTags(e.tags, stats))) count[t] = (count[t] || 0) + 1;
  const tag = Object.keys(count).filter((t) => count[t] >= 2).sort((a, b) => count[b] - count[a] || a.localeCompare(b))[0];
  if (tag) add({ key: `tag-${tag}`, kind: "pattern", score: 55, title: `“${tag}” and your good days`, text: `${plural(count[tag], "good day")} you wrote about ${count[tag] === 1 ? "has" : "have"} the tag “${tag}”.` });

  // Writing streak.
  const S = diaryStats(list, today);
  if (S.streak >= 3) add({ key: "streak", kind: "streak", score: 50, title: `${S.streak} days of writing`, text: `You've written ${S.streak} days in a row. Small days are worth keeping too.` });

  // This month at a glance.
  const month = Object.keys(map).filter((d) => d.startsWith(today.slice(0, 7)) && d <= today);
  if (month.length >= 5) {
    const g = month.filter((d) => map[d] >= 4).length;
    add({ key: "month", kind: "month", score: 45, title: "This month so far", text: `${g} of ${plural(month.length, "rated day")} were good or great.` });
  }

  if (!out.length) add({ key: "empty", kind: "empty", score: 0, title: "Reflections grow here", text: "Rate a few days or write in Dearly, and looking-back cards show up here." });
  return out.sort((a, b) => b.score - a.score || a.key.localeCompare(b.key));
}

// The card for the dashboard. Something urgent (a hard day, On this day) leads; otherwise one of the top three,
// changing each day. skip = how many times "Another" was tapped.
export function pickReflection(cards, today, pid = "", skip = 0) {
  if (!cards.length) return null;
  let h = 0;
  for (const c of `${today}|${pid}`) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const start = cards[0].score >= 90 ? 0 : h % Math.min(3, cards.length);
  return cards[(start + skip) % cards.length];
}
