"""Clip-level evaluation on held-out voices + the score timeline chart for the README.
  python evaluate.py              → results/eval.md, results/eval.json (uses DATA/eval.onnx, held-out voices only)
  python evaluate.py --chart      → docs/img/wakeword-scores.png (shipped model vs. pre-trained hey_jarvis on samples/timeline)"""
import argparse, json, sys
import numpy as np, onnxruntime as ort
from common import HERE, REPO, data_dir, read_manifest
from features import FRAME, MODELS, SR, init, load, stream_embeddings, trim, val_voices, windows
import features

THRESHOLD = 0.7
ap = argparse.ArgumentParser(); ap.add_argument("--data"); ap.add_argument("--chart", action="store_true"); args = ap.parse_args()
init()

def scores(head: ort.InferenceSession, audio: np.ndarray) -> np.ndarray:
    audio = audio[: len(audio) - len(audio) % FRAME]
    W = windows(stream_embeddings(audio)); name = head.get_inputs()[0].name
    return np.array([float(head.run(None, {name: w[None].astype(np.float32)})[0][0][0]) for w in W])

def padded(path):
    return np.concatenate([np.zeros(int(1.5 * SR), np.float32), load(path), np.zeros(SR, np.float32)])

if not args.chart:
    d = data_dir(args.data); rows = read_manifest(d); val = val_voices(rows)
    head = ort.InferenceSession(str(d / "eval.onnx"))
    # Same scope as training: no "Vallo" (sounds like the wake word), no long-pause "Hey... Valo" positives.
    test = [r for r in rows if r["voice"] in val and "Vallo" not in r["text"] and not (r["label"] == "1" and "..." in r["text"])]
    res = [(r, float(scores(head, padded(d / r["file"])).max())) for r in test]
    pos = [(r, s) for r, s in res if r["label"] == "1"]; neg = [(r, s) for r, s in res if r["label"] == "0"]
    out = {"threshold": THRESHOLD, "heldout_voices": sorted(val),
           "positives": {"clips": len(pos), "detected": sum(s >= THRESHOLD for _, s in pos)},
           "negatives": {"clips": len(neg), "false_triggers": sum(s >= THRESHOLD for _, s in neg)}}
    by_kind = {}
    for r, s in neg: k = by_kind.setdefault(r["kind"], [0, 0]); k[0] += 1; k[1] += s >= THRESHOLD
    out["negatives"]["by_kind"] = {k: {"clips": a, "false_triggers": b} for k, (a, b) in by_kind.items()}
    (HERE / "results/eval.json").write_text(json.dumps(out, indent=2, ensure_ascii=False) + "\n")
    lines = [f"# Held-out evaluation (threshold {THRESHOLD})", "",
             f"Voices never seen by the eval model: {len(val)} ({', '.join(sorted(val))}).", "",
             "| Set | Clips | Fired | Rate |", "| --- | --- | --- | --- |",
             f"| Positives (“Hey Valo” / “Hey Daddy”) | {len(pos)} | {out['positives']['detected']} | {out['positives']['detected'] / max(1, len(pos)):.1%} |"]
    for k, v in sorted(out["negatives"]["by_kind"].items()):
        lines.append(f"| Negatives: {k} | {v['clips']} | {v['false_triggers']} | {v['false_triggers'] / max(1, v['clips']):.1%} |")
    lines += ["", "Negatives that fired (text as synthesized):", ""]
    lines += [f"- {s:.2f} · {r['voice']} · “{r['text']}”" for r, s in sorted(neg, key=lambda x: -x[1]) if s >= THRESHOLD] or ["- none"]
    lines += ["", "Positives that were missed:", ""]
    lines += [f"- {s:.2f} · {r['voice']} · “{r['text']}”" for r, s in sorted(pos, key=lambda x: x[1]) if s < THRESHOLD] or ["- none"]
    (HERE / "results/eval.md").write_text("\n".join(lines) + "\n")
    print("\n".join(lines[:12]), file=sys.stderr)
    sys.exit(0)

# ── Chart: one continuous stream of speech, both heads, 80 ms resolution ─────────────────────────────────────────
import matplotlib; matplotlib.use("Agg"); import matplotlib.pyplot as plt
heads = {"ours": ort.InferenceSession(str(HERE / "results/hey_valo_daddy_v1.onnx")), "jarvis": ort.InferenceSession(str(MODELS / "hey_jarvis_v0.1.onnx"))}
LABELS = ["“Today we show you Valo.”", "“Valo helps your team …”", "“Hey Valo, where do I change the IBAN?”", "“Hey Jarvis!”", "“Hey Daddy, show me the payment terms.”"]
rng = np.random.default_rng(3); parts, spans, t = [np.zeros(int(1.6 * SR), np.float32)], [], 1.6
for i in range(5):
    a = trim(load(HERE / f"samples/timeline/seg_{i}.wav")); a = a / np.abs(a).max() * 0.6
    spans.append((t, t + len(a) / SR)); parts += [a, np.zeros(int(0.9 * SR), np.float32)]; t += len(a) / SR + 0.9
audio = np.concatenate(parts) + rng.standard_normal(sum(map(len, parts))).astype(np.float32) * 0.002
audio = audio[: len(audio) - len(audio) % FRAME]
sc = {k: scores(h, audio) for k, h in heads.items()}; times = (np.arange(len(sc["ours"])) + 16) * FRAME / SR

BG, INK, INK2, GRID, DASH, BLUE, ORANGE = "#fcfcfb", "#0b0b0b", "#52514e", "#e6e5e0", "#c9c8c2", "#2a78d6", "#eb6834"
plt.rcParams.update({"font.family": "DejaVu Sans", "font.size": 10, "axes.edgecolor": GRID, "axes.labelcolor": INK2, "xtick.color": INK2, "ytick.color": INK2})
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(12.5, 5.4), sharex=True, gridspec_kw={"height_ratios": [1.45, 2.1], "hspace": 0.06}, facecolor=BG)
for ax in (ax1, ax2):
    ax.set_facecolor(BG); [ax.spines[s].set_visible(False) for s in ("top", "right")]
tt = np.arange(len(audio)) / SR
ax1.plot(tt[::8], audio[::8], color="#9b9a95", lw=0.5); ax1.set_yticks([]); ax1.spines["left"].set_visible(False); ax1.set_ylim(-0.75, 2.25)
for i, ((s, e), lab) in enumerate(zip(spans, LABELS)):
    c = (s + e) / 2; y = 1.85 if i % 2 == 0 else 1.15  # alternate rows → no overlapping labels
    ax1.annotate(lab, xy=(c, 0.7), xytext=(c + {2: -0.5, 4: 0.4}.get(i, 0), y), ha="center", va="bottom", fontsize=8.5, color=INK,
                 arrowprops=dict(arrowstyle="-|>", color=INK2, lw=0.8, shrinkA=1, shrinkB=0, mutation_scale=8))
    for x in (s, e):
        ax1.vlines(x, -0.75, 0.75, color=DASH, lw=0.8, ls=(0, (3, 3)), zorder=0); ax2.axvline(x, color=DASH, lw=0.8, ls=(0, (3, 3)), zorder=0)
ax1.set_title("Wake word score while someone talks (80 ms frames, runs in the browser)", loc="left", fontsize=11.5, color=INK, pad=4)
ax2.axhline(THRESHOLD, color=INK2, lw=1, ls=(0, (4, 3))); ax2.text(1.4, THRESHOLD + 0.02, f"trigger threshold {THRESHOLD}", ha="left", va="bottom", fontsize=8.5, color=INK2)
ax2.plot(times, sc["ours"], color=BLUE, lw=2, label="Our model: “Hey Valo” / “Hey Daddy” (trained today)")
ax2.plot(times, sc["jarvis"], color=ORANGE, lw=2, label="Pre-trained openWakeWord “Hey Jarvis”")
for k, col in (("ours", BLUE), ("jarvis", ORANGE)):
    last = -9.0
    for x, v in zip(times, sc[k]):
        if v >= THRESHOLD and x - last > 2:
            ax2.plot([x], [v], "o", ms=8, color=col, mec=BG, mew=2, zorder=5); last = x
            ax2.annotate("fires", (x, v), xytext=(6, -14), textcoords="offset points", fontsize=8.5, color=INK)
ax2.set_ylim(-0.03, 1.08); ax2.set_ylabel("score"); ax2.set_xlabel("seconds"); ax2.grid(axis="y", color=GRID, lw=0.8); ax2.set_axisbelow(True)
ax2.legend(loc="upper left", frameon=False, fontsize=8.5, labelcolor=INK); ax2.set_xlim(0, times[-1] + 0.2)
fig.savefig(REPO / "docs/img/wakeword-scores.png", dpi=170, bbox_inches="tight", facecolor=BG)
for (s, e), lab in zip(spans, LABELS):
    m = (times >= s) & (times <= e + 1.0); print(lab, {k: round(float(v[m].max()), 2) for k, v in sc.items()}, file=sys.stderr)
