// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { words, titleOf, preview, parseTags, diaryStats, onThisDay, filterEntries, neighbours, tagsOf, expired, KEEP_DELETED_DAYS, ago } from "../public/diary.js";
import { styleProfile, styleSource, describeStyle, samplesFor, buildMessages, cleanOutput, unsupported, dropped, langOf, noteLang, targetWords, MIN_STYLE, aboutSuggestions, addToAbout } from "../public/writestyle.js";

const e = (id, date, body, more = {}) => ({ id, person: "p1", date, body, created: 0, ...more });

test("words counts English, Malay and numbers", () => {
  assert.equal(words("Dear Diary, went mamak at 2AM lah"), 7);
  assert.equal(words(""), 0);
});

test("titleOf uses the title, else the first sentence without Dear Diary", () => {
  assert.equal(titleOf({ title: " Mamak night ", body: "x" }), "Mamak night");
  assert.equal(titleOf({ body: "Dear Diary,\n\nWent to mamak. Then home." }), "Went to mamak.");
  assert.equal(titleOf({ body: "" }), "A quiet entry");
  assert.ok(titleOf({ body: "a ".repeat(80) }).endsWith("…"));
});

test("preview cuts at a word", () => {
  const p = preview({ body: "Dear Diary, " + "hello world ".repeat(40) }, 30);
  assert.ok(p.length <= 30 && p.endsWith("…"));
});

test("parseTags splits, lowercases, dedupes and caps", () => {
  assert.deepEqual(parseTags("Friends, #work, friends,  Family time "), ["friends", "work", "family time"]);
  assert.equal(parseTags("a,b,c,d,e,f,g,h,i,j").length, 8);
});

test("diaryStats: streak ends today or yesterday, deleted entries don't count", () => {
  const list = [e("1", "2026-11-20", "a"), e("2", "2026-11-19", "b"), e("3", "2026-11-18", "c"), e("4", "2026-11-16", "d"), e("5", "2026-10-30", "x"), e("6", "2026-11-17", "y", { deleted: 1 })];
  assert.deepEqual(diaryStats(list, "2026-11-20"), { total: 5, streak: 3, month: 4, last: "2026-11-20" });
  assert.equal(diaryStats(list, "2026-11-21").streak, 3); // nothing yet today: yesterday's streak still stands
  assert.equal(diaryStats(list, "2026-11-22").streak, 0);
  assert.deepEqual(diaryStats([], "2026-11-20"), { total: 0, streak: 0, month: 0, last: null });
});

test("onThisDay finds earlier years only, and 29 Feb on 28 Feb", () => {
  const list = [e("a", "2025-11-20", "x"), e("b", "2024-11-20", "y"), e("c", "2026-11-20", "now"), e("d", "2024-02-29", "leap")];
  assert.deepEqual(onThisDay(list, "2026-11-20").map((x) => x.id), ["a", "b"]);
  assert.deepEqual(onThisDay(list, "2027-02-28").map((x) => x.id), ["d"]);
});

test("filterEntries searches words, filters month/tag/favourite, sorts", () => {
  const list = [e("1", "2026-11-01", "Mamak with friends", { tags: ["friends"] }), e("2", "2026-10-05", "Work was long", { fav: true }), e("3", "2026-11-03", "Friends again at mamak")];
  assert.deepEqual(filterEntries(list, { q: "MAMAK friends" }).map((x) => x.id), ["3", "1"]);
  assert.deepEqual(filterEntries(list, { month: "2026-10" }).map((x) => x.id), ["2"]);
  assert.deepEqual(filterEntries(list, { tag: "friends" }).map((x) => x.id), ["1"]);
  assert.deepEqual(filterEntries(list, { fav: true }).map((x) => x.id), ["2"]);
  assert.deepEqual(filterEntries(list, { sort: "old" }).map((x) => x.id), ["2", "1", "3"]);
  assert.deepEqual(tagsOf(list), ["friends"]);
});

test("neighbours gives older and newer", () => {
  const list = [e("1", "2026-11-01", "a"), e("2", "2026-11-02", "b"), e("3", "2026-11-03", "c")];
  assert.deepEqual(neighbours(list, "2"), { older: list[0], newer: list[2] });
  assert.equal(neighbours(list, "3").newer, null);
});

test("expired after the keep period", () => {
  const now = Date.now();
  assert.equal(expired({ deleted: now - 864e5 }, now), false);
  assert.equal(expired({ deleted: now - (KEEP_DELETED_DAYS + 1) * 864e5 }, now), true);
  assert.equal(expired({}, now), false);
});

test("ago reads like speech", () => {
  assert.equal(ago("2026-11-20", "2026-11-20"), "today");
  assert.equal(ago("2026-11-19", "2026-11-20"), "yesterday");
  assert.equal(ago("2026-11-17", "2026-11-20"), "3 days ago");
});

// ---------- writing style ----------
const mine = [
  "Dear Diary,\n\nharini penat gila. kerja banyak sangat lah. tapi balik rumah makan nasi lemak, best haha.",
  "Dear Diary,\n\nlepak mamak dengan geng. borak pasal kerja. best je malam ni haha.",
  "Dear Diary,\n\npagi tadi hujan. penat sikit tapi okay lah. esok kerja lagi.",
  "Dear Diary,\n\nhari ni boring je. duduk rumah, tengok movie. penat tapi best.",
];

test("styleSource skips other people, deleted, excluded, AI-written and pre-reset entries", () => {
  const list = [
    e("1", "2026-11-01", mine[0]), e("2", "2026-11-02", mine[1], { person: "p2" }), e("3", "2026-11-03", mine[2], { deleted: 1 }),
    e("4", "2026-11-04", mine[3], { noStyle: true }), e("5", "2026-11-05", mine[0], { ai: true }), e("6", "2026-10-01", mine[1]),
  ];
  assert.deepEqual(styleSource(list, "p1").map((x) => x.id), ["1", "6"]);
  assert.deepEqual(styleSource(list, "p1", "2026-10-15").map((x) => x.id), ["1"]);
});

test("styleProfile needs MIN_STYLE entries and picks up mixing, slang and lowercase", () => {
  assert.equal(styleProfile(mine.slice(0, MIN_STYLE - 1)), null);
  const p = styleProfile(mine);
  assert.ok(p.malay >= 0.7, `malay ${p.malay}`);
  assert.ok(p.slang.includes("best") && p.slang.includes("haha"));
  assert.ok(p.favourites.includes("penat"));
  assert.ok(p.laughs);
  assert.ok(p.lower > 0.5);
  const d = describeStyle(p).join(" ");
  assert.match(d, /mostly in Malay/);
  assert.match(d, /lowercase/);
});

test("samplesFor returns recent excerpts, cut short", () => {
  const long = e("x", "2026-11-09", "Dear Diary,\n\n" + "Went to work and came home. ".repeat(30));
  const s = samplesFor([e("a", "2026-11-01", "too short"), long], 2, 120);
  assert.equal(s.length, 1);
  assert.ok(s[0].length <= 121 && !s[0].startsWith("Dear Diary"));
});

test("langOf tells English, Malay and mixed", () => {
  assert.equal(langOf("Went to work, felt tired but it was okay"), "en");
  assert.equal(langOf("harini penat gila, kerja banyak sangat"), "ms");
  assert.equal(langOf("went mamak with friends\ndiscussed career\nrisau pasal duit sebab gaji lambat"), "mixed");
  // Malay with English words dropped in is still Malay.
  assert.equal(noteLang("tadi aku mezmerize do, macam star align, tiber je dapat ckp dgn dia"), "ms");
  assert.equal(noteLang("meeting dgn client pastu kena present proposal"), "ms");
  assert.equal(noteLang("I was so tired after the meeting"), "en");
  assert.equal(noteLang("reach office late already lah"), "manglish");
  const user = buildMessages({ notes: "went mamak with friends\ntadi aku mezmerize do, macam star align" }).at(-1).content;
  assert.match(user, /- \(English\) went mamak with friends\n- \(Malay\) tadi aku mezmerize do/);
  assert.match(buildMessages({ notes: "tadi aku mezmerize do, macam star align" })[0].content, /English words used inside a Malay note/);
  assert.equal(cleanOutput("Dear Diary,\n\n(Malay) Tadi aku mezmerize."), "Dear Diary,\n\nTadi aku mezmerize.");
});

test("buildMessages keeps notes as bullet lines and adds style only when given", () => {
  const notes = "Went mamak with friends\n- Discussed career\nWorried about money";
  const msgs = buildMessages({ notes }), sys = msgs[0], user = msgs.at(-1);
  assert.equal(user.role, "user");
  assert.equal(sys.role, "system");
  assert.match(sys.content, /Never add events/);
  assert.doesNotMatch(sys.content, /How this person writes/);
  assert.match(user.content, /- Went mamak with friends\n- Discussed career\n- Worried about money/);
  const [sys2] = buildMessages({ notes, profile: styleProfile(mine), samples: ["lepak mamak dengan geng."] });
  assert.match(sys2.content, /How this person writes/);
  assert.match(sys2.content, /lepak mamak dengan geng/);
  assert.ok(targetWords("a b c", null) >= 45);
});

test("cleanOutput strips chatter and fixes the opening", () => {
  assert.equal(cleanOutput("Sure! Here's your entry:\n\n\"Dear Diary, Today was nice.\""), "Dear Diary,\n\nToday was nice.");
  assert.equal(cleanOutput("**Dear Diary,**\n\nWent out.\n\nNote: I kept it short."), "Dear Diary,\n\nWent out.");
  assert.equal(cleanOutput("Went out."), "Dear Diary,\n\nWent out.");
  assert.equal(cleanOutput(""), "");
});

test("language follows the notes, never the style profile", () => {
  const ms = buildMessages({ notes: "harini penat gila\nkerja banyak sangat" })[0].content;
  assert.match(ms, /whole entry in Malay/);
  const en = buildMessages({ notes: "Went to work\nFelt tired but okay", profile: styleProfile(mine) })[0].content;
  assert.match(en, /whole entry in English/);
  assert.doesNotMatch(en, /mostly in Malay|Mixes Malay/); // Amir's Malay-heavy profile doesn't pull an English entry into Malay
  assert.equal(langOf("traffic so bad lah, reach office late already"), "manglish");
  assert.equal(langOf("cannot find parking, alamak"), "manglish");
  assert.match(buildMessages({ notes: "makan nasi lemak with team\nboss give bonus, shiok lah" })[0].content, /Manglish/);
  const mixed = buildMessages({ notes: "went mamak with friends\nrisau pasal duit" })[0].content;
  assert.match(mixed, /Each note is marked with its language/);
});

test("cleanOutput drops glosses and lines to the reader", () => {
  const notes = "happy walaupun penat\nlaughed until 2AM";
  assert.equal(cleanOutput("Dear Diary,\n\nHappy despite the penat (tiredness). Laughed until 2AM.\n\nI hope you're having a good day!", notes),
    "Dear Diary,\n\nHappy despite the penat. Laughed until 2AM.");
});

test("unsupported flags names, numbers and feelings the notes didn't give", () => {
  const notes = "went mamak with friends, discussed career, worried about money, laughed until 2AM";
  const out = "Dear Diary,\n\nWent to mamak with my friends and Sarah. We talked about our careers. I was worried about money, and grateful too. We laughed until 2AM, then left at 3.";
  const f = unsupported(notes, out);
  assert.ok(f.includes("Sarah"));
  assert.ok(f.includes("grateful"));
  assert.ok(f.includes("3"));
  assert.ok(!f.includes("worried") && !f.includes("2AM") && !f.includes("Went"));
});

test("unsupported also catches invented Malay content words", () => {
  const notes = "tadi aku mezmerize do, macam star align, tiber je dapat ckp dgn dia\nwent mamak with friends after work";
  const f = unsupported(notes, "Dear Diary,\n\nTadi aku mezmerize do, macam star align. Aku jalan-jalan dengan keluarga sejak pagi. Went mamak with friends after work.");
  assert.ok(f.includes("keluarga") && f.includes("jalan-jalan") && f.includes("pagi"), f.join());
  assert.deepEqual(unsupported(notes, "Dear Diary,\n\nTadi aku mezmerize do, macam star align, tiber je dapat ckp dgn dia. Then I went mamak with friends after work."), []);
});

test("dropped lists the person's own Malay / Manglish words the draft lost", () => {
  const notes = "boss belanja nasi lemak, shiok\nbalik rumah terus tidur";
  assert.deepEqual(dropped(notes, "Dear Diary,\n\nBoss belanja nasi lemak. Shiny. Went home and slept."), ["shiok", "balik", "rumah", "terus", "tidur"]);
  assert.deepEqual(dropped(notes, "Dear Diary,\n\nBoss belanja nasi lemak, shiok. Balik rumah terus tidur."), []);
});

test("About you goes in the background, and its names aren't flagged", () => {
  const about = "Aku Amir, engineer kat KL. Wife aku Lina, aku panggil dia sayang.";
  const sys = buildMessages({ notes: "dinner dengan wife", about })[0].content;
  assert.match(sys, /About the writer/);
  assert.match(sys, /Never add anything from here as something that happened today/);
  assert.match(sys, /panggil dia sayang/);
  assert.doesNotMatch(buildMessages({ notes: "dinner" })[0].content, /About the writer/);
  assert.deepEqual(unsupported("dinner dengan wife", "Dear Diary,\n\nDinner dengan Lina.", about), []);
  assert.ok(unsupported("dinner dengan wife", "Dear Diary,\n\nDinner dengan Sarah.", about).includes("Sarah"));
});

test("aboutSuggestions: names that keep coming up, words they use, language mix; never what's already there or dismissed", () => {
  const texts = [
    "Dear Diary,\n\nlepak dengan Lina kat Bangsar. penat gila tapi best haha.",
    "Dear Diary,\n\nmakan dengan Lina malam ni. penat gila lah, best.",
    "Dear Diary,\n\nLina masak nasi lemak. Monday lagi esok, penat gila haha.",
    "Dear Diary,\n\nkerja sampai malam. Lina call, borak lama. best je.",
  ];
  const s = aboutSuggestions(texts);
  const name = s.find((x) => x.kind === "ask");
  assert.equal(name.name, "Lina");
  assert.match(name.text, /4 of your entries/);
  assert.ok(!s.some((x) => x.name === "Monday" || x.name === "Bangsar")); // weekdays never; Bangsar only once
  assert.ok(s.some((x) => x.key === "words" && /penat gila|best/.test(x.line)));
  assert.ok(s.some((x) => x.key === "lang" && /Malay/.test(x.line)));
  // Already in About you, or dismissed: gone.
  const later = aboutSuggestions(texts, "Lina is my wife. I write rojak, Malay and English.", [s.find((x) => x.key === "words").key]);
  assert.ok(!later.some((x) => x.name === "Lina" || x.key === "lang" || x.key === "words"));
  assert.deepEqual(aboutSuggestions(texts.slice(0, 2)), []); // too few entries to say anything
});

test("addToAbout appends a line and refuses past the limit", () => {
  assert.equal(addToAbout("Aku Amir.", "Lina is my wife."), "Aku Amir.\nLina is my wife.");
  assert.equal(addToAbout("", "Lina is my wife."), "Lina is my wife.");
  assert.equal(addToAbout("x".repeat(600), "more"), null);
});
