/**
 * Keyboard shortcut labels for UI hints, matching the suggested keys in wxt.config.ts:
 * open Valo = Alt+L (macOS ⌘⇧L), voice question = Alt+Shift+L (macOS ⌘⇧K).
 * Chrome applies suggested keys only on a fresh install; users can rebind at chrome://extensions/shortcuts.
 */
type NavigatorWithUAData = Navigator & { userAgentData?: { platform?: string } };

export function isMac(): boolean {
  const nav = globalThis.navigator as NavigatorWithUAData | undefined;
  return /mac/i.test(nav?.userAgentData?.platform || nav?.platform || "");
}

export function shortcutLabels(): { ask: string; listen: string } {
  return isMac() ? { ask: "⌘⇧L", listen: "⌘⇧K" } : { ask: "Alt+L", listen: "Alt+Shift+L" };
}

/** Fills every `[data-shortcut="ask" | "listen"]` element with the label for this platform. */
export function applyShortcutLabels(root: ParentNode = document): void {
  const labels = shortcutLabels();
  for (const element of root.querySelectorAll<HTMLElement>("[data-shortcut]")) {
    const key = element.dataset.shortcut;
    if (key === "ask" || key === "listen") element.textContent = labels[key];
  }
}
