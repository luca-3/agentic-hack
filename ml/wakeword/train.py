"""Train the keyword head: (16 × 96 embeddings) → MLP 1536-64-64-1 (LayerNorm, ReLU, dropout) → sigmoid.
Negatives weigh 2× overall (false triggers are worse than a repeated "Hey Valo"). Same input/output shape as
openWakeWord's own heads, so the browser runs it like hey_jarvis_v0.1.onnx.
  python train.py            → train on the train split, report held-out window metrics, export DATA/eval.onnx
  python train.py --final    → same recipe on all data, export results/hey_valo_daddy_v1.onnx
  python train.py --final --ship  → also copy it into apps/extension/public/wakeword/"""
import argparse, json, shutil, sys, warnings
import numpy as np, torch, torch.nn as nn
from common import HERE, REPO, data_dir

warnings.filterwarnings("ignore"); torch.manual_seed(0)
ap = argparse.ArgumentParser(); ap.add_argument("--data"); ap.add_argument("--final", action="store_true"); ap.add_argument("--ship", action="store_true")
args = ap.parse_args(); d = data_dir(args.data); f = np.load(d / "features.npz")
X, y = f["X_train"], f["y_train"]
if args.final: X, y = np.concatenate([X, f["X_val"]]), np.concatenate([y, f["y_val"]])
X, y = torch.from_numpy(X), torch.from_numpy(y).float()

model = nn.Sequential(nn.Flatten(), nn.Linear(1536, 64), nn.LayerNorm(64), nn.ReLU(), nn.Dropout(0.2),
                      nn.Linear(64, 64), nn.LayerNorm(64), nn.ReLU(), nn.Linear(64, 1), nn.Sigmoid())
EPOCHS, BATCH = 14, 1024
opt = torch.optim.AdamW(model.parameters(), 1e-3, weight_decay=1e-3)
sched = torch.optim.lr_scheduler.OneCycleLR(opt, 2e-3, total_steps=EPOCHS * (len(y) // BATCH + 1))
npos = float(y.sum()); w_neg = 2.0 * npos / (len(y) - npos)
for ep in range(EPOCHS):
    model.train(); perm = torch.randperm(len(y)); total = 0.0
    for b in range(0, len(y), BATCH):
        idx = perm[b:b + BATCH]; xb = X[idx].float(); yb = y[idx]
        xb = xb + 0.05 * torch.randn_like(xb) * xb.std()
        p = model(xb).squeeze(1).clamp(1e-6, 1 - 1e-6)
        loss = -(yb * torch.log(p) + w_neg * (1 - yb) * torch.log(1 - p)).mean()
        opt.zero_grad(); loss.backward(); opt.step(); sched.step(); total += loss.item()
    print(f"epoch {ep + 1}/{EPOCHS} loss {total:.1f}", file=sys.stderr)
model.eval()

metrics = {"params": sum(p.numel() for p in model.parameters()), "train_windows": len(y), "train_positive_windows": int(npos)}
if not args.final:
    with torch.no_grad():
        Xv = torch.from_numpy(f["X_val"]).float(); yv = f["y_val"]
        sv = torch.cat([model(Xv[i:i + 4096]).squeeze(1) for i in range(0, len(Xv), 4096)]).numpy()
    hours = float((yv == 0).sum() * 0.08 / 3600)
    metrics["heldout_windows"] = {str(t): {"recall": round(float((sv[yv == 1] >= t).mean()), 3), "false_windows": int((sv[yv == 0] >= t).sum()),
                                           "negative_hours": round(hours, 2)} for t in (0.5, 0.7, 0.9)}
    for t, m in metrics["heldout_windows"].items(): print(f"threshold {t}: window recall {m['recall']} · {m['false_windows']} false windows in {m['negative_hours']} h", file=sys.stderr)

out = HERE / "results/hey_valo_daddy_v1.onnx" if args.final else d / "eval.onnx"
out.parent.mkdir(exist_ok=True)
torch.onnx.export(model, torch.zeros(1, 16, 96), str(out), input_names=["input"], output_names=["output"], dynamo=False, opset_version=13)
(HERE / "results" / ("train_final.json" if args.final else "train_eval.json")).write_text(json.dumps(metrics, indent=2) + "\n")
if args.ship: shutil.copy(out, REPO / "apps/extension/public/wakeword/hey_valo_daddy_v1.onnx")
print(f"exported {out.name}" + (" + shipped to the extension" if args.ship else ""), file=sys.stderr)
