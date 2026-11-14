import "server-only";
import { createClient } from "@supabase/supabase-js";
import { LOTSE_HEADERS, type PageSnapshot } from "@lotse/shared";
import { LIMITS, type BodyKind, type GuardKind } from "./config";

/**
 * Runtime guard for /api/lotse/*: auth → kill switch → rate limit → (LLM routes) token budget, plus input caps.
 * State is in-memory per server process — fine for the hackathon (one instance); swap for Redis/DB when scaling out.
 */

export { LIMITS, type BodyKind, type GuardKind };
export type ErrorCode = "bad_request" | "unauthorized" | "rate_limited" | "budget_exceeded" | "timeout" | "disabled" | "internal";

export interface Caller {
  /** Key for limits/budgets: user id when authenticated, else the pseudonymous session id. */
  key: string;
  sessionId: string | null;
  userId: string | null;
}

export class GuardError extends Error {
  constructor(
    public code: ErrorCode,
    message: string,
    public status: number,
    public retryAfterSec?: number,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export function devAuthAllowed() {
  return process.env.NODE_ENV !== "production" || process.env.LOTSE_DEV_AUTH === "1";
}

let authClient: ReturnType<typeof createClient> | null = null;
function getAuthClient() {
  authClient ??= createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return authClient;
}

/** `Authorization: Bearer <Supabase access token>` → verified user id. Dev: anonymous allowed (identity = x-lotse-session). */
export async function authenticate(request: Request): Promise<Caller> {
  const sessionId = request.headers.get(LOTSE_HEADERS.session)?.slice(0, 100) || null;
  const auth = request.headers.get("authorization");
  const token = auth?.match(/^Bearer\s+(.+)$/i)?.[1];

  if (token) {
    const { data, error } = await getAuthClient().auth.getClaims(token);
    const sub = data?.claims?.sub;
    if (error || !sub) throw new GuardError("unauthorized", "Invalid or expired token.", 401);
    return { key: `u:${sub}`, sessionId, userId: sub };
  }
  if (!devAuthAllowed()) throw new GuardError("unauthorized", "Missing Authorization: Bearer <token>.", 401);
  const fallback = sessionId ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "anonymous";
  return { key: `s:${fallback}`, sessionId, userId: null };
}

// ---------------------------------------------------------------------------
// Rate limit (sliding window) + daily token budget
// ---------------------------------------------------------------------------

const WINDOW_MS = 60_000;
const hits = new Map<string, number[]>();

function slidingWindow(key: string, limit: number, now: number): number | null {
  const list = (hits.get(key) ?? []).filter((t) => now - t < WINDOW_MS);
  if (list.length >= limit) {
    hits.set(key, list);
    return Math.max(1, Math.ceil((list[0] + WINDOW_MS - now) / 1000));
  }
  list.push(now);
  hits.set(key, list);
  return null;
}

function sweep(now: number) {
  if (hits.size < 5_000) return;
  for (const [k, list] of hits) if (!list.some((t) => now - t < WINDOW_MS)) hits.delete(k);
}

export function rateLimit(kind: GuardKind, caller: Caller) {
  const now = Date.now();
  sweep(now);
  const retry =
    slidingWindow(`${kind}:${caller.key}`, LIMITS.perMinute[kind], now) ??
    slidingWindow(`global:${kind}`, LIMITS.globalPerMinute[kind], now);
  if (retry !== null) throw new GuardError("rate_limited", "Zu viele Anfragen — bitte kurz warten.", 429, retry);
}

const budgets = new Map<string, { day: string; tokens: number }>();
const today = () => new Date().toISOString().slice(0, 10);

export function checkBudget(caller: Caller) {
  const b = budgets.get(caller.key);
  if (b && b.day === today() && b.tokens >= LIMITS.dailyTokens) {
    throw new GuardError("budget_exceeded", "Tageslimit für Valo erreicht.", 429);
  }
}

export function chargeBudget(caller: Caller, tokens: number | undefined) {
  if (!tokens) return;
  const d = today();
  const b = budgets.get(caller.key);
  budgets.set(caller.key, { day: d, tokens: (b?.day === d ? b.tokens : 0) + tokens });
}

// ---------------------------------------------------------------------------
// Entry point for routes
// ---------------------------------------------------------------------------

const LLM_KINDS = new Set<GuardKind>(["ask", "state", "intent", "decide"]);

/** Kill switch + auth + rate limit (+ budget for LLM routes). Throws GuardError. */
export async function guard(request: Request, kind: GuardKind): Promise<Caller> {
  if (process.env.LOTSE_DISABLED === "1") throw new GuardError("disabled", "Valo ist gerade deaktiviert.", 503);
  const caller = await authenticate(request);
  rateLimit(kind, caller);
  if (LLM_KINDS.has(kind)) checkBudget(caller);
  return caller;
}

function tooLarge(max: number) {
  return new GuardError("bad_request", `Request body too large (max ${Math.round(max / 1024)} KB for this endpoint).`, 413);
}

/** Reads a JSON body with the route's size cap (LIMITS.maxBodyBytes[kind]); stops reading once over it. Throws GuardError. */
export async function readJson(request: Request, kind: BodyKind = "default"): Promise<unknown> {
  const max = LIMITS.maxBodyBytes[kind];
  const len = Number(request.headers.get("content-length") ?? 0);
  if (len > max) throw tooLarge(max);
  const chunks: Uint8Array[] = [];
  let total = 0;
  const reader = request.body?.getReader();
  if (reader) {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > max) {
        await reader.cancel().catch(() => undefined);
        throw tooLarge(max);
      }
      chunks.push(value);
    }
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new GuardError("bad_request", "Body must be JSON.", 400);
  }
}

export function errorJson(e: unknown, headers: Record<string, string>) {
  const g = toGuardError(e);
  const h: Record<string, string> = { ...headers };
  if (g.retryAfterSec) h["Retry-After"] = String(g.retryAfterSec);
  return Response.json({ error: { code: g.code, message: g.message } }, { status: g.status, headers: h });
}

export function toGuardError(e: unknown): GuardError {
  if (e instanceof GuardError) return e;
  console.error("[lotse] internal error:", e instanceof Error ? e.message : e);
  return new GuardError("internal", "Interner Fehler.", 500);
}

// ---------------------------------------------------------------------------
// Input caps: untrusted page data → trimmed, bounded, no control chars, no fake delimiters
// ---------------------------------------------------------------------------

export function cleanText(s: string, max: number): string {
  return s
    .replace(/[\u0000-\u001f\u007f]+/g, " ")
    .replace(/[<>]/g, (c) => (c === "<" ? "‹" : "›"))
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function capSnapshot(s: PageSnapshot): PageSnapshot {
  const seen = new Set<number>();
  const elements = [];
  for (const e of s.elements) {
    if (seen.has(e.number)) continue;
    seen.add(e.number);
    elements.push({ ...e, role: cleanText(e.role, 30), label: cleanText(e.label, LIMITS.labelChars), route: e.route.slice(0, 300) });
    if (elements.length >= LIMITS.maxElements) break;
  }
  return { ...s, url: s.url.slice(0, 500), title: cleanText(s.title, 120), elements };
}
