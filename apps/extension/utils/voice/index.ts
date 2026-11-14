/**
 * Voice module — public API for `entrypoints/background.ts` (service worker). Flow (D-16, apps/extension/VOICE.md):
 * wake word (openWakeWord, local) or hotkey `lotse-listen` → offscreen document records the question → Gemini Live
 * transcription (token from /api/lotse/live-token) → `onTranscript(text)` → background sends it down the explicit-question
 * path (source "voice") → for a `say` guidance event the background calls `speak(text)` (Gemini TTS via
 * /api/lotse/tts, ≤ 2 sentences). Only Gemini — no Web Speech or other fallback.
 *
 * Call `setupVoice()` synchronously inside `defineBackground()` so the listeners exist when Chrome wakes the worker.
 */
import { LOTSE_DEFAULTS, LOTSE_SETTINGS_KEY, LotseSettingsSchema, type VoiceState } from "@lotse/shared";
import { browser } from "wxt/browser";
import { shortenForSpeech, stripWakePhrase, VOICE_CONFIG_KEY, VOICE_DEFAULTS, VOICE_SESSION_KEY, WAKEWORD_MODEL_FILES } from "./config";
import {
  errorText,
  extensionUrl,
  isWorkerEvent,
  MIC_PERMISSION_PATH,
  OFFSCREEN_PATH,
  OFFSCREEN_TARGET,
  type ListenTrigger,
  type MicStatus,
  type OffscreenCommand,
  type OffscreenCommandBody,
  type OffscreenConfig,
  type OffscreenMode,
  type OffscreenReply,
  type WorkerEvent,
} from "./protocol";

/** Other `runtime.onMessage` listeners should `return` early for these (voice-internal, answered by the offscreen doc). */
export { isVoiceMessage } from "./protocol";
export type { ListenTrigger, MicStatus } from "./protocol";

export interface VoiceHandlers {
  /**
   * Final transcript of what the user asked (wake phrase already stripped). Send it down the explicit-question path.
   * Return that request's promise: the state stays "thinking" until it settles (otherwise until `speak()` or 25 s).
   */
  onTranscript(text: string): void | Promise<unknown>;
  /** off · idle · listening · thinking · speaking — for the side panel and the page overlay. */
  onState?(state: VoiceState): void;
  /** Short German message worth showing (microphone missing, nothing heard, …). */
  onError?(message: string): void;
}

let handlers: VoiceHandlers | null = null;
let settings = { voice: true, speak: true };
let config: OffscreenConfig | null = null;
let mode: OffscreenMode = "off";
let mic: MicStatus = "needed";
let speaking = false;
let thinking = false;
let thinkingTimer: ReturnType<typeof setTimeout> | undefined;
let lastState: VoiceState | null = null;
let creating: Promise<void> | null = null;
let ready: Promise<void> = Promise.resolve();
/** Last 20 voice messages/warnings of the worker side, oldest first (debug dump). */
const workerLog: string[] = [];

function logLine(text: string): void {
  workerLog.push(`${new Date().toISOString().slice(11, 23)} ${text}`.slice(0, 300));
  if (workerLog.length > 20) workerLog.shift();
}

/** Call once from the background service worker (synchronously, at top level of `defineBackground`). */
export function setupVoice(next: VoiceHandlers): void {
  const first = handlers === null;
  handlers = next;
  if (!first) return;
  browser.runtime.onMessage.addListener((message: unknown, sender) => {
    if (!isWorkerEvent(message)) return; // not ours; never respond (the offscreen doc answers commands itself)
    void ready.then(() => onWorkerEvent(message, sender.tab?.id));
  });
  browser.commands.onCommand.addListener((command) => {
    if (command === "lotse-listen") void startListening("hotkey");
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if ((area === "sync" && LOTSE_SETTINGS_KEY in changes) || (area === "local" && VOICE_CONFIG_KEY in changes)) ready = refresh();
  });
  ready = refresh();
}

/** Start listening for one question (hotkey / side-panel mic button). Pressing again while listening ends the question. */
export async function startListening(trigger: ListenTrigger = "button"): Promise<void> {
  await ready;
  if (!settings.voice) {
    report("Sprachsteuerung ist in den Einstellungen ausgeschaltet.");
    return;
  }
  try {
    if (mode === "listening") {
      await sendToOffscreen({ type: "stop-listening" });
      return;
    }
    stopSpeaking();
    const reply = await sendToOffscreen({ type: "listen", trigger });
    if (!reply.ok) {
      if (reply.mic === "needed" || reply.mic === "denied") await requestMicPermission();
      else report(reply.error ?? "Valo kann gerade nicht zuhören.");
    }
  } catch (error) {
    report(errorText(error));
  }
  emitState();
}

/** Speak a short answer (`say` event): ≤ 2 sentences, nothing for empty text or when `settings.speak` is off. Resolves when playback ends. */
export async function speak(text: string): Promise<void> {
  await ready;
  setThinking(false);
  const line = shortenForSpeech(text);
  if (!line || !settings.speak) return;
  try {
    const reply = await sendToOffscreen({ type: "speak", text: line });
    if (!reply.ok && reply.error && reply.error !== "stopped") report(reply.error);
  } catch (error) {
    report(errorText(error));
  }
}

/** Stop any ongoing speech (e.g. the user starts a new question). */
export function stopSpeaking(): void {
  if (!config) return;
  void hasOffscreen()
    .then((open) => (open ? sendToOffscreen({ type: "stop-speaking" }) : undefined))
    .catch(() => undefined);
}

/** Opens (or focuses) the one-time microphone permission tab. */
export async function requestMicPermission(): Promise<void> {
  const url = extensionUrl(MIC_PERMISSION_PATH);
  const [open] = await browser.tabs.query({ url });
  if (open?.id !== undefined) {
    await browser.tabs.update(open.id, { active: true });
    if (open.windowId !== undefined) await browser.windows.update(open.windowId, { focused: true }).catch(() => undefined);
    return;
  }
  await browser.tabs.create({ url, active: true });
}

/** Current voice state + microphone permission (for a side-panel indicator on open). */
export function voiceStatus(): { state: VoiceState; mic: MicStatus } {
  return { state: currentState(), mic };
}

export type VoiceDebug = {
  state: VoiceState; mic: MicStatus; mode: OffscreenMode; speaking: boolean; voice: boolean; speak: boolean;
  keywordModel: string | null; threshold: number | null; wakeWord: boolean | null; offscreenOpen: boolean;
  /** Oldest first. */
  offscreenLog: string[]; workerLog: string[];
};

/** Voice part of the side panel's debug dump. Never creates the offscreen document just to read its log. */
export async function voiceDebug(): Promise<VoiceDebug> {
  let offscreenOpen = false;
  let offscreenLog: string[] = [];
  try {
    offscreenOpen = await hasOffscreen();
    if (offscreenOpen && config) {
      const command = { type: "debug-log", target: OFFSCREEN_TARGET, config } satisfies OffscreenCommand;
      const timeout = new Promise<undefined>((resolve) => setTimeout(() => resolve(undefined), 1_500));
      const reply = (await Promise.race([browser.runtime.sendMessage(command), timeout])) as OffscreenReply | undefined;
      offscreenLog = reply?.log ?? ["(Offscreen-Dokument hat nicht geantwortet)"];
    }
  } catch (error) {
    offscreenLog = [`(Offscreen-Log nicht verfügbar: ${errorText(error)})`];
  }
  return {
    state: currentState(), mic, mode, speaking, voice: settings.voice, speak: settings.speak,
    keywordModel: config?.keywordModel ?? null, threshold: config?.threshold ?? null, wakeWord: config?.wakeWord ?? null,
    offscreenOpen, offscreenLog, workerLog: [...workerLog],
  };
}

// ---------------------------------------------------------------------------
// Events from the offscreen document / mic-permission page
// ---------------------------------------------------------------------------

function onWorkerEvent(event: WorkerEvent, tabId?: number): void {
  switch (event.type) {
    case "ready": // (re)created document asks for its configuration
      void syncOffscreen();
      break;
    case "mode":
      mode = event.mode;
      mic = event.mic;
      emitState();
      break;
    case "speaking":
      speaking = event.speaking;
      emitState();
      break;
    case "transcript":
      deliver(event.text);
      break;
    case "error":
      report(event.message);
      break;
    case "mic-granted":
      mic = "granted";
      void syncOffscreen();
      if (tabId !== undefined) setTimeout(() => void browser.tabs.remove(tabId).catch(() => undefined), 1_500);
      break;
    case "mic-denied":
      report("Ohne Mikrofon-Freigabe kann Valo nicht zuhören.");
      break;
  }
}

function deliver(raw: string): void {
  const question = stripWakePhrase(raw);
  if (!question) {
    report("Ich habe keine Frage verstanden.");
    return;
  }
  setThinking(true);
  let result: unknown;
  try {
    result = handlers?.onTranscript(question);
  } catch (error) {
    setThinking(false);
    report(errorText(error));
    return;
  }
  if (result && typeof (result as PromiseLike<unknown>).then === "function") {
    void Promise.resolve(result).then(
      () => setThinking(false),
      () => setThinking(false),
    );
  }
}

// ---------------------------------------------------------------------------
// Settings + offscreen document
// ---------------------------------------------------------------------------

async function refresh(): Promise<void> {
  try {
    const [synced, local] = await Promise.all([browser.storage.sync.get(LOTSE_SETTINGS_KEY), browser.storage.local.get(VOICE_CONFIG_KEY)]);
    const parsed = LotseSettingsSchema.safeParse(synced[LOTSE_SETTINGS_KEY] ?? {});
    settings = parsed.success ? { voice: parsed.data.voice, speak: parsed.data.speak } : { voice: true, speak: true };
    config = buildConfig(local[VOICE_CONFIG_KEY], await voiceSessionId());
    if (!settings.speak) stopSpeaking();
    if (settings.voice) await syncOffscreen();
    else await closeOffscreen(); // releases the microphone; speak() recreates a playback-only document if needed
  } catch (error) {
    console.warn("[lotse voice] setup failed:", errorText(error));
    logLine("setup failed: " + errorText(error));
  }
  emitState();
}

function buildConfig(raw: unknown, sessionId: string): OffscreenConfig {
  const custom = (raw && typeof raw === "object" ? raw : {}) as { keyword?: unknown; threshold?: unknown; wakeWord?: unknown };
  const keyword = typeof custom.keyword === "string" && WAKEWORD_MODEL_FILES[custom.keyword] ? custom.keyword : VOICE_DEFAULTS.keyword;
  const threshold =
    typeof custom.threshold === "number" && custom.threshold > 0 && custom.threshold < 1 ? custom.threshold : VOICE_DEFAULTS.threshold;
  return {
    serverUrl: LOTSE_DEFAULTS.serverUrl,
    sessionId,
    voice: settings.voice,
    wakeWord: settings.voice && custom.wakeWord !== false,
    keywordModel: WAKEWORD_MODEL_FILES[keyword] ?? "hey_jarvis_v0.1.onnx",
    threshold,
  };
}

async function voiceSessionId(): Promise<string> {
  const stored = (await browser.storage.session.get(VOICE_SESSION_KEY))[VOICE_SESSION_KEY];
  if (typeof stored === "string" && stored.length > 0 && stored.length <= 100) return stored;
  const id = crypto.randomUUID();
  await browser.storage.session.set({ [VOICE_SESSION_KEY]: id });
  return id;
}

async function syncOffscreen(): Promise<void> {
  if (!settings.voice) return;
  try {
    await sendToOffscreen({ type: "configure" });
  } catch (error) {
    console.warn("[lotse voice] offscreen document unavailable:", errorText(error));
    logLine("offscreen document unavailable: " + errorText(error));
  }
  emitState();
}

async function hasOffscreen(): Promise<boolean> {
  const contexts = await browser.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"], documentUrls: [extensionUrl(OFFSCREEN_PATH)] });
  return contexts.length > 0;
}

async function ensureOffscreen(): Promise<void> {
  if (await hasOffscreen()) return;
  creating ??= browser.offscreen
    .createDocument({
      url: OFFSCREEN_PATH.slice(1),
      reasons: ["USER_MEDIA", "AUDIO_PLAYBACK"],
      justification: "Valo erkennt das Wake-Word lokal, nimmt danach die gesprochene Frage auf und spielt kurze gesprochene Antworten ab.",
    })
    .catch((error: unknown) => {
      if (!/single offscreen document/i.test(errorText(error))) throw error;
    })
    .finally(() => {
      creating = null;
    });
  await creating;
}

async function closeOffscreen(): Promise<void> {
  if (await hasOffscreen()) await browser.offscreen.closeDocument().catch(() => undefined);
  mode = "off";
  speaking = false;
}

/** Sends a command (with the current config) to the offscreen document; retries only while it is still starting up. */
async function sendToOffscreen(body: OffscreenCommandBody): Promise<OffscreenReply> {
  if (!config) throw new Error("Sprachmodul ist noch nicht bereit.");
  await ensureOffscreen();
  const command = { ...body, target: OFFSCREEN_TARGET, config } as OffscreenCommand;
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const reply = (await browser.runtime.sendMessage(command)) as OffscreenReply | undefined;
      if (!reply || typeof reply.ok !== "boolean") return { ok: false, error: "Unerwartete Antwort vom Sprachmodul." };
      if (reply.mic) mic = reply.mic;
      if (reply.mode) mode = reply.mode;
      return reply;
    } catch (error) {
      lastError = error; // "Receiving end does not exist" while the document is loading
      await new Promise((resolve) => setTimeout(resolve, 150 * (attempt + 1)));
    }
  }
  throw new Error(`Sprachmodul antwortet nicht (${errorText(lastError)}).`);
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

function setThinking(on: boolean): void {
  clearTimeout(thinkingTimer);
  thinking = on;
  if (on) thinkingTimer = setTimeout(() => setThinking(false), VOICE_DEFAULTS.thinkingTimeoutMs);
  emitState();
}

function currentState(): VoiceState {
  if (mode === "listening") return "listening";
  if (speaking) return "speaking";
  if (thinking) return "thinking";
  return settings.voice && mode === "idle" ? "idle" : "off";
}

function emitState(): void {
  const state = currentState();
  if (state === lastState) return;
  lastState = state;
  try {
    handlers?.onState?.(state);
  } catch (error) {
    console.warn("[lotse voice] onState handler failed:", errorText(error));
  }
}

function report(message: string): void {
  console.info("[lotse voice]", message);
  logLine(message);
  try {
    handlers?.onError?.(message);
  } catch {
    // handler errors must not break voice
  }
}
