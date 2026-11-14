import "server-only";
import type { SuggestionKind } from "@lotse/shared";
import { createAdminClient } from "@/lib/supabase/admin";

export interface SuggestionInput {
  appId: string | null; // dashboard apps.id
  source: "explore" | "learn";
  kind: SuggestionKind;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  fingerprint: string;
  persons?: number;
  /** Absolute count (learn detectors). Absent → existing occurrences + 1. */
  occurrences?: number;
  /** Optional initial/explicit status (e.g. 'accepted' when auto-applied during exploration). */
  status?: "open" | "accepted" | "dismissed";
}

/**
 * Upsert into lotse_suggestions on (org_id, fingerprint). Status is never written, so new rows start 'open'
 * and an admin's accepted/dismissed survives re-runs. Returns the number of rows written.
 */
export async function upsertSuggestions(orgId: string, items: SuggestionInput[]): Promise<number> {
  const byFp = new Map(items.map((i) => [i.fingerprint.slice(0, 500), i]));
  if (byFp.size === 0) return 0;
  const db = createAdminClient();
  // ponytail: read-modify-write of occurrences; two concurrent runs can lose one increment. Use an rpc if that matters.
  const { data: existing, error: readErr } = await db
    .from("lotse_suggestions")
    .select("fingerprint, occurrences")
    .eq("org_id", orgId)
    .in("fingerprint", [...byFp.keys()]);
  if (readErr) throw new Error(`lotse_suggestions read failed: ${readErr.message}`);
  const prev = new Map<string, number>((existing ?? []).map((r) => [r.fingerprint as string, r.occurrences as number]));

  const now = new Date().toISOString();
  const rows = [...byFp].map(([fingerprint, i]) => ({
    org_id: orgId,
    app_id: i.appId,
    source: i.source,
    kind: i.kind,
    title: i.title.slice(0, 300),
    detail: i.detail.slice(0, 2000),
    payload: i.payload,
    fingerprint,
    persons: i.persons ?? 0,
    occurrences: i.occurrences ?? (prev.get(fingerprint) ?? 0) + 1,
    ...(i.status ? { status: i.status } : {}),
    updated_at: now,
  }));
  const { error } = await db.from("lotse_suggestions").upsert(rows, { onConflict: "org_id,fingerprint" });
  if (error) throw new Error(`lotse_suggestions upsert failed: ${error.message}`);
  return rows.length;
}
