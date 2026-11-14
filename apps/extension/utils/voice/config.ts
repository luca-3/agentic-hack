/** Tunables of the voice pipeline (apps/extension/VOICE.md). Override per browser via chrome.storage.local `lotse:voice-config`. */
export const VOICE_DEFAULTS = {
  /**
   * openWakeWord keyword. No pre-trained "Hey Valo" model exists → the demo uses "hey_jarvis"
   * (pre-trained models are CC BY-NC-SA 4.0: fine for the hackathon, not for commercial use).
   */
  keyword: "hey_jarvis",
  /** Score threshold of the keyword head (openWakeWord default 0.5). Raise to ~0.6–0.7 if it fires by itself. */
  threshold: 0.5,
  /** No second wake-word hit within this window. */
  cooldownMs: 2_000,
  /** End of utterance after this much silence once speech has started. */
  endSilenceMs: 1_000,
  /** Hard cap for one spoken question. */
  maxUtteranceMs: 10_000,
  /** Give up when nothing was said within this time. */
  noSpeechMs: 6_000,
  /** After `audioStreamEnd`: wait this long for Gemini's final transcript, then use the interim text. */
  finalTranscriptTimeoutMs: 4_000,
  /** Absolute upper bound for one listening session (token + socket setup included). */
  sessionTimeoutMs: 20_000,
  /** Speech in the first ms after the trigger does not start the utterance (tail of "…Jarvis", start beep). */
  graceMs: { wake: 350, hotkey: 250, button: 250 },
  /** Upper bound for the "thinking" state when the background never reports that the answer is done. */
  thinkingTimeoutMs: 25_000,
} as const;

/** Bundled keyword models (wxt.config.ts copies them to /wakeword/). Add a trained "hey_valo" here later. */
export const WAKEWORD_MODEL_FILES: Record<string, string> = {
  hey_jarvis: "hey_jarvis_v0.1.onnx",
};

/** chrome.storage.local key: `{ keyword?: string; threshold?: number; wakeWord?: boolean }`. */
export const VOICE_CONFIG_KEY = "lotse:voice-config";
/** chrome.storage.session key for the pseudonymous voice session id (rate-limit key on the server). */
export const VOICE_SESSION_KEY = "lotse:voice-session";

// "Hey Jarvis, …" / "Hallo Valo: …" / "Valo …" at the start of the transcript.
const WAKE_PHRASE = /^\s*(?:(?:hey|hei|hi|he|hallo|ok|okay)[\s,!.]+)?(?:jarvis|valo|walo|lotse|lotsen|lotze)\b[\s,.!?:;–-]*/i;

/** Removes a leading wake phrase from a transcript; "" when nothing else was said. */
export function stripWakePhrase(text: string): string {
  const rest = text.replace(/\s+/g, " ").trim().replace(WAKE_PHRASE, "").trim();
  if (!rest || !/[\p{L}\p{N}]/u.test(rest)) return "";
  return rest.charAt(0).toUpperCase() + rest.slice(1);
}

// Abbreviations whose dot must not end a sentence ("z. B. das Feld …").
const ABBREVIATIONS = /\b(z\. ?B|d\. ?h|u\. ?a|o\. ?ä|bzw|ggf|usw|evtl|inkl|ca|Nr|Str|Hr|Fr|Dr|vgl|etc)\./gi;
const DOT = "․";

/** First `maxSentences` sentences, whitespace collapsed, capped at `maxChars` (the server applies the same cut). */
export function shortenForSpeech(text: string, maxSentences = 2, maxChars = 280): string {
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const guarded = clean.replace(ABBREVIATIONS, (m) => m.replace(/\./g, DOT));
  const sentences = guarded.match(/[^.!?…]+(?:[.!?…]+["“”'»«)]*|$)/g) ?? [guarded];
  const out = sentences.slice(0, maxSentences).join(" ").replace(/\s+/g, " ").trim().replaceAll(DOT, ".");
  if (out.length <= maxChars) return out;
  const cut = out.slice(0, maxChars);
  const space = cut.lastIndexOf(" ");
  return `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, "")}.`;
}
