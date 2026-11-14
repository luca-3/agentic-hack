import "server-only";
import { LOTSE_HEADERS } from "@lotse/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanText, devAuthAllowed, type Caller } from "./guard";
import { knowledgeSource, resolveAppId, type AppKnowledge } from "./knowledge";

/**
 * Per-request context for /ask and /decide: app → org → features (KnowledgeSource) + the caller's role.
 *
 * Role: an authenticated caller who is a member of the app's org gets `org_members.role` — a client-sent role is
 * ignored then. The client role is only used in dev / anonymous mode (`devAuthAllowed`), e.g. the demo role switcher.
 * Knowledge base: searchable for members of the app's org, and for anonymous callers in dev mode.
 */
export interface RequestContext {
  appId: string;
  app: AppKnowledge;
  role?: string;
  roleSource: "org" | "client" | "none";
  /** Org whose knowledge base the agent may search (null = no knowledge search). */
  knowledgeOrgId: string | null;
}

const ROLE_CACHE_MS = 60_000;
const roleCache = new Map<string, { until: number; role: string | null }>();

/** org_members.role of the user in that org; null = not a member; undefined = lookup failed. */
export async function memberRole(orgId: string, userId: string): Promise<string | null | undefined> {
  const key = `${orgId}:${userId}`;
  const hit = roleCache.get(key);
  if (hit && Date.now() < hit.until) return hit.role;
  try {
    const { data, error } = await createAdminClient()
      .from("org_members")
      .select("role")
      .eq("org_id", orgId)
      .eq("user_id", userId)
      .abortSignal(AbortSignal.timeout(2_000))
      .maybeSingle();
    if (error) throw new Error(error.message);
    const role = (data?.role as string | undefined) ?? null;
    roleCache.set(key, { until: Date.now() + ROLE_CACHE_MS, role });
    return role;
  } catch (e) {
    console.warn("[lotse] member role lookup failed:", (e as Error).message);
    return undefined;
  }
}

export async function resolveContext(
  request: Request,
  caller: Caller,
  body: { appId?: string; role?: string; url?: string },
): Promise<RequestContext> {
  const appId = resolveAppId(body.appId, request.headers.get(LOTSE_HEADERS.app), body.url);
  const app = await knowledgeSource().getApp(appId);
  const clientRole = body.role ? cleanText(body.role, 40) || undefined : undefined;

  const orgRole = caller.userId && app.orgId ? await memberRole(app.orgId, caller.userId) : undefined;
  const isMember = typeof orgRole === "string";
  const useClient = !isMember && !!clientRole && devAuthAllowed();
  const role = isMember ? orgRole : useClient ? clientRole : undefined;

  return {
    appId,
    app,
    role,
    roleSource: isMember ? "org" : useClient ? "client" : "none",
    knowledgeOrgId: app.orgId && (isMember || !caller.userId) ? app.orgId : null,
  };
}

/** Debug header so clients/smoke tests can see which context was used (no ids, no names). */
export function contextHeader(ctx: RequestContext): Record<string, string> {
  return { "x-lotse-context": `knowledge=${ctx.app.source};org=${ctx.app.orgId ? "yes" : "no"};role=${ctx.roleSource}` };
}
