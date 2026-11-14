/**
 * Auto-activation (D-29), service worker only. Once signed in, Valo is permanently active on the apps of the user's org:
 * whenever the focused tab shows a host whose policy says `autoStart` (dashboard `apps.domains` of the user's org; in dev
 * also apps the runtime knows, e.g. the demo CRM) and the route is not blocked, observation starts by itself — no "Start".
 * It follows the focused tab and stops when the tab it started leaves the org's apps. A manual pause (orb menu or side
 * panel "Pausieren") holds until the user resumes; it lives in chrome.storage.session, so it survives page loads.
 *
 * Also answers the orb's messages (`lotse:orb-status`, `lotse:open-panel`, `lotse:orb-pause`) and the side panel's
 * `lotse:activation` with its own runtime.onMessage listener — background.ts's handler never sees these types.
 * Today the content script and `activeAppTab()` are localhost-only; see apps/extension/README.md for real org domains.
 */
import type { PolicyResponse, VoiceState } from "@lotse/shared";
import { hostOf, pageVerdict } from "./policy";
import { shortcutLabels } from "./shortcuts";
import {
  ACTIVATION_KEY, APP_HOSTS_KEY, DEFAULT_PRESENCE, PRESENCE_KEY, parsePresence,
  type ActivationInfo, type OrbBase, type OrbStatus, type Presence,
} from "./orb/state";

export type ActivationDeps = {
  ready: Promise<void>;
  /** background `start()`: observe the focused app tab (throws on non-app / blocked pages or a missing content script). */
  start(): Promise<void>;
  stop(): Promise<void>;
  /** Cached GET /api/lotse/policy for a tab URL; null = server unreachable or not a local app URL. */
  policy(url: string | undefined): Promise<PolicyResponse | null>;
  recording(): { on: boolean; tabId: number | null };
  live(): { busy: boolean; offerTab: number | null; offer: string | null; voice: VoiceState; voiceOn: boolean; signedIn: boolean };
};
type Sender = { tab?: { id?: number; url?: string; windowId?: number; active?: boolean } };

const ERROR_MS = 8_000;
const MAX_TRIES = 3;
let deps: ActivationDeps | null = null;
let presence: Presence = { ...DEFAULT_PRESENCE };
let manualPause = false;
let autoTab: number | null = null; // the tab Valo started by itself
let appHosts = new Set<string>();
let lastError: { text: string; at: number } | null = null;
const failures = new Map<number, { url: string; count: number }>();
let loaded: Promise<void> = Promise.resolve();
let timer: ReturnType<typeof setTimeout> | undefined;
let running = false;
let again = false;

const isLocalApp = (url: string | undefined) => {
  try {
    const u = new URL(url ?? "");
    return (u.protocol === "http:" && ["localhost", "127.0.0.1"].includes(u.hostname)) || (u.protocol === "https:" && u.hostname === "dev.fuller.de");
  } catch { return false; }
};
/** Older servers have no `autoStart`: a known, allowed app counts. */
const autoStartOf = (policy: PolicyResponse) => policy.autoStart ?? (policy.allowed && policy.known);

/** Call once, synchronously inside `defineBackground()` (listeners must exist when Chrome wakes the worker). */
export function setupActivation(next: ActivationDeps) {
  deps = next;
  loaded = load();
  browser.runtime.onMessage.addListener(onMessage);
  browser.tabs.onActivated.addListener(() => schedule(150));
  browser.windows.onFocusChanged.addListener((windowId) => { if (windowId !== browser.windows.WINDOW_ID_NONE) schedule(150); });
  browser.tabs.onUpdated.addListener((tabId, changes) => {
    if (changes.url) failures.delete(tabId);
    if (changes.url || changes.status === "complete") schedule(changes.status === "complete" ? 250 : 500);
  });
  browser.tabs.onRemoved.addListener((tabId) => { failures.delete(tabId); if (autoTab === tabId) { autoTab = null; void save(); } });
  browser.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes[PRESENCE_KEY]) { presence = parsePresence(changes[PRESENCE_KEY].newValue); schedule(100); }
  });
  // Catches what no event reports: login/logout (new policies), server back online, policy TTL.
  setInterval(() => schedule(0), 4_000);
  schedule(600);
}

/** Short German error worth showing on the orb (voice errors, failed questions). */
export function noteError(text: string) {
  if (text) lastError = { text: text.slice(0, 200), at: Date.now() };
}

/** Activation state for the side panel's debug dump. */
export function activationDebug() {
  return { autoActivate: presence.autoActivate, orb: presence.orb, manualPause, autoTab, lastError, appHosts: [...appHosts] };
}

async function load() {
  const [sync, session, local] = await Promise.all([
    browser.storage.sync.get(PRESENCE_KEY).catch(() => ({} as Record<string, unknown>)),
    browser.storage.session.get(ACTIVATION_KEY).catch(() => ({} as Record<string, unknown>)),
    browser.storage.local.get(APP_HOSTS_KEY).catch(() => ({} as Record<string, unknown>)),
  ]);
  presence = parsePresence(sync[PRESENCE_KEY]);
  const saved = session[ACTIVATION_KEY] as { manualPause?: unknown; autoTab?: unknown } | undefined;
  manualPause = saved?.manualPause === true;
  autoTab = typeof saved?.autoTab === "number" ? saved.autoTab : null;
  const hosts = local[APP_HOSTS_KEY];
  if (Array.isArray(hosts)) appHosts = new Set(hosts.filter((h): h is string => typeof h === "string").slice(0, 50));
}

async function save() {
  await browser.storage.session.set({ [ACTIVATION_KEY]: { manualPause, autoTab } }).catch(() => undefined);
}

/** Remember the org's app hosts (orb stays visible there while the server is unreachable). */
function remember(host: string | null, policy: PolicyResponse) {
  const before = appHosts.size;
  if (host && autoStartOf(policy)) appHosts.add(host);
  for (const domain of policy.appDomains ?? []) appHosts.add(domain.toLowerCase());
  if (appHosts.size !== before) {
    appHosts = new Set([...appHosts].slice(-50));
    void browser.storage.local.set({ [APP_HOSTS_KEY]: [...appHosts] }).catch(() => undefined);
  }
}

function schedule(delay: number) {
  clearTimeout(timer);
  timer = setTimeout(() => { void evaluate().catch(() => undefined); }, delay);
}

/** Start/stop observation for the focused tab. Serialized; a request during a run queues one more run. */
async function evaluate() {
  if (!deps) return;
  if (running) { again = true; return; }
  running = true;
  try {
    await deps.ready;
    await loaded;
    // The tab Valo started by itself left the org's apps (navigated elsewhere on localhost) → stop there.
    const rec = deps.recording();
    if (autoTab !== null && rec.on && rec.tabId === autoTab) {
      const tab = await browser.tabs.get(autoTab).catch(() => null);
      const policy = tab && isLocalApp(tab.url) ? await deps.policy(tab.url) : null;
      if (tab && (!isLocalApp(tab.url) || (policy && !autoStartOf(policy)))) { autoTab = null; void save(); await deps.stop(); }
    } else if (autoTab !== null && !rec.on) { autoTab = null; void save(); }

    if (!presence.autoActivate || manualPause) return;
    const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
    if (tab?.id === undefined || !isLocalApp(tab.url)) return;
    const now = deps.recording();
    if (now.on && now.tabId === tab.id) return;
    const policy = await deps.policy(tab.url);
    if (!policy) return; // offline: the orb says so; retried by the interval
    remember(hostOf(tab.url), policy);
    if (!autoStartOf(policy) || pageVerdict(tab.url, policy).paused) return; // blocked route: starts on an allowed page
    const failed = failures.get(tab.id);
    if (failed && failed.url === tab.url && failed.count >= MAX_TRIES) return; // e.g. tab opened before the extension loaded
    try {
      await deps.start();
      autoTab = deps.recording().tabId;
      failures.delete(tab.id);
      void save();
    } catch {
      failures.set(tab.id, { url: tab.url!, count: (failed && failed.url === tab.url ? failed.count : 0) + 1 });
      if ((failures.get(tab.id)?.count ?? 0) < MAX_TRIES) schedule(1_500); // content script may still be loading
    }
  } finally {
    running = false;
    if (again) { again = false; schedule(100); }
  }
}

function onMessage(message: unknown, sender: Sender, respond: (response: unknown) => void): true | undefined {
  if (!message || typeof message !== "object" || "target" in message) return undefined;
  const { type } = message as { type?: unknown };
  switch (type) {
    case "lotse:open-panel": {
      // Chrome only opens the side panel inside the user's gesture: call it before any await.
      const windowId = sender.tab?.windowId;
      if (windowId === undefined) { respond({ ok: false, error: `Öffne den Seitenbereich mit ${shortcutLabels().ask}.` }); return true; }
      browser.sidePanel.open({ windowId }).then(
        () => respond({ ok: true }),
        () => respond({ ok: false, error: `Öffne den Seitenbereich mit ${shortcutLabels().ask}.` }),
      );
      return true;
    }
    case "lotse:orb-status":
      void orbStatus(sender).then(respond, () => respond(null));
      return true;
    case "lotse:orb-pause":
      void setPaused((message as { paused?: unknown }).paused === true).then(respond, (error: unknown) =>
        respond({ ok: false, error: error instanceof Error ? error.message : "Valo konnte nicht starten." }));
      return true;
    case "lotse:activation":
      void loaded.then(() => respond({ manualPause, autoActivate: presence.autoActivate, appHosts: [...appHosts], autoTab } satisfies ActivationInfo));
      return true;
    // Side panel Start/Pausieren (answered by background.ts) — only note the user's intent here.
    case "lotse:start": void loaded.then(() => { manualPause = false; autoTab = null; void save(); }); return undefined;
    case "lotse:stop": void loaded.then(() => { manualPause = true; autoTab = null; void save(); }); return undefined;
    // A content script (re)loaded → it can take `lotse:start` now.
    case "lotse:get-policy": if (sender.tab?.id !== undefined) { failures.delete(sender.tab.id); if (sender.tab.active) schedule(300); } return undefined;
    case "lotse:login": case "lotse:logout": schedule(1_500); return undefined;
    default: return undefined;
  }
}

async function setPaused(paused: boolean): Promise<{ ok: true }> {
  if (!deps) throw new Error("Valo startet noch.");
  await deps.ready;
  await loaded;
  manualPause = paused;
  autoTab = null;
  await save();
  if (paused) { await deps.stop(); return { ok: true }; }
  failures.clear();
  await deps.start(); // explicit resume: works even with "Automatisch aktiv" off
  return { ok: true };
}

async function orbStatus(sender: Sender): Promise<OrbStatus> {
  if (!deps) throw new Error("not ready");
  await deps.ready;
  await loaded;
  const tabId = sender.tab?.id ?? null;
  const url = sender.tab?.url;
  const host = hostOf(url);
  const policy = await deps.policy(url).catch(() => null);
  if (policy) remember(host, policy);
  const rec = deps.recording();
  const live = deps.live();
  const here = rec.on && tabId !== null && rec.tabId === tabId;
  const isApp = policy ? autoStartOf(policy) : host !== null && appHosts.has(host);
  const who = live.signedIn ? "" : " · ohne Anmeldung (Dev-Modus)";
  const app = policy?.appName ? `${policy.appName}${policy.orgName ? " · " + policy.orgName : ""}` : host ?? "";
  let base: OrbBase;
  let detail: string;
  if (!policy) { base = "offline"; detail = "Der Valo-Server ist nicht erreichbar. Bis dahin beobachtet Valo nichts."; }
  else if (!policy.allowed && policy.known && !policy.signedIn) { base = "signed-out"; detail = policy.reason ?? `Melde dich im Seitenbereich an (${shortcutLabels().ask}).`; }
  else if (!policy.allowed) { base = "blocked"; detail = policy.reason ?? "Diese App ist für Valo nicht freigegeben."; }
  else if (pageVerdict(url, policy).paused) { base = "blocked"; detail = "Hier beobachtet Valo nichts (geschützte Daten). Auf freigegebenen Seiten geht es von selbst weiter."; }
  else if (here) { base = "active"; detail = `Beobachtet ${app} und hilft bei Bedarf${who}.`; }
  else if (manualPause) { base = "paused"; detail = "Von dir pausiert. Menü → Fortsetzen."; }
  else if (!presence.autoActivate) { base = "idle"; detail = "„Automatisch aktiv“ ist aus. Menü → Starten."; }
  else if (isApp) { base = "idle"; detail = "Valo startet gleich …"; schedule(300); }
  else { base = "idle"; detail = "Diese Seite ist keine App deiner Organisation. Menü → Starten."; }
  const error = lastError && Date.now() - lastError.at < ERROR_MS ? lastError.text : null;
  return {
    visible: presence.orb && (here || isApp),
    base, detail,
    offer: live.offerTab !== null && live.offerTab === tabId ? live.offer : null,
    thinking: live.busy && sender.tab?.active === true,
    voice: live.voice, voiceOn: live.voiceOn, signedIn: live.signedIn, error,
    autoActivate: presence.autoActivate,
  };
}
