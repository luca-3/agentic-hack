import type { AskResponse, ExtensionMessage } from "@lotse/shared";

/** Side panel: text question → background (`lotse:ask`) → answer sentence. Voice comes later (R-VOI-*). */
type AskResult = { ok: true; answer: AskResponse } | { ok: false; error: string };

const form = document.querySelector<HTMLFormElement>("#ask");
const input = document.querySelector<HTMLTextAreaElement>("#question");
const status = document.querySelector<HTMLParagraphElement>("#status");

form?.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = input?.value.trim();
  if (!question || !status) return;
  status.textContent = "Lotse schaut nach …";
  const result: AskResult = await browser.runtime.sendMessage({ type: "lotse:ask", question } satisfies ExtensionMessage);
  status.textContent = result.ok ? result.answer.sentence : `Fehler: ${result.error}`;
});
