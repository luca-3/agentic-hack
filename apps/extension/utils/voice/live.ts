/**
 * One spoken question → Gemini Live transcription (offscreen document). Protocol: apps/server/VOICE.md.
 * Token first (POST /api/lotse/live-token, single use, config locked server-side), socket opened right away,
 * mic audio buffered until `setupComplete`, end of utterance by client VAD (~1 s silence) or 10 s cap,
 * then `audioStreamEnd` → final `inputTranscription`. Only Gemini — no other speech recognizer.
 */
import { LOTSE_HEADERS, LiveTokenResponseSchema } from "@lotse/shared";
import { VOICE_DEFAULTS } from "./config";
import { errorText, type ListenTrigger } from "./protocol";

const LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";
const FRAME_MS = 80;
const SPEECH_ON = 0.5;
const SPEECH_OFF = 0.35;

export interface UtteranceOptions {
  serverUrl: string;
  sessionId: string;
  trigger: ListenTrigger;
  /** Speech probability 0…1 for one 80 ms frame (Silero VAD, energy fallback). */
  speechProbability(frame: Float32Array): Promise<number>;
  /** Called exactly once. Empty `text` without `error` = cancelled. */
  onDone(result: { text: string; error?: string }): void;
}

interface LiveServerMessage {
  setupComplete?: unknown;
  serverContent?: {
    inputTranscription?: { text?: string };
    interimInputTranscription?: { text?: string };
  };
}

export class LiveUtterance {
  private ws: WebSocket | null = null;
  private ready = false;
  private queued: string[] = [];
  private capturing = true;
  private streamEnded = false;
  private endSent = false;
  private finished = false;
  private interim = "";
  private speechStarted = false;
  private silenceMs = 0;
  private framesSeen = 0;
  private vadChain: Promise<void> = Promise.resolve();
  private readonly timers: ReturnType<typeof setTimeout>[] = [];
  private readonly abort = new AbortController();
  private readonly graceFrames: number;

  constructor(private readonly options: UtteranceOptions) {
    this.graceFrames = Math.ceil(VOICE_DEFAULTS.graceMs[options.trigger] / FRAME_MS);
    this.timers.push(
      setTimeout(() => this.endOfSpeech(), VOICE_DEFAULTS.maxUtteranceMs),
      setTimeout(() => {
        if (!this.speechStarted && !this.interim) this.finish("", "I didn't hear a question.");
      }, VOICE_DEFAULTS.noSpeechMs),
      setTimeout(() => this.finish(this.interim, "Speech recognition took too long."), VOICE_DEFAULTS.sessionTimeoutMs),
    );
    void this.connect();
  }

  /** One 80 ms mic frame (Float32, 16 kHz). Streams it (or buffers until setupComplete) and updates end-of-utterance. */
  push(frame: Float32Array): void {
    if (!this.capturing || this.finished) return;
    const audio = pcm16Base64(frame);
    if (this.ready) this.sendAudio(audio);
    else this.queued.push(audio);
    const index = this.framesSeen++;
    this.vadChain = this.vadChain
      .then(() => this.options.speechProbability(frame))
      .then((p) => this.onSpeechProbability(p, index))
      .catch(() => undefined);
  }

  /** The user says they're done (second hotkey press): stop capturing and transcribe what we have. */
  stop(): void {
    this.endOfSpeech();
  }

  /** Stop without a result (barge-in, voice switched off). */
  cancel(): void {
    this.finish("");
  }

  private onSpeechProbability(p: number, index: number): void {
    if (!this.capturing || this.finished) return;
    if (p >= SPEECH_ON && index >= this.graceFrames) {
      this.speechStarted = true;
      this.silenceMs = 0;
    } else if (this.speechStarted && p < SPEECH_OFF) {
      this.silenceMs += FRAME_MS;
      if (this.silenceMs >= VOICE_DEFAULTS.endSilenceMs) this.endOfSpeech();
    }
  }

  private async connect(): Promise<void> {
    try {
      const response = await fetch(`${this.options.serverUrl}/api/lotse/live-token`, {
        method: "POST",
        headers: { [LOTSE_HEADERS.session]: this.options.sessionId },
        signal: this.abort.signal,
      });
      if (!response.ok) {
        throw new Error(response.status === 429 ? "Too many voice requests — wait a moment." : `Voice token failed (HTTP ${response.status}).`);
      }
      const token = LiveTokenResponseSchema.parse(await response.json());
      if (this.finished) return;
      const ws = new WebSocket(`${token.wsUrl ?? LIVE_WS_URL}?access_token=${encodeURIComponent(token.token)}`);
      this.ws = ws;
      ws.onopen = () => ws.send(JSON.stringify({ setup: { model: `models/${token.model}` } })); // config is locked server-side
      ws.onmessage = (event: MessageEvent) => void this.onMessage(event.data);
      ws.onclose = (event: CloseEvent) => {
        if (this.finished) return;
        const reason = event.code === 1000 ? undefined : `Speech recognition disconnected (${event.code}${event.reason ? `: ${event.reason}` : ""}).`;
        if (reason) console.warn("[lotse voice]", reason);
        this.finish(this.interim, reason);
      };
    } catch (error) {
      if (!this.finished) this.finish("", this.abort.signal.aborted ? undefined : errorText(error));
    }
  }

  private async onMessage(data: unknown): Promise<void> {
    const raw = typeof data === "string" ? data : data instanceof Blob ? await data.text() : new TextDecoder().decode(data as ArrayBuffer);
    let message: LiveServerMessage;
    try {
      message = JSON.parse(raw) as LiveServerMessage;
    } catch {
      return;
    }
    if (message.setupComplete !== undefined && !this.ready) {
      this.ready = true;
      for (const audio of this.queued.splice(0)) this.sendAudio(audio);
      if (this.streamEnded) this.sendStreamEnd();
      return;
    }
    const content = message.serverContent;
    const interim = content?.interimInputTranscription?.text;
    if (typeof interim === "string" && interim.trim()) this.interim = interim.trim();
    const final = content?.inputTranscription?.text;
    if (typeof final === "string" && final.trim()) this.finish(final.trim());
  }

  private endOfSpeech(): void {
    if (this.streamEnded || this.finished) return;
    this.streamEnded = true;
    this.capturing = false;
    if (this.ready) this.sendStreamEnd();
  }

  private sendStreamEnd(): void {
    if (this.endSent) return;
    this.endSent = true;
    this.send({ realtimeInput: { audioStreamEnd: true } });
    this.timers.push(
      setTimeout(() => this.finish(this.interim, this.interim ? undefined : "I didn't catch a question."), VOICE_DEFAULTS.finalTranscriptTimeoutMs),
    );
  }

  private sendAudio(data: string): void {
    this.send({ realtimeInput: { audio: { data, mimeType: "audio/pcm;rate=16000" } } });
  }

  private send(message: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(message));
  }

  private finish(text: string, error?: string): void {
    if (this.finished) return;
    this.finished = true;
    this.capturing = false;
    for (const timer of this.timers) clearTimeout(timer);
    this.abort.abort();
    if (this.ws && this.ws.readyState <= WebSocket.OPEN) this.ws.close(1000);
    this.ws = null;
    const clean = text.trim();
    this.options.onDone(clean ? { text: clean } : { text: "", error });
  }
}

/** Float32 [-1, 1] → 16-bit little-endian PCM → base64 (Gemini Live `audio/pcm;rate=16000`). */
export function pcm16Base64(frame: Float32Array): string {
  const pcm = new Int16Array(frame.length);
  for (let i = 0; i < frame.length; i++) {
    const s = Math.max(-1, Math.min(1, frame[i] ?? 0));
    pcm[i] = s < 0 ? s * 0x8000 : s * 0x7fff;
  }
  const bytes = new Uint8Array(pcm.buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}
