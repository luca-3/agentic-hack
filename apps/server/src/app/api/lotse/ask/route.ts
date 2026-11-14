import { z } from "zod";
import { AskRequestSchema, type AskResponse, type GuidanceEvent } from "@lotse/shared";
import { runGuidance, type RunResult } from "@/lib/lotse/agent";
import { corsHeaders, preflight } from "@/lib/cors";
import { capSnapshot, chargeBudget, guard, GuardError, readJson, toGuardError, type Caller } from "@/lib/lotse/guard";
import { contextHeader, resolveContext } from "@/lib/lotse/context";
import { afterAsk } from "@/lib/lotse/gaps";
import { activeMemories, rankMemories } from "@/lib/lotse/memory";
import { chooseTier, TIERS } from "@/lib/lotse/orchestrator";
import { logUsage } from "@/lib/lotse/usage";

export const OPTIONS = preflight;

/**
 * POST /api/lotse/ask — question + page snapshot (+ observation history, inferred intent, ≤ 4 screenshots) → guidance.
 * Last stage of the staged pipeline after a positive /decide (source "proactive"), or directly for explicit questions.
 * `Accept: application/x-ndjson` → stream of GuidanceEvents (tier → point/plan/say as they happen → done | error).
 * Otherwise → legacy JSON `{ elementNumber, sentence, snapshotId }`. Integration guide: apps/server/RUNTIME.md.
 */
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  const ndjson = (request.headers.get("accept") ?? "").includes("application/x-ndjson");

  let caller: Caller;
  let body: z.infer<typeof AskRequestSchema>;
  try {
    caller = await guard(request, "ask");
    const parsed = AskRequestSchema.safeParse(await readJson(request, "ask"));
    if (!parsed.success) throw new GuardError("bad_request", z.prettifyError(parsed.error), 400);
    body = parsed.data;
  } catch (e) {
    return errorResponse(toGuardError(e), ndjson, cors);
  }

  const snapshot = capSnapshot(body.snapshot);
  // app → org → features + role (org_members beats the client role); never throws, falls back to the fixture.
  const ctx = await resolveContext(request, caller, { appId: body.appId, role: body.role, url: snapshot.url });
  const { app, appId, role } = ctx;
  // Agent memory (D-28): active, learned hints of this org/app (cached), ranked for the question — same access as the KB.
  const [decision, memories] = await Promise.all([
    chooseTier({ question: body.question, snapshot, features: app.features, role }),
    activeMemories(ctx.knowledgeOrgId, app.dashboardAppId),
  ]);
  const memory = rankMemories(memories, `${body.question} ${body.intent?.goal ?? ""}`, { limit: 6, role });
  if (decision.classifier) {
    void logUsage({ route: "ask", tier: "classify", ...decision.classifier, caller, appId, orgId: app.orgId });
  }

  const started = Date.now();
  const snapshotId = body.snapshot.id;
  async function* events(): AsyncGenerator<GuidanceEvent> {
    yield { type: "tier", tier: decision.tier, model: TIERS[decision.tier].model, ...(snapshotId ? { snapshotId } : {}) };
    const gen = runGuidance({
      question: body.question,
      snapshot,
      features: app.features,
      orgId: ctx.knowledgeOrgId,
      dashboardAppId: app.dashboardAppId,
      appName: app.appName,
      appNotes: body.appKnowledge,
      role,
      recentEvents: body.recentEvents ?? body.observation?.workflow.events.slice(-50),
      source: body.source,
      observation: body.observation,
      intent: body.intent,
      memory,
      decision,
      signal: request.signal,
    });
    let r: IteratorResult<GuidanceEvent, RunResult>;
    while (!(r = await gen.next()).done) yield r.value;
    const run = r.value;

    chargeBudget(caller, run.usage?.totalTokens);
    void logUsage({
      route: "ask",
      tier: run.tier,
      model: run.model,
      inputTokens: run.usage?.inputTokens,
      outputTokens: run.usage?.outputTokens,
      totalTokens: run.usage?.totalTokens,
      latencyMs: run.latencyMs,
      status: run.status,
      error: run.error,
      caller,
      appId,
      orgId: app.orgId,
    });
    // Learning (background, after the answer): knowledge gap or agent-memory evidence — never the question text.
    void afterAsk({
      question: body.question,
      source: body.source,
      features: app.features,
      role,
      decision,
      run,
      caller,
      appId,
      orgId: ctx.knowledgeOrgId,
      dashboardAppId: app.dashboardAppId ?? null,
    });

    if (run.status === "timeout") yield { type: "error", code: "timeout", message: "Lotse hat zu lange gebraucht — bitte nochmal versuchen." };
    else if (run.status === "error") yield { type: "error", code: "internal", message: "Lotse konnte die Frage gerade nicht beantworten." };
    else
      yield {
        type: "done",
        usage: {
          model: run.model,
          inputTokens: run.usage?.inputTokens,
          outputTokens: run.usage?.outputTokens,
          totalTokens: run.usage?.totalTokens,
          latencyMs: Date.now() - started,
        },
      };
  }

  if (ndjson) {
    const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({
      async start(controller) {
        try {
          for await (const ev of events()) controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        } catch (e) {
          const g = toGuardError(e);
          controller.enqueue(encoder.encode(JSON.stringify({ type: "error", code: g.code, message: g.message }) + "\n"));
        } finally {
          controller.close();
        }
      },
    });
    return new Response(stream, {
      headers: {
        ...cors,
        ...contextHeader(ctx),
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
      },
    });
  }

  // Legacy JSON: first point (or first current-page plan step) → elementNumber; say text or hint → sentence.
  let elementNumber: number | null = null;
  let sentence = "";
  let hint = "";
  let error: GuidanceEvent | undefined;
  for await (const ev of events()) {
    if (ev.type === "point" && elementNumber === null) [elementNumber, hint] = [ev.elementNumber, ev.hint ?? ev.label];
    if (ev.type === "plan" && elementNumber === null) {
      const first = ev.steps[0];
      if (first.elementNumber !== undefined) elementNumber = first.elementNumber;
      hint ||= ev.steps.map((s, i) => `${i + 1}. ${s.label}`).join(" → ");
    }
    if (ev.type === "say" && !sentence) sentence = ev.text;
    if (ev.type === "error") error = ev;
  }
  if (error?.type === "error") {
    return Response.json({ error: { code: error.code, message: error.message } }, { status: error.code === "timeout" ? 504 : 500, headers: cors });
  }
  const res: AskResponse = { elementNumber, sentence: sentence || hint, ...(snapshotId ? { snapshotId } : {}) };
  return Response.json(res, { headers: { ...cors, ...contextHeader(ctx) } });
}

function errorResponse(g: GuardError, ndjson: boolean, cors: Record<string, string>) {
  const headers: Record<string, string> = { ...cors };
  if (g.retryAfterSec) headers["Retry-After"] = String(g.retryAfterSec);
  if (!ndjson) return Response.json({ error: { code: g.code, message: g.message } }, { status: g.status, headers });
  return new Response(JSON.stringify({ type: "error", code: g.code, message: g.message }) + "\n", {
    status: g.status,
    headers: { ...headers, "Content-Type": "application/x-ndjson; charset=utf-8" },
  });
}
