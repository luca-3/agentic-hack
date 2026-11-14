import { z } from "zod";
import { corsHeaders, preflight } from "@/lib/cors";
import { isUuid, resolveApp } from "@/lib/insights/aggregate";
import { generateInsights } from "@/lib/insights/generate";
import { devAuthAllowed } from "@/lib/lotse/guard";
import { userFromRequest } from "@/lib/supabase/user";

export const OPTIONS = preflight;

const BodySchema = z.object({
  /** Dashboard apps.id or a domain such as "localhost:4000". Default: the Kundenwerk demo CRM. */
  appId: z.string().min(1).max(200).optional(),
  orgId: z.string().refine(isUuid, "orgId must be a uuid").optional(),
  days: z.number().int().min(1).max(90).optional(),
  /** Write metric rows into public.insights (dashboard). Default true. */
  write: z.boolean().optional(),
  /** One Gemini call for training/UX suggestions. Default true; false = rule-based pain points only. */
  llm: z.boolean().optional(),
});

const DEFAULT_APP = "localhost:4000";
const PER_MIN = 5; // one Gemini call each — protect the key
const recent: number[] = [];

const fail = (code: string, message: string, status: number, headers: Record<string, string>) =>
  Response.json({ error: { code, message } }, { status, headers });

/**
 * POST /api/insights/generate — aggregates usage of one app (≥ 5 persons per group, D-12) → pain points,
 * training suggestions and UX potential (one Gemini call); writes metric rows into public.insights.
 * Auth: Bearer token of an admin of the app's org; without token only in dev (NODE_ENV ≠ production or LOTSE_DEV_AUTH=1).
 */
export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));
  if (process.env.LOTSE_DISABLED === "1") return fail("disabled", "Valo is currently disabled.", 503, headers);

  const hasToken = /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "");
  const auth = hasToken ? await userFromRequest(request) : null;
  if (hasToken && !auth) return fail("unauthorized", "Invalid or expired token.", 401, headers);
  if (!auth && !devAuthAllowed()) return fail("unauthorized", "Org admins only (Authorization: Bearer <token>).", 401, headers);

  const now = Date.now();
  while (recent.length && now - recent[0] > 60_000) recent.shift();
  if (recent.length >= PER_MIN) {
    const retry = Math.max(1, Math.ceil((recent[0] + 60_000 - now) / 1000));
    return fail("rate_limited", "Too many analysis runs — please wait a moment.", 429, { ...headers, "Retry-After": String(retry) });
  }

  const text = await request.text();
  let json: unknown = {};
  try {
    json = text.trim() ? JSON.parse(text) : {};
  } catch {
    return fail("bad_request", "Body must be JSON.", 400, headers);
  }
  const parsed = BodySchema.safeParse(json);
  if (!parsed.success) return fail("bad_request", z.prettifyError(parsed.error), 400, headers);
  const body = parsed.data;

  try {
    const app = await resolveApp(body.appId ?? DEFAULT_APP, body.orgId);
    if (!app) return fail("bad_request", "App not found.", 404, headers);
    if (auth) {
      const { data: isAdmin } = await auth.supabase.rpc("is_org_admin", { org: app.orgId });
      if (isAdmin !== true) return fail("forbidden", "Only org admins can generate insights.", 403, headers);
    }
    recent.push(now);
    const report = await generateInsights(app, {
      days: body.days ?? 30,
      write: body.write ?? true,
      llm: body.llm ?? true,
      userId: auth?.user.id ?? null,
    });
    return Response.json(report, { headers });
  } catch (e) {
    console.error("[insights] generate failed:", e instanceof Error ? e.message : e);
    return fail("internal", "Insights could not be generated.", 500, headers);
  }
}
