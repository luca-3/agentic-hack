import { createAgentUIStreamResponse } from "ai";
import { hackAgent } from "@/lib/ai/agent";

export const maxDuration = 300;

export async function POST(request: Request) {
  const { messages } = await request.json();

  return createAgentUIStreamResponse({
    agent: hackAgent,
    uiMessages: messages,
    abortSignal: request.signal,
    sendSources: true,
  });
}
