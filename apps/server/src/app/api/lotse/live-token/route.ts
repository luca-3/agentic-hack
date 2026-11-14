import type { LiveTokenResponse } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { guard, toGuardError } from "@/lib/lotse/guard";
import { mintLiveTranscriptionToken } from "@/lib/voice/live-token";

export const OPTIONS = preflight;

/** Gemini Live WebSocket for ephemeral tokens — the client appends `?access_token=<token>` (see VOICE.md). */
const LIVE_WS_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained";

/**
 * POST /api/lotse/live-token → LiveTokenResponse (@lotse/shared).
 * Single-use ephemeral Gemini Live token, locked to transcription-only (`gemini-3.5-transcribe-live`).
 * The extension connects to Gemini directly with it; the Gemini key never leaves the server. Client guide: apps/server/VOICE.md.
 */
export async function POST(request: Request) {
  const headers = { ...corsHeaders(request.headers.get("origin")), "Cache-Control": "no-store" };

  // Shared runtime guard (src/lib/lotse/guard.ts): auth + kill switch + "voice sessions per minute"
  // (one token = one spoken question; LOTSE_LIMIT_LIVE_TOKENS_PER_MIN=8 per session, LOTSE_LIMIT_LIVE_TOKENS_GLOBAL_PER_MIN=60).
  try {
    await guard(request, "voice");
  } catch (e) {
    const g = toGuardError(e);
    const h = g.retryAfterSec ? { ...headers, "Retry-After": String(g.retryAfterSec) } : headers;
    const message = g.code === "rate_limited" ? "Too many voice requests — please wait a moment." : g.message;
    return Response.json({ error: g.code, message }, { status: g.status, headers: h });
  }

  try {
    const body: LiveTokenResponse = { ...(await mintLiveTranscriptionToken()), wsUrl: LIVE_WS_URL };
    return Response.json(body, { headers });
  } catch (error) {
    console.error("[live-token] mint failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "internal", message: "Voice token could not be created." }, { status: 502, headers });
  }
}
