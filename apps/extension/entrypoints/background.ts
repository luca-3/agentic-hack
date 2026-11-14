import {
  AskRequestSchema, AskResponseSchema, DecideRequestSchema, DecideResponseSchema, EventBatchSchema,
  EXPLORE_LIMITS, ExploreRequestSchema, ExploreResponseSchema, GuidanceEventSchema,
  IntentRequestSchema, LOTSE_DEFAULTS, LOTSE_HEADERS, LOTSE_SETTINGS_KEY, LotseEventSchema, LotseSettingsSchema,
  ObservationSnapshotSchema, OfferFeedbackRequestSchema, PROACTIVE_THRESHOLD, PolicyResponseSchema, ProactivePrefsSchema, ScreenshotFrameSchema,
  UIStateInferenceSchema, UIStateRequestSchema, WorkflowIntentSchema,
  type AskResponse, type DecideResponse, type ExploredPage, type ExploreResponse, type GuidanceEvent, type InferredIntent,
  type LotseEvent, type ObservationContext, type ObservationSnapshot, type PolicyResponse, type VoiceState, type WorkflowIntent,
} from "@lotse/shared";
import { routeBlocked } from "@lotse/shared/route";
import type { ExploreStepResult } from "../utils/explore-dom";
import { ObservationBuffer, findStuckSignal } from "../utils/observation";
import { DEFAULT_SETTINGS, DEMO_CONTEXT_KEY, type ExtensionSettings, type LotseMessage, type PagePolicy, type PlanView } from "../utils/messages";
import * as auth from "../utils/auth";
import { PAUSED_TEXT, clearPolicies, hostOf, locationOf, pageVerdict, policyFor } from "../utils/policy";
import * as pseudo from "../utils/pseudonymize";
import { noteError, setupActivation } from "../utils/activation";
import * as voice from "../utils/voice";
import { setupVoice, speak, stopSpeaking } from "../utils/voice";

// Optional voice API (mic button); typed loosely so this file builds against every stage of the voice module.
const startListening = (voice as unknown as { startListening?: (trigger?: "button") => Promise<void> }).startListening;

type Source = "text" | "voice" | "proactive";
type RenderEvent = Extract<GuidanceEvent, { type: "point" | "plan" | "say" }>;
type PlanRecord = PlanView & { tabId: number; updatedAt: number };
type PendingOffer = { id: string; text: string; question: string; tabId: number; shownAt: number; intent?: InferredIntent };
type HelpContext = { tabId: number; snapshotId: string; source: Source; offerId?: string; cleared: boolean; warning?: string };
type Prefetch = { offerId: string; ctx: HelpContext; events: RenderEvent[]; live: boolean; done: boolean; failed: string | null; chain: Promise<void>; answer: AskResponse | null };
type SavedSession = {
  recording: boolean; recordingTab: number | null; buffer: unknown; decision: unknown; inference: unknown; sessionId: string;
  plan: unknown; snoozeUntil: number; lastDecisionAt: number; threshold: number | null; analytics: unknown;
};
export type ExploreStatus = {
  running: boolean;
  phase: "idle" | "crawling" | "analyzing" | "done" | "stopped" | "error";
  pageCount: number;
  maxPages: number;
  currentRoute: string;
  summary: string;
  result: ExploreResponse | null;
  startedAt: number | null;
  phaseStartedAt: number | null;
};
export type LotseStatus = {
  recording: boolean; tabId: number | null; busy: boolean; settings: ExtensionSettings;
  busyMode: "proactive" | "question" | null;
  eventCount: number; snapshotCount: number; screenshotCount: number; elementCount: number;
  workflowId: string | null; decision: DecideResponse | null; inference: WorkflowIntent | null; stateCount: number;
  message: string; screenshotMessage: string; events: LotseEvent[];
  offer: { offerId: string; text: string } | null;
  plan: { index: number; total: number; label: string; hint?: string } | null;
  threshold: number | null; prefsMessage: string; snoozedUntil: number | null;
  voiceState: VoiceState; lastQuestion: { text: string; source: Source } | null; analyticsQueued: number;
  account: { email: string; isAdmin: boolean } | null; page: PageStatus | null;
  explore: ExploreStatus;
};
/** Active tab as the side panel shows it: app/org/role from GET /api/lotse/policy and whether Lotse is paused there. */
export type PageStatus = {
  host: string; paused: boolean; reason: string; known: boolean;
  appName: string | null; orgName: string | null; role: string | null; signedIn: boolean; member: boolean;
};
export type LotseResult =
  | { ok: true; status: LotseStatus; answer?: AskResponse; plan?: PlanView | null; policy?: PagePolicy | null }
  | { ok: false; error: string };

const HANDLED = new Set<string>([
  "lotse:start", "lotse:stop", "lotse:status", "lotse:settings", "lotse:update-settings", "lotse:observe", "lotse:ask", "lotse:wake-question",
  "lotse:plan-resume", "lotse:plan-update", "lotse:plan-end", "lotse:plan-command", "lotse:offer-accept", "lotse:offer-feedback",
  "lotse:prefs", "lotse:snooze", "lotse:listen", "lotse:get-policy", "lotse:paused", "lotse:login", "lotse:logout",
  "lotse:explore-start", "lotse:explore-stop",
]);
const ANALYTICS_TYPES = new Set<LotseEvent["type"]>(["click", "route", "search", "error", "idle", "submit", "empty_results", "rage_click"]);
const OFFER_COOLDOWN_MS = 120_000; // D-20: at most one proactive offer per two minutes
const SNOOZE_MS = 10 * 60_000; // "Nein" → ten minutes of quiet
const OFFER_TTL_MS = 75_000;
const PLAN_TTL_MS = 30 * 60_000;

const buffer = new ObservationBuffer();
let settings: ExtensionSettings = { ...DEFAULT_SETTINGS };
let recording = false;
let recordingTab: number | null = null;
let busy = false;
let decision: DecideResponse | null = null;
let inference: WorkflowIntent | null = null;
let sessionId: string = crypto.randomUUID();
let inferencePending = false;
let inferenceTimer: ReturnType<typeof setTimeout> | undefined;
let lastInferenceKey = "";
let busyOwner = 0;
let busyMode: "proactive" | "question" | null = null;
let message = "Bereit. Öffne deine App und starte die Beobachtung.";
let screenshotMessage = "";
let lastCaptureAt = 0;
let capturing = false;
let lastDecisionAt = 0;
let generation = 0;
let requestController: AbortController | null = null;
let persistenceTimer: ReturnType<typeof setTimeout> | undefined;
let plan: PlanRecord | null = null;
let pendingOffer: PendingOffer | null = null;
let prefetch: Prefetch | null = null;
let snoozeUntil = 0;
let threshold: number | null = null;
let prefsMessage = "";
let voiceState: VoiceState = "off";
let lastQuestion: { text: string; source: Source } | null = null;
let analytics: LotseEvent[] = [];
let lastFlushAt = Date.now();
let flushing = false;
let lastAppHost = "";
let account: { email: string; isAdmin: boolean } | null = null;
let page: PageStatus | null = null;
let exploreRunning = false;
let exploreAborted = false;
let exploreTabId: number | null = null;
let exploreController: AbortController | null = null;
let exploreStatus: ExploreStatus = {
  running: false, phase: "idle", pageCount: 0, maxPages: EXPLORE_LIMITS.maxPages, currentRoute: "", summary: "", result: null,
  startedAt: null, phaseStartedAt: null,
};
const feedbackGiven = new Set<string>();
const STORE = "lotse-observation-session";
const localUrl = (url?: string): boolean => {
  if (!url) return false;
  try { const u = new URL(url); return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname); }
  catch { return false; }
};

export default defineBackground(() => {
  const ready = restore();
  // Voice is input/output only (D-16): a transcript takes the same explicit-question path as typed text.
  // Registered synchronously so the voice listeners exist when Chrome wakes the worker.
  const voiceHandlers = {
    // Returning the request keeps the voice state on "thinking" until the answer arrives.
    onTranscript: (text: string) => ready.then(() => explicitQuestion(text.slice(0, 500), "voice")).catch((error: unknown) => { message = errorText(error); noteError(message); }),
    onState: (state: VoiceState) => { voiceState = state; void broadcastVoiceState(); },
    onError: (text: string) => { message = text; noteError(text); },
  };
  try { setupVoice(voiceHandlers); } catch { voiceState = "off"; }
  // D-29: auto-start on the org's app domains + the status orb's messages (utils/activation.ts).
  setupActivation({
    ready, start, stop, policy: pagePolicy,
    recording: () => ({ on: recording, tabId: recordingTab }),
    live: () => ({
      busy: busy && busyMode === "question", offerTab: pendingOffer?.tabId ?? null, offer: pendingOffer?.text ?? null,
      voice: voiceState, voiceOn: settings.voice, signedIn: account !== null,
    }),
  });
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  browser.runtime.onMessage.addListener((incoming: LotseMessage, sender, respond) => {
    // Leave messages of other modules (the voice offscreen document uses `target`) to their own listeners.
    if (!incoming || typeof incoming !== "object" || "target" in incoming || !HANDLED.has(incoming.type)) return false;
    ready.then(() => handle(incoming, sender.tab?.id, sender.tab?.url)).then(
      (result) => respond(result),
      (error: unknown) => respond({ ok: false, error: errorText(error) } satisfies LotseResult),
    );
    return true;
  });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync" || !changes[LOTSE_SETTINGS_KEY]) return;
    const toggles = LotseSettingsSchema.safeParse(changes[LOTSE_SETTINGS_KEY].newValue ?? {});
    if (toggles.success) settings = { ...settings, ...toggles.data };
  });
  browser.commands.onCommand.addListener((command) => {
    if (command === "lotse-ask") {
      browser.tabs.query({ active: true, lastFocusedWindow: true }).then(([tab]) => {
        if (tab) return browser.sidePanel.open({ windowId: tab.windowId });
      }).catch(() => undefined);
    }
  });
  browser.tabs.onUpdated.addListener((tabId, changes) => {
    if (tabId !== recordingTab || !recording) return;
    if (changes.url && !localUrl(changes.url)) { void ready.then(stop); return; }
    // Entering a blocked route (incl. SPA pushState/hash changes): drop whatever is in flight for this tab at once.
    if (changes.url) void ready.then(async () => { if (tabId === recordingTab && await blockedUrl(changes.url)) pauseForPolicy(); });
    if (changes.status === "complete") {
      void ready.then(async () => {
        if (recording && tabId === recordingTab) {
          // The content script needs to know it is recording even on a blocked page (it resumes by itself on an allowed route).
          await browser.tabs.sendMessage(tabId, { type: "lotse:start" } satisfies LotseMessage);
          if (await blockedUrl((await browser.tabs.get(tabId)).url)) { pauseForPolicy(); return; }
          buffer.record({ snapshot: await snapshotOf(tabId) });
          schedulePersistence();
        }
      }).catch(() => undefined);
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void ready.then(() => {
      if (exploreTabId === tabId && exploreRunning) void stopExplore();
      if (plan?.tabId === tabId) { plan = null; schedulePersistence(); }
      if (pendingOffer?.tabId === tabId) dropOffer(false);
      if (tabId === recordingTab) return stop();
    });
  });
  // Chrome API calls keep the worker active during recording; session storage survives suspension.
  setInterval(() => { void ready.then(periodicCapture).catch(() => undefined); }, 5_000);
});

async function handle(incoming: LotseMessage, senderTab?: number, senderUrl?: string): Promise<LotseResult> {
  switch (incoming.type) {
    case "lotse:start": await start(); break;
    case "lotse:stop": await stop(); break;
    case "lotse:status": await refreshPage(); break;
    case "lotse:settings":
    case "lotse:update-settings": await updateSettings(incoming.settings); break;
    case "lotse:get-policy": {
      const policy = senderUrl ? await pagePolicy(senderUrl) : null;
      return { ok: true, status: status(), policy: policy ? compactPolicy(policy) : null };
    }
    case "lotse:paused":
      // Only a boolean arrives — the content script sends no page data from a blocked route.
      if (incoming.paused === true && senderTab !== undefined && senderTab === recordingTab) pauseForPolicy();
      break;
    case "lotse:login":
      if (typeof incoming.email !== "string" || typeof incoming.password !== "string") throw new Error("Bitte E-Mail und Passwort eingeben.");
      await auth.signIn(incoming.email, incoming.password);
      await afterAuthChange();
      message = `Angemeldet als ${account?.email ?? incoming.email.trim()}.`;
      break;
    case "lotse:logout":
      if (exploreRunning) await stopExplore();
      await auth.signOut();
      exploreStatus = {
        running: false, phase: "idle", pageCount: 0, maxPages: EXPLORE_LIMITS.maxPages, currentRoute: "", summary: "", result: null,
        startedAt: null, phaseStartedAt: null,
      };
      await afterAuthChange();
      message = "Abgemeldet. Lotse arbeitet ohne Konto mit der Demo-Rolle.";
      break;
    case "lotse:explore-start":
      await startExplore();
      break;
    case "lotse:explore-stop":
      await stopExplore();
      break;
    case "lotse:observe": {
      if (!recording || senderTab !== recordingTab) break;
      // Second line of defense after the content script: nothing from a blocked route enters the buffer.
      if (await blockedUrl(senderUrl)) { pauseForPolicy(); break; }
      const oldWorkflow = buffer.workflow?.id;
      await pseudo.learn(incoming.snapshot); // D-26: content strings + mask rects; the schema below strips them
      const event = incoming.event ? LotseEventSchema.parse(incoming.event) : undefined;
      const snapshot = incoming.snapshot ? ObservationSnapshotSchema.parse(incoming.snapshot) : undefined;
      if (snapshot && !localUrl(snapshot.url)) break;
      if (snapshot) lastAppHost = new URL(snapshot.url).host;
      buffer.record({ event, snapshot });
      if (event) queueAnalytics(event);
      if (oldWorkflow && oldWorkflow !== buffer.workflow?.id) { decision = null; inference = null; }
      schedulePersistence();
      if (snapshot) void captureFrame(senderTab!, snapshot).catch(() => undefined);
      queueInference();
      break;
    }
    case "lotse:ask":
    case "lotse:wake-question": {
      const answer = await explicitQuestion(incoming.question, incoming.type === "lotse:wake-question" ? "voice" : incoming.source ?? "text");
      return { ok: true, status: status(), answer };
    }
    case "lotse:plan-resume": {
      if (!plan || senderTab === undefined || plan.tabId !== senderTab || Date.now() - plan.updatedAt > PLAN_TTL_MS) return { ok: true, status: status(), plan: null };
      plan.updatedAt = Date.now();
      schedulePersistence();
      return { ok: true, status: status(), plan: planView(plan) };
    }
    case "lotse:plan-update":
      if (plan && plan.id === incoming.planId && plan.tabId === senderTab && Number.isInteger(incoming.index)) {
        plan.index = Math.min(Math.max(incoming.index, 0), plan.steps.length - 1);
        plan.updatedAt = Date.now();
        schedulePersistence();
      }
      break;
    case "lotse:plan-end":
      if (plan && plan.id === incoming.planId) {
        if (incoming.reason === "done") message = "Anleitung abgeschlossen.";
        plan = null;
        schedulePersistence();
      }
      break;
    case "lotse:plan-command":
      if (plan) await sendTab(plan.tabId, { type: "lotse:plan-control", action: incoming.action });
      if (plan && incoming.action === "end") { plan = null; schedulePersistence(); }
      break;
    case "lotse:offer-accept": await acceptOffer(incoming.offerId); break;
    case "lotse:offer-feedback": await offerFeedback(incoming.offerId, incoming.feedback); break;
    case "lotse:prefs": await loadPrefs(incoming.threshold); break;
    case "lotse:listen":
      if (!settings.voice) throw new Error("Sprachsteuerung ist in den Einstellungen ausgeschaltet.");
      if (!startListening) throw new Error("Die Spracheingabe ist in dieser Version noch nicht verfügbar.");
      await startListening("button");
      break;
    case "lotse:snooze":
      snoozeUntil = incoming.minutes > 0 ? Date.now() + Math.min(incoming.minutes, 240) * 60_000 : 0;
      message = snoozeUntil ? `Proaktive Hilfe pausiert bis ${clock(snoozeUntil)}.` : "Proaktive Hilfe ist wieder aktiv.";
      schedulePersistence();
      break;
    default: throw new Error("Diese Nachricht ist für das Content Script bestimmt.");
  }
  return { ok: true, status: status() };
}

// ---------------------------------------------------------------------------
// Settings: one object — shared toggles in chrome.storage.sync, demo context in chrome.storage.local
// ---------------------------------------------------------------------------

function settingsPatch(value: unknown): Partial<ExtensionSettings> {
  if (!value || typeof value !== "object") throw new Error("Ungültige Einstellungen.");
  const input = value as Record<string, unknown>;
  const patch: Partial<ExtensionSettings> = {};
  for (const key of ["proactive", "voice", "speak", "screenshots"] as const) {
    if (!(key in input)) continue;
    if (typeof input[key] !== "boolean") throw new Error("Ungültige Einstellungen.");
    patch[key] = input[key];
  }
  if ("role" in input) {
    if (typeof input.role !== "string" || input.role.length > 100) throw new Error("Die Rolle darf höchstens 100 Zeichen haben.");
    patch.role = input.role.trim();
  }
  if ("appKnowledge" in input) {
    if (typeof input.appKnowledge !== "string" || input.appKnowledge.length > 12_000) throw new Error("Das App-Wissen darf höchstens 12.000 Zeichen haben.");
    patch.appKnowledge = input.appKnowledge.trim();
  }
  return patch;
}

async function updateSettings(value: unknown) {
  const next = { ...settings, ...settingsPatch(value) };
  const proactiveOff = settings.proactive && !next.proactive;
  settings = next;
  if (!settings.screenshots) buffer.screenshots = [];
  if (proactiveOff) dropOffer(true);
  await browser.storage.sync.set({ [LOTSE_SETTINGS_KEY]: { proactive: settings.proactive, voice: settings.voice, speak: settings.speak } })
    .then(() => browser.storage.local.set({ [DEMO_CONTEXT_KEY]: { screenshots: settings.screenshots, role: settings.role, appKnowledge: settings.appKnowledge } }))
    .catch(() => { message = "Die Einstellungen konnten nicht gespeichert werden."; });
  schedulePersistence();
}

async function loadSettings() {
  const sync = await browser.storage.sync.get(LOTSE_SETTINGS_KEY).catch(() => ({} as Record<string, unknown>));
  const toggles = LotseSettingsSchema.safeParse(sync[LOTSE_SETTINGS_KEY] ?? {});
  if (toggles.success) settings = { ...settings, ...toggles.data };
  const local = await browser.storage.local.get(DEMO_CONTEXT_KEY).catch(() => ({} as Record<string, unknown>));
  try { if (local[DEMO_CONTEXT_KEY]) settings = { ...settings, ...settingsPatch(local[DEMO_CONTEXT_KEY]) }; } catch { /* ignore a corrupt demo context */ }
}

// ---------------------------------------------------------------------------
// Recording and the staged proactive pipeline (D-23): /state → /intent → /decide → offer → /ask
// ---------------------------------------------------------------------------

/** Active app tab — and the policy gate for everything that reads it (snapshots, screenshots, questions, inference). */
async function activeAppTab() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || !localUrl(tab.url)) throw new Error("Öffne eine freigegebene localhost-App im aktiven Tab.");
  if (await blockedUrl(tab.url)) throw new Error(PAUSED_TEXT);
  return tab as typeof tab & { id: number };
}

async function snapshotOf(tabId: number): Promise<ObservationSnapshot> {
  let result: unknown;
  try { result = await browser.tabs.sendMessage(tabId, { type: "lotse:snapshot" } satisfies LotseMessage); }
  catch { throw new Error("Lotse ist auf dieser Seite noch nicht aktiv. Lade die App-Seite neu."); }
  if (result && typeof result === "object" && "paused" in result) throw new Error(PAUSED_TEXT);
  await pseudo.learn(result);
  const snapshot = ObservationSnapshotSchema.safeParse(result);
  if (!snapshot.success || !localUrl(snapshot.data.url)) throw new Error("Lotse ist auf dieser Seite noch nicht aktiv. Lade die App-Seite neu.");
  return snapshot.data;
}

// ---------------------------------------------------------------------------
// App policy (D-27) and login (D-05)
// ---------------------------------------------------------------------------

async function loadPolicy(host: string): Promise<PolicyResponse> {
  return PolicyResponseSchema.parse(await callRuntime("policy", { method: "GET", query: `?app=${encodeURIComponent(host)}`, appHost: host, abortable: false, timeoutMs: 6_000 }));
}

async function pagePolicy(url: string | undefined): Promise<PolicyResponse | null> {
  const host = localUrl(url) ? hostOf(url) : null;
  return host ? policyFor(host, loadPolicy) : null;
}

/** Fail closed: unknown policy, app not allowed or blocked route → true. Checks the full URL (incl. query) locally. */
async function blockedUrl(url: string | undefined): Promise<boolean> {
  if (!localUrl(url)) return true;
  return pageVerdict(url, await pagePolicy(url)).paused;
}

function compactPolicy(policy: PolicyResponse): PagePolicy {
  return { allowed: policy.allowed, blockedRoutes: policy.blockedRoutes };
}

/** Blocked route in the recording tab: drop in-flight inference/offers at once; recording resumes on an allowed route. */
function pauseForPolicy() {
  generation++; requestController?.abort();
  busyOwner++; busy = false; busyMode = null; inferencePending = false;
  clearTimeout(inferenceTimer);
  dropOffer(true);
  message = PAUSED_TEXT + " Hier wird nichts beobachtet, aufgenommen oder gesendet.";
  schedulePersistence();
}

async function refreshPage() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const host = tab && localUrl(tab.url) ? hostOf(tab.url) : null;
  if (!host) { page = null; return; }
  const policy = await pagePolicy(tab!.url);
  const verdict = pageVerdict(tab!.url, policy);
  page = {
    host, paused: verdict.paused, reason: verdict.reason, known: policy?.known ?? false,
    appName: policy?.appName ?? null, orgName: policy?.orgName ?? null, role: policy?.role ?? null,
    signedIn: policy?.signedIn ?? false, member: policy?.member ?? false,
  };
}

async function loadAccount() {
  const user = await auth.currentUser().catch(() => null);
  if (!user) { account = null; return; }
  const isAdmin = await auth.isOrgAdmin().catch(() => false);
  account = { email: user.email, isAdmin };
}

/** Login/logout: new identity → new role and policies; push the fresh policies to open app tabs. */
async function afterAuthChange() {
  await loadAccount();
  clearPolicies();
  threshold = null; // per-user prefs
  const tabs = await browser.tabs.query({ url: ["http://localhost/*", "http://127.0.0.1/*"] }).catch(() => []);
  for (const tab of tabs) {
    if (tab.id === undefined) continue;
    const policy = await pagePolicy(tab.url);
    await sendTab(tab.id, { type: "lotse:policy", policy: policy ? compactPolicy(policy) : null });
  }
  await refreshPage();
  void loadPrefs();
}

async function sendTab(tabId: number, command: LotseMessage): Promise<{ ok?: boolean; error?: string } | null> {
  try { return await browser.tabs.sendMessage(tabId, command); } catch { return null; }
}

async function start() {
  if (exploreRunning) throw new Error("Warte, bis die App-Erkundung abgeschlossen ist, oder stoppe sie zuerst.");
  const tab = await activeAppTab();
  if (recording && recordingTab === tab.id) return;
  await stop();
  buffer.clear();
  recordingTab = tab.id; recording = true;
  lastInferenceKey = ""; decision = null; inference = null;
  lastAppHost = new URL(tab.url!).host;
  try {
    await browser.tabs.sendMessage(tab.id, { type: "lotse:start" } satisfies LotseMessage);
    const snapshot = await snapshotOf(tab.id);
    buffer.record({ snapshot });
    message = "Lotse beobachtet diese App. Der Verlauf bleibt zunächst lokal.";
    await captureFrame(tab.id, snapshot);
    schedulePersistence();
  } catch (error) { recording = false; recordingTab = null; schedulePersistence(); throw error; }
}

async function stop() {
  generation++; requestController?.abort();
  busyOwner++; busy = false; busyMode = null; inferencePending = false;
  clearTimeout(inferenceTimer);
  dropOffer(true);
  void flushAnalytics();
  const oldTab = recordingTab;
  recording = false; recordingTab = null;
  if (oldTab !== null) await sendTab(oldTab, { type: "lotse:stop" });
  message = "Beobachtung pausiert. Der lokale Verlauf läuft nach drei Minuten ab.";
  schedulePersistence();
}

async function periodicCapture() {
  const countBefore = buffer.events.length + buffer.snapshots.length + buffer.screenshots.length;
  buffer.getContext({ includeScreenshots: false });
  if (countBefore !== buffer.events.length + buffer.snapshots.length + buffer.screenshots.length) schedulePersistence();
  if (pendingOffer && Date.now() - pendingOffer.shownAt > OFFER_TTL_MS) dropOffer(false);
  if (recording && analytics.length && Date.now() - lastFlushAt >= 30_000) void flushAnalytics();
  if (!recording || recordingTab === null) return;
  const tab = await activeAppTab().catch(() => null);
  if (!tab || tab.id !== recordingTab) return;
  const snapshot = await snapshotOf(tab.id);
  buffer.record({ snapshot });
  await captureFrame(tab.id, snapshot);
  if (inferencePending) queueInference();
  schedulePersistence();
}

async function captureFrame(tabId: number, expected: ObservationSnapshot, targetBuffer = buffer) {
  if (!settings.screenshots || capturing || Date.now() - lastCaptureAt < 1_000) return;
  capturing = true;
  const epoch = generation;
  try {
    const tab = await activeAppTab();
    const window = await browser.windows.get(tab.windowId);
    if (tab.id !== tabId || !window.focused) return;
    const before = await snapshotOf(tabId);
    if (before.id !== expected.id) return;
    lastCaptureAt = Date.now();
    const dataUrl = await browser.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 40 });
    const capturedAt = Date.now();
    const after = await snapshotOf(tabId);
    const activeAfter = await activeAppTab().catch(() => null);
    if (epoch !== generation || before.id !== after.id || activeAfter?.id !== tabId || !settings.screenshots) return;
    // D-26: content regions are painted over before the frame is buffered; no privacy report → no frame (fail closed).
    const masked = await pseudo.maskFrame(dataUrl, before.id).catch(() => null);
    if (!masked) { screenshotMessage = "Bild ohne Datenschutz-Maske ausgelassen. Lade die App-Seite neu."; return; }
    const frame = ScreenshotFrameSchema.safeParse({ snapshotId: before.id, capturedAt, dataUrl: masked });
    if (!frame.success) { screenshotMessage = "Dieses Bild war zu groß und wurde ausgelassen."; return; }
    targetBuffer.record({ snapshot: after });
    targetBuffer.addScreenshot(frame.data);
    screenshotMessage = "";
    if (targetBuffer === buffer) schedulePersistence();
  } catch (error) {
    screenshotMessage = errorText(error) === PAUSED_TEXT ? "" : "Bildaufnahme nicht verfügbar. Klicke das Lotse-Symbol im aktiven App-Tab.";
  } finally { capturing = false; }
}

function queueInference() {
  inferencePending = true;
  clearTimeout(inferenceTimer);
  inferenceTimer = setTimeout(() => { void maybeIntervene().catch((error: unknown) => { message = errorText(error); }); }, 1_000);
}

/** User controls (D-20/D-22): switch, snooze, one open offer, cooldown, no offers during a guided plan. */
function proactiveHold(): string | null {
  if (!settings.proactive) return "Proaktive Hilfe ist aus. Lotse beobachtet weiter.";
  if (Date.now() < snoozeUntil) return `Proaktive Hilfe pausiert bis ${clock(snoozeUntil)}.`;
  if (pendingOffer && Date.now() - pendingOffer.shownAt < OFFER_TTL_MS) return "Lotse wartet auf deine Antwort zum Hilfe-Angebot.";
  if (pendingOffer) { pendingOffer = null; if (prefetch && !prefetch.live) prefetch = null; }
  if (Date.now() - lastDecisionAt < OFFER_COOLDOWN_MS) return "Lotse hält sich nach dem letzten Hinweis zurück.";
  if (plan && plan.tabId === recordingTab) return "Lotse führt dich gerade durch eine Anleitung.";
  return null;
}

async function maybeIntervene() {
  if (busy || !recording || recordingTab === null || !inferencePending) return;
  const tab = await activeAppTab().catch(() => null);
  if (!tab || tab.id !== recordingTab || busy) return;
  busy = true; busyMode = "proactive";
  const owner = ++busyOwner;
  const epoch = generation;
  const tabId = recordingTab;
  const current = () => epoch === generation && recording && recordingTab === tabId;
  inferencePending = false;
  try {
    const snapshot = await snapshotOf(tabId);
    if (!current()) return;
    buffer.record({ snapshot });
    const context = buffer.getContext({ includeScreenshots: false });
    if (!context) return;
    const key = context.workflow.id + ":" + snapshot.id + ":" + (context.workflow.events.at(-1)?.id ?? "");
    if (key === lastInferenceKey) return;
    message = "Lotse versteht den aktuellen UI-Zustand …";
    const stateBody = UIStateRequestSchema.parse({ snapshot, events: context.workflow.events });
    const state = UIStateInferenceSchema.parse(await callRuntime("state", { body: stateBody }));
    if (!current()) return;
    if (state.snapshotId !== snapshot.id) throw new Error("Die UI-Inferenz gehört zu einem anderen Seitenzustand.");
    buffer.addState({ ...state, capturedAt: snapshot.capturedAt });
    schedulePersistence();
    const stateSnapshot = await snapshotOf(tabId);
    if (!current()) return;
    if (stateSnapshot.id !== snapshot.id) { queueInference(); return; }
    const textContext = buffer.getContext({ includeScreenshots: false });
    if (!textContext?.states?.length) return;
    message = "Lotse ordnet Workflow und Ziel ein …";
    const intentBody = IntentRequestSchema.parse({ context: textContext, ...appContext() });
    const understood = WorkflowIntentSchema.parse(await callRuntime("intent", { body: intentBody }));
    if (!current()) return;
    inference = understood;
    const intentSnapshot = await snapshotOf(tabId);
    if (!current()) return;
    if (intentSnapshot.id !== snapshot.id) { queueInference(); return; }
    const hold = proactiveHold();
    if (hold) { message = hold; lastInferenceKey = key; return; }
    message = "Lotse prüft, ob Hilfe sinnvoll ist …";
    const signal = findStuckSignal(textContext);
    const trigger = signal?.type === "unsuccessful_searches" ? "repeated_search" :
      signal?.type === "route_ping_pong" ? "page_pingpong" : signal?.type ?? "workflow_update";
    const body = DecideRequestSchema.parse({
      trigger, triggerReason: signal?.reason, events: textContext.workflow.events.slice(-50), snapshot,
      context: textContext, inference: understood, ...appContext(),
    });
    const result = DecideResponseSchema.parse(await callRuntime("decide", { body }));
    if (!current()) return;
    decision = result;
    lastInferenceKey = key;
    if (result.threshold !== undefined) threshold = result.threshold;
    if (!result.intervene) { message = "Lotse beobachtet weiter."; return; }
    const holdAfter = proactiveHold();
    if (holdAfter) { message = holdAfter; return; }
    if (buffer.workflow?.id !== context.workflow.id) { queueInference(); return; }
    const latest = await snapshotOf(tabId);
    if (!current()) return;
    if (buffer.events.at(-1)?.id !== context.workflow.events.at(-1)?.id) { queueInference(); return; }
    if (latest.id !== snapshot.id) { queueInference(); return; }
    buffer.record({ snapshot: latest });

    // Offer first; the guidance is prefetched meanwhile and only shown after "Ja".
    const question = (result.intent || understood.intent.goal || understood.workflowName).trim().slice(0, 500) || "Wie komme ich auf dieser Seite weiter?";
    const offerId = result.offerId ?? "local-" + crypto.randomUUID();
    const text = (result.offer || `Soll ich dir zeigen, wie es weitergeht? (${question})`).slice(0, 140);
    const shown = await sendTab(tabId, { type: "lotse:show-offer", offerId, offer: text });
    if (!current()) return;
    if (!shown?.ok) { message = "Lotse hält das Angebot zurück, weil gerade ein Hinweis sichtbar ist."; return; }
    pendingOffer = { id: offerId, text, question, tabId, shownAt: Date.now(), intent: understood.intent };
    lastDecisionAt = Date.now();
    message = "Lotse bietet Hilfe an: " + text;
    schedulePersistence();
    // Screenshots are attached only now, after the explicit intervention decision.
    await captureFrame(tabId, latest);
    if (!current() || pendingOffer?.id !== offerId) return;
    const helpSnapshot = await snapshotOf(tabId);
    if (!current() || pendingOffer?.id !== offerId) return;
    buffer.record({ snapshot: helpSnapshot });
    const job: Prefetch = {
      offerId, ctx: { tabId, snapshotId: helpSnapshot.id, source: "proactive", offerId, cleared: false },
      events: [], live: false, done: false, failed: null, chain: Promise.resolve(), answer: null,
    };
    prefetch = job;
    try {
      job.answer = await requestHelp(tabId, helpSnapshot, buffer.getContext(), question, understood.intent, "proactive", { offerId, prefetch: job });
      job.done = true;
      if (job.live) {
        await job.chain;
        if (prefetch === job) prefetch = null;
        if (current()) message = job.ctx.warning ?? (job.answer.sentence || "Lotse zeigt dir den Weg.");
      }
    } catch (error) {
      job.failed = errorText(error);
      job.done = true;
      if (job.live && prefetch === job) {
        prefetch = null;
        message = job.failed;
        await sendTab(tabId, { type: "lotse:say", text: "Lotse konnte den Weg gerade nicht laden. Frag mich gern direkt." });
      }
    }
  } catch (error) { if (epoch === generation) message = errorText(error); }
  finally {
    if (owner === busyOwner) { busy = false; busyMode = null; if (inferencePending) queueInference(); }
    schedulePersistence();
  }
}

// ---------------------------------------------------------------------------
// Offers, feedback, prefs (D-22)
// ---------------------------------------------------------------------------

/** Forget the open offer; aborts a prefetch that is still loading for it. */
function dropOffer(hide: boolean) {
  const offer = pendingOffer;
  pendingOffer = null;
  if (prefetch && !prefetch.live) {
    if (!prefetch.done && busy && busyMode === "proactive") { generation++; requestController?.abort(); inferencePending = true; }
    prefetch = null;
  }
  if (hide && offer) void sendTab(offer.tabId, { type: "lotse:hide-offer" });
}

async function acceptOffer(offerId: string) {
  const offer = pendingOffer;
  if (!offer || offer.id !== offerId) { message = "Dieses Hilfe-Angebot ist nicht mehr aktuell."; return; }
  pendingOffer = null;
  await sendTab(offer.tabId, { type: "lotse:hide-offer" });
  const job = prefetch?.offerId === offerId ? prefetch : null;
  if (job && !job.failed) {
    job.live = true;
    message = "Lotse zeigt dir den Weg …";
    for (const event of job.events.splice(0)) job.chain = job.chain.then(() => deliver(job.ctx, event)).catch(() => undefined);
    await job.chain;
    if (job.done && job.answer) {
      if (prefetch === job) prefetch = null;
      message = job.ctx.warning ?? (job.answer.sentence || "Lotse zeigt dir den Weg.");
    }
    return;
  }
  prefetch = null;
  await explicitQuestion(offer.question, "proactive", { offerId: offer.id, intent: offer.intent });
}

async function offerFeedback(offerId: string, feedback: "up" | "down" | "declined") {
  if (typeof offerId !== "string" || !offerId) throw new Error("Ungültiges Feedback.");
  if (feedback === "declined") {
    if (pendingOffer?.id === offerId) dropOffer(true);
    snoozeUntil = Date.now() + SNOOZE_MS;
    message = "Okay – Lotse bietet die nächsten 10 Minuten keine Hilfe an.";
    schedulePersistence();
  } else {
    if (feedbackGiven.has(offerId)) return;
    message = feedback === "up" ? "Danke! Lotse merkt sich, dass der Hinweis geholfen hat." : "Danke! Lotse hält sich künftig mehr zurück.";
  }
  feedbackGiven.add(offerId);
  if (offerId.startsWith("local-")) return; // the server never issued this offer
  try {
    const body = OfferFeedbackRequestSchema.parse({ offerId, feedback });
    threshold = ProactivePrefsSchema.parse(await callRuntime("feedback", { body, abortable: false })).proactiveThreshold;
    prefsMessage = "";
  } catch (error) { prefsMessage = errorText(error); }
}

async function loadPrefs(value?: number) {
  try {
    if (value !== undefined && (typeof value !== "number" || !Number.isFinite(value))) throw new Error("Ungültige Schwelle.");
    const result = value === undefined
      ? await callRuntime("prefs", { method: "GET", abortable: false })
      : await callRuntime("prefs", {
        method: "PUT", abortable: false,
        body: ProactivePrefsSchema.parse({ proactiveThreshold: Math.min(Math.max(value, PROACTIVE_THRESHOLD.min), PROACTIVE_THRESHOLD.max) }),
      });
    threshold = ProactivePrefsSchema.parse(result).proactiveThreshold;
    prefsMessage = value === undefined ? "" : "Schwelle gespeichert.";
  } catch (error) { prefsMessage = errorText(error); }
}

// ---------------------------------------------------------------------------
// Explicit questions and guidance delivery
// ---------------------------------------------------------------------------

async function explicitQuestion(question: string, source: Source = "text", options: { offerId?: string; intent?: InferredIntent } = {}): Promise<AskResponse> {
  if (typeof question !== "string" || !question.trim() || question.length > 500) throw new Error("Bitte stelle eine Frage mit höchstens 500 Zeichen.");
  try { stopSpeaking(); } catch { /* voice module not ready */ }
  if (source !== "proactive") { lastQuestion = { text: question.trim(), source }; dropOffer(true); }
  if (busy && busyMode === "proactive") { generation++; requestController?.abort(); busy = false; inferencePending = true; }
  if (busy) throw new Error("Lotse bearbeitet gerade einen Hinweis. Versuche es gleich noch einmal.");
  busy = true; busyMode = "question"; const owner = ++busyOwner;
  const epoch = generation;
  try {
    const tab = await activeAppTab();
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    lastAppHost = new URL(tab.url!).host;
    const snapshot = await snapshotOf(tab.id);
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    const questionBuffer = tab.id === recordingTab ? buffer : new ObservationBuffer();
    questionBuffer.record({ snapshot });
    await captureFrame(tab.id, snapshot, questionBuffer);
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    const latest = await snapshotOf(tab.id);
    questionBuffer.record({ snapshot: latest });
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    message = "Lotse sucht den nächsten Schritt …";
    const knownIntent = options.intent ?? (tab.id === recordingTab ? inference?.intent : undefined);
    const answer = await requestHelp(tab.id, latest, questionBuffer.getContext(), question.trim(), knownIntent, source, { offerId: options.offerId });
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    lastDecisionAt = Date.now(); // no proactive offer right on top of fresh guidance
    message = answer.sentence || "Lotse hat den Weg markiert.";
    return answer;
  } catch (error) { if (epoch === generation) message = errorText(error); throw error; }
  finally { if (owner === busyOwner) { busy = false; busyMode = null; if (inferencePending) queueInference(); } schedulePersistence(); }
}

/** Signed in → the server takes the role from the org membership; the manual demo role only applies without login. */
function appContext() {
  return { role: account ? undefined : settings.role || undefined, appKnowledge: settings.appKnowledge || undefined };
}

async function requestHelp(
  tabId: number, snapshot: ObservationSnapshot, observation: ObservationContext | null, question: string,
  intent: InferredIntent | undefined, source: Source, extra: { offerId?: string; prefetch?: Prefetch } = {},
): Promise<AskResponse> {
  const epoch = generation;
  if (observation && !settings.screenshots) observation = { ...observation, screenshots: [] };
  const body = AskRequestSchema.parse({ question, source, snapshot, observation: observation ?? undefined, recentEvents: observation?.workflow.events.slice(-50), intent, ...appContext() });
  const ctx: HelpContext = extra.prefetch?.ctx ?? { tabId, snapshotId: snapshot.id, source, offerId: extra.offerId, cleared: false };
  let streamed = false;
  const route = async (event: RenderEvent) => {
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    const job = extra.prefetch;
    if (!job) { await deliver(ctx, event); return; }
    if (job.live) { job.chain = job.chain.then(() => deliver(ctx, event)).catch(() => undefined); await job.chain; }
    else job.events.push(event);
  };
  const answer = AskResponseSchema.parse(await callRuntime("ask", {
    body,
    onGuidance: async (event) => {
      if (event.type === "point" || event.type === "plan" || event.type === "say") { streamed = true; await route(event); }
    },
  }));
  if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
  if (answer.snapshotId && answer.snapshotId !== snapshot.id) throw new Error("Der Hinweis gehört zu einem anderen Seitenzustand.");
  if (!streamed) {
    // Legacy JSON answer → the same rendering path as the stream.
    if (answer.elementNumber !== null) await route({ type: "point", elementNumber: answer.elementNumber, label: answer.sentence, hint: answer.sentence.slice(0, 120) });
    else if (answer.sentence) await route({ type: "say", text: answer.sentence.slice(0, 200) });
  }
  return answer;
}

/** Render one guidance event in the tab. The first event of an answer replaces whatever Lotse showed before. */
async function deliver(ctx: HelpContext, event: RenderEvent) {
  if (!ctx.cleared) {
    ctx.cleared = true;
    if (plan?.tabId === ctx.tabId) plan = null;
    await sendTab(ctx.tabId, { type: "lotse:clear" });
  }
  if (event.type === "point") {
    const result = await sendTab(ctx.tabId, { type: "lotse:point", elementNumber: event.elementNumber, label: event.label, hint: event.hint, snapshotId: ctx.snapshotId, offerId: ctx.offerId });
    if (!result?.ok) ctx.warning = "Das vorgeschlagene Element ist gerade nicht sichtbar.";
  } else if (event.type === "plan") {
    plan = { id: crypto.randomUUID(), steps: event.steps, index: 0, snapshotId: ctx.snapshotId, offerId: ctx.offerId, tabId: ctx.tabId, updatedAt: Date.now() };
    schedulePersistence();
    await sendTab(ctx.tabId, { type: "lotse:plan-show", plan: planView(plan) });
  } else {
    await sendTab(ctx.tabId, { type: "lotse:say", text: event.text, offerId: ctx.offerId });
    // TTS runs on the server: speak the pseudonymized text ("Kunde 1"), never the real name (D-26).
    if (ctx.source === "voice" && settings.speak) void pseudo.spokenText(event.text).then((text) => speak(text)).catch(() => undefined);
  }
}

function planView(record: PlanRecord): PlanView {
  const offerId = record.offerId && !feedbackGiven.has(record.offerId) ? record.offerId : undefined;
  return { id: record.id, steps: record.steps, index: record.index, snapshotId: record.snapshotId, offerId };
}

async function broadcastVoiceState() {
  const tabId = recordingTab ?? (await activeAppTab().catch(() => null))?.id;
  if (typeof tabId === "number") await sendTab(tabId, { type: "lotse:voice-state", state: voiceState });
}

// ---------------------------------------------------------------------------
// Analytics (D-20): privacy-filtered events, batched while recording
// ---------------------------------------------------------------------------

function queueAnalytics(event: LotseEvent) {
  if (!recording || !ANALYTICS_TYPES.has(event.type)) return;
  // Labels/roles only; the snapshot reference is meaningless outside this browser.
  analytics.push({
    id: event.id, type: event.type, route: event.route, ts: event.ts,
    elementRole: event.elementRole?.slice(0, 40), elementLabel: event.elementLabel?.slice(0, 80), detail: event.detail?.slice(0, 120),
  });
  if (analytics.length > 500) analytics.splice(0, analytics.length - 500);
  if (analytics.length >= 100) void flushAnalytics();
}

async function flushAnalytics() {
  if (flushing || !analytics.length) return;
  flushing = true;
  lastFlushAt = Date.now();
  const batch = analytics.splice(0, 100);
  try {
    await callRuntime("events", { body: EventBatchSchema.parse({ appId: lastAppHost || undefined, events: batch }), abortable: false });
  } catch {
    analytics.unshift(...batch);
    if (analytics.length > 500) analytics.splice(0, analytics.length - 500);
  } finally { flushing = false; schedulePersistence(); }
}

// ---------------------------------------------------------------------------
// Admin exploration (D-25): crawl same-origin pages/tabs/menus/dialogs → POST /api/lotse/explore
// ---------------------------------------------------------------------------

function normalizeExploreRoute(rawUrl: string, startOrigin: string, blockedRoutes: string[]): string | null {
  try {
    const u = new URL(rawUrl);
    if (u.origin !== startOrigin) return null;
    if (routeBlocked(locationOf(rawUrl), blockedRoutes)) return null;
    const path = (u.pathname.replace(/\/index\.html$/i, "/") || "/").replace(/\/+$/, "") || "/";
    const hash = u.hash.startsWith("#/") ? u.hash.split("?")[0] : "";
    return path + hash;
  } catch {
    return null;
  }
}

async function startExplore() {
  if (!account) await loadAccount();
  if (!account?.isAdmin) throw new Error("Nur Organisations-Admins dürfen eine App erkunden.");
  const token = await auth.accessToken();
  if (!token) throw new Error("Deine Sitzung ist abgelaufen. Bitte melde dich erneut an.");
  if (exploreRunning) return;
  const tab = await activeAppTab();
  const startUrl = tab.url!;
  const policy = await pagePolicy(startUrl);
  if (!policy?.allowed) throw new Error(policy?.reason ?? "Diese App ist für Lotse nicht freigegeben.");
  await sendTab(tab.id, { type: "lotse:policy", policy: compactPolicy(policy) });
  await snapshotOf(tab.id);
  if (recording) await stop();
  if (plan?.tabId === tab.id) { plan = null; await sendTab(tab.id, { type: "lotse:clear" }); }

  const now = Date.now();
  exploreRunning = true;
  exploreAborted = false;
  exploreTabId = tab.id;
  exploreStatus = {
    running: true,
    phase: "crawling",
    pageCount: 0,
    maxPages: EXPLORE_LIMITS.maxPages,
    currentRoute: new URL(startUrl).pathname,
    summary: `Seite 1 von max. ${EXPLORE_LIMITS.maxPages}`,
    result: null,
    startedAt: now,
    phaseStartedAt: now,
  };
  message = "Lotse erkundet die App …";
  void runExploration(tab.id, startUrl, policy.blockedRoutes);
}

async function stopExplore() {
  if (!exploreRunning) return;
  exploreAborted = true;
  exploreController?.abort();
  const tabId = exploreTabId;
  exploreRunning = false;
  exploreTabId = null;
  if (tabId !== null) await sendTab(tabId, { type: "lotse:explore-abort" });
  exploreStatus = {
    ...exploreStatus,
    running: false,
    phase: "stopped",
    summary: `Erkundung gestoppt (${exploreStatus.pageCount} von max. ${EXPLORE_LIMITS.maxPages} Seiten erfasst).`,
  };
  message = exploreStatus.summary;
}

async function runExploration(tabId: number, startUrl: string, blockedRoutes: string[]) {
  const startedAt = Date.now();
  const deadlineAt = startedAt + EXPLORE_LIMITS.maxDurationMs;
  const parsedStart = new URL(startUrl);
  const startOrigin = parsedStart.origin;
  const appHost = parsedStart.host;
  const compact: PagePolicy = { allowed: true, blockedRoutes };

  const pages: ExploredPage[] = [];
  const seenPageKeys = new Set<string>();
  const visitedRoutes = new Set<string>();
  let seenGlobalKeys: string[] = [];

  const initialKey = normalizeExploreRoute(startUrl, startOrigin, blockedRoutes) ?? "/";
  visitedRoutes.add(initialKey);
  const queue: Array<{ url: string; key: string; reachedVia: string[] }> = [{ url: startUrl, key: initialKey, reachedVia: [] }];
  let currentUrl = startUrl;

  try {
    while (queue.length > 0 && pages.length < EXPLORE_LIMITS.maxPages && Date.now() < deadlineAt && !exploreAborted) {
      const next = queue.shift()!;
      if (next.url !== currentUrl) {
        const navigated = await navigateExploreTab(tabId, next.url, compact, deadlineAt);
        if (!navigated || exploreAborted) continue;
        currentUrl = next.url;
      }

      const activeTab = await browser.tabs.get(tabId).catch(() => null);
      if (!activeTab?.url || new URL(activeTab.url).origin !== startOrigin || routeBlocked(locationOf(activeTab.url), blockedRoutes)) continue;

      const shownCount = Math.min(pages.length + 1, EXPLORE_LIMITS.maxPages);
      exploreStatus = { ...exploreStatus, currentRoute: next.key, summary: `Seite ${shownCount} von max. ${EXPLORE_LIMITS.maxPages}` };
      await sendTab(tabId, { type: "lotse:explore-chip", text: `🔍 Erkundung: Seite ${shownCount} von max. ${EXPLORE_LIMITS.maxPages}` });

      const stepResponse = (await sendTab(tabId, {
        type: "lotse:explore-run",
        reachedVia: next.reachedVia,
        maxRemaining: EXPLORE_LIMITS.maxPages - pages.length,
        deadlineAt,
        seenGlobalKeys,
        startOrigin,
        blockedRoutes,
      })) as ({ ok?: boolean; error?: string } & Partial<ExploreStepResult>) | null;

      if (exploreAborted) return;
      if (!stepResponse?.ok || !Array.isArray(stepResponse.pages)) continue;
      if (Array.isArray(stepResponse.seenGlobalKeys)) seenGlobalKeys = stepResponse.seenGlobalKeys;
      if (Array.isArray(stepResponse.privacyTerms) && stepResponse.privacyTerms.length) {
        await pseudo.learnPrivacy({ terms: stepResponse.privacyTerms, rects: [], viewport: { width: 1, height: 1 } });
      }

      for (const exploredPage of stepResponse.pages) {
        if (pages.length >= EXPLORE_LIMITS.maxPages) break;
        const pageKey = `${exploredPage.route}|${exploredPage.kind}|${exploredPage.title}|${exploredPage.elements.slice(0, 8).map((el) => el.label).join(",")}`;
        if (seenPageKeys.has(pageKey)) continue;
        seenPageKeys.add(pageKey);
        pages.push(exploredPage);
      }

      exploreStatus = {
        ...exploreStatus,
        pageCount: pages.length,
        summary: `Seite ${pages.length} von max. ${EXPLORE_LIMITS.maxPages}`,
      };

      for (const link of stepResponse.links ?? []) {
        const key = normalizeExploreRoute(link.url, startOrigin, blockedRoutes);
        if (!key) continue;
        if (visitedRoutes.has(key)) {
          const queued = queue.find((item) => item.key === key);
          if (queued && !queued.url.includes("?") && link.url.includes("?")) {
            queued.url = link.url;
            queued.reachedVia = link.reachedVia;
          }
          continue;
        }
        visitedRoutes.add(key);
        queue.push({ url: link.url, key, reachedVia: link.reachedVia });
      }
    }

    await sendTab(tabId, { type: "lotse:explore-chip", text: "" });
    if (exploreAborted) return;

    if (currentUrl !== startUrl) {
      await navigateExploreTab(tabId, startUrl, compact, Date.now() + 5_000).catch(() => undefined);
      await sendTab(tabId, { type: "lotse:explore-chip", text: "" });
    }

    if (exploreAborted) return;
    if (!pages.length) throw new Error("Es konnten keine Seiten der App erfasst werden.");

    exploreStatus = {
      ...exploreStatus,
      phase: "analyzing",
      pageCount: pages.length,
      currentRoute: "",
      summary: `Seite ${pages.length} von max. ${EXPLORE_LIMITS.maxPages} · Auswertung läuft …`,
      phaseStartedAt: Date.now(),
    };
    message = exploreStatus.summary;
    await sendTab(tabId, { type: "lotse:explore-chip", text: `⏳ Lotse wertet ${pages.length} Seiten aus …` });

    const pseudonymizedPages = await pseudo.pseudonymizeExploredPages(pages);
    const body = ExploreRequestSchema.parse({
      appHost,
      pages: pseudonymizedPages,
      durationMs: Math.max(0, Math.round(Date.now() - startedAt)),
    });
    const rawResult = await callRuntime("explore", {
      body,
      appHost,
      abortable: false,
      exploreAbortable: true,
      timeoutMs: 75_000,
    });
    await sendTab(tabId, { type: "lotse:explore-chip", text: "" });
    if (exploreAborted) return;

    const result = ExploreResponseSchema.parse(rawResult);
    const summaryText = `${result.features} Funktionen und ${result.findings} Design-Befunde gefunden – im Dashboard unter ‚Lernen‘ prüfen`;
    exploreRunning = false;
    exploreTabId = null;
    exploreStatus = {
      running: false,
      phase: "done",
      pageCount: pages.length,
      maxPages: EXPLORE_LIMITS.maxPages,
      currentRoute: "",
      summary: summaryText,
      result,
      startedAt,
      phaseStartedAt: null,
    };
    message = summaryText;
  } catch (error) {
    await sendTab(tabId, { type: "lotse:explore-chip", text: "" });
    if (exploreAborted) return;
    const text = errorText(error);
    exploreRunning = false;
    exploreTabId = null;
    exploreStatus = {
      ...exploreStatus,
      running: false,
      phase: "error",
      currentRoute: "",
      summary: text,
    };
    message = text;
  }
}

async function navigateExploreTab(tabId: number, url: string, policy: PagePolicy, deadlineAt: number): Promise<boolean> {
  const maxWait = Math.min(8_000, Math.max(1_000, deadlineAt - Date.now()));
  const loaded = new Promise<boolean>((resolve) => {
    const timer = setTimeout(() => {
      browser.tabs.onUpdated.removeListener(listener);
      resolve(false);
    }, maxWait);
    const listener = (updatedTabId: number, changes: { status?: string }) => {
      if (updatedTabId === tabId && changes.status === "complete") {
        clearTimeout(timer);
        browser.tabs.onUpdated.removeListener(listener);
        resolve(true);
      }
    };
    browser.tabs.onUpdated.addListener(listener);
  });
  try {
    await browser.tabs.update(tabId, { url });
  } catch {
    return false;
  }
  const ok = await loaded;
  if (!ok || exploreAborted) return false;
  for (let attempt = 0; attempt < 15; attempt++) {
    if (exploreAborted || Date.now() >= deadlineAt) return false;
    await sendTab(tabId, { type: "lotse:policy", policy });
    const ping = await sendTab(tabId, { type: "lotse:snapshot" });
    if (ping && typeof ping === "object" && "url" in ping) {
      await new Promise((resolve) => setTimeout(resolve, 160));
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 140));
  }
  return false;
}

// ---------------------------------------------------------------------------
// Runtime HTTP
// ---------------------------------------------------------------------------

type Endpoint = "state" | "intent" | "decide" | "ask" | "feedback" | "prefs" | "events" | "policy" | "explore";
type CallOptions = {
  method?: "GET" | "POST" | "PUT"; body?: unknown; onGuidance?: (event: GuidanceEvent) => Promise<void>; abortable?: boolean;
  exploreAbortable?: boolean; query?: string; appHost?: string; timeoutMs?: number;
};

/**
 * Inference calls are abortable (pause/preemption); feedback, prefs, policy and analytics run independently.
 * Every call carries the Supabase access token when signed in (D-05); a 401 refreshes the session and retries once.
 */
async function callRuntime(endpoint: Endpoint, { method = "POST", body, onGuidance, abortable = true, exploreAbortable = false, query = "", appHost: explicitHost, timeoutMs = 20_000 }: CallOptions = {}): Promise<unknown> {
  const controller = new AbortController();
  if (abortable) requestController = controller;
  if (exploreAbortable) exploreController = controller;
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const payload = (body ?? {}) as { snapshot?: ObservationSnapshot; context?: ObservationContext; appId?: string; appHost?: string };
    const snapshotUrl = payload.snapshot?.url ?? payload.context?.snapshot.url;
    // Last gate before data leaves the browser: never send a snapshot of a blocked route.
    if (snapshotUrl && await blockedUrl(snapshotUrl)) throw new Error(PAUSED_TEXT);
    const appHost = explicitHost ?? payload.appHost ?? payload.appId ?? (snapshotUrl ? new URL(snapshotUrl).host : lastAppHost);
    const headers: Record<string, string> = { [LOTSE_HEADERS.session]: sessionId };
    if (appHost) headers[LOTSE_HEADERS.app] = appHost;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (endpoint === "ask") headers.Accept = "application/x-ndjson";
    const url = `${LOTSE_DEFAULTS.serverUrl}/api/lotse/${endpoint}${query}`;
    // D-26: the last step before the network — personal data becomes [Kunde-1], [IBAN-1] …; responses are re-identified.
    const wire = body === undefined ? undefined : await pseudo.pseudonymize(body);
    const init = { method, body: wire === undefined ? undefined : JSON.stringify(wire), signal: controller.signal };
    const token = await auth.accessToken().catch(() => null);
    let response = await fetch(url, { ...init, headers: token ? { ...headers, Authorization: `Bearer ${token}` } : headers });
    if (response.status === 401 && token) {
      // Expired/revoked token: refresh once; a failed refresh signs out locally and the retry runs anonymously (dev).
      const fresh = (await auth.refreshSession().catch(() => null))?.accessToken;
      if (!fresh) void afterAuthChange().catch(() => undefined);
      response = await fetch(url, { ...init, headers: fresh ? { ...headers, Authorization: `Bearer ${fresh}` } : headers });
    }
    if (!response.ok) {
      const errorPayload = (await response.json().catch(() => null)) as { error?: string | { message?: string } } | null;
      const serverMsg = typeof errorPayload?.error === "string"
        ? errorPayload.error
        : typeof errorPayload?.error?.message === "string"
          ? errorPayload.error.message
          : "";
      if (response.status === 401) throw new Error(serverMsg || "Bitte melde dich in Lotse an (Sitzung abgelaufen oder ungültig).");
      if (response.status === 404 && !serverMsg && endpoint !== "feedback") throw new Error("Lotse wartet auf den /api/lotse/" + endpoint + "-Endpunkt.");
      if (response.status === 429) throw new Error(serverMsg || "Lotse hat gerade zu viele Anfragen. Versuche es gleich noch einmal.");
      if (serverMsg) throw new Error(serverMsg);
      throw new Error(`Die Hilfe ist derzeit nicht verfügbar (Server ${response.status}).`);
    }
    if (endpoint === "events") return null;
    if (endpoint === "ask" && response.headers.get("content-type")?.includes("ndjson")) return await readGuidance(response, onGuidance);
    return pseudo.reidentify(await response.json());
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Die Anfrage wurde abgebrochen oder dauerte zu lange.");
    if (error instanceof TypeError) throw new Error("Der Lotse-Server ist nicht erreichbar. Starte npm run dev:server.");
    throw error;
  } finally {
    clearTimeout(timeout);
    if (requestController === controller) requestController = null;
    if (exploreController === controller) exploreController = null;
  }
}

async function readGuidance(response: Response, onEvent?: (event: GuidanceEvent) => Promise<void>): Promise<AskResponse> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Der Server hat keine Hilfe gesendet.");
  const decoder = new TextDecoder();
  let pending = "";
  let completed = false;
  let received = false;
  const answer: AskResponse = { elementNumber: null, sentence: "" };
  const consume = async (line: string) => {
    if (!line.trim()) return;
    const event = pseudo.reidentify(GuidanceEventSchema.parse(JSON.parse(line))); // real names for overlay + panel
    received = true;
    if (event.type === "error") {
      if (event.code === "budget_exceeded") throw new Error("Lotse macht Pause bis morgen (Tagesbudget erreicht).");
      if (event.code === "rate_limited") throw new Error("Lotse hat gerade zu viele Anfragen. Versuche es gleich noch einmal.");
      throw new Error(event.message);
    }
    if (event.type === "point") { answer.elementNumber = event.elementNumber; answer.sentence ||= event.hint ?? event.label; }
    if (event.type === "plan") answer.sentence = event.steps.map((step, index) => (index + 1) + ". " + (step.hint ?? step.label)).join("\n");
    if (event.type === "say") answer.sentence = event.text;
    if (event.type === "tier") message = "Lotse arbeitet am nächsten Schritt …";
    if (event.type === "done") completed = true;
    await onEvent?.(event);
  };
  try {
    while (!completed) {
      const chunk = await reader.read();
      pending += decoder.decode(chunk.value, { stream: !chunk.done });
      if (pending.length > 65_536) throw new Error("Die Antwort des Servers ist zu groß.");
      let boundary = pending.indexOf("\n");
      while (boundary !== -1 && !completed) {
        const line = pending.slice(0, boundary); pending = pending.slice(boundary + 1);
        await consume(line); boundary = pending.indexOf("\n");
      }
      if (chunk.done) { if (!completed && pending.trim()) await consume(pending); break; }
    }
    if (!received) throw new Error("Der Server hat keine Hilfe gesendet.");
    if (!completed) throw new Error("Die Hilfe-Antwort wurde unterbrochen.");
    return answer;
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : "Lotse konnte die Anfrage nicht bearbeiten.";
}

function clock(timestamp: number) {
  return new Date(timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });
}

// ---------------------------------------------------------------------------
// Status + persistence
// ---------------------------------------------------------------------------

function status(): LotseStatus {
  const context = buffer.getContext({ includeScreenshots: false });
  const step = plan?.steps[plan.index];
  return { recording, tabId: recordingTab, busy, busyMode, settings, decision, inference, stateCount: buffer.states.length, message, screenshotMessage,
    eventCount: buffer.events.length, snapshotCount: buffer.snapshots.length, screenshotCount: buffer.screenshots.length,
    elementCount: context?.snapshot.elements.length ?? 0, workflowId: context?.workflow.id ?? null,
    events: context?.workflow.events.slice(-8) ?? [],
    offer: pendingOffer ? { offerId: pendingOffer.id, text: pendingOffer.text } : null,
    plan: plan && step ? { index: plan.index, total: plan.steps.length, label: step.label, hint: step.hint } : null,
    threshold, prefsMessage, snoozedUntil: snoozeUntil > Date.now() ? snoozeUntil : null,
    voiceState, lastQuestion, analyticsQueued: analytics.length,
    account, page, explore: exploreStatus,
  };
}

function schedulePersistence() {
  if (persistenceTimer !== undefined) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = undefined;
    const saved: SavedSession = { recording, recordingTab, buffer: buffer.serialize(), decision, inference, sessionId, plan, snoozeUntil, lastDecisionAt, threshold, analytics };
    void browser.storage.session.set({ [STORE]: saved }).catch(() => { message = "Der lokale Verlauf konnte nicht gespeichert werden."; });
  }, 700);
}

function parsePlan(value: unknown): PlanRecord | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<PlanRecord>;
  if (typeof candidate.id !== "string" || typeof candidate.tabId !== "number" || typeof candidate.index !== "number" || typeof candidate.updatedAt !== "number") return null;
  const steps = GuidanceEventSchema.safeParse({ type: "plan", steps: candidate.steps });
  if (!steps.success || steps.data.type !== "plan" || Date.now() - candidate.updatedAt > PLAN_TTL_MS) return null;
  return {
    id: candidate.id, tabId: candidate.tabId, updatedAt: candidate.updatedAt, steps: steps.data.steps,
    index: Math.min(Math.max(Math.trunc(candidate.index), 0), steps.data.steps.length - 1),
    snapshotId: typeof candidate.snapshotId === "string" ? candidate.snapshotId : undefined,
    offerId: typeof candidate.offerId === "string" ? candidate.offerId : undefined,
  };
}

async function restore() {
  await loadSettings().catch(() => undefined);
  await loadAccount();
  try {
    const saved = (await browser.storage.session.get(STORE))[STORE] as Partial<SavedSession> | undefined;
    if (!saved || typeof saved !== "object") return;
    buffer.restore(saved.buffer);
    recordingTab = typeof saved.recordingTab === "number" ? saved.recordingTab : null;
    recording = saved.recording === true && recordingTab !== null;
    const savedDecision = DecideResponseSchema.safeParse(saved.decision);
    decision = savedDecision.success ? savedDecision.data : null;
    const savedInference = WorkflowIntentSchema.safeParse(saved.inference);
    inference = savedInference.success ? savedInference.data : null;
    if (typeof saved.sessionId === "string" && saved.sessionId.length <= 100) sessionId = saved.sessionId;
    plan = parsePlan(saved.plan);
    snoozeUntil = typeof saved.snoozeUntil === "number" ? saved.snoozeUntil : 0;
    lastDecisionAt = typeof saved.lastDecisionAt === "number" ? saved.lastDecisionAt : 0;
    threshold = typeof saved.threshold === "number" && saved.threshold >= 0 && saved.threshold <= 1 ? saved.threshold : null;
    analytics = Array.isArray(saved.analytics) ? saved.analytics.filter((event) => LotseEventSchema.safeParse(event).success).slice(-500) as LotseEvent[] : [];
    if (recording && recordingTab !== null) {
      const tab = await browser.tabs.get(recordingTab).catch(() => null);
      if (!tab || !localUrl(tab.url)) { recording = false; recordingTab = null; }
      else { message = "Lotse beobachtet diese App weiter."; lastAppHost = new URL(tab.url!).host; }
    }
    schedulePersistence();
  } catch { recording = false; recordingTab = null; buffer.clear(); }
}
