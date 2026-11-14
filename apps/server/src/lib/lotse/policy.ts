import "server-only";
import type { PolicyResponse } from "@lotse/shared";
import { createAdminClient } from "@/lib/supabase/admin";
import { memberRole } from "./context";
import { devAuthAllowed, type Caller } from "./guard";
import { knowledgeSource } from "./knowledge";

/**
 * App policy for the extension (GET /api/lotse/policy): is the host a known app, where must Valo stay silent, who is the caller.
 *
 * Blocked routes (patterns for `routeBlocked` in @lotse/shared — `*` = anything, case-insensitive, matched against path + query + hash):
 *  - CORPUS apps (host in `LOTSE_CORPUS_HOSTS`, default localhost:3100 / 127.0.0.1:3100, or dashboard app named "CORPUS…")
 *    always get `LOTSE_FLEET_ROUTES` (default `*fahrzeug*,*vehicle*,*fleet*,*fuhrpark*`) — the vehicle pages hold real fleet data.
 *  - Per app: `LOTSE_BLOCKED_ROUTES="localhost:3100=/admin/*|/export*;localhost:4000=/konto*"` adds patterns for that host.
 * Unknown hosts (not in any org's `apps.domains`): allowed with an empty blocklist in dev, refused in production
 * (`LOTSE_ALLOW_UNKNOWN_APPS=1|0` overrides). In production a known app also requires org membership.
 */
const TTL_SEC = 60;
const DEFAULT_CORPUS_HOSTS = ["localhost:3100", "127.0.0.1:3100"];
const DEFAULT_FLEET_ROUTES = ["*fahrzeug*", "*vehicle*", "*fleet*", "*fuhrpark*"];

/** Comma list from env; unset OR blank → defaults (an empty `LOTSE_FLEET_ROUTES=` copied from .env.example must not unblock CORPUS). */
const csv = (name: string, fallback: string[]) => {
  const list = (process.env[name] ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return list.length ? list : fallback;
};

/** "http://LocalHost:3100/x" → "localhost:3100" (host + port, lowercase). */
export function normalizeHost(value: string): string {
  const v = value.trim().toLowerCase();
  try {
    return new URL(v.includes("://") ? v : `http://${v}`).host;
  } catch {
    return v.slice(0, 200);
  }
}

function perAppRoutes(host: string): string[] {
  const out: string[] = [];
  for (const entry of (process.env.LOTSE_BLOCKED_ROUTES ?? "").split(";")) {
    const [key, patterns] = entry.split("=");
    if (key && patterns && normalizeHost(key) === host) out.push(...patterns.split("|").map((p) => p.trim()).filter(Boolean));
  }
  return out;
}

function isCorpus(host: string, appName: string | null | undefined) {
  return csv("LOTSE_CORPUS_HOSTS", DEFAULT_CORPUS_HOSTS).map(normalizeHost).includes(host) || /^\s*corpus\b/i.test(appName ?? "");
}

const DOMAINS_CACHE_MS = 60_000;
const domainsCache = new Map<string, { until: number; domains: string[] }>();

/** Domains of all apps in the caller's orgs (dashboard `apps.domains`), normalized; [] on error. Cached 60 s per user. */
async function memberAppDomains(userId: string): Promise<string[]> {
  const hit = domainsCache.get(userId);
  if (hit && Date.now() < hit.until) return hit.domains;
  try {
    const db = createAdminClient();
    const signal = AbortSignal.timeout(2_000);
    const { data: orgs, error } = await db.from("org_members").select("org_id").eq("user_id", userId).abortSignal(signal);
    if (error) throw new Error(error.message);
    const orgIds = (orgs ?? []).map((row) => row.org_id as string);
    let domains: string[] = [];
    if (orgIds.length) {
      const { data: apps, error: appsError } = await db.from("apps").select("domains").in("org_id", orgIds).abortSignal(signal);
      if (appsError) throw new Error(appsError.message);
      domains = [...new Set((apps ?? []).flatMap((row) => (row.domains as string[] | null) ?? []).map(normalizeHost))].slice(0, 50);
    }
    domainsCache.set(userId, { until: Date.now() + DOMAINS_CACHE_MS, domains });
    return domains;
  } catch (e) {
    console.warn("[lotse] app domains lookup failed:", (e as Error).message);
    return [];
  }
}

function allowUnknownApps() {
  const v = process.env.LOTSE_ALLOW_UNKNOWN_APPS?.trim();
  return v ? v === "1" : process.env.NODE_ENV !== "production";
}

export async function resolvePolicy(appParam: string, caller: Caller): Promise<PolicyResponse> {
  const host = normalizeHost(appParam);
  const app = await knowledgeSource().getApp(host);
  const known = Boolean(app.orgId);
  const role = caller.userId && app.orgId ? await memberRole(app.orgId, caller.userId) : undefined;
  const member = typeof role === "string";
  const blockedRoutes = [...new Set([...(isCorpus(host, app.appName) ? csv("LOTSE_FLEET_ROUTES", DEFAULT_FLEET_ROUTES) : []), ...perAppRoutes(host)])]
    .map((p) => p.slice(0, 200))
    .slice(0, 50);

  let allowed = true;
  let reason: string | undefined;
  if (process.env.LOTSE_DISABLED === "1") {
    allowed = false;
    reason = "Valo is currently disabled.";
  } else if (!known && !allowUnknownApps()) {
    allowed = false;
    reason = "This app is not enabled for Valo.";
  } else if (known && !member && !devAuthAllowed()) {
    allowed = false;
    reason = "Sign in with an account of this organization.";
  }

  // D-29: start observing without a click on the apps of the caller's org; in dev also on apps the runtime knows
  // (dashboard row or bundled fixture, e.g. the demo CRM on localhost:4000) — never on unknown hosts.
  const autoStart = allowed && (member || (devAuthAllowed() && (known || app.source === "fixture")));
  const appDomains = caller.userId ? await memberAppDomains(caller.userId) : undefined;

  return {
    app: host,
    allowed,
    known,
    blockedRoutes,
    appName: app.appName ?? null,
    orgName: app.orgName ?? null,
    signedIn: Boolean(caller.userId),
    member,
    role: member ? role : null,
    ...(reason ? { reason } : {}),
    ttlSec: TTL_SEC,
    autoStart,
    ...(appDomains ? { appDomains } : {}),
  };
}
