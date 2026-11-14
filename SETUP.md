# Team setup

Goal: from zero to running apps in **~15 minutes**. If anything fails, run `npm run doctor` — it tells you what is wrong and how to fix it.

## TL;DR

```bash
git clone https://github.com/luca-3/agentic-hack.git && cd agentic-hack
npm install           # all workspaces (apps/*, packages/*)
npm run db:start      # local Supabase in Docker (first run downloads ~2 GB of images)
npm run db:env        # writes the root .env.local with the local Supabase keys
# open .env.local and paste the Gemini key after GEMINI_API_KEY=
npm run doctor        # everything should be ✓
npm run dev:server    # http://localhost:3001 (+ /chat playground)
npm run dev:dashboard # http://localhost:3000
npm run dev:extension # opens Chrome with the extension loaded
npm run demo:crm      # http://localhost:4000 — page to try the extension on
```

Start only the app(s) you work on; each runs on its own.

## 1. Prerequisites

| Tool | Version | macOS | Windows | Linux |
| --- | --- | --- | --- | --- |
| Node.js | 22+ | `brew install node` | [nodejs.org](https://nodejs.org) | nvm / distro package |
| Docker | any recent | Docker Desktop, OrbStack or Colima | Docker Desktop (WSL 2 backend) | Docker Engine |
| Supabase CLI | 2.x | `brew install supabase/tap/supabase` | `scoop install supabase` | [install guide](https://supabase.com/docs/guides/local-development/cli/getting-started) |
| Python 3 | any | preinstalled | python.org | distro package |
| Chrome / Chromium | recent | – | – | – |
| Git + GitHub access | – | – | – | – |

Python is only used by `npm run demo:crm` (`python3 -m http.server`).

**Docker needs ≥ 4 GiB memory** (more if you run other Supabase projects at the same time).
Docker Desktop: *Settings → Resources*. Colima: `colima stop && colima start --memory 6`.

> Tip: download the Docker images **before** the event (`npm run db:start` once at home) — venue Wi-Fi is slow.

## 2. Access

- **Repo:** it's private. The owner adds you with
  `gh api -X PUT repos/luca-3/agentic-hack/collaborators/<your-github-username> -f permission=push`
  → accept the invite email / GitHub notification.
- **Gemini API key:** get the team key from the owner via a private message (never post it in public channels, never commit it). Alternatively create your own at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — hackathon credits are handed out at the event.

## 3. First run (step by step)

1. `npm install` (repo root — installs all workspaces; the extension runs `wxt prepare` on postinstall)
2. `npm run db:start` — starts Postgres, Auth, REST, Realtime, Storage and Studio in Docker on ports **573xx**.
   First run applies all migrations in `supabase/migrations/` and the seed data in `supabase/seed.sql`.
3. `npm run db:env` — writes the Supabase URL and keys into the **root** `.env.local` (shared by all apps). Safe to re-run; it keeps your other variables.
4. Paste the Gemini key into `.env.local` → `GEMINI_API_KEY=AIza...`
5. `npm run doctor` — all lines should show ✓.
6. `npm run ai:check` — makes 3 tiny Gemini calls (costs < 1 cent).
7. Start what you work on:

| Area | Command | Check |
| --- | --- | --- |
| Server | `npm run dev:server` | <http://localhost:3001> shows a green dot; <http://localhost:3001/chat> is the playground |
| Dashboard | `npm run dev:dashboard` | <http://localhost:3000> shows the placeholder cards |
| Extension | `npm run dev:extension` (needs the server running) | Chrome opens with "Lotse (dev)"; open the side panel via the toolbar icon |
| Demo target | `npm run demo:crm` | <http://localhost:4000> — ask the extension a question here |

Useful URLs: Supabase Studio <http://127.0.0.1:57323> · Mailpit (auth emails) <http://127.0.0.1:57324>

### Loading the extension

- **Dev (hot reload):** `npm run dev:extension` — WXT (port 3002) opens a Chrome with the extension loaded.
- **Manual:** `npm run build -w @lotse/extension` → chrome://extensions → *Developer mode* → *Load unpacked* → `apps/extension/.output/chrome-mv3`. After a rebuild click *Reload* on the extension card.
- Branded Chrome ≥ 137 ignores `--load-extension`; for Playwright / automated tests use Chromium or Chrome for Testing.
- The extension only runs on `http://localhost/*` and `http://127.0.0.1/*` (dev `host_permissions`).

## 4. Daily workflow

After `git pull`:

| What changed | Run |
| --- | --- |
| `package-lock.json` or any `package.json` | `npm install` (repo root) |
| new file in `supabase/migrations/` | `npx supabase migration up` (keeps your data) or `npm run db:reset` (fresh DB + seed) |
| `.env.example` | compare with your root `.env.local`, add the new variables |
| `packages/shared` | nothing — apps import it as TS source; restart the dev server if types look stale |
| `apps/extension` (when not in dev mode) | rebuild + *Reload* in chrome://extensions |

Restart `dev:server` / `dev:dashboard` after editing `.env.local` — env vars are only read at startup.

Before pushing: `npm run typecheck && npm run lint` (runs across all workspaces).

## 5. Working together

- **Areas and owners:** extension dev → `apps/extension`; server dev → `apps/server` (all Gemini calls, event/hint tables); dashboard colleague → `apps/dashboard` (org creation, onboarding of organizations, central knowledge base, user management; migrations for orgs/members/apps/app_features/knowledge). Don't edit another area's folder without telling its owner. Details: [AGENTS.md](AGENTS.md).
- **Shared contract:** API shapes live in `packages/shared` (zod). Change them there first, in a small PR, and tell the others.
- **Branches:** short-lived branches (`feat/<area>-<thing>`), merge to `main` often (every 1–2 h). Pull before you start something new.
- **Database changes:** always via a migration — `npm run db:migration <name>`, write SQL, `npx supabase migration up`, commit the file, then `npm run db:types`. Never edit a migration that is already on `main`; add a new one. Changing tables in Studio does **not** end up in git.
- **Secrets:** `.env.local` (repo root) is git-ignored. Only `.env.example` (no real values) is committed. No secrets in the extension.
- **Coding agents** (Claude Code, Cursor, Codex, Copilot …): they read [`AGENTS.md`](AGENTS.md) — keep it up to date when you change conventions.

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Bind for 0.0.0.0:573xx failed: port is already allocated` | Another Supabase project uses the ports. Stop it with `supabase stop --project-id <name>` (keeps its data), or change the `port =` values in `supabase/config.toml` locally. |
| `container is not ready` / `unhealthy` during `db:start` | Docker is out of memory. Stop other Supabase projects or give Docker more memory, then `npm run db:start` again. Emergency: `npx supabase start -x storage-api,imgproxy,edge-runtime`. |
| Server status page shows *Supabase not reachable* | `npm run db:start`, then `npm run db:env`, then restart `npm run dev:server`. |
| App can't see env vars | `.env.local` must be in the **repo root**, not in `apps/*`. Restart the dev server. |
| `relation "public.notes" does not exist` | Migrations not applied: `npm run db:reset`. |
| Gemini `HTTP 402 RESOURCE_EXHAUSTED … prepayment credits are depleted` | Key works but the Google project has no credit. Top up in [AI Studio](https://ai.studio/projects) or use another key. |
| Gemini `HTTP 429` | Rate limit — wait a minute, or switch to `MODELS.fast` / a lite model in `apps/server/src/lib/ai/google.ts`. |
| Gemini `HTTP 400/403 API key not valid` | Typo or quotes around the key in `.env.local`; it must look like `GEMINI_API_KEY=AIza...`. |
| Extension not active on a page / no highlight | Reload the page after (re)loading the extension (content scripts only attach on page load). Only `localhost` / `127.0.0.1` pages are allowed — use `npm run demo:crm`. |
| Extension answers with a network error | Server not running: `npm run dev:server` (port 3001). |
| `dev:extension` fails: port 3002 in use | Another WXT instance is running — stop it. Ports 3000/3001 are reserved for dashboard/server. |
| Chrome opened by WXT has no extension / `--load-extension` ignored | Branded Chrome ≥ 137 ignores it — load `apps/extension/.output/chrome-mv3` via *Load unpacked*, or use Chromium / Chrome for Testing. |
| `next dev` modified `AGENTS.md` | Expected — Next.js manages the block between `BEGIN/END:nextjs-agent-rules`. Commit it. |
| Port 3000 / 3001 in use | Free it (auth redirects are configured for the dashboard on 3000; the extension expects the server on 3001). |
