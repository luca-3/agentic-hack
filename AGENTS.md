<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Agentic Hack — guide for coding agents

One-day hackathon project ({Tech: Europe} Agentic AI Hack, co-hosted by Google DeepMind). **Speed and a working demo beat perfection**: prefer the smallest change that works, reuse what exists, don't add new frameworks or abstractions unless asked.

Human docs: `README.md` (overview), `SETUP.md` (setup, workflow, troubleshooting).

**Product context — read first:** we are building **Lotse** (Chrome extension + dashboard + agent runtime, voice-native, Gemini). The agent wiki in `docs/` holds requirements, architecture, decisions and research: start at `docs/README.md`. Follow `docs/decisions.md`; when you make or change a product/architecture decision, append it there (next D-number) and update requirement status in `docs/requirements.md`.

## Monorepo — three areas + shared contract

npm workspaces (`apps/*`, `packages/*`). Each app runs on its own; they only talk via HTTP and the types in `@lotse/shared`.

| Area | Folder | Package | Port | Owner | Owns | Talks to others via |
| --- | --- | --- | --- | --- | --- | --- |
| Extension | `apps/extension` | `@lotse/extension` | 3002 (WXT dev server) | extension dev | extension code | HTTP to server (`/api/lotse/*`), types from `@lotse/shared` |
| Server / runtime | `apps/server` | `@lotse/server` | 3001 | server dev | all Gemini calls, agent, event/hint tables | HTTP API; reads org/knowledge tables |
| Dashboard | `apps/dashboard` | `@lotse/dashboard` | 3000 | dashboard colleague (org creation, onboarding of organizations, central knowledge base, user management) | migrations for orgs/members/apps/app_features/knowledge tables | writes those tables; embeds knowledge via a server endpoint (planned `POST /api/knowledge/ingest`) |
| Shared contract | `packages/shared`, `supabase/migrations` | `@lotse/shared` | – | everyone | zod schemas/types, DB schema | coordinate changes directly on main |

Rules:
- **Don't edit another area's folder** without telling its owner.
- **Contract first:** API shapes change in `packages/shared` first, then in the apps.
- **All Gemini/embedding calls live in `apps/server`.** No Gemini key in the extension or dashboard.
- **Schema only via new migration files** (`npm run db:migration <name>`; timestamps avoid collisions). Never edit a merged migration.

## Stack — newer than your training data

| Layer | Version | Read before coding |
| --- | --- | --- |
| Next.js (App Router, Turbopack) — server + dashboard | 16.4 | `node_modules/next/dist/docs/` |
| React | 19 | – |
| Vercel AI SDK (server only) | 7 (`ai`, `@ai-sdk/react`) | `node_modules/ai/docs/` |
| Gemini provider (server only) | `@ai-sdk/google` 4 | `node_modules/@ai-sdk/google/docs/15-google.mdx` |
| Google GenAI SDK (fallback only) | `@google/genai` 3 | its README |
| WXT (extension, Chrome MV3) | 0.21 | https://wxt.dev |
| Supabase | `@supabase/ssr`, `@supabase/supabase-js`, local CLI stack | – |
| Tailwind CSS | 4 (no `tailwind.config.js`, config lives in CSS) | – |
| Validation | zod 4 | – |

Things that trip up agents in this repo:

- **`cacheComponents` is on** (both `next.config.ts`). Request-dependent data (cookies, DB queries, uncached `fetch`) must sit inside `<Suspense>` or the build fails with `blocking-prerender-dynamic`. Pattern: `apps/server/src/app/page.tsx` (`SupabaseStatus` in `Suspense`).
- **`middleware.ts` is now `proxy.ts`** — ours is `apps/dashboard/src/proxy.ts` (refreshes the Supabase session). Don't create a `middleware.ts`.
- **AI SDK 7 APIs differ from older versions**: use `ToolLoopAgent`, `tool({ inputSchema })`, `stopWhen: isStepCount(n)` (no `maxSteps`), `generateText` with `output: Output.object({ schema })` (`generateObject` is deprecated), `createAgentUIStreamResponse`, `useChat` from `@ai-sdk/react` rendering `message.parts`.
- **Model IDs**: only use IDs from `MODELS` in `apps/server/src/lib/ai/google.ts` (verified against our key). Don't invent model names.
- **One `.env.local` at the repo root** for all apps — each `next.config.ts` loads it via `@next/env`. Don't create per-app env files.
- **`@lotse/shared` is TS source** — Next apps list it in `transpilePackages`; no build step.

## Commands (run from the repo root)

```bash
npm run dev:server      # agent runtime   → http://localhost:3001 (status page, /chat playground)
npm run dev:dashboard   # org admin UI    → http://localhost:3000
npm run dev:extension   # WXT dev (port 3002), opens Chrome with the extension loaded
npm run demo:crm        # static demo CRM → http://localhost:4000 (test target for the extension)
npm run doctor          # checks tools, Docker, Supabase, .env.local, Gemini key
npm run typecheck       # all workspaces (Next apps: next typegen && tsc --noEmit)
npm run lint            # all workspaces
npm run build           # all workspaces (catches Suspense/prerender errors)
npm run ai:check        # 3 tiny live Gemini calls
npm run db:migration <name>   # new SQL migration file
npx supabase migration up     # apply new migrations, keep data
npm run db:reset        # rebuild DB from migrations + supabase/seed.sql (deletes local data)
npm run db:types        # regenerate packages/shared/src/database.types.ts
```

One workspace only: `npm run <script> -w @lotse/server` (or `@lotse/dashboard`, `@lotse/extension`, `@lotse/shared`).

**Before saying you're done:** `npm run typecheck` and `npm run lint` must pass. Run `npm run build` when you touched pages, layouts, data fetching or the extension. Per the user's standing instruction, do not create or run tests, including live AI smoke tests (`ai:check`). Type checking, linting and builds are the validation steps.

## Where things live

```
docs/                                   agent wiki: requirements, architecture, decisions, research
apps/server/                            @lotse/server — agent runtime (Next.js, :3001)
  src/app/api/lotse/ask/route.ts        question + page snapshot → { elementNumber, sentence } (Gemini structured output)
  src/app/api/chat/route.ts             streams hackAgent to the playground UI
  src/app/chat/page.tsx                 playground chat UI (useChat)
  src/app/page.tsx                      status page (DB check)
  src/lib/ai/google.ts                  Gemini provider + MODELS + EMBEDDING_DIMENSIONS   ← change models here
  src/lib/ai/agent.ts                   hackAgent (ToolLoopAgent) + tools                 ← add tools here
  src/lib/ai/embeddings.ts              addDocuments() / searchDocuments() — RAG on public.documents
  src/lib/supabase/server.ts            user-session client (RLS applies)
  src/lib/supabase/admin.ts             secret-key client, bypasses RLS — trusted server code only
  src/lib/cors.ts                       CORS for extension / dashboard → server calls
apps/dashboard/                         @lotse/dashboard — org admin UI (Next.js, :3000)
  src/app/page.tsx                      placeholder cards: Organisation & Nutzer, Apps & Funktionslisten, Schulungskatalog, Insights
  src/lib/supabase/{client,server,proxy}.ts   browser / server / session-refresh clients
  src/proxy.ts                          session refresh on every request
apps/extension/                         @lotse/extension — Chrome MV3 (WXT)
  wxt.config.ts                         manifest (permissions, host_permissions = localhost only), dev port 3002
  entrypoints/background.ts             service worker: side panel ⇄ content script, calls server /api/lotse/ask
  entrypoints/content.ts                numbered snapshot of interactive elements, Shadow-DOM highlight overlay
  entrypoints/sidepanel/                text question UI
packages/shared/src/index.ts            @lotse/shared — contract: LOTSE_DEFAULTS, InteractiveElement, PageSnapshot, LotseEvent, AskRequest, AskResponse, ExtensionMessage
packages/shared/src/database.types.ts   generated by db:types
supabase/migrations/                    SQL migrations (source of truth for the schema, shared local DB)
supabase/seed.sql                       demo data
demo-crm/                               static demo CRM (test target, :4000)
scripts/                                doctor, db:env, ai:check
```

## Conventions

**AI / agents (`apps/server`)**
- New agent capability → add a `tool({ description, inputSchema, execute })` to `hackAgent` in `apps/server/src/lib/ai/agent.ts`, or a new agent file next to it. Write descriptions for the model: say when to use the tool.
- One-off LLM calls → `generateText` with `fastModel`; structured data → `output: Output.object({ schema })`. Request/response schemas the extension or dashboard see go in `@lotse/shared`.
- Built-in Gemini tools (`google.tools.googleSearch`, `urlContext`, `codeExecution`) can be mixed with our own tools.
- Keep `stopWhen` bounded (default `isStepCount(10)`) — runaway loops cost money.
- Embedding size is 768 everywhere (`EMBEDDING_DIMENSIONS` ↔ `vector(768)` in the migration). Change both or neither.

**Extension (`apps/extension`)**
- WXT + TypeScript, Chrome MV3. **No remote code** — bundle everything (MV3 rule).
- **Server calls only from `background.ts`** (service worker); content script and side panel message it (`ExtensionMessage` in `@lotse/shared`).
- **No Gemini key or Supabase secret in the extension.** Everything LLM goes through the server.
- `host_permissions` / content-script `matches` are localhost-only for now; widen deliberately.
- Branded Chrome ≥ 137 ignores `--load-extension`; for Playwright use Chromium / Chrome for Testing.

**Supabase / database**
- Schema changes **only via migrations** (`npm run db:migration <name>`). Never edit a migration already on `main` — add a new one.
- Every new table: `alter table … enable row level security;` plus explicit policies in the same migration.
- `server.ts` clients for user-facing reads/writes (RLS), `apps/server/src/lib/supabase/admin.ts` only in server code that must bypass RLS.
- After schema changes run `npm run db:types` (writes `packages/shared/src/database.types.ts`).

**Next.js / React (server + dashboard)**
- Server Components by default; `"use client"` only for interactivity (state, effects, `useChat`).
- Files that touch secrets import `"server-only"` (see `apps/server/src/lib/ai/*`, `apps/server/src/lib/supabase/admin.ts`).
- Styling: Tailwind utility classes, light + dark (`dark:`) variants. No UI library installed — don't add one unless asked.
- Path alias: `@/` → the app's own `src/`. Cross-app imports only via `@lotse/shared`.

## Secrets & safety

- Secrets live in the root `.env.local` (git-ignored): `GEMINI_API_KEY`, `SUPABASE_SECRET_KEY`, plus public `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.
- **Never** prefix a secret with `NEXT_PUBLIC_`, never print or log keys, never commit `.env.local`. New variables → add them (without values) to `.env.example`.
- Don't run `supabase stop --no-backup`, `db:reset` or destructive SQL without the human's OK — teammates may have local data they care about.
- Local Supabase runs on ports **573xx** (API 57321, DB 57322, Studio 57323). Other projects may use 543xx/553xx — don't stop other Supabase projects.

## Git

- Small, focused commits with clear messages, directly on `main`.
- Push completed changes directly to `origin/main`; the user explicitly authorized this workflow. Do not create pull requests.
- Commit `AGENTS.md` changes made by `next dev` (managed block above).
- Never force-push.
