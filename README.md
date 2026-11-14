# Agentic Hack — Lotse

Monorepo for the [{Tech: Europe} Agentic AI Hack Karlsruhe](https://luma.com/kar-hack):
**Chrome extension** (WXT, MV3) + **dashboard** and **agent server** (Next.js 16, Tailwind v4) + **local Supabase** (Postgres, Auth, pgvector) + **Google Gemini** via the Vercel AI SDK 7.

> **New to the team?** Follow [SETUP.md](SETUP.md) (≈15 min) and run `npm run doctor`.
> **Using a coding agent?** It should read [AGENTS.md](AGENTS.md) (Claude Code picks it up via `CLAUDE.md`).
> **What are we building?** Lotse — see the product wiki in [docs/](docs/README.md) (requirements, architecture, decisions).

## Three areas, independently runnable

| Area | Folder | Owner | Run |
| --- | --- | --- | --- |
| Extension (Chrome MV3, WXT) | `apps/extension` | extension dev | `npm run dev:extension` |
| Server / agent runtime (all Gemini calls) | `apps/server` | server dev | `npm run dev:server` |
| Dashboard (orgs, onboarding, knowledge base, users) | `apps/dashboard` | dashboard colleague | `npm run dev:dashboard` |
| Shared contract (zod schemas + types) | `packages/shared` | everyone (small PR + tell the others) | – |

Apps talk only via HTTP and the types in `@lotse/shared`. Ownership rules: [AGENTS.md](AGENTS.md#monorepo--three-areas--shared-contract).

## Does this exist already? (competitor check, 2026-11-14)

Short answer: **no single product does what we do, but every building block exists somewhere.** Our edge is the combination. Details and sources: [docs/research.md → Competitors](docs/research.md#competitors-2026-11-14).

| Closest competitor | What it already does | What it lacks |
| --- | --- | --- |
| **Whatfix** (ScreenSense, AI Insights) | Claims to detect when users are stuck; AI writes guides; friction analytics | Guides still authored by admins; "stuck" is an admin report, not help in the moment; no fading; enterprise pricing |
| **Userlane** (Munich) | Browser extension via group policy, no app code; on-screen guidance; GDPR; pseudonymized audience-level analytics | Rule-based triggers, hand-built content, no fading; per-person data still exists server-side |
| **Copilot Vision / Gemini in Chrome** | Zero setup, sees any page; Copilot reportedly points at the right button (*unverified*) | Only on request; no learning state; nothing for the company; biggest threat because free and bundled |

Also checked: WalkMe, Pendo, Apty, Lemon Learning, Userpilot, Appcues, Chameleon, Spekit, Guidde, Tango (guides or analytics, mostly per user); Microsoft Adoption Score (aggregate only, but M365 only); Claude for Chrome, ChatGPT Atlas, Perplexity Comet, Opera Neon (they *act* instead of showing).

**What nobody has (= our pitch):**

1. **Help that gets quieter as the person learns** — per task, learning state stays in the browser. No vendor claims this.
2. **"Still stuck after the hint"** as a metric — separates a design flaw in the app (still stuck) from a training need (hint helped).
3. **Help at the moment of being stuck, with zero setup** — elsewhere "stuck" is an after-the-fact admin report, and proactive help runs on rules admins write.
4. **Aggregate-only by design** — no per-person data on the server; makes a works-council agreement (§ 87 (1) 6 BetrVG) easy.
5. **Shows, doesn't act** — every browser agent executes; we guide so people learn.
6. **Built for SMBs / Handwerk**, not enterprise sales.

**Pitch answer to "Doesn't WalkMe do that?"**
> WalkMe, Whatfix and Userlane need admins who build tours, and they measure people. Copilot and Gemini wait until you ask. Lotse notices on its own when someone is stuck, shows the way with zero setup, gets quieter the better you get — and the company only learns where the **app** loses people, never who.

**Honest risk:** pointing and stuck detection can be copied by the big vendors within a release. What protects us is the combination of fading, privacy by design and SMB pricing — not a single feature.

## Prerequisites

- Node.js 22+
- Docker (Docker Desktop, OrbStack or Colima)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (`brew install supabase/tap/supabase`)
- Chrome / Chromium (for the extension)

## Quick start

```bash
npm install            # installs all workspaces
npm run db:start       # start local Supabase (first run pulls Docker images)
npm run db:env         # write the root .env.local from the running stack
# paste your key into GEMINI_API_KEY= in .env.local (https://aistudio.google.com/apikey)
npm run doctor         # everything should be ✓

# then, each in its own terminal — start only what you work on:
npm run dev:server     # http://localhost:3001  (status page, /chat playground, /api/lotse/ask)
npm run dev:dashboard  # http://localhost:3000
npm run dev:extension  # WXT opens Chrome with the extension loaded
npm run demo:crm       # http://localhost:4000  demo CRM to try the extension on
```

One `.env.local` at the repo root serves all apps.

## Local URLs

This project uses the **573xx** port range for Supabase so it can run next to other local Supabase projects (default 543xx).

| Service | URL |
| --- | --- |
| Dashboard | http://localhost:3000 |
| Server (runtime) | http://localhost:3001 — `/chat` playground, `/api/lotse/ask` |
| Extension dev server (WXT) | http://localhost:3002 (internal, for hot reload) |
| Demo CRM | http://localhost:4000 |
| Supabase API | http://127.0.0.1:57321 |
| Studio | http://127.0.0.1:57323 |
| Mailpit | http://127.0.0.1:57324 (catches auth emails) |
| Postgres | `postgresql://postgres:postgres@127.0.0.1:57322/postgres` |

## Scripts (repo root)

| Script | What it does |
| --- | --- |
| `npm run dev:server` | Agent server on :3001 |
| `npm run dev:dashboard` | Dashboard on :3000 |
| `npm run dev:extension` | WXT dev mode (port 3002), opens Chrome with the extension |
| `npm run demo:crm` | Static demo CRM on :4000 (`demo-crm/`) |
| `npm run build` | Build all workspaces (extension → `apps/extension/.output/chrome-mv3`) |
| `npm run lint` / `typecheck` | ESLint / typecheck across all workspaces |
| `npm run db:start` / `db:stop` | Start / stop local Supabase |
| `npm run db:status` | Show URLs and keys |
| `npm run db:env` | Generate root `.env.local` from `supabase status` |
| `npm run db:migration name` | Create `supabase/migrations/<timestamp>_name.sql` |
| `npm run db:reset` | Re-apply all migrations + `supabase/seed.sql` (deletes local data) |
| `npm run db:types` | Generate `packages/shared/src/database.types.ts` |
| `npm run ai:check` | Smoke-test Gemini (text, JSON, embeddings) |
| `npm run doctor` | Check the whole local setup, with fix hints |

One workspace only: `npm run <script> -w @lotse/server` (or `@lotse/dashboard`, `@lotse/extension`).

## Project layout

```
apps/
  server/                 @lotse/server — Next.js, :3001, all Gemini calls
    src/app/api/lotse/    runtime endpoints (ask: question + snapshot → { elementNumber, sentence })
    src/app/api/chat/     playground agent stream;  src/app/chat/ playground UI
    src/lib/ai/           google.ts (provider + MODELS), agent.ts (hackAgent + tools), embeddings.ts (RAG)
    src/lib/supabase/     server.ts (RLS) · admin.ts (secret key, bypasses RLS)
    src/lib/cors.ts       CORS for extension / dashboard calls
  dashboard/              @lotse/dashboard — Next.js, :3000, org admin UI
    src/app/              pages (placeholder cards for now)
    src/lib/supabase/     client.ts · server.ts · proxy.ts
    src/proxy.ts          Next.js 16 proxy (formerly middleware): refreshes auth cookies
  extension/              @lotse/extension — WXT, Chrome MV3
    entrypoints/          background.ts (service worker) · content.ts (snapshot + overlay) · sidepanel/
    wxt.config.ts         manifest + dev port 3002
packages/
  shared/src/             @lotse/shared — zod schemas/types (AskRequest, AskResponse, PageSnapshot, …), database.types.ts
supabase/
  config.toml             local stack config (ports, auth, …)
  migrations/             SQL migrations (shared DB schema)
  seed.sql                seed data for db:start / db:reset
demo-crm/                 static demo CRM (test target for the extension)
docs/                     product wiki (requirements, architecture, decisions, research)
scripts/                  doctor, db:env (supabase-env.mjs), ai:check
```

## Gemini / AI (server only)

| Piece | Where | What it gives you |
| --- | --- | --- |
| Provider + model IDs | [`apps/server/src/lib/ai/google.ts`](apps/server/src/lib/ai/google.ts) | `fastModel`, `smartModel`, `embeddingModel` (768 dims) |
| Example agent | [`apps/server/src/lib/ai/agent.ts`](apps/server/src/lib/ai/agent.ts) | `ToolLoopAgent` with Google Search, URL context, Supabase notes, RAG tools |
| Lotse ask | [`apps/server/src/app/api/lotse/ask/route.ts`](apps/server/src/app/api/lotse/ask/route.ts) | question + page snapshot → element number + sentence (structured output) |
| Playground | [`apps/server/src/app/chat/page.tsx`](apps/server/src/app/chat/page.tsx) | `useChat` with tool-call and source rendering |
| RAG | [`apps/server/src/lib/ai/embeddings.ts`](apps/server/src/lib/ai/embeddings.ts) | `addDocuments()` / `searchDocuments()` on `public.documents` (pgvector) |

**Add a tool** — in `agent.ts`:

```ts
myTool: tool({
  description: "What it does — the model reads this",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ result: "..." }),
}),
```

**One-off calls** (inside `apps/server`):

```ts
import { generateText, Output } from "ai";
import { z } from "zod";
import { fastModel } from "@/lib/ai/google";

const { output } = await generateText({
  model: fastModel,
  output: Output.object({ schema: z.object({ title: z.string(), tags: z.array(z.string()) }) }),
  prompt: "...",
});
```

More Gemini features: `node_modules/@ai-sdk/google/docs/15-google.mdx`, `node_modules/ai/docs/`. `@google/genai` is installed as a fallback.

Keep `GEMINI_API_KEY` and `SUPABASE_SECRET_KEY` server-only — never prefix them with `NEXT_PUBLIC_`, never put them in the extension.

## Using Supabase

```ts
// Server Component / Server Action / Route Handler (server or dashboard)
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();
const { data } = await supabase.from("notes").select();

// Client Component (dashboard)
"use client";
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
```

Always enable RLS on new tables and add policies in the migration.

## Notes

- **Analytics is disabled** in `supabase/config.toml` (its log container can't mount the Docker socket under Colima).
- Low on Docker memory? Start a slimmer stack: `supabase start -x storage-api,imgproxy,edge-runtime`.
- `AGENTS.md` starts with a block managed by Next.js that points coding agents at the bundled Next.js 16 docs in `node_modules/next/dist/docs/`.
