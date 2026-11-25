# Stocky receipt scanning: plan (agreed 25 Nov 2026, built 25 Nov 2026)

Built as planned. Differences: no `firestore.rules` change was needed (`receipts` and `receiptAliases` are shared
Stocky collections, already covered by the shared rule); a discount line is folded into the item line above it (lower
price, `sale: true`); the review page lets the amount added be typed (`amount` on a line) since a receipt's "2 × 1L"
isn't always two of the item's usual packs. Reader deployed 25 Nov 2026 (`receipt-reader` on Modal, Gemini key in the `gemini`
secret). Still to do: trying it with a real receipt, and the Android scanner on a real phone.

Scan a shop receipt and have its items and prices added to Stocky. Manual work only once per new printed
item name (it's remembered as an alias) or when a scan fails the totals check.

To be built on the PC with Android Studio (the Android part needs a phone to test the scanner).

## Capture

- **Android with the widget app:** "Scan receipt" in Stocky opens the widget app's new `ScanActivity` through an
  `intent://` link (`S.browser_fallback_url` back to the page for when the app is missing). The web page checks first
  with `navigator.getInstalledRelatedApps()` (needs `related_applications` in the web manifest and the site declared
  in the Android app). `ScanActivity` runs the **ML Kit Document Scanner** (`play-services-mlkit-document-scanner`:
  crop, deskew, clean up; no camera permission; 1 page; JPEG; gallery import allowed).
- **Widget button:** a small "Scan receipt" button on the home-screen widget (`widget_move.xml`, `MoveWidget.kt`)
  opens `ScanActivity` straight away.
- **Back to the journal:** the scanned JPEG is shared (`ACTION_SEND`) straight to the installed journal PWA
  (WebAPK, found with `<queries>` / `queryIntentActivities`, no chooser). The PWA declares a `share_target`
  (POST, multipart, image) in `manifest.webmanifest`; `sw.js` takes the POST, keeps the picture briefly in a cache
  **not** named `journal-*` (those are cleared on version bumps), and opens `/#stocky/scan`. If the journal isn't
  installed, `ScanActivity` says so instead of dropping the picture.
- **Everyone else** (iPhone, computer, Android without the widget app): `<input type="file" accept="image/*"
  capture="environment">`, then resize to ~1600 px long edge, JPEG, on the device.
- Android notes: the ML Kit library brings some AndroidX in transitively (our own code still uses none). Needs Google
  Play services; the scanner downloads its parts on first use. No Android tests exist: check via `android.yml` CI and a
  real phone. Family installs the new APK from the widget sheet's link.

## Extract (server side only)

- New `modal/receipt_reader.py` (CPU only, Modal free credit), same front door as `dearly_writer.py`: checks the
  family's Firebase ID token, rate limits in a Modal Dict. Never wakes anything for refused requests.
- Calls Gemini with a JSON schema: `{ store_name, store_branch?, date, currency, items: [{ raw_name, qty,
  unit_price?, line_total }], subtotal?, discounts?, rounding?, total }`. Prompt: copy item names exactly as
  printed, discount lines are negative items.
- Modal secret: `GEMINI_API_KEY`, `GEMINI_MODEL` (latest Flash-Lite), `GEMINI_MODEL_FALLBACK` (Flash). Key from
  Google AI Studio. Never in the app or the repo.
- 429: clear "try again later" message, no automatic retry loop.
- Free tier note: Google may use free-tier content to improve its products. Fine for shop receipts; say so in setup.
- The demo never calls it: a made-up sample result.

## Validate (pure, `public/logic/receipt.js`, tested)

- sum(line_total) + discounts + rounding ≈ total (±RM0.05); qty × unit_price ≈ line_total where unit_price is given.
- Fails → the app asks once more with `fallback: true` (Flash); still failing → `needs_review`, show the parsed lines
  to correct by hand.

## Match

- Alias lookup by (`shopKey(store)`, normalised raw name) → Stocky item.
- Else suggest the best item with `findByName()` (`logic/search.js`, "Did you mean") and `tagKey` / `looksLike`;
  the person taps ✓, picks another, or makes a new item. The choice is saved as an alias.
- Shop names go through the shared shop list (`logic/shops.js`, `shopKey()`), same as Ledger.

## Save

- Each confirmed line becomes a Stocky `buys` doc (`{ item, date, qty, price, shop, by, at, receipt }`). That already
  feeds price history (`priceBoard`, `usualPrice`) and the stock estimate, so stock updates for free.
- Receipt qty is packs: buy `qty` = receipt qty × item `pack` (item unit g / ml / pcs).
- The photo is **not stored** (like COROS pictures and statements). Saving it to the OneDrive Receipts folder can come
  later as an option.

## Data (Firestore, shared like the rest of Stocky, every doc dated)

- `receipts/{auto id}` → `{ shop, branch?, date, total, status: parsed|needs_review|confirmed, lines: [{ raw, qty,
  unitPrice?, lineTotal, item?, match: alias|suggested|manual }], raw (Gemini JSON), model, by, created, updated }`.
- `receiptAliases/{shopKey}_{nameKey}` → `{ shop, raw, item, by, created, updated }` (the id keeps it unique).
- Prices: existing `buys` with `receipt: <id>` (no new prices collection).
- Needs `firestore.rules` changes: the user approves and deploys those; never deploy rules unasked.
- Add to `backup.js`, `memdb.js` / `fs.js` if new Firestore calls are used, `SHELL` in `sw.js`.

## UI

- "Scan receipt" button in Stocky.
- Review page `#stocky/receipt/<id>`: ✅ matched / 🟡 suggested (one-tap confirm) / ❓ new; every line editable;
  computed sum vs printed total and the check result.
- History `#stocky/receipts` with a status filter.
- Landing tour scene, "What's new", FAQ; CLAUDE.md section with the decisions.

## Tests (no live API calls)

Validation, name normalisation, alias matching, Gemini response parsing (fixture JSON with made-up shops and items;
never real receipts in the repo), receipt qty → buy qty.

## Later

- Optionally add the receipt total as Ledger spending.
- Optionally keep the photo in OneDrive.
