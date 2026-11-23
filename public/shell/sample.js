// Made-up sample journal for the demo: two invented people, about 12 weeks of history ending today.
// Pure: no Firebase, no DOM. The numbers are random but repeatable, so every visitor sees the same story.
// Never put real family data here.
import { iso, parse, addDays } from "../core/util.js";
import { CIMB_PETRONAS, lastStatement, cycleOf, manualTxn } from "../logic/ledger.js";

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

  // Meals: a small food library (rough sample numbers per 100 g), a few meal sets and three weeks of plates.
  const foodList = {
    "f-nasi": ["Nasi putih", 130, 28, 2.7, 0.3], "f-patin": ["Ikan patin goreng", 220, 2, 18, 16], "f-ayam": ["Ayam goreng", 260, 8, 24, 15],
    "f-sayur": ["Sayur campur", 60, 7, 2, 3], "f-telur": ["Telur rebus", 155, 1, 13, 11], "f-roti": ["Roti canai", 300, 40, 7, 12],
    "f-teh": ["Teh tarik", 80, 13, 2, 2], "f-oat": ["Oat", 380, 66, 13, 7], "f-pisang": ["Pisang", 89, 23, 1, 0.3], "f-mee": ["Mee goreng", 180, 25, 6, 6],
  };
  const foods = Object.fromEntries(Object.entries(foodList).map(([id, [name, kcal, carb, protein, fat]]) => [id, { name, kcal, carb, protein, fat }]));
  const mealSets = {
    "s-patin": { name: "Nasi + patin + sayur", items: [{ food: "f-nasi", g: 180 }, { food: "f-patin", g: 120 }, { food: "f-sayur", g: 80 }], slots: ["lunch", "dinner"] },
    "s-ayam": { name: "Nasi ayam goreng", items: [{ food: "f-nasi", g: 180 }, { food: "f-ayam", g: 120 }, { food: "f-sayur", g: 60 }], slots: ["lunch", "dinner"],
      made: "cooked", ingredients: [{ item: "k-ayam", qty: 1000 }, { item: "k-beras", qty: 600 }, { item: "k-daunkari", qty: 20 }], serves: 4 }, // Daun kari has no price yet

    "s-roti": { name: "Roti canai + teh tarik", items: [{ food: "f-roti", g: 100 }, { food: "f-teh", g: 250 }], slots: ["breakfast"], made: "bought", price: 4.5 },
    "s-oat": { name: "Oat + pisang", items: [{ food: "f-oat", g: 50 }, { food: "f-pisang", g: 100 }], slots: ["breakfast", "snack"], made: "cooked", ingredients: [{ item: "k-oat", qty: 50 }, { item: "k-susu", qty: 150 }], serves: 1 },
    "s-mee": { name: "Mee goreng + telur", items: [{ food: "f-mee", g: 250 }, { food: "f-telur", g: 50 }], slots: ["breakfast", "lunch", "dinner"], made: "bought", price: 7 },
    "s-snack": { name: "Pisang + teh tarik", items: [{ food: "f-pisang", g: 100 }, { food: "f-teh", g: 250 }], slots: ["snack"] },
  };
  const size = { p1: 1.3, p2: 1.2 }, menu = { breakfast: ["s-roti", "s-oat"], snack: ["s-snack"], lunch: ["s-patin", "s-ayam", "s-mee"], dinner: ["s-patin", "s-ayam", "s-mee"] };
  const hour = { breakfast: 8, lunch: 13, snack: 16, dinner: 19 }, meals = {};
  for (let i = 119; i >= 0; i--) {
    const d = ago(i);
    for (const person of ["p1", "p2"]) {
      if (i > 0 && rnd() < (i > 60 ? 0.45 : 0.2)) continue; // some days nothing is logged, and that's fine (more often early on)
      for (const slot of ["breakfast", "lunch", "snack", "dinner"]) {
        if (i === 0 && (slot !== "breakfast" || person === "p2")) continue; // today only Amir's breakfast so far
        if (rnd() < (slot === "snack" ? 0.5 : 0.08)) continue;
        const sid = person === "p2" && slot === "breakfast" && rnd() < 0.8 ? "s-oat" : menu[slot][Math.floor(rnd() * menu[slot].length)];
        const items = mealSets[sid].items.map(({ food, g }) => {
          const f = foods[food], grams = Math.max(10, Math.round((g * size[person] + jitter(g * 0.12)) / 5) * 5), k = grams / 100;
          return { food, name: f.name, g: grams, kcal: Math.round(f.kcal * k), carb: r1(f.carb * k), protein: r1(f.protein * k), fat: r1(f.fat * k) };
        });
        meals[`d-meal-${person}-${d}-${slot}`] = { person, date: d, slot, name: mealSets[sid].name, set: sid, items, at: parse(d).getTime() + hour[slot] * 36e5 };
      }
    }
  }

  // Amir sometimes types the day's burn from his watch; Lina never does, so hers is estimated.
  const burns = {};
  for (let i = 13; i >= 1; i--) if (rnd() < 0.4) { const d = ago(i); burns[`p1_${d}`] = { person: "p1", date: d, kcal: Math.round((2500 + jitter(250)) / 10) * 10 }; }

  // Diary (Dearly): a few made-up entries each. Amir mixes Malay and English; Lina writes in English.
  // One of Amir's is from this day last year, so "On this day" has something to show.
  const lastYear = iso(new Date(now.getFullYear() - 1, now.getMonth(), Math.min(now.getDate(), 28)));
  const pages = [
    ["p1", lastYear, "First week at the new office", "harini first week kat office baru. jauh sikit tapi okay lah. lunch dengan team, makan nasi kandar.\n\npenat tapi best. tak sabar weekend.", 4, ["work"]],
    ["p1", ago(1), "", "pagi tadi run 5k dengan Lina. panas gila tapi habis jugak haha.\n\nmalam lepak rumah je, tengok bola. penat tapi puas.", 4, ["running", "lina"]],
    ["p1", ago(3), "Mamak night", "lepak mamak dengan geng sampai pukul 1. borak pasal kerja, pasal duit, pasal plan tahun depan.\n\nrisau sikit pasal duit tapi gelak banyak malam ni. best.", 4, ["friends"]],
    ["p1", ago(6), "", "kerja banyak sangat harini. meeting dari pagi sampai petang.\n\nbalik terus tidur. esok cuba lagi lah.", 2, ["work"]],
    ["p1", ago(9), "Sambal day", "masak sambal sendiri for the first time. pedas gila haha. Lina kata okay, tapi aku rasa terlebih garam sikit.\n\nnext time kurang garam.", 5, ["cooking"]],
    ["p1", ago(15), "", "hujan dari pagi. tak dapat run. duduk rumah, kemas bilik, baca buku sikit.\n\nhari slow tapi okay je.", 3, []],
    ["p2", ago(0), "", "Started the morning with oats and a slow walk. Work was quiet, so I finally finished the report I've been putting off.\n\nFeeling lighter tonight.", 4, ["work"]],
    ["p2", ago(2), "Japanese practice", "Did my Japanese lesson on the train. Still mixing up the particles, but I read a whole short story without the dictionary.\n\nSmall win. I'll take it.", 5, ["japanese"]],
    ["p2", ago(5), "", "Long day. My head hurt by lunch and I skipped the evening run.\n\nEarly night. Tomorrow is a new start.", 2, []],
    ["p2", ago(8), "Market morning", "Walked to the market with Amir. Bought too many mangoes again.\n\nWe sat by the lake after and talked about a trip next year.", 5, ["amir", "weekend"]],
    ["p2", ago(12), "", "Tried the new café near the office. The coffee was good, the cake was too sweet.\n\nWould go back for the coffee.", 3, ["explore"]],
  ];
  const diary = {};
  pages.forEach(([person, date, title, text, mood, tags], i) => {
    const at = parse(date).getTime() + (20 + (i % 3)) * 36e5;
    diary[`d-diary-${i}`] = { person, date, ...(title ? { title } : {}), body: `Dear Diary,\n\n${text}`, mood, tags, fav: i === 4 || i === 7, created: at, updated: at };
  });

  // Stocky (groceries): shared stock with made-up shops and prices. Buys are spaced so rice and eggs run low,
  // chicken is out (the meals logged used it), milk is due soon and the household things are fine.
  const pantry = {
    "k-beras": { name: "Beras", kind: "food", unit: "g", pack: 5000, links: [{ food: "f-nasi", per100: 40 }], created: stamp(80) },
    "k-telur": { name: "Telur", kind: "food", unit: "pcs", pack: 30, links: [{ food: "f-telur", per100: 1.8 }], created: stamp(80) },
    "k-ayam": { name: "Ayam", kind: "food", unit: "g", pack: 1500, links: [{ food: "f-ayam", per100: 100 }, { food: "f-mee", per100: 10 }], created: stamp(80) }, // mee goreng has a little ayam in it
    "k-susu": { name: "Susu", kind: "food", unit: "ml", pack: 2000, created: stamp(80) },
    "k-daunkari": { name: "Daun kari", kind: "food", unit: "g", pack: 50, created: stamp(80) },
    "k-oat": { name: "Oat", kind: "food", unit: "g", pack: 1000, links: [{ food: "f-oat", per100: 100 }], created: stamp(80) },
    "k-tisu": { name: "Tisu", kind: "home", unit: "pcs", pack: 10, created: stamp(80) },
    "k-sabun": { name: "Sabun basuh", kind: "d-kind-clean", unit: "g", pack: 3000, created: stamp(80) },
  };
  // [item, days ago, qty, price, shop, sale?]
  const bought = [
    ["k-beras", 66, 5000, 19.5, "Mydin"], ["k-beras", 48, 5000, 18.9, "Mydin"], ["k-beras", 30, 5000, 20.9, "Lotus's"], ["k-beras", 12, 5000, 17.9, "Lotus's", true],
    ["k-telur", 40, 30, 12.5, "Mydin"], ["k-telur", 26, 30, 11.8, "Pasar"], ["k-telur", 13, 30, 12.9, "Mydin"],
    ["k-ayam", 16, 1500, 14.9, "Pasar"], ["k-ayam", 9, 1500, 15.8, "Mydin"],
    ["k-susu", 30, 2000, 13.5, "Lotus's"], ["k-susu", 23, 2000, 13.5, "Lotus's"], ["k-susu", 16, 2000, 12.9, "Mydin"], ["k-susu", 9, 2000, 13.5, "Lotus's"], ["k-susu", 3, 2000, 11.5, "Mydin", true],
    ["k-oat", 34, 1000, 9.9, "Lotus's"], ["k-oat", 10, 1000, 10.5, "Mydin"],
    ["k-tisu", 40, 10, 15.9, "Mydin"], ["k-tisu", 8, 10, 14.5, "Lotus's"],
    ["k-sabun", 80, 3000, 24.9, "Lotus's"], ["k-sabun", 40, 3000, 26.5, "Mydin"], ["k-sabun", 5, 3000, 21.9, "Lotus's", true],
  ];
  const buys = Object.fromEntries(bought.map(([item, n, qty, price, shop, sale], i) => [`d-buy-${i}`, { item, date: ago(n), qty, price, shop, ...(sale ? { sale: true } : {}), by: i % 2 ? "p2" : "p1", at: stamp(n) }]));
  // Prices spotted without buying: [item, days ago, qty, price, shop, sale ends in n days?]
  const seen = [
    ["k-beras", 3, 10000, 36, "Giant"], ["k-telur", 4, 30, 13.2, "Lotus's"], ["k-telur", 2, 30, 10.9, "Giant", 5],
    ["k-ayam", 2, 1000, 9.5, "Pasar"], ["k-susu", 6, 1000, 7.2, "Giant"],
  ];
  const prices = Object.fromEntries(seen.map(([item, n, qty, price, shop, until], i) => [`d-price-${i}`, { item, date: ago(n), qty, price, shop, ...(until ? { sale: true, until: ago(-until) } : {}), at: stamp(n) }]));
  const kinds = { "d-kind-clean": { name: "Cleaning", created: stamp(80) } };
  const shopList = { "d-list-0": { name: "Bawang merah", qty: 500, unit: "g", from: "manual", created: stamp(1) } };

  // Ledger: one made-up credit card with the PETRONAS-style rebate rules, about 10 weeks of spending, each statement paid in full after it came out.
  const card = { type: "credit_card", name: "Fuel card", last4: "1234", owner: "p1", statementDay: 20, dueDay: 10, cycleBasis: "posted", active: true, program: "d-prog", created: 1, updated: 1 };
  card.openingDate = lastStatement({ id: "d-card", ...card }, ago(70)); card.openingSen = 0;
  const acc = { id: "d-card", ...card };
  const shopsBy = [
    ["ECS* SETEL VENTURES", "fuel-petronas", "Setel", 60, 140, 0.22],
    ["PASAR RAYA SEGAR", "groceries", "Pasar Raya Segar", 25, 160, 0.3],
    ["KEDAI RUNCIT MAJU", "groceries", "Kedai Runcit Maju", 6, 30, 0.2],
    ["RESTORAN SELERA KITA", "dining", "Selera Kita", 12, 55, 0.35],
    ["KOPI PAGI CAFE", "dining", "Kopi Pagi", 8, 24, 0.25],
    ["SMART PARKING", "parking", "Smart Parking", 2, 8, 0.12],
    ["APSB_SAMPLE_TOLL", "tolls", "Toll", 2, 9, 0.18],
    ["KEDAI SERBANEKA", "shopping", "Kedai Serbaneka", 10, 90, 0.06],
  ];
  const ledgerTxns = {};
  let ln = 0;
  for (let i = 69; i >= 0; i--) {
    const d = ago(i);
    for (const [raw, cat, merchant, lo, hi, p] of shopsBy) {
      if (rnd() >= p) continue;
      const amount = (lo + rnd() * (hi - lo)).toFixed(2);
      ledgerTxns[`d-ltx-${ln++}`] = manualTxn(acc, { spentBy: rnd() < 0.6 ? "p1" : "p2", date: d, amount, type: "purchase", raw, cat, merchant }, parse(d).getTime() + 12 * 36e5);
    }
  }
  // Pay each finished statement in full 12 days after it (after the cut-off, so the rebate tier holds).
  for (let s = cycleOf(acc, card.openingDate).statement; s < T; s = cycleOf(acc, addDays(s, 1)).statement) {
    const payDay = addDays(s, 12);
    if (s <= card.openingDate || payDay >= T) continue;
    const owed = Object.values(ledgerTxns).filter((t) => t.posted <= s).reduce((a, t) => a + t.amountSen, 0);
    if (owed > 0) ledgerTxns[`d-ltx-${ln++}`] = manualTxn(acc, { spentBy: "p1", date: payDay, amount: (owed / 100).toFixed(2), type: "payment", raw: "Card payment" }, parse(payDay).getTime() + 20 * 36e5);
  }
  const ledgerAccounts = { "d-card": card };
  const ledgerPrograms = { "d-prog": { ...structuredClone(CIMB_PETRONAS), account: "d-card", preset: "cimb-petronas", created: 1, updated: 1 } };

  return { config: { people: { people } }, entries, activities, habitDays, moves, foods, mealSets, meals, burns, diary, pantry, buys, prices, shopList, kinds, ledgerAccounts, ledgerPrograms, ledgerTxns };
}
