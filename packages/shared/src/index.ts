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
  disabled: z.boolean().optional(),
});
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;

/** Snapshot of the current page as seen by the extension. Server caps it (e.g. 300 elements). */
export const PageSnapshotSchema = z.object({
  id: z.string().optional(), // state identity; highlights must refer to this snapshot
  url: z.string(),
  title: z.string(),
  elements: z.array(InteractiveElementSchema),
  capturedAt: z.number(), // Date.now()
  messages: z.array(z.string().max(160)).max(20).optional(), // visible UI status/error labels
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

/** Semantic, privacy-filtered event (no input values, no free text typed by the user except search-term *length*). */
export const LotseEventSchema = z.object({
  id: z.string().optional(),
  snapshotId: z.string().optional(),
  type: z.enum(["click", "route", "search", "error", "idle", "focus", "submit", "empty_results", "dom_change", "rage_click"]),
  route: z.string(),
  elementRole: z.string().optional(),
  elementLabel: z.string().optional(),
  detail: z.string().optional(), // e.g. "results=0", UI error text, "searchLength=4", "matchedFeature=<feature name>" (local match of the search term against the feature list — the term itself never leaves the browser)
  ts: z.number(), // Date.now()
});
export type LotseEvent = z.infer<typeof LotseEventSchema>;

/** Timestamped states and frames stay in a bounded local buffer until a trigger/question. */
export const ObservationSnapshotSchema = PageSnapshotSchema.extend({ id: z.string().min(1) });
export type ObservationSnapshot = z.infer<typeof ObservationSnapshotSchema>;
export const ScreenshotFrameSchema = z.object({
  snapshotId: z.string().min(1),
  capturedAt: z.number(),
  dataUrl: z.string().max(600_000).regex(/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/),
});
export type ScreenshotFrame = z.infer<typeof ScreenshotFrameSchema>;
export const ObservedWorkflowSchema = z.object({
  id: z.string().min(1),
  startedAt: z.number(),
  lastActivityAt: z.number(),
  routeSequence: z.array(z.string()).max(40),
  events: z.array(LotseEventSchema).max(180),
});
export type ObservedWorkflow = z.infer<typeof ObservedWorkflowSchema>;
export const UIStateInferenceSchema = z.object({
  snapshotId: z.string().min(1),
  capturedAt: z.number(),
  summary: z.string().max(1_200),
  action: z.string().max(500).optional(),
});
export type UIStateInference = z.infer<typeof UIStateInferenceSchema>;
/** Events/DOM only; screenshots are deliberately absent from the state-inference request. */
export const UIStateRequestSchema = z.object({
  snapshot: ObservationSnapshotSchema,
  events: z.array(LotseEventSchema).max(180),
});
export type UIStateRequest = z.infer<typeof UIStateRequestSchema>;
export const ObservationContextSchema = z.object({
  workflow: ObservedWorkflowSchema,
  snapshot: ObservationSnapshotSchema,
  history: z.array(ObservationSnapshotSchema).max(12),
  screenshots: z.array(ScreenshotFrameSchema).max(4),
  states: z.array(UIStateInferenceSchema).max(40).optional(),
});
export type ObservationContext = z.infer<typeof ObservationContextSchema>;
export const StuckSignalSchema = z.object({
  type: z.enum(["repeated_error", "unsuccessful_searches", "route_ping_pong", "form_idle", "workflow_update"]),
  reason: z.string().max(500),
});
export type StuckSignal = z.infer<typeof StuckSignalSchema>;
export const InferredIntentSchema = z.object({
  goal: z.string().max(500),
  confidence: z.number().min(0).max(1), // model estimate, not a calibrated probability
  evidence: z.array(z.string().max(200)).max(8),
});
export type InferredIntent = z.infer<typeof InferredIntentSchema>;
export const WorkflowIntentSchema = z.object({
  workflowName: z.string().max(200),
  intent: InferredIntentSchema,
});
export type WorkflowIntent = z.infer<typeof WorkflowIntentSchema>;
export const IntentRequestSchema = z.object({
  context: ObservationContextSchema.extend({ states: z.array(UIStateInferenceSchema).min(1).max(40), screenshots: z.array(ScreenshotFrameSchema).max(0) }),
  role: z.string().max(100).optional(),
  appId: z.string().max(100).optional(),
  appKnowledge: z.string().max(12_000).optional(),
});
export type IntentRequest = z.infer<typeof IntentRequestSchema>;

/** POST /api/lotse/decide — Gemini interprets the workflow and decides whether to offer help. */
export const DecisionRequestSchema = z.object({
  context: ObservationContextSchema.extend({ screenshots: z.array(ScreenshotFrameSchema).max(0) }),
  trigger: StuckSignalSchema,
  inference: WorkflowIntentSchema.optional(),
  role: z.string().max(100).optional(),
  appId: z.string().max(100).optional(),
  appKnowledge: z.string().max(12_000).optional(),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;
export const DecisionResponseSchema = z.object({
  workflowName: z.string().max(200).optional(),
  intent: InferredIntentSchema.optional(),
  intervene: z.boolean(),
  reason: z.string().max(500),
});
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

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
export const StuckTriggerSchema = z.enum(["repeated_search", "page_pingpong", "form_idle", "repeated_error", "rage_click", "workflow_update"]);
export type StuckTrigger = z.infer<typeof StuckTriggerSchema>;

/** POST /api/lotse/decide — "should Lotse offer help now?" (cheap lite model). */
export const DecideRequestSchema = z.object({
  trigger: StuckTriggerSchema,
  events: z.array(LotseEventSchema).max(50), // recent window, oldest first
  snapshot: PageSnapshotSchema.optional(),
  role: z.string().optional(),
  appId: z.string().optional(),
  context: ObservationContextSchema.extend({ screenshots: z.array(ScreenshotFrameSchema).max(0) }).optional(),
  inference: WorkflowIntentSchema.optional(),
  appKnowledge: z.string().max(12_000).optional(),
});
export type DecideRequest = z.infer<typeof DecideRequestSchema>;

export const DecideResponseSchema = z.object({
  intervene: z.boolean(),
  confidence: z.number().min(0).max(1),
  intent: z.string().optional(), // what the user probably wants, e.g. "IBAN eines Kunden ändern" → becomes the question for /ask
  offer: z.string().max(140).optional(), // short offer text, e.g. "Soll ich dir zeigen, wie du die IBAN änderst?"
  offerId: z.string().optional(), // set when intervene=true; echo it in OfferFeedback
  threshold: z.number().min(0).max(1).optional(), // the user's current proactive threshold that was applied
});
export type DecideResponse = z.infer<typeof DecideResponseSchema>;

/**
 * Adaptive proactivity (D-22): intervene only if decision = yes AND confidence ≥ the user's threshold.
 * Threshold starts at PROACTIVE_THRESHOLD.initial and learns from feedback on offers (per pseudonymous user).
 */
export const PROACTIVE_THRESHOLD = {
  initial: 0.8,
  min: 0.6,
  max: 0.95,
  onThumbsDown: +0.05, // offer was annoying/unhelpful → fewer offers
  onThumbsUp: -0.02, // offer helped → slightly more offers
  onDeclined: +0.02, // user clicked "Nein" on the offer
} as const;

/** POST /api/lotse/feedback — thumbs up/down on a proactive offer (or "declined" when the user said no). → ProactivePrefs */
export const OfferFeedbackRequestSchema = z.object({
  offerId: z.string(),
  feedback: z.enum(["up", "down", "declined"]),
});
export type OfferFeedbackRequest = z.infer<typeof OfferFeedbackRequestSchema>;

/** GET/PUT /api/lotse/prefs — the user's proactive threshold (PUT = manual override, clamped to min/max). */
export const ProactivePrefsSchema = z.object({
  proactiveThreshold: z.number().min(0).max(1),
});
export type ProactivePrefs = z.infer<typeof ProactivePrefsSchema>;

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
  observation: ObservationContextSchema.optional(),
  intent: InferredIntentSchema.optional(),
  appKnowledge: z.string().max(12_000).optional(),
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
    code: z.enum(["bad_request", "unauthorized", "rate_limited", "budget_exceeded", "timeout", "disabled", "internal"]),
    message: z.string(),
  }),
]);
export type GuidanceEvent = z.infer<typeof GuidanceEventSchema>;

/** @deprecated walking-skeleton response — replaced by the GuidanceEvent stream. */
export const AskResponseSchema = z.object({
  elementNumber: z.number().int().nullable(),
  sentence: z.string(),
  snapshotId: z.string().optional(),
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
  | { type: "lotse:highlight"; elementNumber: number; sentence: string; snapshotId?: string }
  | { type: "lotse:start" }
  | { type: "lotse:stop" }
  | { type: "lotse:status" }
  | { type: "lotse:observe"; event?: LotseEvent; snapshot?: ObservationSnapshot }
  | { type: "lotse:settings"; settings: { screenshots: boolean; role: string; appKnowledge: string } }
  | { type: "lotse:wake-question"; question: string } // voice adapter uses the same explicit-question path
  | { type: "lotse:guide"; event: GuidanceEvent }
  | { type: "lotse:offer"; decision: DecideResponse }
  | { type: "lotse:clear" }
  | { type: "lotse:voice-state"; state: VoiceState }
  // content → background
  | { type: "lotse:stuck"; trigger: StuckTrigger; events: LotseEvent[] }
  | { type: "lotse:events"; events: LotseEvent[] }
  | { type: "lotse:accept-offer"; intent: string }
  | { type: "lotse:offer-feedback"; offerId: string; feedback: "up" | "down" | "declined" }
  // side panel / voice → background
  | { type: "lotse:ask"; question: string; source?: "text" | "voice" | "proactive" };

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

/* ── Knowledge base (dashboard uploads, server embeds + searches) ───────────────────────────────
 * Auth for both endpoints: header `Authorization: Bearer <Supabase access token of the signed-in user>`.
 * Ingest: caller must be admin of the source's org. Search: caller must be a member of the org.
 */
export const KNOWLEDGE_LIMITS = { maxChunks: 200, maxChunkChars: 2000, maxQueryChars: 500 } as const;

/** POST /api/knowledge/ingest — embed the chunks of an existing knowledge_sources row. */
export const KnowledgeIngestRequestSchema = z.object({
  sourceId: z.string().uuid(),
  chunks: z.array(z.string().min(1).max(KNOWLEDGE_LIMITS.maxChunkChars)).min(1).max(KNOWLEDGE_LIMITS.maxChunks),
});
export type KnowledgeIngestRequest = z.infer<typeof KnowledgeIngestRequestSchema>;
export const KnowledgeIngestResponseSchema = z.object({ inserted: z.number().int() });
export type KnowledgeIngestResponse = z.infer<typeof KnowledgeIngestResponseSchema>;

/** POST /api/knowledge/search — semantic search in the caller's org (optionally one app). */
export const KnowledgeSearchRequestSchema = z.object({
  query: z.string().min(1).max(KNOWLEDGE_LIMITS.maxQueryChars),
  appId: z.string().uuid().optional(),
  limit: z.number().int().min(1).max(10).optional(),
});
export type KnowledgeSearchRequest = z.infer<typeof KnowledgeSearchRequestSchema>;
export const KnowledgeHitSchema = z.object({
  id: z.number().int(),
  content: z.string(),
  sourceId: z.string().nullable(),
  similarity: z.number(),
});
export type KnowledgeHit = z.infer<typeof KnowledgeHitSchema>;
export const KnowledgeSearchResponseSchema = z.object({ hits: z.array(KnowledgeHitSchema) });
export type KnowledgeSearchResponse = z.infer<typeof KnowledgeSearchResponseSchema>;
