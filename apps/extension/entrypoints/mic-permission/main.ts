/**
 * Opened once as a normal tab: Chrome can't show the microphone prompt in the side panel or the offscreen document.
 * A grant here applies to the whole extension origin, so the offscreen document can capture afterwards.
 * The service worker closes this tab after "mic-granted".
 */
import { applyShortcutLabels, shortcutLabels } from "@/utils/shortcuts";
import { notifyWorker } from "@/utils/voice/protocol";

applyShortcutLabels();

const status = document.querySelector<HTMLParagraphElement>("#status")!;
const retry = document.querySelector<HTMLButtonElement>("#retry")!;

async function request(): Promise<void> {
  retry.hidden = true;
  status.textContent = "Please choose “Allow” in the browser dialog …";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop()); // only the grant is needed here; capture happens offscreen
    status.textContent = `Thanks! The microphone is allowed. Say “Hey Jarvis …” or press ${shortcutLabels().listen}. This tab will close in a moment.`;
    notifyWorker({ type: "mic-granted" });
  } catch (error) {
    const name = (error as DOMException | null)?.name;
    status.textContent =
      name === "NotAllowedError"
        ? "Microphone blocked. Click the lock/settings icon on the left of the address bar, allow the microphone and try again."
        : "No microphone found. Connect one and try again.";
    retry.hidden = false;
    notifyWorker({ type: "mic-denied" });
  }
}

retry.addEventListener("click", () => void request());
void request();
