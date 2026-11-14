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

- **Wizard** (`npx @posthog/wizard`): AI agent detects framework, installs SDK, instruments events, verifies with a test event; integration knowledge shipped as skills ("context mill"). Blueprint for a future Valo repo-scanning wizard. [Docs](https://posthog.com/docs/ai-engineering/ai-wizard), [repo AGENTS.md](https://github.com/PostHog/wizard/blob/main/AGENTS.md)
- **`posthog.on('eventCaptured', cb)`** gives every event client-side before sending — a zero-instrumentation tap for apps with PostHog. Wrap listener in try/catch (older versions drop the event if it throws). [SDK reference](https://posthog.com/docs/references/posthog-js)
- **EBV-Portal** already uses PostHog (installed via wizard) with `mask_all_text` + attribute ignorelist and opt-in consent → its events don't say *what* was clicked. Lesson: separate UI labels (OK) from user content (never).

## Gemini models available to our key (2026-11-14)

Verified and in `MODELS`: `gemini-3.8-flash`, `gemini-4-argon`, `gemini-embedding-2`, `gemini-3.1-flash-image`.
Listed but untested: lite (`gemini-3.5-flash-lite`, `gemini-3.1-flash-lite`), Live (see above), TTS (`gemini-3.8-flash-tts`), computer use (`gemini-2.5-computer-use-preview-10-2025`).

## Legal pointers (not legal advice)

- Employee monitoring → works council codetermination, § 87 (1) 6 BetrVG → aggregate, pseudonymize, no performance evaluation.
- Cookies/local storage on end-user sites need prior consent (§ 25 TDDDG).
- Gemini via AI Studio paid tier: no training on data, but not EU-resident; EU residency → Vertex AI region.

## Competitors (2026-11-14)

Three parallel research passes (digital adoption platforms · AI screen agents · friction analytics). **Caveat:** no working web search that day — all claims come from vendor pages fetched directly; several pages 404'd or timed out (tts performance suite, Tandem). Items marked *unverified* are from prior knowledge. Summary and pitch line: [README → What's different](../README.md#whats-different).

| Product | Deploy | Guidance | Proactive "stuck" | Points on screen | Fades | Company analytics | Source |
| --- | --- | --- | --- | --- | --- | --- | --- |
| WalkMe (SAP) | extension or snippet | hand-built + chat builder; AI executes steps | "Proactive AI" named, not described | yes | no | per person (Discovery: click-by-click by user/department) | [walkme.com](https://www.walkme.com/), [Discovery](https://support.walkme.com/knowledge-base/walkme-discovery/) |
| Whatfix | extension or snippet | AI authoring agent; Mirror = training copy of the app | ScreenSense: "stuck, exploring…" intent; Insights Agent | yes | no | friction analytics, session replay; says "anonymized" but has user segments | [whatfix.com/ai](https://whatfix.com/ai), [screensense](https://whatfix.com/screensense), [analytics](https://whatfix.com/products/product-analytics/) |
| Userlane (Munich) | extension via GPO/MDM or snippet | hand-built; AI assistant on own docs | rule-based "Contextual Actions" | yes | no | **pseudonymized, audience level** ("nurses in cardiology… not which individual"); no keystrokes/values/recordings | [userlane.com](https://www.userlane.com/), [application intelligence](https://www.userlane.com/application-intelligence/) |
| Pendo | snippet | AI guide builder (beta) | rage clicks, replay (after the fact) | yes | no | per visitor/account | [in-app guides](https://www.pendo.io/product/in-app-guides), [for employees](https://www.pendo.io/pendo-for-your-employees/) |
| Apty | n/a | AI-assisted | Pulse risk alerts (admin) | yes | no | workflow monitoring | [apty.ai](https://apty.ai/) |
| Lemon Learning | no code changes | record a flow once | no | yes | no | heatmaps, drop-offs | [lemonlearning.com](https://www.lemonlearning.com/) |
| Userpilot / Appcues / Chameleon | SDK/snippet | AI agents build flows | replay frustration / Compass "stuck" report | yes | no | per user | [userpilot.com](https://userpilot.com/), [appcues.com](https://www.appcues.com/), [chameleon.io](https://www.chameleon.io/) |
| Spekit / Guidde / Tango | extension | knowledge cards / AI video guides / "Guide Me" | no / no / on request | no / no / yes | no | engagement / – / – | [spekit.com](https://www.spekit.com/), [guidde.com](https://www.guidde.com/), [tango.ai](https://www.tango.ai/) |
| Fullstory Workforce | approved browser apps | – | where work "repeats, waits, gets stuck" | no | no | session recording; "analyze the work, not the workers" | [fullstory.com/platform/workforce](https://www.fullstory.com/platform/workforce/) |
| MS Adoption Score / Viva | M365 telemetry | generic M365 tips | no | no | no | **org level only**, min. group 5, opt-out — M365 only | [Adoption Score](https://learn.microsoft.com/en-us/microsoft-365/admin/adoption/adoption-score), [Viva privacy](https://learn.microsoft.com/en-us/viva/insights/advanced/setup-maint/privacy-settings) |
| PostHog / Heap / LogRocket / Contentsquare | SDK | – | rage/dead clicks, AI friction ranking | no | no | per person/session, customer-facing apps | [PostHog autocapture](https://posthog.com/docs/product-analytics/autocapture) |
| Gemini in Chrome | built in | chat + auto browse (acts) | no, on request | no ("select part of page" coming) | no | none | [google.com/chrome/ai-innovations](https://www.google.com/chrome/ai-innovations/) |
| Copilot Vision (Windows/Edge) | built in | "Highlights" shows where to click (*unverified*) | no | yes (*unverified*) | no | none | Microsoft Copilot Vision page (timed out) |
| Claude for Chrome / ChatGPT Atlas / Comet / Opera Neon / Mariner | extension or browser | agents that **act** | no, task-driven | no | no | none (Claude: admin allow/block lists) | [claude.com/chrome](https://claude.com/chrome), [perplexity.ai/comet](https://www.perplexity.ai/comet), [operaneon.com](https://www.operaneon.com/) |

**Gaps (nobody found doing it):** fading per person/task; "still stuck after the hint" metric (design flaw vs. training need); live in-the-moment stuck detection with an LLM gate and zero setup; per-person data that never leaves the browser + k-anonymous reports; SMB/Handwerk pricing.

**Works council / GDPR:** § 87 (1) 6 BetrVG covers systems *able* to monitor behaviour or performance — intent doesn't matter (BAG case law, cited from memory, not checked). With a works council an agreement is needed whatever we promise; aggregate-only by design makes it easy. Vendors handle it via org-level data + min. group size + opt-out (Microsoft) or pseudonymization without recordings (Userlane); none sells works-council readiness as a feature.

**To verify before pitching:** Userlane's anonymization/works-council claims; whether Copilot Vision Highlights is available in the EU.
