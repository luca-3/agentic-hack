/**
 * Extension-internal messages and settings that are not part of the HTTP contract in `@lotse/shared`.
 * The shared `ExtensionMessage` union is reused where it fits (`lotse:clear`, `lotse:offer-feedback`,
 * `lotse:voice-state`, `lotse:wake-question`, …); these add plan control, offers and the unified settings.
 */
import type { ExtensionMessage, GuidanceStep, LotseSettings } from "@lotse/shared";

/** One settings object: the shared toggles (`chrome.storage.sync` key `lotse:settings`) plus the local demo context. */
export type ExtensionSettings = LotseSettings & { screenshots: boolean; role: string; appKnowledge: string };
export const DEFAULT_SETTINGS: ExtensionSettings = { proactive: true, voice: true, speak: true, screenshots: true, role: "", appKnowledge: "" };
/** Demo context (screenshots/role/knowledge) can exceed the sync item quota, so it lives in `chrome.storage.local`. */
export const DEMO_CONTEXT_KEY = "lotse:demo-context";

/** A multi-step plan as the content script renders it. `elementNumber`s are only valid for `snapshotId`. */
export type PlanView = { id: string; steps: GuidanceStep[]; index: number; snapshotId?: string; offerId?: string };
export type PlanCommand = "next" | "back" | "end";

/** What the content script needs of the app policy (GET /api/lotse/policy). null = unknown → paused (fail closed). */
export type PagePolicy = { allowed: boolean; blockedRoutes: string[] };

/** background → content script */
export type ContentCommand =
  | { type: "lotse:policy"; policy: PagePolicy | null }
  | { type: "lotse:point"; elementNumber: number; label: string; hint?: string; snapshotId: string; offerId?: string }
  | { type: "lotse:say"; text: string; offerId?: string }
  | { type: "lotse:plan-show"; plan: PlanView; resume?: boolean }
  | { type: "lotse:plan-control"; action: PlanCommand }
  | { type: "lotse:show-offer"; offerId: string; offer: string }
  | { type: "lotse:hide-offer" };

/** content script / side panel → background */
export type WorkerCommand =
  | { type: "lotse:plan-resume" }
  | { type: "lotse:plan-update"; planId: string; index: number }
  | { type: "lotse:plan-end"; planId: string; reason: "done" | "closed" }
  | { type: "lotse:plan-command"; action: PlanCommand }
  | { type: "lotse:offer-accept"; offerId: string }
  | { type: "lotse:update-settings"; settings: Partial<ExtensionSettings> }
  | { type: "lotse:prefs"; threshold?: number } // without threshold: GET, with: PUT (manual override)
  | { type: "lotse:snooze"; minutes: number } // 0 resumes proactive offers
  | { type: "lotse:listen" } // side-panel mic button → voice module startListening("button")
  | { type: "lotse:get-policy" } // content script asks for the policy of its own host
  | { type: "lotse:paused"; paused: boolean } // content script entered/left a blocked route (no page data)
  | { type: "lotse:login"; email: string; password: string } // side panel → Supabase email/password login
  | { type: "lotse:logout" };

export type LotseMessage = ExtensionMessage | ContentCommand | WorkerCommand;
