import { z } from "zod";
import { UIStateRequestSchema } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { contextHeader, resolveContext } from "@/lib/lotse/context";
import { chargeBudget, errorJson, guard, GuardError, readJson } from "@/lib/lotse/guard";
import { inferState } from "@/lib/lotse/observe";

export const OPTIONS = preflight;

/**
 * POST /api/lotse/state — stage 1 of the staged pipeline (D-23): DOM snapshot + recent events → UIStateInference.
 * No images. snapshotId/capturedAt echo the request snapshot. Lite model, ≤ 6 s. Guide: apps/server/RUNTIME.md.
 */
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const caller = await guard(request, "state");
    const parsed = UIStateRequestSchema.safeParse(await readJson(request, "state"));
    if (!parsed.success) throw new GuardError("bad_request", z.prettifyError(parsed.error), 400);
    const ctx = await resolveContext(request, caller, { url: parsed.data.snapshot.url });
    const { result, tokens, cached } = await inferState(
      parsed.data,
      { caller, appId: ctx.appId, orgId: ctx.app.orgId, appName: ctx.app.appName },
      request.signal,
    );
    chargeBudget(caller, tokens);
    return Response.json(result, {
      headers: { ...cors, ...contextHeader(ctx), "Cache-Control": "no-store", "x-lotse-cache": cached ? "hit" : "miss" },
    });
  } catch (e) {
    return errorJson(e, cors);
  }
}
