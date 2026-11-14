/**
 * @lotse/shared — the contract between extension, server and dashboard.
 * Change a schema here and all apps see it (typecheck catches mismatches).
 * Zod schemas validate at the boundaries (API routes, extension). Owner: orchestrator — propose changes, don't drift.
 */
import { z } from "zod";

/** Where the apps run locally. The extension talks to `serverUrl`. */
export const LOTSE_DEFAULTS = {
  serverUrl: "http://localhost:3001",
  dashboardUrl: "http://localhost:3000",
} as const;

/** HTTP headers the extension sends with every runtime call. Auth: `Authorization: Bearer <token>` (see server docs). */
export const LOTSE_HEADERS = {
  session: "x-lotse-session", // random id per browser session (pseudonymous)
  app: "x-lotse-app", // app id / hostname the user is in
} as const;

// ---------------------------------------------------------------------------
// Observation (extension → server)
// ---------------------------------------------------------------------------

/** One interactive element on the page, numbered by the extension. Labels only — never input values. */
export const InteractiveElementSchema = z.object({
  number: z.number().int().nonnegative(),
  role: z.string(), // "button", "link", "textbox", "tab", …
  label: z.string(), // accessible name (aria-label, <label>, visible text)
  route: z.string(), // location.pathname + search
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
});
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;

/** Snapshot of the current page as seen by the extension. Server caps it (e.g. 300 elements). */
export const PageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  elements: z.array(InteractiveElementSchema),
  capturedAt: z.number(), // Date.now()
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

/** Semantic, privacy-filtered event (no input values, no free text typed by the user except search-term *length*). */
export const LotseEventSchema = z.object({
  type: z.enum(["click", "route", "search", "error", "idle", "focus", "rage_click"]),
  route: z.string(),
  elementRole: z.string().optional(),
  elementLabel: z.string().optional(),
  detail: z.string().optional(), // e.g. "results=0", UI error text, "searchLength=4"
  ts: z.number(), // Date.now()
});
export type LotseEvent = z.infer<typeof LotseEventSchema>;

/** POST /api/lotse/events — batched analytics ingest (extension pre-filters + batches; max 100 per call). → 202 */
export const EventBatchSchema = z.object({
  appId: z.string().optional(),
  events: z.array(LotseEventSchema).max(100),
});
export type EventBatch = z.infer<typeof EventBatchSchema>;

// ---------------------------------------------------------------------------
// Proactive help (extension rules → server decision)
// ---------------------------------------------------------------------------

/** Local rule in the extension that fired. Only then the server is asked. */
export const StuckTriggerSchema = z.enum(["repeated_search", "page_pingpong", "form_idle", "repeated_error", "rage_click"]);
export type StuckTrigger = z.infer<typeof StuckTriggerSchema>;

/** POST /api/lotse/decide — "should Lotse offer help now?" (cheap lite model). */
export const DecideRequestSchema = z.object({
  trigger: StuckTriggerSchema,
  events: z.array(LotseEventSchema).max(50), // recent window, oldest first
  snapshot: PageSnapshotSchema.optional(),
  role: z.string().optional(),
  appId: z.string().optional(),
});
export type DecideRequest = z.infer<typeof DecideRequestSchema>;

export const DecideResponseSchema = z.object({
  intervene: z.boolean(),
  confidence: z.number().min(0).max(1),
  intent: z.string().optional(), // what the user probably wants, e.g. "IBAN eines Kunden ändern" → becomes the question for /ask
  offer: z.string().max(140).optional(), // short offer text, e.g. "Soll ich dir zeigen, wie du die IBAN änderst?"
});
export type DecideResponse = z.infer<typeof DecideResponseSchema>;

// ---------------------------------------------------------------------------
// Guidance (question → streamed guidance events)
// ---------------------------------------------------------------------------

/** Model tier chosen by the runtime's orchestrator. */
export const TierSchema = z.enum(["point", "guide", "reason"]);
export type Tier = z.infer<typeof TierSchema>;

/** POST /api/lotse/ask — response is `application/x-ndjson`: one GuidanceEvent per line, flushed as soon as known. */
export const AskRequestSchema = z.object({
  question: z.string().min(1).max(500),
  source: z.enum(["text", "voice", "proactive"]).default("text"),
  snapshot: PageSnapshotSchema,
  role: z.string().optional(), // user's role in the org (from dashboard/login)
  appId: z.string().optional(),
  recentEvents: z.array(LotseEventSchema).max(50).optional(),
});
export type AskRequest = z.input<typeof AskRequestSchema>;

export const GuidanceStepSchema = z.object({
  label: z.string(), // label of the element to use in this step (as in the snapshot / feature list click path)
  route: z.string().optional(), // page where this step happens, if known
  elementNumber: z.number().int().optional(), // only for steps on the CURRENT page
  hint: z.string().max(120).optional(), // very short on-screen text, e.g. "Hier die IBAN eintragen"
});
export type GuidanceStep = z.infer<typeof GuidanceStepSchema>;

export const UsageSchema = z.object({
  model: z.string(),
  inputTokens: z.number().optional(),
  outputTokens: z.number().optional(),
  totalTokens: z.number().optional(),
  latencyMs: z.number(),
});
export type Usage = z.infer<typeof UsageSchema>;

export const GuidanceEventSchema = z.discriminatedUnion("type", [
  /** Which tier/model the orchestrator picked (for status UI + debugging). */
  z.object({ type: z.literal("tier"), tier: TierSchema, model: z.string() }),
  /** Move the agent cursor to this element on the CURRENT page and highlight it — render immediately. */
  z.object({ type: z.literal("point"), elementNumber: z.number().int(), label: z.string(), hint: z.string().max(120).optional() }),
  /** Multi-step path (may span pages). The extension advances locally: after each click/navigation it finds the next step's label in a fresh snapshot — no extra server call. */
  z.object({ type: z.literal("plan"), steps: z.array(GuidanceStepSchema).min(1).max(10) }),
  /** Optional, SHORT spoken/written answer (≤ 2 sentences). Omitted when pointing alone answers the question. */
  z.object({ type: z.literal("say"), text: z.string().max(200) }),
  z.object({ type: z.literal("done"), usage: UsageSchema.optional() }),
  z.object({
    type: z.literal("error"),
    code: z.enum(["bad_request", "unauthorized", "rate_limited", "budget_exceeded", "timeout", "internal"]),
    message: z.string(),
  }),
]);
export type GuidanceEvent = z.infer<typeof GuidanceEventSchema>;

/** @deprecated walking-skeleton response — replaced by the GuidanceEvent stream. */
export const AskResponseSchema = z.object({
  elementNumber: z.number().int().nullable(),
  sentence: z.string(),
});
/** @deprecated */
export type AskResponse = z.infer<typeof AskResponseSchema>;

// ---------------------------------------------------------------------------
// Voice (D-16): wake word / hotkey → transcription → /ask (source "voice") → optional short TTS
// ---------------------------------------------------------------------------

/** POST /api/lotse/live-token — ephemeral Gemini Live token, locked to transcription config. The Gemini key never reaches the extension. */
export const LiveTokenResponseSchema = z.object({
  token: z.string(),
  model: z.string(),
  expiresAt: z.string(), // ISO timestamp
  wsUrl: z.string().optional(), // Gemini Live WebSocket endpoint to open with the token (see apps/server/VOICE.md)
});
export type LiveTokenResponse = z.infer<typeof LiveTokenResponseSchema>;

export const VoiceStateSchema = z.enum(["off", "idle", "listening", "thinking", "speaking"]);
export type VoiceState = z.infer<typeof VoiceStateSchema>;

// ---------------------------------------------------------------------------
// User settings (chrome.storage.sync key `lotse:settings`)
// ---------------------------------------------------------------------------

export const LOTSE_SETTINGS_KEY = "lotse:settings";
export const LotseSettingsSchema = z.object({
  proactive: z.boolean().default(true), // Lotse may offer help on its own
  voice: z.boolean().default(true), // wake word / hotkey listening
  speak: z.boolean().default(true), // spoken answers (still only when needed, ≤ 2 sentences)
});
export type LotseSettings = z.infer<typeof LotseSettingsSchema>;

// ---------------------------------------------------------------------------
// Messages between the extension's parts (background ⇄ content script ⇄ side panel ⇄ offscreen)
// ---------------------------------------------------------------------------

export type ExtensionMessage =
  // background → content
  | { type: "lotse:snapshot" }
  | { type: "lotse:guide"; event: GuidanceEvent }
  | { type: "lotse:offer"; decision: DecideResponse }
  | { type: "lotse:clear" }
  | { type: "lotse:voice-state"; state: VoiceState }
  // content → background
  | { type: "lotse:stuck"; trigger: StuckTrigger; events: LotseEvent[] }
  | { type: "lotse:events"; events: LotseEvent[] }
  | { type: "lotse:accept-offer"; intent: string }
  // side panel / voice → background
  | { type: "lotse:ask"; question: string; source?: "text" | "voice" | "proactive" }
  /** @deprecated walking-skeleton highlight (extension skeleton still uses it) — use `lotse:guide` with a `point` event. */
  | { type: "lotse:highlight"; elementNumber: number; sentence: string };

/**
 * One function of an app, as maintained in the dashboard (table app_features) and in
 * demo-crm/lotse-features.json. The server gives the relevant ones to the model.
 */
export const FeatureSchema = z.object({
  name: z.string().min(1), // "Bankverbindung (IBAN) eines Kunden ändern"
  description: z.string().default(""),
  route: z.string().min(1), // "/kunde.html"
  clickPath: z.array(z.string().min(1)).min(1), // UI labels in click order
  requiredRole: z.array(z.string()).nullish(), // null/absent = everyone
});
export type Feature = z.infer<typeof FeatureSchema>;
export const FeatureListSchema = z.array(FeatureSchema);
