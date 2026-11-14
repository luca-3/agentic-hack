/**
 * Status orb + auto-activation (D-29): types, texts and storage keys shared by the service worker (`utils/activation.ts`),
 * the content script (`utils/orb/`) and the side panel. zod-free and tiny — it is bundled into every app page.
 */
import type { VoiceState } from "@lotse/shared";

export const ORB_HOST_ID = "lotse-orb-host";

/** chrome.storage.sync — the user's two switches. Missing = on. */
export const PRESENCE_KEY = "lotse:presence";
export type Presence = { autoActivate: boolean; orb: boolean };
export const DEFAULT_PRESENCE: Presence = { autoActivate: true, orb: true };
export function parsePresence(value: unknown): Presence {
  const v = (value && typeof value === "object" ? value : {}) as Record<string, unknown>;
  return { autoActivate: v.autoActivate !== false, orb: v.orb !== false };
}

/** chrome.storage.local — orb position per host (px from the right/bottom edge) and hosts where the user hid it. */
export const ORB_PLACES_KEY = "lotse:orb";
export type OrbPosition = { right: number; bottom: number };
export type OrbPlaces = { positions: Record<string, OrbPosition>; hidden: string[] };
export function parsePlaces(value: unknown): OrbPlaces {
  const v = (value && typeof value === "object" ? value : {}) as { positions?: unknown; hidden?: unknown };
  const positions: Record<string, OrbPosition> = {};
  if (v.positions && typeof v.positions === "object") {
    for (const [host, pos] of Object.entries(v.positions as Record<string, unknown>).slice(0, 100)) {
      const p = pos as Partial<OrbPosition> | null;
      if (p && Number.isFinite(p.right) && Number.isFinite(p.bottom)) positions[host] = { right: p.right!, bottom: p.bottom! };
    }
  }
  const hidden = Array.isArray(v.hidden) ? v.hidden.filter((h): h is string => typeof h === "string").slice(0, 100) : [];
  return { positions, hidden };
}

/** chrome.storage.session — manual pause (orb menu / side panel) survives page loads and worker restarts. */
export const ACTIVATION_KEY = "lotse:activation";
/** chrome.storage.local — hosts a policy marked as org app, so the orb can still say "not connected" there offline. */
export const APP_HOSTS_KEY = "lotse:app-hosts";

/** What the service worker knows about Valo in one tab. The orb adds voice and transient states on top. */
export type OrbBase = "offline" | "signed-out" | "blocked" | "paused" | "idle" | "active";
export type OrbMode = OrbBase | "listening" | "thinking" | "speaking" | "offer" | "error";
export type OrbStatus = {
  visible: boolean; // org app page (policy autoStart / remembered app host) or Valo records this tab
  base: OrbBase;
  detail: string; // reason / context line for the tooltip
  offer: string | null; // open proactive offer in this tab
  thinking: boolean; // explicit question in flight
  voice: VoiceState;
  voiceOn: boolean;
  signedIn: boolean;
  error: string | null; // recent error (a few seconds)
  autoActivate: boolean;
};

/** Answer to `lotse:activation` (side panel). */
export type ActivationInfo = { manualPause: boolean; autoActivate: boolean; appHosts: string[]; autoTab: number | null };

/** orb / side panel → service worker; answered by `utils/activation.ts`, not by background.ts's handler. */
export type ActivationRequest =
  | { type: "lotse:orb-status" }
  | { type: "lotse:open-panel" }
  | { type: "lotse:orb-pause"; paused: boolean }
  | { type: "lotse:activation" };

/** Display priority: voice > thinking > error > offer > base. */
export function orbMode(status: OrbStatus, localError: string | null): OrbMode {
  if (status.voice === "listening") return "listening";
  if (status.voice === "speaking") return "speaking";
  if (status.voice === "thinking" || status.thinking) return "thinking";
  if (localError || status.error) return "error";
  if (status.offer && status.base === "active") return "offer";
  return status.base;
}

export const ORB_TITLE: Record<OrbMode, string> = {
  active: "Valo is active",
  idle: "Valo is ready",
  paused: "Valo is paused",
  blocked: "Valo is paused on this page",
  offline: "Valo is not connected",
  "signed-out": "Not signed in",
  listening: "Valo is listening …",
  thinking: "Valo is thinking …",
  speaking: "Valo is speaking",
  offer: "Valo has a suggestion",
  error: "That didn't work",
};
