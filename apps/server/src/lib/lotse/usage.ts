import "server-only";
import type { LotseEvent } from "@lotse/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanText, type Caller } from "./guard";

/**
 * One row in public.agent_usage per LLM call. Logging never breaks a request.
 * route: runtime stages (ask/state/intent/decide), the learning loop (explore = feature drafts, learn = its Gemini
 * drafts if any), memory = topic labels for agent memory / knowledge gaps (gaps.ts), insights = insights pipeline.
 */
export type UsageRoute = "ask" | "state" | "intent" | "decide" | "explore" | "learn" | "memory" | "insights";

export interface UsageRecord {
  route: UsageRoute;
  tier?: string;
  model: string;
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
  latencyMs: number;
  status: "ok" | "timeout" | "error" | "aborted";
  error?: string;
  caller: Caller;
  appId?: string;
  orgId?: string | null;
}

export async function logUsage(r: UsageRecord) {
  try {
    const { error } = await createAdminClient()
      .from("agent_usage")
      .insert({
        route: r.route,
        tier: r.tier ?? null,
        model: r.model,
        input_tokens: r.inputTokens ?? null,
        output_tokens: r.outputTokens ?? null,
        total_tokens: r.totalTokens ?? null,
        latency_ms: Math.round(r.latencyMs),
        status: r.status,
        error: r.error?.slice(0, 500) ?? null,
        session_id: r.caller.sessionId,
        user_id: r.caller.userId,
        org_id: r.orgId ?? null,
        app_id: r.appId ?? null,
      });
    if (error) console.warn("[lotse] usage log failed:", error.message);
  } catch (e) {
    console.warn("[lotse] usage log failed:", (e as Error).message);
  }
}

export async function storeEvents(events: LotseEvent[], caller: Caller, appId: string | undefined) {
  try {
    const { error } = await createAdminClient()
      .from("lotse_events")
      .insert(
        events.map((e) => ({
          ts: new Date(Number.isFinite(e.ts) ? e.ts : Date.now()).toISOString(),
          type: e.type,
          route: e.route.slice(0, 300),
          element_role: e.elementRole ? cleanText(e.elementRole, 30) : null,
          element_label: e.elementLabel ? cleanText(e.elementLabel, 80) : null,
          detail: e.detail ? cleanText(e.detail, 200) : null,
          session_id: caller.sessionId,
          user_id: caller.userId,
          app_id: appId ?? null,
        })),
      );
    if (error) console.warn("[lotse] event insert failed:", error.message);
  } catch (e) {
    console.warn("[lotse] event insert failed:", (e as Error).message);
  }
}
