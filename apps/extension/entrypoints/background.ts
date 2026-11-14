import {
  AskRequestSchema, AskResponseSchema, DecideRequestSchema, DecideResponseSchema, EventBatchSchema, GuidanceEventSchema,
  IntentRequestSchema, LOTSE_DEFAULTS, LOTSE_HEADERS, LOTSE_SETTINGS_KEY, LotseEventSchema, LotseSettingsSchema,
  ObservationSnapshotSchema, OfferFeedbackRequestSchema, PROACTIVE_THRESHOLD, ProactivePrefsSchema, ScreenshotFrameSchema,
  UIStateInferenceSchema, UIStateRequestSchema, WorkflowIntentSchema,
  type AskResponse, type DecideResponse, type GuidanceEvent, type InferredIntent, type LotseEvent, type ObservationContext,
  type ObservationSnapshot, type VoiceState, type WorkflowIntent,
} from "@lotse/shared";
import { ObservationBuffer, findStuckSignal } from "../utils/observation";
import { DEFAULT_SETTINGS, DEMO_CONTEXT_KEY, type ExtensionSettings, type LotseMessage, type PlanView } from "../utils/messages";
import { PseudonymSession, redactScreenshot, type PagePrivacyPayload } from "../utils/pseudonymize";
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
  plan: unknown; snoozeUntil: number; lastDecisionAt: number; threshold: number | null; analytics: unknown; pseudonyms?: unknown;
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
};
export type LotseResult =
  | { ok: true; status: LotseStatus; answer?: AskResponse; plan?: PlanView | null }
  | { ok: false; error: string };

const HANDLED = new Set<string>([
  "lotse:start", "lotse:stop", "lotse:status", "lotse:settings", "lotse:update-settings", "lotse:observe", "lotse:ask", "lotse:wake-question",
  "lotse:plan-resume", "lotse:plan-update", "lotse:plan-end", "lotse:plan-command", "lotse:offer-accept", "lotse:offer-feedback",
  "lotse:prefs", "lotse:snooze", "lotse:listen",
]);
const ANALYTICS_TYPES = new Set<LotseEvent["type"]>(["click", "route", "search", "error", "idle", "submit", "empty_results", "rage_click"]);
const OFFER_COOLDOWN_MS = 120_000; // D-20: at most one proactive offer per two minutes
const SNOOZE_MS = 10 * 60_000; // "Nein" → ten minutes of quiet
const OFFER_TTL_MS = 75_000;
const PLAN_TTL_MS = 30 * 60_000;

const buffer = new ObservationBuffer();
const pseudonymizer = new PseudonymSession();
const latestPagePrivacy = new Map<number, PagePrivacyPayload>();
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
    onTranscript: (text: string) => ready.then(() => explicitQuestion(text.slice(0, 500), "voice")).catch((error: unknown) => { message = errorText(error); }),
    onState: (state: VoiceState) => { voiceState = state; void broadcastVoiceState(); },
    onError: (text: string) => { message = text; },
  };
  try { setupVoice(voiceHandlers); } catch { voiceState = "off"; }
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  browser.runtime.onMessage.addListener((incoming: LotseMessage, sender, respond) => {
    // Leave messages of other modules (the voice offscreen document uses `target`) to their own listeners.
    if (!incoming || typeof incoming !== "object" || "target" in incoming || !HANDLED.has(incoming.type)) return false;
    ready.then(() => handle(incoming, sender.tab?.id)).then(
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
    if (changes.status === "complete") {
      void ready.then(async () => {
        if (recording && tabId === recordingTab) {
          await browser.tabs.sendMessage(tabId, { type: "lotse:start" } satisfies LotseMessage);
          buffer.record({ snapshot: await snapshotOf(tabId) });
          schedulePersistence();
        }
      }).catch(() => undefined);
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    latestPagePrivacy.delete(tabId);
    void ready.then(() => {
      if (plan?.tabId === tabId) { plan = null; schedulePersistence(); }
      if (pendingOffer?.tabId === tabId) dropOffer(false);
      if (tabId === recordingTab) return stop();
    });
  });
  // Chrome API calls keep the worker active during recording; session storage survives suspension.
  setInterval(() => { void ready.then(periodicCapture).catch(() => undefined); }, 5_000);
});

async function handle(incoming: LotseMessage, senderTab?: number): Promise<LotseResult> {
  switch (incoming.type) {
    case "lotse:start": await start(); break;
    case "lotse:stop": await stop(); break;
    case "lotse:status": break;
    case "lotse:settings":
    case "lotse:update-settings": await updateSettings(incoming.settings); break;
    case "lotse:observe": {
      if (!recording || senderTab !== recordingTab) break;
      if (incoming.privacy) {
        pseudonymizer.ingest(incoming.privacy.entries);
        if (senderTab !== undefined) latestPagePrivacy.set(senderTab, incoming.privacy);
      }
      const oldWorkflow = buffer.workflow?.id;
      const event = incoming.event ? pseudonymizer.pseudonymizeEvent(LotseEventSchema.parse(incoming.event)) : undefined;
      const snapshot = incoming.snapshot ? pseudonymizer.pseudonymizeSnapshot(ObservationSnapshotSchema.parse(incoming.snapshot)) : undefined;
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

async function activeAppTab() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || !localUrl(tab.url)) throw new Error("Öffne eine freigegebene localhost-App im aktiven Tab.");
  return tab as typeof tab & { id: number };
}

async function snapshotOf(tabId: number): Promise<ObservationSnapshot> {
  try {
    const raw = await browser.tabs.sendMessage(tabId, { type: "lotse:snapshot" } satisfies LotseMessage) as (ObservationSnapshot & { privacy?: PagePrivacyPayload }) | null;
    if (raw && typeof raw === "object" && "privacy" in raw && raw.privacy) {
      pseudonymizer.ingest(raw.privacy.entries);
      latestPagePrivacy.set(tabId, raw.privacy);
    }
    const snapshot = pseudonymizer.pseudonymizeSnapshot(ObservationSnapshotSchema.parse(raw));
    if (!localUrl(snapshot.url)) throw new Error("App nicht freigegeben.");
    return snapshot;
  } catch { throw new Error("Lotse ist auf dieser Seite noch nicht aktiv. Lade die App-Seite neu."); }
}

async function sendTab(tabId: number, command: LotseMessage): Promise<{ ok?: boolean; error?: string } | null> {
  try { return await browser.tabs.sendMessage(tabId, command); } catch { return null; }
}

async function start() {
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
    const privacy = latestPagePrivacy.get(tabId);
    const redactedUrl = await redactScreenshot(dataUrl, privacy?.rects ?? [], privacy?.viewport);
    if (!redactedUrl) { screenshotMessage = "Bild konnte nicht pseudonymisiert werden und wurde ausgelassen."; return; }
    const frame = ScreenshotFrameSchema.safeParse({ snapshotId: before.id, capturedAt, dataUrl: redactedUrl });
    if (!frame.success) { screenshotMessage = "Dieses Bild war zu groß und wurde ausgelassen."; return; }
    targetBuffer.record({ snapshot: after });
    targetBuffer.addScreenshot(frame.data);
    screenshotMessage = "";
    if (targetBuffer === buffer) schedulePersistence();
  } catch { screenshotMessage = "Bildaufnahme nicht verfügbar. Klicke das Lotse-Symbol im aktiven App-Tab."; }
  finally { capturing = false; }
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
    const text = pseudonymizer.restoreText(result.offer || `Soll ich dir zeigen, wie es weitergeht? (${question})`).slice(0, 140);
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
  if (source !== "proactive") { lastQuestion = { text: pseudonymizer.restoreText(question.trim()), source }; dropOffer(true); }
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

function appContext() {
  return { role: settings.role || undefined, appKnowledge: settings.appKnowledge || undefined };
}

async function requestHelp(
  tabId: number, snapshot: ObservationSnapshot, observation: ObservationContext | null, question: string,
  intent: InferredIntent | undefined, source: Source, extra: { offerId?: string; prefetch?: Prefetch } = {},
): Promise<AskResponse> {
  const epoch = generation;
  if (observation && !settings.screenshots) observation = { ...observation, screenshots: [] };
  const safeQuestion = pseudonymizer.pseudonymizeText(question).trim().slice(0, 500) || question.trim().slice(0, 500);
  const safeObservation = observation ? pseudonymizer.pseudonymizePayload(observation) : undefined;
  const safeIntent = intent ? pseudonymizer.pseudonymizePayload(intent) : undefined;
  const safeContext = pseudonymizer.pseudonymizePayload(appContext());
  const body = AskRequestSchema.parse({ question: safeQuestion, source, snapshot, observation: safeObservation, recentEvents: safeObservation?.workflow.events.slice(-50), intent: safeIntent, ...safeContext });
  const ctx: HelpContext = extra.prefetch?.ctx ?? { tabId, snapshotId: snapshot.id, source, offerId: extra.offerId, cleared: false };
  let streamed = false;
  const route = async (event: RenderEvent) => {
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    const job = extra.prefetch;
    if (!job) { await deliver(ctx, event); return; }
    if (job.live) { job.chain = job.chain.then(() => deliver(ctx, event)).catch(() => undefined); await job.chain; }
    else job.events.push(event);
  };
  const answer = pseudonymizer.restoreAskResponse(AskResponseSchema.parse(await callRuntime("ask", {
    body,
    onGuidance: async (event) => {
      if (event.type === "point" || event.type === "plan" || event.type === "say") { streamed = true; await route(event); }
    },
  })));
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
    if (ctx.source === "voice" && settings.speak) {
      const speechText = pseudonymizer.toSpeechSafeText(event.text);
      void Promise.resolve().then(() => speak(speechText)).catch(() => undefined);
    }
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
// Runtime HTTP
// ---------------------------------------------------------------------------

type Endpoint = "state" | "intent" | "decide" | "ask" | "feedback" | "prefs" | "events";
type CallOptions = { method?: "GET" | "POST" | "PUT"; body?: unknown; onGuidance?: (event: GuidanceEvent) => Promise<void>; abortable?: boolean };

/** Inference calls are abortable (pause/preemption); feedback, prefs and analytics run independently. */
async function callRuntime(endpoint: Endpoint, { method = "POST", body, onGuidance, abortable = true }: CallOptions = {}): Promise<unknown> {
  const controller = new AbortController();
  if (abortable) requestController = controller;
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const payload = (body ?? {}) as { snapshot?: ObservationSnapshot; context?: ObservationContext; appId?: string };
    const snapshotUrl = payload.snapshot?.url ?? payload.context?.snapshot.url;
    const appHost = payload.appId ?? (snapshotUrl ? new URL(snapshotUrl).host : lastAppHost);
    const headers: Record<string, string> = { [LOTSE_HEADERS.session]: sessionId };
    if (appHost) headers[LOTSE_HEADERS.app] = appHost;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    if (endpoint === "ask") headers.Accept = "application/x-ndjson";
    const safeBody = body === undefined ? undefined : pseudonymizer.pseudonymizePayload(body);
    const response = await fetch(`${LOTSE_DEFAULTS.serverUrl}/api/lotse/${endpoint}`, {
      method, headers, body: safeBody === undefined ? undefined : JSON.stringify(safeBody), signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 404 && endpoint !== "feedback") throw new Error("Lotse wartet auf den /api/lotse/" + endpoint + "-Endpunkt.");
      if (response.status === 429) throw new Error("Lotse hat gerade zu viele Anfragen. Versuche es gleich noch einmal.");
      throw new Error(`Die Hilfe ist derzeit nicht verfügbar (Server ${response.status}).`);
    }
    if (endpoint === "events") return null;
    if (endpoint === "ask" && response.headers.get("content-type")?.includes("ndjson")) return await readGuidance(response, onGuidance);
    return await response.json();
  } catch (error) {
    if (controller.signal.aborted) throw new Error("Die Anfrage wurde abgebrochen oder dauerte zu lange.");
    if (error instanceof TypeError) throw new Error("Der Lotse-Server ist nicht erreichbar. Starte npm run dev:server.");
    throw error;
  } finally { clearTimeout(timeout); if (requestController === controller) requestController = null; }
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
    const event = pseudonymizer.restoreGuidanceEvent(GuidanceEventSchema.parse(JSON.parse(line)));
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
  return { recording, tabId: recordingTab, busy, busyMode, settings,
    decision: pseudonymizer.restoreDecision(decision),
    inference: pseudonymizer.restoreInference(inference),
    stateCount: buffer.states.length,
    message: pseudonymizer.restoreText(message),
    screenshotMessage,
    eventCount: buffer.events.length, snapshotCount: buffer.snapshots.length, screenshotCount: buffer.screenshots.length,
    elementCount: context?.snapshot.elements.length ?? 0, workflowId: context?.workflow.id ?? null,
    events: context?.workflow.events.slice(-8) ?? [],
    offer: pendingOffer ? { offerId: pendingOffer.id, text: pseudonymizer.restoreText(pendingOffer.text) } : null,
    plan: plan && step ? { index: plan.index, total: plan.steps.length, label: pseudonymizer.restoreText(step.label), hint: step.hint ? pseudonymizer.restoreText(step.hint) : undefined } : null,
    threshold, prefsMessage, snoozedUntil: snoozeUntil > Date.now() ? snoozeUntil : null,
    voiceState, lastQuestion, analyticsQueued: analytics.length,
  };
}

function schedulePersistence() {
  if (persistenceTimer !== undefined) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = undefined;
    const saved: SavedSession = {
      recording, recordingTab, buffer: buffer.serialize(), decision, inference, sessionId,
      plan, snoozeUntil, lastDecisionAt, threshold, analytics, pseudonyms: pseudonymizer.serialize(),
    };
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
  try {
    const saved = (await browser.storage.session.get(STORE))[STORE] as Partial<SavedSession> | undefined;
    if (!saved || typeof saved !== "object") return;
    pseudonymizer.restore(saved.pseudonyms);
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
