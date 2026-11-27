# Receipt reader on Modal: setup

Stocky's "Scan receipt" sends a shrunk JPEG of the receipt to `modal/receipt_reader.py`, which asks Google's Gemini to
read it into JSON. Until the reader's address is in `READER_URL` (`public/features/stocky/receiptread.js`), scanning is
hidden for the family (the demo always has it, with a made-up receipt).

## Once, on the PC

1. Get a Gemini API key: <https://aistudio.google.com/apikey> (free tier). Google may use free-tier requests to improve
   its products. Ledger keeps payslips on-device unless you click **Scan with Gemini**. That action sends the PDF through Modal to Google. Use manual entry if you want to keep the PDF local.
2. Modal is already set up for Dearly (`pip install modal`, `modal setup`). Store the key as a Modal secret:

   ```powershell
   modal secret create gemini GEMINI_API_KEY=paste-the-key-here
   ```

   Optional, to change models without a deploy of the app: add `GEMINI_MODEL=...` (first try, default
   `gemini-2.5-flash-lite`) and `GEMINI_MODEL_FALLBACK=...` (second try when the lines don't add up, default
   `gemini-2.5-flash`) to the same secret.
3. Deploy:

   ```powershell
   modal deploy modal/receipt_reader.py
   ```

   It prints an address like `https://<workspace>--receipt-reader-web.modal.run`.
4. Paste that address into `READER_URL` in `public/features/stocky/receiptread.js`, then ship (push to `main`).

## Payslip PDFs

Ledger first reads selectable text on your device. If it cannot fill the payslip details, **Scan with Gemini**
sends the PDF (up to 4 MB) to the same authenticated Modal service. Review each suggestion before saving.
Payslips use the same quota as Stocky receipts. To release changes to the payslip reader, deploy
`modal/receipt_reader.py` before publishing the Firebase frontend. No additional secret is needed.

## Limits and safety

- Only the two family sign-ins (p1, p2) are let through; the old shared login and strangers get 401 / 403 without
  Gemini being called.
- `PER_HOUR` (20) and `PER_DAY` (60) cap reads in a Modal Dict (`receipt-limits`). Over the cap, or when Gemini says
  429, the app says "busy, try again later". There is no automatic retry loop.
- CPU only, no GPU: it just waits for Gemini, so it costs next to nothing of the free monthly credit.
- Nothing is stored on the server: only counts and the model name are logged, never the picture or the text.

## Android: the widget app's scanner

The Next Move widget app (`android/`) has `ScanActivity`: Google's ML Kit document scanner (crop, straighten, clean
up; no camera permission; needs Google Play services, which downloads the scanner's parts the first time). It shares the
JPEG straight to the installed journal app, whose `share_target` (`manifest.webmanifest`) posts it to the service
worker, which opens `#stocky/scan`.

- The journal must be **installed** from Chrome (Install app / Add to Home screen). After this release Chrome updates
  the installed app with the share target on its own, which can take a day; reinstalling it is quicker.
- Install the new APK from the widget sheet's link (built by `android.yml`).
- The journal's "Scan receipt" button opens the scanner when `navigator.getInstalledRelatedApps()` says the widget
  app is there (it declares the site in `asset_statements`); otherwise it takes a photo with the browser.
- Not yet tried on a real phone: check the scanner, the share back to the journal, and the widget button.
