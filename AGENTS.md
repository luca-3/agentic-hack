<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agentic Hack — guide for coding agents

One-day hackathon project ({Tech: Europe} Agentic AI Hack, co-hosted by Google DeepMind). **Speed and a working demo beat perfection**: prefer the smallest change that works, reuse what exists, don't add new frameworks or abstractions unless asked.

Human docs: `README.md` (overview), `SETUP.md` (setup, workflow, troubleshooting).

**Product context — read first:** we are building **Lotse** (Chrome extension + dashboard + agent runtime, voice-native, Gemini). The agent wiki in `docs/` holds requirements, architecture, decisions and research: start at `docs/README.md`. Follow `docs/decisions.md`; when you make or change a product/architecture decision, append it there (next D-number) and update requirement status in `docs/requirements.md`.

## Stack — newer than your training data

| Layer | Version | Read before coding |
| --- | --- | --- |
| Next.js (App Router, Turbopack) | 16.4 | `node_modules/next/dist/docs/` |
| React | 19 | – |
| Vercel AI SDK | 7 (`ai`, `@ai-sdk/react`) | `node_modules/ai/docs/` |
| Gemini provider | `@ai-sdk/google` 4 | `node_modules/@ai-sdk/google/docs/15-google.mdx` |
| Google GenAI SDK (fallback only) | `@google/genai` 3 | its README |
| Supabase | `@supabase/ssr`, `@supabase/supabase-js`, local CLI stack | – |
| Tailwind CSS | 4 (no `tailwind.config.js`, config lives in CSS) | – |
| Validation | zod 4 | – |

Things that trip up agents in this repo:

- **`cacheComponents` is on** (`next.config.ts`). Data that depends on the request (cookies, DB queries, `fetch` without cache) must sit inside a `<Suspense>` boundary or the build fails with `blocking-prerender-dynamic`. Pattern: see `src/app/page.tsx` (`SupabaseStatus` wrapped in `Suspense`).
- **`middleware.ts` is now `proxy.ts`** — ours is `src/proxy.ts` (refreshes the Supabase session). Don't create a `middleware.ts`.
- **AI SDK 7 APIs differ from older versions**: use `ToolLoopAgent`, `tool({ inputSchema })`, `stopWhen: isStepCount(n)` (there is no `maxSteps`), `generateText` with `output: Output.object({ schema })` (`generateObject` is deprecated), `createAgentUIStreamResponse`, and `useChat` from `@ai-sdk/react` rendering `message.parts`. Check the docs folder when unsure.
- **Model IDs**: only use IDs from `MODELS` in `src/lib/ai/google.ts` (verified against our API key). Don't invent model names.

## Commands

```bash
npm run dev           # dev server → http://localhost:3000
npm run doctor        # checks tools, Docker, Supabase, .env.local, Gemini key
npm run typecheck     # tsc --noEmit
npm run lint          # eslint
npm run build         # production build (catches Suspense/prerender errors)
npm run ai:check      # 3 tiny live Gemini calls
npm run db:migration <name>   # new SQL migration file
npx supabase migration up     # apply new migrations, keep data
npm run db:reset      # rebuild DB from migrations + supabase/seed.sql (deletes local data)
npm run db:types      # regenerate src/lib/supabase/database.types.ts
```

**Before saying you're done:** `npm run typecheck && npm run lint` must pass. Run `npm run build` when you touched pages, layouts or data fetching. If you changed AI code, exercise it (`npm run ai:check` or a real request to `/api/chat`).

## Where things live

```
docs/                       agent wiki: requirements, architecture, decisions, research (Lotse)
src/app/page.tsx            start page (DB status check)
src/app/chat/page.tsx       agent chat UI (useChat, renders text / tool calls / sources)
src/app/api/chat/route.ts   streams hackAgent to the UI
src/lib/ai/google.ts        Gemini provider + MODELS + EMBEDDING_DIMENSIONS   ← change models here
src/lib/ai/agent.ts         hackAgent (ToolLoopAgent) + its tools             ← add tools here
src/lib/ai/embeddings.ts    addDocuments() / searchDocuments() — RAG on public.documents
src/lib/supabase/server.ts  Supabase client for Server Components / Actions / Route Handlers (user's session, RLS applies)
src/lib/supabase/client.ts  Supabase client for Client Components (RLS applies)
src/lib/supabase/admin.ts   secret-key client, bypasses RLS — server-only, for trusted code (agent tools, ingestion)
src/proxy.ts                session refresh on every request
supabase/migrations/        SQL migrations (source of truth for the schema)
supabase/seed.sql           demo data
scripts/                    doctor, db:env, ai:check
```

## Conventions

**AI / agents**
- New capability for the agent → add a `tool({ description, inputSchema, execute })` to `hackAgent` in `src/lib/ai/agent.ts`, or create a new agent file next to it following the same pattern. Write descriptions for the model: say when to use the tool.
- One-off LLM calls (summaries, extraction, classification) → `generateText` with `fastModel`; structured data → `output: Output.object({ schema: z.object(...) })`.
- Built-in Gemini tools (`google.tools.googleSearch`, `urlContext`, `codeExecution`) can be mixed with our own tools.
- Keep `stopWhen` bounded (default `isStepCount(10)`) — runaway loops cost money.
- Embedding size is 768 everywhere (`EMBEDDING_DIMENSIONS` ↔ `vector(768)` in the migration). Change both or neither.

**Supabase / database**
- Schema changes **only via migrations** (`npm run db:migration <name>`). Never edit a migration that is already on `main` — add a new one.
- Every new table: `alter table … enable row level security;` plus explicit policies in the same migration.
- Use `server.ts` for user-facing reads/writes (respects RLS), `admin.ts` only in server code that must bypass RLS.
- After schema changes run `npm run db:types` and use the generated types if helpful.

**Next.js / React**
- Server Components by default; add `"use client"` only for interactivity (state, effects, `useChat`).
- Files that touch secrets import `"server-only"` (see `src/lib/ai/*`, `src/lib/supabase/admin.ts`).
- Styling: Tailwind utility classes, light + dark (`dark:`) variants. No UI library is installed yet — don't add one unless asked.
- Path alias: `@/` → `src/`.

## Secrets & safety

- Secrets live in `.env.local` (git-ignored): `GEMINI_API_KEY`, `SUPABASE_SECRET_KEY`, plus public `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- **Never** prefix a secret with `NEXT_PUBLIC_`, never print or log keys, never commit `.env.local`. New variables → add them (without values) to `.env.example`.
- Don't run `supabase stop --no-backup`, `db:reset` or destructive SQL without the human's OK — teammates may have local data they care about.
- Local Supabase runs on ports **573xx** (API 57321, DB 57322, Studio 57323). Other projects on the machine may use 543xx/553xx — don't stop other Supabase projects.

## Git

- Small, focused commits with clear messages; short-lived branches, merge to `main` often.
- Commit `AGENTS.md` changes made by `next dev` (managed block above).
- Don't push or force-push unless the human asks.
