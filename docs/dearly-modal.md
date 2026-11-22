# Dearly's cloud writer on Modal (free)

For phones whose graphics chip can't run the on-phone writer, like the Snapdragon 8 Gen 3. A small server on
[Modal](https://modal.com) runs Sailor2-8B, a free model trained for Southeast Asian languages, so it writes much better Malay and Manglish than the phone can.
Nothing needs downloading on the phone.

By default it runs on Modal's **CPUs** (llama.cpp, a 4-bit model of about 2 GB), because Modal asks for a card on file
before it lets you use any GPU, even the free credit. CPU needs no card. An entry takes about 30–60 seconds and appears
as it's written.

## What it costs: $0

- The model is open and free.
- Modal gives **$30 of compute free every month**. Two people writing daily use roughly $1–2 of it.
- The **demo** is capped at 3 writes per visitor per day and 20 a day in total, so it can use at most about $10–15 of
  the free $30.
- **Set Modal's spending limit to $0** (step 2). Then if the free credit ever runs out, the cloud writer just pauses
  until next month. You are never charged.

## CPU or GPU?

- **CPU + Sailor2-8B (the default).** No card needed. About 5–25 s per entry once awake. Sailor2 is built on Qwen2.5 and
  trained for Southeast Asian languages, and it told Malay stories best of the free models tried. For a smaller, faster,
  plainer writer, set `GGUF_REPO = "Qwen/Qwen2.5-3B-Instruct-GGUF"`, `GGUF_FILE = "qwen2.5-3b-instruct-q4_k_m.gguf"` and
  `CPU_MEMORY = 6144`.
- **GPU (T4 + Qwen2.5-3B, or L4 + Qwen2.5-7B).** A few seconds per entry, and 7B writes the best Malay. Modal says
  "Please add a payment method to use T4/L4 GPU functions" first. With a card added and the spending limit at $0, it
  still runs on the free monthly credit. To switch, set `GPU` and `MODEL` at the top of `modal/dearly_writer.py`, then
  run steps 4 and 5 again.

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

4. **Put the model in Modal's storage** (one time, ~5 GB on CPU, ~6 GB for 3B or ~15 GB for 7B on a GPU, a few minutes, uses a little free credit):

   ```powershell
   modal run modal/dearly_writer.py::download
   ```

5. **Deploy the server:**

   ```powershell
   modal deploy modal/dearly_writer.py
   ```

   It prints an address like `https://<your-workspace>--dearly-writer-web.modal.run`. Copy it.

6. **Put the address in the app:** in `public/features/diary/cloudai.js`, set `CLOUD_URL` to that address, then push. Or just paste the
   address to Claude and ask it to do this.

## How it's kept safe

- **Family writes** (`/write`) need the family's own Firebase sign-in. The server checks the token against Google's
  public keys and only accepts the single family account that `firestore.rules` allows. No API key lives in the app.
- **Demo writes** (`/demo`) need no sign-in, but they only accept notes (up to 600 characters). The server builds a
  fixed diary prompt itself, so `/demo` can't be used as a free general chatbot. Counters in a Modal Dict cap it per
  visitor and per day.
- **Requests that are refused never wake the writer.** A small CPU front door checks everything first.
- **Nothing is stored.** The server logs only character and token counts, never your text.
- **Both of you can choose** the cloud writer per phone, and the first time it explains what leaves the phone. The
  on-phone writer and plain writing still work without it.

## Changing things

- **CPU or GPU, and the model:** `GPU` and `MODEL` at the top of `modal/dearly_writer.py`. Run step 4 again, then step 5.
- **Demo limits:** `DEMO_PER_VISITOR`, `DEMO_PER_DAY`.
- **Wake-up:** the writer sleeps after `SCALEDOWN` seconds (120). The first write after that waits a little longer
  while it starts. A longer `SCALEDOWN` keeps it awake longer, which uses more credit.
- **Turn it off:** `modal app stop dearly-writer`, or set `CLOUD_URL` back to `""` in the app.

## Tested so far

- Deployed on CPU at `https://faizghazali21--dearly-writer-web.modal.run` (2026-11-20). `/demo-left` answers, `/write`
  without a sign-in is refused (401).
- Real demo writes: Malay / Manglish notes came back in their own words and language, about 13 s on a cold start and
  2–3 s once awake. The app's page (localhost) reaches it through CORS.
- Still to check: a signed-in family write from the live site, and how long longer notes take.
