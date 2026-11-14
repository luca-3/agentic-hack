import type { ExtensionMessage } from "@lotse/shared";
import type { LotseResult, LotseStatus } from "../background";

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
const notice = get<HTMLParagraphElement>("#notice");
let settingsLoaded = false;

async function send(message: ExtensionMessage): Promise<LotseResult> {
  return browser.runtime.sendMessage(message);
}

function render(status: LotseStatus) {
  get("#activity").textContent = status.recording ? "Lotse aktiv" : "Lotse pausiert";
  get("#activity").classList.toggle("active", status.recording);
  startButton.disabled = status.busy || status.recording;
  stopButton.disabled = !status.recording;
  askButton.disabled = status.busy && status.busyMode === "question";
  get("#event-count").textContent = String(status.eventCount);
  get("#snapshot-count").textContent = String(status.snapshotCount);
  get("#frame-count").textContent = String(status.screenshotCount);
  get("#state-count").textContent = String(status.stateCount);
  get("#status").textContent = status.message;
  get("#image-status").textContent = status.screenshotMessage;
  get("#workflow").textContent = status.inference?.workflowName ?? (status.workflowId ? "Workflow wird beobachtet" : "Noch kein Workflow");
  get("#intent").textContent = status.inference?.intent.goal ?? "Das Ziel wird aus dem beobachteten Verlauf eingeordnet.";
  get("#decision").textContent = status.decision ? `${status.decision.intervene ? "Hinweis empfohlen" : "Weiter beobachten"}${status.decision.offer ? ": " + status.decision.offer : ""}` : "";
  const events = get<HTMLUListElement>("#events");
  events.replaceChildren(...status.events.map((event) => {
    const row = document.createElement("li");
    const time = new Date(event.ts).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
    row.textContent = `${time} · ${event.type} · ${event.elementLabel || event.route}`;
    return row;
  }));
  if (!settingsLoaded) {
    screenshots.checked = status.settings.screenshots;
    role.value = status.settings.role;
    knowledge.value = status.settings.appKnowledge;
    settingsLoaded = true;
  }
}

async function act(message: ExtensionMessage) {
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
  void act({ type: "lotse:settings", settings: { screenshots: screenshots.checked, role: role.value, appKnowledge: knowledge.value } });
});
screenshots.addEventListener("change", () => {
  void act({ type: "lotse:settings", settings: { screenshots: screenshots.checked, role: role.value, appKnowledge: knowledge.value } });
});

async function refresh() {
  try { const result = await send({ type: "lotse:status" }); if (result.ok) render(result.status); }
  catch { /* A transient service-worker restart should not erase the UI. */ }
}
void refresh();
setInterval(() => { void refresh(); }, 1_000);
