// Run with: npm test
import { test } from "node:test";
import assert from "node:assert/strict";
import { words, titleOf, preview, parseTags, tagKey, tagStats, showTags, tagMatches, looksLike, diaryStats, onThisDay, filterEntries, neighbours, tagsOf, expired, KEEP_DELETED_DAYS, ago } from "../public/diary.js";
import { styleProfile, styleSource, describeStyle, samplesFor, buildMessages, cleanOutput, unsupported, dropped, langOf, noteLang, targetWords, MIN_STYLE, aboutSuggestions, addToAbout, looksGarbled } from "../public/writestyle.js";

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

test("near-copy tags are one tag: part time / Part-time / parts times", () => {
  assert.equal(tagKey("part time"), tagKey("Part-time"));
  assert.equal(tagKey("part time"), tagKey("parts times"));
  assert.equal(tagKey("part time"), tagKey("parttime"));
  assert.notEqual(tagKey("class"), tagKey("cla")); // "ss" isn't a plural
  assert.deepEqual(parseTags("parts times, Part-Time, work", ["part time"]), ["part time", "work"]);
  const list = [e("1", "2026-11-01", "a", { tags: ["part time"] }), e("2", "2026-11-02", "b", { tags: ["part time"] }), e("3", "2026-11-03", "c", { tags: ["parts times", "work"] })];
  assert.deepEqual(tagStats(list).map((s) => [s.tag, s.n]), [["part time", 3], ["work", 1]]);
  assert.deepEqual(tagsOf(list), ["part time", "work"]);
  assert.deepEqual(showTags(["parts times", "part time"], tagStats(list)), ["part time"]);
  assert.deepEqual(filterEntries(list, { tag: "part time" }).map((x) => x.id), ["3", "2", "1"]);
  assert.equal(tagMatches("parts time", tagStats(list)).same.tag, "part time");
  assert.deepEqual(tagMatches("wo", tagStats(list)).list.map((s) => s.tag), ["work"]);
  assert.deepEqual(tagMatches("", tagStats(list), ["work"]).list.map((s) => s.tag), ["part time"]);
  // Misspellings and texting short forms point at the tag you have.
  const mk = tagStats([e("9", "2026-11-04", "x", { tags: ["Makan", "kerja", "friends"] })]);
  assert.deepEqual(tagMatches("mkan", mk).close.map((s) => s.tag), ["Makan"]);
  assert.deepEqual(tagMatches("makn", mk).close.map((s) => s.tag), ["Makan"]);
  assert.deepEqual(tagMatches("mkaan", mk).close.map((s) => s.tag), ["Makan"]);
  assert.deepEqual(tagMatches("kja", mk).close.map((s) => s.tag), ["kerja"]);
  assert.deepEqual(tagMatches("freinds", mk).close.map((s) => s.tag), ["friends"]);
  assert.deepEqual(tagMatches("tidur", mk).close, []);
  assert.equal(looksLike("ma", "makan"), false); // too short to guess
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
  assert.match(user, /1\. \(English\) went mamak with friends\n2\. \(Malay\) tadi aku mezmerize do/);
  assert.match(buildMessages({ notes: "tadi aku mezmerize do, macam star align" })[0].content, /English words used inside a Malay note/);
  assert.equal(cleanOutput("Dear Diary,\n\n(Malay) Tadi aku mezmerize."), "Dear Diary,\n\nTadi aku mezmerize.");
});

test("numbered output: each sentence checked against its own note, then joined into paragraphs", () => {
  const notes = "went to the offise erly\nmeeting with boss abt the new projek\nlunch wif colleagues\nhari ni hujan";
  const out = "1. I went to the office early today.\n2. Then I had a meeting with my boss about the new project.\n3. Pastu aku pergi bercuti ke Langkawi dengan keluarga.\n4. Hari ni hujan.";
  const c = cleanOutput(out, notes);
  assert.ok(c.startsWith("Dear Diary,\n\nI went to the office early today. Then I had a meeting"), c);
  assert.ok(!c.includes("Langkawi") && c.includes("Lunch with colleagues."), c); // strayed sentence -> the note itself
  // A missing number gets its note; nothing is dropped.
  assert.match(cleanOutput("1. I went to the office early today.", notes), /Hari ni hujan\./);
  // While streaming, the half-written last line is shown as it is and missing lines aren't filled in yet.
  const live = cleanOutput("1. I went to the office early today.\n2. Then I had a mee", notes, false);
  assert.ok(live.endsWith("Then I had a mee") && !live.includes("hujan"), live);
});

test("story mode: tells each note in a few sentences, keeps what it added, drops summaries", () => {
  const notes = "hantar kereta service pagi\nlunch nasi lemak dgn Muna\npetang hujan, tidur awal";
  const msgs = buildMessages({ notes, story: true, compact: true });
  assert.match(msgs[0].content, /told like a story/);
  assert.match(msgs[2].content, /gagahkan diri/); // the Malay story example
  assert.match(msgs.at(-1).content, /2\. lunch nasi lemak dengan Muna/);
  const raw = "1. Pagi tadi hantar kereta service, lepas tu baru rasa lapar.\n2. Lunch dengan Muna, makan nasi lemak, best gila!\n3. Petang hujan lebat, terus tidur awal. Jadi, kesimpulan: hari yang tenang.";
  const c = cleanOutput(raw, notes, true, true);
  assert.match(c, /baru rasa lapar/); // story additions stay (they're listed for checking, not removed)
  assert.doesNotMatch(c, /kesimpulan/);
  assert.ok(unsupported(notes, c).includes("lapar"));
  // Two notes folded into one line: the folded note isn't added again.
  const folded = cleanOutput("1. Pagi tadi hantar kereta service, then lunch nasi lemak dengan Muna.\n2. Petang hujan, tidur awal.", notes, true, true);
  assert.equal((folded.match(/nasi lemak/g) || []).length, 1, folded);
  // Close-to-notes mode still puts the note back when a sentence adds anything.
  assert.match(cleanOutput(raw, notes), /Hantar kereta service pagi\./);
});

test("buildMessages numbers the notes and adds style only when given", () => {
  const notes = "Went mamak with friends\n- Discussed career\nWorried about money";
  const msgs = buildMessages({ notes }), sys = msgs[0], user = msgs.at(-1);
  assert.equal(user.role, "user");
  assert.equal(sys.role, "system");
  assert.match(sys.content, /Never add events/);
  assert.doesNotMatch(sys.content, /How this person writes/);
  assert.match(user.content, /1\. Went mamak with friends\n2\. Discussed career\n3\. Worried about money/);
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

test("fixed spelling and spelled-out short forms are not flagged", () => {
  const notes = "tadi aku mezmerize do, macam star align, tiber je dapat ckp dgn dia\nbalik rumah terus tdur, esok x blh lmbat";
  const out = "Dear Diary,\n\nTadi aku mesmerised do, macam star align, tiba-tiba je dapat cakap dengan dia. Balik rumah terus tidur, esok tak boleh lambat.";
  assert.deepEqual(unsupported(notes, out), []);
  assert.deepEqual(dropped(notes, out), []);
  // A real new word is still caught.
  assert.ok(unsupported(notes, out + " Aku pergi kenduri.").includes("kenduri"));
  const msgs = buildMessages({ notes });
  assert.match(msgs[0].content, /Correct every spelling mistake/);
  // Short forms are spelled out before the model sees them.
  assert.match(msgs.at(-1).content, /tiba-tiba je dapat cakap dengan dia/);
  assert.match(msgs.at(-1).content, /esok tak boleh lmbat/);
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

test("looksGarbled catches scrambled phone output, not real entries", () => {
  const junk = "Dear Diary,\n\nabled Shadows Bondsavar operative 篚_life美团dk maxY.Abs ms_REFERERوجد.iconaddon ]\n\nework较差 הכולל<TextView pressing/hRuleContext deserved wi.mockitoriter dood_ENT";
  assert.equal(looksGarbled(junk, "Harini bangun awal, pergi jog 5km"), true);
  assert.equal(looksGarbled("Dear Diary,\n\nabled Shadows maxY.Abs ms_REFERER iconAddon hRuleContext wi.mockito dood_ENT TextView beastCBC"), true); // code bits only
  assert.equal(looksGarbled("Dear Diary,\n\nHarini bangun awal, pergi jog 5km, pukul 6 habis. Kemudian sampai office dgr lagu. Best gila haha."), false);
  assert.equal(looksGarbled("Dear Diary,\n\nWent to the café near the office. The coffee was good, the cake was too sweet. Would go back."), false);
  assert.equal(looksGarbled("Dear Diary,\n\n今天去了吉隆坡，很开心。", "今天去了吉隆坡，很开心"), false); // the notes were in Chinese
  assert.equal(looksGarbled("Dear Diary,\n\nshort"), false);
});

test("compact prompt (phones) is shorter but keeps the rules that matter", () => {
  const about = "Aku Amir. ".repeat(60);
  const full = buildMessages({ notes: "went mamak\nrisau pasal duit", profile: styleProfile(mine), samples: ["lepak mamak dengan geng."], about });
  const small = buildMessages({ notes: "went mamak\nrisau pasal duit", profile: styleProfile(mine), about, compact: true });
  const len = (m) => m.reduce((a, x) => a + x.content.length, 0);
  assert.ok(len(small) < len(full) * 0.8, `${len(small)} vs ${len(full)}`);
  assert.match(small[0].content, /Never add events/);
  assert.match(small[0].content, /marked with its language/);
  assert.match(small[0].content, /Never translate/);
  assert.doesNotMatch(small[0].content, /chatbot words|\n- \n/);
});
