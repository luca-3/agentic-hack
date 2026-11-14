# Lotse Chrome extension

WXT 0.21.5 + TypeScript, Chrome MV3. Lotse observes local business-app pages, talks to the runtime at `http://localhost:3001` and **only marks** the next step (agent cursor, frame, short hint). It never clicks or fills anything (D-17). No Next.js code and no Gemini key live here.

Background: [handoff](../../docs/handoff-extension.md), [API contract](../../docs/extension-observability.md), [runtime guide](../server/RUNTIME.md), voice: [VOICE.md](./VOICE.md) (voice session).

## Run it

From the repository root:

```sh
npm install
npm run dev:server        # runtime on :3001
npm run demo:crm          # demo CRM on :4000 (test target)
npm run build -w @lotse/extension
```

Load `apps/extension/.output/chrome-mv3` via `chrome://extensions` → Developer mode → Load unpacked (or `npm run dev:extension`). Open the demo CRM, click the Lotse toolbar icon (side panel; also grants the screenshot permission for the tab). `Alt+L` opens the panel.

## How it works

| Part | File | Does |
| --- | --- | --- |
| Service worker | `entrypoints/background.ts` | All HTTP calls; staged proactive pipeline; offers, feedback, prefs; plan persistence; analytics batching; voice wiring |
| Content script | `entrypoints/content.ts` | Semantic events + numbered snapshots; local plan driver (label matching, advance, resume); offer/feedback cards |
| Overlay | `utils/overlay.ts` | Shadow-DOM agent cursor (glides ~600 ms), frame, bubble with buttons, status chips; moves into open modal `<dialog>`s |
| Matching | `utils/match.ts` | Fuzzy label match (case, umlauts, diacritics, quotes, whitespace, role prefixes), route compare |
| Messages/settings | `utils/messages.ts` | Extension-internal message types and the unified settings object |
| Pseudonymization | `utils/pseudonymize.ts` | D-26: page content strings + mask rects (content script); session mapping, `pseudonymize()`/`reidentify()` in `callRuntime`, frame masks (worker) |
| Side panel | `entrypoints/sidepanel/` | Start/pause, question (text + 🎙), toggles, threshold, snooze, offer and plan controls |
| Voice | `utils/voice/` (voice session) | Wake word / hotkey → Gemini Live transcript → explicit question; `speak()` for `say` |

**Explicit question** (text, voice, wake word): `/ask` directly with the current snapshot, history, known intent and selected screenshots. No `/state`, `/intent` or `/decide` call.

**Proactive** (only while recording, D-23): events/DOM → `/state` → local state buffer → `/intent` → `/decide` → if `intervene`: **offer bubble** (“Ja, zeig's mir” / “Nein”) while `/ask` is prefetched; the guidance is shown only after “Ja”. State/intent/decide never get screenshots.

User controls (D-20/D-22):
- `proactive` off, snoozed, an open offer, a running plan or the 2-minute cooldown → `/decide` is skipped (state/intent keep running).
- “Nein” → `POST /api/lotse/feedback {offerId, feedback: "declined"}` + 10-minute snooze.
- 👍/👎 on proactive guidance (bubble, or the “War der Hinweis hilfreich?” card after it) → `/feedback up|down` once per offer; the returned threshold is shown in the panel.
- Panel threshold: `GET /api/lotse/prefs` on open, slider + “Übernehmen” → `PUT` (clamped 0.60–0.95).

**Multi-step plans** (D-19): a `plan` event starts “Schritt k/n” with Zurück / Weiter / ✕ (Esc ends). Lotse advances when you click the highlighted element (text fields: when the value is committed), when you click an element whose label matches the current step, or on route/DOM changes (it then looks ahead for a later step on this page). A step that is not on the page shows a short hint with the expected page. The plan is stored in `chrome.storage.session` (30 min) and resumes after full page loads. Labels with placeholders (`‹Kundenname›`) are never guessed — Lotse waits for your choice.

**Analytics**: privacy-filtered events (labels/roles/routes only; no `dom_change`, no `focus`, no snapshot ids) go to `POST /api/lotse/events` in batches of ≤ 100 about every 30 s, only while recording; failed batches are retried (max. 500 queued).

**Settings** — one object: `proactive`, `voice`, `speak` in `chrome.storage.sync` key `lotse:settings` (the voice module reads it too); `screenshots`, `role`, `appKnowledge` in `chrome.storage.local` key `lotse:demo-context` (too large for sync). Session state (buffer, plan, snooze, cooldown, threshold, analytics queue) lives in `chrome.storage.session` key `lotse-observation-session`.

**Voice**: `setupVoice({ onTranscript, onState, onError })` in the service worker; a transcript runs the same path as a typed question (`source: "voice"`). `say` text is spoken only for voice questions with `speak` on. The voice state shows as a chip in the side panel and on the page.

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

1. **IBAN ändern (Szenario 1, Buchhaltung):** ask “Wie ändere ich die IBAN von Müller Logistik?” on the dashboard → cursor glides to “Kunden”, bubble “Schritt 1/n”. Click it → page loads → plan resumes on the customer list; choose “Müller Logistik GmbH” (placeholder step waits) → “Zahlungsdaten” → “Bankverbindung bearbeiten” (dialog: cursor + bubble inside the dialog) → “IBAN” advances after you leave the field → “Speichern” → “Fertig”.
2. **Weiter/Zurück/Esc:** during any plan, use Weiter/Zurück in the bubble and in the side panel; Esc ends the plan; ✕ too.
3. **Fehler zweimal (Szenario 2):** ask why saving fails → `point`/`say` on the IBAN field; the say text appears under the hint.
4. **Aufgabe anlegen (Szenario 3, Vertrieb):** “Neue Aufgabe” opens a modal dialog → next step (“Titel”) is highlighted inside the dialog.
5. **Versteckt (Szenario 4/9):** step not on the page (e.g. “Erweitert” collapsed) → hint “… ist hier gerade nicht sichtbar” / expected page; after expanding, the plan continues.
6. **Rollen-Blockade (Szenario 6):** disabled button is never highlighted; Lotse explains via `say`.
7. **Proaktiv (Stuck-Varianten 1/4):** start observation, search “IBAN” 3× without results → offer bubble → “Ja, zeig's mir” shows the prefetched guidance with 👍/👎; “Nein” → panel shows “pausiert bis …”, no further offers for 10 min (“Wieder anbieten” resumes).
8. **Feedback/Schwelle:** 👍/👎 once → panel threshold changes; set the slider to 0.95 → “Übernehmen” → value persists after reopening the panel.
9. **Schalter:** “Proaktiv Hilfe anbieten” off → panel says so and no offers appear; explicit questions still work.
10. **Analytics:** while recording, check the server log / `lotse_events` after ~30 s; nothing is sent while paused.
11. **Voice:** “Hey Jarvis” / hotkey / 🎙 → chip “hört zu …” in panel and page → answer marked; with “Antworten vorlesen” on, `say` text is spoken.

## Validation

`npm run typecheck`, `npm run lint` (root) and `npm run build -w @lotse/extension`. Per the standing instruction: no test files, no browser or AI smoke tests, commit/push directly to main.
