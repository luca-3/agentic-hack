import { z } from "zod";
import { DecideRequestSchema, LOTSE_HEADERS } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { decide } from "@/lib/lotse/decide";
import { capSnapshot, chargeBudget, errorJson, guard, GuardError, readJson } from "@/lib/lotse/guard";
import { knowledgeSource, resolveAppId } from "@/lib/lotse/knowledge";

export const OPTIONS = preflight;

/**
 * POST /api/lotse/decide — "should Lotse offer help now?" → DecideResponse.
 * Gemini Decisions API (gemini-decision-1, ~0.6 s) with lite-model fallback; per-user adaptive threshold (D-22).
 */
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const caller = await guard(request, "decide");
    const parsed = DecideRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new GuardError("bad_request", z.prettifyError(parsed.error), 400);
    const req = { ...parsed.data, snapshot: parsed.data.snapshot ? capSnapshot(parsed.data.snapshot) : undefined };
    const appId = resolveAppId(req.appId, request.headers.get(LOTSE_HEADERS.app), req.snapshot?.url);
    const app = await knowledgeSource().getApp(appId);
    const { response, tokens } = await decide(req, app.features, { caller, appId, orgId: app.orgId });
    chargeBudget(caller, tokens);
    return Response.json(response, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (e) {
    return errorJson(e, cors);
  }
}
