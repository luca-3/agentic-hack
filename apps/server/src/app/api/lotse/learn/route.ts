import { z } from "zod";
import { LearnRequestSchema, type LearnResponse } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { errorJson, rateLimit, readJson } from "@/lib/lotse/guard";
import { runLearn } from "@/lib/lotse/learn";
import { createAdminClient } from "@/lib/supabase/admin";
import { userFromRequest } from "@/lib/supabase/user";

export const OPTIONS = preflight;

/**
 * POST /api/lotse/learn — run the learning detectors for the caller's org now ("Jetzt auswerten", D-25).
 * Contract: LearnRequest / LearnResponse in @lotse/shared. Auth: Bearer Supabase access token, org admin.
 */
export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));
  const auth = await userFromRequest(request);
  if (!auth) return Response.json({ error: "Not signed in." }, { status: 401, headers });

  let body: unknown = {};
  try {
    rateLimit("prefs", { key: `u:${auth.user.id}`, sessionId: null, userId: auth.user.id });
    if (request.body && request.headers.get("content-length") !== "0") body = await readJson(request);
  } catch (e) {
    return errorJson(e, headers);
  }
  const parsed = LearnRequestSchema.safeParse(body ?? {});
  if (!parsed.success) return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers });
  const { appId } = parsed.data;

  // Org = the app's org when appId is given, else the caller's first admin org (user client, RLS).
  let orgId: string | undefined;
  if (appId) {
    const { data: app } = await createAdminClient().from("apps").select("org_id").eq("id", appId).maybeSingle();
    if (!app) return Response.json({ error: "App not found." }, { status: 404, headers });
    orgId = app.org_id as string;
  } else {
    const { data: rows } = await auth.supabase.from("org_members").select("org_id, is_admin").eq("user_id", auth.user.id);
    orgId = (rows?.find((r) => r.is_admin) ?? rows?.[0])?.org_id as string | undefined;
  }
  if (!orgId) return Response.json({ error: "No organization found." }, { status: 403, headers });

  const { data: isAdmin } = await auth.supabase.rpc("is_org_admin", { org: orgId });
  if (isAdmin !== true) return Response.json({ error: "Only org admins can run the analysis." }, { status: 403, headers });

  try {
    return Response.json((await runLearn(orgId, appId)) satisfies LearnResponse, { headers });
  } catch (error) {
    console.error("learn failed", error);
    return Response.json({ error: "Analysis failed." }, { status: 500, headers });
  }
}
