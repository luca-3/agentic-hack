/**
 * @lotse/shared — the ONE contract between extension, server and dashboard.
 * Change a schema here and all apps see it (typecheck catches mismatches).
 * Zod schemas validate at the boundaries (API routes, extension). Owner: runtime/server — propose changes, don't drift.
 *
 * Staged proactive pipeline (D-23): /state → /intent → /decide → (only if intervene) /ask with screenshots.
 * Explicit question (text / voice / wake word): /ask directly. Server guide: apps/server/RUNTIME.md.
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
  route: z.string(), // location.pathname (+ hash route); never the query string (may contain entered data)
  rect: z.object({ x: z.number(), y: z.number(), width: z.number(), height: z.number() }).optional(),
  disabled: z.boolean().optional(),
});
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;

/** Snapshot of the current page as seen by the extension (≤ 120 elements today). Server caps it (300 elements, 80-char labels). */
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

// ---------------------------------------------------------------------------
// Staged observability pipeline (D-23). Screenshots stay local until /ask.
// ---------------------------------------------------------------------------

/** Timestamped states and frames stay in a bounded local buffer (extension) until a positive decision or a question. */
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
/** POST /api/lotse/state response. snapshotId/capturedAt echo the request snapshot; summary/action come from Gemini. */
export const UIStateInferenceSchema = z.object({
  snapshotId: z.string().min(1),
  capturedAt: z.number(),
  summary: z.string().max(1_200),
  action: z.string().max(500).optional(),
});
export type UIStateInference = z.infer<typeof UIStateInferenceSchema>;
/** POST /api/lotse/state — events/DOM only; screenshots are deliberately absent from the state-inference request. */
export const UIStateRequestSchema = z.object({
  snapshot: ObservationSnapshotSchema,
  events: z.array(LotseEventSchema).max(180),
});
export type UIStateRequest = z.infer<typeof UIStateRequestSchema>;
/** Bounded local history: workflow events, current + ≤ 12 earlier DOM states, ≤ 4 frames (only for /ask), inferred states. */
export const ObservationContextSchema = z.object({
  workflow: ObservedWorkflowSchema,
  snapshot: ObservationSnapshotSchema,
  history: z.array(ObservationSnapshotSchema).max(12),
  screenshots: z.array(ScreenshotFrameSchema).max(4),
  states: z.array(UIStateInferenceSchema).max(40).optional(),
});
export type ObservationContext = z.infer<typeof ObservationContextSchema>;
/** Local rule annotation inside the extension. On the wire it is sent as a StuckTrigger (see DecideRequestSchema). */
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
/** POST /api/lotse/intent response. */
export const WorkflowIntentSchema = z.object({
  workflowName: z.string().max(200),
  intent: InferredIntentSchema,
});
export type WorkflowIntent = z.infer<typeof WorkflowIntentSchema>;
/** POST /api/lotse/intent — inferred UI-state sequence (context.states) + app context → WorkflowIntent. No images. */
export const IntentRequestSchema = z.object({
  context: ObservationContextSchema.extend({ states: z.array(UIStateInferenceSchema).min(1).max(40), screenshots: z.array(ScreenshotFrameSchema).max(0) }),
  role: z.string().max(100).optional(),
  appId: z.string().max(100).optional(),
  appKnowledge: z.string().max(12_000).optional(), // client notes; the server treats them as untrusted and caps them
});
export type IntentRequest = z.infer<typeof IntentRequestSchema>;

/** POST /api/lotse/events — batched analytics ingest (extension pre-filters + batches; max 100 per call). → 202 */
export const EventBatchSchema = z.object({
  appId: z.string().optional(),
  events: z.array(LotseEventSchema).max(100),
});
export type EventBatch = z.infer<typeof EventBatchSchema>;

// ---------------------------------------------------------------------------
// Proactive help: intervention decision (after /state + /intent) + adaptive threshold
// ---------------------------------------------------------------------------

/**
 * Wire name of the local rule that annotated the sequence, or `workflow_update` when no rule fired (D-23: rules annotate,
 * they never gate the state/intent calls). Extension rule → trigger: unsuccessful_searches → repeated_search,
 * route_ping_pong → page_pingpong, repeated_error / form_idle unchanged.
 */
export const StuckTriggerSchema = z.enum(["repeated_search", "page_pingpong", "form_idle", "repeated_error", "rage_click", "workflow_update"]);
export type StuckTrigger = z.infer<typeof StuckTriggerSchema>;

/** POST /api/lotse/decide — "should Lotse offer help now?" (Gemini Decisions API, lite-model fallback). No images. */
export const DecideRequestSchema = z.object({
  trigger: StuckTriggerSchema,
  triggerReason: z.string().max(500).optional(), // the local rule's reason text (StuckSignal.reason), if any
  events: z.array(LotseEventSchema).max(50), // recent window, oldest first
  snapshot: PageSnapshotSchema.optional(),
  role: z.string().max(100).optional(),
  appId: z.string().max(100).optional(),
  context: ObservationContextSchema.extend({ screenshots: z.array(ScreenshotFrameSchema).max(0) }).optional(), // incl. states
  inference: WorkflowIntentSchema.optional(), // result of /intent
  appKnowledge: z.string().max(12_000).optional(), // untrusted client notes
});
export type DecideRequest = z.infer<typeof DecideRequestSchema>;

/** Final decision: intervene = model says yes AND confidence ≥ the user's threshold (server-side, D-22). */
export const DecideResponseSchema = z.object({
  intervene: z.boolean(),
  confidence: z.number().min(0).max(1), // calibrated P(user needs help now), Decisions API
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

/**
 * POST /api/lotse/ask — response is `application/x-ndjson`: one GuidanceEvent per line, flushed as soon as known
 * (legacy JSON AskResponse without that Accept header). Used after a positive /decide (source "proactive", question =
 * inferred goal) and directly for explicit questions (text / voice). The only call that carries screenshots.
 */
export const AskRequestSchema = z.object({
  question: z.string().min(1).max(500),
  source: z.enum(["text", "voice", "proactive"]).default("text"),
  snapshot: PageSnapshotSchema, // current state; its id is echoed (tier event / legacy snapshotId)
  role: z.string().max(100).optional(), // demo role; an org member's real role comes from the dashboard
  appId: z.string().max(100).optional(),
  recentEvents: z.array(LotseEventSchema).max(50).optional(),
  observation: ObservationContextSchema.optional(), // history, inferred states, ≤ 4 frames → Gemini image parts
  intent: InferredIntentSchema.optional(), // from /intent, if known
  appKnowledge: z.string().max(12_000).optional(), // untrusted client notes
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
  /** Which tier/model the orchestrator picked (for status UI + debugging). Always first; snapshotId echoes AskRequest.snapshot.id. */
  z.object({ type: z.literal("tier"), tier: TierSchema, model: z.string(), snapshotId: z.string().optional() }),
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

/** Legacy JSON /ask response (no `Accept: application/x-ndjson`). Still served; prefer the GuidanceEvent stream. */
export const AskResponseSchema = z.object({
  elementNumber: z.number().int().nullable(),
  sentence: z.string(),
  snapshotId: z.string().optional(), // echo of AskRequest.snapshot.id
});
/** @deprecated */
export type AskResponse = z.infer<typeof AskResponseSchema>;

// ---------------------------------------------------------------------------
// Voice (D-16): wake word / hotkey → transcription → lotse:wake-question → /ask (source "voice") → optional short TTS
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
// User settings (chrome.storage.sync key `lotse:settings`) — planned toggles; not wired yet.
// The side panel's current demo settings (screenshots, role, appKnowledge) travel in the `lotse:settings` message.
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
  | { type: "lotse:wake-question"; question: string } // voice → background: transcribed question, same explicit-question path (source "voice")
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

/* ── Pseudonymization (D-26) ────────────────────────────────────────────────────────────────────
 * The extension replaces personal data with stable per-session placeholders before anything leaves the browser.
 * Server and model treat them as opaque ids. Mapping placeholder ↔ real value stays in the browser.
 */
export const PSEUDONYM_KINDS = ["Kunde", "Person", "Firma", "Adresse", "IBAN", "E-Mail", "Telefon", "Wert"] as const;
export type PseudonymKind = (typeof PSEUDONYM_KINDS)[number];
/** e.g. "[Kunde-1]", "[IBAN-2]" */
export const PSEUDONYM_TOKEN = /\[(Kunde|Person|Firma|Adresse|IBAN|E-Mail|Telefon|Wert)-\d{1,4}\]/g;
export const pseudonym = (kind: PseudonymKind, n: number) => `[${kind}-${n}]`;

/* ── Exploration (D-25): admin-started crawl of an app → page map → suggestions ────────────────── */
export const EXPLORE_LIMITS = { maxPages: 60, maxElementsPerPage: 150, maxDurationMs: 180_000 } as const;
/** Labels the explorer must never click (case-insensitive substring). Also never click danger-styled buttons or submit forms. */
export const EXPLORE_NEVER_CLICK = [
  "löschen", "entfernen", "delete", "remove", "senden", "send", "speichern", "save", "abgeben", "submit",
  "bestätigen", "confirm", "bezahlen", "zahlen", "pay", "abmelden", "logout", "archivieren", "freigeben", "übernehmen",
] as const;

/** Style metrics the extension measures per element (computed style) — input for the design rules. */
export const ElementStyleSchema = z.object({
  contrast: z.number().optional(), // WCAG contrast ratio text vs. background
  fontSize: z.number().optional(), // px
  width: z.number().optional(), // px (hit area)
  height: z.number().optional(),
  iconOnly: z.boolean().optional(), // no visible text, label only from aria/title (or none)
});
export type ElementStyle = z.infer<typeof ElementStyleSchema>;

export const ExploredElementSchema = InteractiveElementSchema.extend({ style: ElementStyleSchema.optional() });
export type ExploredElement = z.infer<typeof ExploredElementSchema>;

export const ExploredPageSchema = z.object({
  route: z.string(), // pathname (+ hash route), never the query string
  title: z.string(),
  reachedVia: z.array(z.string()), // UI labels clicked from the start page, in order (= click path)
  kind: z.enum(["page", "dialog", "menu", "tab"]).default("page"),
  elements: z.array(ExploredElementSchema).max(EXPLORE_LIMITS.maxElementsPerPage),
  headings: z.array(z.string()).max(30).default([]), // pseudonymized
});
export type ExploredPage = z.infer<typeof ExploredPageSchema>;

/** POST /api/lotse/explore — caller must be org admin of the app. Auth: Bearer Supabase access token. */
export const ExploreRequestSchema = z.object({
  appHost: z.string().min(1).max(200), // e.g. "localhost:4000" (matches apps.domains)
  pages: z.array(ExploredPageSchema).min(1).max(EXPLORE_LIMITS.maxPages),
  durationMs: z.number().int().nonnegative().optional(),
});
export type ExploreRequest = z.infer<typeof ExploreRequestSchema>;
export const ExploreResponseSchema = z.object({
  features: z.number().int(), // feature suggestions created/updated
  findings: z.number().int(), // design findings created/updated
});
export type ExploreResponse = z.infer<typeof ExploreResponseSchema>;

/* ── Suggestions (D-25): what exploration and continuous learning propose; admin accepts or dismisses ── */
export const SUGGESTION_KINDS = ["feature", "design", "stale_feature", "agent_error", "knowledge_gap"] as const;
export type SuggestionKind = (typeof SUGGESTION_KINDS)[number];

export const DesignFindingSchema = z.object({
  rule: z.enum(["contrast", "target_size", "unlabeled_icon", "duplicate_label", "deep_path", "overloaded", "dead_end", "other"]),
  route: z.string(),
  elementLabel: z.string().optional(),
  severity: z.enum(["low", "medium", "high"]),
  measured: z.string().optional(), // e.g. "2,1:1", "28 × 28 px", "6 Klicks"
});
export type DesignFinding = z.infer<typeof DesignFindingSchema>;

/** payload by kind: feature → Feature · design → DesignFinding · stale_feature → { feature: string, missingLabel: string }
 *  agent_error → { route?: string, status: string, lastError?: string } · knowledge_gap → { topic: string, draft?: string } */
export const SuggestionSchema = z.object({
  id: z.number().int(),
  kind: z.enum(SUGGESTION_KINDS),
  source: z.enum(["explore", "learn"]),
  appId: z.string().nullable(),
  title: z.string(),
  detail: z.string(),
  payload: z.record(z.string(), z.unknown()),
  occurrences: z.number().int(),
  persons: z.number().int(),
  status: z.enum(["open", "accepted", "dismissed"]),
});
export type Suggestion = z.infer<typeof SuggestionSchema>;

/** POST /api/lotse/learn — run the detectors for the caller's org (admin). Auth: Bearer Supabase access token. */
export const LearnRequestSchema = z.object({ appId: z.string().uuid().optional() });
export type LearnRequest = z.infer<typeof LearnRequestSchema>;
export const LearnResponseSchema = z.object({
  suggestions: z.number().int(), // created or updated
  insights: z.number().int(), // insight rows written
  drafts: z.number().int(), // Gemini drafts generated (≤ 10 per run)
});
export type LearnResponse = z.infer<typeof LearnResponseSchema>;

/* ── App policy + extension login (D-05 login, D-12 privacy, D-27) ─────────────────────────────── */

/**
 * GET /api/lotse/policy?app=<host> — may Lotse run in this app, and where must it stay silent?
 * On a location matching `blockedRoutes` the extension observes, snapshots, screenshots and sends NOTHING
 * (CORPUS vehicle/fleet pages hold real fleet data). No policy (server down, error) = paused (fail closed).
 * Send the usual headers; with `Authorization: Bearer` the response carries the caller's org role.
 */
export const PolicyResponseSchema = z.object({
  app: z.string().max(200), // normalized host the policy is for, e.g. "localhost:3100"
  allowed: z.boolean(), // false = Lotse stays completely off in this app
  known: z.boolean(), // host is registered as an app of an org (dashboard apps.domains)
  blockedRoutes: z.array(z.string().max(200)).max(50), // patterns for routeBlocked()
  appName: z.string().nullable(),
  orgName: z.string().nullable(),
  signedIn: z.boolean(), // request carried a valid Supabase token
  member: z.boolean(), // signed-in user is a member of the app's org
  role: z.string().nullable(), // org_members.role (null = anonymous / not a member)
  reason: z.string().max(200).optional(), // why allowed=false, for the side panel
  ttlSec: z.number().int().min(10).max(3_600), // client cache lifetime
  // D-29 auto-activation: true = this host is an app of the caller's org (or, in dev, an app the runtime knows) →
  // the extension starts observing by itself, no "Start" click. Missing (older server) = allowed && known.
  autoStart: z.boolean().optional(),
  // Signed in: the domains of all apps of the caller's orgs (dashboard apps.domains), e.g. for the side panel.
  appDomains: z.array(z.string().max(200)).max(50).optional(),
});
export type PolicyResponse = z.infer<typeof PolicyResponseSchema>;

/** GET /api/lotse/auth-config — public values for the extension's Supabase email/password login (never the secret key). */
export const AuthConfigResponseSchema = z.object({
  supabaseUrl: z.string().url(),
  publishableKey: z.string().min(1),
});
export type AuthConfigResponse = z.infer<typeof AuthConfigResponseSchema>;

/** Pattern match for `blockedRoutes` (zod-free module, also importable as `@lotse/shared/route`). */
export { routeBlocked } from "./route";
