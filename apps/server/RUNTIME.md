# Lotse runtime — integration guide for the extension

Server: `apps/server` (Next.js, `http://localhost:3001` = `LOTSE_DEFAULTS.serverUrl`). Contract: `@lotse/shared` (zod schemas, validate responses with them).
Lotse **only marks** (highlight, step plan, short text). There is no endpoint or event that clicks or types.
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
| `POST /api/lotse/ask` | `AskRequest` → NDJSON stream of `GuidanceEvent` (or legacy JSON) | 20/min + daily token budget |
| `POST /api/lotse/decide` | `DecideRequest` → `DecideResponse` | 6/min + daily token budget |
| `POST /api/lotse/feedback` | `OfferFeedbackRequest` → `ProactivePrefs` | 20/min |
| `GET /api/lotse/prefs` | – → `ProactivePrefs` | 20/min |
| `PUT /api/lotse/prefs` | `ProactivePrefs` → `ProactivePrefs` (manual override, clamped 0.6–0.95) | 20/min |
| `POST /api/lotse/events` | `EventBatch` (≤ 100 events) → `202 { accepted }` | 6 batches/min |
| `POST /api/lotse/live-token` | – → `LiveTokenResponse` (`wsUrl` + token, see VOICE.md) | **8 voice sessions/min** per session (one token = one spoken question), 60/min global |

Input caps (server trims, you don't have to): question ≤ 500 chars (longer → 400), ≤ 300 snapshot elements, labels ≤ 80 chars, body ≤ 256 KB. Send **labels only, never input values**.

## `/ask` — NDJSON stream

Request with `Accept: application/x-ndjson`. Each line is one `GuidanceEvent` (parse with `GuidanceEventSchema`), flushed as soon as known:

1. `{"type":"tier","tier":"point|guide|reason","model":"…"}` — always first (status UI: "Lotse sucht …").
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

**Legacy JSON** (walking skeleton): without `Accept: application/x-ndjson` the response is `AskResponse` `{ elementNumber, sentence }` (first `point` or first current-page plan step; `say` text, else the point hint / plan summary). `source` may be omitted (defaults to `"text"`). Errors: `{ error: { code, message } }`.

## Tiers (server-side orchestrator)

A heuristic (no LLM) picks the tier from question cues, the current page labels and the app's feature list (role-aware). Only when unsure, a Choice question to the Gemini Decisions API (`gemini-decision-1`, ≤ 1.5 s) decides.

| Tier | When | Model | Steps | Max output tokens | Thinking | Timeout |
| --- | --- | --- | --- | --- | --- | --- |
| `point` | target on this page ("wo ist …") | `gemini-3.5-flash-lite` | 3 | 600 | minimal | 8 s |
| `guide` | multi-step ("wie lege ich … an"), other page, role restriction | `gemini-3.5-flash-lite` | 5 | 2 000 | low | 20 s |
| `reason` | long / analytical / ambiguous | `gemini-4-argon` | 8 | 4 000 | low | 40 s |

## Proactive help: `/decide` + feedback (adaptive threshold, D-22)

1. A local stuck rule fires in the content script → background calls `POST /api/lotse/decide` with `{ trigger, events (recent, oldest first), snapshot?, role? }`.
2. The server asks the **Gemini Decisions API** once (≈ 0.3–0.7 s): Boolean "stuck, would welcome help?" (calibrated probability) + Choice "which feature is the goal?" (the app's feature names). Fallback on error: lite model.
3. Response: `{ intervene, confidence, threshold }` and, if `intervene`, `{ intent, offer, offerId }`. `intervene` is true only if `confidence ≥ threshold` — **the user's own threshold** (starts at 0.8).
4. Show `offer` in the offer bubble with **Ja / Nein** and **👍 / 👎**:
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
| `budget_exceeded` | 429 | Daily token budget used up. Show "Lotse macht Pause bis morgen". |
| `timeout` | 200 (in stream) / 504 (legacy) | Tier timeout. Keep what was already shown; offer "nochmal versuchen". |
| `internal` | 500 / 503 | Server/model error; 503 = kill switch `LOTSE_DISABLED=1`. |

`/live-token` keeps its own shape for the voice client: `{ error: "<code>", message }`.

## Tracking & limits (server)

- Every LLM / decision call → `public.agent_usage` (route, tier, model, tokens, latency, status, session/user/app id). Events → `public.lotse_events`. Offers/feedback/thresholds → `lotse_offers`, `lotse_offer_feedback`, `lotse_user_prefs`. All RLS-on, service role only.
- Limits are in-memory per server process; all configurable via env (`.env.example`, `src/lib/lotse/config.ts`): `LOTSE_LIMIT_ASK_PER_MIN` (20), `LOTSE_LIMIT_DECIDE_PER_MIN` (6), `LOTSE_LIMIT_EVENTS_PER_MIN` (6), `LOTSE_LIMIT_PREFS_PER_MIN` (20), `LOTSE_LIMIT_LIVE_TOKENS_PER_MIN` (8 voice sessions per session), `LOTSE_LIMIT_LIVE_TOKENS_GLOBAL_PER_MIN` (60), `LOTSE_LIMIT_GLOBAL_PER_MIN` (300), `LOTSE_DAILY_TOKEN_BUDGET` (200 000 LLM tokens per caller/day). Kill switch `LOTSE_DISABLED=1`.
- Knowledge: `LOTSE_KNOWLEDGE_SOURCE=db` reads the dashboard's `apps.domains` + `app_features` (fallback: bundled fixture `src/lib/lotse/fixtures/kundenwerk-features.json` for `localhost:4000`).

Code: `src/lib/lotse/` — `orchestrator.ts` (tiers), `agent.ts` (tool loop + streaming), `prompt.ts`, `knowledge.ts`, `decide.ts`, `prefs.ts`, `guard.ts` + `config.ts` (auth/limits), `usage.ts` (tracking).
