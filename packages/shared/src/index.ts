/**
 * @lotse/shared — the contract between extension, server and dashboard.
 * Change a schema here and all three apps see it (typecheck catches mismatches).
 * Zod schemas are used for runtime validation at the boundaries (API routes, extension).
 */
import { z } from "zod";

/** Where the apps run locally. The extension talks to `serverUrl`. */
export const LOTSE_DEFAULTS = {
  serverUrl: "http://localhost:3001",
  dashboardUrl: "http://localhost:3000",
} as const;

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

/** Snapshot of the current page as seen by the extension. */
export const PageSnapshotSchema = z.object({
  id: z.string().optional(), // state identity; highlights must refer to this snapshot
  url: z.string(),
  title: z.string(),
  elements: z.array(InteractiveElementSchema),
  capturedAt: z.number(), // Date.now()
  messages: z.array(z.string().max(160)).max(20).optional(), // visible UI status/error labels
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

/** Observation event from the extension (privacy-filtered: no input values). */
export const LotseEventSchema = z.object({
  id: z.string().optional(),
  snapshotId: z.string().optional(),
  type: z.enum(["click", "route", "search", "error", "idle", "focus", "submit", "empty_results", "dom_change"]),
  route: z.string(),
  elementRole: z.string().optional(),
  elementLabel: z.string().optional(),
  detail: z.string().optional(), // e.g. search term length, error text of the UI
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
export const ObservationContextSchema = z.object({
  workflow: ObservedWorkflowSchema,
  snapshot: ObservationSnapshotSchema,
  history: z.array(ObservationSnapshotSchema).max(12),
  screenshots: z.array(ScreenshotFrameSchema).max(4),
});
export type ObservationContext = z.infer<typeof ObservationContextSchema>;
export const StuckSignalSchema = z.object({
  type: z.enum(["repeated_error", "unsuccessful_searches", "route_ping_pong", "form_idle"]),
  reason: z.string().max(500),
});
export type StuckSignal = z.infer<typeof StuckSignalSchema>;
export const InferredIntentSchema = z.object({
  goal: z.string().max(500),
  confidence: z.number().min(0).max(1), // model estimate, not a calibrated probability
  evidence: z.array(z.string().max(200)).max(8),
});
export type InferredIntent = z.infer<typeof InferredIntentSchema>;

/** POST /api/lotse/decide — Gemini interprets the workflow and decides whether to offer help. */
export const DecisionRequestSchema = z.object({
  context: ObservationContextSchema,
  trigger: StuckSignalSchema,
  role: z.string().max(100).optional(),
  appId: z.string().max(100).optional(),
  appKnowledge: z.string().max(12_000).optional(),
});
export type DecisionRequest = z.infer<typeof DecisionRequestSchema>;
export const DecisionResponseSchema = z.object({
  workflowName: z.string().max(200),
  intent: InferredIntentSchema,
  intervene: z.boolean(),
  reason: z.string().max(500),
});
export type DecisionResponse = z.infer<typeof DecisionResponseSchema>;

/** POST /api/lotse/ask — user question + current page → which element to show. */
export const AskRequestSchema = z.object({
  question: z.string().min(1),
  snapshot: PageSnapshotSchema,
  role: z.string().optional(), // user's role in the org (from dashboard/login)
  appId: z.string().optional(),
  recentEvents: z.array(LotseEventSchema).optional(),
  observation: ObservationContextSchema.optional(),
  intent: InferredIntentSchema.optional(),
  appKnowledge: z.string().max(12_000).optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

export const AskResponseSchema = z.object({
  elementNumber: z.number().int().nullable(), // null = nothing on this page fits
  sentence: z.string(), // one plain sentence in the user's language
  snapshotId: z.string().optional(),
});
export type AskResponse = z.infer<typeof AskResponseSchema>;

/** Messages between the extension's parts (background ⇄ content script ⇄ side panel). */
export type ExtensionMessage =
  | { type: "lotse:snapshot" }
  | { type: "lotse:highlight"; elementNumber: number; sentence: string; snapshotId?: string }
  | { type: "lotse:clear" }
  | { type: "lotse:ask"; question: string }
  | { type: "lotse:start" }
  | { type: "lotse:stop" }
  | { type: "lotse:status" }
  | { type: "lotse:observe"; event?: LotseEvent; snapshot?: ObservationSnapshot }
  | { type: "lotse:settings"; settings: { screenshots: boolean; role: string; appKnowledge: string } }
  | { type: "lotse:wake-question"; question: string }; // voice adapter uses the same explicit-question path

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
