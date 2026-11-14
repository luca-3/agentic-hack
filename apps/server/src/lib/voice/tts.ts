import "server-only";
import { generateSpeech } from "ai";
import { google } from "@/lib/ai/google";

/**
 * Spoken answers (D-16): the extension's offscreen document plays what this returns. Only `say` text is spoken,
 * at most two short sentences — pointing at the element is the real answer, speech is optional garnish.
 *
 * Models verified for our key on 2026-11-14 via models.list: `gemini-3.8-flash-tts`, `gemini-3.8-flash-lite-tts`
 * (both generateContent). Override with LOTSE_TTS_MODEL / LOTSE_TTS_VOICE without touching code.
 */
export const TTS_MODEL = process.env.LOTSE_TTS_MODEL || "gemini-3.8-flash-tts";
/** One of Gemini's prebuilt voices (multilingual; the spoken language comes from `language`). Case-sensitive. */
export const TTS_VOICE = process.env.LOTSE_TTS_VOICE || "Kore";
export const TTS_MAX_SENTENCES = 2;
export const TTS_MAX_CHARS = 280;

// Abbreviations whose dot must not end a sentence ("e.g. the field …", "z. B. das Feld …").
const ABBREVIATIONS = /\b(e\. ?g|i\. ?e|vs|z\. ?B|d\. ?h|u\. ?a|o\. ?ä|bzw|ggf|usw|evtl|inkl|ca|Nr|Str|Hr|Fr|Dr|vgl|etc)\./gi;
const DOT = "․"; // one-dot leader, swapped back after splitting

/** Collapse whitespace, keep the first two sentences, cap the length at a word boundary. "" = nothing to say. */
export function shortenForSpeech(text: string, maxSentences = TTS_MAX_SENTENCES, maxChars = TTS_MAX_CHARS): string {
  const clean = text.replace(/[\u0000-\u001f\u007f]+/g, " ").replace(/\s+/g, " ").trim();
  if (!clean) return "";
  const protectedText = clean.replace(ABBREVIATIONS, (m) => m.replace(/\./g, DOT));
  const sentences = protectedText.match(/[^.!?…]+(?:[.!?…]+["“”'»«)]*|$)/g) ?? [protectedText];
  let out = sentences.slice(0, maxSentences).join(" ").replace(/\s+/g, " ").trim().replaceAll(DOT, ".");
  if (out.length > maxChars) {
    const cut = out.slice(0, maxChars);
    const space = cut.lastIndexOf(" ");
    out = `${(space > maxChars * 0.6 ? cut.slice(0, space) : cut).replace(/[,;:\s]+$/, "")}.`;
  }
  return out;
}

/**
 * The agent answers in the language of the question (prompt.ts), so speech follows the text: a cheap guess from
 * umlauts and common function words. English wins ties (English-first product; German only with clear evidence).
 */
export function speechLanguage(text: string): "de-DE" | "en-US" {
  const t = ` ${text.toLowerCase().replace(/[^\p{L}\s]/gu, " ")} `;
  if (/[äöüß]/.test(t)) return "de-DE";
  const hits = (re: RegExp) => (t.match(re) ?? []).length;
  const de = hits(/\s(?=(der|die|das|und|ist|nicht|du|dich|dir|ein|eine|zu|auf|mit|für|kannst|klick|hier|wie|bitte|oder|nur)\s)/g);
  const en = hits(/\s(?=(the|and|is|not|you|your|a|an|to|on|with|for|can|click|here|how|please|this|or|only)\s)/g);
  return de > en ? "de-DE" : "en-US";
}

/** Style instruction for the TTS model (English for every language; the spoken language comes from `language`). */
const STYLE = "Friendly, calm and brisk, like a helpful colleague.";

/** Text → playable audio (WAV) via Gemini TTS, spoken in the text's language. Caller passes shortened, non-empty text. */
export async function synthesizeSpeech(text: string, abortSignal?: AbortSignal): Promise<{ audio: Uint8Array; mediaType: string }> {
  const language = speechLanguage(text);
  const result = await generateSpeech({
    model: google.speech(TTS_MODEL),
    text,
    voice: TTS_VOICE,
    language,
    outputFormat: "wav",
    instructions: STYLE,
    maxRetries: 1,
    abortSignal,
  });
  return { audio: result.audio.uint8Array, mediaType: result.audio.mediaType || "audio/wav" };
}
