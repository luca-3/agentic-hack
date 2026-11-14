import type { InteractiveElement, LotseEvent, ObservationSnapshot } from "@lotse/shared";
import { routeBlocked } from "@lotse/shared/route"; // zod-free: keeps the schemas out of every page
import { abortPageExplore, exploreCurrentPage } from "../utils/explore-dom";
import { findElementByLabel, hasPlaceholder, labelScore, prettyRoute, routeMatches } from "../utils/match";
import type { LotseMessage, PagePolicy, PlanCommand, PlanView } from "../utils/messages";
import { LotseOverlay, type OverlayAction, type OverlayButton, type OverlayView } from "../utils/overlay";
import { ORB_HOST_ID, setupOrb } from "../utils/orb";
import { collectPagePrivacy, type WithPrivacy } from "../utils/pseudonymize";

const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [contenteditable="true"]';
const SIGNAL_ELEMENTS = '[role="alert"], [role="status"], .field-error, .error-message, .alert-error, .empty-state, .search-empty, .no-results, [data-empty-state], [aria-invalid="true"]';
const EMPTY_RESULTS = /keine?\s+(?:such)?(?:ergebnisse|treffer)|nichts\s+gefunden|no\s+(?:search\s+)?results|nothing\s+found/i;
const ERROR_MESSAGE = /fehler|ungültig|ungultig|erforderlich|fehlgeschlagen|invalid|error|failed|required/i;
const SEARCH_LABEL = /such|search|filtern|filter/i;
const CLICK_INPUT_TYPES = new Set(["button", "submit", "reset", "checkbox", "radio", "image", "file", "color", "range"]);
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

// App policy (D-27): on a blocked route — or while the policy is unknown — Lotse reads nothing from the page,
// builds no snapshot, sends no observation and shows no highlight, even while recording.
let policy: PagePolicy | null = null;
let policyAt = 0;
let pausedNow = true;

// Guidance state (read-only: Lotse only marks, the user acts — D-17).
type Mode = "point" | "plan" | "say" | "offer" | "feedback" | "done" | null;
let mode: Mode = null;
let plan: PlanView | null = null;
let planShown: { index: number; element: HTMLElement | null } | null = null;
let planTimer: ReturnType<typeof setTimeout> | undefined;
let hideTimer: ReturnType<typeof setTimeout> | undefined;
let guidanceRoute = "";
let pointText = "";
let answerSay = "";
let guidanceOfferId: string | undefined;
let offer: { offerId: string; text: string } | null = null;
const feedbackSent = new Set<string>();

const overlay = new LotseOverlay({
  hostId: HOST_ID,
  onAction: (action) => onOverlayAction(action),
  onTargetLost: () => onTargetLost(),
  isVisible: (element) => isVisible(element),
});

export default defineContentScript({
  matches: ["http://localhost/*", "http://127.0.0.1/*"],
  main(ctx) {
    const onMessage = (message: LotseMessage, _sender: unknown, sendResponse: (response: unknown) => void) => {
      // Fail closed: nothing that reads or marks the page runs on a paused page.
      const blocked = paused();
      const refuse = { ok: false, paused: true, error: "Lotse pausiert auf dieser Seite." };
      switch (message.type) {
        case "lotse:policy": applyPolicy(message.policy); sendResponse({ ok: true }); break;
        case "lotse:snapshot": sendResponse(blocked ? refuse : withPrivacy(buildSnapshot())); break;
        case "lotse:highlight": sendResponse(blocked ? refuse : legacyHighlight(message.elementNumber, message.sentence, message.snapshotId)); break;
        case "lotse:point": sendResponse(blocked ? refuse : showPoint(message.elementNumber, message.label, message.hint, message.snapshotId, message.offerId)); break;
        case "lotse:say": if (!blocked) showSay(message.text, message.offerId); sendResponse(blocked ? refuse : { ok: true }); break;
        case "lotse:plan-show": startPlan(message.plan, message.resume === true); sendResponse({ ok: true }); break;
        case "lotse:plan-control": planCommand(message.action); sendResponse({ ok: true }); break;
        case "lotse:show-offer": sendResponse(blocked ? refuse : showOffer(message.offerId, message.offer)); break;
        case "lotse:hide-offer": if (mode === "offer") resetGuidance(); sendResponse({ ok: true }); break;
        case "lotse:clear": resetGuidance(); sendResponse({ ok: true }); break;
        case "lotse:voice-state": overlay.setVoiceState(message.state); sendResponse({ ok: true }); break;
        case "lotse:explore-chip": overlay.setExploreText(message.text); sendResponse({ ok: true }); break;
        case "lotse:explore-abort": abortPageExplore(); overlay.setExploreText(""); sendResponse({ ok: true }); break;
        case "lotse:explore-run":
          if (blocked) { sendResponse(refuse); break; }
          exploreCurrentPage({
            reachedVia: message.reachedVia,
            maxRemaining: message.maxRemaining,
            deadlineAt: message.deadlineAt,
            seenGlobalKeys: message.seenGlobalKeys,
            startOrigin: message.startOrigin,
            blockedRoutes: message.blockedRoutes,
            hostId: HOST_ID,
          }).then(
            (res) => sendResponse({ ok: true, ...res }),
            (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : "Erkundungsfehler" }),
          );
          return true;
        case "lotse:start": {
          recording = true;
          previousRoute = route();
          lastUserActivity = Date.now();
          lastSearchAt = 0;
          idleSent = false;
          previousErrors.clear();
          previousEmpty = false;
          overlay.setRecording(true);
          overlay.setPaused(blocked, true);
          if (blocked) { sendResponse({ ok: true, paused: true }); break; }
          const snapshot = buildSnapshot();
          sendObservation(makeEvent("route"), snapshot);
          emitSignals();
          sendResponse({ ok: true, snapshot });
          break;
        }
        case "lotse:stop":
          recording = false;
          clearPendingTimers();
          overlay.setRecording(false);
          overlay.setPaused(pausedNow, plan !== null);
          if (mode === "offer") resetGuidance();
          sendResponse({ ok: true });
          break;
        default: break; // not for the content script
      }
    };
    browser.runtime.onMessage.addListener(onMessage);

    const listeners: Array<[EventTarget, string, EventListener, boolean]> = [];
    const listen = (target: EventTarget, type: string, listener: EventListener, capture = true) => {
      target.addEventListener(type, listener, capture);
      listeners.push([target, type, listener, capture]);
    };
    listen(document, "click", (event) => {
      if (event.isTrusted && !isLotseEvent(event) && !paused()) onGuidedClick(event);
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if (element) sendObservation(makeEvent("click", element), buildSnapshot());
      scheduleState();
    });
    // Explicit trigger (D-30): ≥ 5 presses on the same spot within 20 s — e.g. a disabled button that "does nothing".
    // pointerdown, because Chrome dispatches no click event on disabled form controls.
    listen(document, "pointerdown", (event) => {
      if (!observeUserEvent(event)) return;
      const hit = repeatedClick(event as PointerEvent);
      if (!hit) return;
      sendObservation({ ...makeEvent("repeated_click", hit.element), detail: hit.detail }, buildSnapshot());
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
      if (event.isTrusted && !isLotseEvent(event) && !paused()) onGuidedChange(event);
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if (element && isSearch(element)) recordSearch(element);
      scheduleState();
    });
    listen(document, "keydown", (event) => {
      if (event.isTrusted && (event as KeyboardEvent).key === "Escape" && mode !== null) onEscape();
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
      if (!recording || paused() || isLotseEvent(event)) return;
      const element = interactiveTarget(event);
      sendObservation(makeEvent("error", element, "Form validation error: " + (element ? accessibleName(element) : "Form")), buildSnapshot());
    });
    listen(window, "scroll", () => overlay.render());
    listen(window, "resize", () => overlay.render());
    listen(document, "visibilitychange", () => {
      if (recording && !paused() && document.visibilityState === "visible") { markActivity(); scheduleState(); }
    });
    // Hash/history navigation can enter a blocked route between two timer ticks: re-check right away.
    listen(window, "hashchange", () => checkPause());
    listen(window, "popstate", () => checkPause());

    const observer = new MutationObserver((changes) => {
      if (paused()) return;
      const external = changes.some((change) => !isLotseNode(change.target));
      if (recording && external) scheduleState();
      const target = overlay.currentTarget;
      if (external && plan && (!target || !target.isConnected)) schedulePlanRefresh(400, true);
      else if (target && !target.isConnected) onTargetLost();
    });
    observer.observe(document.documentElement, {
      subtree: true, childList: true, characterData: true, attributes: true,
      attributeFilter: ["role", "aria-label", "aria-labelledby", "aria-invalid", "aria-expanded", "aria-selected", "disabled", "hidden", "class", "style", "open"],
    });
    guidanceRoute = route();
    const routeAndIdleTimer = setInterval(() => {
      if (Date.now() - policyAt > (policy ? 60_000 : 5_000)) requestPolicy();
      if (checkPause()) return;
      const now = route();
      if (now !== guidanceRoute) {
        guidanceRoute = now;
        if (plan) schedulePlanRefresh(300, true);
      }
      if (!recording || document.visibilityState !== "visible") return;
      if (now !== previousRoute) {
        previousRoute = now;
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

    requestPolicy();
    // D-29 status orb: always visible on org app pages; it replaces the overlay's status chips while shown.
    const orb = setupOrb({ onVisibleChange: (visible) => overlay.setChipsHidden(visible) });
    // A multi-step plan continues across full page loads: the service worker keeps it in chrome.storage.session.
    void browser.runtime.sendMessage({ type: "lotse:plan-resume" } satisfies LotseMessage)
      .then((result: { plan?: PlanView | null } | undefined) => { if (result?.plan && !plan) startPlan(result.plan, true); })
      .catch(() => undefined);

    ctx.onInvalidated(() => {
      recording = false;
      abortPageExplore();
      clearPendingTimers();
      clearTimeout(planTimer);
      clearTimeout(hideTimer);
      clearInterval(routeAndIdleTimer);
      observer.disconnect();
      browser.runtime.onMessage.removeListener(onMessage);
      for (const [target, type, listener, capture] of listeners) target.removeEventListener(type, listener, capture);
      orb.destroy();
      overlay.destroy();
    });
  },
});

// ---------------------------------------------------------------------------
// App policy (D-27): blocked routes are matched against the FULL local location (path + query + hash) —
// checked here only; the query string never leaves the browser.
// ---------------------------------------------------------------------------

function paused() {
  return !policy || !policy.allowed || routeBlocked(location.pathname + location.search + location.hash, policy.blockedRoutes);
}

function requestPolicy() {
  policyAt = Date.now();
  void browser.runtime.sendMessage({ type: "lotse:get-policy" } satisfies LotseMessage)
    .then((result: { policy?: PagePolicy | null } | undefined) => applyPolicy(result?.policy ?? null))
    .catch(() => applyPolicy(policy)); // worker unreachable: keep the last known policy (null stays paused)
}

function applyPolicy(next: PagePolicy | null | undefined) {
  policyAt = Date.now();
  policy = next && typeof next.allowed === "boolean" && Array.isArray(next.blockedRoutes)
    ? { allowed: next.allowed, blockedRoutes: next.blockedRoutes.filter((pattern): pattern is string => typeof pattern === "string") }
    : null;
  checkPause();
}

/** Re-evaluates the pause state; on a change it tells the worker (a bare boolean) and stops or resumes. Returns paused. */
function checkPause(): boolean {
  const next = paused();
  if (next === pausedNow) return next;
  pausedNow = next;
  overlay.setPaused(next, recording || plan !== null);
  send({ type: "lotse:paused", paused: next });
  if (next) {
    clearPendingTimers();
    clearTimeout(planTimer);
    if (plan) { planShown = null; overlay.clear(); } // the plan stays; it resumes on an allowed page
    else resetGuidance();
    // Forget everything read from the previous page state.
    numbered = [];
    currentSnapshot = null;
    currentFingerprint = "";
    return true;
  }
  if (recording) {
    previousRoute = route();
    previousErrors.clear();
    previousEmpty = false;
    markActivity();
    sendObservation(makeEvent("route"), buildSnapshot());
    scheduleState();
  }
  if (plan) schedulePlanRefresh(300, true);
  return false;
}

// Query strings can contain search terms or user values. Preserve only hash-router paths.
function route() {
  return location.pathname + (location.hash.startsWith("#/") ? location.hash.split("?")[0] : "");
}

function uiText(text: string | null | undefined, max = 160) {
  return (text ?? "").replace(/„[^“]*“|"[^"]*"/g, "…").replace(/\s+/g, " ").trim().slice(0, max);
}

function isLotseNode(node: Node) {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(`#${HOST_ID}, #${ORB_HOST_ID}`));
}

function isLotseEvent(event: Event) {
  return event.composedPath().some((node) => node instanceof Node && isLotseNode(node));
}

function observeUserEvent(event: Event) {
  if (!recording || !event.isTrusted || paused() || isLotseEvent(event)) return false;
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

const REPEATED_CLICKS = { count: 5, windowMs: 20_000, cell: 24 } as const;
let pointerHits: Array<{ key: string; ts: number }> = [];
const repeatedClickFired = new Map<string, number>();

/** Counts presses per element (role + label + route) or per 24-px screen cell; fires once per spot and window. */
function repeatedClick(event: PointerEvent): { element?: HTMLElement; detail: string } | null {
  if (event.button !== 0) return null;
  const target = event.target instanceof Element ? event.target : document.elementFromPoint(event.clientX, event.clientY);
  const element = target?.closest<HTMLElement>(INTERACTIVE) ?? undefined;
  const spot = element
    ? `${roleOf(element)}:${accessibleName(element)}`
    : `pt:${Math.round(event.clientX / REPEATED_CLICKS.cell)},${Math.round(event.clientY / REPEATED_CLICKS.cell)}`;
  const key = `${route()}|${spot}`;
  const now = Date.now();
  pointerHits = pointerHits.filter((hit) => now - hit.ts <= REPEATED_CLICKS.windowMs);
  pointerHits.push({ key, ts: now });
  const count = pointerHits.filter((hit) => hit.key === key).length;
  if (count < REPEATED_CLICKS.count || now - (repeatedClickFired.get(key) ?? 0) < REPEATED_CLICKS.windowMs) return null;
  repeatedClickFired.set(key, now);
  const disabled = Boolean(element && (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true"));
  const reason = element ? disabledReason(element) : "";
  return { element, detail: [`clicks=${count}`, `disabled=${disabled}`, reason ? `reason=${reason}` : ""].filter(Boolean).join(";") };
}

/** Visible explanation of why a control is locked: title, aria-describedby text, a tooltip attribute, or an ancestor's title. */
function disabledReason(element: HTMLElement): string {
  const describedBy = element.getAttribute("aria-describedby");
  const described = describedBy ? describedBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
  const text = element.getAttribute("title") || described || element.getAttribute("data-tooltip") || element.closest("[title]")?.getAttribute("title") || "";
  return text.replace(/\s+/g, " ").replace(/;/g, ",").trim().slice(0, 120);
}

function makeEvent(type: LotseEvent["type"], element?: HTMLElement, label?: string): LotseEvent {
  return {
    id: crypto.randomUUID(), snapshotId: currentSnapshot?.id, type, route: route(), ts: Date.now(),
    elementRole: element ? roleOf(element) : undefined,
    elementLabel: label ?? (element ? accessibleName(element) : undefined),
  };
}

function sendObservation(event?: LotseEvent, snapshot?: ObservationSnapshot) {
  if (!recording || paused()) return;
  if (event && snapshot) event.snapshotId = snapshot.id;
  send({ type: "lotse:observe", event, snapshot: snapshot && withPrivacy(snapshot) });
}

/**
 * D-26: the page's content strings (record links, table cells, record headings …) and the rects to paint over in
 * screenshots travel with every snapshot to the service worker, which pseudonymizes before anything leaves the browser.
 */
function withPrivacy(snapshot: ObservationSnapshot): WithPrivacy<ObservationSnapshot> {
  return { ...snapshot, privacy: collectPagePrivacy(numbered, accessibleName, isVisible) };
}

function send(message: LotseMessage) {
  void browser.runtime.sendMessage(message).catch(() => undefined);
}

function after(delay: number, action: () => void) {
  const timer = setTimeout(() => {
    pendingTimers.delete(timer);
    if (recording && !paused()) action();
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
  if (!recording || paused() || Date.now() - lastSearchAt < 400) return;
  lastSearchAt = Date.now();
  sendObservation(makeEvent("search", element), buildSnapshot());
  after(500, () => captureState(false, true));
}

function captureState(repeatErrors = false, repeatEmpty = false) {
  if (!recording || paused() || document.visibilityState !== "visible") return;
  const before = currentSnapshot?.id;
  const snapshot = buildSnapshot();
  if (snapshot.id !== before) sendObservation(makeEvent("dom_change"), snapshot);
  emitSignals(repeatErrors, repeatEmpty);
  overlay.render();
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

// ---------------------------------------------------------------------------
// Guidance: point, say, multi-step plan, proactive offer, feedback
// ---------------------------------------------------------------------------

function usable(element: HTMLElement | undefined): element is HTMLElement {
  return Boolean(element && element.isConnected && isVisible(element) && !element.matches(":disabled") && element.getAttribute("aria-disabled") !== "true");
}

/** Text entry targets advance on `change` (value committed), everything else on click. */
function isEntry(element: HTMLElement) {
  if (element instanceof HTMLTextAreaElement || element instanceof HTMLSelectElement || element.isContentEditable) return true;
  return element instanceof HTMLInputElement && !CLICK_INPUT_TYPES.has(element.type);
}

function viewport() {
  return { width: innerWidth, height: innerHeight };
}

function byLabel(label: string, snapshot: ObservationSnapshot): HTMLElement | undefined {
  const match = findElementByLabel(label, snapshot.elements, viewport());
  return match ? numbered[match.number] : undefined;
}

function thumbs(): OverlayButton[] {
  if (!guidanceOfferId || feedbackSent.has(guidanceOfferId)) return [];
  return [{ action: "up", label: "👍", title: "Hilfreich" }, { action: "down", label: "👎", title: "Nicht hilfreich" }];
}

function feedbackNote() {
  return guidanceOfferId && feedbackSent.has(guidanceOfferId) ? "Danke für dein Feedback!" : undefined;
}

function autoHide(ms: number) {
  clearTimeout(hideTimer);
  hideTimer = setTimeout(() => {
    hideTimer = undefined;
    if (mode === "say" || mode === "offer" || mode === "feedback" || mode === "done") resetGuidance();
  }, ms);
}

function resetGuidance() {
  clearTimeout(planTimer);
  clearTimeout(hideTimer);
  mode = null;
  plan = null;
  planShown = null;
  offer = null;
  pointText = "";
  answerSay = "";
  guidanceOfferId = undefined;
  overlay.clear();
}

function pointView(): OverlayView {
  return { text: pointText, detail: answerSay || undefined, note: feedbackNote(), buttons: [...thumbs(), { action: "close", label: "✕", title: "Hinweis schließen (Esc)" }] };
}

function sayView(): OverlayView {
  return { title: "Lotse", text: answerSay, note: feedbackNote(), buttons: [...thumbs(), { action: "close", label: "✕", title: "Schließen (Esc)" }] };
}

function legacyHighlight(elementNumber: number, sentence: string, snapshotId?: string) {
  const previous = currentSnapshot?.id;
  const snapshot = buildSnapshot();
  if ((snapshotId && snapshotId !== snapshot.id) || (!snapshotId && previous !== snapshot.id)) return { ok: false, error: "Der Seitenzustand hat sich geändert." };
  const element = numbered[elementNumber];
  if (!usable(element)) return { ok: false, error: "Das Ziel ist nicht verfügbar." };
  clearTimeout(hideTimer);
  mode = "point";
  pointText = sentence.slice(0, 600);
  overlay.show(pointView(), element);
  return { ok: true };
}

/** `point` numbers refer to the request snapshot; if the page changed meanwhile, fall back to the label. */
function showPoint(elementNumber: number, label: string, hint: string | undefined, snapshotId: string, offerId?: string) {
  if (plan) return { ok: true }; // the plan of the same answer already marks this step
  const snapshot = buildSnapshot();
  let element: HTMLElement | undefined = snapshot.id === snapshotId ? numbered[elementNumber] : undefined;
  if (!usable(element)) element = byLabel(label, snapshot);
  if (!usable(element)) return { ok: false, error: "Das Ziel ist auf der Seite nicht mehr verfügbar." };
  clearTimeout(hideTimer);
  if (offerId) guidanceOfferId = offerId;
  offer = null;
  mode = "point";
  pointText = (hint || label).slice(0, 600);
  overlay.show(pointView(), element);
  return { ok: true };
}

function showSay(text: string, offerId?: string) {
  answerSay = text.slice(0, 200);
  if (offerId) guidanceOfferId = offerId;
  if (mode === "point" && overlay.visible) { overlay.update(pointView()); return; }
  if (mode === "plan" && plan) { if (planShown) overlay.update(planView(Boolean(planShown.element))); return; }
  offer = null;
  mode = "say";
  overlay.show(sayView(), null);
  autoHide(guidanceOfferId ? 30_000 : 20_000);
}

function completePoint() {
  overlay.clear();
  pointText = "";
  answerSay = "";
  if (guidanceOfferId && !feedbackSent.has(guidanceOfferId)) showFeedbackCard();
  else resetGuidance();
}

function showFeedbackCard() {
  mode = "feedback";
  overlay.show({ title: "Lotse", text: "War der Hinweis hilfreich?", buttons: [...thumbs(), { action: "close", label: "✕", title: "Schließen" }] }, null);
  autoHide(12_000);
}

function showOffer(offerId: string, text: string) {
  if (mode === "point" || mode === "plan") return { ok: false, error: "Lotse zeigt gerade schon einen Hinweis." };
  clearTimeout(hideTimer);
  offer = { offerId, text };
  mode = "offer";
  overlay.show({
    title: "Lotse", text, tone: "offer",
    buttons: [{ action: "yes", label: "Ja, zeig's mir", primary: true }, { action: "no", label: "Nein" }],
  }, null);
  autoHide(60_000);
  return { ok: true };
}

// --- multi-step plan --------------------------------------------------------

function startPlan(view: PlanView, resume: boolean) {
  if (!view.steps.length) return;
  clearTimeout(hideTimer);
  clearTimeout(planTimer);
  offer = null;
  pointText = "";
  plan = { ...view, index: Math.min(Math.max(view.index, 0), view.steps.length - 1) };
  planShown = null;
  if (view.offerId) guidanceOfferId = view.offerId;
  mode = "plan";
  // After a full page load the app may still be rendering; look ahead in case the last advance was not stored.
  if (resume) schedulePlanRefresh(350, true);
  else showPlanStep(false);
}

function schedulePlanRefresh(delay: number, lookahead: boolean) {
  if (!plan) return;
  clearTimeout(planTimer);
  planTimer = setTimeout(() => { planTimer = undefined; showPlanStep(lookahead); }, delay);
}

function resolveStep(index: number, snapshot: ObservationSnapshot): HTMLElement | undefined {
  const step = plan?.steps[index];
  if (!plan || !step) return undefined;
  if (step.elementNumber !== undefined && plan.snapshotId === snapshot.id) {
    const element = numbered[step.elementNumber];
    if (usable(element)) return element;
  }
  // "Zeile ‹Kundenname›" is the user's choice — show the hint and wait for the next step's label to appear.
  if (hasPlaceholder(step.label)) return undefined;
  const element = byLabel(step.label, snapshot);
  return usable(element) ? element : undefined;
}

function showPlanStep(lookahead: boolean) {
  if (!plan) return;
  if (paused()) { planShown = null; overlay.clear(); return; } // resumes via checkPause() on an allowed page
  const snapshot = buildSnapshot();
  const here = route();
  let index = plan.index;
  let element = resolveStep(index, snapshot);
  if (!element && lookahead) {
    for (let next = index + 1; next < plan.steps.length; next++) {
      const step = plan.steps[next];
      if (!step || (step.route && !routeMatches(step.route, here))) continue;
      const candidate = resolveStep(next, snapshot);
      if (candidate) { index = next; element = candidate; break; }
    }
  }
  if (index !== plan.index) setPlanIndex(index);
  const shown = element ?? null;
  if (planShown && planShown.index === plan.index && planShown.element === shown && overlay.visible) { overlay.render(); return; }
  planShown = { index: plan.index, element: shown };
  overlay.show(planView(Boolean(element)), shown);
}

function planView(found: boolean): OverlayView {
  const current = plan!;
  const step = current.steps[current.index]!;
  const position = current.index + 1;
  const total = current.steps.length;
  const here = route();
  let detail: string | undefined;
  if (!found) {
    if (step.route && !routeMatches(step.route, here)) detail = `Dieser Schritt ist auf der Seite „${prettyRoute(step.route)}“.`;
    else if (hasPlaceholder(step.label)) detail = "Wähle den passenden Eintrag aus – dann geht es weiter.";
    else detail = `„${step.label}“ ist hier gerade nicht sichtbar.`;
  } else if (position === 1 && answerSay) detail = answerSay;
  const buttons: OverlayButton[] = [];
  if (position > 1) buttons.push({ action: "back", label: "Zurück" });
  buttons.push({ action: "next", label: position === total ? "Fertig" : "Weiter", primary: !found });
  buttons.push(...thumbs(), { action: "end", label: "✕", title: "Anleitung beenden (Esc)" });
  return {
    title: `Schritt ${position}/${total}`,
    text: (step.hint?.trim() || (found ? step.label : `Nächster Schritt: „${step.label}“`)).slice(0, 300),
    detail, note: feedbackNote(), buttons,
  };
}

function setPlanIndex(index: number) {
  if (!plan) return;
  plan.index = Math.min(Math.max(index, 0), plan.steps.length - 1);
  // Sent before a link click unloads the page, so the next document resumes at the right step.
  send({ type: "lotse:plan-update", planId: plan.id, index: plan.index });
}

function advancePlan() {
  if (!plan) return;
  if (plan.index >= plan.steps.length - 1) { finishPlan(); return; }
  setPlanIndex(plan.index + 1);
  planShown = null;
  overlay.clear(true);
  schedulePlanRefresh(450, false);
}

function finishPlan() {
  if (!plan) return;
  send({ type: "lotse:plan-end", planId: plan.id, reason: "done" });
  plan = null;
  planShown = null;
  clearTimeout(planTimer);
  mode = "done";
  const feedbackOpen = thumbs().length > 0;
  overlay.show({ title: "Fertig", text: "Alle Schritte erledigt.", detail: feedbackOpen ? "War die Anleitung hilfreich?" : undefined, buttons: [...thumbs(), { action: "close", label: "✕", title: "Schließen" }] }, null);
  autoHide(feedbackOpen ? 15_000 : 3_000);
}

function endPlan() {
  if (plan) send({ type: "lotse:plan-end", planId: plan.id, reason: "closed" });
  resetGuidance();
}

function planCommand(action: PlanCommand) {
  if (!plan) return;
  if (action === "end") { endPlan(); return; }
  if (action === "next") {
    if (plan.index >= plan.steps.length - 1) { finishPlan(); return; }
    setPlanIndex(plan.index + 1);
  } else {
    if (plan.index === 0) return;
    setPlanIndex(plan.index - 1);
  }
  planShown = null;
  showPlanStep(false);
}

// --- user interaction ---------------------------------------------------------

function onGuidedClick(event: Event) {
  const target = overlay.currentTarget;
  const onTarget = Boolean(target && event.composedPath().includes(target));
  if (mode === "point" && onTarget && target && !isEntry(target)) { completePoint(); return; }
  if (mode !== "plan" || !plan) return;
  if (onTarget && target) { if (!isEntry(target)) advancePlan(); return; }
  // The user did the current step even though it was not (yet) highlighted, e.g. right after a field was committed.
  const clicked = interactiveTarget(event);
  const step = plan.steps[plan.index];
  if (clicked && step && !isEntry(clicked) && !hasPlaceholder(step.label) && labelScore(step.label, accessibleName(clicked)) >= 85) advancePlan();
}

function onGuidedChange(event: Event) {
  const target = overlay.currentTarget;
  if (!target || !isEntry(target) || !event.composedPath().includes(target)) return;
  if (mode === "plan") advancePlan();
  else if (mode === "point") completePoint();
}

function onEscape() {
  if (mode === "plan") endPlan();
  else resetGuidance();
}

function onTargetLost() {
  if (mode === "plan" && plan) {
    planShown = null;
    overlay.clear(true);
    schedulePlanRefresh(300, true);
  } else if (mode === "point") resetGuidance();
}

function onOverlayAction(action: OverlayAction) {
  switch (action) {
    case "next": planCommand("next"); break;
    case "back": planCommand("back"); break;
    case "end": endPlan(); break;
    case "yes": {
      if (!offer) return;
      send({ type: "lotse:offer-accept", offerId: offer.offerId });
      guidanceOfferId = offer.offerId;
      offer = null;
      mode = null;
      clearTimeout(hideTimer);
      overlay.clear(true);
      break;
    }
    case "no": {
      if (!offer) return;
      send({ type: "lotse:offer-feedback", offerId: offer.offerId, feedback: "declined" });
      resetGuidance();
      break;
    }
    case "up":
    case "down": {
      const offerId = guidanceOfferId;
      if (!offerId || feedbackSent.has(offerId)) return;
      feedbackSent.add(offerId);
      send({ type: "lotse:offer-feedback", offerId, feedback: action });
      if (mode === "plan" && planShown) overlay.update(planView(Boolean(planShown.element)));
      else if (mode === "point") overlay.update(pointView());
      else if (mode === "say") overlay.update(sayView());
      else if (mode === "feedback" || mode === "done") {
        overlay.update({ title: "Lotse", text: "Danke für dein Feedback!", buttons: [{ action: "close", label: "✕", title: "Schließen" }] });
        autoHide(1_500);
      }
      break;
    }
    case "close": if (mode === "plan") endPlan(); else resetGuidance(); break;
  }
}
