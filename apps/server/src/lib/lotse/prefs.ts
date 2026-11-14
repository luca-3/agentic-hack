import "server-only";
import { PROACTIVE_THRESHOLD, type OfferFeedbackRequest, type ProactivePrefs } from "@lotse/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { GuardError } from "./guard";

/**
 * Adaptive proactive threshold per subject (D-22). Subject = caller.key ("u:<user id>" or "s:<session id>").
 * Tables: lotse_user_prefs, lotse_offers, lotse_offer_feedback (service role only).
 */

const round2 = (n: number) => Math.round(n * 100) / 100;
export const clampThreshold = (n: number) => round2(Math.min(PROACTIVE_THRESHOLD.max, Math.max(PROACTIVE_THRESHOLD.min, n)));

const DELTA: Record<OfferFeedbackRequest["feedback"], number> = {
  up: PROACTIVE_THRESHOLD.onThumbsUp,
  down: PROACTIVE_THRESHOLD.onThumbsDown,
  declined: PROACTIVE_THRESHOLD.onDeclined,
};

/** Never throws: falls back to the initial threshold if the DB is unavailable. */
export async function getThreshold(subjectId: string): Promise<number> {
  try {
    const { data, error } = await createAdminClient()
      .from("lotse_user_prefs")
      .select("proactive_threshold")
      .eq("subject_id", subjectId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    return data ? clampThreshold(Number(data.proactive_threshold)) : PROACTIVE_THRESHOLD.initial;
  } catch (e) {
    console.warn("[lotse] prefs read failed:", (e as Error).message);
    return PROACTIVE_THRESHOLD.initial;
  }
}

export async function setThreshold(subjectId: string, value: number): Promise<ProactivePrefs> {
  const proactiveThreshold = clampThreshold(value);
  const { error } = await createAdminClient()
    .from("lotse_user_prefs")
    .upsert({ subject_id: subjectId, proactive_threshold: proactiveThreshold, updated_at: new Date().toISOString() });
  if (error) throw new Error(`prefs write failed: ${error.message}`);
  return { proactiveThreshold };
}

/** Stores the offer; returns its id, or undefined if storing failed (the offer is still shown, just without feedback). */
export async function createOffer(o: {
  subjectId: string;
  appId: string;
  intent?: string;
  confidence: number;
  threshold: number;
}): Promise<string | undefined> {
  const offerId = crypto.randomUUID();
  try {
    const { error } = await createAdminClient().from("lotse_offers").insert({
      offer_id: offerId,
      subject_id: o.subjectId,
      app_id: o.appId,
      intent: o.intent ?? null,
      confidence: o.confidence,
      threshold: o.threshold,
    });
    if (error) throw new Error(error.message);
    return offerId;
  } catch (e) {
    console.warn("[lotse] offer insert failed:", (e as Error).message);
    return undefined;
  }
}

/** Applies feedback once per offer (idempotent). Unknown offer or other subject's offer → 404. */
export async function applyFeedback(subjectId: string, req: OfferFeedbackRequest): Promise<ProactivePrefs> {
  const db = createAdminClient();
  const { data: offer, error } = await db
    .from("lotse_offers")
    .select("offer_id, subject_id")
    .eq("offer_id", req.offerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!offer || offer.subject_id !== subjectId) throw new GuardError("bad_request", "Unknown offerId.", 404);

  const before = await getThreshold(subjectId);
  const after = clampThreshold(before + DELTA[req.feedback]);
  const { error: fbError } = await db.from("lotse_offer_feedback").insert({
    offer_id: req.offerId,
    subject_id: subjectId,
    feedback: req.feedback,
    threshold_before: before,
    threshold_after: after,
  });
  if (fbError) {
    if (fbError.code === "23505") return { proactiveThreshold: before }; // already rated → counts once
    throw new Error(fbError.message);
  }
  return setThreshold(subjectId, after);
}
