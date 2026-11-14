import { AuthConfigResponseSchema, LOTSE_DEFAULTS, type AuthConfigResponse } from "@lotse/shared";

/**
 * Extension login (D-05): Supabase email/password via the Auth REST API — no SDK, no app cookies.
 * The session lives in chrome.storage.session (trusted extension contexts only, cleared when the browser closes).
 * Only the service worker uses this module; tokens never reach content scripts or the page.
 */
export type AuthSession = { accessToken: string; refreshToken: string; expiresAt: number; userId: string; email: string };

const KEY = "lotse-auth";
const REFRESH_MARGIN_MS = 60_000;
let session: AuthSession | null = null;
let loaded: Promise<void> | null = null;
let refreshing: Promise<AuthSession | null> | null = null;
let config: AuthConfigResponse | null = null;

function parseSession(value: unknown): AuthSession | null {
  const s = value as Partial<AuthSession> | undefined;
  if (!s || typeof s !== "object") return null;
  const ok = [s.accessToken, s.refreshToken, s.userId, s.email].every((v) => typeof v === "string" && v.length > 0 && v.length < 8_192);
  return ok && typeof s.expiresAt === "number" ? (s as AuthSession) : null;
}

function load() {
  loaded ??= browser.storage.session.get(KEY).then((r) => { session = parseSession(r[KEY]); }, () => { session = null; });
  return loaded;
}

async function save(next: AuthSession | null) {
  session = next;
  if (next) await browser.storage.session.set({ [KEY]: next });
  else await browser.storage.session.remove(KEY);
}

async function authConfig(): Promise<AuthConfigResponse> {
  if (config) return config;
  const response = await fetch(`${LOTSE_DEFAULTS.serverUrl}/api/lotse/auth-config`, { signal: AbortSignal.timeout(8_000) })
    .catch(() => { throw new Error("Der Lotse-Server ist nicht erreichbar. Starte npm run dev:server."); });
  if (!response.ok) throw new Error("Die Anmeldung ist auf dem Lotse-Server nicht eingerichtet.");
  config = AuthConfigResponseSchema.parse(await response.json());
  return config;
}

/** POST /auth/v1/token — grant_type password or refresh_token. */
async function tokenRequest(grant: "password" | "refresh_token", body: Record<string, string>): Promise<AuthSession> {
  const { supabaseUrl, publishableKey } = await authConfig();
  const response = await fetch(`${supabaseUrl.replace(/\/$/, "")}/auth/v1/token?grant_type=${grant}`, {
    method: "POST",
    headers: { apikey: publishableKey, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  }).catch(() => { throw new Error("Die Anmeldung (Supabase) ist nicht erreichbar."); });
  const data = (await response.json().catch(() => ({}))) as {
    access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; expires_at?: unknown; user?: { id?: unknown; email?: unknown };
  };
  if (!response.ok) {
    if (grant === "password" && (response.status === 400 || response.status === 401)) throw new Error("E-Mail oder Passwort ist falsch.");
    throw new Error(grant === "refresh_token" ? "Die Anmeldung ist abgelaufen. Bitte melde dich neu an." : `Anmeldung fehlgeschlagen (${response.status}).`);
  }
  const next = parseSession({
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: typeof data.expires_at === "number" ? data.expires_at * 1_000 : Date.now() + (typeof data.expires_in === "number" ? data.expires_in : 3_600) * 1_000,
    userId: data.user?.id,
    email: data.user?.email ?? body.email ?? session?.email,
  });
  if (!next) throw new Error("Die Anmeldung hat keine gültige Sitzung geliefert.");
  return next;
}

export async function signIn(email: string, password: string): Promise<AuthSession> {
  if (!email.trim() || email.length > 200 || !password || password.length > 200) throw new Error("Bitte E-Mail und Passwort eingeben.");
  await load();
  const next = await tokenRequest("password", { email: email.trim(), password });
  await save(next);
  return next;
}

export async function signOut() {
  await load();
  const old = session;
  await save(null);
  if (!old) return;
  // Best effort: revoke the refresh token server-side; the local session is gone either way.
  const cfg = await authConfig().catch(() => null);
  if (cfg) {
    await fetch(`${cfg.supabaseUrl.replace(/\/$/, "")}/auth/v1/logout`, {
      method: "POST", headers: { apikey: cfg.publishableKey, Authorization: `Bearer ${old.accessToken}` }, signal: AbortSignal.timeout(5_000),
    }).catch(() => undefined);
  }
}

export async function currentUser(): Promise<{ email: string; userId: string } | null> {
  await load();
  return session ? { email: session.email, userId: session.userId } : null;
}

/** Refresh once (single flight). A failed refresh signs the user out locally. */
export async function refreshSession(): Promise<AuthSession | null> {
  await load();
  if (!session) return null;
  const token = session.refreshToken;
  refreshing ??= tokenRequest("refresh_token", { refresh_token: token })
    .then(async (next) => { await save(next); return next; })
    .catch(async () => { if (session?.refreshToken === token) await save(null); return null; })
    .finally(() => { refreshing = null; });
  return refreshing;
}

/** Valid access token, refreshed when it expires within a minute; null = not signed in (dev: anonymous). */
export async function accessToken(): Promise<string | null> {
  await load();
  if (!session) return null;
  if (session.expiresAt - REFRESH_MARGIN_MS > Date.now()) return session.accessToken;
  return (await refreshSession())?.accessToken ?? null;
}

/** True when the signed-in user is an admin of at least one organization (`org_members.is_admin`, D-25). */
export async function isOrgAdmin(): Promise<boolean> {
  const token = await accessToken();
  if (!token || !session) return false;
  try {
    const { supabaseUrl, publishableKey } = await authConfig();
    const response = await fetch(
      `${supabaseUrl.replace(/\/$/, "")}/rest/v1/org_members?select=is_admin&user_id=eq.${encodeURIComponent(session.userId)}&is_admin=eq.true&limit=1`,
      {
        headers: { apikey: publishableKey, Authorization: `Bearer ${token}`, Accept: "application/json" },
        signal: AbortSignal.timeout(6_000),
      },
    );
    if (!response.ok) return false;
    const rows = (await response.json().catch(() => [])) as Array<{ is_admin?: boolean }>;
    return Array.isArray(rows) && rows.some((row) => row.is_admin === true);
  } catch {
    return false;
  }
}
