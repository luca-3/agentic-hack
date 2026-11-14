"""Shared helpers: data dir, manifest, Gemini key (never printed)."""
import csv, os
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[1]
FIELDS = ["file", "label", "kind", "source", "voice", "text"]  # label 1 = wake word; kind: pos_valo|pos_daddy|adversarial|sentence|hard


def data_dir(arg: str | None = None) -> Path:
    d = Path(arg or os.environ.get("WAKEWORD_DATA") or HERE / "data")
    (d / "raw").mkdir(parents=True, exist_ok=True)
    return d


def append_manifest(d: Path, rows: list[dict]) -> None:
    path = d / "manifest.csv"
    new = not path.exists()
    with path.open("a", newline="", encoding="utf-8") as f:
        w = csv.DictWriter(f, fieldnames=FIELDS)
        if new: w.writeheader()
        w.writerows(rows)


def read_manifest(d: Path) -> list[dict]:
    with (d / "manifest.csv").open(encoding="utf-8") as f: return list(csv.DictReader(f))


def gemini_key() -> str:
    """GEMINI_API_KEY from the environment or the repo-root .env.local (same key as apps/server). Never logged."""
    if os.environ.get("GEMINI_API_KEY"): return os.environ["GEMINI_API_KEY"]
    for line in (REPO / ".env.local").read_text().splitlines():
        if line.startswith("GEMINI_API_KEY="): return line.split("=", 1)[1].strip().strip('"')
    raise SystemExit("GEMINI_API_KEY missing (env or .env.local)")
