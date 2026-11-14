import "server-only";
import { FeatureListSchema, FeatureSchema, type Feature } from "@lotse/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import kundenwerkFeatures from "./fixtures/kundenwerk-features.json";

/**
 * App knowledge for the Lotse agent: which org/app the request is in, which features the app has, where they live
 * and who may use them. The agent only depends on `KnowledgeSource` — swap the source without touching agent/orchestrator.
 *
 * `LOTSE_KNOWLEDGE_SOURCE`:
 *  - auto (default): dashboard tables (`apps.domains` → `apps.org_id` → `app_features`, read-only via the admin client);
 *    bundled fixture when the app is not in the DB, has no valid features, or the DB is unreachable (warning logged).
 *  - db: same as auto, but also warns when the app is missing in the DB (use it to catch misconfiguration).
 *  - fixture: never touches the DB (bundled JSON per app host, demo CRM on localhost:4000).
 * Results (hits, misses and errors) are cached in memory per app id — a dashboard change shows up after ≤ 60 s.
 */
export interface AppKnowledge {
  appId: string; // host or dashboard app id the request named
  orgId: string | null; // dashboard org (db only) — scopes the knowledge base and the member role lookup
  orgName?: string | null;
  dashboardAppId?: string | null; // apps.id in the dashboard DB (db only) — scopes the knowledge search
  appName?: string | null;
  features: Feature[];
  /** Where `features` came from. orgId can be set while features fall back to the fixture (app row without features). */
  source: "db" | "fixture" | "none";
}

export interface KnowledgeSource {
  getApp(appId: string): Promise<AppKnowledge>;
}

const FIXTURES: Record<string, Feature[]> = {
  "localhost:4000": FeatureListSchema.parse(kundenwerkFeatures),
  "127.0.0.1:4000": FeatureListSchema.parse(kundenwerkFeatures),
};

export const fixtureKnowledge: KnowledgeSource = {
  async getApp(appId) {
    const features = FIXTURES[appId.toLowerCase()];
    return { appId, orgId: null, features: features ?? [], source: features ? "fixture" : "none" };
  },
};

const CACHE_MS = 60_000;
const ERROR_CACHE_MS = 15_000; // DB down → don't pay the timeout on every request
const DB_TIMEOUT_MS = 2_000;
const cache = new Map<string, { until: number; value: AppKnowledge }>();
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Dashboard rows → Feature (invalid rows are skipped, not fatal). */
function toFeatures(rows: { name: string; description: string | null; route: string; click_path: string[] | null; required_roles: string[] | null }[]) {
  const out: Feature[] = [];
  for (const r of rows) {
    const f = FeatureSchema.safeParse({
      name: r.name,
      description: r.description ?? "",
      route: r.route,
      clickPath: r.click_path ?? [],
      requiredRole: r.required_roles,
    });
    if (f.success) out.push(f.data);
  }
  return out;
}

async function lookupDb(appId: string, strict: boolean): Promise<AppKnowledge> {
  const db = createAdminClient();
  const signal = AbortSignal.timeout(DB_TIMEOUT_MS);
  const key = appId.toLowerCase();
  // Dashboard stores what admins typed ("localhost:4000"); accept a scheme prefix too. A uuid appId = apps.id.
  const query = db.from("apps").select("id, name, org_id, orgs(name)").limit(1).abortSignal(signal);
  const { data: apps, error } = await (UUID.test(key)
    ? query.eq("id", key)
    : query.overlaps("domains", [key, `http://${key}`, `https://${key}`]));
  if (error) throw new Error(error.message);
  const app = apps?.[0];
  if (!app) {
    if (strict) console.warn(`[lotse] knowledge: app "${appId}" not found in the dashboard DB, using fixture`);
    return fixtureKnowledge.getApp(appId);
  }
  const { data: rows, error: fErr } = await db
    .from("app_features")
    .select("name, description, route, click_path, required_roles")
    .eq("app_id", app.id)
    .order("id")
    .abortSignal(signal);
  if (fErr) throw new Error(fErr.message);
  const org = { orgId: app.org_id as string, orgName: (app.orgs as unknown as { name: string } | null)?.name ?? null };
  const scope = { ...org, dashboardAppId: app.id as string, appName: app.name as string };
  const features = toFeatures(rows ?? []);
  if (features.length === 0) {
    console.warn(`[lotse] knowledge: app "${appId}" has no valid features in the DB, using fixture features`);
    return { ...(await fixtureKnowledge.getApp(appId)), ...scope };
  }
  return { appId, ...scope, features, source: "db" };
}

function dbKnowledge(strict: boolean): KnowledgeSource {
  return {
    async getApp(appId) {
      const key = appId.toLowerCase();
      const hit = cache.get(key);
      if (hit && Date.now() < hit.until) return hit.value;
      let value: AppKnowledge;
      let ttl = CACHE_MS;
      try {
        value = await lookupDb(appId, strict);
        console.info(
          `[lotse] knowledge ${appId} → ${value.source}` +
            (value.orgId ? ` (org ${value.orgName ?? value.orgId}, app ${value.appName ?? value.dashboardAppId})` : "") +
            `, ${value.features.length} features`,
        );
      } catch (e) {
        console.warn("[lotse] knowledge db lookup failed, using fixture:", (e as Error).message);
        value = await fixtureKnowledge.getApp(appId);
        ttl = ERROR_CACHE_MS;
      }
      cache.set(key, { until: Date.now() + ttl, value });
      return value;
    },
  };
}

const sources = { auto: dbKnowledge(false), db: dbKnowledge(true), fixture: fixtureKnowledge };

export function knowledgeSource(): KnowledgeSource {
  const mode = process.env.LOTSE_KNOWLEDGE_SOURCE?.trim().toLowerCase();
  return mode === "fixture" ? sources.fixture : mode === "db" ? sources.db : sources.auto;
}

/** App id = explicit appId, else x-lotse-app header, else the snapshot URL's host. */
export function resolveAppId(explicit: string | undefined, header: string | null, url: string | undefined) {
  if (explicit) return explicit.slice(0, 200);
  if (header) return header.slice(0, 200);
  try {
    return url ? new URL(url).host : "unknown";
  } catch {
    return "unknown";
  }
}

// ---------------------------------------------------------------------------
// Simple lexical matching (no LLM): used by the orchestrator heuristic and the searchFeatures tool.
// ---------------------------------------------------------------------------

const STOPWORDS = new Set(
  (
    "der die das den dem des ein eine einen einem einer und oder ich du er sie es wir ihr mein meine dein wie wo was wer " +
    "warum wann kann können muss soll will möchte mir mich dir dich hier da dort bei von vom zu zum zur im in an auf aus " +
    "für mit nach ist sind bin hat habe the a an and or i you how where what who can do does to of in on for with my is " +
    "bitte mal gerade jetzt finde finden zeig zeige zeigen geht gehe ändern ändere öffnen öffne neue neuen neu"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Token overlap with light prefix matching ("aufgabe" ~ "aufgaben", "bankverbindung" ~ "bank"). */
export function overlap(queryTokens: string[], text: string): number {
  const tokens = tokenize(text);
  let score = 0;
  for (const q of queryTokens) {
    if (tokens.includes(q)) score += 1;
    else if (tokens.some((t) => (t.length >= 4 && q.startsWith(t)) || (q.length >= 4 && t.startsWith(q)))) score += 0.6;
  }
  return score;
}

export function scoreFeature(queryTokens: string[], f: Feature): number {
  return overlap(queryTokens, f.name) * 1.5 + overlap(queryTokens, f.description) * 0.5 + overlap(queryTokens, f.clickPath.join(" "));
}

export function searchFeatures(features: Feature[], query: string, limit = 5) {
  const q = tokenize(query);
  return features
    .map((f) => ({ f, score: scoreFeature(q, f) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((x) => x.f);
}

export function roleAllowed(f: Feature, role: string | undefined): boolean {
  if (!f.requiredRole || f.requiredRole.length === 0 || !role) return true;
  return f.requiredRole.some((r) => r.toLowerCase() === role.toLowerCase());
}

/** "/kunde.html" matches "http://localhost:4000/kunde.html?id=x"; "*" matches everything. */
export function routeMatches(featureRoute: string, url: string): boolean {
  if (featureRoute === "*") return true;
  try {
    return new URL(url).pathname === featureRoute;
  } catch {
    return url.startsWith(featureRoute);
  }
}
