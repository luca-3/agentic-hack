# Valo runtime — integration guide for the extension

Server: `apps/server` (Next.js, `http://localhost:3001` = `LOTSE_DEFAULTS.serverUrl`). Contract: `@lotse/shared` (zod schemas, validate responses with them).
Valo **only marks** (highlight, step plan, short text). There is no endpoint or event that clicks or types.
Voice: see `VOICE.md`. Smoke test: `npm run smoke -w @lotse/server` (needs the server running; `LOTSE_URL` to override).

## Headers (every call)

| Header | Value |
| --- | --- |
| `Authorization` | `Bearer <Supabase access token>` of the logged-in user. **Required in production.** In dev (or `LOTSE_DEV_AUTH=1`) it may be omitted: then the caller is anonymous and identified by `x-lotse-session`. |
| `x-lotse-session` (`LOTSE_HEADERS.session`) | Random id per browser session (pseudonymous). Always send it — limits, budgets and the proactive threshold are keyed by user id, else by this. |
| `x-lotse-app` (`LOTSE_HEADERS.app`) | App id / host the user is in, e.g. `localhost:4000`. Fallback: `appId` in the body, then the snapshot URL's host. |
| `Content-Type` | `application/json` |
| `Accept` | `application/x-ndjson` for `/ask` streaming (see below). |

CORS: `chrome-extension://*` and `http://localhost:*` are allowed (incl. the two `x-lotse-*` headers). `Retry-After` is exposed.

## Endpoints

| Method + path | Body → Response | Limit (default, per caller) |
| --- | --- | --- |
| `POST /api/lotse/state` | `UIStateRequest` → `UIStateInference` (no images) | 60/min + daily token budget |
| `POST /api/lotse/intent` | `IntentRequest` → `WorkflowIntent` (no images) | 60/min + daily token budget |
| `POST /api/lotse/decide` | `DecideRequest` → `DecideResponse` (no images) | 60/min + daily token budget |
| `POST /api/lotse/ask` | `AskRequest` → NDJSON stream of `GuidanceEvent` (or legacy JSON); ≤ 4 screenshots | 20/min + daily token budget |
| `POST /api/lotse/feedback` | `OfferFeedbackRequest` → `ProactivePrefs` | 20/min |
| `GET /api/lotse/prefs` | – → `ProactivePrefs` | 20/min |
| `PUT /api/lotse/prefs` | `ProactivePrefs` → `ProactivePrefs` (manual override, clamped 0.6–0.95) | 20/min |
| `POST /api/lotse/events` | `EventBatch` (≤ 100 events) → `202 { accepted }` | 6 batches/min |
| `POST /api/lotse/live-token` | – → `LiveTokenResponse` (`wsUrl` + token, see VOICE.md) | **8 voice sessions/min** per session (one token = one spoken question), 60/min global |
| `GET /api/lotse/policy?app=<host>` | – → `PolicyResponse` (allowed, `blockedRoutes`, app/org name, caller's role) — see "App policy" below | 60/min |
| `GET /api/lotse/auth-config` | – → `AuthConfigResponse` (public Supabase URL + publishable key for the extension login; never the secret key) | – |

## App policy + extension login (D-27, D-05, D-12)

- **Policy** (`src/lib/lotse/policy.ts`): `GET /api/lotse/policy?app=localhost:3100` → `{ app, allowed, known, blockedRoutes, appName, orgName, signedIn, member, role, reason?, ttlSec }`. `known` = the host is in some org's `apps.domains`. Unknown hosts: allowed with an empty blocklist in dev, refused in production (`LOTSE_ALLOW_UNKNOWN_APPS=1|0` overrides); in production a known app also requires org membership. `LOTSE_DISABLED=1` → `allowed: false`.
- **Blocked routes:** CORPUS hosts (`LOTSE_CORPUS_HOSTS`, default `localhost:3100,127.0.0.1:3100`, or a dashboard app named "CORPUS…") always get `LOTSE_FLEET_ROUTES` (default `*fahrzeug*,*vehicle*,*fleet*,*fuhrpark*`) — the vehicle pages hold real fleet data. Extra per app: `LOTSE_BLOCKED_ROUTES="localhost:3100=/admin/*|/export*;localhost:4000=/konto*"`. Blank env values fall back to the defaults. Matching: `routeBlocked(location, patterns)` in `@lotse/shared` (zod-free as `@lotse/shared/route`) — `*` = anything, case-insensitive, against path + query + hash.
- **Extension enforcement (fail closed):** the content script checks the FULL local location (query included, never sent) before reading anything; on a blocked route (or while the policy is unknown) it builds no snapshot, sends no event, shows no highlight, and the service worker takes no screenshot, aborts in-flight inference and refuses questions — also while recording. The overlay chip and the side panel say "Valo pausiert auf dieser Seite". The policy is cached per host for `ttlSec` (60 s); a failed refetch keeps the last known blocklist.
- **Login:** the side panel signs in with Supabase email/password (Auth REST, URL + publishable key from `/auth-config`); the session lives in `chrome.storage.session`, is refreshed a minute before expiry and on a 401 (one retry). Every runtime call sends `Authorization: Bearer <access token>`; signed in, the server takes the role from `org_members` and the manual demo role is not sent. Without login (dev) everything works anonymously as before. Local test user: `npm run seed:dev-org -w @lotse/server -- --with-user` → `vertrieb@demo.test` (role Vertrieb).

Input caps (server trims, you don't have to): question ≤ 500 chars (longer → 400), ≤ 300 snapshot elements, labels ≤ 80 chars. Send **labels only, never input values**.

Body caps per route (larger → **413** `bad_request` "Request body too large (max N KB for this endpoint)"; the server stops reading at the cap): `/ask` 4 MB (≤ 4 frames × 600 k chars + history), `/intent` and `/decide` 1 MB (image-free history: ≤ 13 DOM states, ≤ 180 events, ≤ 40 states), `/state` and everything else 256 KB.

Timeouts (all below the extension's 20 s abort): `/state` 6 s, `/intent` 8 s, `/decide` 2.5 s (+ 2.5 s lite fallback), `/ask` tier run 8 / 12 / 15 s (point / guide / reason) after ≤ 2 s context lookup and ≤ 1.5 s tier classifier. A model timeout answers **504** `timeout`, a model error **502** `internal` (`/state`, `/intent`); `/decide` never fails on model errors (falls back, then `intervene: false`).

## Staged proactive pipeline (D-23)

The extension runs one cycle per relevant change (coalesced ~1 s), sequentially, never with images:

```
events + DOM ─▶ /state ─▶ (local state buffer) ─▶ /intent ─▶ /decide ─▶ intervene? ─▶ /ask (+ ≤ 4 screenshots, source "proactive")
explicit question (text / voice / lotse:wake-question) ───────────────────────────────▶ /ask (direct, no state/intent/decide)
```

### `/state` — UI-state inference

`UIStateRequest { snapshot (ObservationSnapshot, id required), events (≤ 180) }` → `UIStateInference { snapshotId, capturedAt, summary, action? }`.

- `snapshotId` and `capturedAt` are **echoed from the request snapshot** (the extension rejects a mismatch); `summary` (≤ 300 chars requested, ≤ 1 200 allowed) and `action` (omitted when there is none, never `null`) come from `gemini-3.5-flash-lite` (structured output, minimal thinking).
- The model sees the numbered elements (with `(disabled)`), visible `messages`, the last 20 events and the app name.
- Identical `(caller, app, snapshot.id, last event id/ts)` requests within 3 min are answered from an in-memory cache (header `x-lotse-cache: hit|miss`, no tokens charged).

### `/intent` — workflow + intent

`IntentRequest { context { workflow, snapshot, history (≤ 12), states (1–40), screenshots: [] }, role?, appId?, appKnowledge? }` → `WorkflowIntent { workflowName, intent { goal, confidence, evidence[] } }`.

- Uses the inferred states (last 20, with `t+Ns` offsets), route sequence, deduplicated page history (title + path), current page (top 60 elements + messages), last 20 events.
- App knowledge comes from the **org context** (`context.ts`: app → org → `app_features`, role from `org_members` for members, app name); the client's `appKnowledge` goes in as untrusted `<app_notes>` (≤ 2 000 chars). The model is told to use the exact feature name as `workflowName` when one matches.
- `confidence` is the model's own estimate (clamped 0–1). The calibrated help decision is `/decide`.
- `gemini-3.5-flash-lite`, structured output, low thinking.

### `/decide` input in the staged pipeline

`DecideRequest { trigger, triggerReason?, events (≤ 50), snapshot?, context? (screenshots: [], incl. states), inference? (the /intent result), role?, appId?, appKnowledge? }`. `trigger` is the local rule (`repeated_search`, `page_pingpong`, `form_idle`, `repeated_error`, `rage_click`) or `workflow_update` when none fired — then the model needs clear evidence. The Decisions API state contains the inferred workflow/goal/evidence, the last 8 UI states, route sequence, workflow duration, page title/path/labels/messages, recent events and ≤ 600 chars of client notes. Missing `snapshot`/`events` fall back to `context.snapshot` / `context.workflow.events`. When no feature matches but `/intent` was reasonably sure (confidence ≥ 0.5), `intent`/`offer` use the inferred goal.

## `/ask` — NDJSON stream

Request with `Accept: application/x-ndjson`. Each line is one `GuidanceEvent` (parse with `GuidanceEventSchema`), flushed as soon as known:

1. `{"type":"tier","tier":"point|guide|reason","model":"…","snapshotId":"…"}` — always first (status UI: "Valo sucht …"). `snapshotId` echoes `AskRequest.snapshot.id` (omitted when the request snapshot had no id) — drop the answer if it no longer matches the page.
2. Zero or more, **in arrival order — render immediately**:
   - `point` `{ elementNumber, label, hint? }` → move the cursor/highlight to that element on the **current** page. `elementNumber` is always one you sent.
   - `plan` `{ steps: [{ label, route?, elementNumber?, hint? }] }` → step tour. Steps with `elementNumber` are on the current page (step 1 usually has one). Advance locally: after each click/navigation, find the next step's `label` in a fresh snapshot (placeholders like `‹Kundenname›` may appear → match loosely or show the hint).
   - `say` `{ text }` → ≤ 2 sentences, ≤ 200 chars. Show as bubble/subtitle; speak only if voice is on. **Absent when pointing answers the question** — don't add your own text then.
3. Last line: `done` `{ usage: { model, inputTokens, outputTokens, totalTokens, latencyMs } }` **or** `error` `{ code, message }`.

At most one event per type (`point`, `plan`, `say`) per answer. Typical latency (smoke test, local): first event ≈ 0.7–1.1 s, done right after.

```ts
const res = await fetch(`${serverUrl}/api/lotse/ask`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Accept: "application/x-ndjson", [LOTSE_HEADERS.session]: sessionId, [LOTSE_HEADERS.app]: location.host, ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify({ question, source: "text", snapshot, role }),
});
const reader = res.body!.pipeThrough(new TextDecoderStream()).getReader();
let buf = "";
for (;;) {
  const { value, done } = await reader.read();
  if (done) break;
  buf += value;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (line) handle(GuidanceEventSchema.parse(JSON.parse(line))); // → content script: { type: "lotse:guide", event }
  }
}
```

Errors before the stream starts (bad body, auth, rate limit, kill switch) come back with an HTTP status (400/401/413/429/503) **and** the same single NDJSON `error` line, so one parser handles both.

**Legacy JSON**: without `Accept: application/x-ndjson` the response is `AskResponse` `{ elementNumber, sentence, snapshotId? }` (first `point` or first current-page plan step; `say` text, else the point hint / plan summary; `snapshotId` = echo). `source` may be omitted (defaults to `"text"`). Errors: `{ error: { code, message } }`.

**What `/ask` uses besides the question and snapshot:**

- `observation` (optional): route sequence, the last 10 inferred UI states, earlier pages (title + path) → `<observation>` block; `observation.workflow.events` replace a missing `recentEvents`.
- `intent` (optional, from `/intent`): goal + evidence → `<inferred_intent>`; helps with vague questions.
- `observation.screenshots` (≤ 4): sent to Gemini as **real image parts** (AI SDK `FilePart`, media type from the data URL), chronological, each with a caption ("current/earlier page state, N s before the current snapshot"). Malformed frames, frames > 600 k chars and frames over a 2.4 M-char total (oldest first) are dropped. Element numbers still come only from the current snapshot.
- `source: "proactive"` → the question is the inferred goal, the model shows only the next step; `"voice"` → any `say` stays short and speakable.

## Tiers (server-side orchestrator)

A heuristic (no LLM) picks the tier from question cues, the current page labels and the app's feature list (role-aware). Only when unsure, a Choice question to the Gemini Decisions API (`gemini-decision-1`, ≤ 1.5 s) decides.

| Tier | When | Model | Steps | Max output tokens | Thinking | Timeout |
| --- | --- | --- | --- | --- | --- | --- |
| `point` | target on this page ("wo ist …") | `gemini-3.5-flash-lite` | 3 | 600 | minimal | 8 s |
| `guide` | multi-step ("wie lege ich … an"), other page, role restriction | `gemini-3.5-flash-lite` | 5 | 2 000 | low | 12 s |
| `reason` | long / analytical / ambiguous | `gemini-4-argon` | 8 | 4 000 | low | 15 s |

## Proactive help: `/decide` + feedback (adaptive threshold, D-22)

1. After `/state` and `/intent` (see the staged pipeline above), the background calls `POST /api/lotse/decide` with `{ trigger, events (recent, oldest first), snapshot, context, inference, role?, appKnowledge? }` — on every cycle; local stuck rules only annotate `trigger`.
2. The server asks the **Gemini Decisions API** once (≈ 0.3–0.7 s): Boolean "stuck, would welcome help?" (calibrated probability) + Choice "which feature is the goal?" (the app's feature names). Fallback on error: lite model.
3. Response: `{ intervene, confidence, threshold }` and, if `intervene`, `{ intent, offer, offerId }`. `intervene` is true only if `confidence ≥ threshold` — **the user's own threshold** (starts at 0.8).
4. Target UX (the current extension still requests guidance directly after a positive decision, with a 2-min cooldown): show `offer` in the offer bubble with **Ja / Nein** and **👍 / 👎**:
   - "Ja" → `/ask` with `question = intent`, `source: "proactive"`.
   - "Nein" → `POST /api/lotse/feedback { offerId, feedback: "declined" }` (threshold +0.02).
   - 👎 → `feedback: "down"` (+0.05, fewer offers) · 👍 → `feedback: "up"` (−0.02).
   - Feedback counts **once per offerId** (repeats return the current prefs). Unknown offerId → 404. Threshold clamped to 0.6–0.95 (`PROACTIVE_THRESHOLD`).
5. Settings UI: `GET /api/lotse/prefs` shows the current threshold; `PUT` sets it manually.

Events carry no search terms (privacy), so `intent` can be generic ("Wie komme ich auf dieser Seite weiter?") when the goal is unclear.

## `/events` — analytics ingest

`POST { appId?, events: LotseEvent[] }` with ≤ 100 events per batch, ≤ 6 batches/min per session → batch on the client (e.g. flush every 10 s or at 50 events, plus on `pagehide`). Returns `202 { accepted }` immediately; storage happens after the response (`lotse_events`). Privacy: labels/roles only, `detail` like `results=0;searchLength=4` — never input values or typed text.

## Error codes (`GuidanceEvent` `error.code` / JSON `error.code`)

| Code | HTTP | Meaning / client behavior |
| --- | --- | --- |
| `bad_request` | 400 / 413 / 404 | Body invalid or too large; 404 = unknown `offerId`. Don't retry unchanged. |
| `unauthorized` | 401 | Missing/expired token (production). Refresh the Supabase session, retry once. |
| `rate_limited` | 429 | Per-minute limit. Honor `Retry-After` (seconds). |
| `budget_exceeded` | 429 | Daily token budget used up. Show "Valo macht Pause bis morgen". |
| `timeout` | 200 (in stream) / 504 (legacy) | Tier timeout. Keep what was already shown; offer "nochmal versuchen". |
| `internal` | 500 / 503 | Server/model error; 503 = kill switch `LOTSE_DISABLED=1`. |

`/live-token` keeps its own shape for the voice client: `{ error: "<code>", message }`.

## Tracking & limits (server)

- Every LLM / decision call → `public.agent_usage` (route `state` / `intent` / `decide` / `ask`, tier, model, tokens, latency, status, session/user/app id). Events → `public.lotse_events`. Offers/feedback/thresholds → `lotse_offers`, `lotse_offer_feedback`, `lotse_user_prefs`. All RLS-on, service role only.
- Limits are in-memory per server process; all configurable via env (`.env.example`, `src/lib/lotse/config.ts`): `LOTSE_LIMIT_ASK_PER_MIN` (20), `LOTSE_LIMIT_STATE_PER_MIN` (60), `LOTSE_LIMIT_INTENT_PER_MIN` (60), `LOTSE_LIMIT_DECIDE_PER_MIN` (60), `LOTSE_LIMIT_EVENTS_PER_MIN` (6), `LOTSE_LIMIT_PREFS_PER_MIN` (20), `LOTSE_LIMIT_LIVE_TOKENS_PER_MIN` (8 voice sessions per session), `LOTSE_LIMIT_LIVE_TOKENS_GLOBAL_PER_MIN` (60), `LOTSE_LIMIT_GLOBAL_PER_MIN` (300 per kind), `LOTSE_DAILY_TOKEN_BUDGET` (2 000 000 LLM tokens per caller/day across state/intent/decide/ask; one observation cycle ≈ 5–10 k), `LOTSE_TIMEOUT_STATE_MS` (6 000), `LOTSE_TIMEOUT_INTENT_MS` (8 000). Kill switch `LOTSE_DISABLED=1`.
- Context (`src/lib/lotse/context.ts`, per `/state`, `/intent`, `/decide` + `/ask`): app id (`x-lotse-app` / `appId` / snapshot host, or a dashboard `apps.id` uuid) → `apps.domains` → org → `app_features`. **Role:** an authenticated member of that org gets `org_members.role`; the client `role` is ignored then and only used in dev/anonymous mode. **Knowledge base** (`searchKnowledge`, `match_documents`) is scoped to the app's org and open to its members (dev: anonymous too). Features the role may not use reach the model with name + allowed roles only (no path). `AskRequest.appKnowledge` goes into the prompt as untrusted `<app_notes>` (≤ 2 000 chars). Responses carry `x-lotse-context: knowledge=db|fixture|none;org=yes|no;role=org|client|none`.
- `LOTSE_KNOWLEDGE_SOURCE=auto` (default) uses the DB and falls back to the bundled fixture `src/lib/lotse/fixtures/kundenwerk-features.json` (copy of `demo-crm/lotse-features.json`, `localhost:4000`) when the app is missing, has no features or the DB is unreachable (warning, never an error); `db` = same, but also warns on a missing app; `fixture` = never touches the DB. Lookups (incl. misses) are cached 60 s in memory (errors 15 s).
- Empty local DB and no `db reset` allowed? `npm run seed:dev-org -w @lotse/server [-- --with-user | --with-knowledge]` adds the demo org + Kundenwerk app + features (same ids as `supabase/seeds/dashboard.sql`), optionally the test user `vertrieb@demo.test` (role Vertrieb) and the CRM FAQ as knowledge — additive, idempotent, local DB only.

Code: `src/lib/lotse/` — `observe.ts` (`/state` + `/intent`), `orchestrator.ts` (tiers), `agent.ts` (tool loop + streaming), `images.ts` (screenshots → image parts), `prompt.ts`, `knowledge.ts` + `context.ts` (app/org/role), `decide.ts`, `prefs.ts`, `guard.ts` + `config.ts` (auth/limits/body caps/timeouts), `usage.ts` (tracking).

## Agent memory + knowledge gaps (D-28, R-LRN-3/5)

Valo learns incrementally from usage and keeps it **apart from the curated knowledge base**: table `agent_memory` (+ `agent_memory_evidence`), always shown to the model as a labeled `<agent_memory>` block. Code: `src/lib/lotse/memory.ts` (store + read path), `src/lib/lotse/gaps.ts` (gaps + learning after `/ask`). Migration `20261114123416_agent_memory.sql`.

- **Learning (write):** after every explicit `/ask` (text/voice, not proactive; background, after the answer) one lite-model call (`gemini-3.5-flash-lite`, ≤ 5 s, `agent_usage.route = 'memory'`) maps the question to a neutral topic (2–4 words, known topics reused, names/numbers/placeholders stripped) and the feature it meant. **The question is never stored.** Then: no `point`/`plan` (and not role-blocked) or `searchKnowledge` without hits → `knowledge_gaps` (count + distinct persons); answered with a feature → `faq` memory evidence ("„IBAN ändern“ meint die Funktion …"); role-blocked → `role_hint`. Evidence is per hashed subject (`sha256(salt:caller.key)`), so a person counts once.
- **Promotion:** `proposed` → `active` only at ≥ 5 distinct persons and no negative evidence (SQL `record_agent_memory_evidence`) or by an org admin; 👎 on a `/decide` offer → negative evidence for memories of that intent, ≥ 2 → back to `proposed`; no support for `LOTSE_MEMORY_TTL_DAYS` (60) → `expired`. The model has **no memory tool** — page content can't activate anything.
- **Use (read):** `/ask` gets ≤ 6 ranked active memories (≤ 1 200 chars) as `<agent_memory>` (system prompt: learned, lower priority than `<features>`); `/decide` gets ≤ 4 as `learned` in the Decisions API state; `searchKnowledge` also searches active memories by embedding (`match_agent_memory`). Cached 60 s per org/app. Same access rule as the knowledge base (org members; anonymous in dev).
- **Admin API** `GET /api/lotse/memory?app=<apps.id|host>&status=…` → `{ orgId, appId, minPersons, ttlDays, expired, memories, gaps }` (gaps only ≥ 5 persons, open) · `POST /api/lotse/memory` `{ action: approve|reject|expire, id }` · `{ action: "create", kind, topic, content, feature? }` · `{ action: "resolve_gap", gapId, content }` (→ active `gap_resolution`) · `{ action: "dismiss_gap", gapId }`. Auth: Bearer token of an org admin; dev also without token (`app` defaults to `localhost:4000`). 20/min. Errors `{ error: { code, message } }`.
- **Hooks for the learn loop:** `proposeMemory({ orgId, appId, kind, topic, content, feature?, source: "learn_loop", subjects })`, `reinforceMemory(id, subjects, polarity)`, `expireStaleMemories(orgId)`, `listGaps(orgId, { appId })`.
- Env: `LOTSE_MEMORY=0` (no learning), `LOTSE_MEMORY_TTL_DAYS` (60), `LOTSE_PSEUDONYM_SALT`.

## Insights pipeline (`POST /api/insights/generate`, dashboard data — R-INS-1..3, D-12, D-13)

Turns collected usage into aggregated pain points, training suggestions and UX improvement potential. **Aggregates only, never per person: every group needs ≥ 5 distinct pseudonyms** (`MIN_GROUP`; smaller groups are dropped before anything is returned, written or sent to Gemini). Person = pseudonym `u:<user id>` / `s:<session id>` (same as the runtime caller key).

`POST /api/insights/generate` with optional JSON `{ appId?, orgId?, days?, write?, llm? }`:
- `appId`: dashboard `apps.id` or a domain like `localhost:4000` (default: `localhost:4000`, the Kundenwerk CRM). Runtime rows are matched by every domain of the app plus its uuid.
- `days` 1–90 (default 30) · `write` (default true) writes the dashboard's `public.insights` rows · `llm` (default true) = one Gemini call (`MODELS.fast`, structured output, ~8 s, ~2k tokens, logged in `agent_usage` with `route = 'insights'`); `false` = rule-based pain points only.
- Auth: `Authorization: Bearer <token>` of an **admin of the app's org** (`is_org_admin`); without a token only in dev (`NODE_ENV ≠ production` or `LOTSE_DEV_AUTH=1`). 5 calls/min per server process; `LOTSE_DISABLED=1` → 503. Errors: `{ error: { code, message } }`.

Response (JSON): `period`, `minGroupSize`, `totals { persons, events, offers, suppressedGroups }`, `features[]` (one per feature × role group, role `null` = all roles: `persons, stuckRate, stillStuckAfterHint?, abandonedFlow?, featureSearches, offers, declined, thumbsUp, thumbsDown, questions, signals, verdict`), `frequentIntents[]` (offer intents = feature names, no raw text), `summary` + `painPoints[] { feature, role?, kind: schulung|app, severity, evidence, trainingTitle? (exact catalog title), suggestedTraining?, uxSuggestion?, catalogMatches[] }`, `written { inserted, updated, retired, period }`, `model { id, status }`.

How the metrics are derived (code: `src/lib/insights/aggregate.ts`, Gemini step: `generate.ts`):
- **Feature attribution** per event: `detail` `matchedFeature=<name>` (search term matched locally in the extension) → that feature; else `element_label` = a click-path step (index ≥ 1, or any step of a global `*` feature) on a matching route; labels shared by several flows go to the flow the person last touched unambiguously on that page (≤ 15 min), else nowhere; else a route that belongs to exactly one feature.
- **Stuck signals**: `rage_click`, `error`, `empty_results` / search with `results=0`, `idle` on a flow field, ≥ 2 searches for the same feature, and every `/decide` offer (`lotse_offers`, the server judged "stuck").
- `stuck_rate` = persons with a stuck signal / persons on the feature · `still_stuck_after_hint` = persons stuck again on the same feature after their first not-declined offer / those persons · `abandoned_flow` (features with ≥ 4 click steps) = started (step ≥ 1) but no submit / last step after the last error · `question_count` = not-declined offers on the feature (explicit `/ask` questions are not stored per feature yet).
- **Dashboard rows**: "all roles" rows for every feature group ≥ 5; a role row only when it differs ≥ 0.15 from all roles. Update-or-insert per org/app/feature/role/metric/period (period = today); rows of the same org/app/period that no longer qualify get `persons = 0` (hidden by the dashboard's RLS) — nothing is deleted. Verdict rule = the dashboard's (`still_stuck_after_hint ≥ 0.5` → app, `stuck/abandoned ≥ 0.3` → Schulung). The generated texts (summary, training/UX suggestions) have no column in `insights` → JSON only.

Demo data: `node apps/server/scripts/insights-seed-demo.mjs [--no-members] [--with-trainings]` (after `seed:dev-org`) adds synthetic usage for the Kundenwerk CRM — 15 synthetic colleagues (`kolleg-NN@demo.test`, roles Vertrieb 7 / Buchhaltung 6 / Admin 2, random unused passwords), ~10 days of events, offers and 👍/👎: IBAN → "App verbessern", Angebot erstellen (Vertrieb) and Standard-Zahlungsziel (searched a lot) → "Schulung", Notiz (3 persons) suppressed. `--with-trainings` adds two matching Kundenwerk trainings to `training_catalog`. Local DB only, additive and idempotent, never deletes. Then: `curl -s -X POST http://localhost:3001/api/insights/generate`.
