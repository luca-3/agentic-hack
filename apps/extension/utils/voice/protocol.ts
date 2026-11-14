/**
 * Voice-internal messages between the service worker (utils/voice/index.ts), the offscreen document
 * (entrypoints/offscreen) and the mic-permission page. Extension-internal only — not part of the HTTP contract.
 * Every message carries a `target`, so other `runtime.onMessage` listeners can ignore them (`isVoiceMessage`).
 */
import { browser } from "wxt/browser";

export const OFFSCREEN_TARGET = "lotse-voice:offscreen";
export const WORKER_TARGET = "lotse-voice:worker";
export const OFFSCREEN_PATH = "/offscreen.html";
export const MIC_PERMISSION_PATH = "/mic-permission.html";
/** Copied into the bundle by the `build:publicAssets` hook in wxt.config.ts. */
export const ASSET_PATHS = {
  worklet: "/voice/pcm-worklet.js",
  wakewordDir: "/wakeword",
  ortWasm: "/ort/ort-wasm-simd-threaded.wasm",
} as const;

export type ListenTrigger = "wake" | "hotkey" | "button";
/** granted · needed (never asked / dismissed → open the permission page) · denied (blocked in Chrome settings) · unavailable (no device / error). */
export type MicStatus = "granted" | "needed" | "denied" | "unavailable";
export type OffscreenMode = "off" | "idle" | "listening";

export interface OffscreenConfig {
  serverUrl: string;
  sessionId: string;
  /** Hold the microphone (wake word + hotkey listening). false = release the mic, playback only. */
  voice: boolean;
  /** Run the local wake-word detector while idle. */
  wakeWord: boolean;
  /** openWakeWord model file inside ASSET_PATHS.wakewordDir, e.g. "hey_jarvis_v0.1.onnx". */
  keywordModel: string;
  threshold: number;
}

/** Service worker → offscreen. Each command carries the current config (the document may have been recreated). */
export type OffscreenCommand = { target: typeof OFFSCREEN_TARGET; config: OffscreenConfig } & (
  | { type: "configure" }
  | { type: "listen"; trigger: ListenTrigger }
  /** End the utterance now and transcribe what was said (second hotkey press). */
  | { type: "stop-listening" }
  | { type: "cancel" }
  | { type: "speak"; text: string }
  | { type: "stop-speaking" }
);

export interface OffscreenReply {
  ok: boolean;
  mic?: MicStatus;
  /** Offscreen mode at reply time (lets a restarted service worker resync). */
  mode?: OffscreenMode;
  /** "stopped" = speech was interrupted on purpose (not an error). */
  error?: string;
}

/** Offscreen / mic-permission page → service worker (fire-and-forget). */
export type WorkerEvent = { target: typeof WORKER_TARGET } & (
  | { type: "ready" }
  | { type: "mode"; mode: OffscreenMode; mic: MicStatus }
  | { type: "speaking"; speaking: boolean }
  | { type: "transcript"; text: string; trigger: ListenTrigger }
  | { type: "error"; message: string }
  | { type: "mic-granted" }
  | { type: "mic-denied" }
);

type Without<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;
export type WorkerEventBody = Without<WorkerEvent, "target">;
export type OffscreenCommandBody = Without<OffscreenCommand, "target" | "config">;

/** True for any voice-internal message — other listeners should `return` early on these. */
export function isVoiceMessage(message: unknown): boolean {
  const target = (message as { target?: unknown } | null)?.target;
  return target === OFFSCREEN_TARGET || target === WORKER_TARGET;
}
export const isWorkerEvent = (message: unknown): message is WorkerEvent => (message as { target?: unknown } | null)?.target === WORKER_TARGET;
export const isOffscreenCommand = (message: unknown): message is OffscreenCommand => (message as { target?: unknown } | null)?.target === OFFSCREEN_TARGET;

/** Fire-and-forget event to the service worker (wakes it if suspended). */
export function notifyWorker(event: WorkerEventBody): void {
  browser.runtime.sendMessage({ target: WORKER_TARGET, ...event }).catch(() => undefined);
}

/** chrome-extension:// URL for a bundled file (avoids WXT's generated PublicPath union for hook-copied assets). */
export const extensionUrl = (path: string): string => (browser.runtime.getURL as (p: string) => string)(path);

export const errorText = (error: unknown): string => (error instanceof Error ? error.message : String(error));
