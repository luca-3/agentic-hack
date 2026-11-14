# Integration review: extension contract (Nils) ↔ server runtime (2026-11-14)

Historical review of the earlier contract and skeleton. The current implementation, resolved mismatches and remaining integration work are documented in [the extension handoff](handoff-extension.md) and [the observability contract](extension-observability.md). D-23 supersedes the screenshot and rule-gating recommendations below.

Read-only review of `main` (Nils' contract commit `6a4d03d` + `docs/extension-observability.md` vs. `apps/server`). `apps/extension` itself is still the walking skeleton and works with today's server (legacy JSON `/ask`).

## Contract mismatches

| Endpoint / field | Extension spec (Nils) | Server today | Fix |
| --- | --- | --- | --- |
| `/decide` body | `DecisionRequest { context{workflow, snapshot, history, screenshots}, trigger{type, reason}, appKnowledge }` | `DecideRequest { trigger(enum), events, snapshot }` → Nils' body = 400 | server adapter: `events = workflow.events.slice(-50)`, `snapshot = context.snapshot`, trigger map below |
| trigger names | `unsuccessful_searches`, `route_ping_pong`, `repeated_error`, `form_idle` | `repeated_search`, `page_pingpong`, `repeated_error`, `form_idle`, `rage_click` | map 1:1 |
| `/decide` response | `{ workflowName, intent{goal, confidence, evidence}, intervene, reason }` | `{ intervene, confidence, intent, offer, offerId, threshold }` | return both; keep `offerId`/`threshold` so 👍/👎 feedback (D-22) works |
| confidence | "model estimate, not calibrated" | calibrated P(stuck) from Decisions API vs. per-user threshold | use the server meaning |
| `/ask` | sends `observation`, `intent`, `appKnowledge`; expects legacy JSON + `snapshotId` | parses, ignores them; no `snapshotId` echo | use `intent.goal`/`evidence`, echo `snapshotId`; extension should move to NDJSON `GuidanceEvent` |
| `appKnowledge` | client sends up to 12 k chars | org knowledge comes from dashboard DB | server ignores/caps it (injection + token risk) |
| headers | none sent | needs `x-lotse-session`, `x-lotse-app`, `Accept: application/x-ndjson` | without them all users share one rate-limit bucket, budget and proactive threshold |
| voice | `lotse:wake-question` | `lotse:ask { source: "voice" }` | use `lotse:ask` only |
| settings | two models (`lotse:settings` with screenshots/role/appKnowledge vs. `LotseSettings` proactive/voice/speak) | – | unify |

## Data volume (estimates)
- One element ≈ 200 B → 100 elements ≈ 20 KB, 300 ≈ 60 KB per snapshot.
- Nils' full `/ask` spec (snapshot sent twice + 12 history snapshots + 180 events) ≈ 300 KB **without images** → over the server cap (256 KB → 413).
- Screenshots: one visible-tab JPEG ≈ 130–330 KB base64; spec allows 4 × 600 k chars. Contradicts D-07/D-12 (screenshots only later; they show typed values like IBANs).
- Tokens: ~14 k for snapshots alone, 20–35 k per proactive cycle → daily budget lasts only 6–10 cycles per user. The Decisions API takes structured state only — images force the slow fallback.
- Privacy leak: `content.ts` uses `innerText` as label → for `[contenteditable]` that is user-typed text.

## Latency (end to end)
- Text: ~1–1.5 s to highlight (worst ~3 s if the tier classifier runs).
- Proactive (server design): rule → `/decide` 0.2–0.5 s → offer → "Ja" → `/ask` 0.9–1.4 s.
- Proactive with Nils' payload: generative decide with history/images 1–2.5 s → total 2.5–4.5 s. **Critical path = LLM prefill of history/images, not the network.**
- Voice: token + WS setup run while the user speaks; after speech ≈ 1 s VAD + 0.4–0.6 s transcript + `/ask` ≈ 2.3–3 s to highlight.

## MV3 / robustness risks
- Demo CRM is multi-page → content-script memory resets per navigation; buffers must live in `chrome.storage.session` (service worker dies after ~30 s idle).
- One global `numbered[]` rebuilt per snapshot → highlights for an older snapshot hit the wrong element; keep refs per `snapshotId`.
- `showModal()` dialogs (top layer) hide the overlay — render inside the open dialog; skip inert elements behind it.
- SPA `pushState` (offers page) needs URL-change detection.
- `captureVisibleTab` needs `activeTab`/`<all_urls>`, max 2 calls/s.

## Recommendation
1. **One contract** — keep server names (`DecideRequest/Response`, `GuidanceEvent`, `StuckTrigger`, `OfferFeedback`); take from Nils `ObservationSnapshot.id`, `LotseEvent.id/snapshotId`, `snapshot.messages`; add `reason?`, `routeSequence?` to `DecideRequest`, `workflowName?`, `evidence?` to `DecideResponse`, `snapshotId?` to the `tier` event; drop `DecisionRequest/Response`, `lotse:wake-question`, legacy `AskResponse`.
2. **Extension (Nils):** no screenshots for now; history = route + title only (≤ 5); snapshot once; offer bubble before `/ask` with cooldown; always send `x-lotse-*` headers + NDJSON `Accept`; render inside open dialogs; per-snapshot element refs; no `innerText` for contenteditable; buffers in `chrome.storage.session`.
3. **Server:** temporary `/decide` adapter for Nils' body; use `intent.evidence` in `/ask`; echo `snapshotId`; clear 413 message. Don't raise the body cap for images.
