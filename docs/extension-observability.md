# Extension observability: runtime contract

The runtime in apps/server implements all four Gemini endpoints below (live since 2026-11-14; server details in apps/server/RUNTIME.md). The extension lives in apps/extension and calls the runtime only from its service worker. All wire schemas are in packages/shared/src/index.ts (@lotse/shared) — one contract; the earlier draft DecisionRequest/DecisionResponse schemas were removed.

## Confirmed flows

Proactive: events + semantic DOM -> UI-state inference -> local inferred state/action sequence -> workflow/intent inference -> intervention decision -> only if positive, guidance with selected screenshots.

Explicit question: question + current UI + existing workflow/intent + history + application knowledge -> guidance directly. This request does not invoke state, intent or decision inference.

Screenshots are recorded locally in parallel. They are NEVER included in the first three calls. Intent and decision schemas require an empty screenshot array.

## Endpoints

| POST route | Request | Response | Images | Model | Timeout | Body cap | Limit / caller |
| --- | --- | --- | --- | --- | --- | --- | --- |
| /api/lotse/state | UIStateRequestSchema | UIStateInferenceSchema | None | gemini-3.5-flash-lite | 6 s | 256 KB | 60/min |
| /api/lotse/intent | IntentRequestSchema | WorkflowIntentSchema | None | gemini-3.5-flash-lite | 8 s | 1 MB | 60/min |
| /api/lotse/decide | DecideRequestSchema | DecideResponseSchema | None | gemini-decision-1 (lite fallback) | 2.5 s (+2.5 s) | 1 MB | 60/min |
| /api/lotse/ask | AskRequestSchema | NDJSON GuidanceEventSchema; legacy AskResponseSchema supported | At most four | per tier | 8 / 12 / 15 s per tier | 4 MB | 20/min |

All timeouts stay below the extension's 20-second abort. Limits, timeouts and the shared daily token budget (2,000,000 tokens per caller across state/intent/decide/ask) are env-configurable (.env.example). Errors: 400/413 bad_request (413 names the endpoint's cap), 429 rate_limited/budget_exceeded with Retry-After, 504 timeout and 502 internal for state/intent model failures; /decide never fails on model errors (it falls back, then answers intervene: false).

The base URL is LOTSE_DEFAULTS.serverUrl (http://localhost:3001). Every request includes Content-Type: application/json, x-lotse-session (random browser-session ID), and x-lotse-app (current host including port, e.g. localhost:4000). Guidance explicitly requests Accept: application/x-ndjson. CORS allows chrome-extension:// and localhost origins with these headers plus Authorization (for later extension login). A server started in production mode (next start) needs LOTSE_DEV_AUTH=1 as long as the extension sends no bearer token.

## 1. UI-state inference

The request contains the current numbered DOM snapshot and recent workflow events. Example:

```json
{
  "snapshot": {
    "id": "state-1",
    "url": "http://localhost:4000/aufgaben.html",
    "title": "Aufgaben",
    "capturedAt": 1794654000000,
    "elements": [{ "number": 0, "role": "button", "label": "Neue Aufgabe", "route": "/aufgaben.html", "disabled": false }],
    "messages": []
  },
  "events": [{ "id": "event-1", "snapshotId": "state-1", "type": "route", "route": "/aufgaben.html", "ts": 1794654000000 }]
}
```

Response:

```json
{
  "snapshotId": "state-1",
  "capturedAt": 1794654000000,
  "summary": "Die Aufgabenübersicht ist geöffnet; eine neue Aufgabe kann angelegt werden.",
  "action": "Aufgabenübersicht aufgerufen"
}
```

The server binds snapshotId/capturedAt to the request snapshot. Gemini supplies the semantic summary/action from the numbered elements (incl. disabled state), visible messages and the last 20 events. action may be omitted; it is not nullable. The extension rejects a mismatched snapshot ID and stores the inference with the request timestamp. Repeating the same snapshot ID and last event within three minutes is answered from a server cache (x-lotse-cache: hit, no tokens).

## 2. Workflow and intent

IntentRequestSchema receives:

- context.workflow: ID, start/last-activity timestamps, route sequence and recent events.
- context.snapshot: current DOM state.
- context.history: up to 12 previous DOM states.
- context.states: the chronological UIStateInference entries, at least one and at most 40.
- context.screenshots: always [].
- Optional role, appId and appKnowledge (at most 12,000 characters).

WorkflowIntentSchema response:

```json
{
  "workflowName": "Aufgabe anlegen",
  "intent": {
    "goal": "Eine neue Aufgabe anlegen",
    "confidence": 0.8,
    "evidence": ["Aufgabenübersicht aufgerufen", "Formular zur Aufgabenerstellung geöffnet"]
  }
}
```

This confidence is a model estimate. The calibrated help decision is the separate next call. The server adds the organization's app knowledge (feature list with routes, click paths and allowed roles, app name; role from org membership when signed in) and treats appKnowledge as untrusted notes (at most 2,000 characters used). workflowName uses the exact feature name when one matches.

## 3. Intervention decision

Use DecideRequestSchema and DecideResponseSchema, the runtime's canonical wire contract. The extension passes:

- trigger: repeated_search, page_pingpong, form_idle, repeated_error, rage_click or workflow_update.
- triggerReason (optional): the local rule's reason text.
- events: at most 50 recent semantic events, oldest first.
- snapshot: the current DOM state.
- context: the bounded history above with screenshots: [].
- inference: the preceding WorkflowIntentSchema result.
- Optional role, appId and appKnowledge.

Local rules annotate trigger. When none applies, workflow_update is used; it does not skip UI-state or intent inference.

Example response:

```json
{
  "intervene": true,
  "confidence": 0.9,
  "intent": "Eine neue Aufgabe anlegen",
  "offer": "Soll ich dir zeigen, wie du eine Aufgabe anlegst?",
  "threshold": 0.8
}
```

The runtime applies its confidence/threshold policy and returns the final intervene value. An offerId is optional for later feedback. Structured workflow/intent already comes from step 2: the decision model sees the inferred workflow, goal and evidence, the last eight UI states, the route sequence, page messages and recent events; with workflow_update it requires clear evidence of trouble. When no app feature matches but the inferred goal is reasonably sure (confidence ≥ 0.5), intent/offer use that goal. The extension currently starts guidance immediately after a positive decision; accept/decline UI and feedback are still open.

## 4. Actual guidance

AskRequestSchema receives:

- question: the user's text, or the inferred goal for proactive assistance; maximum 500 characters.
- source: text, voice or proactive.
- snapshot: the current numbered DOM state.
- observation: workflow, current snapshot, DOM history, inferred states and now selected screenshot frames.
- intent: the structured intent if already available.
- recentEvents: at most 50.
- Optional role, appId and appKnowledge.

A frame is { snapshotId, capturedAt, dataUrl }. dataUrl contains actual base64 JPEG/PNG/WebP bytes, at most 600,000 characters. The runtime sends these frames to Gemini as real image parts (media type taken from the data URL), oldest first, each captioned with "current/earlier page state" and its age relative to the current snapshot; malformed frames and frames beyond a 2.4-million-character total are dropped (oldest first). The observation's inferred states, route sequence and earlier pages, plus the structured intent, are added as text context. Only numbers from the CURRENT snapshot may be returned as targets.

The runtime streams application/x-ndjson, for example:

```json
{"type":"tier","tier":"point","model":"gemini-3.5-flash-lite","snapshotId":"state-1"}
{"type":"point","elementNumber":0,"label":"Neue Aufgabe","hint":"Hier legst du eine neue Aufgabe an."}
{"type":"done"}
```

The tier event echoes snapshotId (the request snapshot's id) so the client can drop an answer for a page state that has changed. The extension validates each event and highlights point events as they arrive. say text and plans are displayed; the first plan step can be highlighted when resolvable. Automatic plan advancement remains open. done terminates the stream; error events surface to the operator. The old JSON response { elementNumber, sentence, snapshotId? } is still served (snapshotId = echo) and accepted.

Use only Google Gemini for UI-state, workflow/intent, decision and guidance models. Keep keys server-only. The extension executes no model-generated code and never clicks or fills app controls.

## Local storage and use

ObservationBuffer retains up to three minutes of bounded history: 180 events, 40 DOM snapshots, 40 inferred states, 36 frames and a 6 MiB base64 budget. Count limits may shorten the effective window. There is no analytics ingest from this client yet; data leaves the browser as inference context only.

Real wake-word detection and microphone/transcription are not implemented. lotse:wake-question is a routing hook for an already-transcribed question and uses direct guidance. See docs/handoff-extension.md for completed work, limitations and next tasks.
