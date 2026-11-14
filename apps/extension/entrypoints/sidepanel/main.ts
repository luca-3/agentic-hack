import type { VoiceState } from "@lotse/shared";
import type { LotseResult, LotseStatus } from "../background";
import type { LotseMessage } from "../../utils/messages";

const get = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector)!;
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
const VOICE_LABEL: Record<VoiceState, string> = { off: "", idle: "🎙 bereit", listening: "🎙 hört zu …", thinking: "… denkt nach", speaking: "🔊 spricht" };
let settingsLoaded = false;
let thresholdDirty = false;
let offerId: string | null = null;

async function send(message: LotseMessage): Promise<LotseResult> {
  return browser.runtime.sendMessage(message);
}

const percent = (value: number) => value.toFixed(2).replace(".", ",");
const clock = (timestamp: number) => new Date(timestamp).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" });

function render(status: LotseStatus) {
  get("#activity").textContent = status.recording ? "Lotse aktiv" : "Lotse pausiert";
  get("#activity").classList.toggle("active", status.recording);
  const voiceChip = get("#voice-state");
  voiceChip.textContent = status.settings.voice ? VOICE_LABEL[status.voiceState] : "";
  voiceChip.hidden = !voiceChip.textContent;
  startButton.disabled = status.busy || status.recording;
  stopButton.disabled = !status.recording;
  askButton.disabled = status.busy && status.busyMode === "question";
  get("#event-count").textContent = String(status.eventCount);
  get("#snapshot-count").textContent = String(status.snapshotCount);
  get("#frame-count").textContent = String(status.screenshotCount);
  get("#state-count").textContent = String(status.stateCount);
  get("#status").textContent = status.message;
  get("#image-status").textContent = status.screenshotMessage;
  get("#last-question").textContent = status.lastQuestion ? `${status.lastQuestion.source === "voice" ? "🎙" : "⌨"} „${status.lastQuestion.text}“` : "";
  get("#workflow").textContent = status.inference?.workflowName ?? (status.workflowId ? "Workflow wird beobachtet" : "Noch kein Workflow");
  get("#intent").textContent = status.inference?.intent.goal ?? "Das Ziel wird aus dem beobachteten Verlauf eingeordnet.";
  get("#decision").textContent = status.decision
    ? `${status.decision.intervene ? "Hilfe empfohlen" : "Weiter beobachten"} · Sicherheit ${percent(status.decision.confidence)}${status.decision.threshold !== undefined ? " / Schwelle " + percent(status.decision.threshold) : ""}`
    : "";
  get("#analytics").textContent = status.analyticsQueued ? `${status.analyticsQueued} Ereignisse warten auf die nächste Analytics-Übertragung.` : "";
  const events = get<HTMLUListElement>("#events");
  events.replaceChildren(...status.events.map((event) => {
    const row = document.createElement("li");
    const time = new Date(event.ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    row.textContent = `${time} · ${event.type} · ${event.elementLabel || event.route}`;
    return row;
  }));

  offerId = status.offer?.offerId ?? null;
  get("#offer-box").hidden = !status.offer;
  get("#offer-text").textContent = status.offer?.text ?? "";
  get("#plan-box").hidden = !status.plan;
  if (status.plan) {
    get("#plan-step").textContent = `Schritt ${status.plan.index + 1}/${status.plan.total}: ${status.plan.hint || status.plan.label}`;
    get<HTMLButtonElement>("#plan-back").disabled = status.plan.index === 0;
    get("#plan-next").textContent = status.plan.index + 1 === status.plan.total ? "Fertig" : "Weiter";
  }

  proactive.checked = status.settings.proactive;
  voice.checked = status.settings.voice;
  speakToggle.checked = status.settings.speak;
  speakToggle.disabled = !status.settings.voice;
  get<HTMLButtonElement>("#listen").disabled = !status.settings.voice;
  const snoozed = status.snoozedUntil !== null;
  get("#snooze-line").textContent = !status.settings.proactive ? "Lotse bietet keine Hilfe von sich aus an." : snoozed ? `Pausiert bis ${clock(status.snoozedUntil!)}.` : "";
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

async function act(message: LotseMessage) {
  notice.textContent = "";
  try {
    const result = await send(message);
    if (result.ok) render(result.status);
    else notice.textContent = result.error;
  } catch { notice.textContent = "Lotse ist noch nicht erreichbar. Lade die Erweiterung neu."; }
}

startButton.addEventListener("click", () => { void act({ type: "lotse:start" }); });
stopButton.addEventListener("click", () => { void act({ type: "lotse:stop" }); });
askForm.addEventListener("submit", (event) => {
  event.preventDefault();
  const text = question.value.trim();
  if (text) { askButton.disabled = true; void act({ type: "lotse:ask", question: text }); }
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

async function refresh() {
  try { const result = await send({ type: "lotse:status" }); if (result.ok) render(result.status); }
  catch { /* A transient service-worker restart should not erase the UI. */ }
}
void refresh();
void act({ type: "lotse:prefs" }); // current threshold from GET /api/lotse/prefs
setInterval(() => { void refresh(); }, 1_000);
