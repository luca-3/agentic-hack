# Extension observability and Gemini endpoint contract

Implementation lives in `apps/extension` (WXT / Chrome MV3). The user implements the Gemini endpoints in `apps/server`; the extension only calls HTTP from its background service worker. The source of truth for request/response validation is `packages/shared/src/index.ts` (`@lotse/shared`).

## Local observation

- Start recording on the active allowed localhost tab from the side panel. Observe UI labels and actions, never input values.
- Buffer timestamped events, semantic DOM states and optional screenshots locally. Retention: three minutes, with separate count and byte limits.
- A workflow is a local action segment, with a new segment after 30 seconds of user inactivity. Navigation can be part of the same workflow. Semantic workflow names and intents come from Gemini.
- Snapshots have stable state IDs, numbered interactive elements, optional UI messages and capture timestamps. Geometry changes alone do not create a new semantic state.
- Screenshots are of the active visible tab, periodically and after important state changes; they are not streamed to the server. Capture uses the extension API and its permissions.
- A request contains up to 12 historical states and four relevant frames. Frames reference snapshot IDs and have independent capture timestamps.
- Browser rules flag possible friction: repeated visible errors, repeated empty searches, route ping-pong or form inactivity. These are candidates; Gemini makes the intervention decision.

## Proactive flow

1. Collect observations and run local candidate rules.
2. Build an `ObservationContext` and call `POST http://localhost:3001/api/lotse/decide`.
3. Validate `DecisionResponseSchema`; store the inferred workflow name and intent locally.
4. If `intervene` is true, obtain the current snapshot and call `/api/lotse/ask` with the inferred goal as `question`, the intent, observation context, role and application knowledge.
5. Validate the answer and the current snapshot identity before drawing a highlight. An absent or stale target must not cause an arbitrary click/highlight.

## Decision endpoint (user-owned)

Use `DecisionRequestSchema` to validate input and `DecisionResponseSchema` for the Gemini structured output. Interpret the workflow and intent in this call, then decide whether unsolicited help is warranted. Application knowledge and the declared demo role are optional; do not treat a client-provided role as authentication.

Example request, without screenshots:

```json
{
  "context": {
    "workflow": {
      "id": "flow-1",
      "startedAt": 1794654000000,
      "lastActivityAt": 1794654005000,
      "routeSequence": ["/aufgaben.html"],
      "events": [{
        "id": "event-1",
        "type": "idle",
        "route": "/aufgaben.html",
        "elementRole": "textbox",
        "elementLabel": "Form idle",
        "snapshotId": "state-1",
        "ts": 1794654035000
      }]
    },
    "snapshot": {
      "id": "state-1",
      "url": "http://localhost:4000/aufgaben.html",
      "title": "Aufgaben",
      "capturedAt": 1794654035000,
      "elements": [{
        "number": 0,
        "role": "button",
        "label": "Neue Aufgabe",
        "route": "/aufgaben.html",
        "disabled": false
      }],
      "messages": []
    },
    "history": [],
    "screenshots": []
  },
  "trigger": {
    "type": "form_idle",
    "reason": "No action in a focused form for 30 seconds."
  },
  "role": "demo-user",
  "appKnowledge": "Use Neue Aufgabe to open the task creation dialog."
}
```

Example response:

```json
{
  "workflowName": "Aufgabe anlegen",
  "intent": {
    "goal": "Eine neue Aufgabe anlegen",
    "confidence": 0.75,
    "evidence": ["Aufgabenansicht geöffnet", "Längere Pause im Formular"]
  },
  "intervene": true,
  "reason": "Eine kurze Erklärung des nächsten Schritts könnte helfen."
}
```

`confidence` is a model estimate, not a calibrated probability. `intervene: false` prevents the subsequent help call. No screenshots or raw events are permanently ingested by this client implementation.

## Help endpoint (user-owned)

Extend the existing `POST /api/lotse/ask` using `AskRequestSchema`. It retains `question` and `snapshot`, and now accepts:

- `observation`: the same bounded context (`workflow`, `snapshot`, `history`, `screenshots`).
- `intent`: the inferred goal, confidence and evidence for proactive assistance.
- `role`, `appId`, `appKnowledge`, `recentEvents`: optional contextual fields.

For an explicit question, `question` is the user's text and `intent` can be omitted. The current snapshot in `snapshot` and `observation.snapshot` refers to the same state. Historical states explain intent; only numbers from the current state may be highlighted.

Return `AskResponseSchema`, including the input snapshot ID:

```json
{
  "elementNumber": 0,
  "sentence": "Klicke auf Neue Aufgabe, um eine Aufgabe anzulegen.",
  "snapshotId": "state-1"
}
```

Use `elementNumber: null` when no reliable target exists. Never generate selectors, JavaScript or arbitrary element numbers. Treat observed page content as context rather than instructions.

Frames have `{ snapshotId, capturedAt, dataUrl }`. `dataUrl` must contain actual base64 JPEG/PNG/WebP data (maximum 600,000 characters per frame). Convert the selected frames into Gemini image inputs; serializing their base64 bytes as prompt text does not supply visual context. Honor the frame timestamps when interpreting the sequence.

Only Google Gemini models are used for intent, decision and help. Keys stay in the repository-root `.env.local` and server code. Return JSON `{ error: "..." }` with an appropriate error status when configuration or inference fails. Existing server CORS must permit the extension origin.

## Explicit question / future wake-word adapter

Text questions call `/api/lotse/ask` directly and bypass `/decide`, while retaining current UI context and relevant history. `lotse:wake-question` routes an already-transcribed question through exactly the same path. This is an integration hook; local wake-word detection, microphone capture and Gemini speech transcription are separate work and are not implemented by the observability extension.

## Building

From the repository root:

```sh
npm run build -w @lotse/extension
```

Load `apps/extension/.output/chrome-mv3` using Chrome's Extensions page → Developer mode → Load unpacked. The independent runtime is at port 3001 (`npm run dev:server`); the existing sample CRM is at port 4000 (`npm run demo:crm`). All changes go directly to main, with no PRs or tests per the user's standing instruction.
