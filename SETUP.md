# Team setup

Goal: from zero to a running app in **~15 minutes**. If anything fails, run `npm run doctor` — it tells you what is wrong and how to fix it.

## TL;DR

```bash
git clone https://github.com/luca-3/agentic-hack.git && cd agentic-hack
npm install
npm run db:start      # local Supabase in Docker (first run downloads ~2 GB of images)
npm run db:env        # writes .env.local with the local Supabase keys
# open .env.local and paste the Gemini key after GEMINI_API_KEY=
npm run doctor        # everything should be ✓
npm run dev           # http://localhost:3000 and http://localhost:3000/chat
```

## 1. Prerequisites

| Tool | Version | macOS | Windows | Linux |
| --- | --- | --- | --- | --- |
| Node.js | 22+ | `brew install node` | [nodejs.org](https://nodejs.org) | nvm / distro package |
| Docker | any recent | Docker Desktop, OrbStack or Colima | Docker Desktop (WSL 2 backend) | Docker Engine |
| Supabase CLI | 2.x | `brew install supabase/tap/supabase` | `scoop install supabase` | [install guide](https://supabase.com/docs/guides/local-development/cli/getting-started) |
| Git + GitHub access | – | – | – | – |

**Docker needs ≥ 4 GiB memory** (more if you run other Supabase projects at the same time).
Docker Desktop: *Settings → Resources*. Colima: `colima stop && colima start --memory 6`.

> Tip: download the Docker images **before** the event (`npm run db:start` once at home) — venue Wi-Fi is slow.

## 2. Access

- **Repo:** it's private. The owner adds you with
  `gh api -X PUT repos/luca-3/agentic-hack/collaborators/<your-github-username> -f permission=push`
  → accept the invite email / GitHub notification.
- **Gemini API key:** get the team key from the owner via a private message (never post it in public channels, never commit it). Alternatively create your own at [aistudio.google.com/apikey](https://aistudio.google.com/apikey) — hackathon credits are handed out at the event.

## 3. First run (step by step)

1. `npm install`
2. `npm run db:start` — starts Postgres, Auth, REST, Realtime, Storage and Studio in Docker on ports **573xx**.
   First run applies all migrations in `supabase/migrations/` and the seed data in `supabase/seed.sql`.
3. `npm run db:env` — writes the Supabase URL and keys into `.env.local`. Safe to re-run; it keeps your other variables.
4. Paste the Gemini key into `.env.local` → `GEMINI_API_KEY=AIza...`
5. `npm run doctor` — all lines should show ✓.
6. `npm run ai:check` — makes 3 tiny Gemini calls (costs < 1 cent).
7. `npm run dev` → <http://localhost:3000> shows a green dot, <http://localhost:3000/chat> is the agent chat.

Useful URLs: Supabase Studio <http://127.0.0.1:57323> · Mailpit (auth emails) <http://127.0.0.1:57324>

## 4. Daily workflow

After `git pull`:

| What changed | Run |
| --- | --- |
| `package-lock.json` | `npm install` |
| new file in `supabase/migrations/` | `npx supabase migration up` (keeps your data) or `npm run db:reset` (fresh DB + seed) |
| `.env.example` | compare with your `.env.local`, add the new variables |

Restart `npm run dev` after editing `.env.local` — env vars are only read at startup.

## 5. Working together

- **Branches:** short-lived branches (`feat/<thing>`), merge to `main` often (every 1–2 h). Pull before you start something new.
- **Ownership:** split by folder/feature (e.g. one person on agent tools in `src/lib/ai/`, one on UI in `src/app/`) to avoid merge conflicts.
- **Database changes:** always via a migration — `npm run db:migration <name>`, write SQL, `npx supabase migration up`, commit the file. Never edit a migration that is already on `main`; add a new one. Changing tables in Studio does **not** end up in git.
- **Secrets:** `.env.local` is git-ignored. Only `.env.example` (no real values) is committed.
- **Coding agents** (Claude Code, Cursor, Codex, Copilot …): they read [`AGENTS.md`](AGENTS.md) — keep it up to date when you change conventions.

## 6. Troubleshooting

| Symptom | Fix |
| --- | --- |
| `Bind for 0.0.0.0:573xx failed: port is already allocated` | Another Supabase project uses the ports. Stop it with `supabase stop --project-id <name>` (keeps its data), or change the `port =` values in `supabase/config.toml` locally. |
| `container is not ready` / `unhealthy` during `db:start` | Docker is out of memory. Stop other Supabase projects or give Docker more memory, then `npm run db:start` again. Emergency: `npx supabase start -x storage-api,imgproxy,edge-runtime`. |
| Start page shows *Supabase not reachable* | `npm run db:start`, then `npm run db:env`, then restart `npm run dev`. |
| `relation "public.notes" does not exist` | Migrations not applied: `npm run db:reset`. |
| Gemini `HTTP 402 RESOURCE_EXHAUSTED … prepayment credits are depleted` | Key works but the Google project has no credit. Top up in [AI Studio](https://ai.studio/projects) or use another key. |
| Gemini `HTTP 429` | Rate limit — wait a minute, or switch to `MODELS.fast` / a lite model in `src/lib/ai/google.ts`. |
| Gemini `HTTP 400/403 API key not valid` | Typo or quotes around the key in `.env.local`; it must look like `GEMINI_API_KEY=AIza...`. |
| `next dev` modified `AGENTS.md` | Expected — Next.js manages the block between `BEGIN/END:nextjs-agent-rules`. Commit it. |
| Port 3000 in use | `npm run dev -- -p 3001` (auth redirects are configured for 3000, so prefer freeing 3000). |
