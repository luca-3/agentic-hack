import { z } from "zod";
import { ProactivePrefsSchema } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { errorJson, guard, GuardError, readJson } from "@/lib/lotse/guard";
import { getThreshold, setThreshold } from "@/lib/lotse/prefs";

export const OPTIONS = preflight;

/** GET /api/lotse/prefs → ProactivePrefs of the caller (user id, else x-lotse-session). */
export async function GET(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const caller = await guard(request, "prefs");
    return Response.json({ proactiveThreshold: await getThreshold(caller.key) }, { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (e) {
    return errorJson(e, cors);
  }
}

/** PUT /api/lotse/prefs { proactiveThreshold } → manual override, clamped to PROACTIVE_THRESHOLD.min/max. */
export async function PUT(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const caller = await guard(request, "prefs");
    const parsed = ProactivePrefsSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new GuardError("bad_request", z.prettifyError(parsed.error), 400);
    return Response.json(await setThreshold(caller.key, parsed.data.proactiveThreshold), { headers: { ...cors, "Cache-Control": "no-store" } });
  } catch (e) {
    return errorJson(e, cors);
  }
}
