"""Augment every clip and compute openWakeWord features EXACTLY like the browser does
(apps/extension/utils/voice/wakeword.ts, streaming): 80 ms frames (1280 samples, int16 scale) + 480 samples context
→ melspectrogram.onnx → x/10+2 → last 76 mel frames → embedding_model.onnx → 96-d per frame → windows of 16.
Labels per window: positive if the window ends 80–480 ms after the wake word ended; negative everywhere in negative
clips and before the wake word in positive clips; everything else is left out (partial words, long tails).
Usage: python features.py [--data DIR]  → DIR/features.npz"""
import argparse, os, sys
from multiprocessing import Pool
import numpy as np, soundfile as sf
from scipy.signal import butter, fftconvolve, resample_poly, sosfilt
from common import HERE, REPO, data_dir, read_manifest
from phrases import GEMINI_VOICES, MACOS_NOVELTY, VAL_GEMINI, VAL_MACOS_ALL, VAL_MACOS_REAL

FRAME, CTX, SR = 1280, 480, 16000
MODELS = REPO / "node_modules/openwakeword-wasm-browser/models"  # the same ONNX files the extension bundles
mel = emb = None

def init():
    global mel, emb
    import onnxruntime as ort
    so = ort.SessionOptions(); so.intra_op_num_threads = 1; so.inter_op_num_threads = 1
    mel = ort.InferenceSession(str(MODELS / "melspectrogram.onnx"), so); emb = ort.InferenceSession(str(MODELS / "embedding_model.onnx"), so)

def stream_embeddings(audio: np.ndarray) -> np.ndarray:
    """(n_frames, 96): mirrors WakeWordDetector.detectFrame (mel buffer starts as ones, 480-sample context)."""
    tail = np.zeros(0, np.float32); melbuf = [np.ones(32, np.float32)] * 76; wins = []
    for k in range(len(audio) // FRAME):
        x = np.concatenate([tail, np.clip(audio[k * FRAME:(k + 1) * FRAME], -1, 1) * 32767]).astype(np.float32)
        tail = x[-CTX:]
        melbuf = (melbuf + list(mel.run(None, {"input": x[None]})[0].reshape(-1, 32) / 10 + 2))[-76:]
        wins.append(np.stack(melbuf))
    return emb.run(None, {"input_1": np.stack(wins)[..., None].astype(np.float32)})[0].reshape(-1, 96)

def windows(E: np.ndarray) -> np.ndarray:
    """Browser scores from the 16th frame on, with the last 16 embeddings → E[k-15:k+1]."""
    return np.stack([E[k - 15:k + 1] for k in range(15, len(E))]) if len(E) >= 16 else np.zeros((0, 16, 96), np.float32)

def load(path) -> np.ndarray:
    a, sr = sf.read(path, dtype="float32")
    a = a.mean(axis=1) if a.ndim > 1 else a
    return resample_poly(a, SR, sr).astype(np.float32) if sr != SR else a

def trim(a: np.ndarray) -> np.ndarray:
    if not len(a) or np.abs(a).max() < 1e-4: return a
    idx = np.where(np.abs(a) > 0.03 * np.abs(a).max())[0]
    return a[max(0, idx[0] - 160): idx[-1] + 160]

def noise(n, kind, rng):
    w = rng.standard_normal(n)
    if kind == "pink":
        f = np.fft.rfft(w); f /= np.sqrt(np.arange(1, len(f) + 1)); w = np.fft.irfft(f, n)
    elif kind == "brown":
        w = np.cumsum(w); w -= np.convolve(w, np.ones(800) / 800, "same")
    return (w / (np.std(w) + 1e-9)).astype(np.float32)

def augment(utt, rng, babble):
    """Speed ±15 %, 40 % room reverb, 40 % band-limit (headset/laptop mic), level 0.05–0.9, 1.4–2.4 s lead-in,
    background: near silence / white / pink / brown noise (5–30 dB SNR) or babble from other clips (12–25 dB)."""
    utt = resample_poly(utt, 100, int(round(100 * rng.uniform(0.85, 1.15)))).astype(np.float32)
    if rng.random() < 0.4:
        t = np.arange(int(SR * rng.uniform(0.15, 0.5))) / SR
        h = rng.standard_normal(len(t)) * np.exp(-6.9 * t / rng.uniform(0.1, 0.5)) * rng.uniform(0.05, 0.3); h[0] = 1
        utt = fftconvolve(utt, h)[: len(utt) + len(t) // 2].astype(np.float32)
    if rng.random() < 0.4:
        utt = sosfilt(butter(2, [rng.uniform(80, 300), rng.uniform(3400, 7500)], "bandpass", fs=SR, output="sos"), utt).astype(np.float32)
    utt = utt / (np.abs(utt).max() + 1e-9) * np.exp(rng.uniform(np.log(0.05), np.log(0.9)))
    pre, post = int(SR * rng.uniform(1.4, 2.4)), int(SR * rng.uniform(0.6, 1.0))
    n = pre + len(utt) + post; n += (-n) % FRAME
    out = np.zeros(n, np.float32); out[pre:pre + len(utt)] += utt
    rms = np.sqrt(np.mean(utt ** 2)) + 1e-9
    kind = rng.choice(["quiet", "white", "pink", "brown", "babble"], p=[0.25, 0.15, 0.25, 0.1, 0.25])
    if kind == "quiet": bg = noise(n, "white", rng) * rng.uniform(1e-4, 2e-3)
    elif kind == "babble" and babble:
        b = babble[rng.integers(len(babble))]; b = np.tile(b, n // max(1, len(b)) + 1)[:n]
        bg = b / (np.sqrt(np.mean(b ** 2)) + 1e-9) * rms * 10 ** (-rng.uniform(12, 25) / 20)
    else: bg = noise(n, "pink" if kind == "babble" else kind, rng) * rms * 10 ** (-rng.uniform(5, 30) / 20)
    return np.clip(out + bg, -1, 1), pre, pre + len(utt)

def job(args):
    path, label, variants, seed, babble_paths, split = args
    rng = np.random.default_rng(seed)
    babble = [trim(load(p)) for p in babble_paths]
    utt = trim(load(path)) if path else np.full(int(SR * rng.uniform(0.5, 2)), 1e-6, np.float32)  # noise-only clip
    if label == 1 and len(utt) > 2.0 * SR: return None  # TTS added extra speech
    if not len(utt) or np.abs(utt).max() == 0: utt = np.full(SR, 1e-6, np.float32)  # empty synthesis → background only
    X, y = [], []
    for _ in range(variants):
        audio, s, e = augment(utt, rng, babble)
        W = windows(stream_embeddings(audio))
        ends = (np.arange(len(W)) + 16) * FRAME  # sample index right after the newest frame of each window
        if label == 1:
            pos = (ends >= e + 0.08 * SR) & (ends <= e + 0.48 * SR); neg = ends <= s
            X += [W[pos], W[neg]]; y += [np.ones(pos.sum()), np.zeros(neg.sum())]
        else:
            X.append(W); y.append(np.zeros(len(W)))
    return np.concatenate(X).astype(np.float16), np.concatenate(y).astype(np.int8), split

def val_voices(rows):
    macos = sorted({r["voice"] for r in rows if r["source"] == "macos"})
    real = [v for v in macos if v not in MACOS_NOVELTY]
    return set(GEMINI_VOICES[-VAL_GEMINI:]) | set(real[-VAL_MACOS_REAL:]) | set(macos[-VAL_MACOS_ALL:])

if __name__ == "__main__":
    ap = argparse.ArgumentParser(); ap.add_argument("--data"); args = ap.parse_args()
    d = data_dir(args.data); rows = read_manifest(d); val = val_voices(rows)
    neg_files = [str(d / r["file"]) for r in rows if r["label"] == "0"]
    rng = np.random.default_rng(0); jobs = []; dropped = 0
    for i, r in enumerate(rows):
        label, text, split = int(r["label"]), r["text"], "val" if r["voice"] in val else "train"
        if "Vallo" in text or (label == 1 and "..." in text): dropped += 1; continue  # sounds like the wake word / pause too long
        hard = r["kind"] in ("adversarial", "hard") or "Valo" in text or "dad" in text.lower()
        variants = 10 if label == 1 else 8 if hard else 3
        jobs.append((str(d / r["file"]), label, variants, 1000 + i, list(rng.choice(neg_files, 2)), split))
    jobs += [(None, 0, 2, 9000 + i, list(rng.choice(neg_files, 2)), "val" if i % 7 == 0 else "train") for i in range(250)]
    print(f"{len(rows)} clips in manifest, {dropped} left out, {len(jobs)} jobs, val voices: {len(val)}", file=sys.stderr)
    with Pool(os.cpu_count(), initializer=init) as pool: res = [r for r in pool.imap_unordered(job, jobs, chunksize=4) if r]
    out = {}
    for split in ("train", "val"):
        part = [r for r in res if r[2] == split]
        out[f"X_{split}"] = np.concatenate([r[0] for r in part]); out[f"y_{split}"] = np.concatenate([r[1] for r in part])
        print(f"{split}: {len(out[f'y_{split}'])} windows, {int(out[f'y_{split}'].sum())} positive", file=sys.stderr)
    np.savez(d / "features.npz", **out)
