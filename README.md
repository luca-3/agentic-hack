# Agentic Hack

Hackathon starter for the [{Tech: Europe} Agentic AI Hack Karlsruhe](https://luma.com/kar-hack):
**Next.js 16** (App Router, TypeScript, Tailwind v4) + **local Supabase** (Postgres, Auth, REST, Realtime, Studio, pgvector) + **Google Gemini** via the Vercel AI SDK 7.

> **New to the team?** Follow [SETUP.md](SETUP.md) (≈15 min) and run `npm run doctor`.
> **Using a coding agent?** It should read [AGENTS.md](AGENTS.md) (Claude Code picks it up via `CLAUDE.md`).

## Prerequisites

- Node.js 22+
- Docker (Docker Desktop, OrbStack or Colima)
- [Supabase CLI](https://supabase.com/docs/guides/local-development/cli/getting-started) (`brew install supabase/tap/supabase`)

## Quick start

```bash
npm install
npm run db:start   # start local Supabase (first run pulls Docker images)
npm run db:env     # write .env.local from the running stack
# paste your key into GEMINI_API_KEY= in .env.local (https://aistudio.google.com/apikey)
npm run ai:check   # verify Gemini: text, structured output, embeddings
npm run dev        # http://localhost:3000  → agent chat at /chat
```

The start page queries the `notes` table and shows a green dot when everything is wired up.

## Gemini / AI stack

| Piece | Where | What it gives you |
| --- | --- | --- |
| Provider + model IDs | [`src/lib/ai/google.ts`](src/lib/ai/google.ts) | `fastModel` (gemini-3.8-flash), `smartModel` (gemini-4-argon), `embeddingModel` (gemini-embedding-2, 768 dims) |
| Example agent | [`src/lib/ai/agent.ts`](src/lib/ai/agent.ts) | `ToolLoopAgent` with Google Search, URL context, Supabase notes, RAG tools |
| Chat API | [`src/app/api/chat/route.ts`](src/app/api/chat/route.ts) | Streams the agent to the UI (incl. tool calls + sources) |
| Chat UI | [`src/app/chat/page.tsx`](src/app/chat/page.tsx) | `useChat` with tool-call and source rendering |
| RAG | [`src/lib/ai/embeddings.ts`](src/lib/ai/embeddings.ts) | `addDocuments()` / `searchDocuments()` on `public.documents` (pgvector, HNSW) |

**Add a tool** — in `agent.ts`:

```ts
myTool: tool({
  description: "What it does — the model reads this",
  inputSchema: z.object({ query: z.string() }),
  execute: async ({ query }) => ({ result: "..." }),
}),
```

**One-off calls** (Server Actions, Route Handlers):

```ts
import { generateText, Output } from "ai";
import { z } from "zod";
import { fastModel } from "@/lib/ai/google";

const { text } = await generateText({ model: fastModel, prompt: "..." });

const { output } = await generateText({
  model: fastModel,
  output: Output.object({ schema: z.object({ title: z.string(), tags: z.array(z.string()) }) }),
  prompt: "...",
});
```

More Gemini features (image generation, speech, realtime/Live, code execution, file search):
see `node_modules/@ai-sdk/google/docs/15-google.mdx` and `node_modules/ai/docs/`. `@google/genai` (official Google SDK) is installed as a fallback for anything the AI SDK doesn't cover.

Keep `GEMINI_API_KEY` and `SUPABASE_SECRET_KEY` server-only — never prefix them with `NEXT_PUBLIC_`.

## Local URLs

This project uses the **573xx** port range so it can run next to other local Supabase projects (default 543xx).

| Service      | URL                                                       |
| ------------ | --------------------------------------------------------- |
| App          | http://localhost:3000                                     |
| Supabase API | http://127.0.0.1:57321                                    |
| Studio       | http://127.0.0.1:57323                                    |
| Mailpit      | http://127.0.0.1:57324 (catches auth emails)              |
| Postgres     | `postgresql://postgres:postgres@127.0.0.1:57322/postgres` |

## Scripts

| Script                       | What it does                                      |
| ---------------------------- | ------------------------------------------------- |
| `npm run dev`                | Next.js dev server                                |
| `npm run build` / `start`    | Production build / serve                          |
| `npm run lint` / `typecheck` | ESLint / `tsc --noEmit`                           |
| `npm run db:start` / `stop`  | Start / stop local Supabase                       |
| `npm run db:status`          | Show URLs and keys                                |
| `npm run db:env`             | Generate `.env.local` from `supabase status`      |
| `npm run db:migration name`  | Create `supabase/migrations/<timestamp>_name.sql` |
| `npm run db:reset`           | Re-apply all migrations + `supabase/seed.sql`     |
| `npm run db:types`           | Generate `src/lib/supabase/database.types.ts`     |
| `npm run ai:check`           | Smoke-test Gemini (text, JSON, embeddings)        |
| `npm run doctor`             | Check the whole local setup, with fix hints       |

## Project layout

```
src/
  app/                    # routes (App Router): /, /chat, /api/chat
  lib/ai/
    google.ts             # Gemini provider + model IDs
    agent.ts              # example ToolLoopAgent (tools live here)
    embeddings.ts         # RAG: addDocuments / searchDocuments
  lib/supabase/
    client.ts             # browser client  → Client Components
    server.ts             # server client   → Server Components, Actions, Route Handlers
    admin.ts              # secret-key client (bypasses RLS) → trusted server code only
    proxy.ts              # session refresh helper
  proxy.ts                # Next.js 16 proxy (formerly middleware): refreshes auth cookies
supabase/
  config.toml             # local stack config (ports, auth, …)
  migrations/             # SQL migrations (example: notes table with RLS)
  seed.sql                # seed data for db:start / db:reset
scripts/supabase-env.mjs  # writes .env.local
```

## Using Supabase

```ts
// Server Component / Server Action
import { createClient } from "@/lib/supabase/server";
const supabase = await createClient();
const { data } = await supabase.from("notes").select();

// Client Component
"use client";
import { createClient } from "@/lib/supabase/client";
const supabase = createClient();
```

Always enable RLS on new tables and add policies in the migration.

## Notes

- **Analytics is disabled** in `supabase/config.toml` (its log container can't mount the Docker socket under Colima).
- Low on Docker memory? Start a slimmer stack: `supabase start -x storage-api,imgproxy,edge-runtime`.
- `AGENTS.md` is generated by Next.js and points coding agents at the bundled Next.js 16 docs in `node_modules/next/dist/docs/`.
