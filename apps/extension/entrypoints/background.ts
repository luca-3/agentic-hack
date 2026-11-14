import {
  AskRequestSchema, AskResponseSchema, DecideRequestSchema, DecideResponseSchema,
  UIStateRequestSchema, UIStateInferenceSchema, IntentRequestSchema, WorkflowIntentSchema, GuidanceEventSchema,
  LOTSE_DEFAULTS, LOTSE_HEADERS, LotseEventSchema, ObservationSnapshotSchema, ScreenshotFrameSchema,
  type AskResponse, type DecideResponse, type ExtensionMessage, type LotseEvent, type WorkflowIntent, type GuidanceEvent,
  type ObservationContext, type ObservationSnapshot,
} from "@lotse/shared";
import { ObservationBuffer, findStuckSignal } from "../utils/observation";

type Settings = { screenshots: boolean; role: string; appKnowledge: string };
type SavedSession = { recording: boolean; recordingTab: number | null; settings: Settings; buffer: unknown; decision: unknown; inference: unknown; sessionId: string };
export type LotseStatus = {
  recording: boolean; tabId: number | null; busy: boolean; settings: Settings;
  busyMode: "proactive" | "question" | null;
  eventCount: number; snapshotCount: number; screenshotCount: number; elementCount: number;
  workflowId: string | null; decision: DecideResponse | null; inference: WorkflowIntent | null; stateCount: number;
  message: string; screenshotMessage: string; events: LotseEvent[];
};
export type LotseResult =
  | { ok: true; status: LotseStatus; answer?: AskResponse }
  | { ok: false; error: string };

const buffer = new ObservationBuffer();
let settings: Settings = { screenshots: true, role: "", appKnowledge: "" };
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
const STORE = "lotse-observation-session";
const localUrl = (url?: string): boolean => {
  if (!url) return false;
  try { const u = new URL(url); return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname); }
  catch { return false; }
};

export default defineBackground(() => {
  const ready = restore();
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => undefined);
  browser.runtime.onMessage.addListener((incoming: ExtensionMessage, sender, respond) => {
    ready.then(() => handle(incoming, sender.tab?.id)).then(
      (result) => respond(result),
      (error: unknown) => respond({ ok: false, error: errorText(error) } satisfies LotseResult),
    );
    return true;
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
          await browser.tabs.sendMessage(tabId, { type: "lotse:start" } satisfies ExtensionMessage);
          buffer.record({ snapshot: await snapshotOf(tabId) });
          schedulePersistence();
        }
      }).catch(() => undefined);
    }
  });
  browser.tabs.onRemoved.addListener((tabId) => { if (tabId === recordingTab) void ready.then(stop); });
  // Chrome API calls keep the worker active during recording; session storage survives suspension.
  setInterval(() => { void ready.then(periodicCapture).catch(() => undefined); }, 5_000);
});

async function handle(incoming: ExtensionMessage, senderTab?: number): Promise<LotseResult> {
  switch (incoming.type) {
    case "lotse:start": await start(); break;
    case "lotse:stop": await stop(); break;
    case "lotse:status": break;
    case "lotse:settings": {
      const s = incoming.settings;
      if (typeof s?.screenshots !== "boolean" || typeof s.role !== "string" || typeof s.appKnowledge !== "string" || s.role.length > 100 || s.appKnowledge.length > 12_000) throw new Error("Ungültige Einstellungen.");
      settings = { screenshots: s.screenshots, role: s.role.trim(), appKnowledge: s.appKnowledge.trim() };
      if (!settings.screenshots) buffer.screenshots = [];
      schedulePersistence();
      break;
    }
    case "lotse:observe": {
      if (!recording || senderTab !== recordingTab) break;
      const oldWorkflow = buffer.workflow?.id;
      const event = incoming.event ? LotseEventSchema.parse(incoming.event) : undefined;
      const snapshot = incoming.snapshot ? ObservationSnapshotSchema.parse(incoming.snapshot) : undefined;
      if (snapshot && !localUrl(snapshot.url)) break;
      buffer.record({ event, snapshot });
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
    default: throw new Error("Diese Nachricht ist für das Content Script bestimmt.");
  }
  return { ok: true, status: status() };
}

async function activeAppTab() {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined || !localUrl(tab.url)) throw new Error("Öffne eine freigegebene localhost-App im aktiven Tab.");
  return tab as typeof tab & { id: number };
}

async function snapshotOf(tabId: number): Promise<ObservationSnapshot> {
  try {
    const snapshot = ObservationSnapshotSchema.parse(await browser.tabs.sendMessage(tabId, { type: "lotse:snapshot" } satisfies ExtensionMessage));
    if (!localUrl(snapshot.url)) throw new Error("App nicht freigegeben.");
    return snapshot;
  } catch { throw new Error("Lotse ist auf dieser Seite noch nicht aktiv. Lade die App-Seite neu."); }
}

async function start() {
  const tab = await activeAppTab();
  if (recording && recordingTab === tab.id) return;
  await stop();
  buffer.clear();
  recordingTab = tab.id; recording = true;
  lastInferenceKey = ""; lastDecisionAt = 0; decision = null; inference = null;
  try {
    await browser.tabs.sendMessage(tab.id, { type: "lotse:start" } satisfies ExtensionMessage);
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
  const oldTab = recordingTab;
  recording = false; recordingTab = null;
  if (oldTab !== null) {
    await browser.tabs.sendMessage(oldTab, { type: "lotse:stop" } satisfies ExtensionMessage).catch(() => undefined);
    await browser.tabs.sendMessage(oldTab, { type: "lotse:clear" } satisfies ExtensionMessage).catch(() => undefined);
  }
  message = "Beobachtung pausiert. Der lokale Verlauf läuft nach drei Minuten ab.";
  schedulePersistence();
}

async function periodicCapture() {
  const countBefore = buffer.events.length + buffer.snapshots.length + buffer.screenshots.length;
  buffer.getContext({ includeScreenshots: false });
  if (countBefore !== buffer.events.length + buffer.snapshots.length + buffer.screenshots.length) schedulePersistence();
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
    const frame = ScreenshotFrameSchema.safeParse({ snapshotId: before.id, capturedAt, dataUrl });
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

async function maybeIntervene() {
  if (busy || !recording || recordingTab === null || !inferencePending) return;
  const tab = await activeAppTab().catch(() => null);
  if (!tab || tab.id !== recordingTab || busy) return;
  busy = true; busyMode = "proactive";
  const owner = ++busyOwner;
  const epoch = generation;
  const tabId = recordingTab;
  inferencePending = false;
  try {
    const snapshot = await snapshotOf(tabId);
    buffer.record({ snapshot });
    const context = buffer.getContext({ includeScreenshots: false });
    if (!context) return;
    const key = context.workflow.id + ":" + snapshot.id + ":" + (context.workflow.events.at(-1)?.id ?? "");
    if (key === lastInferenceKey) return;
    const current = () => epoch === generation && recording && recordingTab === tabId;
    message = "Lotse versteht den aktuellen UI-Zustand …";
    const stateBody = UIStateRequestSchema.parse({ snapshot, events: context.workflow.events });
    const state = UIStateInferenceSchema.parse(await post("state", stateBody));
    if (!current()) return;
    if (state.snapshotId !== snapshot.id) throw new Error("Die UI-Inferenz gehört zu einem anderen Seitenzustand.");
    buffer.addState({ ...state, capturedAt: snapshot.capturedAt });
    schedulePersistence();
    if ((await snapshotOf(tabId)).id !== snapshot.id) { queueInference(); return; }
    const textContext = buffer.getContext({ includeScreenshots: false });
    if (!textContext?.states?.length) return;
    message = "Lotse ordnet Workflow und Ziel ein …";
    const intentBody = IntentRequestSchema.parse({ context: textContext, ...appContext() });
    const understood = WorkflowIntentSchema.parse(await post("intent", intentBody));
    if (!current()) return;
    inference = understood;
    if ((await snapshotOf(tabId)).id !== snapshot.id) { queueInference(); return; }
    message = "Lotse prüft, ob Hilfe sinnvoll ist …";
    const signal = findStuckSignal(textContext);
    const trigger = signal?.type === "unsuccessful_searches" ? "repeated_search" :
      signal?.type === "route_ping_pong" ? "page_pingpong" : signal?.type ?? "workflow_update";
    const body = DecideRequestSchema.parse({
      trigger, events: textContext.workflow.events.slice(-50), snapshot,
      context: textContext, inference: understood, ...appContext(),
    });
    const result = DecideResponseSchema.parse(await post("decide", body));
    if (!current()) return;
    decision = result;
    lastInferenceKey = key;
    if (!result.intervene) { message = "Lotse beobachtet weiter."; return; }
    if (Date.now() - lastDecisionAt < 120_000) { message = "Lotse hält sich nach dem letzten Hinweis zurück."; return; }
    if (buffer.workflow?.id !== context.workflow.id) { queueInference(); return; }
    const latest = await snapshotOf(tabId);
    if (latest.id !== snapshot.id) { queueInference(); return; }
    buffer.record({ snapshot: latest });
    // Screenshots are attached only now, after the explicit intervention decision.
    await captureFrame(tabId, latest);
    if (!current()) return;
    const helpSnapshot = await snapshotOf(tabId);
    if (helpSnapshot.id !== snapshot.id) { queueInference(); return; }
    buffer.record({ snapshot: helpSnapshot });
    const answer = await requestHelp(tabId, helpSnapshot, buffer.getContext(), understood.intent.goal || understood.workflowName, understood.intent, "proactive");
    if (current()) { lastDecisionAt = Date.now(); message = answer.sentence; }
  } catch (error) { if (epoch === generation) message = errorText(error); }
  finally {
    if (owner === busyOwner) { busy = false; busyMode = null; if (inferencePending) queueInference(); }
    schedulePersistence();
  }
}

async function explicitQuestion(question: string, source: "text" | "voice" | "proactive" = "text"): Promise<AskResponse> {
  if (typeof question !== "string" || !question.trim() || question.length > 500) throw new Error("Bitte stelle eine Frage mit höchstens 500 Zeichen.");
  if (busy && busyMode === "proactive") { generation++; requestController?.abort(); busy = false; inferencePending = true; }
  if (busy) throw new Error("Lotse bearbeitet gerade einen Hinweis. Versuche es gleich noch einmal.");
  busy = true; busyMode = "question"; const owner = ++busyOwner;
  const epoch = generation;
  try {
    const tab = await activeAppTab();
    const snapshot = await snapshotOf(tab.id);
    const questionBuffer = tab.id === recordingTab ? buffer : new ObservationBuffer();
    questionBuffer.record({ snapshot });
    await captureFrame(tab.id, snapshot, questionBuffer);
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    const latest = await snapshotOf(tab.id);
    questionBuffer.record({ snapshot: latest });
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    message = "Lotse sucht den nächsten Schritt …";
    const knownIntent = tab.id === recordingTab ? inference?.intent : undefined;
    const answer = await requestHelp(tab.id, latest, questionBuffer.getContext(), question.trim(), knownIntent, source);
    if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
    message = answer.sentence;
    return answer;
  } catch (error) { if (epoch === generation) message = errorText(error); throw error; }
  finally { if (owner === busyOwner) { busy = false; busyMode = null; if (inferencePending) queueInference(); } schedulePersistence(); }
}

function appContext() {
  return { role: settings.role || undefined, appKnowledge: settings.appKnowledge || undefined };
}

async function requestHelp(tabId: number, snapshot: ObservationSnapshot, observation: ObservationContext | null, question: string, intent?: WorkflowIntent["intent"], source: "text" | "voice" | "proactive" = "text"): Promise<AskResponse> {
  const epoch = generation;
  if (observation && !settings.screenshots) observation = { ...observation, screenshots: [] };
  const body = AskRequestSchema.parse({ question, source, snapshot, observation: observation ?? undefined, recentEvents: observation?.workflow.events.slice(-50), intent, ...appContext() });
  let pointed = false;
  const point = async (elementNumber: number, sentence: string) => {
    if (epoch !== generation || (await activeAppTab()).id !== tabId) throw new Error("Die Anfrage wurde abgebrochen.");
    if ((await snapshotOf(tabId)).id !== snapshot.id) throw new Error("Die Seite hat sich verändert. Stelle die Frage erneut.");
    if (!snapshot.elements.some((element) => element.number === elementNumber && !element.disabled)) throw new Error("Das vorgeschlagene Element ist nicht verfügbar.");
    const result = await browser.tabs.sendMessage(tabId, { type: "lotse:highlight", elementNumber, sentence, snapshotId: snapshot.id } satisfies ExtensionMessage);
    if (!result?.ok) throw new Error("Das Element kann gerade nicht hervorgehoben werden.");
    pointed = true;
  };
  const answer = AskResponseSchema.parse(await post("ask", body, async (event) => {
    if (event.type === "point") await point(event.elementNumber, event.hint ?? event.label);
    else if (event.type === "plan") {
      const first = event.steps[0];
      if (first) {
        const matches = snapshot.elements.filter((element) => element.label.toLocaleLowerCase() === first.label.toLocaleLowerCase());
        const number = first.elementNumber ?? (matches.length === 1 ? matches[0]?.number : undefined);
        if (number !== undefined) await point(number, first.hint ?? first.label);
      }
    }
  }));
  if (epoch !== generation) throw new Error("Die Anfrage wurde abgebrochen.");
  if (answer.snapshotId && answer.snapshotId !== snapshot.id) throw new Error("Der Hinweis gehört zu einem anderen Seitenzustand.");
  if (answer.elementNumber !== null && !pointed) {
    if ((await activeAppTab()).id !== tabId) throw new Error("Der App-Tab ist nicht mehr aktiv. Stelle die Frage dort erneut.");
    const current = await snapshotOf(tabId);
    if (current.id !== snapshot.id) throw new Error("Die Seite hat sich verändert. Stelle die Frage erneut.");
    if (!snapshot.elements.some((element) => element.number === answer.elementNumber && !element.disabled)) throw new Error("Das vorgeschlagene Element ist nicht verfügbar.");
    const result = await browser.tabs.sendMessage(tabId, { type: "lotse:highlight", elementNumber: answer.elementNumber, sentence: answer.sentence, snapshotId: snapshot.id } satisfies ExtensionMessage);
    if (!result?.ok) throw new Error("Das Element kann gerade nicht hervorgehoben werden.");
  }
  return answer;
}

async function post(endpoint: "state" | "intent" | "decide" | "ask", body: unknown, onGuidance?: (event: GuidanceEvent) => Promise<void>): Promise<unknown> {
  const controller = new AbortController();
  requestController = controller;
  const timeout = setTimeout(() => controller.abort(), 20_000);
  try {
    const payload = body as { snapshot?: ObservationSnapshot; context?: ObservationContext; appId?: string };
    const appHost = payload.appId ?? new URL(payload.snapshot?.url ?? payload.context?.snapshot.url ?? LOTSE_DEFAULTS.serverUrl).host;
    const response = await fetch(`${LOTSE_DEFAULTS.serverUrl}/api/lotse/${endpoint}`, {
      method: "POST", headers: { "Content-Type": "application/json", [LOTSE_HEADERS.session]: sessionId, [LOTSE_HEADERS.app]: appHost, ...(endpoint === "ask" ? { Accept: "application/x-ndjson" } : {}) },
      body: JSON.stringify(body), signal: controller.signal,
    });
    if (!response.ok) {
      if (response.status === 404) throw new Error("Lotse wartet auf den /api/lotse/" + endpoint + "-Endpunkt.");
      throw new Error(`Die Hilfe ist derzeit nicht verfügbar (Server ${response.status}).`);
    }
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
    const event = GuidanceEventSchema.parse(JSON.parse(line));
    received = true;
    if (event.type === "error") throw new Error(event.message);
    if (event.type === "point") { answer.elementNumber = event.elementNumber; answer.sentence = event.hint ?? event.label; }
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

function status(): LotseStatus {
  const context = buffer.getContext({ includeScreenshots: false });
  return { recording, tabId: recordingTab, busy, busyMode, settings, decision, inference, stateCount: buffer.states.length, message, screenshotMessage,
    eventCount: buffer.events.length, snapshotCount: buffer.snapshots.length, screenshotCount: buffer.screenshots.length,
    elementCount: context?.snapshot.elements.length ?? 0, workflowId: context?.workflow.id ?? null,
    events: context?.workflow.events.slice(-8) ?? [],
  };
}

function schedulePersistence() {
  if (persistenceTimer !== undefined) clearTimeout(persistenceTimer);
  persistenceTimer = setTimeout(() => {
    persistenceTimer = undefined;
    void browser.storage.session.set({ [STORE]: { recording, recordingTab, settings, buffer: buffer.serialize(), decision, inference, sessionId } }).catch(() => { message = "Der lokale Verlauf konnte nicht gespeichert werden."; });
  }, 700);
}

async function restore() {
  try {
    const saved = (await browser.storage.session.get(STORE))[STORE] as Partial<SavedSession> | undefined;
    if (!saved || typeof saved !== "object") return;
    if (typeof saved.settings?.screenshots === "boolean" && typeof saved.settings.role === "string" && typeof saved.settings.appKnowledge === "string" && saved.settings.role.length <= 100 && saved.settings.appKnowledge.length <= 12_000) settings = saved.settings;
    buffer.restore(saved.buffer);
    recordingTab = typeof saved.recordingTab === "number" ? saved.recordingTab : null;
    recording = saved.recording === true && recordingTab !== null;
    const savedDecision = DecideResponseSchema.safeParse(saved.decision);
    decision = savedDecision.success ? savedDecision.data : null;
    const savedInference = WorkflowIntentSchema.safeParse(saved.inference);
    inference = savedInference.success ? savedInference.data : null;
    if (typeof saved.sessionId === "string" && saved.sessionId.length <= 100) sessionId = saved.sessionId;
    if (recording && recordingTab !== null) {
      const tab = await browser.tabs.get(recordingTab).catch(() => null);
      if (!tab || !localUrl(tab.url)) { recording = false; recordingTab = null; }
      else message = "Lotse beobachtet diese App weiter.";
    }
    schedulePersistence();
  } catch { recording = false; recordingTab = null; buffer.clear(); }
}
