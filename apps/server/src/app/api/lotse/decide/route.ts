import { z } from "zod";
import { DecideRequestSchema } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { decide } from "@/lib/lotse/decide";
import { capSnapshot, chargeBudget, errorJson, guard, GuardError, readJson } from "@/lib/lotse/guard";
import { contextHeader, resolveContext } from "@/lib/lotse/context";
import { activeMemories, memoryLines, rankMemories } from "@/lib/lotse/memory";

export const OPTIONS = preflight;

/**
 * POST /api/lotse/decide — stage 3 of the staged pipeline (D-23): "should Lotse offer help now?" → DecideResponse.
 * Consumes trigger, events, snapshot, image-free context (incl. inferred states) and the /intent result.
 * Gemini Decisions API (gemini-decision-1, ~0.6 s) with lite-model fallback; per-user adaptive threshold (D-22).
 */
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const caller = await guard(request, "decide");
    const parsed = DecideRequestSchema.safeParse(await readJson(request, "decide"));
    if (!parsed.success) throw new GuardError("bad_request", z.prettifyError(parsed.error), 400);
    const raw = parsed.data.snapshot ?? parsed.data.context?.snapshot;
    const snapshot = raw ? capSnapshot(raw) : undefined;
    const events = parsed.data.events.length ? parsed.data.events : (parsed.data.context?.workflow.events.slice(-50) ?? []);
    // app → org → features (Choice options) + role (org_members beats the client role)
    const ctx = await resolveContext(request, caller, { appId: parsed.data.appId, role: parsed.data.role, url: snapshot?.url });
    const req = { ...parsed.data, snapshot, events, role: ctx.role };
    // Agent memory (D-28): learned hints matching the inferred goal / page (no fallback: irrelevant hints only add noise).
    const goal = [req.inference?.workflowName, req.inference?.intent.goal, snapshot?.title, req.triggerReason].filter(Boolean).join(" ");
    const memory = memoryLines(rankMemories(await activeMemories(ctx.knowledgeOrgId, ctx.app.dashboardAppId), goal, { limit: 4, role: ctx.role }));
    const { response, tokens } = await decide(req, ctx.app.features, { caller, appId: ctx.appId, orgId: ctx.app.orgId, memory });
    chargeBudget(caller, tokens);
    return Response.json(response, { headers: { ...cors, ...contextHeader(ctx), "Cache-Control": "no-store" } });
  } catch (e) {
    return errorJson(e, cors);
  }
}
