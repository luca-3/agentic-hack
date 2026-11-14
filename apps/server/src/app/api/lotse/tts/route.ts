import { z } from "zod";
import { corsHeaders, preflight } from "@/lib/cors";
import { errorJson, GuardError, guard, readJson } from "@/lib/lotse/guard";
import { shortenForSpeech, synthesizeSpeech } from "@/lib/voice/tts";

export const OPTIONS = preflight;

/** Body: the `say` text of a guidance event. Local schema until the contract owner moves it to @lotse/shared. */
const TtsRequestSchema = z.object({ text: z.string().max(2_000) });

/**
 * POST /api/lotse/tts { text } → `audio/wav` (Gemini TTS, German, ≤ 2 sentences) · 204 when there is nothing to say.
 * Called by the extension's offscreen document (apps/extension/VOICE.md). Shared runtime guard (auth, kill switch,
 * rate limit + daily budget of the "ask" tier — one spoken answer belongs to one question).
 */
export async function POST(request: Request) {
  const headers = { ...corsHeaders(request.headers.get("origin")), "Cache-Control": "no-store" };
  try {
    await guard(request, "ask");
    const parsed = TtsRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new GuardError("bad_request", "Body must be { text: string } (max 2000 chars).", 400);

    const text = shortenForSpeech(parsed.data.text);
    if (!text) return new Response(null, { status: 204, headers });

    const { audio, mediaType } = await synthesizeSpeech(text, request.signal);
    return new Response(new Blob([new Uint8Array(audio)], { type: mediaType }), {
      headers: { ...headers, "Content-Type": mediaType, "x-lotse-spoken": encodeURIComponent(text) },
    });
  } catch (e) {
    return errorJson(e, headers);
  }
}
