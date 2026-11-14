import "server-only";
import { embed, embedMany } from "ai";
import type { GoogleEmbeddingModelOptions } from "@ai-sdk/google";
import { createAdminClient } from "@/lib/supabase/admin";
import { EMBEDDING_DIMENSIONS, embeddingModel } from "./google";

type TaskType = "RETRIEVAL_DOCUMENT" | "RETRIEVAL_QUERY";

const options = (taskType: TaskType) => ({
  google: { outputDimensionality: EMBEDDING_DIMENSIONS, taskType } satisfies GoogleEmbeddingModelOptions,
});

/** Embed texts and store them in public.documents. */
export async function addDocuments(docs: { content: string; metadata?: Record<string, unknown> }[]) {
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
      })),
    )
    .select("id");

  if (error) throw new Error(`addDocuments failed: ${error.message}`);
  return data.map((row) => row.id as number);
}

/** Semantic search over public.documents. */
export async function searchDocuments(query: string, { limit = 5, minSimilarity = 0.5 } = {}) {
  const { embedding } = await embed({
    model: embeddingModel,
    value: query,
    providerOptions: options("RETRIEVAL_QUERY"),
  });

  const { data, error } = await createAdminClient().rpc("match_documents", {
    query_embedding: JSON.stringify(embedding),
    match_count: limit,
    min_similarity: minSimilarity,
  });

  if (error) throw new Error(`searchDocuments failed: ${error.message}`);
  return data as { id: number; content: string; metadata: Record<string, unknown>; similarity: number }[];
}
