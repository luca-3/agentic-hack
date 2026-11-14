# Valo extension — voice

Decision D-16: **one brain on the server; voice is only input/output.** Server side of transcription: `apps/server/VOICE.md`.

```
"Hey Jarvis" (local openWakeWord) ─┐
Alt+Shift+L · ⌘⇧K (lotse-listen) ┴→ offscreen document: beep, mic audio buffered
   → POST /api/lotse/live-token → Gemini Live WebSocket (gemini-3.5-transcribe-live, config locked by the server)
   → end of utterance: ~1 s silence (Silero VAD) · 10 s cap · second Alt+Shift+L (⌘⇧K)
   → final transcript → service worker strips "Hey Jarvis," → onTranscript(text)
   → background.ts: explicit question, source "voice" → /api/lotse/ask → point / plan (the real answer)
   → only for a `say` event: speak(text) → POST /api/lotse/tts → Gemini TTS (WAV) → played offscreen
```

Only Google Gemini for speech: no Web Speech API, no other recognizer or TTS fallback. Before the wake word or hotkey fires, **no audio leaves the device** (wake word runs locally in WebAssembly).

## Files

| Path | Runs in | What |
| --- | --- | --- |
| `utils/voice/index.ts` | service worker | Public API: `setupVoice`, `speak`, `stopSpeaking`, `startListening`, `requestMicPermission`, `voiceStatus`, `isVoiceMessage`. Settings, offscreen lifecycle, hotkey, state machine. |
| `utils/voice/protocol.ts` | all | `target`-tagged messages worker ⇄ offscreen ⇄ mic page (extension-internal, not HTTP contract). |
| `utils/voice/config.ts` | all | Tunables (`VOICE_DEFAULTS`), keyword models, `stripWakePhrase`, `shortenForSpeech`. |
| `entrypoints/offscreen/` | offscreen document | One shared mic stream (16 kHz AudioContext + worklet) → wake word or Gemini Live; TTS playback; start beep. |
| `utils/voice/wakeword.ts` | offscreen | openWakeWord port on ONNX Runtime Web (+ Silero VAD for end of utterance). |
| `utils/voice/live.ts` | offscreen | One utterance: token → WebSocket → buffered PCM16 → `audioStreamEnd` → transcript. |
| `utils/voice/pcm-worklet.js` | audio thread | AudioWorklet: 1280-sample (80 ms) frames. Plain file, copied to `/voice/pcm-worklet.js`. |
| `entrypoints/mic-permission/` | normal tab | One-time microphone prompt (Chrome can't prompt in side panel / offscreen). |
| `apps/server/src/app/api/lotse/tts/route.ts`, `apps/server/src/lib/voice/tts.ts` | server | `POST /api/lotse/tts { text }` → `audio/wav` (204 when nothing to say). |

## API for `background.ts`

```ts
import { setupVoice, speak, stopSpeaking } from "../utils/voice";
setupVoice({
  onTranscript: (text) => explicitQuestion(text, "voice"), // return the promise → state "thinking" ends when the answer is done
  onState: (state) => broadcast(state),                    // off | idle | listening | thinking | speaking
  onError: (message) => showStatus(message),               // optional, short one-liners (mic missing, nothing heard, …)
});
speak(sayText);   // only for `say` events; ≤ 2 sentences; no-op for "" or settings.speak = false; resolves after playback
stopSpeaking();   // when a new question starts
```

- Call `setupVoice` during the worker's first turn (inside `defineBackground`), so `commands.onCommand` and the offscreen messages are handled after the worker is woken.
- If `onTranscript` returns nothing, "thinking" lasts until `speak()` is called or 25 s pass.
- Any other `runtime.onMessage` listener must ignore voice messages (`isVoiceMessage(message)` → `return false`): the offscreen document answers worker commands itself, and a faster foreign `respond()` would steal the reply.
- Side panel: `startListening("button")` for a mic button; `requestMicPermission()` for an "Allow microphone" link.

## Settings

- `chrome.storage.sync["lotse:settings"]` (`LotseSettingsSchema`): `voice: false` → offscreen document closed, microphone released, hotkey ignored, state `off`. `speak: false` → `speak()` is a no-op.
- `chrome.storage.local["lotse:voice-config"]` (optional, for tuning on a demo machine): `{ "threshold": 0.6, "wakeWord": false, "keyword": "hey_jarvis" }`. `wakeWord: false` keeps hotkey-only listening.
- Server: `LOTSE_TTS_MODEL` (default `gemini-3.8-flash-tts`; `gemini-3.8-flash-lite-tts` also verified for our key on 2026-11-14), `LOTSE_TTS_VOICE` (default `Kore`). The TTS route uses the shared guard of the `ask` tier (rate limit + daily budget) and CORS.

## Permissions, manifest and bundling

- `offscreen` permission; document reasons `USER_MEDIA` + `AUDIO_PLAYBACK`. The document lives as long as voice is on (USER_MEDIA keeps it alive; it is recreated on demand when Chrome closes it).
- Command `lotse-listen`, suggested **Alt+Shift+L**, on macOS **Command+Shift+K** (⌘⇧K); `lotse-ask` (Alt+L, macOS ⌘⇧L) opens the side panel. Shift because plain ⌘+letter is taken by Chrome (⌘L/K/E/G/J/Y …) or by web apps (⌘K = the demo CRM's command palette). UI hints pick the label per platform (`utils/shortcuts.ts`). Chrome applies suggested keys only on a fresh install — existing installs keep the old binding until the extension is removed and loaded again; users can rebind at `chrome://extensions/shortcuts`.
- Microphone: `"microphone"`/`audioCapture` manifest permissions don't help in MV3. On first use, the extension opens `mic-permission.html` in a normal tab. That page calls `getUserMedia` once, the grant applies to the extension origin, and the worker closes the tab. The offscreen document notices the grant and starts the wake word.
- CSP: WXT's MV3 default for extension pages already includes `'wasm-unsafe-eval'` (needed by ONNX Runtime Web) → nothing added. The worklet is a real file (Blob/data worklets are blocked).
- No remote code: `wxt.config.ts` (`build:publicAssets` hook) copies `melspectrogram.onnx`, `embedding_model.onnx`, `silero_vad.onnx`, `hey_jarvis_v0.1.onnx` from `openwakeword-wasm-browser` to `/wakeword/`, `ort-wasm-simd-threaded.wasm` from `onnxruntime-web` to `/ort/`, and the worklet to `/voice/`. ORT runs single-threaded (`numThreads = 1`; the offscreen document is not cross-origin isolated). Vite also emits its own copy of the wasm under `/assets/` (+12 MB, harmless for an unpacked demo build).

## Wake word

- No pre-trained "Hey Valo" model exists → **"Hey Jarvis"** for the demo (`VOICE_DEFAULTS.keyword`). Our own model can be trained with openWakeWord's training notebook or LiveKit's wakeword trainer (synthetic speech → openWakeWord ONNX). Then add it to `WAKEWORD_MODEL_FILES` and `WAKEWORD_MODELS` in `wxt.config.ts`.
- Pipeline (faithful port of openWakeWord `AudioFeatures`): 80 ms frame in int16 scale + 480 samples of context → mel (8 × 32, `x/10 + 2`) → last 76 mel frames → 96-d embedding → last 16 embeddings → keyword score; threshold 0.5, 2 s cooldown, ~1.3 s warm-up. The npm wrapper's own engine is **not** used: its worklet is a Blob URL (blocked by the CSP), it opens its own mic, and it feeds the mel model unscaled audio without context.
- **Licenses:** openWakeWord code is Apache-2.0. Its **pre-trained keyword models (incl. `hey_jarvis`) are CC BY-NC-SA 4.0** (non-commercial, because the training data includes datasets with unknown or restrictive licenses). That's fine for the hackathon demo, but a commercial product needs its own model. The embedding model comes from Google's TF Hub speech_embedding (Apache-2.0). Silero VAD is MIT. The `openwakeword-wasm-browser` wrapper is MIT. ONNX Runtime Web is MIT.

## End of utterance

Speech starts when Silero VAD reports ≥ 0.5, ignoring the first 250–350 ms (wake-word tail, start beep). Listening ends after ~1 s below 0.35, after 10 s, or on a second hotkey press. That sends `audioStreamEnd`, and Gemini's final transcript arrives about 0.4–0.6 s later (`apps/server/VOICE.md`). If nothing is said within 6 s, it ends with "I didn't hear a question.". If Gemini sends no final transcript within 4 s, the last interim transcript is used. If the VAD model is unavailable, a loudness threshold is used.

## Manual checklist (human, real Chrome — no automated tests by request)

1. `npm run dev:server` (port 3001) and `npm run demo:crm` (port 4000). Then `npm run build -w @lotse/extension` and load `apps/extension/.output/chrome-mv3` via chrome://extensions → Developer mode → Load unpacked (reload after each build).
2. Open the demo CRM, press **Alt+Shift+L** (macOS **⌘⇧K**). On the first use, the "Valo needs your microphone" tab opens → click Allow → the tab closes by itself.
3. Press Alt+Shift+L (⌘⇧K) again → short rising beep, state `listening` (side panel). Ask "How do I change the IBAN?" and stop talking → about 1 s later the state goes to `thinking` and the question runs through the normal guidance path (the side panel shows it). Valo points at the field.
4. Say **"Hey Jarvis"** (speak clearly, short pause optional) → beep → ask a question. If it never triggers, lower `threshold` to 0.4. If it triggers by itself, raise it to 0.6 (`lotse:voice-config`, see above).
5. If the answer has a `say` event → at most two short sentences are spoken (state `speaking`). Say "Hey Jarvis" or press the hotkey during speech → speech stops immediately (barge-in).
6. Set `lotse:settings.voice = false` → the mic indicator disappears. Set `speak = false` → answers stay silent.
7. Debugging: chrome://extensions → Valo → "Inspect views: offscreen.html" (wake word, WebSocket, TTS logs `[lotse voice]`) and "service worker".
8. TTS route alone: `curl -s -o /tmp/t.wav -w "%{http_code}\n" -X POST localhost:3001/api/lotse/tts -H "Content-Type: application/json" -H "x-lotse-session: t" -d '{"text":"Click on bank details."}'`, then play `/tmp/t.wav`. Checked 2026-11-14: 200, 24 kHz mono WAV, about 3 s including the first route compile.

Not verified in a browser (no browser runs by request): wake-word accuracy of the port, AudioContext autoplay in the offscreen document, offscreen document lifetime.
