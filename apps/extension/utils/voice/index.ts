/**
 * Voice module — public API for `entrypoints/background.ts`. Owned by the voice session; wired into the
 * background by the guidance session. Flow (D-16, docs/handoff-extension.md): wake word (openWakeWord) or
 * hotkey → offscreen document records audio → Gemini Live transcription (token from /api/lotse/live-token)
 * → `onTranscript(text)` → background sends it down the existing explicit-question path (`lotse:wake-question`)
 * → for a `say` guidance event the background calls `speak(text)` (Gemini TTS, ≤ 2 sentences). Only Gemini.
 */
import type { VoiceState } from "@lotse/shared";

export interface VoiceHandlers {
  /** Final transcript of what the user asked (wake word already stripped). */
  onTranscript(text: string): void;
  /** Listening state for status indicators (side panel + overlay). */
  onState?(state: VoiceState): void;
}

/** Call once from the background service worker. Stub until the voice session lands. */
export function setupVoice(handlers: VoiceHandlers): void {
  void handlers;
}

/** Speak a short answer. Stub until the voice session lands. */
export async function speak(text: string): Promise<void> {
  void text;
}

/** Stop any ongoing speech (e.g. user starts a new question). */
export function stopSpeaking(): void {}
