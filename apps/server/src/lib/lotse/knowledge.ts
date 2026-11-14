import "server-only";
import { FeatureListSchema, type Feature } from "@lotse/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import kundenwerkFeatures from "./fixtures/kundenwerk-features.json";

/**
 * App knowledge for the Lotse agent: which features an app has, where they live and who may use them.
 * The agent only depends on `KnowledgeSource` — swap the source without touching agent/orchestrator.
 *
 * Sources:
 *  - fixture (default): bundled JSON per app host (demo CRM on localhost:4000).
 *  - db (`LOTSE_KNOWLEDGE_SOURCE=db`): dashboard tables `apps` (domains[]) + `app_features`, read-only via the
 *    admin client; falls back to the fixture when the app/features are missing or the DB errors.
 */
export interface AppKnowledge {
  appId: string; // host or dashboard app id the request named
  orgId: string | null; // dashboard org (db source only)
  dashboardAppId?: string | null; // apps.id in the dashboard DB (db source only) — scopes the knowledge search
  features: Feature[];
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
const cache = new Map<string, { at: number; value: AppKnowledge }>();

/** Reads the dashboard's tables (owned by the dashboard — read only). */
export const dbKnowledge: KnowledgeSource = {
  async getApp(appId) {
    const hit = cache.get(appId);
    if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
    try {
      const db = createAdminClient();
      const { data: apps, error } = await db.from("apps").select("id, org_id").contains("domains", [appId]).limit(1);
      if (error) throw new Error(error.message);
      const app = apps?.[0];
      if (!app) return fixtureKnowledge.getApp(appId);
      const { data: rows, error: fErr } = await db
        .from("app_features")
        .select("name, description, route, click_path, required_roles")
        .eq("app_id", app.id);
      if (fErr) throw new Error(fErr.message);
      const parsed = FeatureListSchema.safeParse(
        (rows ?? []).map((r) => ({
          name: r.name,
          description: r.description ?? "",
          route: r.route,
          clickPath: r.click_path,
          requiredRole: r.required_roles,
        })),
      );
      if (!parsed.success || parsed.data.length === 0) {
        const fallback = await fixtureKnowledge.getApp(appId);
        return { ...fallback, orgId: app.org_id as string, dashboardAppId: app.id as string };
      }
      const value: AppKnowledge = { appId, orgId: app.org_id as string, dashboardAppId: app.id as string, features: parsed.data, source: "db" };
      cache.set(appId, { at: Date.now(), value });
      return value;
    } catch (e) {
      console.warn("[lotse] knowledge db lookup failed, using fixture:", (e as Error).message);
      return fixtureKnowledge.getApp(appId);
    }
  },
};

export function knowledgeSource(): KnowledgeSource {
  return process.env.LOTSE_KNOWLEDGE_SOURCE === "db" ? dbKnowledge : fixtureKnowledge;
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
