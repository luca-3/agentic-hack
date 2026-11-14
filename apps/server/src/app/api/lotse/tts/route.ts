import { z } from "zod";
import { corsHeaders, preflight } from "@/lib/cors";
import { errorJson, GuardError, guard, readJson } from "@/lib/lotse/guard";
import { shortenForSpeech, STREAM_MEDIA_TYPE, streamSpeech, synthesizeSpeech } from "@/lib/voice/tts";

export const OPTIONS = preflight;

/** Body: the `say` text of a guidance event. Local schema until the contract owner moves it to @lotse/shared. */
const TtsRequestSchema = z.object({ text: z.string().max(2_000) });

/**
 * POST /api/lotse/tts { text } → `audio/wav` (Gemini TTS in the text's language, ≤ 2 sentences) · 204 when there is nothing to say.
 * POST /api/lotse/tts?stream=1 → raw PCM (`audio/l16; rate=24000`) streamed chunk by chunk, so playback starts after
 * ~1 s instead of ~3 s. The first chunk is awaited before answering, so a failing model still yields a JSON error.
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

    if (new URL(request.url).searchParams.get("stream") === "1") {
      const chunks = streamSpeech(text, request.signal);
      const first = await chunks.next();
      let closed = false;
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          if (first.done) { closed = true; controller.close(); }
          else controller.enqueue(first.value);
        },
        async pull(controller) {
          if (closed) return;
          try {
            const next = await chunks.next();
            if (closed) return;
            if (next.done) { closed = true; controller.close(); }
            else controller.enqueue(next.value);
          } catch (e) {
            if (!closed) { closed = true; controller.error(e); }
          }
        },
        cancel() {
          closed = true;
          void chunks.return(undefined);
        },
      });
      return new Response(body, { headers: { ...headers, "Content-Type": STREAM_MEDIA_TYPE, "x-lotse-spoken": encodeURIComponent(text) } });
    }

    const { audio, mediaType } = await synthesizeSpeech(text, request.signal);
    return new Response(new Blob([new Uint8Array(audio)], { type: mediaType }), {
      headers: { ...headers, "Content-Type": mediaType, "x-lotse-spoken": encodeURIComponent(text) },
    });
  } catch (e) {
    return errorJson(e, headers);
  }
}
