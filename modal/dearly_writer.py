"""Dearly's cloud writer on Modal (free tier: $30 of compute a month).

Two parts, so strangers can't run up the GPU bill:
  * `web`     a small CPU front door (FastAPI). Family writes (/write) need the family's Firebase sign-in. Demo writes
              (/demo) need no sign-in but take only short notes, build the prompt here (so it can't be used as a free
              chatbot) and are capped per visitor and per day for everyone together. Anything refused never wakes the GPU.
  * `Writer`  a GPU (T4 by default) that runs Qwen2.5 and streams the entry back. It sleeps after SCALEDOWN seconds idle.

Privacy: the app builds the prompt (notes, About you, style) and sends it here. Nothing is stored, and only counts are
logged (never the text). The model weights live in a Modal Volume so they download once.

Setup (once, on a computer):  see docs/dearly-modal.md
    pip install modal
    modal setup                                   # sign in to your Modal account
    modal run modal/dearly_writer.py::download    # puts the model in the volume (~15 GB, a few minutes)
    modal deploy modal/dearly_writer.py           # prints the address to paste into Dearly
"""
import json
import os
import threading
import time

import modal

# Which GPU and model. Edit these two lines to switch, then run `download` and `deploy` again.
#   "T4" + Qwen2.5-3B-Instruct: Modal's smallest GPU (16 GB). Try this first: may work without a card on file.
#   "L4" + Qwen2.5-7B-Instruct: better Malay. Modal asks for a payment method for L4, though the free monthly
#                               credit still covers it (keep the spending limit at $0).
GPU = "T4"
MODEL = "Qwen/Qwen2.5-3B-Instruct"
FIREBASE_PROJECT = "faiz-muna-journal-c43ab"
FAMILY_UID = "wYR0YCfeWmVz6CvPeoqTViI8NRc2"  # the same single account firestore.rules allows
ORIGINS = [
    "https://faiz-muna-journal-c43ab.web.app",
    "https://faiz-muna-journal-c43ab.firebaseapp.com",
    "http://localhost:5000",
    "http://localhost:5057",
]
SCALEDOWN = 180  # seconds the GPU stays awake after the last write; the next write within this is instant
MAX_CHARS = 16000  # whole prompt; Dearly's prompts are ~3-6k
PER_HOUR = 40  # family writes per hour, a safety cap for two people
DEMO_PER_VISITOR = 3  # demo writes per visitor (IP) per day
DEMO_PER_DAY = 25  # demo writes per day for all visitors together: at most ~$8 a month of the $30 free credit
DEMO_NOTES_MAX = 600  # characters of notes a demo visitor can send

# Counters that survive the front door going to sleep.
limits = modal.Dict.from_name("dearly-limits", create_if_missing=True)

# The demo's prompt lives here, not in the browser, so /demo can only ever write a diary entry from notes.
DEMO_RULES = """- Write this person's diary entry from their notes, as them ("I"/"aku"). You are not chatting.
- One or two plain sentences per note, same order. Never add events, people, places, times or feelings the notes don't say.
- Keep their words, slang and short forms. Never translate. Each note stays in the language it was written in (English, Malay or Manglish); English words inside a Malay note stay English.
- No drama, no lessons, no questions, never talk to "you". No emojis.
- Start with "Dear Diary," then short paragraphs. Reply with the entry only. If the notes are not about someone's day, reply only: Dear Diary,"""
EXAMPLE_NOTES = "- gym after work\n- leg day, penat gila, esok confirm x boleh jalan\n- dinner roti canai only, so cheap one"
EXAMPLE_ENTRY = "Dear Diary,\n\nI went to the gym after work. Leg day, penat gila, esok confirm x boleh jalan.\n\nDinner roti canai only, so cheap one."


def demo_messages(notes: str) -> list:
    lines = [l.strip().lstrip("-*• ").strip() for l in notes.splitlines() if l.strip()][:12]
    mine = "\n".join(f"- {l[:200]}" for l in lines)
    return [
        {"role": "system", "content": DEMO_RULES},
        {"role": "user", "content": f"My notes for today:\n{EXAMPLE_NOTES}\n\nWrite my diary entry."},
        {"role": "assistant", "content": EXAMPLE_ENTRY},
        {"role": "user", "content": "That was only an example. Now do mine, using nothing from the example."},
        {"role": "assistant", "content": "Okay. Send your notes."},
        {"role": "user", "content": f"My notes for today:\n{mine}\n\nWrite my diary entry."},
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
web_image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]==0.115.6", "google-auth==2.37.0", "requests==2.32.3"
)
models = modal.Volume.from_name("dearly-models", create_if_missing=True)
app = modal.App("dearly-writer")


@app.function(image=gpu_image, volumes={"/models": models}, timeout=3600)
def download():
    """Fetch the model into the volume once, so the GPU never downloads it at write time."""
    from huggingface_hub import snapshot_download

    snapshot_download(MODEL)
    models.commit()
    print("Model ready in the dearly-models volume.")


@app.cls(image=gpu_image, gpu=GPU, volumes={"/models": models}, scaledown_window=SCALEDOWN, timeout=600, max_containers=1)
class Writer:
    @modal.enter()
    def load(self):
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
        return StreamingResponse(Writer().generate.remote_gen(demo_messages(notes)), media_type="text/plain; charset=utf-8",
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
