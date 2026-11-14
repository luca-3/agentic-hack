# Architecture

## Three components

```
 Employee browser                         Our server (this repo)                     Google
┌──────────────────────────┐   events    ┌──────────────────────────────┐
│ Chrome extension (MV3)   │ ──────────▶ │ Runtime  (Next.js /api/*)    │ ── LLM ──▶ Gemini (flash, lite, argon)
│  content script          │ ◀────────── │  ingest · decision API       │
│  offscreen doc (audio)   │  hints      │  agent + tools · token mint  │ ── token ─▶ Gemini Live
│  service worker          │             │  Supabase (Postgres, Auth,   │
│  side panel              │ ── audio ──────────────────────────────────────────────▶ Gemini Live (direct,
└──────────────────────────┘  (after wake word, ephemeral token)         │              ephemeral token)
                                         │ Dashboard (Next.js pages)    │ ◀── org admin
                                         └──────────────────────────────┘
```

1. **Extension** — runs at the employee, has all client capabilities: observe, overlay, voice, click.
2. **Dashboard** — central admin per org: users/roles, apps + feature lists, training catalog, insights.
3. **Runtime** — where the agent acts: decision API, LLM calls, tool execution on server data, Live token minting, event ingest, analytics jobs.

Each component is its own app in the monorepo (`apps/extension`, `apps/dashboard`, `apps/server`), runnable on its own; they share only `packages/shared` (contract) and the Supabase DB (see D-14, D-15).

## Extension internals

| Part | Job |
| --- | --- |
| **Content script** (per allowed page, Shadow DOM UI) | collect events, build snapshot, privacy filter, overlays (frame, arrow, bubble, tour, status), execute clicks |
| **Offscreen document** (reason `USER_MEDIA`) | always-on openWakeWord, mic capture, Gemini Live WebSocket, audio playback |
| **Service worker** | login/session, message routing between parts, calls to runtime |
| **Side panel** | chat history + text input (can't be opened by wake word, only by user gesture) |
| **Permission page** (normal tab) | one-time mic permission — Chrome can't prompt in side panel/offscreen |

Constraints: no remotely hosted code in MV3 (bundle everything, incl. wake-word models); host permissions only for org-allowed domains; overlays must handle `<dialog>`/top layer.

## Flows

**A — Proactive hint**
1. Content script streams events → rule fires (R-DEC-1).
2. `POST /api/lotse/decide` with recent events → lite model: intervene? intent?
3. If yes: main agent with snapshot + feature list (filtered by role) → `{ elementNumber, sentence }`.
4. Content script highlights element + bubble; optional spoken offer.

**B — Voice question**
1. openWakeWord fires (or hotkey) in offscreen doc.
2. `POST /api/lotse/live-token` → runtime mints ephemeral Live token with locked config: model, system prompt incl. org context + role, tool definitions.
3. Offscreen doc connects directly to Gemini Live, streams mic audio, plays the answer.
4. Tool calls are **client-driven**: `getPageSnapshot`, `highlightElement`, `clickElement` run in the content script; `searchKnowledge` calls a runtime endpoint.
5. Session closes after the answer → back to wake-word listening.

**C — Insights**
Batch job aggregates events per org/app/feature/role → pain points → Gemini maps them to the training catalog and to UX suggestions → dashboard.

## Agent tools (shared by text agent and Live session)

| Tool | Runs in | Returns |
| --- | --- | --- |
| `getRecentEvents` | runtime | last N events of the session |
| `getPageSnapshot` | extension | numbered interactive elements |
| `searchKnowledge` | runtime | matching features (route, click path, role) + RAG hits |
| `highlightElement({ elementNumber, explanation })` | extension | ack |
| `clickElement({ elementNumber })` | extension | ack / new route |

Server-side agent code should depend on a **`DataSource` interface** (events, snapshot, knowledge, user context) so the observation source can change without touching the agent.

## Models (see `MODELS` in `apps/server/src/lib/ai/google.ts`)

| Use | Model |
| --- | --- |
| Main agent / answers | `gemini-3.8-flash` (fast) · `gemini-4-argon` (smart) |
| Decision (intervene?) | a lite model, e.g. `gemini-3.5-flash-lite` — listed for our key, **not yet in `MODELS`/tested** |
| Voice | `gemini-3.8-live` or `gemini-3.1-flash-live-preview` — listed, **not yet tested** |
| Knowledge search | `gemini-embedding-2` (768 dims) |

## Data model (proposed, Supabase, RLS on every table)

`orgs` · `org_members (user_id, org_id, role)` · `apps (org_id, name, domains[])` · `app_features (app_id, name, route, click_path, required_role)` · `sessions (pseudo_user_id, app_id, started_at)` · `events (session_id, type, route, element_label, ts)` · `hints (session_id, trigger, element_label, accepted)` · `training_catalog (org_id, title, topics)` · `insights (org_id, app_id, feature, role, metric, period)`.
RAG: existing `documents` table + `match_documents()`.

## Code layout (npm workspaces)

```
apps/extension/            @lotse/extension — WXT 0.21, Chrome MV3 (WXT dev server :3002)
  entrypoints/background.ts  service worker: side panel ⇄ content script, calls server /api/lotse/ask
  entrypoints/content.ts     numbered snapshot of interactive elements, Shadow-DOM highlight overlay
  entrypoints/sidepanel/     text question UI
apps/server/               @lotse/server — Next.js 16 (:3001), runtime, all Gemini calls
  src/app/api/lotse/ask/     question + snapshot → { elementNumber, sentence } (built)
  src/app/api/lotse/*        planned: ingest, decide, live-token; api/knowledge/ingest (embeddings for the dashboard)
  src/app/api/chat, chat/    playground agent + UI
  src/lib/ai/                Gemini provider/MODELS, hackAgent, embeddings/RAG
  src/lib/supabase/          server (RLS) + admin (secret key) clients;  src/lib/cors.ts
  src/lib/lotse/*            planned: agent, tools, DataSource interface, rules
apps/dashboard/            @lotse/dashboard — Next.js 16 (:3000), org admin UI
  src/app/page.tsx           placeholder cards: Organisation & Nutzer, Apps & Funktionslisten, Schulungskatalog, Insights
  src/lib/supabase/, src/proxy.ts   Supabase clients + session refresh
packages/shared/           @lotse/shared — zod schemas + types = contract (AskRequest/Response, PageSnapshot, LotseEvent, ExtensionMessage, LOTSE_DEFAULTS), database.types.ts
supabase/migrations/       schema above (shared local DB, ports 573xx)
demo-crm/                  static demo CRM (:4000), test target for the extension
```

Boundaries: extension → server only via HTTP (from the service worker); dashboard writes org/user/knowledge tables and calls the server for embeddings; server reads those tables.
