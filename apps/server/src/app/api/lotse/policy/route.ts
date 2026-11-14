import { PolicyResponseSchema } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { authenticate, errorJson, GuardError, rateLimit } from "@/lib/lotse/guard";
import { resolvePolicy } from "@/lib/lotse/policy";

export const OPTIONS = preflight;

/**
 * GET /api/lotse/policy?app=<host> → PolicyResponse: is the app allowed, which routes must the extension never observe,
 * org/app name and (with Bearer token) the caller's org role. Works without login in dev (anonymous, role null).
 */
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const app = new URL(request.url).searchParams.get("app")?.trim();
    if (!app || app.length > 200) throw new GuardError("bad_request", "Query parameter ?app=<host> is missing.", 400);
    const caller = await authenticate(request);
    rateLimit("policy", caller);
    const policy = PolicyResponseSchema.parse(await resolvePolicy(app, caller));
    return Response.json(policy, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (e) {
    return errorJson(e, cors);
  }
}
