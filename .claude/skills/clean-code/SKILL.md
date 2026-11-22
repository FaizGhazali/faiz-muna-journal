---
name: clean-code
description: How to change code in Our Journal so it stays clean and well-structured. Apply it by default, without being asked, before any non-trivial change (a new feature, a new journal or page, a refactor, a bug fix that touches more than one file, a new module or collection), and when the user asks for clean code, architecture, refactoring, splitting files or "doing it properly". Inspect before modifying, plan before implementing, build modularly, reuse before duplicating, test before finishing, document important decisions.
---

# Clean code and architecture for Our Journal

A small, dependency-free, build-free PWA that two people rely on every day. Clean here means: easy to read in one sitting, one obvious place for each thing, logic that can be tested without a browser, and nothing that surprises the family on their phones.

Work through the six steps in order. For a one-line fix, steps 1, 4 and 5 are enough; for anything bigger, do all six.

## 1. Inspect before modifying

Don't edit a file you haven't read, and don't assume how something works from its name.

- Read `CLAUDE.md` first: it is the map of the app (modules, data model, care points). Find the section for the area you're touching.
- Read the file you'll change, and `grep` for every caller of a function before changing its signature or behaviour.
- Look for existing helpers before writing one: `public/util.js` (`$`, `esc`, `iso`, `parse`, `dayNum`, `tagKey`, …), `public/confirm.js`, `public/face.js`, `public/fs.js`, `public/zoom.js`, `public/collapse.js`.
- Check `git status` first. Untracked or modified files you didn't make may be someone's work in progress: leave them alone and don't commit them.
- For data changes, read the matching collection in the CLAUDE.md data model, and `public/backup.js` / `public/memdb.js` / `public/sample.js`, which must keep working with it.

## 2. Plan before implementing

Before writing code for anything beyond a small fix, decide and state (in the task list or a short note to the user):

- **Which files change and why.** Prefer changing the module that already owns the thing.
- **Where the new logic lives** (see the layers below): pure module, UI module, or `app.js` wiring.
- **Data shape**: new fields or collections, with `date` / `created` / `updated` per the "Every saved doc is dated" rule, and whether backup, demo seed and `memdb.js` need updating.
- **What will be tested** and how it will be checked at phone width.
- **Risks**: deletes (→ `safe-delete` skill), `innerHTML` with user text (→ `esc()`), Firestore rules (never edit without being asked), new files in `public/` (→ `SHELL` + `CACHE` in `sw.js`).

If the plan has a real choice the user should make (UX, data model, removing something), ask before building. Otherwise pick the simplest option that fits the existing patterns and say so.

## 3. Build modularly

The app's layers, and what belongs in each:

| Layer | Examples | Rules |
|---|---|---|
| **Pure logic** | `suggest.js`, `fitness.js`, `runweight.js`, `mood.js`, `reflect.js`, `meals.js`, `stocky.js`, `diary.js`, `writestyle.js`, `bmi.js`, `visits.js` | No DOM, no Firestore, no `localStorage`, no `Date.now()` hidden inside (pass "today" in). Plain data in, plain data out. Unit-tested in `tests/*.test.mjs`. Tunable numbers are named constants at the top (`PACE`, `LOW_DAYS`, `MIN_DAYS`, …). |
| **UI modules** | `activities.js`, `moodui.js`, `mealsui.js`, `stockyui.js`, `fitdetail.js`, `diaryui.js` + `diary/*.js`, `tour.js` | Draw with template strings, read/write Firestore through `./fs.js`, call pure modules for every decision. One delegated listener per page, dispatching by `data-*` action name (see `diary/`'s `actions` pattern). |
| **Wiring** | `app.js` | Firebase setup, auth, snapshots, passing data and hooks into `init*()` functions. Keep feature logic out of it; move it to a module when it grows. |
| **Infrastructure** | `fs.js`, `memdb.js`, `sw.js`, `backup.js`, `util.js` | Shared by everyone; change carefully and keep `fs.js` and `memdb.js` in step. |

Guidelines:

- **One job per module, one job per function.** A function that needs "and" in its name, or a file past ~500 lines doing several things, is a sign to split (as `diary/` was split into one file per page).
- **Decisions go in pure code.** If a UI function contains an `if` about the data (thresholds, ranking, dates, maths), move that into the pure module and test it there.
- **Modules talk through small explicit hooks**, not by reaching into each other's DOM or Firestore paths (e.g. `initMeals({ stock: { of, list, changed } })`). Pass functions and data in; don't import a UI module from a pure one.
- **No new dependencies, no build step, no framework.** Plain ES modules, plain DOM, CDN imports only where already pinned. All Firestore calls through `./fs.js`.
- **Names say what the thing is** in the app's own words (`intakeRange`, `buyRate`, `moodMap`), not `data2` or `handleStuff`. Short is fine when it's clear.
- **Worked out, not stored.** Scores, estimates, averages and "running low" lists are computed when drawing. Store only what the person entered, plus dates.
- **Keep the data forgiving**: missing fields and old docs must still draw. Never rewrite old data to fit new code; read both shapes.

## 4. Reuse before duplicating

- Before writing a helper, search for it: `grep -rn "function name\|const name" public/`. If something close exists, use or extend it.
- Shared helpers live in `public/util.js`; import them, never copy them. If you find the same few lines in two places, move them there (or into the pure module both use) as part of your change.
- Reuse the shared building blocks: `confirmDelete()` for deletes, `face()` for mood faces, `zoomable()` / `xWindow()` for charts, `.panel` / `.fold` cards, `esc()` for every user string in `innerHTML`, the `--m1`…`--m5` and other CSS tokens in `styles.css`.
- Reuse existing CSS classes and patterns before adding new ones; match the look of neighbouring cards.
- Don't copy rules between languages or places (e.g. suggestion rules stay only in `suggest.js`, never in Kotlin).

## 5. Test before finishing

A change isn't done until:

1. **`npm test` passes.** New or changed pure logic gets tests in the matching `tests/<module>.test.mjs` (Node's built-in runner, `node:test` + `node:assert/strict`). Cover the normal case, an edge (empty, one item, a missing field, a date boundary) and any bug you fixed.
2. **It runs in the app.** Check it in the demo (`sessionStorage journal-demo=1`, or `npm run dev` with the emulators) at phone width (~375 px) with the browser preview: no console errors, the feature works, nearby features still work. Check dark mode if styling changed.
3. **The repo rules hold:** new/renamed `public/` files in `SHELL` in `sw.js` with `CACHE` bumped; user text through `esc()`; deletes through `confirmDelete()`; every new saved doc dated; new Firestore functions added to both `fs.js` and `memdb.js`; backup still round-trips new collections.
4. **Read your own diff** (`git diff`) once, looking for leftover debug code, dead code, copied helpers and unclear names. Remove what you no longer use.

Report honestly: if something couldn't be tested, say what and why.

## 6. Document important decisions

- **`CLAUDE.md` is the architecture record.** When you add a module, collection, field, `localStorage` key, tunable constant, or change how something works, update its section in the same change, in the same plain, dense style. Remove lines that are no longer true.
- **Say why, not just what**, for choices someone would otherwise undo: a short code comment above the tricky line (e.g. why meals only bring a date forward, why phones never run the local AI). No comments that restate the code.
- **Longer write-ups** (models tried, test reports, setup steps) go in `docs/<topic>.md`, linked from CLAUDE.md.
- **User-facing changes**: update the landing page "What's new", FAQ / JSON-LD and `lastmod` in `public/sitemap.xml` when a feature changes.
- **Commit messages** explain what changed and why, in plain words (see the `ship` skill).

## Quick checklist

- [ ] Read CLAUDE.md's section and every file I changed; grepped callers.
- [ ] Plan stated: files, layer, data shape, tests, risks.
- [ ] Logic in a pure module with named constants; UI only draws and wires.
- [ ] No duplicated helpers; shared ones imported from `util.js` and friends.
- [ ] `npm test` passes, with new tests for new logic.
- [ ] Checked in the demo at phone width, no console errors.
- [ ] `sw.js` SHELL/CACHE, `esc()`, `confirmDelete()`, dated docs, `fs.js` + `memdb.js` all in step.
- [ ] CLAUDE.md (and docs / landing page if needed) updated.
- [ ] Then finish with the `ship` skill.
