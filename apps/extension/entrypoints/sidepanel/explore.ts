/**
 * Side panel: "App erkunden" (D-25) — admins only. Polls the service worker's explorer (utils/explore/runner.ts):
 * why it can't start, live progress with Stop, then the result with the way to the dashboard ("Lernen").
 */
import type { ExploreMessage, ExploreReply, ExploreStatus } from "../../utils/explore/messages";

const $ = <T extends HTMLElement>(selector: string) => document.querySelector<T>(selector);
const box = $<HTMLDetailsElement>("#explore-box");
let autoOpened = false;

const minutes = (ms: number) => {
  const s = Math.max(0, Math.round(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

async function send(message: ExploreMessage): Promise<ExploreReply> {
  return browser.runtime.sendMessage(message);
}

function render(status: ExploreStatus) {
  if (!box) return;
  const running = status.phase === "running";
  const busy = running || status.phase === "sending";
  // Collapsed for employees; opens by itself once for an admin who can start, or while a run is active.
  if (!autoOpened && (status.canStart || status.phase !== "idle")) { box.open = true; autoOpened = true; }
  $("#explore-app")!.textContent = status.appName ? `${status.appName} (${status.appHost ?? ""})` : status.appHost ?? "";
  $("#explore-reason")!.textContent = busy ? "" : status.reason;
  $<HTMLButtonElement>("#explore-start")!.disabled = busy || !status.canStart;
  $("#explore-start")!.hidden = busy;
  $("#explore-stop")!.hidden = !running;
  $("#explore-progress")!.hidden = status.phase === "idle";
  $("#explore-pages")!.textContent = `${status.pages}/${status.maxPages}`;
  $("#explore-elements")!.textContent = String(status.elements);
  $("#explore-queued")!.textContent = String(status.queued);
  $("#explore-time")!.textContent = `${minutes(status.elapsedMs)} / ${minutes(status.limitMs)}`;
  $("#explore-route")!.textContent = running && status.currentRoute ? `Gerade: ${status.currentRoute}` : "";
  $("#explore-message")!.textContent = status.message;
  const canSend = (status.phase === "stopped" || status.phase === "error") && status.pages > 0;
  $("#explore-after")!.hidden = !(status.phase === "stopped" || status.phase === "error" || status.phase === "done");
  $("#explore-send")!.hidden = !canSend;
  $("#explore-discard")!.textContent = status.phase === "done" ? "Schließen" : "Verwerfen";
  $("#explore-result")!.hidden = status.phase !== "done" || !status.result;
  if (status.result) {
    $("#explore-features")!.textContent = String(status.result.features);
    $("#explore-findings")!.textContent = String(status.result.findings);
  }
  $("#explore-dashboard")!.dataset.url = status.dashboardUrl;
}

async function act(message: ExploreMessage) {
  const notice = $("#explore-notice")!;
  notice.textContent = "";
  try {
    const reply = await send(message);
    if (!reply.ok) notice.textContent = reply.error;
    else if (reply.status) render(reply.status);
  } catch { notice.textContent = "Lotse ist noch nicht erreichbar. Lade die Erweiterung neu."; }
}

if (box) {
  $("#explore-start")!.addEventListener("click", () => { void act({ type: "lotse:explore-start" }); });
  $("#explore-stop")!.addEventListener("click", () => { void act({ type: "lotse:explore-stop" }); });
  $("#explore-send")!.addEventListener("click", () => { void act({ type: "lotse:explore-send" }); });
  $("#explore-discard")!.addEventListener("click", () => { void act({ type: "lotse:explore-discard" }); });
  $("#explore-dashboard")!.addEventListener("click", (event) => {
    const url = (event.currentTarget as HTMLElement).dataset.url;
    if (url) void browser.tabs.create({ url });
  });
  const refresh = async () => {
    try { const reply = await send({ type: "lotse:explore-status" }); if (reply.ok && reply.status) render(reply.status); }
    catch { /* worker restarting */ }
  };
  void refresh();
  setInterval(() => { void refresh(); }, 1_000);
}
