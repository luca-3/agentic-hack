# Extension observability: runtime contract

The user implements the Gemini endpoints in apps/server. The extension lives in apps/extension and calls the runtime only from its service worker. All wire schemas are in packages/shared/src/index.ts (@lotse/shared).

## Confirmed flows

Proactive: events + semantic DOM -> UI-state inference -> local inferred state/action sequence -> workflow/intent inference -> intervention decision -> only if positive, guidance with selected screenshots.

Explicit question: question + current UI + existing workflow/intent + history + application knowledge -> guidance directly. This request does not invoke state, intent or decision inference.

Screenshots are recorded locally in parallel. They are NEVER included in the first three calls. Intent and decision schemas require an empty screenshot array.

## Endpoints

| POST route | Request | Response | Images |
| --- | --- | --- | --- |
| /api/lotse/state | UIStateRequestSchema | UIStateInferenceSchema | None |
| /api/lotse/intent | IntentRequestSchema | WorkflowIntentSchema | None |
| /api/lotse/decide | DecideRequestSchema | DecideResponseSchema | None |
| /api/lotse/ask | AskRequestSchema | NDJSON GuidanceEventSchema; legacy AskResponseSchema supported | At most four |

The base URL is LOTSE_DEFAULTS.serverUrl (http://localhost:3001). Every request includes Content-Type: application/json, x-lotse-session (random browser-session ID), and x-lotse-app (current host including port, e.g. localhost:4000). Guidance explicitly requests Accept: application/x-ndjson. CORS must allow the extension origin and these headers; add Authorization when extension login is implemented.

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

The server should bind snapshotId/capturedAt to the input metadata. Gemini supplies the semantic summary/action. action may be omitted; it is not nullable. The extension rejects a mismatched snapshot ID and stores the inference with the request timestamp.

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

This confidence is a model estimate. The calibrated help decision is the separate next call.

## 3. Intervention decision

Use DecideRequestSchema and DecideResponseSchema, the runtime's canonical wire contract. The extension passes:

- trigger: repeated_search, page_pingpong, form_idle, repeated_error, rage_click or workflow_update.
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

The runtime applies its confidence/threshold policy and returns the final intervene value. An offerId is optional for later feedback. Structured workflow/intent already comes from step 2. The extension currently starts guidance immediately after a positive decision; accept/decline UI and feedback are still open.

Earlier draft DecisionRequestSchema/DecisionResponseSchema exports remain in shared. They are not the wire schemas currently used by this client; coordinate their consolidation with the runtime owner.

## 4. Actual guidance

AskRequestSchema receives:

- question: the user's text, or the inferred goal for proactive assistance; maximum 500 characters.
- source: text, voice or proactive.
- snapshot: the current numbered DOM state.
- observation: workflow, current snapshot, DOM history, inferred states and now selected screenshot frames.
- intent: the structured intent if already available.
- recentEvents: at most 50.
- Optional role, appId and appKnowledge.

A frame is { snapshotId, capturedAt, dataUrl }. dataUrl contains actual base64 JPEG/PNG/WebP bytes, at most 600,000 characters. Convert these frames to Gemini image parts; base64 in a plain text prompt does not provide visual context. Use frame timestamps to interpret the history. Only numbers from the CURRENT snapshot may be returned as targets.

The runtime streams application/x-ndjson, for example:

```json
{"type":"tier","tier":"point","model":"gemini-3.8-flash"}
{"type":"point","elementNumber":0,"label":"Neue Aufgabe","hint":"Hier legst du eine neue Aufgabe an."}
{"type":"done"}
```

The extension validates each event and highlights point events as they arrive. say text and plans are displayed; the first plan step can be highlighted when resolvable. Automatic plan advancement remains open. done terminates the stream; error events surface to the operator. The old JSON response { elementNumber, sentence, snapshotId? } is still accepted.

Use only Google Gemini for UI-state, workflow/intent, decision and guidance models. Keep keys server-only. The extension executes no model-generated code and never clicks or fills app controls.

## Local storage and use

ObservationBuffer retains up to three minutes of bounded history: 180 events, 40 DOM snapshots, 40 inferred states, 36 frames and a 6 MiB base64 budget. Count limits may shorten the effective window. There is no analytics ingest from this client yet; data leaves the browser as inference context only.

Real wake-word detection and microphone/transcription are not implemented. lotse:wake-question is a routing hook for an already-transcribed question and uses direct guidance. See docs/handoff-extension.md for completed work, limitations and next tasks.
