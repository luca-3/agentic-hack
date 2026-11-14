/**
 * Offscreen document: one shared microphone stream for the local wake word (openWakeWord) and Gemini Live
 * transcription, plus playback of spoken answers. Driven by the service worker (utils/voice/index.ts) via
 * `target`-tagged runtime messages (utils/voice/protocol.ts). Offscreen documents only get chrome.runtime —
 * settings, tabs and storage stay in the worker. Before the wake word / hotkey, no audio leaves the device.
 */
import { LOTSE_HEADERS } from "@lotse/shared";
import { browser } from "wxt/browser";
import { VOICE_DEFAULTS } from "@/utils/voice/config";
import { LiveUtterance } from "@/utils/voice/live";
import {
  ASSET_PATHS,
  errorText,
  extensionUrl,
  isOffscreenCommand,
  notifyWorker,
  type ListenTrigger,
  type MicStatus,
  type OffscreenCommand,
  type OffscreenConfig,
  type OffscreenMode,
  type OffscreenReply,
} from "@/utils/voice/protocol";
import { energySpeechProbability, WakeWordDetector } from "@/utils/voice/wakeword";

/** Drop wake-word frames instead of queueing when inference falls behind (keeps detection latency bounded). */
const MAX_PENDING_FRAMES = 6;

let config: OffscreenConfig | null = null;
let applying: Promise<void> = Promise.resolve();
let mic: MicStatus = "needed";
let mode: OffscreenMode = "off";
let stream: MediaStream | null = null;
let audio: AudioContext | null = null;
let worklet: AudioWorkletNode | null = null;
let detector: WakeWordDetector | null = null;
let detectorModel = "";
let detectorLoading: Promise<void> | null = null;
let detectorFailed = false;
let pendingFrames = 0;
let wakeErrorReported = false;
let utterance: LiveUtterance | null = null;
let speech: AbortController | null = null;

browser.runtime.onMessage.addListener((message: unknown, _sender, respond: (reply: OffscreenReply) => void) => {
  if (!isOffscreenCommand(message)) return; // not a voice command → let other listeners answer
  handle(message).then(
    (reply) => respond({ ...reply, mic, mode }),
    (error: unknown) => respond({ ok: false, mic, mode, error: errorText(error) }),
  );
  return true;
});
void watchPermission();
notifyWorker({ type: "ready" });

async function handle(command: OffscreenCommand): Promise<OffscreenReply> {
  await configure(command.config);
  switch (command.type) {
    case "configure":
      return { ok: true, mic };
    case "listen":
      if (mic !== "granted") return { ok: false, mic, error: "Mikrofon ist nicht freigegeben." };
      startUtterance(command.trigger);
      return { ok: true, mic };
    case "stop-listening":
      utterance?.stop();
      return { ok: true, mic };
    case "cancel":
      utterance?.cancel();
      return { ok: true, mic };
    case "speak":
      return speak(command.text);
    case "stop-speaking":
      speech?.abort();
      return { ok: true, mic };
  }
}

// ---------------------------------------------------------------------------
// Configuration + microphone
// ---------------------------------------------------------------------------

function configure(next: OffscreenConfig): Promise<void> {
  applying = applying.then(() => apply(next), () => apply(next));
  return applying;
}

async function apply(next: OffscreenConfig): Promise<void> {
  const previous = config;
  config = next;
  if (!next.voice) {
    utterance?.cancel();
    releaseMic();
    setMode("off");
    return;
  }
  if (previous && previous.keywordModel !== next.keywordModel) {
    detector = null;
    detectorModel = "";
    detectorFailed = false;
  }
  if (detector) detector.threshold = next.threshold;
  await startMic();
  if (mic === "granted") {
    void loadDetector();
    if (mode === "off") setMode("idle");
  } else {
    setMode("off");
  }
}

async function micPermission(): Promise<PermissionState | "unknown"> {
  try {
    return (await navigator.permissions.query({ name: "microphone" as PermissionName })).state;
  } catch {
    return "unknown";
  }
}

/** When the mic-permission page grants access, start without waiting for the worker. */
async function watchPermission(): Promise<void> {
  try {
    const status = await navigator.permissions.query({ name: "microphone" as PermissionName });
    status.onchange = () => {
      if (config) void configure(config);
    };
  } catch {
    // Permissions API unavailable — the worker re-configures after "mic-granted".
  }
}

async function startMic(): Promise<void> {
  if (stream?.active && audio && audio.state !== "closed") {
    mic = "granted";
    if (audio.state === "suspended") await audio.resume().catch(() => undefined);
    return;
  }
  releaseMic();
  // Chrome cannot show the permission prompt in an offscreen document → the worker opens the mic-permission page.
  const permission = await micPermission();
  if (permission === "denied") {
    mic = "denied";
    return;
  }
  if (permission === "prompt") {
    mic = "needed";
    return;
  }
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    });
  } catch (error) {
    const name = (error as DOMException | null)?.name;
    mic = name === "NotAllowedError" || name === "SecurityError" ? "needed" : "unavailable";
    stream = null;
    return;
  }
  try {
    audio = new AudioContext({ sampleRate: 16_000 }); // Chrome resamples the mic to 16 kHz (Gemini Live + openWakeWord rate)
    await audio.audioWorklet.addModule(extensionUrl(ASSET_PATHS.worklet));
    const source = audio.createMediaStreamSource(stream);
    worklet = new AudioWorkletNode(audio, "lotse-pcm-frames", { numberOfInputs: 1, numberOfOutputs: 1, channelCount: 1, channelCountMode: "explicit" });
    const mute = audio.createGain();
    mute.gain.value = 0;
    source.connect(worklet).connect(mute).connect(audio.destination);
    worklet.port.onmessage = (event: MessageEvent<Float32Array>) => onFrame(event.data);
    if (audio.state === "suspended") await audio.resume().catch(() => undefined);
    stream.getAudioTracks()[0]?.addEventListener("ended", () => {
      utterance?.cancel();
      releaseMic();
      mic = "unavailable";
      setMode("off");
    });
    mic = "granted";
  } catch (error) {
    console.warn("[lotse voice] audio pipeline failed:", errorText(error));
    releaseMic();
    mic = "unavailable";
  }
}

function releaseMic(): void {
  if (worklet) {
    worklet.port.onmessage = null;
    worklet.disconnect();
    worklet = null;
  }
  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  if (audio && audio.state !== "closed") void audio.close().catch(() => undefined);
  audio = null;
}

function setMode(next: OffscreenMode): void {
  if (next === mode) return;
  mode = next;
  notifyWorker({ type: "mode", mode, mic });
}

// ---------------------------------------------------------------------------
// Wake word
// ---------------------------------------------------------------------------

function loadDetector(): Promise<void> {
  if (!config || detectorFailed || (detector && detectorModel === config.keywordModel)) return detectorLoading ?? Promise.resolve();
  const { keywordModel, threshold } = config;
  detectorLoading ??= WakeWordDetector.load({
    modelBaseUrl: extensionUrl(ASSET_PATHS.wakewordDir),
    wasmUrl: extensionUrl(ASSET_PATHS.ortWasm),
    keywordModel,
    threshold,
    cooldownMs: VOICE_DEFAULTS.cooldownMs,
  })
    .then((loaded) => {
      detector = loaded;
      detectorModel = keywordModel;
    })
    .catch((error: unknown) => {
      detectorFailed = true;
      console.warn("[lotse voice] wake word unavailable:", errorText(error));
      notifyWorker({ type: "error", message: "Wake-Word konnte nicht geladen werden — der Kurzbefehl funktioniert weiter." });
    })
    .finally(() => {
      detectorLoading = null;
    });
  return detectorLoading;
}

function onFrame(frame: Float32Array): void {
  if (utterance) {
    utterance.push(frame);
    return;
  }
  const active = detector;
  if (!config?.wakeWord || !active || mode !== "idle" || pendingFrames >= MAX_PENDING_FRAMES) return;
  pendingFrames++;
  active
    .detect(frame)
    .then((hit) => {
      if (hit && !utterance && config?.wakeWord && mode === "idle") startUtterance("wake");
    })
    .catch((error: unknown) => {
      if (wakeErrorReported) return;
      wakeErrorReported = true;
      console.warn("[lotse voice] wake word inference failed:", errorText(error));
    })
    .finally(() => {
      pendingFrames--;
    });
}

// ---------------------------------------------------------------------------
// Listening → Gemini Live transcription
// ---------------------------------------------------------------------------

function startUtterance(trigger: ListenTrigger): void {
  if (utterance || !config) return;
  speech?.abort(); // barge-in: the user talks, Lotse stops talking
  const vad = detector;
  vad?.resetVad();
  setMode("listening");
  beep();
  utterance = new LiveUtterance({
    serverUrl: config.serverUrl,
    sessionId: config.sessionId,
    trigger,
    speechProbability: (frame) =>
      vad ? vad.speechProbability(frame).catch(() => energySpeechProbability(frame)) : Promise.resolve(energySpeechProbability(frame)),
    onDone: ({ text, error }) => {
      utterance = null;
      detector?.reset();
      if (text) notifyWorker({ type: "transcript", text, trigger });
      else if (error) notifyWorker({ type: "error", message: error });
      setMode(mic === "granted" && config?.voice ? "idle" : "off");
    },
  });
}

/** Short rising tone: "I'm listening". */
function beep(): void {
  if (!audio || audio.state !== "running") return;
  const t = audio.currentTime;
  const tone = audio.createOscillator();
  const gain = audio.createGain();
  tone.type = "sine";
  tone.frequency.setValueAtTime(660, t);
  tone.frequency.linearRampToValueAtTime(990, t + 0.12);
  gain.gain.setValueAtTime(0.0001, t);
  gain.gain.exponentialRampToValueAtTime(0.08, t + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
  tone.connect(gain).connect(audio.destination);
  tone.start(t);
  tone.stop(t + 0.18);
}

// ---------------------------------------------------------------------------
// Spoken answers (POST /api/lotse/tts → audio/wav)
// ---------------------------------------------------------------------------

async function speak(text: string): Promise<OffscreenReply> {
  speech?.abort();
  if (!config || !text.trim()) return { ok: true, mic };
  const controller = new AbortController();
  speech = controller;
  notifyWorker({ type: "speaking", speaking: true });
  try {
    const response = await fetch(`${config.serverUrl}/api/lotse/tts`, {
      method: "POST",
      headers: { "Content-Type": "application/json", [LOTSE_HEADERS.session]: config.sessionId },
      body: JSON.stringify({ text }),
      signal: controller.signal,
    });
    if (response.status === 204) return { ok: true, mic };
    if (!response.ok) throw new Error(`Sprachausgabe fehlgeschlagen (HTTP ${response.status}).`);
    return await play(await response.blob(), controller.signal);
  } catch (error) {
    return { ok: false, mic, error: controller.signal.aborted ? "stopped" : errorText(error) };
  } finally {
    if (speech === controller) {
      speech = null;
      notifyWorker({ type: "speaking", speaking: false });
    }
  }
}

function play(blob: Blob, signal: AbortSignal): Promise<OffscreenReply> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve({ ok: false, mic, error: "stopped" });
    const url = URL.createObjectURL(blob);
    const player = new Audio(url);
    let settled = false;
    const done = (reply: OffscreenReply) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", onAbort);
      player.onended = null;
      player.onerror = null;
      player.pause();
      URL.revokeObjectURL(url);
      resolve(reply);
    };
    const onAbort = () => done({ ok: false, mic, error: "stopped" });
    signal.addEventListener("abort", onAbort, { once: true });
    player.onended = () => done({ ok: true, mic });
    player.onerror = () => done({ ok: false, mic, error: "Die Antwort konnte nicht abgespielt werden." });
    player.play().catch((error: unknown) => done({ ok: false, mic, error: errorText(error) }));
  });
}
