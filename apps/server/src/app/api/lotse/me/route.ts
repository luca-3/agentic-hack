import {
  DeleteMyDataResponseSchema,
  MY_DATA_TABLES,
  MyDataSchema,
  type DeleteMyDataResponse,
  type MyData,
  type MyDataCounts,
  type MyDataTable,
} from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { errorJson, guard, GuardError } from "@/lib/lotse/guard";
import { subjectHash } from "@/lib/lotse/memory";
import { createAdminClient } from "@/lib/supabase/admin";

export const OPTIONS = preflight;

/**
 * Data access + deletion per person (D-33). Signed-in only; counts, never contents; the salt and raw hashes never
 * leave the server. Pre-login data ("s:<session>") belongs to no person and stays (see D-33).
 */
type Ids = { sub: string; key: string; hash: string };
const COLUMN: Record<MyDataTable, { column: string; value: (ids: Ids) => string }> = {
  agent_usage: { column: "user_id", value: (i) => i.sub },
  lotse_events: { column: "user_id", value: (i) => i.sub },
  lotse_user_prefs: { column: "subject_id", value: (i) => i.key },
  lotse_offer_feedback: { column: "subject_id", value: (i) => i.key },
  lotse_offers: { column: "subject_id", value: (i) => i.key },
  agent_memory_evidence: { column: "subject_hash", value: (i) => i.hash },
  knowledge_gap_subjects: { column: "subject_hash", value: (i) => i.hash },
};
// Feedback before offers (it references them); evidence/subjects last, after their ids were collected for recounting.
const DELETE_ORDER: MyDataTable[] = [
  "agent_usage", "lotse_events", "lotse_user_prefs", "lotse_offer_feedback", "lotse_offers", "agent_memory_evidence", "knowledge_gap_subjects",
];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const noStore = (cors: Record<string, string>) => ({ ...cors, "Cache-Control": "no-store" });
const idsFor = (sub: string): Ids => ({ sub, key: `u:${sub}`, hash: subjectHash(`u:${sub}`) });
const emptyCounts = () => Object.fromEntries(MY_DATA_TABLES.map((t) => [t, 0])) as MyDataCounts;

async function signedIn(request: Request): Promise<string> {
  const caller = await guard(request, "me");
  if (!caller.userId) throw new GuardError("unauthorized", "Please sign in to view or delete your Valo data.", 401);
  return caller.userId;
}

/** GET /api/lotse/me → MyData of the signed-in person. */
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const ids = idsFor(await signedIn(request));
    const db = createAdminClient();
    const counts = emptyCounts();
    for (const table of MY_DATA_TABLES) {
      const { column, value } = COLUMN[table];
      const { count, error } = await db.from(table).select("*", { count: "exact", head: true }).eq(column, value(ids));
      if (error) throw new GuardError("internal", `Counting in ${table} failed.`, 500);
      counts[table] = count ?? 0;
    }
    const { data: prefs, error } = await db.from("lotse_user_prefs").select("proactive_threshold").eq("subject_id", ids.key).maybeSingle();
    if (error) throw new GuardError("internal", "Reading your own threshold failed.", 500);
    const body: MyData = MyDataSchema.parse({ userId: ids.sub, counts, proactiveThreshold: prefs ? Number(prefs.proactive_threshold) : null });
    return Response.json(body, { headers: noStore(cors) });
  } catch (e) {
    return errorJson(e, cors);
  }
}

/** DELETE /api/lotse/me → delete own data. DELETE /api/lotse/me?userId=<uuid> → org admin deletes a member's data. */
export async function DELETE(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const callerId = await signedIn(request);
    const target = new URL(request.url).searchParams.get("userId");
    const db = createAdminClient();
    let sub = callerId;
    if (target && target !== callerId) {
      if (!UUID.test(target)) throw new GuardError("bad_request", "userId must be a UUID.", 400);
      const { data: adminOrgs, error: e1 } = await db.from("org_members").select("org_id").eq("user_id", callerId).eq("is_admin", true);
      if (e1) throw new GuardError("internal", "Checking admin rights failed.", 500);
      const orgIds = (adminOrgs ?? []).map((r) => r.org_id as string);
      if (!orgIds.length) throw new GuardError("unauthorized", "Only org admins can delete other people's data.", 403);
      const { count, error: e2 } = await db.from("org_members").select("*", { count: "exact", head: true }).eq("user_id", target).in("org_id", orgIds);
      if (e2) throw new GuardError("internal", "Checking membership failed.", 500);
      if (!count) throw new GuardError("unauthorized", "This person is not a member of an organization you manage.", 403);
      sub = target;
    }
    const ids = idsFor(sub);

    // Collect the aggregates this person contributed to, so their person counters can be recounted afterwards.
    const { data: ev, error: e3 } = await db.from("agent_memory_evidence").select("memory_id").eq("subject_hash", ids.hash);
    const { data: gs, error: e4 } = await db.from("knowledge_gap_subjects").select("gap_id").eq("subject_hash", ids.hash);
    if (e3 || e4) throw new GuardError("internal", "Reading the affected memory/gap entries failed.", 500);
    const memoryIds = [...new Set((ev ?? []).map((r) => Number(r.memory_id)))];
    const gapIds = [...new Set((gs ?? []).map((r) => Number(r.gap_id)))];

    const deleted = emptyCounts();
    const done: MyDataTable[] = [];
    for (const table of DELETE_ORDER) {
      const { column, value } = COLUMN[table];
      const { count, error } = await db.from(table).delete({ count: "exact" }).eq(column, value(ids));
      if (error) {
        throw new GuardError("internal", `Deleting in ${table} failed. Already deleted: ${done.length ? done.join(", ") : "nothing"}.`, 500);
      }
      deleted[table] = count ?? 0;
      done.push(table);
    }

    // Recount from the remaining evidence (not atomic — see D-33). Entries themselves stay.
    for (const id of memoryIds) {
      const support = await db.from("agent_memory_evidence").select("*", { count: "exact", head: true }).eq("memory_id", id).eq("polarity", "support");
      const negative = await db.from("agent_memory_evidence").select("*", { count: "exact", head: true }).eq("memory_id", id).eq("polarity", "negative");
      if (support.error || negative.error) throw new GuardError("internal", `Recounting agent_memory ${id} failed. Deleted: ${done.join(", ")}.`, 500);
      const { error } = await db.from("agent_memory").update({ persons: support.count ?? 0, negatives: negative.count ?? 0 }).eq("id", id);
      if (error) throw new GuardError("internal", `Updating agent_memory ${id} failed. Deleted: ${done.join(", ")}.`, 500);
    }
    for (const id of gapIds) {
      const remaining = await db.from("knowledge_gap_subjects").select("*", { count: "exact", head: true }).eq("gap_id", id);
      if (remaining.error) throw new GuardError("internal", `Recounting knowledge_gaps ${id} failed. Deleted: ${done.join(", ")}.`, 500);
      const { error } = await db.from("knowledge_gaps").update({ persons: remaining.count ?? 0 }).eq("id", id);
      if (error) throw new GuardError("internal", `Updating knowledge_gaps ${id} failed. Deleted: ${done.join(", ")}.`, 500);
    }

    const body: DeleteMyDataResponse = DeleteMyDataResponseSchema.parse({
      userId: sub,
      deleted,
      recounted: { agentMemory: memoryIds.length, knowledgeGaps: gapIds.length },
    });
    return Response.json(body, { headers: noStore(cors) });
  } catch (e) {
    return errorJson(e, cors);
  }
}
