"""Synthesize clips with the local macOS voices (`say`, 16 kHz WAV): positives with 33 real en/de voices at 3 speaking
rates, negatives (near misses + office sentences) with all 52 en/de voices. Usage: python generate_macos.py [--data DIR]"""
import argparse, random, re, subprocess, sys
from concurrent.futures import ThreadPoolExecutor
from common import append_manifest, data_dir
from phrases import ADVERSARIAL, MACOS_NOVELTY, POSITIVE, SENTENCES

ap = argparse.ArgumentParser(); ap.add_argument("--data"); args = ap.parse_args()
d = data_dir(args.data); random.seed(1)
voices = sorted({m.group(1).strip() for line in subprocess.run(["say", "-v", "?"], capture_output=True, text=True).stdout.splitlines()
                 if (m := re.match(r"^(.+?)\s+([a-z]{2}_[A-Z]{2})\s+#", line)) and m.group(2)[:2] in ("en", "de")})
real = [v for v in voices if v not in MACOS_NOVELTY]
jobs = []  # (kind, label, voice, rate, text)
for kw, texts in POSITIVE.items():
    for v in real:
        for rate in (150, 185, 220): jobs.append((f"pos_{kw}", 1, v, rate, random.choice(texts)))
for v in voices:
    for t in random.sample(ADVERSARIAL, 6): jobs.append(("adversarial", 0, v, random.choice((160, 190, 220)), t))
    for t in random.sample(SENTENCES, 6): jobs.append(("sentence", 0, v, random.choice((160, 190, 220)), t))

def run(item):
    i, (kind, label, v, rate, text) = item
    sub = kind if label else "neg"
    rel = f"raw/{sub}/say_{i:04d}.wav"; (d / "raw" / sub).mkdir(parents=True, exist_ok=True)
    subprocess.run(["say", "-v", v, "-r", str(rate), "-o", str(d / rel), "--file-format=WAVE", "--data-format=LEI16@16000", text], capture_output=True)
    return {"file": rel, "label": label, "kind": kind, "source": "macos", "voice": v, "text": text}

with ThreadPoolExecutor(8) as ex: rows = list(ex.map(run, enumerate(jobs)))
append_manifest(d, rows)
print(f"{len(rows)} macOS clips ({len(real)} real voices, {len(voices)} total)", file=sys.stderr)
