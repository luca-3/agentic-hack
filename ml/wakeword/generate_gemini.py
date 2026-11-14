"""Synthesize clips with Gemini TTS (30 prebuilt voices, multilingual): plain-text positives, near-miss / office
negatives (with style prefixes for prosody variety) and hard negatives ("Valo" without "hey").
Usage: python generate_gemini.py [--data DIR] [--model gemini-3.8-flash-tts]"""
import argparse, base64, io, json, random, ssl, sys, time, urllib.request
import numpy as np, soundfile as sf
from concurrent.futures import ThreadPoolExecutor
from scipy.signal import resample_poly
from common import append_manifest, data_dir, gemini_key
from phrases import ADVERSARIAL, GEMINI_VOICES, HARD, POSITIVE, SENTENCES, STYLES

ap = argparse.ArgumentParser(); ap.add_argument("--data"); ap.add_argument("--model", default="gemini-3.8-flash-tts"); args = ap.parse_args()
d = data_dir(args.data); KEY = gemini_key()
try: CTX = ssl.create_default_context(cafile="/etc/ssl/cert.pem")  # python.org builds on macOS ship without CA certs
except OSError: CTX = ssl.create_default_context()

random.seed(2)
jobs = []  # (prefix, kind, label, voice, text)
for v in GEMINI_VOICES:
    for kw in POSITIVE:
        for t in random.sample(POSITIVE[kw][:7], 5): jobs.append(("gem2", f"pos_{kw}", 1, v, t))
    for t in random.sample(ADVERSARIAL, 5): jobs.append(("gem", "adversarial", 0, v, random.choice(STYLES[:4]) + t))
    for t in random.sample(SENTENCES, 5): jobs.append(("gem", "sentence", 0, v, t))
    for t in random.sample(HARD, 7): jobs.append(("hard", "hard", 0, v, t))

def tts(item):
    i, (prefix, kind, label, voice, text) = item
    body = {"contents": [{"parts": [{"text": text}]}], "generationConfig": {"responseModalities": ["AUDIO"],
            "speechConfig": {"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": voice}}}}}
    for attempt in range(3):
        try:
            req = urllib.request.Request(f"https://generativelanguage.googleapis.com/v1beta/models/{args.model}:generateContent",
                                         data=json.dumps(body).encode(), headers={"Content-Type": "application/json", "x-goog-api-key": KEY})
            part = json.load(urllib.request.urlopen(req, timeout=60, context=CTX))["candidates"][0]["content"]["parts"][0]["inlineData"]
            raw = base64.b64decode(part["data"])
            if "wav" in part.get("mimeType", ""):
                pcm, rate = sf.read(io.BytesIO(raw), dtype="float32"); pcm = pcm.mean(axis=1) if pcm.ndim > 1 else pcm
            else:  # raw 16-bit PCM, e.g. "audio/L16;rate=24000"
                pcm = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
                rate = int(part.get("mimeType", "rate=24000").split("rate=")[-1].split(";")[0] or 24000)
            sub = kind if label else "neg"; rel = f"raw/{sub}/{prefix}_{i:04d}.wav"; (d / "raw" / sub).mkdir(parents=True, exist_ok=True)
            sf.write(d / rel, resample_poly(pcm, 16000, rate) if rate != 16000 else pcm, 16000, subtype="PCM_16")
            return {"file": rel, "label": label, "kind": kind, "source": "gemini", "voice": voice, "text": text}
        except Exception as e:  # noqa: BLE001 — retry transient API errors
            err = type(e).__name__; time.sleep(1 + 2 * attempt)
    print(f"failed: {voice} {text!r} ({err})", file=sys.stderr); return None

with ThreadPoolExecutor(16) as ex: rows = [r for r in ex.map(tts, enumerate(jobs)) if r]
append_manifest(d, rows)
print(f"{len(rows)}/{len(jobs)} Gemini clips", file=sys.stderr)
