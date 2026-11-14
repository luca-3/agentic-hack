import { z } from "zod";
import { OfferFeedbackRequestSchema } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { errorJson, guard, GuardError, readJson } from "@/lib/lotse/guard";
import { noteOfferFeedback } from "@/lib/lotse/memory";
import { applyFeedback } from "@/lib/lotse/prefs";

export const OPTIONS = preflight;

/** POST /api/lotse/feedback — { offerId, feedback: up|down|declined } → ProactivePrefs. Counts once per offer; unknown offer → 404. */
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const caller = await guard(request, "prefs");
    const parsed = OfferFeedbackRequestSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new GuardError("bad_request", z.prettifyError(parsed.error), 400);
    const prefs = await applyFeedback(caller.key, parsed.data);
    void noteOfferFeedback(caller.key, parsed.data); // 👎 → negative evidence for agent memory on that intent (D-28)
    return Response.json(prefs, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (e) {
    return errorJson(e, cors);
  }
}
