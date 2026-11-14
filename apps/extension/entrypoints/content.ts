import type { ExtensionMessage, InteractiveElement, LotseEvent, ObservationSnapshot } from "@lotse/shared";

const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [contenteditable="true"]';
const SIGNAL_ELEMENTS = '[role="alert"], [role="status"], .field-error, .error-message, .alert-error, .empty-state, .search-empty, .no-results, [data-empty-state], [aria-invalid="true"]';
const EMPTY_RESULTS = /keine?\s+(?:such)?(?:ergebnisse|treffer)|nichts\s+gefunden|no\s+(?:search\s+)?results|nothing\s+found/i;
const ERROR_MESSAGE = /fehler|ungültig|ungultig|erforderlich|fehlgeschlagen|invalid|error|failed|required/i;
const SEARCH_LABEL = /such|search|filtern|filter/i;
const HOST_ID = "lotse-overlay-host";

let numbered: HTMLElement[] = [];
let currentSnapshot: ObservationSnapshot | null = null;
let currentFingerprint = "";
let recording = false;
let previousRoute = "";
let lastUserActivity = Date.now();
let idleSent = false;
let previousErrors = new Set<string>();
let previousEmpty = false;
let lastSearchAt = 0;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let stateTimer: ReturnType<typeof setTimeout> | undefined;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  main(ctx) {
    const onMessage = (message: ExtensionMessage, _sender: unknown, sendResponse: (response: unknown) => void) => {
      if (message.type === "lotse:snapshot") sendResponse(buildSnapshot());
      else if (message.type === "lotse:highlight") sendResponse(highlight(message.elementNumber, message.sentence, message.snapshotId));
      else if (message.type === "lotse:clear") sendResponse(clearOverlay());
      else if (message.type === "lotse:start") {
        recording = true;
        previousRoute = route();
        lastUserActivity = Date.now();
        lastSearchAt = 0;
        idleSent = false;
        previousErrors.clear();
        previousEmpty = false;
        ensureOverlay();
        showRecordingStatus();
        const snapshot = buildSnapshot();
        sendObservation(makeEvent("route"), snapshot);
        emitSignals();
        sendResponse({ ok: true, snapshot });
      } else if (message.type === "lotse:stop") {
        recording = false;
        clearPendingTimers();
        clearOverlay();
        sendResponse({ ok: true });
      }
    };
    browser.runtime.onMessage.addListener(onMessage);

    const listeners: Array<[EventTarget, string, EventListener, boolean]> = [];
    const listen = (target: EventTarget, type: string, listener: EventListener, capture = true) => {
      target.addEventListener(type, listener, capture);
      listeners.push([target, type, listener, capture]);
    };
    listen(document, "click", (event) => {
      const clicked = interactiveTarget(event);
      if (event.isTrusted && clicked === target) clearOverlay();
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if (element) sendObservation(makeEvent("click", element), buildSnapshot());
      if (element && element === target) clearOverlay();
      scheduleState();
    });
    listen(document, "focusin", (event) => {
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if (element) sendObservation(makeEvent("focus", element), buildSnapshot());
    });
    listen(document, "input", (event) => {
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if (element && isSearch(element)) {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => recordSearch(element), 600);
      }
    });
    listen(document, "change", (event) => {
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if (element && isSearch(element)) recordSearch(element);
      scheduleState();
    });
    listen(document, "keydown", (event) => {
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if ((event as KeyboardEvent).key === "Enter" && element && isSearch(element)) recordSearch(element);
    });
    listen(document, "search", (event) => {
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if (element) recordSearch(element);
    });
    listen(document, "submit", (event) => {
      if (!observeUserEvent(event)) return;
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      const search = form?.querySelector<HTMLElement>('input[type="search"], [role="searchbox"]');
      if (search) recordSearch(search);
      else sendObservation(makeEvent("submit", form ?? undefined), buildSnapshot());
      after(650, () => captureState(true));
    });
    listen(document, "invalid", (event) => {
      if (!recording || isLotseEvent(event)) return;
      const element = interactiveTarget(event);
      sendObservation(makeEvent("error", element, "Form validation error: " + (element ? accessibleName(element) : "Form")), buildSnapshot());
    });
    listen(window, "scroll", () => render());
    listen(window, "resize", () => render());
    listen(document, "visibilitychange", () => {
      if (recording && document.visibilityState === "visible") { markActivity(); scheduleState(); }
    });

    const observer = new MutationObserver((changes) => {
      if (recording && changes.some((change) => !isLotseNode(change.target))) scheduleState();
      if (target && !target.isConnected) clearOverlay();
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["role", "aria-label", "aria-labelledby", "aria-invalid", "aria-expanded", "aria-selected", "disabled", "hidden", "class", "style", "open"],
    });
    const routeAndIdleTimer = setInterval(() => {
      if (!recording || document.visibilityState !== "visible") return;
      const nextRoute = route();
      if (nextRoute !== previousRoute) {
        previousRoute = nextRoute;
        markActivity();
        previousErrors.clear();
        previousEmpty = false;
        sendObservation(makeEvent("route"), buildSnapshot());
        scheduleState();
      }
      const focusedForm = document.activeElement instanceof HTMLElement && document.activeElement.closest("form");
      if (!idleSent && focusedForm && Date.now() - lastUserActivity >= 30_000) {
        idleSent = true;
        sendObservation(makeEvent("idle", undefined, "Form idle"), buildSnapshot());
      }
    }, 500);

    ctx.onInvalidated(() => {
      recording = false;
      clearPendingTimers();
      clearInterval(routeAndIdleTimer);
      observer.disconnect();
      browser.runtime.onMessage.removeListener(onMessage);
      for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture);
      host?.remove();
      host = null;
      target = null;
    });
  },
});

// Query strings can contain search terms or user values. Preserve only hash-router paths.
function route() {
  return location.pathname + (location.hash.startsWith("#/") ? location.hash.split("?")[0] : "");
}

function uiText(text: string | null | undefined, max = 160) {
  return (text ?? "").replace(/„[^“]*“|"[^"]*"/g, "…").replace(/\s+/g, " ").trim().slice(0, max);
}

function isLotseNode(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest("#" + HOST_ID));
}

function isLotseEvent(event: Event) {
  return event.composedPath().some((node) => node instanceof Node && isLotseNode(node));
}

function observeUserEvent(event: Event) {
  if (!recording || !event.isTrusted || isLotseEvent(event)) return false;
  markActivity();
  return true;
}

function markActivity() {
  lastUserActivity = Date.now();
  idleSent = false;
}

function interactiveTarget(event: Event) {
  return event.target instanceof Element ? event.target.closest<HTMLElement>(INTERACTIVE) ?? undefined : undefined;
}

function isSearch(element: HTMLElement) {
  return (element instanceof HTMLInputElement && element.type === "search") || element.getAttribute("role") === "searchbox" ||
    Boolean(element.closest('[role="search"]')) || SEARCH_LABEL.test(accessibleName(element));
}

function makeEvent(type: LotseEvent["type"], element?: HTMLElement, label?: string): LotseEvent {
  return {
    id: crypto.randomUUID(), snapshotId: currentSnapshot?.id, type, route: route(), ts: Date.now(),
    elementRole: element ? roleOf(element) : undefined,
    elementLabel: label ?? (element ? accessibleName(element) : undefined),
  };
}

function sendObservation(event?: LotseEvent, snapshot?: ObservationSnapshot) {
  if (!recording) return;
  if (event && snapshot) event.snapshotId = snapshot.id;
  void browser.runtime.sendMessage({ type: "lotse:observe", event, snapshot } satisfies ExtensionMessage).catch(() => undefined);
}

function after(delay: number, action: () => void) {
  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    if (recording) action();
  }, delay);
  pendingTimers.add(timer);
}

function clearPendingTimers() {
  clearTimeout(searchTimer);
  clearTimeout(stateTimer);
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
}

function scheduleState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => captureState(), 350);
}

function recordSearch(element: HTMLElement) {
  clearTimeout(searchTimer);
  if (!recording || Date.now() - lastSearchAt < 400) return;
  lastSearchAt = Date.now();
  sendObservation(makeEvent("search", element), buildSnapshot());
  after(500, () => captureState(false, true));
}

function captureState(repeatErrors = false, repeatEmpty = false) {
  if (!recording || document.visibilityState !== "visible") return;
  const before = currentSnapshot?.id;
  const snapshot = buildSnapshot();
  if (snapshot.id !== before) sendObservation(makeEvent("dom_change"), snapshot);
  emitSignals(repeatErrors, repeatEmpty);
  render();
}

function signals() {
  const errors = new Set<string>();
  const messages = new Set<string>();
  let empty = false;
  const candidates = [...document.querySelectorAll<HTMLElement>(SIGNAL_ELEMENTS), ...document.querySelectorAll<HTMLElement>("p")].slice(0, 350);
  for (const element of candidates) {
    if (!isVisible(element)) continue;
    const text = uiText(element.innerText);
    if (EMPTY_RESULTS.test(text)) {
      empty = true;
      messages.add("Keine Ergebnisse");
    } else if (element.getAttribute("aria-invalid") === "true") {
      const label = "Form validation error: " + accessibleName(element);
      errors.add(label);
      messages.add(label.slice(0, 160));
    } else if (text && (ERROR_MESSAGE.test(text) || element.matches(".field-error, .error-message, .alert-error"))) {
      errors.add(text);
      messages.add(text);
    } else if (text && element.matches('[role="status"], [role="alert"]')) messages.add(text);
  }
  return { errors, messages: [...messages].slice(0, 20), empty };
}

function emitSignals(repeatErrors = false, repeatEmpty = false) {
  const state = signals();
  for (const error of state.errors) {
    if (repeatErrors || !previousErrors.has(error)) sendObservation(makeEvent("error", undefined, error), currentSnapshot ?? undefined);
  }
  if (state.empty && (repeatEmpty || !previousEmpty)) sendObservation(makeEvent("empty_results", undefined, "Keine Ergebnisse"), currentSnapshot ?? undefined);
  previousErrors = state.errors;
  previousEmpty = state.empty;
}

// State IDs represent semantic content, not scroll geometry or capture time.
function buildSnapshot(): ObservationSnapshot {
  const dialogs = [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"][aria-modal="true"]')].filter(isVisible);
  const scope = dialogs.at(-1) ?? document;
  numbered = [...scope.querySelectorAll<HTMLElement>(INTERACTIVE)].filter(isVisible).slice(0, 120);
  const elements: InteractiveElement[] = numbered.map((element, number) => {
    const rect = element.getBoundingClientRect();
    return {
      number, role: roleOf(element), label: accessibleName(element), route: route(),
      disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    };
  });
  const messages = signals().messages;
  const dialog = dialogs.at(-1);
  if (dialog) {
    const name = accessibleName(dialog) || uiText(dialog.querySelector("h1, h2, h3")?.textContent, 100);
    if (name) messages.unshift(("Dialog: " + name).slice(0, 160));
  }
  const url = location.origin + route();
  const title = uiText(document.title);
  const semantics = numbered.map((element, number) => ({
    ...elements[number], rect: undefined,
    expanded: element.getAttribute("aria-expanded"), selected: element.getAttribute("aria-selected"),
    checked: element instanceof HTMLInputElement && (element.type === "checkbox" || element.type === "radio") ? element.checked : undefined,
  }));
  const fingerprint = JSON.stringify({ url, title, elements: semantics, messages: messages.slice(0, 20) });
  const id = currentSnapshot && fingerprint === currentFingerprint ? currentSnapshot.id : crypto.randomUUID();
  currentFingerprint = fingerprint;
  currentSnapshot = { id, url, title, elements, messages: messages.slice(0, 20), capturedAt: Date.now() };
  return currentSnapshot;
}

function isVisible(element: HTMLElement) {
  if (isLotseNode(element) || element.closest("[hidden], [inert], [data-lotse-private]")) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function roleOf(element: HTMLElement) {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea" || element.isContentEditable) return "textbox";
  if (element instanceof HTMLInputElement) {
    const roles: Record<string, string> = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", search: "searchbox" };
    return roles[element.type] ?? "textbox";
  }
  return tag;
}

/** Only accessible UI labels are read; editable values and search terms never enter the event stream. */
function accessibleName(element: HTMLElement) {
  const aria = element.getAttribute("aria-label");
  if (aria) return uiText(aria, 120);
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    if (text.trim()) return uiText(text, 120);
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    const label = element.labels?.[0]?.textContent;
    if (label?.trim()) return uiText(label, 120);
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) return uiText(placeholder, 120);
    if (element instanceof HTMLInputElement && (element.type === "submit" || element.type === "button")) return uiText(element.getAttribute("value"), 120);
    return uiText(element.getAttribute("title") ?? element.getAttribute("name"), 120);
  }
  if (element.isContentEditable) return uiText(element.getAttribute("title") ?? element.getAttribute("name"), 120);
  return uiText(element.innerText || element.getAttribute("title") || element.getAttribute("name"), 120);
}

let host: HTMLDivElement | null = null;
let frame: HTMLDivElement | null = null;
let bubble: HTMLDivElement | null = null;
let recordingStatus: HTMLDivElement | null = null;
let target: HTMLElement | null = null;

function highlight(elementNumber: number, sentence: string, snapshotId?: string) {
  const previous = currentSnapshot?.id;
  const snapshot = buildSnapshot();
  if ((snapshotId && snapshotId !== snapshot.id) || (!snapshotId && previous !== snapshot.id)) return { ok: false, error: "Der Seitenzustand hat sich geändert." };
  const element = numbered[elementNumber];
  if (!element || !isVisible(element) || element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") return { ok: false, error: "Das Ziel ist nicht verfügbar." };
  ensureOverlay();
  target = element;
  const dialog = element.closest("dialog[open]");
  (dialog ?? document.documentElement).append(host!);
  bubble!.textContent = sentence.slice(0, 1_000);
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  render();
  return { ok: true };
}

function clearOverlay() {
  target = null;
  if (frame) frame.style.display = "none";
  if (bubble) bubble.style.display = "none";
  showRecordingStatus();
  return { ok: true };
}

function showRecordingStatus() {
  if (host) host.style.display = recording || target ? "block" : "none";
  if (recordingStatus) recordingStatus.style.display = recording ? "block" : "none";
}

function ensureOverlay() {
  if (host) {
    host.style.display = "block";
    return;
  }
  host = document.createElement("div");
  host.id = HOST_ID;
  Object.assign(host.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647" });
  const shadow = host.attachShadow({ mode: "open" });
  const style = document.createElement("style");
  style.textContent = '.frame { position:fixed; border:3px solid #2563eb; border-radius:10px; box-shadow:0 0 0 4px rgb(37 99 235 / 0.25); }' +
    '.bubble { position:fixed; box-sizing:border-box; max-width:320px; padding:10px 14px; border-radius:12px; background:#1e3a8a; color:white; font:500 14px/1.4 system-ui,sans-serif; box-shadow:0 8px 24px rgb(0 0 0 / 0.2); }' +
    '.bubble::before { content:"▲"; position:absolute; top:-14px; left:16px; color:#1e3a8a; font-size:14px; }' +
    '.recording { position:fixed; right:12px; bottom:12px; padding:6px 10px; border-radius:20px; background:#1e3a8a; color:white; font:12px system-ui,sans-serif; }';
  frame = document.createElement("div");
  frame.className = "frame";
  frame.style.display = "none";
  bubble = document.createElement("div");
  bubble.className = "bubble";
  bubble.style.display = "none";
  bubble.setAttribute("role", "status");
  recordingStatus = document.createElement("div");
  recordingStatus.className = "recording";
  recordingStatus.textContent = "● Lotse zeichnet lokal auf";
  shadow.append(style, frame, bubble, recordingStatus);
  document.documentElement.append(host);
  showRecordingStatus();
}

function render() {
  if (!target || !frame || !bubble) return;
  if (!target.isConnected || !isVisible(target)) {
    clearOverlay();
    return;
  }
  const rect = target.getBoundingClientRect();
  const left = Math.max(8, Math.min(rect.left, window.innerWidth - 328));
  const top = Math.max(8, Math.min(rect.bottom + 16, window.innerHeight - 110));
  Object.assign(frame.style, { display: "block", left: rect.left - 6 + "px", top: rect.top - 6 + "px", width: rect.width + 12 + "px", height: rect.height + 12 + "px" });
  Object.assign(bubble.style, { display: "block", left: left + "px", top: top + "px", maxWidth: Math.max(140, Math.min(320, window.innerWidth - 16)) + "px" });
}
