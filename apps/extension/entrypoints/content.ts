import type { ExtensionMessage, InteractiveElement, PageSnapshot } from "@lotse/shared";

/**
 * Content script: runs inside the visited app.
 * - builds the numbered snapshot of interactive elements (labels only, never input values)
 * - draws the highlight overlay (Shadow DOM so the app's CSS can't break it)
 * TODO (see docs/requirements.md): event capture R-OBS-1, stuck rules R-DEC-1, click R-ACT-1, overlays inside <dialog>.
 */
const INTERACTIVE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, ' +
  '[role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [contenteditable="true"]';

let numbered: HTMLElement[] = [];

export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  main() {
    browser.runtime.onMessage.addListener((message: ExtensionMessage, _sender, sendResponse) => {
      if (message.type === "lotse:snapshot") sendResponse(buildSnapshot());
      else if (message.type === "lotse:highlight") sendResponse(highlight(message.elementNumber, message.sentence));
      else if (message.type === "lotse:clear") sendResponse(clearOverlay());
    });
    window.addEventListener("scroll", render, true);
    window.addEventListener("resize", render);
  },
});

// --- Snapshot ------------------------------------------------------------

function buildSnapshot(): PageSnapshot {
  numbered = [...document.querySelectorAll<HTMLElement>(INTERACTIVE)].filter(isVisible);
  const route = location.pathname + location.search;
  const elements: InteractiveElement[] = numbered.map((el, number) => {
    const r = el.getBoundingClientRect();
    return { number, role: roleOf(el), label: accessibleName(el), route, rect: { x: r.x, y: r.y, width: r.width, height: r.height } };
  });
  return { url: location.href, title: document.title, elements, capturedAt: Date.now() };
}

function isVisible(el: HTMLElement): boolean {
  if (el.closest("#lotse-overlay-host")) return false;
  const r = el.getBoundingClientRect();
  return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden";
}

function roleOf(el: HTMLElement): string {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea") return "textbox";
  if (el instanceof HTMLInputElement) {
    const byType: Record<string, string> = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", search: "searchbox" };
    return byType[el.type] ?? "textbox";
  }
  return tag;
}

/** Accessible name — UI labels only. Input *values* are never read (privacy, D-12). */
function accessibleName(el: HTMLElement): string {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria.trim();
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ").trim();
    if (text) return text;
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const viaLabel = el.labels?.[0]?.textContent?.replace(/\s+/g, " ").trim();
    if (viaLabel) return viaLabel;
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return placeholder;
    if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button")) return el.value; // button caption
  }
  const text = el.innerText?.replace(/\s+/g, " ").trim();
  if (text) return text.slice(0, 80);
  return (el.getAttribute("title") ?? el.getAttribute("name") ?? "").trim();
}

// --- Overlay -------------------------------------------------------------

let host: HTMLDivElement | null = null;
let frame: HTMLDivElement | null = null;
let bubble: HTMLDivElement | null = null;
let target: HTMLElement | null = null;

function highlight(elementNumber: number, sentence: string) {
  const el = numbered[elementNumber];
  if (!el) return { ok: false };
  ensureOverlay();
  target = el;
  bubble!.textContent = sentence;
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  el.addEventListener("click", clearOverlay, { once: true }); // done once the user clicks it
  render();
  return { ok: true };
}

function clearOverlay() {
  target = null;
  if (host) host.style.display = "none";
  return { ok: true };
}

function ensureOverlay() {
  if (host) {
    host.style.display = "block";
    return;
  }
  host = document.createElement("div");
  host.id = "lotse-overlay-host";
  Object.assign(host.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647" });
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      .frame { position: fixed; border: 3px solid #2563eb; border-radius: 10px; box-shadow: 0 0 0 4px rgb(37 99 235 / 0.25); transition: all 120ms ease-out; }
      .bubble { position: fixed; max-width: 320px; padding: 10px 14px; border-radius: 12px; background: #1e3a8a; color: #fff;
                font: 500 14px/1.4 system-ui, sans-serif; box-shadow: 0 8px 24px rgb(0 0 0 / 0.2); }
      .bubble::before { content: "▲"; position: absolute; top: -14px; left: 16px; color: #1e3a8a; font-size: 14px; }
    </style>
    <div class="frame"></div><div class="bubble"></div>`;
  frame = shadow.querySelector<HTMLDivElement>(".frame");
  bubble = shadow.querySelector<HTMLDivElement>(".bubble");
  document.documentElement.append(host);
}

function render() {
  if (!target || !frame || !bubble) return;
  const r = target.getBoundingClientRect();
  Object.assign(frame.style, { left: `${r.left - 6}px`, top: `${r.top - 6}px`, width: `${r.width + 12}px`, height: `${r.height + 12}px` });
  Object.assign(bubble.style, { left: `${Math.max(8, r.left)}px`, top: `${r.bottom + 16}px` });
}
