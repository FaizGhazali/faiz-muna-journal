# Dearly's cloud writer on Modal (free)

For phones whose graphics chip can't run the on-phone writer, like the Snapdragon 8 Gen 3. A small server on
[Modal](https://modal.com) runs Qwen2.5-7B-Instruct on an L4 GPU. That's a bigger model than any phone can hold, so it
writes better Malay and Manglish. Nothing needs downloading on the phone.

## What it costs: $0

- The model is open and free.
- Modal gives **$30 of compute free every month**. Two people writing daily use roughly $1–2 of it.
- The **demo** is capped at 3 writes per visitor per day and 25 a day in total, so it can use at most about $8 of the
  free $30.
- **Set Modal's spending limit to $0** (step 2). Then if the free credit ever runs out, the cloud writer just pauses
  until next month. You are never charged.

## Set it up (once, on a computer, about 15 minutes)

1. **Make a Modal account** at modal.com. You need to do this yourself.
2. **Set the spending limit to $0:** Modal dashboard → Settings → Usage / Billing → spending limit $0 (or the lowest
   it allows). Check it shows the free monthly credit.
3. **Install Modal and sign in** (PowerShell, in this project folder):

   ```powershell
   pip install modal
   ```

   ```powershell
   modal setup
   ```

4. **Put the model in Modal's storage** (one time, ~15 GB, a few minutes, uses a little free credit):

   ```powershell
   modal run modal/dearly_writer.py::download
   ```

5. **Deploy the server:**

   ```powershell
   modal deploy modal/dearly_writer.py
   ```

   It prints an address like `https://<your-workspace>--dearly-writer-web.modal.run`. Copy it.

6. **Put the address in the app:** in `public/cloudai.js`, set `CLOUD_URL` to that address, then push. Or just paste the
   address to Claude and ask it to do this.

## How it's kept safe

- **Family writes** (`/write`) need the family's own Firebase sign-in. The server checks the token against Google's
  public keys and only accepts the single family account that `firestore.rules` allows. No API key lives in the app.
- **Demo writes** (`/demo`) need no sign-in, but they only accept notes (up to 600 characters). The server builds a
  fixed diary prompt itself, so `/demo` can't be used as a free general chatbot. Counters in a Modal Dict cap it per
  visitor and per day.
- **Requests that are refused never wake the GPU.** A small CPU front door checks everything first.
- **Nothing is stored.** The server logs only character and token counts, never your text.
- **Both of you can choose** the cloud writer per phone, and the first time it explains what leaves the phone. The
  on-phone writer and plain writing still work without it.

## Changing things

- **Model:** `MODEL` at the top of `modal/dearly_writer.py` (for example `Qwen/Qwen2.5-3B-Instruct`, which is cheaper and
  faster to wake). Run step 4 again, then step 5.
- **Demo limits:** `DEMO_PER_VISITOR`, `DEMO_PER_DAY`.
- **Wake-up:** the GPU sleeps after `SCALEDOWN` seconds (180). The first write after that takes about 20–60 s while it
  starts. A longer `SCALEDOWN` keeps it awake longer, which uses more credit.
- **Turn it off:** `modal app stop dearly-writer`, or set `CLOUD_URL` back to `""` in the app.

## Tested so far

- The server file loads with Modal 1.6.4. It wasn't deployed, because that needs your account.
- The app's cloud flow was tested in the demo against a local stand-in server (`localhost`): the offer, the consent
  box, "N demo writes left today", the streamed entry, the daily-limit message, and switching back to the on-phone
  writer. Real Qwen2.5-7B output on Modal, sign-in checking and the GPU wake-up time are untested until it's deployed.
