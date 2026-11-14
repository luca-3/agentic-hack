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
});
export type InteractiveElement = z.infer<typeof InteractiveElementSchema>;

/** Snapshot of the current page as seen by the extension. */
export const PageSnapshotSchema = z.object({
  url: z.string(),
  title: z.string(),
  elements: z.array(InteractiveElementSchema),
  capturedAt: z.number(), // Date.now()
});
export type PageSnapshot = z.infer<typeof PageSnapshotSchema>;

/** Observation event from the extension (privacy-filtered: no input values). */
export const LotseEventSchema = z.object({
  type: z.enum(["click", "route", "search", "error", "idle", "focus"]),
  route: z.string(),
  elementRole: z.string().optional(),
  elementLabel: z.string().optional(),
  detail: z.string().optional(), // e.g. search term length, error text of the UI
  ts: z.number(), // Date.now()
});
export type LotseEvent = z.infer<typeof LotseEventSchema>;

/** POST /api/lotse/ask — user question + current page → which element to show. */
export const AskRequestSchema = z.object({
  question: z.string().min(1),
  snapshot: PageSnapshotSchema,
  role: z.string().optional(), // user's role in the org (from dashboard/login)
  appId: z.string().optional(),
  recentEvents: z.array(LotseEventSchema).optional(),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

export const AskResponseSchema = z.object({
  elementNumber: z.number().int().nullable(), // null = nothing on this page fits
  sentence: z.string(), // one plain sentence in the user's language
});
export type AskResponse = z.infer<typeof AskResponseSchema>;

/** Messages between the extension's parts (background ⇄ content script ⇄ side panel). */
export type ExtensionMessage =
  | { type: "lotse:snapshot" }
  | { type: "lotse:highlight"; elementNumber: number; sentence: string }
  | { type: "lotse:clear" }
  | { type: "lotse:ask"; question: string };

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
