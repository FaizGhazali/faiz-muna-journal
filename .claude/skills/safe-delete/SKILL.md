---
name: safe-delete
description: The rule for every delete in Our Journal. Apply it by default, without being asked, whenever you add or change code that deletes or removes something the family made (deleteDoc, removing a row, clearing a value, purging, "remove", "✕" buttons), and when the user asks to make deleting safer. Every such action asks first with the shared confirmDelete() prompt so nothing is lost by accident.
---

# Safe delete: always ask before anything is lost

The family are two non-technical people on phones. A stray tap must never lose a diary entry, a food, a buy or anything else. So **every action that deletes or removes something the user made asks first**, with the one shared prompt in `public/core/confirm.js`.

## The rule

1. Any button, swipe or menu item that ends in `deleteDoc`, removes an item from an array (`arrayRemove`), clears a stored value, or moves something to Recently deleted, **awaits `confirmDelete()` first** and does nothing unless it returns `true`.
2. Use the shared helper. Don't hand-roll `window.confirm()`, a second "Are you sure" tap or a new dialog:
   ```js
   import { confirmDelete } from "./confirm.js";

   const ok = await confirmDelete({
     title: `Delete ${p.name}?`,                       // plain text, escaped by the helper
     body: `<p>Its history goes too: 3 buys.</p>`,     // HTML: esc() anything the user typed
     yes: "Delete it",                                 // the red button, says what it does
   });
   if (!ok) return;
   await commit(() => deleteDoc(doc(col, id)));
   ```
3. Say what will be lost, in plain short words:
   - **title**: the action and the thing by name ("Delete Beras?", "Remove the kind Baby?", "Take Susu off the list?").
   - **body**: what else goes with it (history, photos, rows), or what happens to things that depend on it (items move to Home). Leave it out only when there's truly nothing more to say. The helper adds "This can't be undone." itself.
   - **yes**: a verb, never "OK" or "Yes" ("Delete it", "Remove buy", "Take it off").
4. "Keep" is the default. The helper focuses it, and Esc, tapping outside, the back gesture and Enter all keep. Never auto-confirm, never pre-focus the red button, never add a "don't ask again" box.
5. When removing something that other data points at (a kind, a food, a meal set), don't leave orphans. Either move the dependents somewhere safe and say so in the body, or delete them too and list them in the body.
6. Read the data for the prompt **before** awaiting, and don't redraw the page under the open prompt in a way that changes what's being deleted (pass ids, look the thing up again after `ok` if needed).

## What doesn't need a prompt

- Things the app removes on its own as a side effect of something the user chose (a shopping-list row cleared after tapping "Bought", an old draft replaced by a save).
- Undoing a choice that's one tap to redo and loses nothing typed: toggling a chip, unticking a habit, switching a filter.
- Signing out, or other actions that delete no data.

When unsure, ask. A prompt too many is a small cost; a lost diary entry isn't.

## Checklist when you touch a delete

- [ ] Goes through `confirmDelete()` from `./confirm.js`, and stops unless it returns `true`.
- [ ] Title names the thing; body says what else is lost or moved; yes-label is a verb.
- [ ] User-typed text in `body` passes through `esc()`.
- [ ] Dependents are moved or listed, never silently orphaned.
- [ ] Checked at phone width in the demo (`sessionStorage journal-demo=1`): Keep keeps, the red button deletes.
- [ ] If a new file was added in `public/`, it's in `SHELL` in `sw.js` and `CACHE` is bumped.
