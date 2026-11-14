# Research notes

Findings that led to the decisions. Date = when checked. Verify before relying on anything marked *unverified*.

## Chrome extension capabilities (2026-11-14)

- **Sees:** full DOM of allowed pages (clicks, SPA route changes, labels, errors), `captureVisibleTab` screenshots, request URLs/status via `webRequest` — **not** response bodies.
- **Doesn't see:** app identity/roles, app code, cross-origin iframes (without extra permissions), canvas content, page JS state (only via MAIN-world injection — avoid).
- **Org config:** IT can push settings via `chrome.storage.managed` and force-install via policy (`ExtensionInstallForcelist`).
- **Identity:** `chrome.identity.launchWebAuthFlow` (e.g. Entra ID) or managed-profile email.
- **Overlays:** any DOM in the page; use Shadow DOM; native `<dialog>`/top layer covers overlays → render inside the dialog.
- **MV3:** no remotely hosted code — bundle all JS and models.

## Microphone in MV3 (2026-11-14)

- Chrome can't show the mic prompt in side panel, popup or offscreen document → open an extension page in a normal tab once; permission then applies to the extension origin.
- Use an **offscreen document** with reason `USER_MEDIA` for continuous capture; service workers can't use `getUserMedia`.
- `"microphone"` / `audioCapture` manifest permissions don't help.
- Example: [moritzkremb/voice-browser-extension](https://github.com/moritzkremb/voice-browser-extension), [Chromium group thread](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/V09VMCLzvWM), [offscreen capture guide](https://mv3-extension.com/manifest-v3-architecture-extension-lifecycle/offscreen-documents-dom-access/capturing-audio-and-video-in-an-offscreen-document/).

## Wake word (2026-11-14)

- **openWakeWord** (chosen): open source, ONNX models via ONNX Runtime Web; community browser packages `openwakeword-wasm-browser` / `openwakeword-web` (*unverified*, check maintenance). Pre-trained words exist (e.g. "hey jarvis"); custom words need training — LiveKit's wakeword trainer (Apache 2.0) generates synthetic speech and exports openWakeWord-format ONNX. Target: ≤ 5 % false rejects, < 0.5 false accepts/hour. [micdrop.dev comparison](https://micdrop.dev/blog/wake-word-detection-web-app)
- Porcupine (Picovoice): custom word in minutes, very accurate, but commercial license. Web Speech API always-on: streams audio to Google continuously → rejected.
- Noisy venue → headset + hotkey fallback.

## Gemini Live (2026-11-14)

- **AI SDK 7** supports it: `google.experimental_realtime(model)`, server-side `google.experimental_realtime.getToken()`, client `experimental_useRealtime` (`@ai-sdk/react`), `experimental_getRealtimeToolDefinitions`; tool calls are client-driven (`onToolCall`). Marked experimental. Local docs: `node_modules/ai/docs/03-ai-sdk-core/36-realtime.mdx`, `node_modules/@ai-sdk/google/docs/15-google.mdx` (section "Realtime Models").
- **Ephemeral tokens:** preview, Live-only; default expiry 30 min, new-session window 60 s, `uses: 1`; config can be locked. [Docs](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens)
- **Limits:** connection ~10 min (resumption), audio-only session 15 min, native-audio context 128k. Older Live models block on tool results; `gemini-3.8-live` reportedly supports async tool calls. [gemini-skills Live SKILL](https://github.com/google-gemini/gemini-skills/blob/main/skills/gemini-live-api-dev/SKILL.md), [WebSockets API](https://ai.google.dev/api/live)
- Models listed for our key: `gemini-3.8-live`, `gemini-3.1-flash-live-preview`, `gemini-2.5-flash-native-audio-latest` (+ TTS models). Not yet exercised.

## Google agent offerings (2026-11-14)

- **ADK** (Python, Java, Go, TypeScript `@google/adk` 2.5.0, Kotlin): Live/bidi streaming documented for Python/Java (`run_live`, `LiveRequestQueue`, server-owned). TS has a `LiveRequestQueue` class; completeness unverified. [ADK streaming guide](https://google.github.io/adk-docs/streaming/dev-guide/part1/)
- **Gemini Enterprise Agent Platform** (formerly Vertex AI, renamed April 2026) with **Agent Runtime** (formerly Agent Engine): managed hosting for ADK agents, Memory Bank, governance, VPC/CMEK. [Docs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/build/runtime)
- **Interactions API:** server-side conversation state, managed agents; AI SDK supports it via `google.interactions(...)`. [Docs](https://ai.google.dev/gemini-api/docs/interactions/interactions-overview)

## PostHog as reference (2026-11-14)

- **Wizard** (`npx @posthog/wizard`): AI agent detects framework, installs SDK, instruments events, verifies with a test event; integration knowledge shipped as skills ("context mill"). Blueprint for a future Lotse repo-scanning wizard. [Docs](https://posthog.com/docs/ai-engineering/ai-wizard), [repo AGENTS.md](https://github.com/PostHog/wizard/blob/main/AGENTS.md)
- **`posthog.on('eventCaptured', cb)`** gives every event client-side before sending — a zero-instrumentation tap for apps with PostHog. Wrap listener in try/catch (older versions drop the event if it throws). [SDK reference](https://posthog.com/docs/references/posthog-js)
- **EBV-Portal** already uses PostHog (installed via wizard) with `mask_all_text` + attribute ignorelist and opt-in consent → its events don't say *what* was clicked. Lesson: separate UI labels (OK) from user content (never).

## Gemini models available to our key (2026-11-14)

Verified and in `MODELS`: `gemini-3.8-flash`, `gemini-4-argon`, `gemini-embedding-2`, `gemini-3.1-flash-image`.
Listed but untested: lite (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`), Live (see above), TTS (`gemini-3.8-flash-tts`), computer use (`gemini-2.5-computer-use-preview-10-2025`).

## Legal pointers (not legal advice)

- Employee monitoring → works council codetermination, § 87 (1) 6 BetrVG → aggregate, pseudonymize, no performance evaluation.
- Cookies/local storage on end-user sites need prior consent (§ 25 TDDDG).
- Gemini via AI Studio paid tier: no training on data, but not EU-resident; EU residency → Vertex AI region.
