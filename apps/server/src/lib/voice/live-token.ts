import "server-only";
import { GoogleGenAI } from "@google/genai";
import type { LiveTokenResponse } from "@lotse/shared";

/**
 * Ephemeral Gemini Live tokens for voice INPUT only (D-16: one brain on the server, voice is just in/out).
 * The extension opens the Live WebSocket itself with this token; audio goes browser → Gemini, never through us.
 *
 * Verified 2026-11-14 with our key: `gemini-3.5-transcribe-live` (bidiGenerateContent) returns
 * `serverContent.inputTranscription` ~0.4–0.6 s after `audioStreamEnd` (or ~1.2 s after the speaker stops via server VAD).
 * Conversation models (`gemini-3.1-flash-live-preview`, `gemini-3.8-live`) are audio-out only → not usable for text-only transcription.
 */
export const LIVE_TRANSCRIBE_MODEL = "gemini-3.5-transcribe-live";

/** WebSocket endpoint for constrained (ephemeral-token) sessions. Append `?access_token=<token>`. */
export const LIVE_CONSTRAINED_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

/** Locked session config: transcription only (the model can't answer, call tools or produce audio). */
const TRANSCRIPTION_CONFIG = {
  inputAudioTranscription: {
    languageCodes: ["de-DE", "en-US"],
    // Biases recognition towards product/domain words that show up in demo questions.
    customVocabulary: ["Lotse", "Hey Lotse", "IBAN", "CRM", "Bankverbindung"],
  },
};

/** Session must be opened within this window … */
const NEW_SESSION_WINDOW_MS = 60_000;
/** … and is cut off after this (one utterance is ≤ 10 s; generous margin for slow starts). */
const TOKEN_LIFETIME_MS = 2 * 60_000;

let client: GoogleGenAI | undefined;
function genai() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set");
  client ??= new GoogleGenAI({ apiKey, httpOptions: { apiVersion: "v1alpha" } });
  return client;
}

/**
 * Mint a single-use token. `liveConnectConstraints` is set and `lockAdditionalFields` is omitted
 * → model AND the whole LiveConnectConfig are locked; whatever the client sends in `setup` is ignored
 * (checked: a client asking for gemini-3.8-live + AUDIO output is rejected for the transcribe model).
 */
export async function mintLiveTranscriptionToken(): Promise<LiveTokenResponse> {
  const now = Date.now();
  const expiresAt = new Date(now + TOKEN_LIFETIME_MS).toISOString();
  const token = await genai().authTokens.create({
    config: {
      uses: 1,
      expireTime: expiresAt,
      newSessionExpireTime: new Date(now + NEW_SESSION_WINDOW_MS).toISOString(),
      liveConnectConstraints: { model: LIVE_TRANSCRIBE_MODEL, config: TRANSCRIPTION_CONFIG },
      httpOptions: { apiVersion: "v1alpha" },
    },
  });
  if (!token.name) throw new Error("Gemini returned no token");
  return { token: token.name, model: LIVE_TRANSCRIBE_MODEL, expiresAt };
}
