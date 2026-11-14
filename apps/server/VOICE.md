# Voice — server side + client integration notes

Decision D-16: **one brain on the server**. Voice is only input/output:

```
wake word "Hey Lotse" / hotkey Alt+L (command "lotse-listen")
  → offscreen doc records mic → Gemini Live *transcription* (token from us, audio goes straight to Google)
  → final transcript → background → POST /api/lotse/ask { source: "voice" }
  → agent mostly just points; only a `say` event is spoken (≤ 2 short sentences, often nothing)
```

No conversational Live agent. The user hates long talking: if pointing/highlighting answers it, say nothing.

## 1. `POST /api/lotse/live-token`

Server code: `src/app/api/lotse/live-token/route.ts`, `src/lib/voice/live-token.ts`.

- Request: no body. Send header `x-lotse-session: <session id>` (rate-limit key). Call it from the **offscreen document or service worker** (extension pages with `host_permissions` for localhost skip CORS; note `cors.ts` does not list `x-lotse-session` in `Allow-Headers` yet).
- Response `200` = `LiveTokenResponse` from `@lotse/shared`:
  ```json
  { "token": "auth_tokens/…", "model": "gemini-3.5-transcribe-live", "expiresAt": "2026-11-14T11:12:26.236Z" }
  ```
- `429` `{ error: "rate_limited" }` + `Retry-After` (8 tokens/min per session, 60/min global, in-memory). `502` if minting failed.
- Token properties: **single use** (one WebSocket), must be **opened within 60 s**, session cut off after **2 min**. Model and the whole Live config are **locked server-side** — whatever the client puts into `setup` beyond `model` is ignored/rejected (checked: asking for `gemini-3.8-live` + audio output fails).
- Locked config: transcription only, `languageCodes: ["de-DE","en-US"]`, custom vocabulary `Lotse, Hey Lotse, IBAN, CRM, Bankverbindung`. The model cannot answer, call tools or speak.
- Get a **fresh token per utterance**. Minting takes ~0.3 s warm (first call after server start ~1.4 s).

## 2. Talking to Gemini Live (offscreen document, plain `WebSocket`, no SDK needed)

```ts
const { token, model } = LiveTokenResponseSchema.parse(await (await fetch(`${LOTSE_DEFAULTS.serverUrl}/api/lotse/live-token`, {
  method: "POST", headers: { [LOTSE_HEADERS.session]: sessionId },
})).json());

const ws = new WebSocket(
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained" +
  `?access_token=${encodeURIComponent(token)}`,
);
ws.onopen = () => ws.send(JSON.stringify({ setup: { model: `models/${model}` } }));   // nothing else — config is locked
// after {"setupComplete":{}}: stream audio chunks (~100 ms each)
ws.send(JSON.stringify({ realtimeInput: { audio: { data: base64Pcm16, mimeType: "audio/pcm;rate=16000" } } }));
// end of utterance (client VAD says ~1 s silence, or 10 s max):
ws.send(JSON.stringify({ realtimeInput: { audioStreamEnd: true } }));
```

Audio format: **16-bit signed little-endian PCM, mono, 16 kHz**, base64. Easiest: `new AudioContext({ sampleRate: 16000 })` + an AudioWorklet that posts Float32 frames → convert to Int16 → base64. Messages arrive as text or `Blob` (`await e.data.text()`).

Server messages you care about (observed with our key):

| Message | Meaning |
| --- | --- |
| `{"setupComplete":{}}` | start sending audio (buffer audio captured before this!) |
| `serverContent.interimInputTranscription.text` | running partial text (optional: show as live subtitle) |
| `serverContent.inputTranscription.text` | **final transcript** → `onTranscript(text)`, then `ws.close()` |
| `voiceActivity.type` `ACTIVITY_START` / `ACTIVITY_END`, `serverContent.speechState` | server-side VAD |
| `serverContent.generationComplete` | utterance done (arrives right after the final transcript) |
| close code `1007`/`1008` + reason | config/token problem — log the reason, fall back to idle |

End of utterance: send `audioStreamEnd` yourself (fastest), **or** just keep streaming — Gemini's own VAD finalizes ~1.2 s after the speaker stops. Always enforce a 10 s cap client-side.

### Measured latency (2026-11-14, macOS, German TTS sample "Wie ändere ich die IBAN?")

| Step | Time |
| --- | --- |
| token from our route (warm) | ~0.3–0.6 s |
| WebSocket open + `setupComplete` | ~0.8–1.7 s |
| final transcript after `audioStreamEnd` | **~0.36–0.6 s** |
| final transcript via server VAD (no `audioStreamEnd`) | ~1.2 s after speech ends |

→ Fetch the token and open the socket **immediately** on wake word/hotkey and **buffer mic audio** until `setupComplete`; the user is still talking during setup, so it's mostly hidden. Transcript quality was exact (incl. "Hey Lotse", "IBAN", "Bankverbindung"). Strip a leading "Hey Lotse," from the transcript before `/ask`.

Not usable for this: `gemini-3.1-flash-live-preview` / `gemini-3.8-live` (audio output only → "response modalities (TEXT) not supported"), and they'd answer instead of just transcribing.

## 3. After the transcript

1. Background sends `AskRequest { question: transcript, source: "voice", snapshot, … }` to `POST /api/lotse/ask` (same flow as text; state `thinking`).
2. Render `point` / `plan` as usual — that is the answer in most cases.
3. **Only** for a `say` event, and only if `settings.speak`: `chrome.tts.speak(text, { lang: "de-DE", rate: 1.1 })`, text cut to max 2 sentences, nothing for empty text; `chrome.tts.stop()` when a new question starts (state `speaking` → `idle`).
4. Voice states (`VoiceState`): `idle → listening → thinking → speaking → idle`; `off` when `settings.voice` is false (then don't load the wake-word model / don't hold the mic).

## 4. Extension-side recommendations (from `docs/research.md`, checked today)

**Microphone in MV3**
- `getUserMedia` only works in an **offscreen document** (`chrome.offscreen.createDocument({ reasons: ["USER_MEDIA"], … })`); the service worker can't, side panel/offscreen can't show the permission prompt.
- First use: if `getUserMedia` fails with `NotAllowedError`, open an extension page (e.g. `mic-permission.html`) as a **normal tab** that calls `getUserMedia` once, then closes; the grant then applies to the extension origin → retry in offscreen. `"microphone"`/`audioCapture` manifest permissions don't help.

**Wake word (openWakeWord, D-10)**
- No pre-trained "Hey Lotse" model exists → demo with **`hey_jarvis`** and make the keyword/model configurable; a custom "Hey Lotse" model can be trained with openWakeWord's training notebook or LiveKit's wakeword trainer (Apache 2.0, synthetic speech → openWakeWord ONNX).
- `openwakeword-wasm-browser` 0.1.1 (MIT wrapper, last publish 2025-11, onnxruntime-web ^1.23) ships the ONNX models (`melspectrogram`, `embedding_model`, `silero_vad`, `hey_jarvis_v0.1`, `alexa`, `hey_mycroft`, …, ~18 MB with tflite copies) and a small `WakeWordEngine` (1280-sample frames @16 kHz → mel → embedding → keyword head, threshold 0.5, 2 s cooldown). **Caveats for MV3:** it loads its AudioWorklet from a `Blob` URL (blocked by the extension CSP → ship the worklet as a bundled file instead), and it opens its own `getUserMedia` (better: one shared stream for wake word + transcription). Easiest: copy its ~300-line engine logic, bundle models + ORT wasm locally (MV3: no remote code), `ort.env.wasm.numThreads = 1` (offscreen doc is not cross-origin isolated), CSP `wasm-unsafe-eval`.
- `openwakeword-web` 0.1.0 (Apache-2.0, 2026-06) — similar, no models bundled; less proven.
- **License:** openWakeWord's *pre-trained* models are CC BY-NC-SA 4.0 → OK for the hackathon demo, not for commercial use (train our own "Hey Lotse").
- Bonus: the bundled `silero_vad` gives client-side end-of-utterance (≈1 s silence → `audioStreamEnd`).
- Before the wake word fires, **no audio leaves the device**; open the Gemini socket only after detection/hotkey.

**Fallback** (if Live transcription breaks): `webkitSpeechRecognition` (`lang: "de-DE"`) in an extension page. Trade-off: no token/server needed and zero setup, but audio goes to Google's speech service without our locked config, availability in offscreen docs is not guaranteed, and it must never run "always on" (that's why the wake word is local).

## 5. Manual checks

```bash
# token (200, model gemini-3.5-transcribe-live); 9th call within a minute → 429
curl -s -X POST http://localhost:3001/api/lotse/live-token -H "x-lotse-session: test" | jq '.model, .expiresAt'
```

Extension checklist: hotkey Alt+L → state `listening`; first use opens the mic-permission tab; say "Hey Jarvis" (until "Hey Lotse" is trained) → `listening`; in the demo CRM ask "Wie ändere ich die IBAN?" → transcript appears, Lotse points at the field, speaks at most 2 sentences (or nothing).
