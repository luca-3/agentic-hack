import { generateText, Output } from "ai";
import { z } from "zod";
import { AskRequestSchema, AskResponseSchema } from "@lotse/shared";
import { fastModel } from "@/lib/ai/google";
import { corsHeaders, preflight } from "@/lib/cors";

export const OPTIONS = preflight;

/**
 * POST /api/lotse/ask — walking-skeleton endpoint: question + page snapshot → element to highlight.
 * Contract: AskRequest / AskResponse in @lotse/shared. Later: role filter, feature list, decision API.
 */
export async function POST(request: Request) {
  const headers = corsHeaders(request.headers.get("origin"));
  const parsed = AskRequestSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: z.prettifyError(parsed.error) }, { status: 400, headers });
  }
  const { question, snapshot, role } = parsed.data;

  const elements = snapshot.elements.map((e) => `${e.number}: [${e.role}] ${e.label}`).join("\n");
  const { output } = await generateText({
    model: fastModel,
    output: Output.object({ schema: AskResponseSchema }),
    system:
      "Du bist Lotse, ein Assistent für Business-Web-Apps. Wähle genau EIN Element aus der Liste, auf das der Nutzer als Nächstes klicken soll, " +
      "und erkläre es in einem einfachen Satz in der Sprache der Frage. Nutze nur Nummern aus der Liste. " +
      "Wenn nichts auf dieser Seite passt, gib elementNumber null zurück und sage, wo es weitergehen könnte.",
    prompt: `Frage: ${question}\nRolle: ${role ?? "unbekannt"}\nSeite: ${snapshot.title} (${snapshot.url})\nElemente:\n${elements}`,
  });

  // Never return an element number the page doesn't have.
  const known = output.elementNumber === null || snapshot.elements.some((e) => e.number === output.elementNumber);
  return Response.json(known ? output : { elementNumber: null, sentence: output.sentence }, { headers });
}
