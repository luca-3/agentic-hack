import { LOTSE_HEADERS, type LiveTokenResponse } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { mintLiveTranscriptionToken } from "@/lib/voice/live-token";

export const OPTIONS = preflight;

/**
 * POST /api/lotse/live-token → LiveTokenResponse (@lotse/shared).
 * Single-use ephemeral Gemini Live token, locked to transcription-only (`gemini-3.5-transcribe-live`).
 * The extension connects to Gemini directly with it; the Gemini key never leaves the server. Client guide: apps/server/VOICE.md.
 */
export async function POST(request: Request) {
  const headers = { ...corsHeaders(request.headers.get("origin")), "Cache-Control": "no-store" };

  // TODO(guard): replace with the shared runtime guard (auth + per-session/org budgets) once it lands in src/lib.
  const sessionKey =
    request.headers.get(LOTSE_HEADERS.session) ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
  const retryAfter = rateLimit(sessionKey);
  if (retryAfter !== null) {
    return Response.json(
      { error: "rate_limited", message: "Zu viele Sprachanfragen — kurz warten." },
      { status: 429, headers: { ...headers, "Retry-After": String(retryAfter) } },
    );
  }

  try {
    const body: LiveTokenResponse = await mintLiveTranscriptionToken();
    return Response.json(body, { headers });
  } catch (error) {
    console.error("[live-token] mint failed:", error instanceof Error ? error.message : error);
    return Response.json({ error: "internal", message: "Sprach-Token konnte nicht erstellt werden." }, { status: 502, headers });
  }
}

// ---------------------------------------------------------------------------
// Simple in-memory fixed-window limit (per dev-server process; fine for the hackathon, not for multi-instance).
// Each token = one utterance, so 8/min per session is plenty for a human; global cap protects the key.
// ---------------------------------------------------------------------------
const WINDOW_MS = 60_000;
const PER_SESSION_LIMIT = 8;
const GLOBAL_LIMIT = 60;
const windows = new Map<string, { start: number; count: number }>();

/** Returns null if allowed, otherwise seconds until the window resets. */
function rateLimit(sessionKey: string): number | null {
  const now = Date.now();
  for (const [key, limit] of [
    [`s:${sessionKey}`, PER_SESSION_LIMIT],
    ["global", GLOBAL_LIMIT],
  ] as const) {
    let w = windows.get(key);
    if (!w || now - w.start >= WINDOW_MS) {
      w = { start: now, count: 0 };
      windows.set(key, w);
    }
    if (w.count >= limit) return Math.ceil((w.start + WINDOW_MS - now) / 1000);
  }
  windows.get(`s:${sessionKey}`)!.count++;
  windows.get("global")!.count++;
  if (windows.size > 5_000) {
    for (const [key, w] of windows) if (now - w.start >= WINDOW_MS) windows.delete(key);
  }
  return null;
}
