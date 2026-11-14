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
  status.textContent = "Bitte im Browser-Dialog „Zulassen“ wählen …";
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((track) => track.stop()); // only the grant is needed here; capture happens offscreen
    status.textContent = `Danke! Das Mikrofon ist freigegeben. Sag „Hey Jarvis …“ oder drücke ${shortcutLabels().listen}. Dieser Tab schließt sich gleich.`;
    notifyWorker({ type: "mic-granted" });
  } catch (error) {
    const name = (error as DOMException | null)?.name;
    status.textContent =
      name === "NotAllowedError"
        ? "Mikrofon blockiert. Klicke links in der Adressleiste auf das Schloss-/Einstellungs-Symbol, erlaube das Mikrofon und versuche es erneut."
        : "Kein Mikrofon gefunden. Schließe eins an und versuche es erneut.";
    retry.hidden = false;
    notifyWorker({ type: "mic-denied" });
  }
}

retry.addEventListener("click", () => void request());
void request();
