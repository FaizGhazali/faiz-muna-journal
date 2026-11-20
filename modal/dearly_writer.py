"""Dearly's cloud writer on Modal (free tier: $30 of compute a month).

Two parts, so strangers can't run up the GPU bill:
  * `web`     a small CPU front door (FastAPI). Family writes (/write) need the family's Firebase sign-in. Demo writes
              (/demo) need no sign-in but take only short notes, build the prompt here (so it can't be used as a free
              chatbot) and are capped per visitor and per day for everyone together. Anything refused never wakes the GPU.
  * `Writer`  runs Qwen2.5 and streams the entry back: on CPU by default (llama.cpp, no card needed on Modal), or on
              a GPU if GPU is set. It sleeps after SCALEDOWN seconds idle.

Privacy: the app builds the prompt (notes, About you, style) and sends it here. Nothing is stored, and only counts are
logged (never the text). The model weights live in a Modal Volume so they download once.

Setup (once, on a computer):  see docs/dearly-modal.md
    pip install modal
    modal setup                                   # sign in to your Modal account
    modal run modal/dearly_writer.py::download    # puts the model in the volume (~5 GB on CPU, a few minutes)
    modal deploy modal/dearly_writer.py           # prints the address to paste into Dearly
"""
import json
import os
import threading
import time

import modal

# Where it runs. Edit these lines to switch, then run `download` and `deploy` again.
#   GPU = ""   (default) CPU only, with llama.cpp and a 4-bit Sailor2-8B (GGUF, ~5 GB). Needs NO card on file.
#              About 5-25 s per entry, streamed as it writes. Sailor2 is Qwen2.5-based and trained for Southeast Asian
#              languages: of the free models tried (Qwen2.5 3B / 7B), it told Malay stories best.
#              Smaller and faster: "Qwen/Qwen2.5-3B-Instruct-GGUF" + "qwen2.5-3b-instruct-q4_k_m.gguf" (memory 6144).
#   GPU = "T4" + MODEL "Qwen/Qwen2.5-3B-Instruct", or "L4" + "Qwen/Qwen2.5-7B-Instruct": faster, but Modal asks for a
#              payment method for any GPU. The free monthly credit still covers it (spending limit $0).
GPU = ""
MODEL = "Qwen/Qwen2.5-3B-Instruct"  # used when GPU is set
GGUF_REPO = "bartowski/Sailor2-8B-Chat-GGUF"  # used on CPU
GGUF_FILE = "Sailor2-8B-Chat-Q4_K_M.gguf"
CPU_CORES = 8  # physical cores on CPU mode; more = faster writing, a little more credit per write
CPU_MEMORY = 10240  # MB; an 8B model needs about 6 GB plus room for the prompt
FIREBASE_PROJECT = "faiz-muna-journal-c43ab"
FAMILY_UID = "wYR0YCfeWmVz6CvPeoqTViI8NRc2"  # the same single account firestore.rules allows
ORIGINS = [
    "https://faiz-muna-journal-c43ab.web.app",
    "https://faiz-muna-journal-c43ab.firebaseapp.com",
    "http://localhost:5000",
    "http://localhost:5057",
]
SCALEDOWN = 120  # seconds the writer stays awake after the last write; the next write within this is instant
MAX_CHARS = 16000  # whole prompt; Dearly's prompts are ~3-6k
PER_HOUR = 40  # family writes per hour, a safety cap for two people
DEMO_PER_VISITOR = 3  # demo writes per visitor (IP) per day
DEMO_PER_DAY = 20  # demo writes per day for all visitors together: roughly $10-15 a month at most of the $30 free credit
DEMO_NOTES_MAX = 600  # characters of notes a demo visitor can send

# Counters that survive the front door going to sleep.
limits = modal.Dict.from_name("dearly-limits", create_if_missing=True)

# The demo's prompt lives here, not in the browser, so /demo can only ever write a diary entry from notes.
# Same shape as the app's own prompt (public/writestyle.js): one numbered sentence per note, so the app can check
# each sentence against its note. The app spells out short forms and sends the day's language.
DEMO_RULES = """- You rewrite this person's numbered notes as their diary. You are not chatting. Write as them ("I"/"aku").
- Each note becomes ONE complete diary sentence. You may start it with a small linking word (today, then, after that, hari ni, pastu, lepas tu, tapi, sebab tu) and add the small words a full sentence needs.
- Reply with the same numbers, one sentence per line, and nothing else. Never merge, split, skip or add a number.
- Each sentence says only what its own note says. Never add events, people, places, times, food, feelings, tastes or opinions.
- Keep their words and slang. Never translate. Each note stays in its own language (English, Malay or Manglish). Malay stays casual ("aku", "hari ni", "lunch"), never formal. English words inside a Malay note stay those English words, only spelled right.
- Correct every spelling mistake and fix the grammar (offise → office, gud → good, tdur → tidur). Keep casual words and slang (gila, do, lah, best, jom): corrected, not formal.
- No drama, no lessons, no questions, never talk to "you". No emojis."""
# One example per language: the model copies its example, so a Malay day needs a Malay one.
EXAMPLES = {
    "ms": (["gym lepas kerja", "leg day, penat gila", "esok confirm tak boleh jalam", "dinner roti canai je, maybe tapau esok"],
           ["Hari ni lepas kerja aku terus pergi gym.", "Leg day, memang penat gila.", "Esok confirm tak boleh jalan.", "Pastu dinner aku makan roti canai je, maybe esok tapau."]),
    "en": (["gym aftr wrk", "legs so sor", "dinner was just roti canai, so cheap"],
           ["After work today I went straight to the gym.", "Now my legs are so sore.", "Then dinner was just roti canai, so cheap."]),
    "manglish": (["gym aftr work", "leg day, tmr sure cannot walk one", "dinner roti canai only, so cheap one"],
                 ["After work today I went to the gym.", "Leg day lah, tomorrow sure cannot walk one.", "Then dinner roti canai only, so cheap one."]),
    "mixed": (["(English) gym aftr wrk", "(Malay) leg day, penat gila, esok confirm tak boleh jalam", "(Manglish) dinner roti canai only, so cheap one"],
              ["After work today I went straight to the gym.", "Leg day, memang penat gila, esok confirm tak boleh jalan.", "Then dinner roti canai only, so cheap one."]),
}


# Story mode (the app's default): each note becomes one to three sentences that tell that part of the day. Same as
# STORY_EXAMPLES / the story rules in public/writestyle.js.
STORY_RULES = """- You turn this person's short numbered notes into their diary entry, told like a story. You are not chatting. Write as them ("I"/"aku").
- Each note becomes one to three sentences that tell that part of the day: what happened, what it was like, and how it leads to the next note.
- You may colour what a note says: how it felt, what it was like, why it mattered. Never add anything that happened or that they did which no note says: no extra activities, people, places, food, times or plans. If a note doesn't give a feeling, keep any feeling mild and close to the note.
- Reply with the same numbers, one line per number, and nothing else: no headings, no bold, no summary.
- Keep their words and slang. Never translate. Each note stays in its own language (English, Malay or Manglish). Malay stays casual ("aku", "hari ni", "lunch"), never formal. English words inside a Malay note stay those English words, only spelled right.
- Correct every spelling mistake and fix the grammar. Keep casual words and slang (gila, do, lah, best, jom).
- No life lessons, no questions, never talk to "you". No emojis."""
STORY_EXAMPLES = {
    "ms": (["gym lepas kerja", "leg day, penat gila", "esok confirm tak boleh jalam", "dinner roti canai je"],
           ["Hari ni lepas kerja, walaupun badan dah letih, aku gagahkan diri jugak pergi gym.", "Leg day pulak tu, memang penat gila sampai rasa kaki dah tak nak bergerak.",
            "Aku dah boleh agak, esok confirm tak boleh jalan dengan betul.", "Lepas semua tu, dinner aku simple je, roti canai, cukup untuk tutup hari yang panjang ni."]),
    "en": (EXAMPLES["en"][0],
           ["After work today I dragged myself to the gym, even though part of me just wanted to go home.", "Now my legs are so sore that every step reminds me of every set.",
            "Dinner was just roti canai, so cheap, a simple end to a long day."]),
    "manglish": (EXAMPLES["manglish"][0],
                 ["After work today I still went to the gym, even though I was quite tired already.", "Leg day lah, so tomorrow sure cannot walk one, confirm.",
                  "Then dinner roti canai only, so cheap one, simple but enough for me."]),
    "mixed": (EXAMPLES["mixed"][0],
              ["After work today I dragged myself to the gym, even though part of me just wanted to go home.", "Leg day pulak tu, memang penat gila, and esok confirm tak boleh jalan dengan betul.",
               "Then dinner roti canai only, so cheap one, simple but enough for me."]),
}


def numbered(xs: list) -> str:
    return "\n".join(f"{i + 1}. {x}" for i, x in enumerate(xs))


def demo_messages(notes: str, lang: str = "mixed", story: bool = False) -> list:
    lines = [l.strip().lstrip("-*• ").strip()[:200] for l in notes.splitlines() if l.strip()][:12]
    ex_notes, ex_out = (STORY_EXAMPLES if story else EXAMPLES).get(lang, EXAMPLES["mixed"])
    return [
        {"role": "system", "content": STORY_RULES if story else DEMO_RULES},
        {"role": "user", "content": f"My notes for today:\n{numbered(ex_notes)}"},
        {"role": "assistant", "content": numbered(ex_out)},
        {"role": "user", "content": "That was only an example. Now do mine, using nothing from the example."},
        {"role": "assistant", "content": "Okay. Send your notes."},
        {"role": "user", "content": f"My notes for today:\n{numbered(lines)}"},
    ]


def bump(key: str, cap: int) -> bool:
    """Add one to a counter; False (and no change) once it reaches cap."""
    n = limits.get(key, 0)
    if n >= cap:
        return False
    limits[key] = n + 1
    return True

gpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "torch==2.5.1",
        "transformers==4.46.3",
        "accelerate==1.1.1",
        "huggingface_hub[hf_transfer]==0.26.5",
    )
    .env({"HF_HUB_ENABLE_HF_TRANSFER": "1", "HF_HOME": "/models"})
)
# llama.cpp built for any x86 CPU with AVX2 (not just the build machine), so it runs wherever Modal places it.
cpu_image = (
    modal.Image.debian_slim(python_version="3.11")
    .apt_install("build-essential", "cmake")
    .env({"CMAKE_ARGS": "-DGGML_NATIVE=OFF", "HF_HUB_ENABLE_HF_TRANSFER": "1", "HF_HOME": "/models"})
    .pip_install("llama-cpp-python==0.3.2", "huggingface_hub[hf_transfer]==0.26.5")
)
writer_image = gpu_image if GPU else cpu_image
web_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]==0.115.6", "google-auth==2.37.0", "requests==2.32.3"
)
models = modal.Volume.from_name("dearly-models", create_if_missing=True)
app = modal.App("dearly-writer")


@app.function(image=writer_image, volumes={"/models": models}, timeout=3600)
def download():
    """Fetch the model into the volume once, so the writer never downloads it at write time."""
    from huggingface_hub import hf_hub_download, snapshot_download

    if GPU:
        snapshot_download(MODEL)
    else:
        hf_hub_download(GGUF_REPO, GGUF_FILE)
    models.commit()
    print("Model ready in the dearly-models volume.")


# CPU mode asks for cores and memory instead of a GPU (no card needed on Modal for that).
hardware = dict(gpu=GPU) if GPU else dict(cpu=float(CPU_CORES), memory=CPU_MEMORY)


@app.cls(image=writer_image, volumes={"/models": models}, scaledown_window=SCALEDOWN, timeout=600, max_containers=1, **hardware)
class Writer:
    @modal.enter()
    def load(self):
        if not GPU:
            from huggingface_hub import hf_hub_download
            from llama_cpp import Llama

            path = hf_hub_download(GGUF_REPO, GGUF_FILE)  # already in the volume, so this only finds it
            self.llm = Llama(model_path=path, n_ctx=8192, n_threads=CPU_CORES, n_batch=512, verbose=False)
            return
        import torch
        from transformers import AutoModelForCausalLM, AutoTokenizer

        self.tok = AutoTokenizer.from_pretrained(MODEL)
        dtype = torch.float16 if GPU == "T4" else torch.bfloat16  # T4 has no fast bf16
        self.model = AutoModelForCausalLM.from_pretrained(MODEL, torch_dtype=dtype, device_map="cuda")
        self.model.eval()

    @modal.method()
    def warm(self) -> bool:
        return True  # starting the container (and loading the model) is the whole point

    @modal.method()
    def generate(self, messages: list):
        """Stream the entry back piece by piece."""
        if not GPU:
            n = 0
            for chunk in self.llm.create_chat_completion(messages=messages, stream=True, max_tokens=900, temperature=0.3,
                                                         top_p=0.85, repeat_penalty=1.05):
                piece = chunk["choices"][0]["delta"].get("content") or ""
                n += len(piece)
                if piece:
                    yield piece
            print(f"wrote {n} chars")  # counts only, never the text
            return
        from transformers import TextIteratorStreamer

        ids = self.tok.apply_chat_template(messages, add_generation_prompt=True, return_tensors="pt").to("cuda")
        streamer = TextIteratorStreamer(self.tok, skip_prompt=True, skip_special_tokens=True)
        args = dict(input_ids=ids, streamer=streamer, max_new_tokens=600, do_sample=True, temperature=0.3, top_p=0.85,
                    repetition_penalty=1.05, pad_token_id=self.tok.eos_token_id)
        threading.Thread(target=self.model.generate, kwargs=args, daemon=True).start()
        n = 0
        for piece in streamer:
            n += len(piece)
            if piece:
                yield piece
        print(f"wrote {n} chars from a {ids.shape[1]}-token prompt")  # counts only, never the text


@app.function(image=web_image, max_containers=1, scaledown_window=60)
@modal.concurrent(max_inputs=8)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from fastapi.responses import StreamingResponse
    from google.auth.transport import requests as grequests
    from google.oauth2 import id_token

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    api.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["POST"], allow_headers=["Authorization", "Content-Type"])
    google_req = grequests.Request()

    def family_only(request: Request):
        """Only the family's Firebase sign-in gets through. Checked against Google's public keys, no secrets needed."""
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            raise HTTPException(401, "sign-in needed")
        try:
            info = id_token.verify_firebase_token(auth[7:], google_req, audience=FIREBASE_PROJECT)
        except Exception:
            raise HTTPException(401, "sign-in not valid")
        if (info or {}).get("sub") != FAMILY_UID:
            raise HTTPException(403, "not this family")

    def check_rate():
        if not bump(f"family:{time.strftime('%Y-%m-%d-%H', time.gmtime())}", PER_HOUR):
            raise HTTPException(429, "too many writes this hour")

    def visitor(request: Request) -> str:
        fwd = request.headers.get("x-forwarded-for", "")
        return (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "?"))[:64]

    def clean(body) -> list:
        msgs = body.get("messages") if isinstance(body, dict) else None
        if not isinstance(msgs, list) or not 1 <= len(msgs) <= 12:
            raise HTTPException(400, "bad request")
        out, total = [], 0
        for m in msgs:
            if not isinstance(m, dict) or m.get("role") not in ("system", "user", "assistant") or not isinstance(m.get("content"), str):
                raise HTTPException(400, "bad request")
            total += len(m["content"])
            out.append({"role": m["role"], "content": m["content"]})
        if total > MAX_CHARS:
            raise HTTPException(413, "too long")
        return out

    @api.post("/ping")
    def ping(request: Request):
        family_only(request)  # checks the sign-in without waking the GPU
        return {"ok": True, "model": MODEL}

    @api.post("/warm")
    def warm(request: Request):
        family_only(request)
        Writer().warm.spawn()  # starts the GPU in the background so the first write is quicker
        return {"ok": True}

    @api.post("/demo-left")
    def demo_left(request: Request):
        """How many demo writes this visitor has left today (doesn't use one, doesn't wake the GPU)."""
        day = time.strftime("%Y-%m-%d", time.gmtime())
        mine = limits.get(f"demo:{day}:{visitor(request)}", 0)
        everyone = limits.get(f"demo:{day}", 0)
        return {"left": max(0, min(DEMO_PER_VISITOR - mine, DEMO_PER_DAY - everyone))}

    @api.post("/demo")
    async def demo(request: Request):
        try:
            body = json.loads(await request.body())
        except Exception:
            raise HTTPException(400, "bad request")
        notes = body.get("notes") if isinstance(body, dict) else None
        if not isinstance(notes, str) or not notes.strip() or len(notes) > DEMO_NOTES_MAX:
            raise HTTPException(400, "notes needed, up to 600 characters")
        day = time.strftime("%Y-%m-%d", time.gmtime())
        if limits.get(f"demo:{day}", 0) >= DEMO_PER_DAY:
            raise HTTPException(429, "demo is full today")
        if not bump(f"demo:{day}:{visitor(request)}", DEMO_PER_VISITOR):
            raise HTTPException(429, "you've used today's demo writes")
        bump(f"demo:{day}", DEMO_PER_DAY)
        lang = body.get("lang") if body.get("lang") in EXAMPLES else "mixed"
        return StreamingResponse(Writer().generate.remote_gen(demo_messages(notes, lang, body.get("story") is True)), media_type="text/plain; charset=utf-8",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    @api.post("/write")
    async def write(request: Request):
        family_only(request)
        try:
            body = json.loads(await request.body())
        except Exception:
            raise HTTPException(400, "bad request")
        messages = clean(body)
        check_rate()
        return StreamingResponse(Writer().generate.remote_gen(messages), media_type="text/plain; charset=utf-8",
                                 headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    return api
