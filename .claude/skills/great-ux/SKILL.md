---
name: great-ux
description: The UX bar for Our Journal: great, polished, phone-first UX is the top priority. Apply it by default, without being asked, whenever you add or change anything the family sees or touches (a form, a list, a button, an edit / save / delete flow, a new page or journal, any copy), and when the user says the UX is bad, confusing or "not professional". Keep people where they are, confirm every action, fix mistakes in place, never lose typing.
---

# Great UX first

The family are two non-technical people using this on their phones, often one-handed and in a hurry. They judge the app by how it *feels*. A feature that works but makes them hunt, scroll back, retype or wonder "did it save?" is a bug. **When a choice is between simpler code and a smoother experience, pick the smoother experience.**

Before finishing any change the family can see, walk through it as them on a 375 px phone and check every rule below.

## 1. Never move people away from what they're working on

- **Edit in place.** Fixing an item happens where the item is: the row / card turns into its form (see Ledger's Recent: `startEdit()` / `editForm()` in `public/features/ledger/ledgerui.js`). Never load it into a form at the top of the page and scroll there.
- **Stay put after saving or cancelling.** The page must not jump. Close the form right where it was, keep the item on screen (`scrollIntoView({ block: "nearest" })`, which does nothing if it's already visible), and if the item moved (re-sorted by date), bring it into view.
- **Show what changed.** After a save, briefly highlight the changed row / card (Ledger's `lflash` glow) so the eye lands on it. Make the glow survive live redraws (remember `{ id, at }` and carry the animation on with a negative `animation-delay`).
- Don't reset filters, tabs, open sections, "Show more" or scroll position because data changed.

## 2. Every action answers back

- **Every save confirms itself** with the shared toast: pass the message to `commit(write, ok)` (`app.js`), e.g. `Updated: RM8.80 at Kopi Pagi.`. Say *what* was saved, in plain words, with the key number.
- **Failures are loud and safe.** `commit` shows the red error toast and rejects; catch it, re-enable the button, and keep everything that was typed.
- Disable the Save button while saving so a double tap can't save twice.
- Validation messages sit next to the form, say exactly what to type ("Type the amount, like 12.50."), and never clear the fields.

## 3. Mistakes are cheap to fix

- **Anything that can be added can be edited.** Never ship "add" plus "delete" without "edit": delete-and-retype isn't a fix.
- An edit keeps what the form doesn't show (created time, source, statement checks, notes). Write it over the same doc id, never as a copy.
- Deletes still go through the `safe-delete` skill (`confirmDelete()`); an edit must never need a delete.
- Cancel (and Escape on a keyboard) always gets out with nothing changed.

## 4. Never lose typing

- **Start from the last choice.** A field the family fills in again and again (a shop, a kind, a unit, a card, a category, a meal slot) starts on what they picked last time, from the newest saved doc (`lastUsed(docs, field)` in `public/core/util.js`), or from a per-device `journal-*` key when it's a device habit (Ledger's card / wallet). The very first time there's nothing to copy, so leave it blank (a select gets a disabled "Pick one") and ask for it on save; never quietly guess. Something the row itself already says (a planned meal food is Food) beats the last choice.

- A form someone is filling in is not redrawn by live updates from the other phone (keep it out of the `innerHTML` redraw: a `formKey`, a `data-dirty` flag, or skip the redraw while the form is in the DOM).
- Drafts that take effort (diary) autosave per device.

## 5. Long lists can be searched

Nobody should scroll and squint to find one thing. **Any list that can grow past `SEARCH_MIN` (8) items gets a search-by-name box** at its top (Stocky's At home is the model: `shelvesHtml()` in `public/features/stocky/stockyui.js`). When you build a list that will grow (items, foods, sets, shops, bills, kinds, memories), add it in the same change.

- **Matching:** use `findByName(items, query, nameOf)` from `public/logic/search.js`; never write a new matcher. It ignores case, accents and extra spaces, needs every typed word in any order, puts names that start with the text first, and gives "Did you mean" (`close`) for typos and texting short forms (`ayma` → Ayam, `bwg` → Bawang).
- **Filter as they type**, no Search button. Redraw only the results, never the box, so the focus and phone keyboard stay (`input` → `results.innerHTML = …`). Enter closes the keyboard; Escape clears.
- **Search everything:** look inside folded groups and past "+ more" limits, and show every match with its group heading. Say how many: "3 of 19 items · Clear search".
- **Nothing found is helpful,** never a blank: "Nothing called "x"", the "Did you mean" names as taps that open the thing, and "+ Add "x"" that opens the add form with the name already typed.
- `<input type="search">` with `class="gsearch"` (16 px, so iPhones don't zoom), a placeholder that says what's searched ("Search 19 items"), `autocomplete="off"`, `enterkeyhint="search"`, an `aria-label`.
- Keep the query in memory while the app is open, so opening an item and coming back still shows the results; live updates from the other phone wait until the box loses focus.

## 6. Phone-first and calm

- Check every new layout at 375 px wide: no sideways scroll, tap targets ≥ 40 px, the number keyboard for money (`inputmode="decimal"`), the date picker for days.
- Put the main action first and make it look primary; secondary actions are plain; dangerous ones are never the default.
- Copy is short, plain and kind (see CLAUDE.md). No jargon, no blame, no ALL CAPS warnings.
- Motion is short (≤ 300 ms for moves, ~2 s for a glow), and `prefers-reduced-motion` turns it off.
- Dark and light themes both: use the colour tokens in `styles.css`, never hard-coded colours.

## 7. Prove it

Run the demo (`hosting` preview, "Try the demo"), do the flow as the family would at phone width, and check: did the page stay where I was? did it tell me it worked? could I fix a mistake? did anything I typed get lost? Fix anything that fails before shipping.
