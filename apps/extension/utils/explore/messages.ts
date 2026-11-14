/**
 * Exploration mode (D-25) — extension-internal messages and types. Not part of the HTTP contract: the page map that
 * leaves the browser is `ExploreRequest` in `@lotse/shared`. Type-only imports keep zod out of the content script.
 */
import type { ExploredPage, ExploreResponse } from "@lotse/shared";
import type { PrivacyTerm } from "../pseudonymize";

/** A same-origin link found on a page (or in a menu), with the click path that reaches it. */
export type FoundLink = { url: string; reachedVia: string[] };

export type ExplorePhase = "idle" | "running" | "stopped" | "sending" | "done" | "error";

/** Side panel view of the exploration (polled via `lotse:explore-status`). */
export type ExploreStatus = {
  phase: ExplorePhase;
  /** Start allowed in the active tab (signed in, org admin, app known and allowed, page not blocked). */
  canStart: boolean;
  reason: string; // why not, or a hint
  appHost: string | null;
  appName: string | null;
  pages: number;
  elements: number;
  queued: number;
  currentRoute: string | null;
  elapsedMs: number;
  limitMs: number;
  maxPages: number;
  message: string;
  result: ExploreResponse | null;
  dashboardUrl: string; // where admins review and accept the suggestions ("Lernen")
};

/** Scan request worker → content script for the page that just loaded. */
export type ScanRequest = {
  type: "lotse:explore-scan";
  runId: string;
  reachedVia: string[];
  blockedRoutes: string[];
  neverClick: string[];
  /** Probe keys already done on earlier pages (global chrome like header menus is probed once). */
  probed: string[];
  /** How many more pages (page/tab/menu/dialog entries) may be recorded. */
  budget: number;
  maxElements: number; // EXPLORE_LIMITS.maxElementsPerPage (the content script stays zod-free)
  deadline: number; // epoch ms
  pagesSoFar: number;
};
export type ScanResult = { ok: true; probed: string[]; finalUrl: string } | { ok: false; paused?: boolean; error: string };

/**
 * content script → worker, sent as soon as something is recorded (survives an unexpected navigation). Pages are raw
 * (real labels, extension-internal only); `terms` = the page's content strings from `collectPagePrivacy()` (D-26) —
 * the worker learns them and pseudonymizes the whole map right before it leaves the browser.
 */
export type FoundMessage = { type: "lotse:explore-found"; runId: string; pages: ExploredPage[]; links: FoundLink[]; terms: PrivacyTerm[] };

export type ExploreMessage =
  | { type: "lotse:explore-status" }
  | { type: "lotse:explore-start" }
  | { type: "lotse:explore-stop" } // side panel button or the in-page banner
  | { type: "lotse:explore-send" } // after a stop: evaluate what was recorded so far
  | { type: "lotse:explore-discard" }
  | FoundMessage
  | ScanRequest
  | { type: "lotse:explore-end" }; // worker → content script: hide the banner

export type ExploreReply = { ok: true; status?: ExploreStatus } | { ok: false; error: string };

/** Messages the service worker's explorer answers (everything else belongs to background.ts or other modules). */
export const EXPLORE_WORKER_TYPES = new Set<string>([
  "lotse:explore-status", "lotse:explore-start", "lotse:explore-stop", "lotse:explore-send", "lotse:explore-discard", "lotse:explore-found",
]);
