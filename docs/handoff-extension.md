# Lotse extension — handoff

Status: 2026-11-14. This document is the entry point for the next agent working on the browser extension. Read `AGENTS.md`, this document, `docs/extension-observability.md`, and `packages/shared/src/index.ts` before changing the implementation.

## Idea and confirmed scope

Lotse observes an employee using a business web app, understands the sequence of UI states and actions, infers the workflow and intent, and offers contextual guidance. Guidance uses the actual page: a frame, arrow and short explanation identify the next element. The employee performs the action; Lotse never clicks or fills fields. The original targets are CORPUS and the EBV portal; the repository includes a local sample CRM.

The user owns the Gemini endpoints needed for observability. This implementation owns the extension and its shared data contracts. All LLM and decision models must be Google Gemini. The Gemini key stays in the repository-root `.env.local` and is only used by the server.

The user explicitly reconfirmed these two flows. Preserve their order; do not replace the separate inferences with a single decision call or put a heuristic gate before all model calls.

**Proactive:**

1. Capture actions, navigation and semantic DOM changes.
2. Send events and the current DOM snapshot to the UI-state inference endpoint.
3. Store the inferred UI-state/action entries in a local chronological buffer. Capture screenshots independently and keep them local.
4. Send the state sequence and application context to workflow/intent inference.
5. Send workflow/intent and application knowledge to the separate Gemini intervention decision.
6. Only when `intervene` is true, attach selected screenshot history and request actual guidance.
7. Validate the result against the current page and show the explanation/highlight.

**Explicit question / future wake word:** send the question, current UI, existing workflow/intent, relevant history and application knowledge directly to guidance. Do not call state, intent or intervention inference as part of this request. Ongoing observation may resume after the question completes.

## Standing user instructions

- Work directly on `main`, commit and push directly to `origin/main`. No PRs. Never force-push.
- Use subagents for independent work when useful. Assign non-overlapping files.
- Do not create or run tests, including browser tests and `npm run ai:check`. The user stated this as a general rule. Static type checking, linting and builds are allowed.
- Use only Google Gemini for LLM/decision calls. No Web Speech/cloud-provider fallback. A local wake-word detector is a separate non-LLM component, not implemented here.
- Test data only. CORPUS vehicle/fleet pages contain real data and must stay outside the demo.
- Coordinate changes to the shared HTTP contract with the server owner. Do not edit server/dashboard code without coordinating with its owner.

## Repository layout

This is one npm-workspaces monorepo, not a Next.js app running inside Chrome.

| Area | Location | Responsibility | Local port |
| --- | --- | --- | --- |
| Extension | `apps/extension` | WXT 0.21.5, TypeScript, Chrome MV3 | 3002 for WXT development |
| Runtime | `apps/server` | Next.js, all Gemini endpoints and keys | 3001 |
| Dashboard | `apps/dashboard` | Organizations, application knowledge, roles, insights | 3000 |
| Shared | `packages/shared` | Zod schemas and TypeScript contracts | — |
| Sample target | `demo-crm` | Static local CRM, sample data | 4000 |

The extension is bundled independently. Content scripts and the side panel communicate with the service worker. Only the service worker makes runtime HTTP requests.

## Implemented

### Collector and page representation

`apps/extension/entrypoints/content.ts` implements:

- Explicit start/pause of recording. Ordinary page loading does not start observation.
- Trusted clicks, form focus, search interactions, submission/validation events, visible errors and empty-results signals. Editable input values and search terms are not included in events.
- SPA route detection, including hash-router paths. Query strings are omitted from recorded URLs/routes because they can contain entered data.
- DOM observation with a debounce, and form-inactivity signals. Hidden-tab time is not treated as an active form pause.
- Numbered semantic snapshots: up to 120 interactive elements, accessible labels, roles, disabled state and bounding rectangles, plus up to 20 status/error messages. An open modal is used as the interactive scope.
- State IDs remain stable while the current semantic state is unchanged. Scroll geometry and capture time do not change the ID; semantic changes do.
- Snapshot-ID validation before drawing a highlight; missing, hidden, disabled or stale targets are rejected.
- A Shadow DOM frame, arrow/bubble, and local-recording indicator. The overlay follows scrolling/resizing and does not intercept clicks. It works with native dialog top layers. Clicking the highlighted element clears the hint, including when recording is paused.
- Cleanup of event listeners, timers and observers on WXT content-script invalidation. Lotse's own UI is excluded from observation.

### Local history and workflows

`apps/extension/utils/observation.ts` implements `ObservationBuffer`:

- `record({ event?, snapshot? })`, `addScreenshot(frame)`, `addState(inference)`, `getContext(options)`, `serialize()`, `restore(value)`, `clear()`.
- A three-minute rolling window with count/size bounds: 180 events, 40 DOM snapshots, 40 inferred UI-state/action entries, 36 screenshots and approximately 6 MiB of stored base64 screenshot strings. Count limits can evict entries before three minutes.
- Structural workflow segmentation after 30 seconds without a user action. This is not semantic intent inference; Gemini supplies the workflow name and intent.
- Event-to-workflow association, route sequences, chronological model-inferred states and snapshot references.
- A request context containing the current state, up to 12 previous DOM states and up to four temporally distributed screenshot frames. A baseline state/frame before the current workflow may be retained.
- Separate screenshot timestamps. Different pixels may share a semantic DOM-state ID, for example when only a search input's value changes. Only identical consecutive images are redundant.
- Local rule annotations for repeated errors, unsuccessful searches, route ping-pong and form inactivity. In the confirmed staged pipeline, these enrich the decision trigger; they do not gate the UI-state and intent calls.
- Backward-compatible restoration of earlier version-1 buffers without inferred-state entries.

### Service worker and inference orchestration

`apps/extension/entrypoints/background.ts` implements:

- A selected recording tab; HTTP localhost and 127.0.0.1 are the current allowed hosts.
- The four-stage proactive pipeline described above, with approximately one-second coalescing of relevant actions/changes. Unchanged screenshot/status polling does not trigger repeated model calls.
- A queue for observations arriving during an inference call. Results from an older state can be preserved in history, but a newer state is processed before showing unsolicited guidance.
- Direct explicit questions, including the `lotse:wake-question` adapter message. An explicit question preempts an in-flight proactive pipeline; generation/ownership checks prevent its old result from overwriting the question.
- Screenshots every five seconds and after observed changes, limited to about one capture per second. Only the active recording tab in a focused window is captured. The page/tab/state is checked before and after capture.
- JPEG quality 40. Frames larger than the schema's 600,000-character limit are skipped, with a status message. There is no image-resizing pipeline yet.
- No screenshot uploads to state, intent or decision inference. The request schemas enforce empty screenshot arrays for intent and decision. Selected frames are attached only to guidance after a positive decision, or directly for an explicit question.
- A two-minute interval between proactive guidance hints. State/intent/decision inference can still run for new actions during that interval.
- Twenty-second HTTP timeouts, aborts when paused/preempted, response-schema validation and clear missing-endpoint errors. No fabricated local intent/help fallback.
- Both the old JSON guidance response and the current NDJSON `GuidanceEvent` stream. `point` markers are applied as the event arrives; `say` text and plans are displayed. The first step of a plan is highlighted when resolvable; later steps are not searched automatically. Automatic plan advancement remains open.
- A browser-session ID in `x-lotse-session` and the current app host including port (e.g. `localhost:4000`) in `x-lotse-app`; `/ask` requests explicitly accept NDJSON. No app cookies/tokens are read.
- Bounded `chrome.storage.session` persistence across MV3 worker restarts. Expired entries are pruned on access; this is not a scheduled physical deletion guarantee while the worker is suspended.

### Operator UI and packaging

`apps/extension/entrypoints/sidepanel` provides start/pause, local action/state/frame/inference counts, recent actions, inferred workflow/intent, runtime status, text questions, a screenshot toggle, and manually supplied demo role/application knowledge. It is a development/demo surface, not finished organization onboarding.

`apps/extension/wxt.config.ts` adds `activeTab` for screenshot capture and the `Alt+L` command to open the side panel. Existing permissions are `sidePanel`, `storage`, `tabs`; host permissions remain local-only.

`apps/extension/eslint.config.mjs` and its package lint command reuse the monorepo's installed TypeScript lint toolchain. `npm run lint` now checks extension source as well.

## Exact API integration points

The user must implement or finish these runtime routes. See `docs/extension-observability.md` for payload examples.

| Route | Request schema | Response schema | Images |
| --- | --- | --- | --- |
| `/api/lotse/state` | `UIStateRequestSchema` | `UIStateInferenceSchema` | None |
| `/api/lotse/intent` | `IntentRequestSchema` | `WorkflowIntentSchema` | None |
| `/api/lotse/decide` | `DecideRequestSchema` | `DecideResponseSchema` | None |
| `/api/lotse/ask` | `AskRequestSchema` | NDJSON `GuidanceEventSchema`, or legacy `AskResponseSchema` | Up to four |

Important details:

- State inference must echo the requested `snapshotId`. The extension uses the request's capture timestamp for the stored state entry.
- Intent input includes `context.states`, which contains the inferred chronological UI states/actions, as well as the raw context.
- Decision input includes `inference: { workflowName, intent }`, image-free `context`, up to 50 recent events, the snapshot and role/application knowledge. `trigger` is a string, including `workflow_update` when no local rule annotated the sequence.
- `DecideResponseSchema` is the current wire contract: `intervene`, `confidence`, optional text `intent`, `offer`, `offerId`, `threshold`. Structured workflow/intent comes from the preceding endpoint.
- The earlier draft exports `DecisionRequestSchema`/`DecisionResponseSchema` also remain in shared; the current extension uses the runtime's `Decide*` schemas. Consolidate these only after coordinating with the endpoint owner.
- Guidance sends `source: text | voice | proactive`, the original question or inferred goal, current snapshot, existing structured intent, image/history context and at most 50 `recentEvents`. Questions are limited to 500 characters by the runtime contract.
- Convert screenshot data URLs into actual Gemini multimodal image parts. Do not merely concatenate base64 strings into a text prompt.
- The current client treats `intervene` as the server's final decision; the runtime owns calibrated confidence/threshold logic.
- Align request timeouts during runtime integration: the extension aborts after 20 seconds, while the runtime permits up to 40 seconds for its reasoning tier.
- CORS must allow the extension origin and `Content-Type`, `x-lotse-session`, `x-lotse-app` (plus `Authorization` for later login). The client sends session/app headers but does not yet provide a Supabase bearer token.

## Remaining work, in priority order

1. **Complete the user-owned state and intent endpoints and align decision/guidance with the shared contract.** There is no local fake implementation. Make sure the server consumes `context.states`, `inference`, application knowledge and, for guidance only, actual image inputs. The existing server and shared NDJSON work arrived through team commits and was preserved. The runtime guide currently specifies a 256 KB body cap, while history with four frames can be larger; align the cap/image processing with the server owner. Its default six decision calls/minute also needs coordination with the staged observation cadence. Existing `apps/server/scripts/lotse-smoke.mjs` belongs to teammate work and must not be run under the user's no-tests instruction.
2. **Finish local multi-step guidance.** Plans are displayed and their first step can be highlighted when resolvable; next/back/progress state, matching after clicks/navigation, cross-document continuation and an animated agent cursor are not implemented. Keep guidance read-only.
3. **Implement real voice input.** The message hook and shortcut exist; wake-word detection, offscreen audio document, microphone-permission page, Gemini Live transcription and optional speech for `say` events do not. Start at `apps/server/VOICE.md`; route the transcribed question through direct guidance. Never introduce a non-Gemini transcription fallback.
4. **Connect organization identity and knowledge.** *Done (D-27):* side-panel login (Supabase email/password, `utils/auth.ts`, session in `chrome.storage.session`), `Authorization: Bearer` on every runtime call with refresh + one retry on 401, org/app/role shown from `GET /api/lotse/policy`; signed in, the manual demo role is not sent. *Open:* dashboard-managed per-app allowlist/blocklist (today: server env), Entra ID. A declared client role is not an authorization boundary.
5. **Implement proactive user controls and feedback.** `proactive/voice/speak` settings, accepting/declining offers, ten-minute snooze, thumbs up/down, `/feedback` and `/prefs` are present in the runtime/shared planning but not wired in this UI. The current positive decision directly requests and shows guidance.
6. **Connect analytics.** There is no `/events` batching/ingest from this client and no extension-side storage of per-org records on the server. Raw observations are sent as inference context only. Connect aggregate pain-point and hint-outcome reporting deliberately with the runtime owner.
7. **Adapt observation to real demo apps.** Error/empty-state recognition uses generic DOM selectors and text patterns. Only standard DOM controls are enumerated; cross-origin iframes, closed shadow roots, custom canvases and app-specific workflow success signals need adapters.
8. **Harden data and storage handling before any production use.** Input values are omitted from semantic events, but screenshots are unmasked and visible labels/messages can contain business data. *Done (D-27):* app policy per host with automatic CORPUS vehicle/fleet route exclusion, enforced fail closed in content script and service worker (`utils/policy.ts`, `paused()` in `content.ts`, `blockedUrl()` in `background.ts`). *Open:* full screenshot redaction, scheduled expiry during worker suspension, or quota-recovery/image resizing. The demo must use only permitted local test pages and sample data.
9. **Polish UI behavior and chat history.** There is one current answer, not a persisted chat conversation; status/overlay behavior across complex modal lifecycles and window changes remains a development concern.

## Validation and delivery

- Completed static checks: `npm run typecheck`, `npm run lint` (all workspaces, including the extension), and `npm run build -w @lotse/extension`. Repeat these after implementation changes.
- No browser runs, Gemini requests, test files or test suites were performed for this task, per the user's explicit instruction. Do not claim 20/20 demo reliability or the latency target has been established.
- The production bundle is generated at `apps/extension/.output/chrome-mv3`; generated bundles/types are ignored by Git. Source and documentation are committed directly to main.

From the repository root:

```sh
npm install
npm run typecheck
npm run lint
npm run build -w @lotse/extension
```

For ordinary use, start the independently owned runtime with `npm run dev:server`, optionally serve the sample app with `npm run demo:crm`, then load `apps/extension/.output/chrome-mv3` through Chrome's Extensions page → Developer mode → Load unpacked. Open the permitted app, click the Lotse toolbar icon, enter the demo context and start recording. `Alt+L` opens the question panel. The toolbar gesture also grants the temporary active-tab permission required for image capture.

## Suggested next-agent division

- One agent can work on voice/offscreen integration.
- Another can finish read-only multi-step guidance in the content script.
- A third can connect org settings/auth/feedback in the service worker and panel.
- Keep endpoint/model work with the user/server owner. Serialize shared-schema changes; don't have multiple agents rewrite the contract at once.
