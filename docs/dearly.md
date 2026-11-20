# Dearly — the diary journal and its on-device writer

Dearly is the **Diary** slot on the round journal button. You can write entries yourself, or jot a few words and let a
small AI model turn them into an entry. The model runs **inside the browser on the device's graphics chip** (WebLLM on
WebGPU). There's no server, no API key, no account and no charge per use.

## Setup

Nothing to install. In the app:

1. Round button → **Diary** → **Write today's diary**.
2. Pick **✨ Help me write**, jot your notes, and tap **Write it for me**.
3. The first time, tap **Download** (one time only). The model is saved in the browser and opens in a few seconds after that.
4. Read the draft, fix anything, then **Save entry**.

Optional, on **✨ AI & privacy**:

- **About you:** a few lines in your own words (who you are, what you call people, how you talk). The writer reads this
  in the background on every entry. It's never added as something that happened.
- **Suggestions from your entries:** under About you, Dearly offers lines to add. A name that keeps coming up asks
  "Who or what is Lina to you?" and you type the answer yourself. Words you use a lot, and how you mix languages, are
  offered as ready-made lines. They're found by counting on the device, not by the AI model, so nothing is guessed
  and moods or personality are never suggested. Nothing changes until you tap **Add**, and **Not now** hides a
  suggestion for good. Accepting one is a single small write to `diaryStyle/{person}`. The ✨ AI & privacy button on the
  dashboard shows a count when there are suggestions.
- **Learn my writing style:** off by default. When it's on, the writer studies how you write (sentence length,
  favourite words, slang, how you mix languages) from entries **you wrote yourself**. Entries the helper wrote are
  never used, so it doesn't learn from itself. You can leave out single entries, or reset the style.

## Model choices

| Size | Model (WebLLM id) | Download | GPU memory | For |
|---|---|---|---|---|
| Small | Qwen2.5-0.5B-Instruct `q4f16_1` / `q4f32_1` | ~0.3 GB | ~1.0 GB | phones, older laptops |
| **Medium** (suggested) | Qwen2.5-1.5B-Instruct | ~0.9 GB | ~1.7 GB | most laptops, newer phones |
| Large | Qwen2.5-3B-Instruct | ~1.7 GB | ~2.6 GB | laptops/desktops with 8 GB+ RAM |

- Download sizes are approximate. Memory figures come from WebLLM 0.2.86's model list.
- **Phones always get the `q4f32_1` build** (about 15% bigger). On some Android graphics chips the faster `q4f16_1`
  build scrambled the output into mixed-script junk even though the phone reported `shader-f16` support. Computers
  use `q4f16_1` when supported. If scrambled text is ever detected while writing (`looksGarbled()`), Dearly stops,
  restores what was there, removes the 16-bit download, and switches that device to 32-bit (`journal-ai-f32`).
- Qwen2.5 was chosen because it handles Malay better than other models this small, and has no "thinking" output.

## Which devices work

- **Works:** Chrome or Edge on Windows/macOS/ChromeOS; Chrome on many Android phones (Chrome 121+, recent chips);
  Safari on iOS/iPadOS/macOS 26+.
- **Doesn't:** older iPhones, Firefox on most systems, low-end Android phones, very old GPU drivers. The page says so
  in plain words, and the diary keeps working without the writer.
- **Speed (tested):** Intel Iris Xe laptop, 1.5B model: the first download took about a minute on fast internet. After
  a page reload, the model opens from storage in seconds, and an entry takes roughly 20–40 seconds.

## Honest limitations

- **Small models slip.** Even with strict instructions, a 1.5B model sometimes translates a word, drops one of your
  words, or adds a word you never wrote. The editor flags these after every draft: **"Check these"** lists names,
  numbers, feelings and other words not in your notes, and **"Your own words that went missing"** lists Malay, Manglish
  or slang words that got lost. You always review before saving.
- **Faithful beats fancy.** Testing showed that asking the 1.5B model to "make it flow" made it invent outings and
  feelings. So it stays close to your words: lightly tidied, not rewritten. The Large (3B) model writes more naturally. That's
  expected but wasn't tested here.
- **Language follows each note**, judged by its grammar words, not its vocabulary. "tadi aku mezmerize do, macam star
  align" is a Malay note, and its English words stay English. Manglish ("cannot lah", "late already") stays Manglish.
- **Storage can be cleared.** Clearing site data or history, or the browser running out of space, removes the model,
  and it downloads again. The app asks the browser to keep it (`navigator.storage.persist()`). On iPhone, add the app
  to the home screen, or Safari may clear it after weeks without use.
- **Downloads can stop.** Tap Download again. Finished pieces are kept, so it continues instead of starting over.
- **One family login.** Nobody outside the family can read the diary, but both of you can technically open each
  other's entries. Truly private diaries need separate accounts, which means a change to `firestore.rules`.

## Where data lives

| What | Where | Leaves the device? |
|---|---|---|
| Diary entries, tags, moods | Firestore `diary/*` (family-only rules), plus the offline copy on the device | Synced to the family's Firebase project only |
| Photos | Shrunk on the device (≤1280 px JPEG), saved in Firestore `diaryPhotos/*`, with a small thumbnail on the entry | Same as above |
| Style on/off, reset date, About you | Firestore `diaryStyle/{person}` (also `dismissed` suggestion keys) | Same as above |
| Style profile ("What Dearly noticed") | Worked out on the device each time, never stored | No |
| Notes and entries sent to the AI | The model running in this browser tab (Web Worker) | **No.** The only network traffic is the one-time model download from huggingface.co and raw.githubusercontent.com |
| Drafts | `localStorage` on this device (`journal-diary-draft-*`) | No |
| The model | Browser Cache Storage (`webllm/model`, `webllm/wasm`, `webllm/config`) | No |

There's no analytics, and diary text is never logged to the console. Deleting an entry moves it to **Recently deleted**
for 30 days, and after that it's removed for good, photos included. **Download my diary as text** saves a readable
copy, and **Backup** (round button → ⋯) saves and restores everything, diary included.

## Firebase cost

The writer adds **zero** database traffic: the style profile is computed from entries already loaded, and generation
runs on the device. Each save is one entry write, plus one write per new photo. Two people writing daily is a handful
of writes a day, far below the free tier (20,000 writes and 50,000 reads a day).

## Testing report (20 Nov 2026)

- **Unit tests:** `npm test`, 71 passing (including About-you suggestions). That covers the diary logic (stats, streak, On this day, search/filter/sort,
  neighbours, Recently deleted expiry), the style profile, language detection (English / Malay / Manglish /
  Malay-with-English-words), prompt building, output tidying, and the invented-word and dropped-word checks.
- **In the browser (demo mode, desktop and 375 px phone width):** dashboard, empty state, stats, On this day, search,
  tag, month, favourite and sort filters, person switch, writing, draft autosave and restore after leaving and
  reloading, save, reader, favourite, edit (favourite kept), delete → Recently deleted → restore, AI page, style
  switch and "What Dearly noticed", About you. No sideways scrolling at phone width.
- **Real inference (no fake responses):** Qwen2.5-1.5B q4f16 on Intel Iris Xe (WebGPU, shader-f16): downloaded,
  generated, reopened from cache after a reload, and generated again. Mixed English / Malay / Manglish notes came back
  in their own languages. Earlier prompt versions invented feelings and translated words. Those runs drove the
  current prompt and checks.
- **Not tested:** real phones, the installed PWA, an iPhone, a device without WebGPU (that path is code-reviewed, and
  its message is the one from `whyText()`), the Small and Large models, a download cut off halfway, and storage
  eviction.
