---
name: ship
description: Commit the working tree changes and make them live on the family's site (push main, which deploys Firebase Hosting). It stops at the push and doesn't check the deploy. This is the default end of every finished change in this project: run it once a requested change is done and tested, without asking, and also when the user asks to ship, release, "commit and make it live", or types /ship.
---

# Ship: commit and make it live

In this repo **a push to `main` is a release**: `.github/workflows/deploy.yml` publishes `public/` to Firebase Hosting (hosting only, never Firestore rules). Running this skill is the user's go-ahead to commit and push. It is not permission for anything else (no `npx firebase deploy`, no rules changes, no force push).

Optional argument: a commit message or a short note of what changed. Without one, write the message yourself from the diff.

## 1. Check before committing

1. `git status --short` and `git diff --stat`. If there is nothing to commit and `main` is not ahead of `origin/main`, say so and stop.
2. Be on `main` (`git branch --show-current`). If on another branch, stop and ask whether to merge it into `main` first. Never ship from another branch without asking.
3. Look at what will be committed. Leave out and mention:
   - secrets or local-only files (`.env*`, service-account JSON, `.claude/settings.local.json`, `.firebaserc` edits)
   - stray scratch files, logs, `.firebase/`, `node_modules/`
   - `.claude/launch.json` changes that point at a temp / scratchpad path
4. **Stop and ask** instead of shipping if the diff touches `firestore.rules`, `firestore.dev.rules`, `firebase.json` or `firebase.dev.json`. Rules are what protect the family's data, and the deploy workflow never deploys them anyway.
5. Run `npm test`. If anything fails, stop and show the failures. Don't ship broken code.
6. Repo rules from CLAUDE.md, check and fix before committing:
   - a new or renamed file in `public/` is in `SHELL` in `public/sw.js`, and `CACHE` is bumped (`journal-vN` → `journal-vN+1`) whenever anything in `public/` changed since the last release, so phones pick up the new version
   - user-entered text going into `innerHTML` goes through `esc()`
   - if a feature changed, the landing page "What's new" list, FAQ / JSON-LD and `lastmod` in `public/sitemap.xml` are updated (mention it if not; don't block on it)

## 2. Commit

- `git add` the specific files (not `git add -A` blindly).
- Message: a short summary line (≤ 72 chars, plain words, like the existing log: `git log --oneline -10`), a blank line, then a few lines on what changed and why, for the family's two non-technical users where it matters.
- End the message with the attribution line from the current system reminder (e.g. `Co-Authored-By: ...`), if there is one.
- Never `--no-verify`, never amend a commit that is already pushed.

## 3. Make it live

1. `git fetch` then `git status -sb`. If `origin/main` has commits you don't have, `git pull --rebase` first; if that conflicts, stop and ask.
2. `git push origin main`. Never force push.
3. Confirm it landed: `git status -sb` shows `main...origin/main` with nothing ahead.

## 4. Don't check the deploy

Stop once the push has landed. Don't watch the GitHub Actions run, poll the live site or compare versions there: it costs tokens, and GitHub emails the user if the deploy fails. Only look into a deploy if the user asks or says something didn't go live.

## 5. Tell the user

- The commit (short hash and summary), and that it's pushed to `main`, so the site deploys in about a minute.
- The live site: https://faiz-muna-journal-c43ab.web.app/
- Phones may keep the old version until the app is closed and reopened once (the service worker updates on the next open).
