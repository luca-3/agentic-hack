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

/** Last 50 `[lotse voice]` console lines of this document (wake score peaks, pipeline errors) for the debug dump. */
const voiceLog: string[] = [];
for (const level of ["info", "warn", "error"] as const) {
  const original = console[level].bind(console);
  console[level] = (...args: unknown[]) => {
    if (typeof args[0] === "string" && args[0].startsWith("[lotse voice]")) {
      const text = args.map((arg) => (typeof arg === "string" ? arg : arg instanceof Error ? arg.message : String(arg))).join(" ");
      voiceLog.push(`${new Date().toISOString().slice(11, 23)} ${level} ${text}`.slice(0, 300));
      if (voiceLog.length > 50) voiceLog.shift();
    }
    original(...args);
  };
}

browser.runtime.onMessage.addListener((message: unknown, _sender, respond: (reply: OffscreenReply) => void) => {
  if (!isOffscreenCommand(message)) return; // not a voice command → let other listeners answer
  if (message.type === "debug-log") { respond({ ok: true, mic, mode, log: [...voiceLog] }); return; }
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
      // Toggle off reliably even if the service worker restarted while an utterance was already active.
      if (utterance || mode === "listening") return stopUtterance();
      if (mic !== "granted") return { ok: false, mic, error: "Microphone access is not granted." };
      startUtterance(command.trigger);
      return { ok: true, mic };
    case "stop-listening":
      return stopUtterance();
    case "cancel":
      utterance?.cancel();
      setMode(mic === "granted" && config?.voice ? "idle" : "off");
      return { ok: true, mic };
    case "speak":
      return speak(command.text);
    case "stop-speaking":
      speech?.abort();
      return { ok: true, mic };
    case "debug-log": // normally answered by the listener without reconfiguring
      return { ok: true, mic, log: [...voiceLog] };
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
      notifyWorker({ type: "error", message: "The wake word could not be loaded — the keyboard shortcut still works." });
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
  speech?.abort(); // barge-in: the user talks, Valo stops talking
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

function stopUtterance(): OffscreenReply {
  const active = utterance;
  if (!active) {
    setMode(mic === "granted" && config?.voice ? "idle" : "off");
    return { ok: true, mic, transcribing: false };
  }
  const hadSpeech = active.hasSpeech();
  // Leave "listening" immediately so the orb and mic button respond instantaneously on click.
  setMode(mic === "granted" && config?.voice ? "idle" : "off");
  active.stop();
  return { ok: true, mic, transcribing: hadSpeech && utterance !== null };
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
// Spoken answers (POST /api/lotse/tts?stream=1 → raw PCM chunks, played as they arrive; WAV as fallback)
// ---------------------------------------------------------------------------

async function speak(text: string): Promise<OffscreenReply> {
  speech?.abort();
  if (!config || !text.trim()) return { ok: true, mic };
  const controller = new AbortController();
  speech = controller;
  notifyWorker({ type: "speaking", speaking: true });
  try {
    const request = (stream: boolean) =>
      fetch(`${config!.serverUrl}/api/lotse/tts${stream ? "?stream=1" : ""}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", [LOTSE_HEADERS.session]: config!.sessionId },
        body: JSON.stringify({ text }),
        signal: controller.signal,
      });
    let response = await request(true);
    if (!response.ok && response.status !== 204 && !controller.signal.aborted) response = await request(false); // streaming failed → complete WAV
    if (response.status === 204) return { ok: true, mic };
    if (!response.ok) throw new Error(`Speech output failed (HTTP ${response.status}).`);
    const type = response.headers.get("content-type") ?? "";
    if (type.startsWith("audio/l16") && response.body) return await playPcmStream(response.body, pcmRate(type), controller.signal);
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

const pcmRate = (type: string) => Number(/rate=(\d+)/.exec(type)?.[1] ?? 24_000) || 24_000;
/** Small lead before the first chunk so network jitter between chunks does not cause gaps. */
const PCM_LEAD_S = 0.1;

/** Plays 16-bit little-endian mono PCM while it streams in; resolves when the last chunk has played (or on abort). */
async function playPcmStream(body: ReadableStream<Uint8Array>, rate: number, signal: AbortSignal): Promise<OffscreenReply> {
  const ctx = new AudioContext();
  const sources: AudioBufferSourceNode[] = [];
  const reader = body.getReader();
  const onAbort = () => {
    reader.cancel().catch(() => undefined);
    for (const source of sources) {
      try { source.stop(); } catch { /* not started yet */ }
    }
  };
  signal.addEventListener("abort", onAbort, { once: true });
  let next = 0;
  let carry: Uint8Array | null = null;
  try {
    await ctx.resume().catch(() => undefined);
    for (;;) {
      const { value, done } = await reader.read();
      if (done || signal.aborted) break;
      if (!value?.length) continue;
      let bytes = value;
      if (carry) {
        bytes = new Uint8Array(carry.length + value.length);
        bytes.set(carry);
        bytes.set(value, carry.length);
      }
      const even = bytes.length - (bytes.length % 2);
      carry = even < bytes.length ? bytes.slice(even) : null;
      const samples = even / 2;
      if (!samples) continue;
      const view = new DataView(bytes.buffer, bytes.byteOffset, even);
      const buffer = ctx.createBuffer(1, samples, rate);
      const channel = buffer.getChannelData(0);
      for (let i = 0; i < samples; i++) channel[i] = view.getInt16(i * 2, true) / 32768;
      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);
      next = Math.max(next, ctx.currentTime + PCM_LEAD_S);
      source.start(next);
      next += buffer.duration;
      sources.push(source);
    }
    if (!signal.aborted && next > ctx.currentTime) {
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, (next - ctx.currentTime) * 1000 + 50);
        signal.addEventListener("abort", () => { clearTimeout(timer); resolve(); }, { once: true });
      });
    }
    return signal.aborted ? { ok: false, mic, error: "stopped" } : { ok: true, mic };
  } catch (error) {
    return { ok: false, mic, error: signal.aborted ? "stopped" : errorText(error) };
  } finally {
    signal.removeEventListener("abort", onAbort);
    void ctx.close().catch(() => undefined);
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
    player.onerror = () => done({ ok: false, mic, error: "The answer could not be played." });
    player.play().catch((error: unknown) => done({ ok: false, mic, error: errorText(error) }));
  });
}
