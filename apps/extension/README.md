# Valo Chrome extension

WXT 0.21.5 + TypeScript, Chrome MV3. Valo observes local business-app pages, talks to the runtime at `http://localhost:3001` and **only marks** the next step (agent cursor, frame, short hint). It never clicks or fills anything (D-17). No Next.js code and no Gemini key live here.

Background: [handoff](../../docs/handoff-extension.md), [API contract](../../docs/extension-observability.md), [runtime guide](../server/RUNTIME.md), voice: [VOICE.md](./VOICE.md) (voice session).

## Run it

From the repository root:

```sh
npm install
npm run dev:server        # runtime on :3001
npm run demo:crm          # demo CRM on :4000 (test target)
npm run build -w @lotse/extension
```

Load `apps/extension/.output/chrome-mv3` via `chrome://extensions` → Developer mode → Load unpacked (or `npm run dev:extension`). Open the demo CRM — Valo starts by itself there and the status orb appears bottom right (D-29). The toolbar icon opens the side panel (login, settings; the click also grants the screenshot permission for the tab); `Alt+L` (macOS `⌘⇧L`) opens it too.

## How it works

| Part | File | Does |
| --- | --- | --- |
| Service worker | `entrypoints/background.ts` | All HTTP calls; staged proactive pipeline; offers, feedback, prefs; plan persistence; analytics batching; voice wiring |
| Content script | `entrypoints/content.ts` | Semantic events + numbered snapshots; local plan driver (label matching, advance, resume); offer/feedback cards |
| Overlay | `utils/overlay.ts` | Shadow-DOM agent cursor (glides ~600 ms), frame, bubble with buttons, status chips; moves into open modal `<dialog>`s |
| Matching | `utils/match.ts` | Fuzzy label match (case, umlauts, diacritics, quotes, whitespace, role prefixes), route compare |
| Messages/settings | `utils/messages.ts` | Extension-internal message types and the unified settings object |
| Pseudonymization | `utils/pseudonymize.ts` | D-26: page content strings + mask rects (content script); session mapping, `pseudonymize()`/`reidentify()` in `callRuntime`, frame masks (worker) |
| Side panel | `entrypoints/sidepanel/` | Login, start/pause, question (text + 🎙), toggles (incl. auto-activation and orb), threshold, snooze, offer and plan controls, “Copy debug context” (Markdown dump ≤ 40 KB of settings, policy, last runtime calls, guidance, voice log, events — no token/keys/screenshots, page content pseudonymized; `utils/debug.ts`) |
| Voice | `utils/voice/` (voice session) | Wake word / hotkey → Gemini Live transcript → explicit question; `speak()` for `say` |
| Auto-activation | `utils/activation.ts` | Starts/stops observation for the focused org app tab (policy `autoStart`), manual pause, answers the orb's messages |
| Status orb | `utils/orb/` | Floating status circle on app pages (top layer, draggable), push-to-talk click, menu; `sidepanel/presence.ts` = its switches |

**Explicit question** (text, voice, wake word): `/ask` directly with the current snapshot, history, known intent and selected screenshots. No `/state`, `/intent` or `/decide` call.

**Proactive** (only while recording, D-23): events/DOM → `/state` → local state buffer → `/intent` → `/decide` → if `intervene`: **offer bubble** (“Show me” / “Not now”) while `/ask` is prefetched; the guidance is shown only after “Show me”. State/intent/decide never get screenshots.

User controls (D-20/D-22):
- `proactive` off, snoozed, an open offer, a running plan or the 2-minute cooldown → `/decide` is skipped (state/intent keep running).
- “Not now” → `POST /api/lotse/feedback {offerId, feedback: "declined"}` + 10-minute snooze.
- 👍/👎 on proactive guidance (bubble, or the “Was this hint helpful?” card after it) → `/feedback up|down` once per offer; the returned threshold is shown in the panel.
- Panel threshold: `GET /api/lotse/prefs` on open, slider + “Apply” → `PUT` (clamped 0.60–0.95).

**Multi-step plans** (D-19): a `plan` event starts “Step k/n” with Back / Next / ✕ (Esc ends). Valo advances when you click the highlighted element (text fields: when the value is committed), when you click an element whose label matches the current step, or on route/DOM changes (it then looks ahead for a later step on this page). A step that is not on the page shows a short hint with the expected page. The plan is stored in `chrome.storage.session` (30 min) and resumes after full page loads. Labels with placeholders (`‹customer name›`) are never guessed — Valo waits for your choice.

**Analytics**: privacy-filtered events (labels/roles/routes only; no `dom_change`, no `focus`, no snapshot ids) go to `POST /api/lotse/events` in batches of ≤ 100 about every 30 s, only while recording; failed batches are retried (max. 500 queued).

**Settings** — one object: `proactive`, `voice`, `speak` in `chrome.storage.sync` key `lotse:settings` (the voice module reads it too); `screenshots`, `role`, `appKnowledge` in `chrome.storage.local` key `lotse:demo-context` (too large for sync). Session state (buffer, plan, snooze, cooldown, threshold, analytics queue) lives in `chrome.storage.session` key `lotse-observation-session`.

**Voice**: `setupVoice({ onTranscript, onState, onError })` in the service worker; a transcript runs the same path as a typed question (`source: "voice"`). `say` text is spoken only for voice questions with `speak` on. The voice state shows as a chip in the side panel and on the page.

**Auto-activation (D-29)** — no "Start observing" click on the org's apps. `GET /api/lotse/policy` now also returns `autoStart` (signed in: the host is an app of your org = dashboard `apps.domains`; dev without login: apps the runtime knows, e.g. the demo CRM on `localhost:4000`; never unknown hosts) and `appDomains` (signed in: all app domains of your orgs). `utils/activation.ts` re-evaluates on tab switch, window focus, navigation, content-script load, login/logout and every 4 s: focused tab is an app, route not blocked → `start()` (retried 3× while the content script loads); the tab it started leaves the org's apps → `stop()`; a blocked route never starts (it resumes on an allowed page); unreachable server → nothing starts. "Pause" (side panel or orb) is a **manual pause** that holds until you resume — stored in `chrome.storage.session` key `lotse:activation`, so it survives page loads. Switch "Automatically active" (default on) in `chrome.storage.sync` key `lotse:presence`.

**Status orb (D-29)** — a 48 px circle bottom right on org app pages (and wherever Valo records). Own Shadow DOM host `#lotse-orb-host`, `popover="manual"` + `showPopover()` (top layer, above page z-indexes); when a modal `<dialog>` opens it moves into the dialog and is shown again, so it stays visible and clickable. States (colour · icon · animation · tooltip · `aria-live`): **active** (blue, compass, breathing), **ready** (slate), **paused** (grey, pause), **paused on this page** (amber, crossed eye — blocked route or app not allowed), **not connected** (grey, dashed ring — server unreachable), **not signed in** (dark, person — the app needs a login), **listening** (teal, mic, pulsing rings — pushed at once on the wake word / Alt+Shift+L), **thinking** (violet, spinner), **speaking** (cyan, waves), **suggestion** (amber, bulb, badge — open proactive offer), **error** (red, shake, text for 8 s). Click/Enter = push-to-talk (`lotse:listen` → `startListening`, click again ends the question). Menu via right click, long press, the "⋯" button or Shift+F10/↑: Pause/Resume, Ask by voice, Open side panel (`sidePanel.open` from the click's gesture; if Chrome refuses, the orb says "Alt+L" or "⌘⇧L" on macOS), Hide on this page. Drag to move; position per host and hidden hosts in `chrome.storage.local` key `lotse:orb`. Side panel: "Show the status orb" (default on) and "Show again". While the orb is visible the overlay's status chips are hidden; the cursor still glides out of the bottom-right corner. Messages `lotse:orb-status`, `lotse:orb-pause`, `lotse:open-panel`, `lotse:activation` are answered by `utils/activation.ts` (its own `runtime.onMessage` listener); the orb polls status every 1.5 s while visible.

**Beyond localhost (not built yet):** the content script `matches`, `host_permissions` and `activeAppTab()`/`localUrl()` are localhost-only. For real org domains: add `optional_host_permissions: ["https://*/*"]` + the `scripting` permission; after login request the origins from `appDomains` (`chrome.permissions.request` from a side-panel click), then `chrome.scripting.registerContentScripts({ id: "lotse", js: ["content-scripts/content.js"], matches: appDomains.map(d => "https://" + d + "/*"), persistAcrossSessions: true })`, and replace the localhost checks in `background.ts` with "host is in `appDomains` and has a granted permission". `utils/activation.ts` already reads `appDomains`.

Privacy: input values and search terms are never recorded; query strings are dropped from routes.

**Pseudonymization (D-26)** — server and Gemini only see placeholders such as `[Kunde-1]`, `[Person-2]`, `[IBAN-1]`:
- With every snapshot the content script reports the page's **content strings** (record links = links with an id in the URL, table cells except categories/dates/amounts, `<dd>` values, the `h1` of a record page, the signed-in user's name, `[data-lotse-pii="Kunde"]`) and the screen rects of content (those, plus filled form fields, `[data-lotse-private]` and text holding a pattern). UI labels — buttons, tabs, menus, field labels, column headers — stay readable.
- The service worker keeps one mapping per browser session in `chrome.storage.session` (`lotse-pseudonyms`): same value → same token; surname and company name without legal form map to the full value's token. `callRuntime()` pseudonymizes **every** request body right before `fetch` (snapshots, events, questions, state/intent/decide context, analytics) and re-identifies every response, so hints, `say`, plan steps and offers show the real names again. Patterns catch values that are not on the page: e-mail, IBAN, "Herr/Frau <Name>", company forms (GmbH, AG, eG …), street + number, postcode + city, phone numbers, numbers with ≥ 6 digits.
- Frames: the content rects are painted over (labelled with their token) before a frame is buffered; without a privacy report the frame is dropped. Spoken answers are sent to `/api/lotse/tts` pseudonymized ("Kunde 1").
- Exploration page maps: `learnPrivacy()` + `pseudonymizeExploredPages()` (or any upload through `callRuntime`).

Limits — **pseudonymized, not anonymous**:
- The mapping lives in the browser; anyone with the browser profile (or the extension's session storage) can re-identify. It is cleared when the browser closes.
- Detection is heuristic. A name typed freely that is not on the page and matches no pattern (e.g. "Müller" without "Herr") leaves the browser in clear text; so does content outside tables/lists/record headings in an unusual layout (mark it with `data-lotse-pii`). Context can still identify a person (route + time + role).
- Tokens are per session: analytics on record links aggregate to placeholders, not to customers.
- Voice: the microphone audio goes to Gemini Live for transcription before any pseudonymization (D-16); only the resulting question text is pseudonymized.
- Masks follow the rects at snapshot time (union of the last two reports); content that moves or appears in the ~100 ms before the capture can be visible in a frame. Use sample data in demos.

## Manual checklist (demo CRM, http://localhost:4000)

Reset the demo data and set the role first (see `demo-crm/SCENARIOS.md`). Run the server and reload the extension after a build.

1. **Change an IBAN (scenario 1, accounting):** ask “How do I change the IBAN of Müller Logistik?” on the dashboard → cursor glides to “Kunden”, bubble “Step 1/n”. Click it → page loads → plan resumes on the customer list; choose “Müller Logistik GmbH” (placeholder step waits) → “Zahlungsdaten” → “Bankverbindung bearbeiten” (dialog: cursor + bubble inside the dialog) → “IBAN” advances after you leave the field → “Speichern” → “Done”.
2. **Next/Back/Esc:** during any plan, use Next/Back in the bubble and in the side panel; Esc ends the plan; ✕ too.
3. **Error twice (scenario 2):** ask why saving fails → `point`/`say` on the IBAN field; the say text appears under the hint.
4. **Create a task (scenario 3, sales):** “Neue Aufgabe” opens a modal dialog → next step (“Titel”) is highlighted inside the dialog.
5. **Hidden (scenario 4/9):** step not on the page (e.g. “Erweitert” collapsed) → hint “… is not visible here right now” / expected page; after expanding, the plan continues.
6. **Role block (scenario 6):** disabled button is never highlighted; Valo explains via `say`.
7. **Proactive (stuck variants 1/4):** start observation, search “IBAN” 3× without results → offer bubble → “Show me” shows the prefetched guidance with 👍/👎; “Not now” → panel shows “Paused until …”, no further offers for 10 min (“Offer again” resumes).
8. **Feedback/threshold:** 👍/👎 once → panel threshold changes; set the slider to 0.95 → “Apply” → value persists after reopening the panel.
9. **Switches:** “Offer help proactively” off → panel says so and no offers appear; explicit questions still work.
10. **Analytics:** while recording, check the server log / `lotse_events` after ~30 s; nothing is sent while paused.
11. **Voice:** “Hey Jarvis” / hotkey / 🎙 → chip “listening …” in panel and page → answer marked; with “Read answers aloud” on, `say` text is spoken.
12. **Auto-Start + Orb (D-29):** reload the extension, open `http://localhost:4000` → without any click the orb turns blue (“Valo is active”), panel shows “Valo active”. Switch to a non-app tab and back to a second demo-CRM tab → observation moves along. Orb menu → Pause → reload the page → still paused; Resume → active. Say “Hey Jarvis” → orb pulses teal at once, then violet while thinking. Open “Neue Aufgabe” (modal dialog) → orb stays on top and clickable. Stop the server → orb grey with dashed ring (“not connected”). Drag the orb, reload → same place; “Hide on this page” → gone, panel “Show again” brings it back.

## Validation

`npm run typecheck`, `npm run lint` (root) and `npm run build -w @lotse/extension`. Per the standing instruction: no test files, no browser or AI smoke tests, commit/push directly to main.
