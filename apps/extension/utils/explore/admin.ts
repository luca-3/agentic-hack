/**
 * Is the signed-in user an org admin of the app's org? Only admins may start an exploration (D-25).
 * `GET /api/lotse/policy` reports membership and job role but no admin flag, so this reads the caller's own
 * `org_members` rows through Supabase REST with the user's token (RLS: members read members) — read-only, no secret.
 * The server checks `is_org_admin` again on POST /api/lotse/explore; this is only the side panel's gate.
 * Follow-up: an `admin` field in PolicyResponse would make this call unnecessary.
 */
import { AuthConfigResponseSchema, LOTSE_DEFAULTS, type AuthConfigResponse } from "@lotse/shared";
import * as auth from "../auth";

const TTL_MS = 60_000;
let config: AuthConfigResponse | null = null;
const cache = new Map<string, { admin: boolean | null; until: number }>();

/** true / false, or null when it could not be checked (server or Supabase unreachable). */
export async function isOrgAdmin(orgName: string): Promise<boolean | null> {
  const user = await auth.currentUser().catch(() => null);
  if (!user) return false;
  const key = `${user.userId}|${orgName}`;
  const hit = cache.get(key);
  if (hit && hit.until > Date.now()) return hit.admin;
  const admin = await lookup(user.userId, orgName).catch(() => null);
  cache.set(key, { admin, until: Date.now() + (admin === null ? 5_000 : TTL_MS) });
  return admin;
}

export function clearAdminCache() {
  cache.clear();
}

async function lookup(userId: string, orgName: string): Promise<boolean> {
  const token = await auth.accessToken();
  if (!token) return false;
  config ??= AuthConfigResponseSchema.parse(
    await (await fetch(`${LOTSE_DEFAULTS.serverUrl}/api/lotse/auth-config`, { signal: AbortSignal.timeout(6_000) })).json(),
  );
  const url = `${config.supabaseUrl.replace(/\/$/, "")}/rest/v1/org_members?select=is_admin,orgs(name)&user_id=eq.${encodeURIComponent(userId)}`;
  const response = await fetch(url, {
    headers: { apikey: config.publishableKey, Authorization: `Bearer ${token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(6_000),
  });
  if (!response.ok) throw new Error(`org_members ${response.status}`);
  const rows = (await response.json()) as Array<{ is_admin?: unknown; orgs?: { name?: unknown } | null }>;
  return Array.isArray(rows) && rows.some((row) => row.is_admin === true && row.orgs?.name === orgName);
}
