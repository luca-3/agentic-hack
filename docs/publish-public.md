# Publishing the public copy

The public repo is a **scrubbed copy** of `origin/main` with its whole history: no CORPUS feature details (functions, click paths, routes), neither now nor in old commits. Allowed: Fuller as a customer, the app name CORPUS, `dev.fuller.de`, the demo org "Fuller GmbH (Demo)". The private repo is never rewritten.

```bash
./scripts/publish-public.sh --dry-run                        # clone + scrub + check, no push
./scripts/publish-public.sh git@github.com:<org>/<repo>.git  # same, then force-push to its main
```

What it does:

1. Installs `git-filter-repo` via brew if missing.
2. Clones `origin` `main` fresh into a new temp directory (never touches this checkout).
3. `git filter-repo` drops `knowledge/corpus-funktionen.md` plus the script, the scrub list and this guide (they name the scrubbed terms), and rewrites file contents **and** commit messages with `infra/public-scrub.txt`. Authors and timestamps stay as they are.
4. Checks `git log -p --all` of the copy against a blocklist (CORPUS feature words, routes) and a secret scan (Gemini/Supabase/GitHub/AWS keys, private keys, JWTs other than the local Supabase demo keys). Kundenwerk CRM files (`demo-crm/`, `*kundenwerk*`) are exempt from the blocklist. Any hit → list + abort, nothing is pushed.
5. Without `--dry-run`: `git push --force <url> HEAD:main` (the public copy belongs to us only; refuses the private repo URL).

`infra/public-scrub.txt` format (git filter-repo `--replace-text`): one rule per line, `literal==>replacement` or `regex:…==>…`. **No comments or blank lines** — filter-repo would treat them as literals to replace. Keep rules specific (whole click paths/sentences, routes only in quoted CORPUS seed rows) so Kundenwerk CRM texts stay intact. When a new CORPUS detail lands in a commit, add a rule and run the dry run again.
