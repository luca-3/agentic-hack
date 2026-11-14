import "server-only";
import { PSEUDONYM_TOKEN, type Feature, type LearnResponse } from "@lotse/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { upsertSuggestions, type SuggestionInput } from "./suggestions";

/**
 * Continuous learning run (D-25): refresh `insights` and propose suggestions from runtime data.
 * Runtime tables store app ids as text (host like "localhost:4000" or the dashboard uuid) → mapped via apps.domains.
 * ponytail: aggregates in JS over paged selects (≤ MAX_ROWS per table and app); move to SQL views/rpcs when volume grows.
 */

const DAY = 86_400_000;
const PAGE = 1000; // supabase/config.toml max_rows
const MAX_ROWS = 50_000;
const GENERAL_QUESTIONS = "General questions";

type Db = ReturnType<typeof createAdminClient>;
type Row = Record<string, unknown>;
type Page = PromiseLike<{ data: Row[] | null; error: { message: string } | null }>;

async function all(query: (from: number, to: number) => Page): Promise<Row[]> {
  const out: Row[] = [];
  for (let from = 0; from < MAX_ROWS; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    if (error) throw new Error(error.message);
    out.push(...(data ?? []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

/** Same subject format as Caller.key: "u:<user id>" else "s:<session id>". */
const subjectOf = (r: Row) => (r.user_id ? `u:${r.user_id}` : r.session_id ? `s:${r.session_id}` : null);
const lc = (s: unknown) => String(s ?? "").trim().toLowerCase();
const since = (ms: number) => new Date(Date.now() - ms).toISOString();
const distinct = (rows: Row[], pick: (r: Row) => string | null) => new Set(rows.map(pick).filter((v): v is string => !!v)).size;

/** Strip anything token- or key-like from an error message before it reaches the dashboard. */
function safeError(e: unknown): string | undefined {
  if (!e) return undefined;
  return String(e)
    .replace(/Bearer\s+\S+/gi, "Bearer [removed]")
    .replace(/\beyJ[\w-]+\.[\w-]+\.[\w-]*/g, "[removed]")
    .replace(/\b(AIza[\w-]{10,}|sk[-_][\w-]{10,}|sb_(secret|publishable)_[\w-]+)/g, "[removed]")
    .replace(/([?&](key|token|api_key)=)[^&\s]+/gi, "$1[removed]")
    .slice(0, 200);
}

interface AppRow {
  id: string;
  keys: string[]; // all text ids the runtime may have stored for this app
  features: Feature[];
}

async function loadApps(db: Db, orgId: string, appId?: string): Promise<AppRow[]> {
  let q = db.from("apps").select("id, domains").eq("org_id", orgId);
  if (appId) q = q.eq("id", appId);
  const { data: apps, error } = await q;
  if (error) throw new Error(`apps read failed: ${error.message}`);
  if (!apps?.length) return [];
  const { data: feats, error: fErr } = await db
    .from("app_features")
    .select("app_id, name, description, route, click_path")
    .in("app_id", apps.map((a) => a.id));
  if (fErr) throw new Error(`app_features read failed: ${fErr.message}`);
  return apps.map((a) => {
    const domains = ((a.domains as string[] | null) ?? []).map(lc);
    const keys = new Set([lc(a.id), ...domains, ...domains.map((d) => d.replace(/^https?:\/\//, "").replace(/\/+$/, ""))]);
    const features = (feats ?? [])
      .filter((f) => f.app_id === a.id)
      .map((f) => ({ name: f.name, description: f.description ?? "", route: f.route, clickPath: (f.click_path as string[] | null) ?? [] }));
    return { id: a.id as string, keys: [...keys].filter(Boolean), features };
  });
}

async function refreshInsights(db: Db, orgId: string, app: AppRow, events: Row[], offers: Row[], asks: Row[]): Promise<number> {
  const period = new Date().toISOString().slice(0, 10);
  const rows: { metric: string; feature: string; value: number; persons: number }[] = [];
  const seen = new Set([...events, ...offers].map(subjectOf).filter(Boolean)).size;

  // ponytail: offers.intent is the feature name when /decide matched one; with known features only those count, else every intent.
  const known = new Set(app.features.map((f) => lc(f.name)));
  const byIntent = new Map<string, Row[]>();
  for (const o of offers) {
    const intent = String(o.intent ?? "").trim();
    if (!intent || (known.size > 0 && !known.has(lc(intent)))) continue;
    byIntent.set(intent, [...(byIntent.get(intent) ?? []), o]);
  }
  for (const [feature, list] of byIntent) {
    const perSubject = new Map<string, number[]>();
    for (const o of list) {
      const s = String(o.subject_id);
      perSubject.set(s, [...(perSubject.get(s) ?? []), Date.parse(String(o.created_at))]);
    }
    if (seen > 0) rows.push({ metric: "stuck_rate", feature, value: Math.min(1, perSubject.size / seen), persons: seen });
    // ponytail: "still stuck" = a second offer for the same intent within 15 min after the subject's first one.
    let again = 0;
    for (const ts of perSubject.values()) {
      ts.sort((a, b) => a - b);
      if (ts.length > 1 && ts[1] - ts[0] <= 15 * 60_000) again++;
    }
    rows.push({ metric: "still_stuck_after_hint", feature, value: again / perSubject.size, persons: perSubject.size });
  }
  // ponytail: one question = one /ask tier run; the classifier row (tier 'classify') of the same question is skipped. Feature unknown.
  const questions = asks.filter((r) => r.tier !== "classify");
  if (questions.length) rows.push({ metric: "question_count", feature: GENERAL_QUESTIONS, value: questions.length, persons: distinct(questions, subjectOf) });

  const insert = rows.filter((r) => r.persons >= 1).map((r) => ({ org_id: orgId, app_id: app.id, role: null, period, ...r }));
  if (!insert.length) return 0; // no fresh numbers → keep what is there (e.g. seeded demo insights)
  // Replace only the (feature, metric) pairs we have fresh numbers for — other features keep their rows.
  for (const metric of new Set(insert.map((r) => r.metric))) {
    const { error: delErr } = await db
      .from("insights")
      .delete()
      .eq("org_id", orgId)
      .eq("app_id", app.id)
      .eq("period", period)
      .eq("metric", metric)
      .is("role", null)
      .in("feature", insert.filter((r) => r.metric === metric).map((r) => r.feature));
    if (delErr) throw new Error(`insights delete failed: ${delErr.message}`);
  }
  const { error } = await db.from("insights").insert(insert);
  if (error) throw new Error(`insights insert failed: ${error.message}`);
  return insert.length;
}

function agentErrors(app: AppRow, failures: Row[], downs: Row[]): SuggestionInput[] {
  const out: SuggestionInput[] = [];
  const groups = new Map<string, Row[]>();
  for (const r of failures) groups.set(`${r.route}|${r.status}`, [...(groups.get(`${r.route}|${r.status}`) ?? []), r]);
  for (const list of groups.values()) {
    const { route, status } = list[0] as { route: string; status: string };
    const last = list.reduce((a, b) => (String(a.created_at) > String(b.created_at) ? a : b));
    out.push({
      appId: app.id,
      source: "learn",
      kind: "agent_error",
      title: status === "timeout" ? `Valo answers too slowly (${route})` : `Valo errors on ${route}`,
      detail: `${list.length}× ${status === "timeout" ? "timeout" : "error"} in the last 24 hours.`,
      payload: { route, status, lastError: safeError(last.error) },
      fingerprint: `agent_error:${app.id}:${route}:${status}`,
      occurrences: list.length,
      persons: distinct(list, subjectOf),
    });
  }

  const byIntent = new Map<string, Row[]>();
  for (const d of downs) {
    const intent = String((d.lotse_offers as Row | null)?.intent ?? "").trim();
    if (intent) byIntent.set(intent, [...(byIntent.get(intent) ?? []), d]);
  }
  for (const [intent, list] of byIntent) {
    if (list.length < 2) continue;
    out.push({
      appId: app.id,
      source: "learn",
      kind: "agent_error",
      title: `Hint for “${intent}” is often rejected`,
      detail: `${list.length}× rated 👎 in the last 7 days.`,
      payload: { status: "down", intent },
      fingerprint: `agent_error:${app.id}:down:${lc(intent)}`,
      occurrences: list.length,
      persons: distinct(list, (r) => String(r.subject_id)),
    });
  }
  return out;
}

function staleFeatures(app: AppRow, events: Row[]): SuggestionInput[] {
  const recent = events.filter((e) => String(e.ts) >= since(3 * DAY));
  if (recent.length < 20) return [];
  const labels = new Set(recent.map((e) => lc(e.element_label)).filter(Boolean));
  const out: SuggestionInput[] = [];
  for (const f of app.features) {
    const missingLabel = f.clickPath.at(-1)?.trim();
    // Placeholders like "<Kundenname>" stand for record content, never a literal label.
    if (!missingLabel || /[<>‹›]/.test(missingLabel) || labels.has(lc(missingLabel))) continue;
    out.push({
      appId: app.id,
      source: "learn",
      kind: "stale_feature",
      title: `Click path to “${f.name}” may be outdated`,
      detail: `“${missingLabel}” hasn't been clicked in the last 3 days — maybe the button was renamed or moved.`,
      payload: { feature: f.name, missingLabel },
      fingerprint: `stale_feature:${app.id}:${lc(f.name)}`,
    });
  }
  return out;
}

function unknownFeatures(app: AppRow, events: Row[], suggestedLabels: Set<string>): SuggestionInput[] {
  const known = new Set([...app.features.flatMap((f) => f.clickPath.map(lc)), ...suggestedLabels]);
  const groups = new Map<string, { route: string; label: string; subjects: Set<string> }>();
  for (const e of events) {
    const label = String(e.element_label ?? "").trim();
    const subject = subjectOf(e);
    if (e.type !== "click" || !label || !subject || known.has(lc(label))) continue;
    if (label.match(PSEUDONYM_TOKEN)) continue; // record content, not a UI label
    const k = `${e.route}|${lc(label)}`;
    const g = groups.get(k) ?? { route: String(e.route), label, subjects: new Set<string>() };
    g.subjects.add(subject);
    groups.set(k, g);
  }
  return [...groups.values()]
    .filter((g) => g.subjects.size >= 3)
    .sort((a, b) => b.subjects.size - a.subjects.size)
    .slice(0, 50)
    .map(({ route, label, subjects }) => ({
      appId: app.id,
      source: "learn" as const,
      kind: "feature" as const,
      title: label,
      detail: `${subjects.size} people click “${label}” on ${route} — that's not a known feature yet.`,
      payload: { name: label, description: "", route, clickPath: [label], requiredRole: null } satisfies Feature,
      fingerprint: `feature:${route}:${lc(label)}`,
      persons: subjects.size,
    }));
}

/** Runs all detectors for one org (optionally one app). Uses the admin client — callers check permissions. */
export async function runLearn(orgId: string, appId?: string): Promise<LearnResponse> {
  const db = createAdminClient();
  const apps = await loadApps(db, orgId, appId);
  const { data: open, error: sErr } = await db.from("lotse_suggestions").select("app_id, payload").eq("org_id", orgId).eq("kind", "feature");
  if (sErr) throw new Error(`lotse_suggestions read failed: ${sErr.message}`);

  let insights = 0;
  const items: SuggestionInput[] = [];
  for (const app of apps) {
    const week = since(7 * DAY);
    const [events, offers, usage, downs] = await Promise.all([
      all((a, b) => db.from("lotse_events").select("ts, type, route, element_label, session_id, user_id").in("app_id", app.keys).gte("ts", week).order("id").range(a, b)),
      all((a, b) => db.from("lotse_offers").select("subject_id, intent, created_at").in("app_id", app.keys).gte("created_at", week).order("created_at").range(a, b)),
      all((a, b) => db.from("agent_usage").select("created_at, route, tier, status, error, session_id, user_id").in("app_id", app.keys).gte("created_at", week).order("id").range(a, b)),
      all((a, b) =>
        db
          .from("lotse_offer_feedback")
          .select("subject_id, created_at, lotse_offers!inner(intent, app_id)")
          .eq("feedback", "down")
          .in("lotse_offers.app_id", app.keys)
          .gte("created_at", week)
          .order("created_at")
          .range(a, b),
      ),
    ]);
    const day = since(DAY);
    const failures = usage.filter((r) => (r.status === "error" || r.status === "timeout") && String(r.created_at) >= day);
    const suggestedLabels = new Set(
      (open ?? []).filter((s) => s.app_id === app.id).flatMap((s) => ((s.payload as { clickPath?: string[] }).clickPath ?? []).map(lc)),
    );

    insights += await refreshInsights(db, orgId, app, events, offers, usage.filter((r) => r.route === "ask"));
    items.push(...agentErrors(app, failures, downs), ...staleFeatures(app, events), ...unknownFeatures(app, events, suggestedLabels));
  }
  // TODO knowledge_gap: needs a server-side log of unanswered /ask questions (e.g. lotse_unanswered: org_id, app_id, subject,
  // pseudonymized topic from the classifier, created_at) — never the raw question. Then group topics, persons ≥ 5 → suggestion.
  // Drafts (Gemini polish of learn feature drafts) are skipped for now → drafts: 0.
  const suggestions = await upsertSuggestions(orgId, items);
  return { suggestions, insights, drafts: 0 };
}

/** Every LOTSE_LEARN_INTERVAL_MIN minutes (default 10, "0" = off) runLearn for every org. Once per process, never throws. */
export function startLearnScheduler() {
  const g = globalThis as { __lotseLearnTimer?: ReturnType<typeof setInterval> };
  const minutes = Number(process.env.LOTSE_LEARN_INTERVAL_MIN ?? 10);
  if (g.__lotseLearnTimer || !Number.isFinite(minutes) || minutes <= 0) return;
  let running = false;
  g.__lotseLearnTimer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const { data: orgs, error } = await createAdminClient().from("orgs").select("id");
      if (error) throw new Error(error.message);
      for (const o of orgs ?? []) {
        await runLearn(o.id as string).catch((e) => console.error(`[lotse] learn run failed for org ${o.id}:`, (e as Error).message));
      }
    } catch (e) {
      console.error("[lotse] learn scheduler failed:", (e as Error).message);
    } finally {
      running = false;
    }
  }, minutes * 60_000);
  g.__lotseLearnTimer.unref?.();
  console.info(`[lotse] learn scheduler: every ${minutes} min`);
}
