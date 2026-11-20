// Dearly's writer: the "writing DNA" profile and the prompt for the on-device model. Pure (no DOM, no network).
// Style means how someone writes (sentence length, words, language mix), never who they are or how they feel.
// Tests in tests/diary.test.mjs.
import { words, bodyText, OPENING } from "./diary.js";

export const MIN_STYLE = 3; // entries needed before a style profile is used

// Small word lists, enough to tell English from Malay and spot everyday slang. Lowercase.
const MALAY = new Set(("aku saya kau awak dia kami kita mereka tak tidak nak hendak dah sudah belum lah je jer kot pun dengan yang ni ini tu itu " +
  "sangat sikit banyak makan minum balik pergi pegi kerja rumah tapi sebab macam boleh ada lagi penat seronok sedih risau duit kawan esok semalam " +
  "harini hari malam pagi petang tengah betul memang terus jugak juga kena buat tengok cakap rasa fikir sampai dari untuk dalam atas kat dekat " +
  "orang semua satu dua mana apa kenapa bila sama lepas nanti mungkin agak cuma tapi lama baru suka gembira marah takut rindu lega bersyukur " +
  "tidur bangun mandi masak belanja jalan kedai hujan panas sakit cuti gaji sekolah anak mak ayah abang adik kakak kereta jem lambat awal cepat").split(" "));
const ENGLISH = new Set(("the a an and but so to of in on at for with was were is are am be been have had has do did i me my we our you it this that " +
  "today went got felt feel really very just then after before about because not no yes some all lot more much what when where who how").split(" "));
// Manglish (Malaysian English): particles and words that mark it. Notes with these stay Manglish, never "corrected".
const MANGLISH = new Set(["lah", "leh", "lor", "loh", "meh", "liao", "wor", "mah", "hor", "sia", "alamak", "aiyo", "aiyoh", "aiya", "aiyah", "walao", "wah", "shiok",
  "tapau", "jom", "sien", "cannot", "kena", "dei", "macha", "boleh", "makan", "lepak", "abuden", "takpe", "tak"]);
const SLANG = ["lah", "lor", "leh", "meh", "liao", "alamak", "aiyo", "walao", "shiok", "tapau", "jom", "je", "jer", "kot", "weh", "bro", "sis", "best", "syok", "gila", "geng", "lepak", "mamak", "kantoi", "member", "gonna", "wanna",
  "gotta", "kinda", "lol", "lmao", "tbh", "idk", "omg", "haha", "hehe", "ngl", "btw", "yeay", "alhamdulillah", "insyaallah"];
// Little words that say nothing about style (kept out of "words they come back to").
const MS_FUNC = ("aku saya kau awak dia kami kita mereka tak tidak nak dah sudah belum lah je jer kot pun dengan yang ni ini tu itu tapi sebab macam " +
  "boleh ada lagi dari untuk dalam atas kat dekat apa mana bila sama lepas nanti cuma juga jugak kena buat hari harini").split(" ");
const STOP = new Set([...ENGLISH, ...MS_FUNC, "dear", "diary", "also", "still", "then", "there", "they", "them", "their", "would", "could", "will", "its", "it's", "i'm", "im", "dont", "don't", "didn't"]);
// Feeling words in both languages, as word starts (so "stressful" and "stressed" both match "stress").
// If the model writes one the notes never said, it's flagged for the writer to check.
const FEELINGS = ["happ", "sad", "angr", "upset", "excit", "anxi", "worr", "nervous", "tired", "exhaust", "grate", "thank", "proud", "lonel", "stress",
  "relie", "frustrat", "scare", "afraid", "calm", "peace", "hope", "disappoint", "guilt", "bless", "joy", "luck", "chaot", "overwhelm", "annoy", "bored",
  "glad", "cheer", "depress", "emotion", "sorrow", "unhapp", "miser", "fear", "hurt", "heartbr",
  "gembira", "sedih", "marah", "risau", "penat", "letih", "bersyukur", "syukur", "seronok", "tenang", "takut", "kecewa", "rindu", "bangga", "lega", "geram", "bosan", "stres", "serabut", "suka"];
// Phrases that make a diary sound like a chatbot. The model is told to avoid them.
const AI_WORDS = ["journey", "tapestry", "testament", "cherish", "embrace", "navigate", "delve", "profound", "a reminder that", "in the grand scheme",
  "little did i know", "it's important to", "at the end of the day", "heartwarming", "bittersweet symphony", "whirlwind", "unforgettable"];

const tokens = (s) => (String(s).toLowerCase().match(/[\p{L}][\p{L}'’-]*/gu) || []);
const sentences = (s) => String(s).split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => words(x) > 0);
const paragraphs = (s) => String(s).split(/\n\s*\n/).map((x) => x.trim()).filter(Boolean);
const r = (n) => Math.round(n * 10) / 10;

// Which entries teach the style: this person's, kept (not deleted), not excluded, written since the last reset,
// and written by them, not by the AI helper (so the model never learns from itself).
export function styleSource(list, pid, since = "") {
  return list.filter((e) => e.person === pid && !e.deleted && !e.noStyle && !e.ai && (!since || e.date >= since) && words(bodyText(e.body)) >= 8);
}

export function styleProfile(texts) {
  const bodies = texts.map(bodyText).filter((t) => words(t) > 0);
  if (bodies.length < MIN_STYLE) return null;
  const all = bodies.join("\n\n"), toks = tokens(all), sents = bodies.flatMap(sentences), paras = bodies.flatMap(paragraphs);
  const ms = toks.filter((t) => MALAY.has(t)).length, en = toks.filter((t) => ENGLISH.has(t)).length;
  const count = (list) => { const m = new Map(); list.forEach((t) => m.set(t, (m.get(t) || 0) + 1)); return m; };
  const freq = count(toks);
  const slang = SLANG.filter((s) => (freq.get(s) || 0) >= 2).sort((a, b) => freq.get(b) - freq.get(a)).slice(0, 6);
  // Words they use in many different entries (not just one story).
  const spread = new Map();
  bodies.forEach((b) => new Set(tokens(b)).forEach((t) => spread.set(t, (spread.get(t) || 0) + 1)));
  const favourites = [...spread].filter(([t, n]) => n >= Math.max(2, Math.ceil(bodies.length * 0.3)) && t.length >= 3 && !STOP.has(t) && !slang.includes(t))
    .sort((a, b) => b[1] - a[1] || (freq.get(b[0]) - freq.get(a[0]))).slice(0, 6).map(([t]) => t);
  const pairs = count(bodies.flatMap((b) => { const t = tokens(b); return t.slice(1).map((x, i) => `${t[i]} ${x}`); }));
  const phrases = [...pairs].filter(([p, n]) => n >= 3 && p.split(" ").some((w) => !STOP.has(w))).sort((a, b) => b[1] - a[1]).slice(0, 4).map(([p]) => p);
  const nWords = words(all);
  return {
    n: bodies.length,
    avgSentence: r(sents.reduce((a, s) => a + words(s), 0) / Math.max(1, sents.length)),
    avgWords: Math.round(bodies.reduce((a, b) => a + words(b), 0) / bodies.length),
    avgParagraphs: r(bodies.reduce((a, b) => a + paragraphs(b).length, 0) / bodies.length),
    malay: ms + en ? r(ms / (ms + en)) : 0,
    slang, favourites, phrases,
    laughs: (all.match(/\b(?:ha){2,}h?\b|\bhe(?:he)+\b|\blo+l\b|\blmao\b/gi) || []).length / bodies.length >= 0.3,
    emoji: /\p{Extended_Pictographic}/u.test(all),
    lower: sents.length ? r(sents.filter((s) => /^\p{Ll}/u.test(s)).length / sents.length) : 0,
    exclaim: r(((all.match(/!/g) || []).length / Math.max(1, nWords)) * 100),
    paraLen: paras.length ? Math.round(paras.reduce((a, p) => a + words(p), 0) / paras.length) : 0,
  };
}

// Plain lines, shown to the person ("What Dearly noticed") and given to the model.
export function describeStyle(p) {
  if (!p) return [];
  const out = [];
  out.push(`Sentences are ${p.avgSentence < 10 ? "short" : p.avgSentence < 18 ? "medium length" : "long"}, about ${Math.round(p.avgSentence)} words.`);
  out.push(`Entries are usually about ${p.avgWords} words in ${p.avgParagraphs < 1.5 ? "one paragraph" : `${Math.round(p.avgParagraphs)} paragraphs`}.`);
  out.push(p.malay >= 0.7 ? "Writes mostly in Malay." : p.malay >= 0.35 ? "Mixes Malay and English freely, often in the same sentence." : p.malay >= 0.1 ? "Writes in English with some Malay words mixed in." : "Writes in English.");
  if (p.slang.length) out.push(`Casual words they use: ${p.slang.join(", ")}.`);
  if (p.favourites.length) out.push(`Words they come back to: ${p.favourites.join(", ")}.`);
  if (p.phrases.length) out.push(`Phrases they repeat: "${p.phrases.join('", "')}".`);
  if (p.laughs) out.push("Laughs in writing (haha, hehe).");
  if (p.emoji) out.push("Uses emojis now and then.");
  if (p.lower >= 0.4) out.push("Often starts sentences in lowercase.");
  out.push(p.exclaim >= 1.5 ? "Uses exclamation marks a lot." : p.exclaim < 0.3 ? "Rarely uses exclamation marks." : "Uses the odd exclamation mark.");
  return out;
}

// Up to n short excerpts of their own writing, newest first, cut at a sentence end.
export function samplesFor(list, n = 2, maxChars = 420) {
  return [...list].sort((a, b) => b.date.localeCompare(a.date)).map((e) => bodyText(e.body)).filter((t) => words(t) >= 25).slice(0, n).map((t) => {
    if (t.length <= maxChars) return t;
    const cut = t.slice(0, maxChars), end = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("! "), cut.lastIndexOf("? "), cut.lastIndexOf("\n"));
    return (end > 80 ? cut.slice(0, end + 1) : cut.replace(/\s+\S*$/, "") + "…").trim();
  });
}

// The language of one note is judged by its grammar words, not its vocabulary. Malaysians drop English words into
// Malay ("tadi aku mezmerize do, macam star align, tiber je dapat ckp dgn dia"): that is still a Malay note, and the
// English words in it stay English. Short forms (dgn, ckp, x, sbb, tgk) count as Malay grammar words.
const MS_GRAMMAR = new Set([...MS_FUNC, "tadi", "dapat", "pastu", "lepastu", "tiber", "tibe", "gak", "kan", "pulak", "dgn", "ckp", "sbb", "tgk", "nk", "dh",
  "blh", "x", "tk", "utk", "mcm", "yg", "kt", "jgk", "pon", "bila", "masa", "nanti", "sebab", "sampai", "terus", "dekat", "punya", "kalau", "kalo", "walaupun",
  "tetapi", "akan", "telah", "sedang", "tengah", "semua", "ke", "di", "pada", "oleh", "jadi", "pegi", "pergi", "datang", "balik"]);
// Texting short forms the writer spells out in full ("ckp dgn dia" -> "cakap dengan dia"). Shown to the model as examples
// and used by the checks, so a spelled-out word never counts as invented or lost.
export const SHORT_FORMS = { dgn: "dengan", ckp: "cakap", x: "tak", tk: "tak", sbb: "sebab", tgk: "tengok", nk: "nak", dh: "dah", blh: "boleh",
  utk: "untuk", mcm: "macam", yg: "yang", kt: "kat", jgk: "juga", jgak: "juga", pon: "pun", tiber: "tiba-tiba", tibe: "tiba-tiba", bg: "bagi",
  tp: "tapi", tpi: "tapi", sy: "saya", org: "orang", lps: "lepas", sgt: "sangat", bkn: "bukan", byk: "banyak", skrg: "sekarang", ckit: "sikit",
  sket: "sikit", jln: "jalan", mkn: "makan", blk: "balik", msk: "masuk", klu: "kalau", kalo: "kalau", camne: "macam mana", mlm: "malam", xde: "takde", xder: "takde", xda: "takde", xnak: "tak nak", xleh: "tak boleh",
  tdur: "tidur", tdo: "tidur", blm: "belum", smpai: "sampai", sampe: "sampai", krja: "kerja", kje: "kerja", rmh: "rumah", ptg: "petang",
  bru: "baru", lg: "lagi", lgi: "lagi", dlm: "dalam", sma: "sama", smua: "semua", mmg: "memang", trus: "terus", pkai: "pakai", bli: "beli",
  u: "you", ur: "your", b4: "before", pls: "please", tmr: "tomorrow", tmrw: "tomorrow", bcs: "because", bcoz: "because", coz: "because",
  wif: "with", abt: "about", thru: "through", ppl: "people", gd: "good", rly: "really" };
// Two spellings of the same word: about one typo per three letters, up to three ("mezmerize" / "mesmerised").
function lev(a, b) {
  if (Math.abs(a.length - b.length) > 3) return 9;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length];
}
const sameWord = (a, b) => { const n = Math.min(a.length, b.length); return a === b || (n >= 4 && lev(a, b) <= Math.min(3, Math.max(1, Math.floor(n / 3)))); };
// Every way a note word may legitimately appear in the entry: as written, spelled out, or with a typo fixed.
const expansions = (notes) => new Set(tokens(notes).flatMap((t) => [t, ...(SHORT_FORMS[t] ? tokens(SHORT_FORMS[t]) : [])]));
// Spell out short forms in the notes before the model sees them: small models copy what they're given, so this is
// far more reliable than asking. Capitals are kept ("Dgn" -> "Dengan").
export function expandShort(text) {
  return String(text).replace(/[\p{L}\p{N}]+/gu, (w) => {
    const full = SHORT_FORMS[w.toLowerCase()];
    return !full ? w : /^\p{Lu}/u.test(w) ? full[0].toUpperCase() + full.slice(1) : full;
  });
}
const EN_GRAMMAR = new Set([...ENGLISH].filter((w) => !["got", "so"].includes(w)));
export function noteLang(note) {
  const t = tokens(note);
  if (!t.length) return "en";
  const ms = t.filter((x) => MS_GRAMMAR.has(x) && x !== "lah").length, en = t.filter((x) => EN_GRAMMAR.has(x)).length;
  const mg = t.filter((x) => MANGLISH.has(x)).length + (/\b(?:got (?:\w+ )?one|can or not|already|so \w+ one|cannot)\b/i.test(note) ? 1 : 0);
  if (ms > en) return "ms";
  if (en > ms) return mg ? "manglish" : "en";
  // No grammar words either way (just keywords): go by the content words.
  const msWords = t.filter((x) => MALAY.has(x)).length;
  if (msWords / t.length >= 0.4) return "ms";
  return mg ? "manglish" : "en";
}
// Words a diary can add without adding a fact: linking words and everyday verbs of telling.
const LINKS = new Set(("then after that later also again went go going came come there here when while because since really quite little bit just " +
  "today tonight morning evening myself were been being have having pastu lepas lepastu kemudian then lagi pun tapi sebab bila masa jadi " +
  "honestly actually finally anyway okay simple straight only had memang betul agak harini hari sangat sikit makan pergi terus buat").split(" "));
export const LANG_NAME = { ms: "Malay", en: "English", manglish: "Manglish" };
// The whole set of notes: one language, or "mixed" when the notes differ.
export function langOf(text) {
  const ls = [...new Set(String(text).split(/\n+/).map((l) => l.trim()).filter(Boolean).map(noteLang))];
  if (!ls.length) return "en";
  if (ls.length === 1) return ls[0];
  if (ls.every((l) => l !== "ms")) return "manglish"; // English and Manglish notes together read as Manglish
  return "mixed";
}

// Roughly how long the entry should be: a few words per word of notes, nudged toward their usual length.
export function targetWords(notes, profile) {
  const n = words(notes), base = Math.min(240, Math.max(60, n * 4.2));
  return Math.round(profile ? Math.min(260, Math.max(40, base * 0.6 + profile.avgWords * 0.4)) : base);
}

// One sentence per note, numbered. Tested on Qwen2.5-3B with free-form entries: it sometimes translated English words
// inside Malay ("just boring" -> "hanya bosan") or wrote nonsense ("aku find diri sendiri"). Numbered, it can't merge,
// skip or wander, and the app checks each sentence against its own note (cleanOutput puts the note back if one goes wrong).
// One worked example per language, because the model copies the example: a Malay-only example turned English notes
// into Indonesian-style Malay, and it twisted "Harini" into "Harimau", so the Malay example says "Hari ni".
const EXAMPLES = {
  ms: { notes: ["gym lepas kerja", "leg day, penat gila", "esok confirm tak boleh jalam", "dinner roti canai je, maybe tapau esok"],
    out: ["Hari ni lepas kerja aku terus pergi gym.", "Leg day, memang penat gila.", "Esok confirm tak boleh jalan.", "Pastu dinner aku makan roti canai je, maybe esok tapau."] },
  en: { notes: ["gym aftr wrk", "legs so sor", "dinner was just roti canai, so cheap"],
    out: ["After work today I went straight to the gym.", "Now my legs are so sore.", "Then dinner was just roti canai, so cheap."] },
  manglish: { notes: ["gym aftr work", "leg day, tmr sure cannot walk one", "dinner roti canai only, so cheap one"],
    out: ["After work today I went to the gym.", "Leg day lah, tomorrow sure cannot walk one.", "Then dinner roti canai only, so cheap one."] },
  mixed: { notes: ["(English) gym aftr wrk", "(Malay) leg day, penat gila, esok confirm tak boleh jalam", "(Manglish) dinner roti canai only, so cheap one"],
    out: ["After work today I went straight to the gym.", "Leg day, memang penat gila, esok confirm tak boleh jalan.", "Then dinner roti canai only, so cheap one."] },
};
const numbered = (xs) => xs.map((x, i) => `${i + 1}. ${x}`).join("\n");
// The notes as the model sees them: one per line, short forms spelled out, bullets and trailing commas gone.
export function noteLines(notes) {
  return expandShort(notes).split(/\n+/).map((l) => l.trim().replace(/^[-*•]\s*/, "").replace(/[\s,;]+$/, "")).filter(Boolean).slice(0, 30);
}

// The chat messages for the model. Nothing here leaves the device: the model runs in the browser.
export const ABOUT_MAX = 600;
export function buildMessages({ notes, profile = null, samples = [], name = "", about = "", compact = false }) {
  const lang = langOf(notes), target = targetWords(notes, profile);
  // Language always follows the notes, note by note: what was written in English stays English, Malay stays Malay.
  // The style profile never changes the language (its language line is left out of the prompt below).
  const malayRule = "Malay notes become casual Malay sentences, the way people text, not formal Malay: \"aku\" (not \"saya\" unless the notes say saya), \"lunch\", \"hari ni\", not \"makan siang\" or \"hari ini\". English words used inside a Malay note (like \"mezmerize\", \"star align\", \"meeting\") stay those same English words: only fix their spelling (mezmerize → mesmerised), never swap them for a Malay word.";
  const manglishRule = "Manglish notes stay Manglish, the way Malaysians talk: keep particles like lah, lor, leh, meh, liao, words like makan, tapau, jom, alamak, and grammar like \"got\", \"already\", \"cannot\", \"one\" at the end. Fix the spelling, but never turn it into standard English.";
  const langRule = lang === "ms" ? `The notes are in Malay, so write the whole entry in Malay. ${malayRule} Do not turn it into English.`
    : lang === "manglish" ? `The notes are in Manglish (Malaysian English), so write the entry in Manglish. ${manglishRule} Do not turn it into Malay.`
    : lang === "mixed" ? `Each note is marked with its language. Write each note's sentences in that note's language and never translate a note into another language. ${malayRule} ${manglishRule}`
    : "The notes are in English, so write the whole entry in English. Do not switch to Malay. A Malay or slang word that appears in the notes stays as it is.";
  // Phones: the same rules in five short lines, so the first step on the phone's GPU is lighter.
  const shortLang = lang === "mixed" ? "Each note is marked with its language: write it in that language."
    : lang === "manglish" ? "The notes are Manglish: keep it Manglish (lah, already, cannot), never correct it."
    : lang === "ms" ? "The notes are Malay: write in casual Malay; English words inside stay English." : "The notes are English: write in English.";
    const fix = "Correct every spelling mistake and fix the grammar (offise → office, gud → good, tdur → tidur). Keep casual words and slang (gila, do, lah, best, jom): corrected, not formal.";
  // Diary voice, one sentence per note: a full sentence with "I"/"aku" and a linking word where it fits, but only what
  // that note says. The app joins the sentences into paragraphs.
  const voice = "Each note becomes ONE complete diary sentence, as them (\"I\"/\"aku\"). You may start it with a small linking word (today, then, after that, hari ni, pastu, lepas tu, tapi, sebab tu) and add the small words a full sentence needs.";
  const format = "Reply with the same numbers, one sentence per line, and nothing else. Never merge, split, skip or add a number.";
  const facts = "Each sentence says only what its own note says. Never add events, people, places, times, food, feelings, tastes or opinions.";
  const rules = compact ? [
    `You rewrite this person's numbered notes as their diary. You are not chatting.`,
    voice, format, facts,
    `Keep their words and slang. Never translate. ${shortLang}`,
    fix,
    `No drama, no lessons, no questions, never talk to "you".${profile?.emoji ? "" : " No emojis."}`,
  ] : [
    `You rewrite someone's numbered notes as their own diary. You are not chatting with them. Write as them, in the first person ("I"/"aku"/"saya", whichever the notes use).`,
    voice, format, facts,
    "Only say how they felt where a note says it, in the note's words.",
    "Keep their own words: slang, names and Malay words stay theirs. Never translate a word or explain it in brackets.",
    fix,
    langRule,
    `Plain and casual, like a real person's diary. No drama, no poetry, no lessons, no wishes, no questions, no hashtags, and never talk to the reader ("you").`,
    `Avoid chatbot words such as: ${AI_WORDS.slice(0, 10).join(", ")}.`,
    profile?.emoji ? "Emojis are fine if they fit." : "No emojis.",
  ];
  let style = "";
  if (profile) {
    const lines = describeStyle(profile).filter((l) => !/^Writes (mostly )?in|^Mixes Malay/.test(l)).slice(0, compact ? 4 : 99); // language comes from the notes, not the profile
    style = `\n\nHow this person writes. Copy the style only, never the language (that always follows the notes):\n- ${lines.join("\n- ")}`;
    if (samples.length) style += `\n\nShort examples of their writing, for style only. Do not reuse anything that happened in them:\n${samples.map((s) => `"""${s}"""`).join("\n")}`;
  }
  // "About you": what the person wrote about themselves, so the entry sounds like them (who "dia" or "sayang" is, how they
  // talk, what they call people). Background only: it never becomes something that happened today.
  const bio = String(about || "").trim().slice(0, compact ? 300 : ABOUT_MAX); // phones: shorter, for a lighter first step
  if (bio) style += `\n\nAbout the writer, in their own words. Use it only to sound like them and to know who people are (for example, use the name or nickname they use for someone a note mentions). Never add anything from here as something that happened today, and never mention a person, place or habit from here unless a note does:\n"""${bio}"""`;
  const lines = noteLines(notes);
  return [
    { role: "system", content: rules.filter(Boolean).map((x) => `- ${x}`).join("\n") + style },
    { role: "user", content: `My notes for today:\n${numbered(EXAMPLES[lang].notes)}` },
    { role: "assistant", content: numbered(EXAMPLES[lang].out) },
    { role: "user", content: "That was only an example. Now do mine, using nothing from the example." },
    { role: "assistant", content: "Okay. Send your notes." },
    { role: "user", content: `${name ? `My name is ${name}. ` : ""}My notes for today:\n${numbered(lines.map((l) => `${lang === "mixed" ? `(${LANG_NAME[noteLang(l)]}) ` : ""}${l}`))}` },
  ];
}

// A note written as a plain sentence, for when the model's version of it can't be trusted.
const asSentence = (s) => { const x = String(s).trim(); return x ? x[0].toUpperCase() + x.slice(1) + (/[.!?…]$/.test(x) ? "" : ".") : ""; };
// A sentence that wandered from its note: two or more words the note never gave, much longer than the note, or in
// another language (English notes turned Malay). Then the note itself goes in instead.
export function strayed(note, s) {
  if (!s || words(s) > words(note) * 2.5 + 8) return true;
  if (unsupported(note, `${OPENING}\n\n${s}`).length >= 1) return true; // one is enough: "maybe" -> "mungkin" is one word
  return words(note) >= 4 && noteLang(note) !== noteLang(s) && !(noteLang(note) !== "ms" && noteLang(s) !== "ms");
}
// "1. ...\n2. ..." -> paragraphs, each sentence checked against its own note. While streaming (done = false) the last
// line may be half-written, so it's shown as it is and only checked once the next line starts or writing ends.
function fromNumbered(t, notes, done) {
  const ns = noteLines(notes), got = new Map(), order = [];
  for (const line of t.split("\n")) {
    const m = line.match(/^\s*(\d{1,2})[.)]\s*(.*)$/);
    if (m && !got.has(+m[1])) { got.set(+m[1], m[2].trim()); order.push(+m[1]); }
  }
  const last = order[order.length - 1], out = [];
  for (let i = 1; i <= ns.length; i++) {
    const s = got.get(i), note = ns[i - 1];
    if (s === undefined) { if (done) out.push(asSentence(note)); else break; continue; }
    out.push(!done && i === last ? s : strayed(note, s) ? asSentence(note) : asSentence(s));
  }
  // Paragraphs of about three sentences.
  const per = Math.ceil(out.length / Math.max(1, Math.round(out.length / 3)));
  const paras = [];
  for (let i = 0; i < out.length; i += per) paras.push(out.slice(i, i + per).join(" "));
  return paras.join("\n\n");
}

// Tidy what the model wrote: drop chatter around it and make sure it opens with "Dear Diary," once. done = false while
// it's still streaming.
export function cleanOutput(text, notes = "", done = true) {
  let t = String(text || "").replace(/```[a-z]*\n?|```/gi, "").replace(/\r/g, "").trim();
  t = t.replace(/^(?:sure|okay|ok|here(?:'s| is)|berikut)[^\n]*:\s*\n+/i, "");
  t = t.replace(/^["“](.*)["”]$/s, "$1").trim();
  t = t.replace(/\n+(?:note|nota|\(note)[\s\S]*$/i, "").trim();
  t = t.replace(/^\s*\**\s*dear diary\s*,?\s*\**\s*,?\s*/i, "").trim();
  t = t.replace(/\((?:Malay|English|Manglish)\)\s*/g, ""); // language marks from the prompt never belong in the entry
  if (notes && /^\s*\d{1,2}[.)]\s/m.test(t)) t = fromNumbered(t, notes, done);
  t = t.replace(/\n{3,}/g, "\n\n");
  // Small models like to gloss words "(tiredness)" and to end by talking to the reader. Neither belongs in a diary.
  const have = String(notes).toLowerCase();
  t = t.replace(/ ?\(([^()\n]{1,30})\)/g, (m, inner) => (have.includes(inner.toLowerCase()) ? m : ""));
  if (!/\byou\b/.test(have)) {
    const paras = t.split("\n\n").map((p) => sentences(p).filter((x) => !/\byou(?:'re|r|rs)?\b/i.test(x)).join(" ")).filter(Boolean);
    if (paras.length) t = paras.join("\n\n");
  }
  return t ? `${OPENING}\n\n${t}` : "";
}

// Words in the draft the notes never gave: names, numbers and feelings. Shown as "check these" so nothing invented slips in.
// Names from "About you" (Muna, KL) are fine to use; everything else must come from today's notes.
export function unsupported(notes, out, about = "") {
  const known = String(about).toLowerCase();
  const have = String(notes).toLowerCase(), stem = (w) => w.slice(0, Math.max(4, Math.min(w.length - 1, 6)));
  const exp = [...expansions(notes)];
  const seen = (w) => { const l = w.toLowerCase(); return have.includes(l) || have.includes(stem(l)) || exp.some((x) => sameWord(x, l) || (x.length >= 5 && l.startsWith(x.slice(0, -1)))); };
  const flags = new Set(), aboutNames = new Set();
  const body = bodyText(out);
  for (const s of sentences(body)) {
    const ws = s.match(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu) || [];
    ws.forEach((w, i) => {
      const lower = w.toLowerCase();
      if (/^\d/.test(w)) { if (!have.includes(lower)) flags.add(w); }
      else if (/^\p{Lu}/u.test(w) && known && new RegExp(`\\b${lower.replace(/[^\p{L}\p{N}]/gu, "")}\\b`, "u").test(known)) { aboutNames.add(lower); return; } // a name from About you
      else if (i > 0 && /^\p{Lu}/u.test(w) && !["I", "I'm", "I've", "I'd", "I'll"].includes(w) && !seen(w)) flags.add(w);
      else { const f = FEELINGS.find((x) => lower.startsWith(x)); if (f && !have.includes(f)) flags.add(lower); }
    });
  }
  // Any other content word the notes never had (e.g. "keluarga", "pagi" in an entry about mamak): small models invent quietly.
  // Little grammar and linking words are fine, and so are forms of a word the notes did use (went/go are not matched, so a few slip through).
  for (const w of tokens(body)) {
    if (w.length < 4 || aboutNames.has(w) || STOP.has(w) || MS_GRAMMAR.has(w) || LINKS.has(w) || seen(w) || [...flags].some((f) => f.toLowerCase() === w)) continue;
    if (/^(\p{L}+)-\1$/u.test(w) && seen(w.split("-")[0])) continue; // jalan-jalan when "jalan" was written
    flags.add(w);
  }
  return [...flags].slice(0, 8);
}

// ---------- suggested updates to "About you" ----------
// Found on the device by plain counting, not by the AI model, so nothing is guessed: a name that keeps coming up, words
// the person keeps using, how they mix languages. Never moods or personality. Nothing is added until the person taps Add,
// and for a name they write who it is themselves. Dismissed keys are kept so a suggestion doesn't come back.
export const SUGGEST_MIN = 3; // entries a name or word must appear in
const NOT_NAMES = new Set(("dear diary i i'm today tonight tomorrow yesterday monday tuesday wednesday thursday friday saturday sunday " +
  "january february march april may june july august september october november december isnin selasa rabu khamis jumaat sabtu ahad " +
  "januari februari mac mei jun julai ogos oktober disember ok okay the and but so then after went").split(" "));
export function aboutSuggestions(texts, about = "", dismissed = []) {
  const bodies = texts.map(bodyText).filter((t) => words(t) > 0), have = String(about).toLowerCase(), skip = new Set(dismissed);
  const inAbout = (w) => new RegExp(`(^|[^\\p{L}])${w.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([^\\p{L}]|$)`, "u").test(have);
  const out = [];
  // Names: a capitalised word that isn't just starting a sentence, in SUGGEST_MIN or more entries.
  // A word counts as a name once it's capitalised mid-sentence somewhere; then every entry with it (capitalised) counts.
  const cands = new Set(), isName = (w) => /^\p{Lu}\p{Ll}+$/u.test(w) && w.length >= 3 && !NOT_NAMES.has(w.toLowerCase());
  for (const b of bodies) for (const s of sentences(b)) (s.match(/[\p{L}][\p{L}'’-]*/gu) || []).slice(1).forEach((w) => { if (isName(w)) cands.add(w); });
  const seen = new Map();
  for (const b of bodies) {
    const ws = new Set(b.match(/[\p{L}][\p{L}'’-]*/gu) || []);
    cands.forEach((n) => { if (ws.has(n)) seen.set(n, (seen.get(n) || 0) + 1); });
  }
  [...seen].filter(([n, c]) => c >= SUGGEST_MIN && !inAbout(n)).sort((a, b) => b[1] - a[1]).slice(0, 3)
    .forEach(([n, c]) => out.push({ key: `name:${n.toLowerCase()}`, kind: "ask", name: n, text: `${n} comes up in ${c} of your entries. Who or what is ${n} to you?`, hint: `${n} is my…` }));
  const p = styleProfile(bodies);
  if (p) {
    const names = new Set([...cands].map((n) => n.toLowerCase())); // names get their own question, not a "word you use"
    const fav = [...new Set([...p.phrases, ...p.slang, ...p.favourites])].filter((w) => !inAbout(w) && !w.split(" ").some((x) => names.has(x))).slice(0, 4);
    if (fav.length) out.push({ key: "words", kind: "add", text: `You often write: ${fav.join(", ")}.`, line: `Words I use a lot: ${fav.join(", ")}.` });
    if (!/malay|melayu|english|inggeris|manglish|rojak|\bbm\b|\bbi\b/.test(have)) {
      const line = p.malay >= 0.7 ? "I write mostly in Malay, casually." : p.malay >= 0.35 ? "I write rojak, Malay and English mixed in the same sentence." : p.malay >= 0.1 ? "I write in English with some Malay words." : "";
      if (line) out.push({ key: "lang", kind: "add", text: `Your entries read like this: "${line}"`, line });
    }
  }
  return out.filter((s) => !skip.has(s.key));
}
// Adds a line to About you, keeping within ABOUT_MAX. Returns null when it won't fit.
export function addToAbout(about, line) {
  const next = [String(about || "").trim(), line.trim()].filter(Boolean).join("\n");
  return next.length <= ABOUT_MAX ? next : null;
}

// The person's own Malay, Manglish and slang words from the notes that the draft dropped or changed (e.g. "shiok" -> "shiny").
export function dropped(notes, out) {
  const have = new Set(tokens(bodyText(out)));
  const own = tokens(notes).filter((t) => t.length >= 3 && (MALAY.has(t) || MANGLISH.has(t) || SLANG.includes(t)) && !MS_FUNC.includes(t));
  const kept = (t) => have.has(t) || [...have].some((h) => sameWord(t, h)) || (SHORT_FORMS[t] && tokens(SHORT_FORMS[t]).every((x) => have.has(x)));
  return [...new Set(own)].filter((t) => !kept(t)).slice(0, 8);
}

// Scrambled output: some phone graphics chips break the model's maths and it spits out mixed scripts and code bits
// ("abled Shadows Bondsavar 篚_life美团 ms_REFERER..."). Spotting it lets the writer stop at once and switch to the safe build.
export function looksGarbled(text, notes = "") {
  const t = bodyText(text);
  if (t.length < 40) return false;
  const letters = t.match(/\p{L}/gu) || [];
  if (!letters.length) return false;
  // Letters outside Latin, when the notes had none (so a note written in Jawi or Chinese is still fine).
  const foreign = (s) => (s.match(/\p{L}/gu) || []).length - (s.match(/\p{Script=Latin}/gu) || []).length;
  const odd = foreign(t), noteOdd = foreign(String(notes));
  if (!noteOdd && (odd >= 6 || odd / letters.length > 0.04)) return true;
  // Code-like words: under_scores, camelCase, angle brackets, dots inside words.
  const ws = t.split(/\s+/).filter(Boolean);
  const codey = ws.filter((w) => /[_<>{}\[\]\|]|[a-z][A-Z]|\w\.\w/.test(w) && !/^https?:/.test(w)).length;
  return ws.length >= 8 && codey / ws.length > 0.15;
}
