# OneDrive for receipts: one-time setup

Ledger can keep receipts, bills and payslips in OneDrive. Each phone signs in with Microsoft; files go to
**OneDrive › Apps › Our Journal › Ledger**, named for you. The journal only keeps a link to each file.

The 📎 buttons stay hidden until the steps below are done and `CLIENT_ID` is filled in.

## 1. Decide whose OneDrive

Use **one Microsoft account for the family** (yours, or a shared one). Both phones sign in to that same
account, so either of you can open every receipt. If you each signed in with your own account, the files
would be split and neither of you could open the other's.

## 2. Register the app with Microsoft (about 10 minutes, free)

1. Open <https://entra.microsoft.com> and sign in with any Microsoft account (the family one is simplest).
   If it asks to create a directory or tenant, follow its prompts; that's free.
2. Go to **Applications › App registrations › New registration**.
   - **Name:** `Our Journal` (this becomes the folder name: Apps › Our Journal).
   - **Supported account types:** *Accounts in any organizational directory and personal Microsoft
     accounts* (the last option). Personal accounts must be included, since that's what OneDrive at home uses.
   - **Redirect URI:** platform **Single-page application (SPA)**, address `https://faiz-muna-journal-c43ab.web.app/`
     (the trailing `/` matters).
3. Click **Register**. On the page that opens, copy **Application (client) ID**.
4. **Authentication** (left menu): under Single-page application, add `http://localhost:5000/` too
   (for testing with `npm run dev`). If the site has its own domain, add that address too.
5. **API permissions › Add a permission › Microsoft Graph › Delegated permissions:** tick
   `Files.ReadWrite.AppFolder` and `offline_access`, then **Add permissions**.
   `Files.ReadWrite.AppFolder` lets the app use only its own folder, never your other files.
   No admin consent or client secret is needed; never create a secret, as a web page can't keep one.

## 3. Turn it on

Put the client ID in `public/shell/onedrive.js`:

```js
export const CLIENT_ID = "00000000-0000-0000-0000-000000000000";
```

It isn't a secret (it's visible in any web app that signs in with Microsoft), so it can live in the public repo.
Push to `main` and the 📎 buttons appear.

## 4. First use on each phone

Open a Recent item or a paid bill › **📎 Add receipt › Connect OneDrive**, sign in to the family account and
accept. You come back to the same entry. Microsoft keeps a web app signed in for about a day without use;
after that, the next upload asks you to connect again (one tap if the phone is still signed in to Microsoft).

## How files are named

```
Ledger/<year>/<YYYY-MM>/<folder>/<date> <what> RM<amount> <who>.<ext>

Ledger/2026/2026-11/Receipts/2026-11-24 Kedai Runcit Maju RM18.43 Faiz.jpg
Ledger/2026/2026-12/Bills/2026-12-01 Car RM520 Muna.pdf
```

- **Folder** from what the entry is: spending and refunds › Receipts, card payments › Card payments,
  paid bills › Bills (payslips and statements are ready for later).
- **Photos** (JPG, PNG, WebP) are made smaller (2000 px) and saved as JPG. HEIC, PDFs and every other file
  are uploaded exactly as they are. Files over 4 MB go up in pieces.
- A name that's already taken gets a number added by OneDrive.
- Removing a file from an entry only takes the link away; the file stays in OneDrive.

### Income documents

In **Add income**, choose **Fill from document** to read a text-based payslip PDF on your device.
For scanned PDFs, choose **Scan with Gemini** to send the PDF through Modal to Google for extraction.
Review the suggested net pay, employer and payment date. If the PDF only shows a pay period, the form suggests
the last day of that month. Change it to the actual payment date if needed. Tick **Keep a copy in OneDrive** to attach
the PDF after saving. You can also add proof later using the paperclip on the income entry.
If OneDrive needs you to sign in, choose the file again after connecting.

New income attachments go to:

```
Ledger/Income/<person>/<year>/<Payslips or Other proof>/<date> - <payer> - <Payslip or Income proof>.<ext>
Ledger/Income/Faiz/2026/Payslips/2026-11-27 - Company Name - Payslip.pdf
```

The folder year and filename date come from **Date received**. Existing attachments can still be opened
from their original entries.

### Income Tax

Open **Income → Income Tax** and pick the person and Year of Assessment. In a payslip entry, record the
pay period, gross pay and employee deductions under **Payroll details**. The budget uses net pay, while
the tax overview uses the payroll fields and groups entries by the calendar year of **Date received**.

Enter annual totals under **Compare EA** and attach each employer's EA form. Under **Relief checklist**, record
amounts, attach supporting receipts and mark them reviewed. The CSV is a worksheet for checking your figures.
To keep annual documents together, add them to the appropriate year. New attachments go to:

```
Ledger/Income Tax/<person>/<year>/EA forms/
Ledger/Income Tax/<person>/<year>/Relief evidence/
```
