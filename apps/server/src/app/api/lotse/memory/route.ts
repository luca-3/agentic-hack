import { z } from "zod";
import { corsHeaders, preflight } from "@/lib/cors";
import { dismissGap, listGaps, resolveGap } from "@/lib/lotse/gaps";
import { devAuthAllowed, errorJson, GuardError, rateLimit, readJson } from "@/lib/lotse/guard";
import {
  adminCreateMemory,
  expireStaleMemories,
  listMemories,
  MEMORY_KINDS,
  MEMORY_MIN_PERSONS,
  MEMORY_STATUSES,
  MEMORY_TTL_DAYS,
  setMemoryStatus,
  type MemoryStatus,
} from "@/lib/lotse/memory";
import { createAdminClient } from "@/lib/supabase/admin";
import { userFromRequest } from "@/lib/supabase/user";

export const OPTIONS = preflight;

/**
 * Agent memory admin API (D-28) for the dashboard / learning loop.
 *   GET  /api/lotse/memory?app=<apps.id|host>&status=<proposed|active|rejected|expired>
 *        → { orgId, appId, minPersons, ttlDays, expired, memories: AgentMemory[], gaps: KnowledgeGap[] (≥ 5 persons, open) }
 *   POST /api/lotse/memory  { action, app?, … }
 *        approve | reject | expire { id }            → { memory }
 *        create { kind, topic, content, feature? }    → { memory }   (admin-written, active at once)
 *        resolve_gap { gapId, content }               → { gap, memory } (gap_resolution memory, active)
 *        dismiss_gap { gapId }                        → { gap }
 * Auth: Bearer Supabase access token of an org admin (is_org_admin). Dev (NODE_ENV ≠ production or LOTSE_DEV_AUTH=1)
 * also without token — then `app` (default localhost:4000) picks the org. Errors: { error: { code, message } }.
 */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEV_APP = "localhost:4000";

interface Scope {
  orgId: string;
  appId: string | null; // dashboard apps.id
  userId: string | null;
}

async function findApp(ref: string): Promise<{ id: string; org_id: string } | null> {
  const key = ref.trim().toLowerCase();
  const q = createAdminClient().from("apps").select("id, org_id").limit(1);
  const { data, error } = await (UUID.test(key) ? q.eq("id", key) : q.overlaps("domains", [key, `http://${key}`, `https://${key}`]));
  if (error) throw new Error(`apps read failed: ${error.message}`);
  return (data?.[0] as { id: string; org_id: string } | undefined) ?? null;
}

/** Org admin (Bearer) or dev mode → the org/app this request acts on. Throws GuardError. */
async function adminScope(request: Request, appRef: string | undefined): Promise<Scope> {
  const hasToken = /^Bearer\s+\S+/i.test(request.headers.get("authorization") ?? "");
  const auth = hasToken ? await userFromRequest(request) : null;
  if (hasToken && !auth) throw new GuardError("unauthorized", "Invalid or expired token.", 401);
  if (!auth && !devAuthAllowed()) throw new GuardError("unauthorized", "Missing Authorization: Bearer <token>.", 401);
  const sessionId = request.headers.get("x-lotse-session")?.slice(0, 100) || null;
  rateLimit(
    "prefs",
    auth ? { key: `u:${auth.user.id}`, sessionId, userId: auth.user.id } : { key: `s:${sessionId ?? "dev"}`, sessionId, userId: null },
  );

  let orgId: string | undefined;
  let appId: string | null = null;
  const ref = appRef?.trim() || (auth ? undefined : DEV_APP);
  if (ref) {
    const app = await findApp(ref);
    if (!app) throw new GuardError("bad_request", "App not found.", 404);
    [orgId, appId] = [app.org_id, app.id];
  } else if (auth) {
    const { data: rows } = await auth.supabase.from("org_members").select("org_id, is_admin").eq("user_id", auth.user.id);
    orgId = ((rows ?? []).find((r) => r.is_admin) ?? rows?.[0])?.org_id as string | undefined;
  }
  if (!orgId) throw new GuardError("bad_request", "No organization found.", 403);

  if (auth) {
    const { data: isAdmin } = await auth.supabase.rpc("is_org_admin", { org: orgId });
    if (isAdmin !== true) throw new GuardError("unauthorized", "Only org admins can manage the agent memory.", 403);
  }
  return { orgId, appId, userId: auth?.user.id ?? null };
}

export async function GET(request: Request) {
  const headers = { ...corsHeaders(request.headers.get("origin")), "Cache-Control": "no-store" };
  try {
    const url = new URL(request.url);
    const status = url.searchParams.get("status") ?? undefined;
    if (status && !MEMORY_STATUSES.includes(status as MemoryStatus)) {
      throw new GuardError("bad_request", `status must be one of ${MEMORY_STATUSES.join(", ")}.`, 400);
    }
    const scope = await adminScope(request, url.searchParams.get("app") ?? undefined);
    const expired = await expireStaleMemories(scope.orgId);
    const [memories, gaps] = await Promise.all([
      listMemories(scope.orgId, { appId: scope.appId, status: status as MemoryStatus | undefined }),
      listGaps(scope.orgId, { appId: scope.appId, minPersons: MEMORY_MIN_PERSONS }),
    ]);
    return Response.json(
      { orgId: scope.orgId, appId: scope.appId, minPersons: MEMORY_MIN_PERSONS, ttlDays: MEMORY_TTL_DAYS, expired, memories, gaps },
      { headers },
    );
  } catch (e) {
    return errorJson(e, headers);
  }
}

const App = z.string().max(200).optional();
const Id = z.number().int().positive();
const PostSchema = z.union([
  z.object({ action: z.literal("approve"), id: Id, app: App }),
  z.object({ action: z.literal("reject"), id: Id, app: App }),
  z.object({ action: z.literal("expire"), id: Id, app: App }),
  z.object({
    action: z.literal("create"),
    app: App,
    kind: z.enum(MEMORY_KINDS),
    topic: z.string().min(2).max(120),
    content: z.string().min(2).max(400),
    feature: z.string().max(120).optional(),
  }),
  z.object({ action: z.literal("resolve_gap"), gapId: Id, content: z.string().min(2).max(400), app: App }),
  z.object({ action: z.literal("dismiss_gap"), gapId: Id, app: App }),
]);

const STATUS_OF = { approve: "active", reject: "rejected", expire: "expired" } as const;
const notFound = () => new GuardError("bad_request", "Not found.", 404);

export async function POST(request: Request) {
  const headers = { ...corsHeaders(request.headers.get("origin")), "Cache-Control": "no-store" };
  try {
    const parsed = PostSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new GuardError("bad_request", z.prettifyError(parsed.error), 400);
    const body = parsed.data;
    const scope = await adminScope(request, body.app);

    switch (body.action) {
      case "approve":
      case "reject":
      case "expire": {
        const memory = await setMemoryStatus(scope.orgId, body.id, STATUS_OF[body.action], scope.userId);
        if (!memory) throw notFound();
        return Response.json({ memory }, { headers });
      }
      case "create": {
        const memory = await adminCreateMemory({ ...scope, kind: body.kind, topic: body.topic, content: body.content, feature: body.feature });
        return Response.json({ memory }, { headers });
      }
      case "resolve_gap": {
        const result = await resolveGap(scope.orgId, body.gapId, body.content, scope.userId);
        if (!result) throw notFound();
        return Response.json(result, { headers });
      }
      case "dismiss_gap": {
        const gap = await dismissGap(scope.orgId, body.gapId);
        if (!gap) throw notFound();
        return Response.json({ gap }, { headers });
      }
    }
  } catch (e) {
    return errorJson(e, headers);
  }
}
