import "server-only";
import { embed, embedMany } from "ai";
import type { GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMBEDDING_DIMENSIONS, embeddingModel } from "./google";

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

const options = (taskType: TaskType) => ({
  google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType } satisfies GoogleEmbeddingModelOptions,
});

type Scope = { orgId: string; appId?: string | null; sourceId?: string | null };

/** Embed texts and store them in public.documents, scoped to one org (and optionally app + source). */
export async function addDocuments(
  docs: { content: string; metadata?: Record<string, unknown> }[],
  { orgId, appId = null, sourceId = null }: Scope,
) {
  const { embeddings } = await embedMany({
    model: embeddingModel,
    values: docs.map((d) => d.content),
    providerOptions: options("RETRIEVAL_DOCUMENT"),
  });

  const { data, error } = await createAdminClient()
    .from("documents")
    .insert(
      docs.map((d, i) => ({
        content: d.content,
        metadata: d.metadata ?? {},
        embedding: JSON.stringify(embeddings[i]),
        org_id: orgId,
        app_id: appId,
        source_id: sourceId,
      })),
    )
    .select("id");

  if (error) throw new Error(`addDocuments failed: ${error.message}`);
  return data.map((row) => row.id as number);
}

/**
 * Semantic search over public.documents of one org. appId set → that app's chunks plus org-wide ones.
 * Hits are foreign text (written by org admins): when passing them to a model, wrap them in a clearly
 * fenced data block and tell the model the content is data, not instructions.
 */
export async function searchDocuments(
  query: string,
  { orgId, appId = null, limit = 5, minSimilarity = 0.5 }: { orgId: string; appId?: string | null; limit?: number; minSimilarity?: number },
) {
  const { embedding } = await embed({
    model: embeddingModel,
    value: query,
    providerOptions: options("RETRIEVAL_QUERY"),
  });

  const { data, error } = await createAdminClient().rpc("match_documents", {
    query_embedding: JSON.stringify(embedding),
    org: orgId,
    app: appId,
    match_count: limit,
    min_similarity: minSimilarity,
  });

  if (error) throw new Error(`searchDocuments failed: ${error.message}`);
  return data as { id: number; content: string; metadata: Record<string, unknown>; source_id: string | null; similarity: number }[];
}
