import { z } from "zod";
import { IntentRequestSchema } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { contextHeader, resolveContext } from "@/lib/lotse/context";
import { chargeBudget, errorJson, guard, GuardError, readJson } from "@/lib/lotse/guard";
import { inferIntent } from "@/lib/lotse/observe";

export const OPTIONS = preflight;

/**
 * POST /api/lotse/intent — stage 2 of the staged pipeline (D-23): inferred UI states (context.states) + history +
 * app knowledge (org context: features, app name, role; client appKnowledge as untrusted notes) → WorkflowIntent.
 * No images. Lite model, ≤ 8 s. Guide: apps/server/RUNTIME.md.
 */
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const caller = await guard(request, "intent");
    const parsed = IntentRequestSchema.safeParse(await readJson(request, "intent"));
    if (!parsed.success) throw new GuardError("bad_request", z.prettifyError(parsed.error), 400);
    const body = parsed.data;
    // app → org → features + role (org_members beats the client role); never throws, falls back to the fixture.
    const ctx = await resolveContext(request, caller, { appId: body.appId, role: body.role, url: body.context.snapshot.url });
    const { result, tokens } = await inferIntent(
      body,
      { caller, appId: ctx.appId, orgId: ctx.app.orgId, appName: ctx.app.appName, features: ctx.app.features, role: ctx.role },
      request.signal,
    );
    chargeBudget(caller, tokens);
    return Response.json(result, { headers: { ...cors, ...contextHeader(ctx), "Cache-Control": "no-store" } });
  } catch (e) {
    return errorJson(e, cors);
  }
}
