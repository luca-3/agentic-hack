import { after } from "next/server";
import { z } from "zod";
import { EventBatchSchema, LOTSE_HEADERS } from "@lotse/shared";
import { corsHeaders, preflight } from "@/lib/cors";
import { errorJson, guard, GuardError, readJson } from "@/lib/lotse/guard";
import { storeEvents } from "@/lib/lotse/usage";

export const OPTIONS = preflight;

/** POST /api/lotse/events — EventBatch (≤ 100 events) → 202 immediately; insert into lotse_events after the response. */
export async function POST(request: Request) {
  const cors = corsHeaders(request.headers.get("origin"));
  try {
    const caller = await guard(request, "events");
    const parsed = EventBatchSchema.safeParse(await readJson(request));
    if (!parsed.success) throw new GuardError("bad_request", z.prettifyError(parsed.error), 400);
    const appId = (parsed.data.appId ?? request.headers.get(LOTSE_HEADERS.app) ?? undefined)?.slice(0, 200);
    const events = parsed.data.events;
    if (events.length > 0) after(() => storeEvents(events, caller, appId));
    return Response.json({ accepted: events.length }, { status: 202, headers: cors });
  } catch (e) {
    return errorJson(e, cors);
  }
}
