import { AskResponseSchema, LOTSE_DEFAULTS, type AskRequest, type AskResponse, type ExtensionMessage, type PageSnapshot } from "@lotse/shared";

/**
 * Service worker: routes messages between side panel and content script and talks to the Lotse server.
 * Calls to the server happen here (not in the content script) so CORS of the visited page doesn't apply.
 */
export default defineBackground(() => {
  // Clicking the toolbar icon opens the side panel.
  browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(console.error);

  browser.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
    if (message.type !== "lotse:ask") return;
    ask(message.question).then(
      (answer) => sendResponse({ ok: true, answer }),
      (error: unknown) => sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) }),
    );
    return true; // keep the channel open for the async response
  });
});

/** Question from the side panel → snapshot of the active tab → server → highlight in the page. */
async function ask(question: string): Promise<AskResponse> {
  const [tab] = await browser.tabs.query({ active: true, lastFocusedWindow: true });
  if (tab?.id === undefined) throw new Error("Kein aktiver Tab gefunden.");

  let snapshot: PageSnapshot;
  try {
    snapshot = await browser.tabs.sendMessage(tab.id, { type: "lotse:snapshot" } satisfies ExtensionMessage);
  } catch {
    throw new Error("Lotse ist auf dieser Seite nicht aktiv. Seite neu laden (nur localhost-Seiten sind freigegeben).");
  }

  const body: AskRequest = { question, snapshot };
  const response = await fetch(`${LOTSE_DEFAULTS.serverUrl}/api/lotse/ask`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Server antwortet mit ${response.status} — läuft npm run dev:server?`);
  const answer = AskResponseSchema.parse(await response.json());

  if (answer.elementNumber !== null) {
    await browser.tabs.sendMessage(tab.id, {
      type: "lotse:highlight",
      elementNumber: answer.elementNumber,
      sentence: answer.sentence,
    } satisfies ExtensionMessage);
  }
  return answer;
}
