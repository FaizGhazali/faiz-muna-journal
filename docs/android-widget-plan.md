# Android widget: plan (not started)

Goal: a home-screen widget on Android that shows each person's "Your next move", with the reason line. Tapping it opens the journal at `/#next`. A Done button on the widget can come later.

Status (2026-11-17): personalised suggestions are live (commit d0d0b9e). No widget code has been written yet. This file is the hand-over.

## What we found

- A PWA can't have a home-screen widget, so this needs a small native Android app beside the web app.
- The repo is **public** (since 2026-11-18), so GitHub Release / Actions downloads work without a login. Never commit the APK signing keystore or its passwords: keep them in repo secrets.
- `https://faiz-muna-journal-c43ab.web.app/__/firebase/init.json` is reachable (200). The widget can read the `apiKey` and `projectId` from it at runtime, so no keys go into the repo.
- No Android Studio on any PC: the user doesn't want it. Build the APK in GitHub Actions instead (a `setup-java` + `android-actions/setup-android` + Gradle job on `android/**` changes). Test on a branch first, so pushes don't go to `main`.

## Design

1. **Web app publishes the pick.** In `public/activities.js`, work out the current pick for *both* people, not just the one selected, and write `nextMove/{p1|p2}` → `{ person, title, type, why, date, updated }`. Use `{ title: null }` when there's nothing to suggest. Write only when it changed, keeping the last written value in localStorage. This means `currentMove()` / `mine()` / `logs()` / `ctxNow()` need a person parameter that defaults to `me`. Note this in CLAUDE.md's data model. The widget then shows exactly what the app shows; the suggestion logic is never copied to Kotlin.
2. **Android app in `android/`.** Kotlin, classic `AppWidgetProvider` + `RemoteViews`, no Firebase SDK. Use only `HttpURLConnection` + `org.json`.
   - Setup screen: family password + choose Faiz or Muna. Sign in with the REST endpoint `identitytoolkit.googleapis.com/v1/accounts:signInWithPassword` using `FAMILY_EMAIL` (`family@journal.invalid`, see `public/app.js`). Store only the **refresh token**, never the password.
   - Refresh: `securetoken.googleapis.com/v1/token` (grant_type=refresh_token) → idToken. Then `GET firestore.googleapis.com/v1/projects/{projectId}/databases/(default)/documents/nextMove/{person}` with a Bearer token. Also send `Referer: https://faiz-muna-journal-c43ab.web.app/` in case the API key is limited to that site.
   - Widget: dark card (`#11141e`, accent `#2f4bd6`) showing "Your next move", the title, the why line, and a refresh ↻. Refreshes every 30 min (`updatePeriodMillis`), with the network call inside `goAsync()`. Show "from yesterday" if `date` isn't today. Tap → `ACTION_VIEW https://faiz-muna-journal-c43ab.web.app/#next`, which opens the installed PWA.
3. **Signing.** Make one release keystore with `keytool` and keep it **out of the repo**. Every APK must be signed with the same key, or updates won't install over the old version.
4. **Getting it onto the phones.** A GitHub workflow builds `android/**` and uploads the APK, signed with the keystore from repo secrets. Open the run on the phone while signed in to GitHub and install the APK. The workflow must not touch `deploy.yml` (main → live hosting).

## Rules to keep

- `firestore.rules` already allows any path for the family UID. `nextMove` needs **no rules change**. Don't edit or deploy the rules.
- Pushing to `main` deploys the web app live. Test the web part with `npm run dev` first.
- If files in `public/` change, bump `CACHE` in `sw.js`.
