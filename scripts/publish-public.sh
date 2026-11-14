#!/usr/bin/env bash
# Publish a scrubbed copy of origin/main (incl. history) to a public repo. See docs/publish-public.md.
#   ./scripts/publish-public.sh --dry-run                  clone + scrub + check, no push
#   ./scripts/publish-public.sh git@github.com:org/repo.git   … and force-push to its main
set -euo pipefail

DRY=0; URL=""
for a in "$@"; do case "$a" in --dry-run) DRY=1 ;; *) URL="$a" ;; esac; done
[[ $DRY == 1 || -n $URL ]] || { echo "usage: $0 [--dry-run] <public-repo-url>"; exit 2; }

ROOT=$(cd "$(dirname "$0")/.." && pwd)
SCRUB="$ROOT/infra/public-scrub.txt"
SRC=$(git -C "$ROOT" remote get-url origin)
case "$URL" in *luca-3/agentic-hack*) echo "refusing: $URL is the private repo"; exit 2 ;; esac

command -v git-filter-repo >/dev/null || brew install git-filter-repo ||
  { echo "git-filter-repo missing and brew install failed – install it manually"; exit 1; }

WORK=$(mktemp -d "${TMPDIR:-/tmp}/valo-public.XXXXXX")
echo "→ fresh clone of $SRC (main) into $WORK"
git clone -q --single-branch --branch main --no-local "$SRC" "$WORK/repo"
cd "$WORK/repo"

# The knowledge file goes completely; script + scrub list + guide name the scrubbed terms, so they stay private too.
git filter-repo --force \
  --invert-paths --path knowledge/corpus-funktionen.md \
  --path scripts/publish-public.sh --path infra/public-scrub.txt --path docs/publish-public.md \
  --replace-text "$SCRUB" --replace-message "$SCRUB"

echo "→ checking history (blocklist + secrets)"
git log -p --all --format='commit %H%n%B' | python3 -I -c '
import base64, json, re, sys
BLOCK = ["wochenzettel", "stempeluhr", "bautagebuch", "kreis unten rechts", "abgabeschluss", "/keys",
         "/wochenzettel", "/notes'"'"'", "corpus-chat", "schlüssel finden", "schlüssel ausgeben", "corpus-funktionen"]
ALLOW_CTX = ["token/keys"]                     # apps/extension/README.md: "no token/keys/screenshots"
CRM = re.compile(r"^(demo-crm/|.*kundenwerk[^/]*$)")   # Kundenwerk CRM files may contain anything
SECRET = re.compile(r"AIza[0-9A-Za-z_-]{30,}|sb_secret_[A-Za-z0-9_-]{10,}|PRIVATE KEY|ghp_[A-Za-z0-9]{30,}|AKIA[0-9A-Z]{16}|eyJhbGci[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+")
def demo_jwt(tok):                              # known local Supabase CLI demo keys: iss = "supabase-demo"
    try:
        p = tok.split(".")[1]; p += "=" * (-len(p) % 4)
        return json.loads(base64.urlsafe_b64decode(p)).get("iss") == "supabase-demo"
    except Exception:
        return False
hits, path, commit = [], "(message)", ""
for line in sys.stdin:
    if line.startswith("commit "): commit, path = line[7:15], "(message)"; continue
    m = re.match(r"diff --git a/(.*) b/", line)
    if m: path = m.group(1); continue
    low = line.lower()
    for c in ALLOW_CTX: low = low.replace(c, "")
    if not CRM.match(path):
        hits += [f"{commit} {path}: [{t}] {line.strip()[:160]}" for t in BLOCK if t in low]
    for s in SECRET.findall(line):
        if not (s.startswith("eyJ") and demo_jwt(s)): hits.append(f"{commit} {path}: [secret] {s[:12]}…")
if hits:
    print("TREFFER:"); print("\n".join(sorted(set(hits)))); sys.exit(1)
print("sauber")
'

echo "→ tree: $(git ls-files | wc -l | tr -d " ") files, $(git rev-list --count HEAD) commits (authors + dates kept)"
if [[ $DRY == 1 ]]; then echo "dry run – not pushed. Clean copy: $WORK/repo"; exit 0; fi
git push --force "$URL" HEAD:main
echo "pushed to $URL (main)"
