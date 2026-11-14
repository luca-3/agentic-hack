import "server-only";
import { createHash } from "node:crypto";
import { PSEUDONYM_TOKEN, type OfferFeedbackRequest } from "@lotse/shared";
import { embedText } from "@/lib/ai/embeddings";
import { createAdminClient } from "@/lib/supabase/admin";
import { cleanText, GuardError } from "./guard";
import { knowledgeSource, overlap, tokenize } from "./knowledge";

/**
 * Agent memory (D-28): what Lotse learned from many people's usage over weeks/months, stored next to — but clearly
 * apart from — the curated knowledge base (`public.documents`). Tables `agent_memory` + `agent_memory_evidence`.
 *
 * Write path: proposeMemory() / reinforceMemory(). Memories start `proposed`; they become `active` only with support
 * from ≥ MEMORY_MIN_PERSONS distinct pseudonymous persons and no negative feedback (k-anonymity, D-12), or when an org
 * admin approves/writes them (adminCreateMemory / setMemoryStatus). The model has no memory tool: the server derives
 * evidence after an answer (gaps.ts → afterAsk), so page content can at most shape a *proposal*, never activate one.
 * Expiry: memories without fresh support for MEMORY_TTL_DAYS become `expired` (admin-written ones never expire).
 *
 * Read path: activeMemories() (cached 60 s per org/app) → rankMemories() → prompt block `<agent_memory>` for /ask and
 * `learned` hints for /decide, plus semantic search (searchMemory) inside the agent's searchKnowledge tool.
 */

export const MEMORY_KINDS = ["pitfall", "path_hint", "faq", "role_hint", "gap_resolution"] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];
export const MEMORY_STATUSES = ["proposed", "active", "rejected", "expired"] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];
export type MemorySource = "agent" | "learn_loop" | "admin";

/** k-anonymity threshold for auto-activation (same as the insights MIN_GROUP, D-12). */
export const MEMORY_MIN_PERSONS = 5;
const envNum = (name: string, fallback: number) => {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? v : fallback;
};
export const MEMORY_TTL_DAYS = envNum("LOTSE_MEMORY_TTL_DAYS", 60);

export interface AgentMemory {
  id: number;
  orgId: string;
  appId: string | null; // dashboard apps.id, null = org-wide
  kind: MemoryKind;
  topic: string; // neutral label, e.g. "IBAN ändern"
  feature: string | null; // app_features.name it refers to
  content: string; // short, neutral hint
  source: MemorySource;
  evidenceCount: number;
  persons: number; // distinct pseudonymous subjects with support
  negatives: number; // distinct subjects with 👎
  confidence: number;
  status: MemoryStatus;
  createdAt: string;
  updatedAt: string;
  lastSeenAt: string;
  activatedAt: string | null;
}

const COLS =
  "id, org_id, app_id, kind, topic, feature, content, source, evidence_count, persons, negatives, confidence, status, created_at, updated_at, last_seen_at, activated_at";

type Row = Record<string, unknown>;
/** RPCs returning one composite row come back as an object (or a 1-element array, depending on the client). */
const one = (data: unknown): Row | null => (Array.isArray(data) ? ((data[0] as Row) ?? null) : ((data as Row) ?? null));

const toMemory = (r: Row): AgentMemory => ({
  id: Number(r.id),
  orgId: String(r.org_id),
  appId: (r.app_id as string | null) ?? null,
  kind: r.kind as MemoryKind,
  topic: String(r.topic),
  feature: r.feature ? String(r.feature) : null,
  content: String(r.content),
  source: r.source as MemorySource,
  evidenceCount: Number(r.evidence_count ?? 0),
  persons: Number(r.persons ?? 0),
  negatives: Number(r.negatives ?? 0),
  confidence: Number(r.confidence ?? 0),
  status: r.status as MemoryStatus,
  createdAt: String(r.created_at),
  updatedAt: String(r.updated_at),
  lastSeenAt: String(r.last_seen_at),
  activatedAt: (r.activated_at as string | null) ?? null,
});

// ---------------------------------------------------------------------------
// Privacy helpers
// ---------------------------------------------------------------------------

const SALT = process.env.LOTSE_PSEUDONYM_SALT || "lotse-memory-v1";

/** Runtime subject key ("u:<user id>" / "s:<session id>") → stable hash; raw ids never reach the memory tables. */
export function subjectHash(key: string): string {
  return createHash("sha256").update(`${SALT}:${key}`).digest("hex").slice(0, 32);
}

const EMAIL = /[\w.+-]+@[\w-]+(\.[\w-]+)+/g;
const IBAN = /\b[A-Z]{2}\d{2}(?:\s?[A-Z0-9]{2,4}){3,8}\b/gi;
const LONG_NUMBER = /\+?\d[\d\s/().-]{4,}\d/g; // phone, account, customer numbers
const SALUTATION = /\b(Herr|Frau|Hr\.|Fr\.)\s+\p{Lu}[\p{L}-]+/gu;

/** Removes placeholders ([Kunde-1] …), e-mails, IBANs, long numbers and "Herr/Frau <Name>" from free text. */
export function stripPersonal(text: string): string {
  return text
    .replace(new RegExp(PSEUDONYM_TOKEN.source, "g"), " ")
    .replace(EMAIL, " ")
    .replace(IBAN, " ")
    .replace(LONG_NUMBER, " ")
    .replace(SALUTATION, " ");
}

/** Neutral topic label: no personal data, no digits/quotes/brackets, ≤ 6 words, ≤ 60 chars. "" = nothing neutral left. */
export function neutralTopic(raw: string): string {
  const words = stripPersonal(cleanText(raw, 200))
    .replace(/[\d"'„“”‚‘’«»‹›()[\]{}<>|*_#`~^=\\/:;!?.,]/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 6);
  return words.join(" ").slice(0, 60).trim();
}

/** Neutral hint text: personal data stripped, single line, ≤ max chars. */
export function neutralContent(raw: string, max = 300): string {
  return cleanText(stripPersonal(raw), max).replace(/\s+([.,;:!?])/g, "$1");
}

// ---------------------------------------------------------------------------
// Write path
// ---------------------------------------------------------------------------

export interface ProposeInput {
  orgId: string;
  appId?: string | null; // dashboard apps.id (uuid), null = org-wide
  kind: MemoryKind;
  topic: string;
  content: string;
  feature?: string | null;
  /** "agent" = derived by the runtime after an answer; "learn_loop" = the learn run (lib/lotse/learn.ts). */
  source: "agent" | "learn_loop";
  /** Raw subject keys ("u:…" / "s:…") behind this observation — hashed here. Each distinct one counts once. */
  subjects?: string[];
}

const cache = new Map<string, { until: number; value: AgentMemory[] }>();
const CACHE_MS = 60_000;
const invalidate = (orgId: string) => {
  for (const k of cache.keys()) if (k.startsWith(`${orgId}|`)) cache.delete(k);
};

/** activated_at within the last few seconds = the call that returned it activated it. */
const justActivated = (m: AgentMemory) => m.status === "active" && !!m.activatedAt && Date.now() - Date.parse(m.activatedAt) < 5_000;

/** After a write: drop the read cache; a memory that just turned active gets embedded in the background. */
function afterWrite(m: AgentMemory | null, activated: boolean) {
  if (!m) return;
  invalidate(m.orgId);
  if (activated) void embedMemory(m);
}

async function embedMemory(m: Pick<AgentMemory, "id" | "topic" | "feature" | "content">) {
  try {
    const text = `${m.topic}${m.feature ? ` (${m.feature})` : ""}: ${m.content}`;
    const embedding = await embedText(text, "RETRIEVAL_DOCUMENT");
    const { error } = await createAdminClient().from("agent_memory").update({ embedding: JSON.stringify(embedding) }).eq("id", m.id);
    if (error) throw new Error(error.message);
  } catch (e) {
    console.warn("[lotse] memory embedding failed:", (e as Error).message);
  }
}

/**
 * Propose (or touch) a memory and record supporting evidence. Same (org, app, kind, topic, feature) = same memory.
 * Never activates by itself: activation happens in SQL only when persons ≥ MEMORY_MIN_PERSONS and negatives = 0.
 * Returns null when the input has nothing neutral left or the DB is unavailable (logged, never throws).
 */
export async function proposeMemory(input: ProposeInput): Promise<AgentMemory | null> {
  const topic = neutralTopic(input.topic);
  const content = neutralContent(input.content);
  if (!topic || !content || !MEMORY_KINDS.includes(input.kind)) return null;
  try {
    const { data, error } = await createAdminClient().rpc("propose_agent_memory", {
      org: input.orgId,
      app: input.appId ?? null,
      kind: input.kind,
      topic,
      content,
      feature: input.feature ? cleanText(input.feature, 120) : "",
      source: input.source,
      subjects: [...new Set((input.subjects ?? []).filter(Boolean).map(subjectHash))],
      min_persons: MEMORY_MIN_PERSONS,
    });
    if (error) throw new Error(error.message);
    const row = one(data);
    if (!row) return null;
    const m = toMemory(row);
    afterWrite(m, justActivated(m));
    return m;
  } catch (e) {
    console.warn("[lotse] proposeMemory failed:", (e as Error).message);
    return null;
  }
}

/** Adds evidence to an existing memory: "support" (counts towards activation) or "negative" (👎; blocks/demotes). */
export async function reinforceMemory(id: number, subjects: string[], polarity: "support" | "negative" = "support") {
  try {
    const { data, error } = await createAdminClient().rpc("record_agent_memory_evidence", {
      memory: id,
      subjects: [...new Set(subjects.filter(Boolean).map(subjectHash))],
      polarity,
      min_persons: MEMORY_MIN_PERSONS,
    });
    if (error) throw new Error(error.message);
    const row = one(data);
    if (!row?.id) return null;
    const m = toMemory(row);
    afterWrite(m, justActivated(m));
    return m;
  } catch (e) {
    console.warn("[lotse] reinforceMemory failed:", (e as Error).message);
    return null;
  }
}

/** Admin-written memory (dashboard): active immediately. Callers MUST have checked is_org_admin. Throws on DB errors. */
export async function adminCreateMemory(input: {
  orgId: string;
  appId?: string | null;
  kind: MemoryKind;
  topic: string;
  content: string;
  feature?: string | null;
  userId?: string | null;
}): Promise<AgentMemory> {
  const topic = neutralTopic(input.topic);
  const content = neutralContent(input.content, 400);
  if (!topic || !content) {
    throw new GuardError("bad_request", "Thema und Inhalt dürfen nicht leer sein und keine personenbezogenen Daten enthalten.", 400);
  }
  const db = createAdminClient();
  const { data, error } = await db.rpc("propose_agent_memory", {
    org: input.orgId,
    app: input.appId ?? null,
    kind: input.kind,
    topic,
    content,
    feature: input.feature ? cleanText(input.feature, 120) : "",
    source: "admin",
    subjects: [],
    min_persons: MEMORY_MIN_PERSONS,
  });
  if (error) throw new Error(`memory create failed: ${error.message}`);
  const row = one(data);
  if (!row) throw new Error("memory create failed: no row");
  const m = toMemory(row);
  if (input.userId) await db.from("agent_memory").update({ reviewed_by: input.userId }).eq("id", m.id);
  afterWrite(m, true);
  return m;
}

/** Admin review: approve (active), reject or expire. Scoped to the admin's org. Returns null if not found. */
export async function setMemoryStatus(
  orgId: string,
  id: number,
  status: "active" | "rejected" | "expired",
  userId?: string | null,
): Promise<AgentMemory | null> {
  const now = new Date().toISOString();
  const patch: Row = { status, updated_at: now, reviewed_by: userId ?? null };
  if (status === "active") Object.assign(patch, { activated_at: now, last_seen_at: now });
  const { data, error } = await createAdminClient()
    .from("agent_memory")
    .update(patch)
    .eq("org_id", orgId)
    .eq("id", id)
    .select(COLS)
    .maybeSingle();
  if (error) throw new Error(`memory update failed: ${error.message}`);
  if (!data) return null;
  const m = toMemory(data as Row);
  afterWrite(m, status === "active");
  return m;
}

/** Marks memories without fresh support for MEMORY_TTL_DAYS as expired (not admin-written ones). Returns the count. */
export async function expireStaleMemories(orgId?: string): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - MEMORY_TTL_DAYS * 86_400_000).toISOString();
    let q = createAdminClient()
      .from("agent_memory")
      .update({ status: "expired", updated_at: new Date().toISOString() })
      .in("status", ["proposed", "active"])
      .neq("source", "admin")
      .lt("last_seen_at", cutoff);
    if (orgId) q = q.eq("org_id", orgId);
    const { data, error } = await q.select("id, org_id");
    if (error) throw new Error(error.message);
    for (const r of data ?? []) invalidate(String(r.org_id));
    return data?.length ?? 0;
  } catch (e) {
    console.warn("[lotse] memory expiry failed:", (e as Error).message);
    return 0;
  }
}

/** 👎 on a proactive offer = negative evidence for memories about that offer's intent (feature name). Never throws. */
export async function noteOfferFeedback(subjectKey: string, req: OfferFeedbackRequest) {
  if (req.feedback !== "down") return;
  try {
    const db = createAdminClient();
    const { data: offer } = await db.from("lotse_offers").select("app_id, intent").eq("offer_id", req.offerId).maybeSingle();
    const intent = String(offer?.intent ?? "").trim();
    if (!offer?.app_id || !intent) return;
    const app = await knowledgeSource().getApp(String(offer.app_id));
    if (!app.orgId) return;
    let q = db
      .from("agent_memory")
      .select("id")
      .eq("org_id", app.orgId)
      .in("status", ["proposed", "active"])
      .or(`feature.eq.${JSON.stringify(intent)},topic_key.eq.${JSON.stringify(intent.toLowerCase())}`);
    q = app.dashboardAppId ? q.or(`app_id.is.null,app_id.eq.${app.dashboardAppId}`) : q.is("app_id", null);
    const { data: rows, error } = await q.limit(20);
    if (error) throw new Error(error.message);
    for (const r of rows ?? []) await reinforceMemory(Number(r.id), [subjectKey], "negative");
  } catch (e) {
    console.warn("[lotse] memory feedback failed:", (e as Error).message);
  }
}

// ---------------------------------------------------------------------------
// Read path
// ---------------------------------------------------------------------------

/** Memories of one org (optionally one app incl. org-wide ones) for the dashboard / learn loop. Throws on DB errors. */
export async function listMemories(orgId: string, opts: { appId?: string | null; status?: MemoryStatus; limit?: number } = {}) {
  let q = createAdminClient().from("agent_memory").select(COLS).eq("org_id", orgId);
  if (opts.appId) q = q.or(`app_id.is.null,app_id.eq.${opts.appId}`);
  if (opts.status) q = q.eq("status", opts.status);
  const { data, error } = await q
    .order("persons", { ascending: false })
    .order("updated_at", { ascending: false })
    .limit(opts.limit ?? 200);
  if (error) throw new Error(`memory read failed: ${error.message}`);
  return (data ?? []).map((r) => toMemory(r as Row));
}

/** Active, not-stale memories for the runtime (cached 60 s). No org → none. Never throws. */
export async function activeMemories(orgId: string | null | undefined, appId: string | null | undefined): Promise<AgentMemory[]> {
  if (!orgId) return [];
  const key = `${orgId}|${appId ?? ""}`;
  const hit = cache.get(key);
  if (hit && Date.now() < hit.until) return hit.value;
  let value: AgentMemory[] = [];
  let ttl = CACHE_MS;
  try {
    const cutoff = Date.now() - MEMORY_TTL_DAYS * 86_400_000;
    value = (await listMemories(orgId, { appId, status: "active", limit: 200 })).filter(
      (m) => m.source === "admin" || Date.parse(m.lastSeenAt) >= cutoff,
    );
  } catch (e) {
    console.warn("[lotse] active memories unavailable:", (e as Error).message);
    ttl = 15_000;
  }
  cache.set(key, { until: Date.now() + ttl, value });
  return value;
}

/** Prompt-facing view of a memory (no ids, no timestamps). */
export interface MemoryHint {
  kind: MemoryKind;
  topic: string;
  feature?: string;
  content: string;
  persons: number;
  admin: boolean;
}

const KIND_WEIGHT: Record<MemoryKind, number> = { gap_resolution: 1.3, pitfall: 1.2, role_hint: 1.1, path_hint: 1, faq: 0.9 };

const toHint = (m: AgentMemory): MemoryHint => ({
  kind: m.kind,
  topic: m.topic,
  ...(m.feature ? { feature: m.feature } : {}),
  content: m.content,
  persons: m.persons,
  admin: m.source === "admin",
});

/**
 * Picks the memories relevant to `text` (question, inferred goal …): lexical overlap with topic/feature/content,
 * weighted by kind; ties by persons. Nothing relevant → the `fallback` most-supported ones (default none). No LLM.
 * role_hint memories (topic starts with the role) are only used for that role.
 */
export function rankMemories(
  memories: AgentMemory[],
  text: string,
  opts: { limit?: number; fallback?: number; role?: string } = {},
): MemoryHint[] {
  const limit = opts.limit ?? 6;
  const q = tokenize(text);
  const role = opts.role?.toLowerCase();
  const scored = memories
    .filter((m) => m.kind !== "role_hint" || !role || m.topic.toLowerCase().startsWith(role))
    .map((m) => ({
      m,
      score: (overlap(q, m.topic) * 1.5 + overlap(q, m.feature ?? "") + overlap(q, m.content) * 0.5) * KIND_WEIGHT[m.kind],
    }));
  const relevant = scored.filter((s) => s.score > 0).sort((a, b) => b.score - a.score || b.m.persons - a.m.persons);
  const picked = relevant.length ? relevant.slice(0, limit) : scored.sort((a, b) => b.m.persons - a.m.persons).slice(0, opts.fallback ?? 0);
  return picked.map(({ m }) => toHint(m));
}

/** One line per hint for prompts / the Decisions API state. */
export function memoryLines(hints: MemoryHint[]): string[] {
  return hints.map(
    (h) =>
      `[${h.kind}] ${cleanText(h.topic, 60)}${h.feature ? ` → ${cleanText(h.feature, 80)}` : ""}: ${cleanText(h.content, 300)}` +
      (h.admin ? " (vom Admin bestätigt)" : ` (${h.persons} Personen)`),
  );
}

/** Semantic search over active memories (embedding reused from the knowledge search when given). Never throws. */
export async function searchMemory(
  query: string,
  { orgId, appId = null, limit = 3, embedding }: { orgId: string; appId?: string | null; limit?: number; embedding?: number[] },
): Promise<MemoryHint[]> {
  try {
    const vector = embedding ?? (await embedText(query, "RETRIEVAL_QUERY"));
    const { data, error } = await createAdminClient().rpc("match_agent_memory", {
      query_embedding: JSON.stringify(vector),
      org: orgId,
      app: appId,
      match_count: limit,
      min_similarity: 0.55,
    });
    if (error) throw new Error(error.message);
    return ((data ?? []) as Row[]).map((r) => ({
      kind: r.kind as MemoryKind,
      topic: String(r.topic),
      ...(r.feature ? { feature: String(r.feature) } : {}),
      content: String(r.content),
      persons: Number(r.persons ?? 0),
      admin: false,
    }));
  } catch (e) {
    console.warn("[lotse] memory search failed:", (e as Error).message);
    return [];
  }
}
