import type { PolicyResponse } from "@lotse/shared";
import { routeBlocked } from "@lotse/shared/route";

/**
 * App policy cache for the service worker (GET /api/lotse/policy, D-12). Fail closed: no policy = paused.
 * A failed refetch keeps the last known policy (its blocklist still applies) and retries after a short pause.
 */
export const PAUSED_TEXT = "Lotse pausiert auf dieser Seite.";

type Entry = { policy: PolicyResponse | null; until: number };
const RETRY_MS = 5_000;
const cache = new Map<string, Entry>();
const inflight = new Map<string, Promise<PolicyResponse | null>>();
let epoch = 0;

/** Host + port of an http(s) URL ("localhost:4000"), or null. */
export function hostOf(url: string | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === "http:" || u.protocol === "https:" ? u.host.toLowerCase() : null;
  } catch { return null; }
}

/** What blocked-route patterns are matched against: path + query + hash. Checked locally, never sent. */
export function locationOf(url: string | undefined): string {
  try { const u = new URL(url ?? ""); return u.pathname + u.search + u.hash; }
  catch { return url ?? ""; }
}

export async function policyFor(host: string, load: (host: string) => Promise<PolicyResponse>): Promise<PolicyResponse | null> {
  const hit = cache.get(host);
  if (hit && hit.until > Date.now()) return hit.policy;
  const running = inflight.get(host);
  if (running) return running;
  const started = epoch;
  const pending: Promise<PolicyResponse | null> = load(host)
    .then((policy) => {
      if (started === epoch) cache.set(host, { policy, until: Date.now() + policy.ttlSec * 1_000 });
      return policy;
    })
    .catch(() => {
      const stale = hit?.policy ?? null;
      if (started === epoch) cache.set(host, { policy: stale, until: Date.now() + RETRY_MS });
      return stale;
    })
    .finally(() => { if (inflight.get(host) === pending) inflight.delete(host); });
  inflight.set(host, pending);
  return pending;
}

/** Last known policy without a network call (may be stale or null). */
export function cachedPolicy(host: string | null): PolicyResponse | null {
  return host ? cache.get(host)?.policy ?? null : null;
}

/** Login/logout changes role and possibly the allow decision: forget everything. */
export function clearPolicies() {
  epoch++;
  cache.clear();
  inflight.clear();
}

export type PageVerdict = { paused: boolean; reason: string };

export function pageVerdict(url: string | undefined, policy: PolicyResponse | null): PageVerdict {
  if (!policy) return { paused: true, reason: "Lotse kann die Freigabe dieser App gerade nicht prüfen (Lotse-Server erreichbar?)." };
  if (!policy.allowed) return { paused: true, reason: policy.reason ?? "Diese App ist für Lotse nicht freigegeben." };
  if (routeBlocked(locationOf(url), policy.blockedRoutes)) return { paused: true, reason: "Auf dieser Seite beobachtet Lotse nichts (geschützte Daten)." };
  return { paused: false, reason: "" };
}
