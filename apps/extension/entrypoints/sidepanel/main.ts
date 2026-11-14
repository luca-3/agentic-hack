import type { VoiceState } from "@lotse/shared";
import type { LotseResult, LotseStatus, PageStatus } from "../background";
import type { LotseMessage } from "../../utils/messages";
import { applyShortcutLabels, isMac, shortcutLabels } from "../../utils/shortcuts";
import "./presence"; // D-29 switches: "Automatically active", "Show the status orb"

const get = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
applyShortcutLabels();
const startButton = get<HTMLButtonElement>("#start");
const stopButton = get<HTMLButtonElement>("#stop");
const askForm = get<HTMLFormElement>("#ask");
const question = get<HTMLTextAreaElement>("#question");
const askButton = get<HTMLButtonElement>("#ask-button");
const settingsForm = get<HTMLFormElement>("#settings");
const screenshots = get<HTMLInputElement>("#screenshots");
const role = get<HTMLInputElement>("#role");
const knowledge = get<HTMLTextAreaElement>("#knowledge");
const proactive = get<HTMLInputElement>("#proactive");
const voice = get<HTMLInputElement>("#voice");
const speakToggle = get<HTMLInputElement>("#speak");
const thresholdInput = get<HTMLInputElement>("#threshold");
const notice = get<HTMLParagraphElement>("#notice");
const loginForm = get<HTMLFormElement>("#login");
const email = get<HTMLInputElement>("#email");
const password = get<HTMLInputElement>("#password");
const loginButton = get<HTMLButtonElement>("#login-button");
const exploreBox = get<HTMLElement>("#explore-box");
const exploreStart = get<HTMLButtonElement>("#explore-start");
const exploreStop = get<HTMLButtonElement>("#explore-stop");
const exploreSpinner = get<HTMLSpanElement>("#explore-spinner");
const VOICE_LABEL: Record<VoiceState, string> = { off: "", idle: "🎙 ready", listening: "🎙 listening …", thinking: "… thinking", speaking: "🔊 speaking" };
let settingsLoaded = false;
let thresholdDirty = false;
let offerId: string | null = null;

async function send(message: LotseMessage): Promise<LotseResult> {
  return browser.runtime.sendMessage(message);
}

/** App · org · role of the active tab, as the server resolved it (GET /api/lotse/policy). */
function orgLine(page: PageStatus | null, signedIn: boolean) {
  if (!page) return "No app tab active.";
  const app = page.appName ? `${page.appName} (${page.host})` : page.host;
  if (!page.known) return `${app} · not assigned to an organization${signedIn ? "" : " (dev mode)"}`;
  const org = page.orgName ?? "Organization";
  if (page.member && page.role) return `${app} · ${org} · Role: ${page.role}`;
  if (signedIn) return `${app} · ${org} · your account is not a member of this organization`;
  return `${app} · ${org} · not signed in (demo role)`;
}

function renderAccount(status: LotseStatus) {
  const signedIn = status.account !== null;
  loginForm.hidden = signedIn;
  get("#signed-in").hidden = !signedIn;
  get("#account-line").textContent = signedIn ? `Signed in as ${status.account!.email}` : "";
  get("#admin-badge").hidden = !status.account?.isAdmin;
  get("#org-line").textContent = orgLine(status.page, signedIn);
  get("#paused-box").hidden = !status.page?.paused;
  get("#paused-reason").textContent = status.page?.paused ? status.page.reason : "";
  role.disabled = signedIn;
  get("#role-note").textContent = signedIn ? "Signed in: your role comes from your organization." : "";

  const isAdmin = status.account?.isAdmin === true;
  exploreBox.hidden = !isAdmin;
  if (isAdmin) {
    const exp = status.explore;
    exploreStart.disabled = exp.running;
    exploreStop.disabled = !exp.running;
    const activePhase = exp.phase === "crawling" || exp.phase === "analyzing";
    exploreSpinner.hidden = !activePhase;
    const elapsedSec = exp.phaseStartedAt ? Math.max(0, Math.floor((Date.now() - exp.phaseStartedAt) / 1_000)) : 0;

    if (exp.phase === "crawling") {
      const shownCount = Math.min(Math.max(exp.pageCount, 1), exp.maxPages);
      const routeInfo = exp.currentRoute ? ` · ${exp.currentRoute}` : "";
      get("#explore-progress").textContent = `Page ${shownCount} of up to ${exp.maxPages}${routeInfo} (${elapsedSec} s)`;
    } else if (exp.phase === "analyzing") {
      get("#explore-progress").textContent = `Analyzing (${elapsedSec} s) …`;
    } else if (exp.phase === "done" && exp.result) {
      get("#explore-progress").textContent = exp.result.features === 0
        ? "No new features – everything already exists."
        : exp.result.features === 1
          ? "1 new feature added."
          : `${exp.result.features} new features added.`;
    } else if (exp.phase === "stopped" || exp.phase === "error") {
      get("#explore-progress").textContent = exp.summary;
    } else {
      get("#explore-progress").textContent = "";
    }
    get("#explore-status-row").hidden = !activePhase && !get("#explore-progress").textContent;
  }
}

const percent = (value: number) => value.toFixed(2);
const clock = (timestamp: number) => new Date(timestamp).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

function render(status: LotseStatus) {
  renderAccount(status);
  get("#activity").textContent = status.recording ? "Valo active" : "Valo paused";
  get("#activity").classList.toggle("active", status.recording);
  const voiceChip = get("#voice-state");
  voiceChip.textContent = status.settings.voice ? VOICE_LABEL[status.voiceState] : "";
  voiceChip.hidden = !voiceChip.textContent;
  startButton.disabled = status.recording || status.explore.running;
  stopButton.disabled = !status.recording;
  askButton.disabled = (status.busy && status.busyMode === "question") || status.explore.running;
  get("#event-count").textContent = String(status.eventCount);
  get("#snapshot-count").textContent = String(status.snapshotCount);
  get("#frame-count").textContent = String(status.screenshotCount);
  get("#state-count").textContent = String(status.stateCount);
  get("#status").textContent = status.message;
  get("#image-status").textContent = status.screenshotMessage;
  get("#last-question").textContent = status.lastQuestion ? `${status.lastQuestion.source === "voice" ? "🎙" : "⌨"} “${status.lastQuestion.text}”` : "";
  get("#workflow").textContent = status.inference?.workflowName ?? (status.workflowId ? "Observing workflow" : "No workflow yet");
  get("#intent").textContent = status.inference?.intent.goal ?? "The goal is inferred from the observed history.";
  get("#decision").textContent = status.decision
    ? `${status.decision.intervene ? "Help recommended" : "Keep observing"} · Confidence ${percent(status.decision.confidence)}${status.decision.threshold !== undefined ? " / threshold " + percent(status.decision.threshold) : ""}`
    : "";
  get("#analytics").textContent = status.analyticsQueued ? `${status.analyticsQueued} events waiting for the next analytics upload.` : "";
  const events = get<HTMLUListElement>("#events");
  events.replaceChildren(...status.events.map((event) => {
    const row = document.createElement("li");
    const time = new Date(event.ts).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    row.textContent = `${time} · ${event.type} · ${event.elementLabel || event.route}`;
    return row;
  }));

  offerId = status.offer?.offerId ?? null;
  get("#offer-box").hidden = !status.offer;
  get("#offer-text").textContent = status.offer?.text ?? "";
  get("#plan-box").hidden = !status.plan;
  if (status.plan) {
    get("#plan-step").textContent = `Step ${status.plan.index + 1}/${status.plan.total}: ${status.plan.hint || status.plan.label}`;
    get<HTMLButtonElement>("#plan-back").disabled = status.plan.index === 0;
    get("#plan-next").textContent = status.plan.index + 1 === status.plan.total ? "Done" : "Next";
  }

  proactive.checked = status.settings.proactive;
  voice.checked = status.settings.voice;
  speakToggle.checked = status.settings.speak;
  speakToggle.disabled = !status.settings.voice;
  const listenBtn = get<HTMLButtonElement>("#listen");
  const isListening = status.settings.voice && status.voiceState === "listening";
  listenBtn.disabled = !status.settings.voice;
  listenBtn.textContent = isListening ? "⏹" : "🎙";
  listenBtn.classList.toggle("danger", isListening);
  listenBtn.classList.toggle("secondary", !isListening);
  listenBtn.title = isListening ? "Stop listening" : "Speak question";
  listenBtn.setAttribute("aria-label", listenBtn.title);
  const snoozed = status.snoozedUntil !== null;
  get("#snooze-line").textContent = !status.settings.proactive ? "Valo won't offer help on its own." : snoozed ? `Paused until ${clock(status.snoozedUntil!)}.` : "";
  get("#snooze").hidden = snoozed || !status.settings.proactive;
  get("#resume").hidden = !snoozed;
  get("#threshold-value").textContent = status.threshold === null ? "–" : percent(status.threshold);
  if (!thresholdDirty && status.threshold !== null) thresholdInput.value = String(status.threshold);
  get("#prefs-message").textContent = status.prefsMessage;

  if (!settingsLoaded) {
    screenshots.checked = status.settings.screenshots;
    role.value = status.settings.role;
    knowledge.value = status.settings.appKnowledge;
    settingsLoaded = true;
  }
}

const RELOAD_HINT = `The extension was updated – please close the side panel (✕) and open it again (${shortcutLabels().ask}).`;

function contextInvalidated(): boolean {
  try { return !browser.runtime?.id; } catch { return true; }
}

async function act(message: LotseMessage) {
  notice.textContent = "";
  if (contextInvalidated()) {
    notice.textContent = RELOAD_HINT;
    return;
  }
  try {
    const result = await send(message);
    if (result.ok) render(result.status);
    else notice.textContent = result.error;
  } catch {
    notice.textContent = contextInvalidated()
      ? RELOAD_HINT
      : "Valo is not reachable yet. Reload the extension.";
  }
}

loginForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const secret = password.value;
  password.value = ""; // never kept in the panel; the worker only stores the Supabase session
  loginButton.disabled = true;
  void act({ type: "lotse:login", email: email.value, password: secret }).finally(() => { loginButton.disabled = false; });
});
get("#logout").addEventListener("click", () => { void act({ type: "lotse:logout" }); });
exploreStart.addEventListener("click", () => { void act({ type: "lotse:explore-start" }); });
exploreStop.addEventListener("click", () => { void act({ type: "lotse:explore-stop" }); });
startButton.addEventListener("click", () => { void act({ type: "lotse:start" }); });
stopButton.addEventListener("click", () => { void act({ type: "lotse:stop" }); });
question.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    if (!askButton.disabled && question.value.trim()) askForm.requestSubmit();
  }
});
askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (text) {
    askButton.disabled = true;
    question.value = "";
    void act({ type: "lotse:ask", question: text }).finally(() => { askButton.disabled = false; });
  }
});
settingsForm.addEventListener("submit", (event) => {
  event.preventDefault();
  void act({ type: "lotse:update-settings", settings: { screenshots: screenshots.checked, role: role.value, appKnowledge: knowledge.value } });
});
screenshots.addEventListener("change", () => { void act({ type: "lotse:update-settings", settings: { screenshots: screenshots.checked } }); });
proactive.addEventListener("change", () => { void act({ type: "lotse:update-settings", settings: { proactive: proactive.checked } }); });
voice.addEventListener("change", () => { void act({ type: "lotse:update-settings", settings: { voice: voice.checked } }); });
speakToggle.addEventListener("change", () => { void act({ type: "lotse:update-settings", settings: { speak: speakToggle.checked } }); });
get("#listen").addEventListener("click", () => { void act({ type: "lotse:listen" }); });
get("#snooze").addEventListener("click", () => { void act({ type: "lotse:snooze", minutes: 10 }); });
get("#resume").addEventListener("click", () => { void act({ type: "lotse:snooze", minutes: 0 }); });
thresholdInput.addEventListener("input", () => {
  thresholdDirty = true;
  get("#threshold-value").textContent = percent(Number(thresholdInput.value));
});
get("#threshold-save").addEventListener("click", () => {
  thresholdDirty = false;
  void act({ type: "lotse:prefs", threshold: Number(thresholdInput.value) });
});
get("#offer-yes").addEventListener("click", () => { if (offerId) void act({ type: "lotse:offer-accept", offerId }); });
get("#offer-no").addEventListener("click", () => { if (offerId) void act({ type: "lotse:offer-feedback", offerId, feedback: "declined" }); });
get("#plan-back").addEventListener("click", () => { void act({ type: "lotse:plan-command", action: "back" }); });
get("#plan-next").addEventListener("click", () => { void act({ type: "lotse:plan-command", action: "next" }); });
get("#plan-end").addEventListener("click", () => { void act({ type: "lotse:plan-command", action: "end" }); });

const debugCopy = get<HTMLButtonElement>("#debug-copy");
const debugNote = get<HTMLSpanElement>("#debug-note");
const debugText = get<HTMLTextAreaElement>("#debug-text");
debugCopy.addEventListener("click", () => { void copyDebug(); });

/** "Copy debug context": the worker collects the session context as Markdown (≤ 40 KB), the panel copies it. */
async function copyDebug() {
  if (contextInvalidated()) { debugNote.textContent = RELOAD_HINT; return; }
  debugCopy.disabled = true;
  debugText.hidden = true;
  debugNote.textContent = "Collecting …";
  try {
    const result = await send({ type: "lotse:debug-dump" });
    if (!result.ok) throw new Error(result.error);
    const text = result.debug ?? "";
    try {
      await navigator.clipboard.writeText(text);
      debugNote.textContent = `Copied ✓ (${Math.max(1, Math.round(text.length / 1024))} KB)`;
    } catch {
      // The click's user activation can run out while the worker collects → let the user copy by hand.
      debugText.value = text;
      debugText.hidden = false;
      debugText.focus();
      debugText.select();
      debugNote.textContent = `Could not copy automatically – the text is selected, press ${isMac() ? "⌘C" : "Ctrl+C"}.`;
    }
  } catch (error) {
    debugNote.textContent = error instanceof Error ? error.message : "The debug context is not available right now.";
  } finally { debugCopy.disabled = false; }
}

async function refresh() {
  if (contextInvalidated()) {
    notice.textContent = RELOAD_HINT;
    return;
  }
  try { const result = await send({ type: "lotse:status" }); if (result.ok) render(result.status); }
  catch { /* A transient service-worker restart should not erase the UI. */ }
}
void refresh();
void act({ type: "lotse:prefs" }); // current threshold from GET /api/lotse/prefs
setInterval(() => { void refresh(); }, 1_000);
