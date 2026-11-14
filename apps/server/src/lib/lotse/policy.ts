import "server-only";
import type { PolicyResponse } from "@lotse/shared";
import { memberRole } from "./context";
import { devAuthAllowed, type Caller } from "./guard";
import { knowledgeSource } from "./knowledge";

/**
 * App policy for the extension (GET /api/lotse/policy): is the host a known app, where must Lotse stay silent, who is the caller.
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
    reason = "Lotse ist gerade deaktiviert.";
  } else if (!known && !allowUnknownApps()) {
    allowed = false;
    reason = "Diese App ist für Lotse nicht freigegeben.";
  } else if (known && !member && !devAuthAllowed()) {
    allowed = false;
    reason = "Melde dich mit einem Konto dieser Organisation an.";
  }

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
  };
}
