import { z } from "zod";
import { KnowledgeSearchRequestSchema, type KnowledgeSearchResponse } from "@lotse/shared";
import { searchDocuments } from "@/lib/ai/embeddings";
import { corsHeaders, preflight } from "@/lib/cors";
import { userFromRequest } from "@/lib/supabase/user";

export const OPTIONS = preflight;

/**
 * POST /api/knowledge/search — semantic search in the caller's org (optionally one app).
 * Contract: KnowledgeSearchRequest / KnowledgeSearchResponse in @lotse/shared. Auth: Bearer Supabase access token.
 */
export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));
  const auth = await userFromRequest(request);
  if (!auth) return Response.json({ error: "Not signed in." }, { status: 401, headers });

  const parsed = KnowledgeSearchRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers });
  }
  const { query, appId, limit } = parsed.data;

  // ponytail: first membership wins; add an orgId to the request when users belong to several orgs.
  const { data: member } = await auth.supabase
    .from("org_members")
    .select("org_id")
    .eq("user_id", auth.user.id)
    .limit(1)
    .maybeSingle();
  if (!member) return Response.json({ error: "No organization found." }, { status: 403, headers });

  try {
    const rows = await searchDocuments(query, { orgId: member.org_id, appId, limit: limit ?? 5, minSimilarity: 0.3 });
    const hits = rows.map((r) => ({ id: r.id, content: r.content, sourceId: r.source_id, similarity: r.similarity }));
    return Response.json({ hits } satisfies KnowledgeSearchResponse, { headers });
  } catch (error) {
    console.error("knowledge search failed", error);
    return Response.json({ error: "Knowledge could not be searched." }, { status: 500, headers });
  }
}
