# Faiz & Muna Journal (`faiz-muna-journal`)

Repo: https://github.com/FaizGhazali/faiz-muna-journal · App title shown to users: "Our Journal" (becomes "<name> & <name>'s Journal" after first-run setup).

A private two-person weight / BMI / exercise journal. Installable PWA, hosted on Firebase, data in Firestore.

## Stack

- **No build step, no framework.** `public/` is served as-is: `index.html`, `app.js` (one ES module), `styles.css`, `sw.js`, `manifest.webmanifest`.
- Firebase JS SDK 10.14.1 is imported straight from `https://www.gstatic.com/firebasejs/...` in `app.js`. There is no bundler and no `node_modules` import in the browser code.
- The only npm dependency is `firebase-tools` (dev), used for emulators and deploy.
- Firebase project: `faiz-muna-journal-c43ab` (`.firebaserc`).

## Commands

```bash
npm ci                 # install firebase-tools
npm run dev            # local app + Auth/Firestore emulators (needs Java 11+)
npm run icons          # regenerate public/icon-192.png and icon-512.png
npx firebase deploy    # deploy hosting + firestore rules to production
```

`npm run dev` serves the app at http://localhost:5000 and the emulator UI at http://localhost:4000. Emulator data is thrown away on exit.

## How it works

- **Auth:** one shared family login. The email is the fixed constant `FAMILY_EMAIL` in `app.js`; the user types only the password. `firestore.rules` allows read/write for that single production UID and nobody else.
- **Local mode:** when the hostname is `localhost` / `127.0.0.1`, `app.js` uses a demo config (`demo-journal`) and connects to the Auth emulator on **9099** and the Firestore emulator on **8085**. These ports are hard-coded in `app.js` and must match the `emulators` block in `firebase.json`. The service worker is not registered locally.
- **Local rules:** the production rules pin one UID, which an emulator account never has, so `npm run dev` uses `firebase.dev.json` → `firestore.dev.rules` (any signed-in user). Never deploy with the dev config.
- **Local login:** the emulator starts empty. Create the user `family@journal.invalid` with any password in the emulator UI (Authentication tab), then sign in with that password.
- **Production config** comes from `/__/firebase/init.json`, which Firebase Hosting serves automatically. No API keys live in the repo.
- **Data model:**
  - `config/people` → `{ people: [{ id: "p1"|"p2", name, age, sex, cm }] }`. Written once by the first-run setup screen.
  - `entries/{person}_{YYYY-MM-DD}` → `{ person, date, weight?, minutes?, note? }`. One entry per person per day; saving again on the same day merges into it.
  - `activities/{auto id}` → `{ owner: "p1"|"p2", title, type: skill|task|explore|cook|habit, status: inbox|active|paused|done|archived, created, ...optional }`. Optional fields by type: `note`, `minutes`, `due` (task), `steps: [{text, done}]` + `lastDone` (skill), `location` (explore), `url` + `favourite` (cook), `days: [0-6]` (habit; missing = every day), `snoozed` (hidden through that date), `doneOn`.
  - `habitDays/{person}_{YYYY-MM-DD}` → `{ owner, date, done: [habit ids], skipped: [habit ids] }`. History is kept; "today" is just a new doc id.
- **Activities ("Your Next Move"):** `public/suggest.js` is the rule-based recommender (pure, no Firebase/DOM; tune scores there). `public/activities.js` owns the dashboard card, the habit checklist and the `#activities` page. New items always land in `inbox` (Ideas) and are only suggested once started. Per-device UI state (current suggestion, recently shown, today's "Suggest another" skips, selected person) is in `localStorage` under `journal-*` keys.
- **Offline:** Firestore persistent cache holds the data; `sw.js` caches the app shell (network-first for own files, cache-first for the versioned gstatic SDK files). Signing out clears the local Firestore cache.

## Conventions

- Keep it dependency-free and build-free. Plain DOM, template strings, `$()` = `getElementById`.
- Everything user-entered that goes into `innerHTML` must pass through `esc()`.
- BMI ranges are WHO adult cut-offs (18.5 / 25 / 30); the footer also mentions the Asian 22.9 cut-off. Goal pace is `PACE` kg/week, weekly exercise target is `WEEKLY_MINUTES`.
- If you add or rename a file in `public/`, add it to `SHELL` in `sw.js` and bump `CACHE` (e.g. `journal-v2` → `journal-v3`).
- Dates are local-time `YYYY-MM-DD` strings; use the `iso` / `parse` / `dayNum` helpers rather than `Date` parsing.
- UI copy is plain and short, written for two non-technical users on phones. Check layouts at phone width.

## Care points

- `npm run dev` goes through `tools/dev.js`, which points Java's local-socket folder at `~/.cache/firebase/uds`. On this machine the Firestore emulator otherwise crashes with "Unable to establish loopback connection" because Java can't open sockets in `%TEMP%`.
- `firestore.rules` is the only thing protecting the data. Changing the UID or loosening the match locks the family out or opens the journal — do not edit or deploy rules without being asked.
- `npx firebase deploy` goes straight to the live site the family uses. Only deploy when asked.
- This repo lives at `Documents\Faiz\2026\faiz-muna-journal`, beside (not inside) the unrelated `Creator` repo. Keep it out of `Creator`.
