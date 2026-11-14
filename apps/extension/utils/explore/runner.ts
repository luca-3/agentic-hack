/**
 * Exploration runner (service worker, D-25): breadth-first over the app's pages in ONE tab, driven from here so it
 * survives page loads and worker restarts (state in chrome.storage.session). Per page: navigate by URL → content script
 * scans and probes (./scan.ts) and reports pages + links → links go into the queue. Then the pseudonymized page map
 * goes to POST /api/lotse/explore with the admin's Bearer token; suggestions appear in the dashboard ("Lernen").
 *
 * Gates: signed in, org admin, app known + allowed (D-27), never a blocked route, same origin only, EXPLORE_LIMITS.
 */
import {
  EXPLORE_LIMITS, EXPLORE_NEVER_CLICK, ExploredPageSchema, ExploreRequestSchema, ExploreResponseSchema, LOTSE_DEFAULTS, LOTSE_HEADERS,
  type ExploredPage, type ExploreRequest, type ExploreResponse, type PolicyResponse,
} from "@lotse/shared";
import * as auth from "../auth";
import { hostOf, pageVerdict } from "../policy";
import * as pseudo from "../pseudonymize";
import { isOrgAdmin } from "./admin";
import {
  EXPLORE_WORKER_TYPES, type ExploreMessage, type ExplorePhase, type ExploreReply, type ExploreStatus, type FoundMessage, type ScanRequest, type ScanResult,
} from "./messages";
import { navigableUrl, routeOf, visitKey } from "./safety";

export type ExplorerDeps = {
  /** background.ts policy cache (GET /api/lotse/policy, fail closed: null = unknown). */
  pagePolicy(url: string | undefined): Promise<PolicyResponse | null>;
  /** Stop the normal observation first: crawler navigations must not end up in events, analytics or inference. */
  stopObservation(): Promise<void>;
};

type QueueItem = { url: string; reachedVia: string[] };
type RunState = {
  phase: ExplorePhase; runId: string; tabId: number | null; origin: string; appHost: string; appName: string | null;
  startUrl: string; startedAt: number; endedAt: number | null; deadline: number; blockedRoutes: string[];
  queue: QueueItem[]; seen: string[]; probed: string[]; current: QueueItem | null;
  pages: ExploredPage[]; recordedPages: number; recordedElements: number;
  message: string; result: ExploreResponse | null;
};
type Gate =
  | { ok: true; reason: string; tabId: number; url: string; origin: string; host: string; policy: PolicyResponse }
  | { ok: false; reason: string; host: string | null; appName: string | null };

const STORE = "lotse-explore";
const MAX_QUEUE = 300;
const MAX_DEPTH = 8; // labels in a click path
const LOAD_TIMEOUT_MS = 10_000;
const SCAN_TIMEOUT_MS = 60_000;
const BODY_LIMIT = 3_800_000; // server reads up to 4 MB
const READY_TEXT = "Lotse öffnet jede Seite, Reiter, Menüs und Dialoge – nur Navigation: nichts wird ausgefüllt, gespeichert, gesendet oder gelöscht. Höchstens 3 Minuten.";

let deps: ExplorerDeps | null = null;
let state: RunState = idleState();
let loaded: Promise<void> | null = null;
let looping = false;
let persistTimer: ReturnType<typeof setTimeout> | undefined;

export function setupExplorer(dependencies: ExplorerDeps) {
  deps = dependencies;
  browser.runtime.onMessage.addListener((incoming: ExploreMessage, sender, respond) => {
    if (!incoming || typeof incoming !== "object" || !EXPLORE_WORKER_TYPES.has(incoming.type)) return false;
    ready().then(() => handle(incoming, sender.tab?.id)).then(
      (status) => respond((status ? { ok: true, status } : { ok: true }) satisfies ExploreReply),
      (error: unknown) => respond({ ok: false, error: errorText(error) } satisfies ExploreReply),
    );
    return true;
  });
  browser.tabs.onRemoved.addListener((tabId) => {
    void ready().then(() => (state.tabId === tabId && state.phase === "running" ? stopRun("Der Erkundungs-Tab wurde geschlossen.") : undefined));
  });
  // Worker restarted mid-run: continue with the next queued page.
  void ready().then(() => { if (state.phase === "running") void loop(state.runId); });
}

/**
 * True while the crawler drives a tab. background.ts `start()` refuses then — otherwise auto-activation (D-29) would
 * restart the observation and crawler navigations would end up in events, analytics and inference.
 */
export function explorationRunning(): boolean {
  return state.phase === "running";
}

async function handle(message: ExploreMessage, senderTab: number | undefined): Promise<ExploreStatus | null> {
  switch (message.type) {
    case "lotse:explore-found": await ingest(message, senderTab); return null;
    case "lotse:explore-start": await startRun(); break;
    case "lotse:explore-stop": if (state.phase === "running") await stopRun("Erkundung gestoppt."); break;
    case "lotse:explore-send":
      if (state.phase !== "stopped" && state.phase !== "error") break;
      if (!state.pages.length) throw new Error("Es wurde noch keine Seite erfasst.");
      void sendMap(); // takes up to a minute; the side panel polls the status
      break;
    case "lotse:explore-discard":
      if (state.phase !== "running" && state.phase !== "sending") { state = idleState(); await persist(true); }
      break;
    default: break;
  }
  return status();
}

// ---------------------------------------------------------------------------
// Start gate: signed-in org admin, known + allowed app, not on a blocked route
// ---------------------------------------------------------------------------

const localApp = (url?: string) => {
  try { const u = new URL(url ?? ""); return u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname); }
  catch { return false; }
};

async function startGate(): Promise<Gate> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true }).catch(() => []);
  const host = tab && localApp(tab.url) ? hostOf(tab.url) : null;
  const no = (reason: string, appName: string | null = null): Gate => ({ ok: false, reason, host, appName });
  if (tab?.id === undefined || !host || !tab.url) return no("Öffne die App (localhost) im aktiven Tab.");
  if (!(await auth.currentUser().catch(() => null))) return no("Melde dich oben mit deinem Admin-Konto an. Nur Org-Admins können eine App erkunden.");
  const policy = await deps!.pagePolicy(tab.url);
  if (!policy) return no("Lotse kann die Freigabe dieser App gerade nicht prüfen (Lotse-Server erreichbar?).");
  if (!policy.known) return no(`Diese App ist noch keiner Organisation zugeordnet. Lege sie im Dashboard unter Apps an (Domain ${host}).`);
  if (!policy.allowed) return no(policy.reason ?? "Diese App ist für Lotse nicht freigegeben.", policy.appName);
  if (!policy.member || !policy.orgName) return no("Dein Konto gehört nicht zur Organisation dieser App.", policy.appName);
  if (pageVerdict(tab.url, policy).paused) return no("Auf dieser Seite ist Lotse pausiert (geschützte Daten). Starte auf einer freigegebenen Seite der App.", policy.appName);
  const admin = await isOrgAdmin(policy.orgName);
  if (admin === null) return no("Deine Admin-Rechte konnten gerade nicht geprüft werden. Versuche es gleich noch einmal.", policy.appName);
  if (!admin) return no("Nur Org-Admins dürfen eine App erkunden. Mitarbeitende lösen keine Erkundung aus.", policy.appName);
  return { ok: true, reason: READY_TEXT, tabId: tab.id, url: tab.url, origin: new URL(tab.url).origin, host, policy };
}

async function startRun() {
  if (state.phase === "running" || state.phase === "sending") throw new Error("Es läuft bereits eine Erkundung.");
  const gate = await startGate();
  if (!gate.ok) throw new Error(gate.reason);
  await deps!.stopObservation().catch(() => undefined);
  const now = Date.now();
  const startUrl = navigableUrl(gate.url, gate.url, gate.origin, gate.policy.blockedRoutes) ?? gate.url;
  state = {
    ...idleState(),
    phase: "running", runId: crypto.randomUUID(), tabId: gate.tabId, origin: gate.origin, appHost: gate.host, appName: gate.policy.appName,
    startUrl, startedAt: now, deadline: now + EXPLORE_LIMITS.maxDurationMs, blockedRoutes: gate.policy.blockedRoutes,
    queue: [{ url: startUrl, reachedVia: [] }], seen: [visitKey(startUrl)], message: "Lotse erkundet die App …",
  };
  await persist(true);
  void loop(state.runId);
}

// ---------------------------------------------------------------------------
// Crawl loop
// ---------------------------------------------------------------------------

const running = (runId: string) => state.phase === "running" && state.runId === runId;

async function loop(runId: string) {
  if (looping) return;
  looping = true;
  try {
    while (running(runId)) {
      if (Date.now() >= state.deadline) { await finish("Zeitlimit erreicht."); break; }
      if (state.recordedPages >= EXPLORE_LIMITS.maxPages) { await finish(`Limit von ${EXPLORE_LIMITS.maxPages} Einträgen erreicht.`); break; }
      const next = state.queue.shift();
      if (!next) { await finish("Alle erreichbaren Seiten erkundet."); break; }
      state.current = next;
      await persist(true);
      await visit(next, runId);
      if (running(runId)) { state.current = null; await persist(true); }
    }
  } catch (error) {
    if (running(runId)) await stopRun(`Erkundung unterbrochen: ${errorText(error)}`);
  } finally {
    looping = false;
  }
}

async function visit(item: QueueItem, runId: string) {
  const tabId = state.tabId;
  if (tabId === null) throw new Error("Kein Erkundungs-Tab.");
  // Never navigate into a blocked route (D-27); refresh the policy (blocklist may change) before every page.
  const policy = await deps!.pagePolicy(item.url);
  if (!policy || pageVerdict(item.url, policy).paused) return;
  state.blockedRoutes = policy.blockedRoutes;

  // Hash-route changes ("#/…") stay in the same document: no load event, the content script stays.
  const before = (await browser.tabs.get(tabId)).url ?? "";
  const sameDocument = before !== item.url && before.split("#")[0] === item.url.split("#")[0];
  const loadedPage = sameDocument ? new Promise((resolve) => setTimeout(resolve, 800)) : waitForLoad(tabId);
  await browser.tabs.update(tabId, { url: item.url });
  await loadedPage;
  if (!running(runId)) return;
  const tab = await browser.tabs.get(tabId);
  if (!tab.url || !localApp(tab.url) || new URL(tab.url).origin !== state.origin) return; // redirected elsewhere
  if (pageVerdict(tab.url, await deps!.pagePolicy(tab.url)).paused) return; // redirected into a blocked route

  const request: ScanRequest = {
    type: "lotse:explore-scan", runId, reachedVia: item.reachedVia, blockedRoutes: state.blockedRoutes,
    neverClick: [...EXPLORE_NEVER_CLICK], probed: state.probed, budget: EXPLORE_LIMITS.maxPages - state.recordedPages,
    maxElements: EXPLORE_LIMITS.maxElementsPerPage, deadline: state.deadline, pagesSoFar: state.recordedPages,
  };
  const result = await scanTab(tabId, request);
  if (result?.ok && running(runId)) state.probed = [...new Set([...state.probed, ...result.probed])].slice(-500);
}

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const listener = (id: number, info: { status?: string }) => { if (id === tabId && info.status === "complete") done(); };
    const timer = setTimeout(done, LOAD_TIMEOUT_MS);
    function done() { clearTimeout(timer); browser.tabs.onUpdated.removeListener(listener); resolve(); }
    browser.tabs.onUpdated.addListener(listener);
  });
}

/** Content scripts register at document_idle — retry while the receiving end does not exist yet. */
async function scanTab(tabId: number, request: ScanRequest): Promise<ScanResult | null> {
  for (let attempt = 0; attempt < 8; attempt++) {
    try {
      const timeout = Math.min(SCAN_TIMEOUT_MS, Math.max(5_000, state.deadline - Date.now() + 5_000));
      return (await withTimeout(browser.tabs.sendMessage(tabId, request), timeout)) as ScanResult;
    } catch (error) {
      if (!/receiving end does not exist|could not establish connection/i.test(errorText(error)) || !running(request.runId)) return null;
      await new Promise((resolve) => setTimeout(resolve, 400));
    }
  }
  return null;
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => { timer = setTimeout(() => reject(new Error("Zeitüberschreitung beim Erkunden der Seite.")), ms); }),
  ]).finally(() => clearTimeout(timer));
}

/**
 * Pages and links from the content script: validate against the contract, queue new links. The page's content strings
 * go into the D-26 session mapping now; the whole map is pseudonymized right before it leaves the browser (sendMap),
 * so terms learned on later pages also cover earlier ones.
 */
async function ingest(found: FoundMessage, senderTab: number | undefined) {
  if (state.phase !== "running" || found.runId !== state.runId || senderTab !== state.tabId) return;
  if (Array.isArray(found.terms) && found.terms.length) {
    await pseudo.learnPrivacy({ terms: found.terms, rects: [], viewport: { width: 0, height: 0 } }).catch(() => undefined);
  }
  for (const raw of Array.isArray(found.pages) ? found.pages : []) {
    if (state.recordedPages >= EXPLORE_LIMITS.maxPages) break;
    const parsed = ExploredPageSchema.safeParse(raw);
    if (!parsed.success) continue;
    state.pages.push(parsed.data);
    state.recordedPages++;
    state.recordedElements += parsed.data.elements.length;
  }
  for (const link of Array.isArray(found.links) ? found.links : []) {
    if (typeof link?.url !== "string" || !Array.isArray(link.reachedVia) || link.reachedVia.length > MAX_DEPTH) continue;
    const url = navigableUrl(link.url, state.origin, state.origin, state.blockedRoutes);
    if (!url || state.queue.length >= MAX_QUEUE) continue;
    const key = visitKey(url);
    if (state.seen.includes(key)) continue;
    state.seen.push(key);
    state.queue.push({ url, reachedVia: link.reachedVia.map((step) => String(step).slice(0, 120)) });
  }
  void persist();
}

// ---------------------------------------------------------------------------
// End: stop, finish, send
// ---------------------------------------------------------------------------

async function endInTab(navigateHome: boolean) {
  const tabId = state.tabId;
  if (tabId === null) return;
  await browser.tabs.sendMessage(tabId, { type: "lotse:explore-end" } satisfies ExploreMessage).catch(() => undefined);
  if (navigateHome && state.startUrl) await browser.tabs.update(tabId, { url: state.startUrl }).catch(() => undefined);
}

async function stopRun(reason: string) {
  state.phase = "stopped";
  state.endedAt = Date.now();
  state.current = null;
  state.message = state.recordedPages
    ? `${reason} ${state.recordedPages} Einträge erfasst – jetzt auswerten lassen oder verwerfen.`
    : `${reason} Es wurde noch keine Seite erfasst.`;
  await persist(true);
  await endInTab(false);
}

async function finish(reason: string) {
  state.endedAt = Date.now();
  state.current = null;
  await endInTab(true);
  if (!state.recordedPages) {
    state.phase = "error";
    state.message = `${reason} Es wurde keine Seite erfasst (geschützt oder nicht erreichbar).`;
    await persist(true);
    return;
  }
  state.message = reason;
  await sendMap();
}

async function sendMap() {
  state.phase = "sending";
  state.message = `Lotse wertet ${state.recordedPages} Einträge aus (bis zu einer Minute) …`;
  await persist(true);
  try {
    // D-26: labels, titles, headings and click paths carry placeholders ([Kunde-1] …) from here on.
    const pages = await pseudo.pseudonymizeExploredPages(fit(state.pages));
    const body = ExploreRequestSchema.parse({
      appHost: state.appHost, pages, durationMs: Math.max(0, (state.endedAt ?? Date.now()) - state.startedAt),
    });
    const result = ExploreResponseSchema.parse(await postExplore(body));
    state.phase = "done";
    state.result = result;
    state.message = `Fertig: ${result.features} Funktionen und ${result.findings} Design-Hinweise vorgeschlagen. Ergebnisse im Dashboard unter „Lernen“ prüfen und übernehmen.`;
    state.pages = []; // data minimization: the (pseudonymized) map is on the server now
    state.queue = [];
  } catch (error) {
    state.phase = "error";
    state.message = errorText(error);
  }
  await persist(true);
}

/** Keep the body under the server's 4 MB cap by trimming elements per page. */
function fit(pages: ExploredPage[]): ExploredPage[] {
  let out = pages;
  let max: number = EXPLORE_LIMITS.maxElementsPerPage;
  while (JSON.stringify(out).length > BODY_LIMIT && max > 20) {
    max = Math.floor(max * 0.7);
    out = pages.map((page) => ({ ...page, elements: page.elements.slice(0, max) }));
  }
  return out;
}

async function postExplore(body: ExploreRequest): Promise<unknown> {
  const call = (token: string) => fetch(`${LOTSE_DEFAULTS.serverUrl}/api/lotse/explore`, {
    method: "POST",
    headers: { "Content-Type": "application/json", [LOTSE_HEADERS.app]: body.appHost, Authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(120_000),
  });
  let token = await auth.accessToken().catch(() => null);
  if (!token) throw new Error("Bitte melde dich mit deinem Admin-Konto an und sende erneut.");
  let response = await call(token);
  if (response.status === 401) {
    token = (await auth.refreshSession().catch(() => null))?.accessToken ?? null;
    if (!token) throw new Error("Die Anmeldung ist abgelaufen. Bitte melde dich neu an und sende erneut.");
    response = await call(token);
  }
  const data = (await response.json().catch(() => ({}))) as { error?: unknown };
  if (response.ok) return data;
  const serverText = typeof data.error === "string" ? data.error.slice(0, 300) : "";
  if (response.status === 401) throw new Error("Die Anmeldung ist abgelaufen. Bitte melde dich neu an und sende erneut.");
  if (response.status === 403) throw new Error(serverText || "Nur Org-Admins dürfen eine App erkunden.");
  if (response.status === 404) throw new Error(`${serverText || "App nicht gefunden."} Lege die App mit der Domain ${body.appHost} im Dashboard an.`);
  if (response.status === 429) throw new Error("Lotse hat gerade zu viele Anfragen. Sende gleich noch einmal.");
  throw new Error(serverText || `Die Auswertung ist fehlgeschlagen (Server ${response.status}).`);
}

// ---------------------------------------------------------------------------
// Status + persistence
// ---------------------------------------------------------------------------

async function status(): Promise<ExploreStatus> {
  const busy = state.phase === "running" || state.phase === "sending";
  const gate = busy ? null : await startGate().catch(() => null);
  const end = state.endedAt ?? Date.now();
  return {
    phase: state.phase,
    canStart: Boolean(gate?.ok),
    reason: gate?.reason ?? "",
    appHost: state.appHost || gate?.host || null,
    appName: state.appName ?? (gate?.ok ? gate.policy.appName : gate?.appName) ?? null,
    pages: state.recordedPages,
    elements: state.recordedElements,
    queued: state.queue.length,
    currentRoute: state.current ? routeOf(state.current.url) : null,
    elapsedMs: state.startedAt ? Math.max(0, end - state.startedAt) : 0,
    limitMs: EXPLORE_LIMITS.maxDurationMs,
    maxPages: EXPLORE_LIMITS.maxPages,
    message: state.message,
    result: state.result,
    dashboardUrl: `${LOTSE_DEFAULTS.dashboardUrl}/lernen`,
  };
}

function idleState(): RunState {
  return {
    phase: "idle", runId: "", tabId: null, origin: "", appHost: "", appName: null, startUrl: "", startedAt: 0, endedAt: null, deadline: 0,
    blockedRoutes: [], queue: [], seen: [], probed: [], current: null, pages: [], recordedPages: 0, recordedElements: 0,
    message: "", result: null,
  };
}

function ready() {
  loaded ??= browser.storage.session.get(STORE).then(
    (stored) => { state = restore(stored[STORE]); },
    () => { state = idleState(); },
  );
  return loaded;
}

const PHASES = new Set<ExplorePhase>(["idle", "running", "stopped", "sending", "done", "error"]);

/** Own storage, still checked: anything malformed starts fresh. A send cut off by a worker restart becomes "stopped". */
function restore(value: unknown): RunState {
  const saved = value as Partial<RunState> | undefined;
  if (!saved || typeof saved !== "object" || !PHASES.has(saved.phase as ExplorePhase)) return idleState();
  const arrays = [saved.queue, saved.seen, saved.probed, saved.pages, saved.blockedRoutes].every(Array.isArray);
  if (!arrays || typeof saved.runId !== "string") return idleState();
  const next = { ...idleState(), ...saved } as RunState;
  if (next.phase === "sending") {
    next.phase = next.pages.length ? "stopped" : "error";
    next.message = "Das Senden wurde unterbrochen. Bitte erneut auswerten lassen.";
  }
  return next;
}

/** Debounced for the many small `found` updates; `now` for phase changes. */
function persist(now = false): Promise<void> {
  if (persistTimer !== undefined) clearTimeout(persistTimer);
  const write = () => browser.storage.session.set({ [STORE]: state }).catch(() => undefined);
  if (now) { persistTimer = undefined; return write(); }
  persistTimer = setTimeout(() => { persistTimer = undefined; void write(); }, 400);
  return Promise.resolve();
}

function errorText(error: unknown): string {
  if (error instanceof DOMException && error.name === "TimeoutError") return "Die Auswertung dauerte zu lange. Versuche es noch einmal.";
  if (error instanceof TypeError) return "Der Lotse-Server ist nicht erreichbar. Starte npm run dev:server.";
  return error instanceof Error ? error.message : "Die Erkundung ist fehlgeschlagen.";
}
