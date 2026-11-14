import "server-only";
import { createGoogle } from "@ai-sdk/google";

/**
 * Gemini provider for the Vercel AI SDK, using GEMINI_API_KEY from .env.local.
 * Use it with generateText / streamText / ToolLoopAgent / embed from "ai".
 */
export const google = createGoogle({
  apiKey: process.env.GEMINI_API_KEY,
});

/** Central place to swap models. All IDs were checked against the hackathon API key. */
export const MODELS = {
  /** Default: fast, cheap, supports tools, Google Search, URL context, structured output. */
  fast: "gemini-3.8-flash",
  /** Strongest reasoning. Slower and more expensive — use for hard planning steps. No `minimal` thinking. */
  smart: "gemini-4-argon",
  /** Lite: ~0.6–1 s for structured output / one tool call (tested 2026-11-14, supports thinkingLevel "minimal"). Valo decide + point tier. */
  decide: "gemini-3.5-flash-lite",
  /** Gemini Decisions API (experimental, v1beta): calibrated Boolean/Choice/Score answers, ~0.6 s. Use via `experimental_decide`. */
  decision: "gemini-decision-1",
  /** Text + multimodal embeddings. We store 768 dims (see EMBEDDING_DIMENSIONS). */
  embedding: "gemini-embedding-2",
  /** Image generation / editing ("nano banana"). */
  image: "gemini-3.1-flash-image",
} as const;

/** Must match the vector(...) size in supabase/migrations/*_rag_documents.sql. */
export const EMBEDDING_DIMENSIONS = 768;

export const fastModel = google(MODELS.fast);
export const smartModel = google(MODELS.smart);
export const embeddingModel = google.embedding(MODELS.embedding);
export const decisionModel = google.decisionModel(MODELS.decision);
