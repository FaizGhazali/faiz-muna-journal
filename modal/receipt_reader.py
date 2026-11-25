"""Stocky's receipt reader on Modal (CPU only, within the free monthly credit).

The app sends a picture of a shop receipt (JPEG, already shrunk on the phone); this asks Gemini to read it into JSON
and sends the JSON back. The app checks that it adds up (public/logic/receipt.js) and asks again with
`fallback: true` (a stronger model) when it doesn't. Plan: docs/receipt-scan-plan.md. Setup: docs/receipt-modal.md.

  * Only the family's Firebase sign-in gets through (same check as modal/dearly_writer.py), capped per hour and per
    day in a Modal Dict. Refused requests never call Gemini.
  * The Gemini key lives only in the Modal secret "gemini" (GEMINI_API_KEY, optional GEMINI_MODEL and
    GEMINI_MODEL_FALLBACK). Never in the app or the repo.
  * Nothing is stored here: the picture and the answer pass through. Only counts are logged.
  * Google's free tier may use what's sent to improve its products. Fine for shop receipts; said in the setup doc.

    pip install modal
    modal setup
    modal secret create gemini GEMINI_API_KEY=...        # key from https://aistudio.google.com/apikey
    modal deploy modal/receipt_reader.py                 # prints the address to paste into READER_URL
"""
import base64
import json
import os
import time

import modal

FIREBASE_PROJECT = "faiz-muna-journal-c43ab"
FAMILY_UIDS = {  # the two people (firestore.rules); the old shared login only reads, so it can't scan
    "anhTfDbP4NS3efUYf1VnBTuXVTy2",  # p1
    "EeSDAXmlrtYRKL2uN3ANhXp9W6s1",  # p2
}
ORIGINS = [
    "https://faiz-muna-journal-c43ab.web.app",
    "https://faiz-muna-journal-c43ab.firebaseapp.com",
    "http://localhost:5000",
]
MODEL = "gemini-2.5-flash-lite"  # when the secret doesn't set GEMINI_MODEL
MODEL_FALLBACK = "gemini-2.5-flash"  # when it doesn't set GEMINI_MODEL_FALLBACK
PER_HOUR = 20  # reads per hour for the family together
PER_DAY = 60  # reads per day
MAX_BYTES = 4_000_000  # the picture; the app sends ~1600 px JPEGs of a few hundred KB

PROMPT = """Read this shop receipt (most likely from Malaysia, in Malay or English).
- Copy every item name exactly as printed, including codes and sizes. Do not translate or tidy them.
- One item per bought line. qty is how many were bought (1 if not printed); unit_price is the price of one if printed;
  line_total is what the line costs.
- Discount, promotion or member-price lines printed under an item are their own items with a NEGATIVE line_total.
- discounts is any bill-level discount NOT already listed as an item (0 if none). rounding is the rounding adjustment
  (e.g. -0.02), 0 if none. total is the final amount to pay.
- date as YYYY-MM-DD. currency as a code (MYR for RM).
- Leave out payment, change, tax summary, points and footer lines."""

SCHEMA = {
    "type": "OBJECT",
    "properties": {
        "store_name": {"type": "STRING"},
        "store_branch": {"type": "STRING"},
        "date": {"type": "STRING"},
        "currency": {"type": "STRING"},
        "items": {
            "type": "ARRAY",
            "items": {
                "type": "OBJECT",
                "properties": {
                    "raw_name": {"type": "STRING"},
                    "qty": {"type": "NUMBER"},
                    "unit_price": {"type": "NUMBER"},
                    "line_total": {"type": "NUMBER"},
                },
                "required": ["raw_name", "line_total"],
            },
        },
        "subtotal": {"type": "NUMBER"},
        "discounts": {"type": "NUMBER"},
        "rounding": {"type": "NUMBER"},
        "total": {"type": "NUMBER"},
    },
    "required": ["store_name", "date", "items", "total"],
}

limits = modal.Dict.from_name("receipt-limits", create_if_missing=True)
image = modal.Image.debian_slim(python_version="3.11").pip_install(
    "fastapi[standard]==0.115.6", "google-auth==2.37.0", "requests==2.32.3"
)
app = modal.App("receipt-reader")


def bump(key: str, cap: int) -> bool:
    """Add one to a counter; False (and no change) once it reaches cap."""
    n = limits.get(key, 0)
    if n >= cap:
        return False
    limits[key] = n + 1
    return True


def ask_gemini(jpeg: bytes, model: str, key: str) -> dict:
    import requests

    body = {
        "contents": [{"role": "user", "parts": [
            {"inline_data": {"mime_type": "image/jpeg", "data": base64.b64encode(jpeg).decode()}},
            {"text": PROMPT},
        ]}],
        "generationConfig": {"temperature": 0, "responseMimeType": "application/json", "responseSchema": SCHEMA},
    }
    r = requests.post(f"https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent",
                      headers={"x-goog-api-key": key, "Content-Type": "application/json"}, json=body, timeout=90)
    if r.status_code == 429:
        raise RuntimeError("busy")
    r.raise_for_status()
    parts = (r.json().get("candidates") or [{}])[0].get("content", {}).get("parts") or [{}]
    return json.loads(parts[0].get("text") or "{}")


@app.function(image=image, secrets=[modal.Secret.from_name("gemini")], max_containers=1, scaledown_window=60, timeout=150)
@modal.concurrent(max_inputs=4)
@modal.asgi_app()
def web():
    from fastapi import FastAPI, HTTPException, Request
    from fastapi.middleware.cors import CORSMiddleware
    from google.auth.transport import requests as grequests
    from google.oauth2 import id_token

    api = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    api.add_middleware(CORSMiddleware, allow_origins=ORIGINS, allow_methods=["POST"], allow_headers=["Authorization", "Content-Type"])
    google_req = grequests.Request()

    def family_only(request: Request):
        auth = request.headers.get("authorization", "")
        if not auth.startswith("Bearer "):
            raise HTTPException(401, "sign-in needed")
        try:
            info = id_token.verify_firebase_token(auth[7:], google_req, audience=FIREBASE_PROJECT)
        except Exception:
            raise HTTPException(401, "sign-in not valid")
        if (info or {}).get("sub") not in FAMILY_UIDS:
            raise HTTPException(403, "not this family")

    @api.post("/ping")
    def ping(request: Request):
        family_only(request)
        return {"ok": True}

    @api.post("/read")
    async def read(request: Request):
        family_only(request)
        try:
            body = json.loads(await request.body())
            jpeg = base64.b64decode(body["image"], validate=True)
        except Exception:
            raise HTTPException(400, "bad request")
        if not jpeg or len(jpeg) > MAX_BYTES:
            raise HTTPException(413, "picture too big")
        if not jpeg.startswith(b"\xff\xd8"):
            raise HTTPException(400, "send a JPEG")
        if not bump(f"day:{time.strftime('%Y-%m-%d', time.gmtime())}", PER_DAY) or not bump(f"hour:{time.strftime('%Y-%m-%d-%H', time.gmtime())}", PER_HOUR):
            raise HTTPException(429, "too many receipts for now")
        model = os.environ.get("GEMINI_MODEL_FALLBACK", MODEL_FALLBACK) if body.get("fallback") is True else os.environ.get("GEMINI_MODEL", MODEL)
        try:
            answer = ask_gemini(jpeg, model, os.environ["GEMINI_API_KEY"])
        except RuntimeError:
            raise HTTPException(429, "the reader is busy, try again later")
        except Exception as e:
            print(f"read failed: {type(e).__name__}")  # never the picture or the text
            raise HTTPException(502, "couldn't read it")
        print(f"read {len(answer.get('items') or [])} lines with {model}")
        return {"model": model, "receipt": answer}

    return api
