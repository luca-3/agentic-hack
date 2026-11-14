import { z } from "zod";
import { KnowledgeIngestRequestSchema, type KnowledgeIngestResponse } from "@lotse/shared";
import { addDocuments } from "@/lib/ai/embeddings";
import { corsHeaders, preflight } from "@/lib/cors";
import { createAdminClient } from "@/lib/supabase/admin";
import { userFromRequest } from "@/lib/supabase/user";

export const OPTIONS = preflight;

/**
 * POST /api/knowledge/ingest — embed chunks of an existing knowledge_sources row (org admins only).
 * Contract: KnowledgeIngestRequest / KnowledgeIngestResponse in @lotse/shared. Auth: Bearer Supabase access token.
 */
export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));
  const auth = await userFromRequest(request);
  if (!auth) return Response.json({ error: "Nicht angemeldet." }, { status: 401, headers });

  const parsed = KnowledgeIngestRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers });
  }
  const { sourceId, chunks } = parsed.data;

  // User client: RLS only shows sources of the caller's orgs.
  const { data: source } = await auth.supabase
    .from("knowledge_sources")
    .select("id, org_id, app_id, title, chars, chunks")
    .eq("id", sourceId)
    .maybeSingle();
  if (!source) return Response.json({ error: "Quelle nicht gefunden." }, { status: 404, headers });

  const { data: isAdmin } = await auth.supabase.rpc("is_org_admin", { org: source.org_id });
  if (isAdmin !== true) return Response.json({ error: "Nur Org-Admins dürfen Wissen speichern." }, { status: 403, headers });

  try {
    const ids = await addDocuments(
      chunks.map((content) => ({ content, metadata: { title: source.title } })),
      { orgId: source.org_id, appId: source.app_id, sourceId },
    );
    // ponytail: read-modify-write counters, concurrent ingests of one source can undercount; use an rpc increment if that happens.
    const { error } = await createAdminClient()
      .from("knowledge_sources")
      .update({
        chunks: source.chunks + ids.length,
        chars: source.chars + chunks.reduce((sum, c) => sum + c.length, 0),
      })
      .eq("id", sourceId);
    if (error) throw new Error(`knowledge_sources update failed: ${error.message}`);

    return Response.json({ inserted: ids.length } satisfies KnowledgeIngestResponse, { headers });
  } catch (error) {
    console.error("knowledge ingest failed", error);
    return Response.json({ error: "Wissen konnte nicht gespeichert werden." }, { status: 500, headers });
  }
}
