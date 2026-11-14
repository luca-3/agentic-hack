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

Dashboard and runtime live in **this Next.js app** (one deployable). The extension is a separate build in this repo (proposed folder: `extension/`).

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

## Models (see `MODELS` in `src/lib/ai/google.ts`)

| Use | Model |
| --- | --- |
| Main agent / answers | `gemini-3.8-flash` (fast) · `gemini-4-argon` (smart) |
| Decision (intervene?) | a lite model, e.g. `gemini-3.5-flash-lite` — listed for our key, **not yet in `MODELS`/tested** |
| Voice | `gemini-3.8-live` or `gemini-3.1-flash-live-preview` — listed, **not yet tested** |
| Knowledge search | `gemini-embedding-2` (768 dims) |

## Data model (proposed, Supabase, RLS on every table)

`orgs` · `org_members (user_id, org_id, role)` · `apps (org_id, name, domains[])` · `app_features (app_id, name, route, click_path, required_role)` · `sessions (pseudo_user_id, app_id, started_at)` · `events (session_id, type, route, element_label, ts)` · `hints (session_id, trigger, element_label, accepted)` · `training_catalog (org_id, title, topics)` · `insights (org_id, app_id, feature, role, metric, period)`.
RAG: existing `documents` table + `match_documents()`.

## Proposed code layout

```
extension/                 Chrome extension (MV3) — separate build
src/app/api/lotse/*        runtime endpoints: ingest, decide, live-token, knowledge
src/app/(dashboard)/*      org admin UI
src/lib/lotse/*            agent, tools, DataSource interface, rules shared with tests
supabase/migrations/       schema above
```
