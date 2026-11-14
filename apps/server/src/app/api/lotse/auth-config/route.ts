import type { AuthConfigResponse } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { errorJson, GuardError } from "@/lib/lotse/guard";

export const OPTIONS = preflight;

/**
 * GET /api/lotse/auth-config → the PUBLIC Supabase URL + publishable key, so the extension can sign users in
 * (email/password) without build-time env plumbing. Never returns the secret key.
 */
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (!supabaseUrl || !publishableKey) return errorJson(new GuardError("internal", "Supabase is not configured on the server.", 503), cors);
  const body: AuthConfigResponse = { supabaseUrl, publishableKey };
  return Response.json(body, { headers: { ...cors, "Cache-Control": "no-store" } });
}
