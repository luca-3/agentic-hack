import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Insights pipeline, step 1: usage data → aggregates per app feature and role (R-INS-1, D-12, D-13).
 * Sources (runtime, service role): lotse_events, lotse_offers, lotse_offer_feedback.
 * Context (dashboard, read-only): apps, app_features, org_members (role), training_catalog.
 *
 * Privacy (D-12): a "person" is a pseudonym (u:<user id> or s:<session id>, same as the runtime's caller key).
 * Nothing per person leaves this module — only groups with at least MIN_GROUP distinct pseudonyms.
 */

/** D-12: groups with fewer distinct pseudonyms are never returned or written. */
export const MIN_GROUP = 5;
/** Same thresholds as the dashboard (apps/dashboard/src/lib/insights.ts), so our text matches its verdict. */
export const APP_PROBLEM_AB = 0.5;
export const SCHULUNG_AB = 0.3;
/** A role row is only worth its own dashboard card when it differs this much from "all roles". */
const ROLE_DIFF = 0.15;
const PAGE = 1000; // PostgREST max_rows (supabase/config.toml)
const MAX_ROWS = 50_000;
export const UNCLEAR_INTENT = "(unklar)";

export type Verdict = "app" | "schulung" | "ok";
export type SignalType = "rage_click" | "error" | "empty_results" | "idle" | "repeated_search" | "offer";
export type InsightMetric = "stuck_rate" | "still_stuck_after_hint" | "abandoned_flow" | "question_count";

export interface InsightApp {
  id: string;
  orgId: string;
  name: string;
  domains: string[];
}
export interface InsightFeature {
  name: string;
  route: string;
  clickPath: string[];
  requiredRoles: string[] | null;
  description: string | null;
}
export interface Training {
  title: string;
  topics: string[];
  url: string | null;
}

/** One feature × role group (role null = all roles). persons ≥ MIN_GROUP guaranteed. */
export interface FeatureAggregate {
  feature: string;
  role: string | null;
  /** Distinct pseudonyms with any activity on the feature (incl. searching for it, being offered help). */
  persons: number;
  stuckPersons: number;
  /** Share of persons with at least one stuck signal on the feature. */
  stuckRate: number;
  /** Stuck signals by kind (counts, summed over the group). */
  signals: Partial<Record<SignalType, number>>;
  /** Searches in the app whose term matched this feature's name locally (the term itself never leaves the browser). */
  featureSearches: number;
  offers: number;
  declined: number;
  thumbsUp: number;
  thumbsDown: number;
  /** Help offers on this feature that were not declined ("Fragen an Lotse"). */
  questions: number;
  questionPersons: number;
  /** Persons who got a (not declined) hint on this feature. */
  hintedPersons: number;
  /** Share of hinted persons stuck again on the same feature after the hint. Only if hintedPersons ≥ MIN_GROUP. */
  stillStuckAfterHint?: number;
  flowStartedPersons: number;
  /** Share of persons who started the multi-step flow but never finished it. Only if flowStartedPersons ≥ MIN_GROUP. */
  abandonedFlow?: number;
  /** Dashboard rule: still stuck after hint ≥ 50 % → app; stuck or abandoned ≥ 30 % → training; else ok. */
  verdict: Verdict;
}

export interface InsightAggregates {
  period: { from: string; to: string };
  minGroupSize: number;
  totals: { persons: number; events: number; offers: number; suppressedGroups: number };
  features: FeatureAggregate[];
  /** Offer intents (feature names, or "(unklar)") — no raw question text exists anywhere. Only groups ≥ MIN_GROUP. */
  frequentIntents: { intent: string; count: number; persons: number }[];
}

export interface InsightRow {
  feature: string;
  role: string | null;
  metric: InsightMetric;
  value: number;
  persons: number;
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

type Page<T> = PromiseLike<{ data: T[] | null; error: { message: string } | null }>;

async function selectAll<T>(page: (from: number, to: number) => Page<T>): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await page(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Dashboard app by uuid, or by a domain such as "localhost:4000" (what the extension sends as app id). */
export async function resolveApp(appRef: string, orgId?: string): Promise<InsightApp | null> {
  const db = createAdminClient();
  let query = db.from("apps").select("id, org_id, name, domains");
  query = isUuid(appRef) ? query.eq("id", appRef) : query.contains("domains", [appRef]);
  if (orgId) query = query.eq("org_id", orgId);
  const { data, error } = await query.order("created_at").limit(1);
  if (error) throw new Error(`apps lookup failed: ${error.message}`);
  const a = data?.[0];
  return a ? { id: a.id, orgId: a.org_id, name: a.name, domains: a.domains ?? [] } : null;
}

interface EventRow {
  type: string;
  route: string;
  element_label: string | null;
  detail: string | null;
  session_id: string | null;
  user_id: string | null;
  ts: string;
}
interface OfferRow {
  offer_id: string;
  subject_id: string;
  intent: string | null;
  created_at: string;
}

export interface InsightData {
  features: InsightFeature[];
  trainings: Training[];
  roles: Map<string, string>; // user id → org role
  events: EventRow[];
  offers: OfferRow[];
  feedback: Map<string, "up" | "down" | "declined">;
}

export async function loadInsightData(app: InsightApp, from: Date, to: Date): Promise<InsightData> {
  const db = createAdminClient();
  // Runtime rows carry the app id the extension sent: usually the host ("localhost:4000"), sometimes the dashboard uuid.
  const keys = [...new Set([...app.domains, app.id])];
  const [features, members, trainings, events, offers] = await Promise.all([
    db.from("app_features").select("name, route, click_path, description, required_roles").eq("app_id", app.id),
    db.from("org_members").select("user_id, role").eq("org_id", app.orgId),
    db.from("training_catalog").select("title, topics, url").eq("org_id", app.orgId),
    selectAll<EventRow>((a, b) =>
      db
        .from("lotse_events")
        .select("type, route, element_label, detail, session_id, user_id, ts")
        .in("app_id", keys)
        .gte("ts", from.toISOString())
        .lte("ts", to.toISOString())
        .order("id")
        .range(a, b),
    ),
    selectAll<OfferRow>((a, b) =>
      db
        .from("lotse_offers")
        .select("offer_id, subject_id, intent, created_at")
        .in("app_id", keys)
        .gte("created_at", from.toISOString())
        .lte("created_at", to.toISOString())
        .order("offer_id")
        .range(a, b),
    ),
  ]);
  for (const [what, r] of [["app_features", features], ["org_members", members], ["training_catalog", trainings]] as const) {
    if (r.error) throw new Error(`${what} read failed: ${r.error.message}`);
  }

  const feedback = new Map<string, "up" | "down" | "declined">();
  const ids = offers.map((o) => o.offer_id);
  for (let i = 0; i < ids.length; i += 200) {
    const { data, error } = await db.from("lotse_offer_feedback").select("offer_id, feedback").in("offer_id", ids.slice(i, i + 200));
    if (error) throw new Error(`lotse_offer_feedback read failed: ${error.message}`);
    for (const f of data ?? []) feedback.set(f.offer_id, f.feedback);
  }

  return {
    features: (features.data ?? []).map((f) => ({
      name: f.name,
      route: f.route,
      clickPath: Array.isArray(f.click_path) ? f.click_path : [],
      requiredRoles: f.required_roles ?? null,
      description: f.description ?? null,
    })),
    trainings: (trainings.data ?? []).map((t) => ({ title: t.title, topics: t.topics ?? [], url: t.url ?? null })),
    roles: new Map((members.data ?? []).map((m) => [m.user_id as string, m.role as string])),
    events,
    offers,
    feedback,
  };
}

// ---------------------------------------------------------------------------
// Aggregation (pure)
// ---------------------------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[‹›<>]/g, "").replace(/\s+/g, " ").trim();
const isPlaceholder = (s: string) => /^\s*[<‹].*[>›]\s*$/.test(s);
const round2 = (n: number) => Math.round(n * 100) / 100;

function pathOf(route: string) {
  try {
    return new URL(route, "http://x").pathname;
  } catch {
    return route.split(/[?#]/)[0];
  }
}

interface PreparedFeature extends InsightFeature {
  steps: string[]; // normalized click path, placeholders → ""
  /** A real flow (form/wizard) with ≥ 4 steps — only those get an abandoned_flow rate (not simple filters/tabs). */
  multiStep: boolean;
}

/** step ≥ 0: index in the click path; -1: matched search term; -2: route only (the page belongs to exactly this feature). */
interface Hit {
  feature: PreparedFeature;
  step: number;
}

function attribute(e: EventRow, features: PreparedFeature[], byName: Map<string, PreparedFeature>): Hit[] {
  const matched = e.detail?.match(/matchedFeature=([^;]+)/)?.[1];
  const byMatch = matched ? byName.get(norm(matched)) : undefined;
  if (byMatch) return [{ feature: byMatch, step: -1 }];

  const path = pathOf(e.route);
  const onRoute = features.filter((f) => f.route === "*" || path === f.route || path.endsWith(f.route));
  if (e.element_label) {
    const label = norm(e.element_label);
    const hits: Hit[] = [];
    for (const f of onRoute) {
      // Step 0 is usually shared navigation ("Kunden", "Einstellungen") — only global widgets count there.
      const step = f.steps.findIndex((s, k) => s !== "" && s === label && (k > 0 || f.route === "*"));
      if (step >= 0) hits.push({ feature: f, step });
    }
    if (hits.length) return hits;
  }
  const specific = onRoute.filter((f) => f.route !== "*");
  return specific.length === 1 ? [{ feature: specific[0], step: -2 }] : [];
}

function signalOf(e: EventRow, step: number): SignalType | null {
  if (e.type === "rage_click") return "rage_click";
  if (e.type === "error") return "error";
  if (e.type === "empty_results" || (e.type === "search" && /results=0\b/.test(e.detail ?? ""))) return "empty_results";
  if (e.type === "idle" && step >= 0) return "idle"; // idle on a concrete field of the flow, not on a whole page
  return null;
}

interface SubjectStats {
  stuckTs: number[];
  searchTs: number[];
  signals: Partial<Record<SignalType, number>>;
  started: boolean;
  /** Last finishing action (submit / last click-path step) and last error — finished = finish after the last error. */
  finishedAt: number;
  errorAt: number;
  offers: { ts: number; feedback?: "up" | "down" | "declined" }[];
}

const subjectOf = (userId: string | null, sessionId: string | null) => (userId ? `u:${userId}` : sessionId ? `s:${sessionId}` : null);

export function aggregate(data: InsightData, period: { from: Date; to: Date }): InsightAggregates {
  const features: PreparedFeature[] = data.features.map((f) => ({
    ...f,
    steps: f.clickPath.map((s) => (isPlaceholder(s) ? "" : norm(s))),
    multiStep: f.clickPath.length >= 4,
  }));
  const byName = new Map(features.map((f) => [norm(f.name), f]));

  const perFeature = new Map<string, Map<string, SubjectStats>>();
  const stats = (feature: string, subject: string) => {
    let bySubject = perFeature.get(feature);
    if (!bySubject) perFeature.set(feature, (bySubject = new Map()));
    let s = bySubject.get(subject);
    if (!s) bySubject.set(subject, (s = { stuckTs: [], searchTs: [], signals: {}, started: false, finishedAt: 0, errorAt: 0, offers: [] }));
    return s;
  };
  const bump = (s: SubjectStats, sig: SignalType, ts: number) => {
    s.signals[sig] = (s.signals[sig] ?? 0) + 1;
    s.stuckTs.push(ts);
  };

  const everyone = new Set<string>();
  // Shared labels ("Neue Aufgabe", "Titel" in two task flows): go to the flow this person last touched
  // unambiguously on the same page (≤ 15 min ago); without that context the event is not attributed.
  const flowOf = new Map<string, { feature: string; path: string; ts: number }>();
  const chronological = [...data.events].sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts));
  for (const e of chronological) {
    const subject = subjectOf(e.user_id, e.session_id);
    if (!subject) continue;
    everyone.add(subject);
    const ts = Date.parse(e.ts);
    const path = pathOf(e.route);
    let hits = attribute(e, features, byName);
    if (hits.length > 1) {
      const flow = flowOf.get(subject);
      hits = flow && flow.path === path && ts - flow.ts < 15 * 60_000 ? hits.filter((h) => h.feature.name === flow.feature) : [];
    }
    if (hits.length === 1 && hits[0].step >= 1) flowOf.set(subject, { feature: hits[0].feature.name, path, ts });
    for (const { feature, step } of hits) {
      const s = stats(feature.name, subject);
      if (step === -1) {
        s.searchTs.push(ts);
        continue;
      }
      if (feature.multiStep && step >= 1) s.started = true;
      if (e.type === "submit" || (e.type === "click" && step >= 1 && step === feature.steps.length - 1)) s.finishedAt = Math.max(s.finishedAt, ts);
      const sig = signalOf(e, step);
      if (sig) bump(s, sig, ts);
      if (sig === "error") s.errorAt = Math.max(s.errorAt, ts);
    }
  }

  const intents = new Map<string, { count: number; persons: Set<string> }>();
  for (const o of data.offers) {
    const feature = byName.get(norm(o.intent ?? ""));
    const key = feature?.name ?? UNCLEAR_INTENT;
    const i = intents.get(key) ?? { count: 0, persons: new Set<string>() };
    i.count += 1;
    i.persons.add(o.subject_id);
    intents.set(key, i);
    everyone.add(o.subject_id);
    if (!feature) continue;
    const ts = Date.parse(o.created_at);
    const s = stats(feature.name, o.subject_id);
    s.offers.push({ ts, feedback: data.feedback.get(o.offer_id) });
    bump(s, "offer", ts); // the server only makes an offer when it judged the person stuck
  }

  // Searching the same feature twice in the app's search = it is hard to find.
  for (const bySubject of perFeature.values()) {
    for (const s of bySubject.values()) {
      const sorted = s.searchTs.sort((a, b) => a - b);
      if (sorted.length >= 2) bump(s, "repeated_search", sorted[1]);
    }
  }

  const roleOf = (subject: string) => (subject.startsWith("u:") ? (data.roles.get(subject.slice(2)) ?? null) : null);
  const out: FeatureAggregate[] = [];
  let suppressed = 0;
  for (const [feature, bySubject] of perFeature) {
    const entries = [...bySubject.entries()];
    const groups = new Map<string | null, SubjectStats[]>([[null, entries.map(([, s]) => s)]]);
    for (const [subject, s] of entries) {
      const role = roleOf(subject);
      if (role) groups.set(role, [...(groups.get(role) ?? []), s]);
    }
    for (const [role, list] of groups) {
      if (list.length < MIN_GROUP) {
        suppressed += 1;
        continue;
      }
      out.push(summarize(feature, role, list));
    }
  }

  const order: Record<Verdict, number> = { app: 0, schulung: 1, ok: 2 };
  out.sort((a, b) => order[a.verdict] - order[b.verdict] || b.stuckRate - a.stuckRate || b.persons - a.persons);

  return {
    period: { from: period.from.toISOString(), to: period.to.toISOString() },
    minGroupSize: MIN_GROUP,
    totals: { persons: everyone.size, events: data.events.length, offers: data.offers.length, suppressedGroups: suppressed },
    features: out,
    frequentIntents: [...intents]
      .filter(([, i]) => i.persons.size >= MIN_GROUP)
      .map(([intent, i]) => ({ intent, count: i.count, persons: i.persons.size }))
      .sort((a, b) => b.count - a.count),
  };
}

function summarize(feature: string, role: string | null, list: SubjectStats[]): FeatureAggregate {
  const signals: Partial<Record<SignalType, number>> = {};
  let stuckPersons = 0, searches = 0, offers = 0, declined = 0, up = 0, down = 0, questions = 0, questionPersons = 0;
  let hinted = 0, stillStuck = 0, started = 0, abandoned = 0;
  for (const s of list) {
    if (s.stuckTs.length) stuckPersons += 1;
    for (const [k, v] of Object.entries(s.signals)) signals[k as SignalType] = (signals[k as SignalType] ?? 0) + (v ?? 0);
    searches += s.searchTs.length;
    offers += s.offers.length;
    const hints = s.offers.filter((o) => o.feedback !== "declined");
    declined += s.offers.length - hints.length;
    up += s.offers.filter((o) => o.feedback === "up").length;
    down += s.offers.filter((o) => o.feedback === "down").length;
    questions += hints.length;
    if (hints.length) {
      questionPersons += 1;
      hinted += 1;
      const firstHint = Math.min(...hints.map((o) => o.ts));
      if (s.stuckTs.some((t) => t > firstHint + 1_000)) stillStuck += 1;
    }
    if (s.started) {
      started += 1;
      if (!(s.finishedAt > s.errorAt)) abandoned += 1;
    }
  }
  const stuckRate = round2(stuckPersons / list.length);
  const stillStuckAfterHint = hinted >= MIN_GROUP ? round2(stillStuck / hinted) : undefined;
  const abandonedFlow = started >= MIN_GROUP ? round2(abandoned / started) : undefined;
  const verdict: Verdict =
    (stillStuckAfterHint ?? 0) >= APP_PROBLEM_AB ? "app" : Math.max(stuckRate, abandonedFlow ?? 0) >= SCHULUNG_AB ? "schulung" : "ok";
  return {
    feature,
    role,
    persons: list.length,
    stuckPersons,
    stuckRate,
    signals,
    featureSearches: searches,
    offers,
    declined,
    thumbsUp: up,
    thumbsDown: down,
    questions,
    questionPersons,
    hintedPersons: hinted,
    stillStuckAfterHint,
    flowStartedPersons: started,
    abandonedFlow,
    verdict,
  };
}

// ---------------------------------------------------------------------------
// Dashboard rows (public.insights, owner: Dashboard — we only fill its existing columns)
// ---------------------------------------------------------------------------

/** "All roles" rows for every feature; a role row only when that role clearly differs (else it duplicates the card). */
export function toInsightRows(features: FeatureAggregate[]): InsightRow[] {
  const all = new Map(features.filter((f) => f.role === null).map((f) => [f.feature, f]));
  const differs = (a?: number, b?: number) => a !== undefined && b !== undefined && Math.abs(a - b) >= ROLE_DIFF - 1e-9;
  const rows: InsightRow[] = [];
  for (const f of features) {
    if (f.role !== null) {
      const base = all.get(f.feature);
      const standsOut =
        !base ||
        differs(f.stuckRate, base.stuckRate) ||
        differs(f.abandonedFlow, base.abandonedFlow) ||
        differs(f.stillStuckAfterHint, base.stillStuckAfterHint);
      if (!standsOut) continue;
    }
    const row = (metric: InsightMetric, value: number, persons: number) => rows.push({ feature: f.feature, role: f.role, metric, value, persons });
    row("stuck_rate", f.stuckRate, f.persons);
    if (f.stillStuckAfterHint !== undefined) row("still_stuck_after_hint", f.stillStuckAfterHint, f.hintedPersons);
    if (f.abandonedFlow !== undefined) row("abandoned_flow", f.abandonedFlow, f.flowStartedPersons);
    if (f.questionPersons >= MIN_GROUP) row("question_count", f.questions, f.questionPersons);
  }
  return rows.filter((r) => r.persons >= MIN_GROUP);
}

/**
 * Update-or-insert per (org, app, feature, role, metric, period). Never deletes: rows of the same org/app/period that
 * no longer qualify are retired with persons = 0, which the dashboard's RLS (persons ≥ 5) hides.
 */
export async function writeInsightRows(app: InsightApp, rows: InsightRow[], period: string) {
  const db = createAdminClient();
  const { data: existing, error } = await db
    .from("insights")
    .select("id, feature, role, metric")
    .eq("org_id", app.orgId)
    .eq("app_id", app.id)
    .eq("period", period);
  if (error) throw new Error(`insights read failed: ${error.message}`);
  const key = (r: { feature: string; role: string | null; metric: string }) => `${r.feature}|${r.role ?? ""}|${r.metric}`;
  const ids = new Map((existing ?? []).map((r) => [key(r), r.id as number]));

  const updates = rows.filter((r) => ids.has(key(r)));
  const inserts = rows.filter((r) => !ids.has(key(r)));
  const fresh = new Set(rows.map(key));
  const stale = [...ids].filter(([k]) => !fresh.has(k)).map(([, id]) => id);
  const results = await Promise.all([
    ...updates.map((r) => db.from("insights").update({ value: r.value, persons: r.persons }).eq("id", ids.get(key(r))!)),
    ...(inserts.length
      ? [db.from("insights").insert(inserts.map((r) => ({ org_id: app.orgId, app_id: app.id, period, ...r })))]
      : []),
    ...(stale.length ? [db.from("insights").update({ persons: 0 }).in("id", stale)] : []),
  ]);
  const failed = results.find((r) => r.error);
  if (failed?.error) throw new Error(`insights write failed: ${failed.error.message}`);
  return { inserted: inserts.length, updated: updates.length, retired: stale.length };
}
