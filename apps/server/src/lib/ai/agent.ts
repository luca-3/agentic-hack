import "server-only";
import { ToolLoopAgent, isStepCount, tool, type InferAgentUIMessage } from "ai";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { addDocuments, searchDocuments } from "./embeddings";
import { fastModel, google } from "./google";

/**
 * Example agent: Gemini + Google Search + URL reading + Supabase (notes, RAG).
 * Copy this file to build your own agent — tools are the part you'll change most.
 */
export const hackAgent = new ToolLoopAgent({
  model: fastModel,
  instructions: `You are a helpful agent for a hackathon team.
Use Google Search for current facts and cite sources. Use url_context to read links the user gives you.
Use searchKnowledge before answering questions about the team's own knowledge base.
Keep answers short. Answer in the user's language.`,
  stopWhen: isStepCount(10),
  tools: {
    // Built-in Gemini tools (run on Google's side)
    google_search: google.tools.googleSearch({}),
    url_context: google.tools.urlContext({}),

    // Our own tools (run on this server)
    listNotes: tool({
      description: "List the latest notes from the database.",
      inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(10) }),
      execute: async ({ limit }) => {
        const { data, error } = await createAdminClient()
          .from("notes")
          .select("id, title, created_at")
          .order("id", { ascending: false })
          .limit(limit);
        if (error) throw new Error(error.message);
        return data;
      },
    }),
    addNote: tool({
      description: "Save a short note to the database.",
      inputSchema: z.object({ title: z.string().min(1).max(500) }),
      execute: async ({ title }) => {
        const { data, error } = await createAdminClient()
          .from("notes")
          .insert({ title, user_id: null })
          .select("id, title")
          .single();
        if (error) throw new Error(error.message);
        return data;
      },
    }),
    saveKnowledge: tool({
      description: "Store a piece of text in the knowledge base (vector store) so it can be found later.",
      inputSchema: z.object({ content: z.string().min(1), source: z.string().optional() }),
      execute: async ({ content, source }) => {
        const [id] = await addDocuments([{ content, metadata: source ? { source } : {} }]);
        return { id };
      },
    }),
    searchKnowledge: tool({
      description: "Semantic search in the team knowledge base (vector store).",
      inputSchema: z.object({ query: z.string().min(1) }),
      execute: async ({ query }) => searchDocuments(query, { limit: 5 }),
    }),
  },
});

export type HackAgentUIMessage = InferAgentUIMessage<typeof hackAgent>;
