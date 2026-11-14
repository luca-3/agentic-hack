import type { InteractiveElement, LotseEvent, ObservationSnapshot } from "@lotse/shared";
import { routeBlocked } from "@lotse/shared/route"; // zod-free: keeps the schemas out of every page
import { abortPageExplore, exploreCurrentPage } from "../utils/explore-dom";
import { findElementByLabel, hasPlaceholder, labelScore, prettyRoute, routeMatches } from "../utils/match";
import type { LotseMessage, PagePolicy, PlanCommand, PlanView } from "../utils/messages";
import { LotseOverlay, type OverlayAction, type OverlayButton, type OverlayView } from "../utils/overlay";
import { ORB_HOST_ID, setupOrb } from "../utils/orb";
import { collectPagePrivacy, type WithPrivacy } from "../utils/pseudonymize";

const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [contenteditable="true"]';
const SIGNAL_ELEMENTS = '[role="alert"], [role="status"], [aria-live="polite"], .field-error, .error-message, .alert-error, .empty-state, .empty-row, .empty-row td, .result-count, .search-empty, .no-results, [data-empty-state], [aria-invalid="true"]';
const EMPTY_RESULTS = /keine?\s+(?:such)?(?:ergebnisse|treffer)|nichts\s+gefunden|kein(?:e|en|er)?\s+[\p{L}-]+\s+(?:gefunden|vorhanden|für\s+diese|mit\s+diesem)|^0\s+(?:kunden|aufgaben|angebote|ergebnisse|treffer|einträge|datensätze|results|items|records|matches)\b|no\s+(?:matching\s+|search\s+)?(?:results|items|records|customers|tasks)\b|nothing\s+found/iu;
const ERROR_MESSAGE = /fehler|ungültig|ungultig|erforderlich|fehlgeschlagen|keine\s+berechtigung|zugriff\s+verweigert|nicht\s+berechtigt|invalid|error|failed|required|permission\s+denied|access\s+denied|forbidden/i;
const PERMISSION_ERROR = /keine\s+berechtigung|zugriff\s+verweigert|nicht\s+berechtigt|nur\s+für\s+die\s+rolle|permission\s+denied|access\s+denied|forbidden/i;
const SEARCH_LABEL = /such|search|filtern|filter/i;
const CLICK_INPUT_TYPES = new Set(["button", "submit", "reset", "checkbox", "radio", "image", "file", "color", "range"]);
const HOST_ID = "lotse-overlay-host";

let numbered: HTMLElement[] = [];
let currentSnapshot: ObservationSnapshot | null = null;
let currentFingerprint = "";
let recording = false;
let previousRoute = "";
let lastUserActivity = Date.now();
let lastProblemAt = 0;
let idleSent = false;
let previousErrors = new Set<string>();
let previousEmpty = false;
let lastSearchAt = 0;
let lastSearchSig = "";
let hoverTimer: ReturnType<typeof setTimeout> | undefined;
let hoveredDisabledHint: { text: string; until: number } | null = null;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let stateTimer: ReturnType<typeof setTimeout> | undefined;
const pendingTimers = new Set<ReturnType<typeof setTimeout>>();

// App policy (D-27): on a blocked route — or while the policy is unknown — Valo reads nothing from the page,
// builds no snapshot, sends no observation and shows no highlight, even while recording.
let policy: PagePolicy | null = null;
let policyAt = 0;
let pausedNow = true;

// Guidance state (read-only: Valo only marks, the user acts — D-17).
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
  // dev.fuller.de = CORPUS dev environment (example data only). Vehicles pages hold the real fleet → never read.
  matches: ["http://localhost/*", "http://127.0.0.1/*", "https://dev.fuller.de/*"],
  excludeMatches: ["https://dev.fuller.de/fahrzeuge*"],
  main(ctx) {
    const onMessage = (message: LotseMessage, _sender: unknown, sendResponse: (response: unknown) => void) => {
      // Fail closed: nothing that reads or marks the page runs on a paused page.
      const blocked = paused();
      const refuse = { ok: false, paused: true, error: "Valo is paused on this page." };
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
            (err: unknown) => sendResponse({ ok: false, error: err instanceof Error ? err.message : "Exploration error" }),
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
    // Explicit trigger (D-30 + extended): greyed-out/disabled controls (≥ 2 presses, plus 1st press logged),
    // rapid rage clicks (≥ 4 in 5 s), dead clicks where UI state does not change (≥ 3 in 15 s), or ≥ 5 presses in 20 s.
    listen(document, "pointerdown", (event) => {
      if (!observeUserEvent(event)) return;
      const pe = event as PointerEvent;
      if (pe.button !== 0) return;
      const outcome = analyzePointerPress(pe);
      if (!outcome) return;
      if (outcome.disabledAttempt) lastProblemAt = Date.now();
      sendObservation({ ...makeEvent(outcome.type, outcome.element), detail: outcome.detail }, buildSnapshot());
      scheduleState();
    });
    listen(document, "pointerover", (event) => {
      if (!recording || !event.isTrusted || paused() || isLotseEvent(event)) return;
      clearTimeout(hoverTimer);
      const element = resolveControlFromEvent(event as PointerEvent);
      if (!element || !isControlDisabled(element)) return;
      hoverTimer = setTimeout(() => {
        if (!recording || paused() || !element.isConnected) return;
        const reason = disabledReason(element);
        const label = accessibleName(element);
        if (label && reason) {
          hoveredDisabledHint = { text: `Locked (${label}): ${reason}`.slice(0, 160), until: Date.now() + 12_000 };
          lastProblemAt = Date.now();
          scheduleState();
        }
      }, 1_800);
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
      if (element && isSearch(element)) recordSearch(element, false);
      scheduleState();
    });
    listen(document, "keydown", (event) => {
      if (event.isTrusted && (event as KeyboardEvent).key === "Escape" && mode !== null) onEscape();
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if ((event as KeyboardEvent).key === "Enter" && element && isSearch(element)) recordSearch(element, true);
    });
    listen(document, "search", (event) => {
      if (!observeUserEvent(event)) return;
      const element = interactiveTarget(event);
      if (element) recordSearch(element, true);
    });
    listen(document, "submit", (event) => {
      if (!observeUserEvent(event)) return;
      const form = event.target instanceof HTMLFormElement ? event.target : null;
      const search = form?.querySelector<HTMLElement>('input[type="search"], [role="searchbox"]');
      if (search) recordSearch(search, true);
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
      const activeEl = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      const inFormOrDialog = Boolean(
        activeEl && (activeEl.closest('form, dialog[open], [role="dialog"]') || isEntry(activeEl)),
      );
      const idleMs = Date.now() - lastUserActivity;
      if (!idleSent && inFormOrDialog && idleMs >= 18_000) {
        idleSent = true;
        sendObservation({ ...makeEvent("idle", undefined, "Form idle"), detail: `idleSec=${Math.round(idleMs / 1000)}` }, buildSnapshot());
      } else if (!idleSent && lastProblemAt > 0 && Date.now() - lastProblemAt <= 45_000 && idleMs >= 20_000) {
        idleSent = true;
        sendObservation({ ...makeEvent("idle", undefined, "Stuck hesitation"), detail: `idleSec=${Math.round(idleMs / 1000)};afterProblem=true` }, buildSnapshot());
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

const REPEATED_CLICKS = { count: 5, disabledCount: 2, deadCount: 3, rageCount: 4, windowMs: 20_000, rageWindowMs: 6_000, radiusPx: 64 } as const;
let pointerHits: Array<{ elementKey: string | null; route: string; x: number; y: number; ts: number; snapshotId: string | undefined }> = [];
const repeatedClickFired = new Map<string, number>();

function isControlDisabled(element: HTMLElement): boolean {
  return element.matches(":disabled") || element.getAttribute("aria-disabled") === "true";
}

/** Finds an interactive control even when `:disabled` suppresses hit-testing or a `.tooltip-wrap` catches the pointer. */
function resolveControlFromEvent(event: PointerEvent): HTMLElement | undefined {
  const target = event.target instanceof Element ? event.target : document.elementFromPoint(event.clientX, event.clientY);
  const direct = target?.closest<HTMLElement>(INTERACTIVE);
  if (direct) return direct;
  const wrapped = target?.querySelector<HTMLElement>('button:disabled, input:disabled, select:disabled, textarea:disabled, [aria-disabled="true"]');
  if (wrapped && isVisible(wrapped)) return wrapped;
  for (const el of numbered) {
    if (!el.isConnected || !isControlDisabled(el)) continue;
    const r = el.getBoundingClientRect();
    if (event.clientX >= r.left && event.clientX <= r.right && event.clientY >= r.top && event.clientY <= r.bottom) return el;
  }
  return undefined;
}

/**
 * Classifies pointer presses:
 *  - Native `:disabled` controls fire no DOM `click`, so press #1 records a semantic `click` (`disabled=true;reason=…`),
 *    and press #2 within 20 s already fires `repeated_click`!
 *  - ≥ 4 rapid presses within 5 s → `rage_click`.
 *  - ≥ 3 presses within 15 s on an enabled non-input control where the UI state never changed → `repeated_click` (`deadClick=true`).
 *  - ≥ 5 presses within 20 s on any spot → `repeated_click` (D-30).
 */
function analyzePointerPress(event: PointerEvent): { type: "click" | "repeated_click" | "rage_click"; element?: HTMLElement; detail: string; disabledAttempt?: boolean } | null {
  const element = resolveControlFromEvent(event);
  const currentRoute = route();
  const elementKey = element ? `${currentRoute}|${roleOf(element)}:${accessibleName(element)}` : null;
  const x = event.clientX;
  const y = event.clientY;
  const fireKey = elementKey ?? `${currentRoute}|area:${Math.round(x / 64)},${Math.round(y / 64)}`;
  const now = Date.now();
  const snapId = currentSnapshot?.id;
  pointerHits = pointerHits.filter((hit) => now - hit.ts <= REPEATED_CLICKS.windowMs);
  pointerHits.push({ elementKey, route: currentRoute, x, y, ts: now, snapshotId: snapId });

  const sameSpot = (hit: (typeof pointerHits)[number]) =>
    hit.route === currentRoute &&
    ((elementKey !== null && hit.elementKey === elementKey) || Math.hypot(hit.x - x, hit.y - y) <= REPEATED_CLICKS.radiusPx);

  const hits = pointerHits.filter(sameSpot);
  const count = hits.length;
  const disabled = Boolean(element && isControlDisabled(element));
  const reason = element && disabled ? disabledReason(element) : "";
  if (disabled && reason && element) {
    hoveredDisabledHint = { text: `Locked (${accessibleName(element)}): ${reason}`.slice(0, 160), until: now + 15_000 };
  }

  const cooldownMs = 8_000;
  const recentlyFired = now - (repeatedClickFired.get(fireKey) ?? 0) < cooldownMs;

  if (disabled && count >= REPEATED_CLICKS.disabledCount && !recentlyFired) {
    repeatedClickFired.set(fireKey, now);
    return {
      type: "repeated_click",
      element,
      disabledAttempt: true,
      detail: [`clicks=${count}`, "disabled=true", reason ? `reason=${reason}` : ""].filter(Boolean).join(";"),
    };
  }

  // Native `:disabled` elements never fire a `click` event — emit press #1 so `/state` and `/intent` see the attempt immediately.
  if (disabled && element?.matches(":disabled") && count === 1) {
    return {
      type: "click",
      element,
      disabledAttempt: true,
      detail: ["disabled=true", reason ? `reason=${reason}` : ""].filter(Boolean).join(";"),
    };
  }

  const rageHits = hits.filter((hit) => now - hit.ts <= REPEATED_CLICKS.rageWindowMs);
  if (rageHits.length >= REPEATED_CLICKS.rageCount && !recentlyFired) {
    repeatedClickFired.set(fireKey, now);
    return {
      type: "rage_click",
      element,
      detail: [`clicks=${rageHits.length}`, `disabled=${disabled}`, reason ? `reason=${reason}` : ""].filter(Boolean).join(";"),
    };
  }

  const recentDead = hits.filter((hit) => now - hit.ts <= 15_000);
  const unchangedState = Boolean(snapId && recentDead.length >= REPEATED_CLICKS.deadCount && recentDead.every((hit) => hit.snapshotId === snapId));
  if (element && !disabled && !isEntry(element) && roleOf(element) !== "tab" && unchangedState && !recentlyFired) {
    repeatedClickFired.set(fireKey, now);
    return {
      type: "repeated_click",
      element,
      detail: `clicks=${recentDead.length};disabled=false;deadClick=true`,
    };
  }

  if (count >= REPEATED_CLICKS.count && !recentlyFired) {
    repeatedClickFired.set(fireKey, now);
    return {
      type: "repeated_click",
      element,
      disabledAttempt: disabled,
      detail: [`clicks=${count}`, `disabled=${disabled}`, reason ? `reason=${reason}` : ""].filter(Boolean).join(";"),
    };
  }
  return null;
}

/** Visible explanation of why a control is locked: title, aria-describedby text, sibling tooltip, or an ancestor's title. */
function disabledReason(element: HTMLElement): string {
  const describedBy = element.getAttribute("aria-describedby");
  const described = describedBy ? describedBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ") : "";
  const siblingTip = element.parentElement?.querySelector('[role="tooltip"], .tooltip')?.textContent ?? "";
  const text = element.getAttribute("title") || described || siblingTip || element.getAttribute("data-tooltip") || element.closest("[title]")?.getAttribute("title") || "";
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
  clearTimeout(hoverTimer);
  clearTimeout(searchTimer);
  clearTimeout(stateTimer);
  for (const timer of pendingTimers) clearTimeout(timer);
  pendingTimers.clear();
}

function scheduleState() {
  clearTimeout(stateTimer);
  stateTimer = setTimeout(() => captureState(), 350);
}

function recordSearch(element: HTMLElement, explicit = false) {
  clearTimeout(searchTimer);
  if (!recording || paused()) return;
  const rawVal = element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement ? element.value.trim() : "";
  // Ignore cleared/empty search inputs so clearing the field doesn't count as a search attempt.
  if (!rawVal && !explicit) return;
  const sig = `${route()}|${accessibleName(element)}|${rawVal.length}`;
  const now = Date.now();
  // Avoid double-counting `input` debounce followed immediately by `change` on blur for the exact same query.
  if (!explicit && sig === lastSearchSig && now - lastSearchAt < 1_500) return;
  if (now - lastSearchAt < 300) return;
  lastSearchAt = now;
  lastSearchSig = sig;

  const snapshot = buildSnapshot();
  const immediateEmpty = signals().empty;
  const searchEvent = makeEvent("search", element);
  const details: string[] = [];
  if (rawVal.length > 0) details.push(`searchLength=${rawVal.length}`);
  if (immediateEmpty) details.push("results=0");
  if (details.length) searchEvent.detail = details.join(";");
  sendObservation(searchEvent, snapshot);
  if (immediateEmpty) {
    lastProblemAt = Date.now();
    previousEmpty = true;
    sendObservation({ ...makeEvent("empty_results", undefined, "No results"), detail: "results=0" }, snapshot);
  }
  after(450, () => captureState(false, true));
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
  const errors = new Map<string, string>();
  const messages = new Set<string>();
  let empty = false;
  const candidates = [...document.querySelectorAll<HTMLElement>(SIGNAL_ELEMENTS), ...document.querySelectorAll<HTMLElement>("p")].slice(0, 350);
  for (const element of candidates) {
    if (!isVisible(element)) continue;
    const text = uiText(element.innerText);
    const rect = element.getBoundingClientRect();
    const offscreen = rect.bottom < 0 || rect.top > innerHeight;
    if (EMPTY_RESULTS.test(text)) {
      empty = true;
      messages.add("Keine Ergebnisse");
    } else if (element.getAttribute("aria-invalid") === "true") {
      const label = "Form validation error: " + accessibleName(element);
      errors.set(label, offscreen ? "offscreen=true" : "");
      messages.add(label.slice(0, 160));
    } else if (text && (ERROR_MESSAGE.test(text) || element.matches(".field-error, .error-message, .alert-error"))) {
      const flags = [
        PERMISSION_ERROR.test(text) ? "permission=true" : "",
        offscreen ? "offscreen=true" : "",
      ].filter(Boolean).join(";");
      errors.set(text, flags);
      messages.add(offscreen ? `${text.slice(0, 138)} (outside viewport)` : text);
    } else if (text && element.matches('[role="status"], [role="alert"]')) messages.add(text);
  }
  if (hoveredDisabledHint && hoveredDisabledHint.until > Date.now()) messages.add(hoveredDisabledHint.text);
  return { errors, messages: [...messages].slice(0, 20), empty };
}

function emitSignals(repeatErrors = false, repeatEmpty = false) {
  const state = signals();
  for (const [error, detail] of state.errors) {
    if (repeatErrors || !previousErrors.has(error)) {
      lastProblemAt = Date.now();
      const ev = makeEvent("error", undefined, error);
      if (detail) ev.detail = detail;
      sendObservation(ev, currentSnapshot ?? undefined);
    }
  }
  if (state.empty && (repeatEmpty || !previousEmpty)) {
    lastProblemAt = Date.now();
    sendObservation({ ...makeEvent("empty_results", undefined, "Keine Ergebnisse"), detail: "results=0" }, currentSnapshot ?? undefined);
  }
  previousErrors = new Set(state.errors.keys());
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
  return [{ action: "up", label: "👍", title: "Helpful" }, { action: "down", label: "👎", title: "Not helpful" }];
}

function feedbackNote() {
  return guidanceOfferId && feedbackSent.has(guidanceOfferId) ? "Thanks for your feedback!" : undefined;
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
  return { text: pointText, detail: answerSay || undefined, note: feedbackNote(), buttons: [...thumbs(), { action: "close", label: "✕", title: "Close hint (Esc)" }] };
}

function sayView(): OverlayView {
  return { title: "Valo", text: answerSay, note: feedbackNote(), buttons: [...thumbs(), { action: "close", label: "✕", title: "Close (Esc)" }] };
}

function legacyHighlight(elementNumber: number, sentence: string, snapshotId?: string) {
  const previous = currentSnapshot?.id;
  const snapshot = buildSnapshot();
  if ((snapshotId && snapshotId !== snapshot.id) || (!snapshotId && previous !== snapshot.id)) return { ok: false, error: "The page has changed." };
  const element = numbered[elementNumber];
  if (!usable(element)) return { ok: false, error: "The target is not available." };
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
  if (!usable(element)) return { ok: false, error: "The target is no longer available on the page." };
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
  overlay.show({ title: "Valo", text: "Was this hint helpful?", buttons: [...thumbs(), { action: "close", label: "✕", title: "Close" }] }, null);
  autoHide(12_000);
}

function showOffer(offerId: string, text: string) {
  if (mode === "point" || mode === "plan") return { ok: false, error: "Valo is already showing a hint." };
  clearTimeout(hideTimer);
  offer = { offerId, text };
  mode = "offer";
  overlay.show({
    title: "Valo", text, tone: "offer",
    buttons: [{ action: "yes", label: "Show me", primary: true }, { action: "no", label: "Not now" }],
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
    if (step.route && !routeMatches(step.route, here)) detail = `This step is on the “${prettyRoute(step.route)}” page.`;
    else if (hasPlaceholder(step.label)) detail = "Pick the matching entry – then we'll continue.";
    else detail = `“${step.label}” is not visible here right now.`;
  } else if (position === 1 && answerSay) detail = answerSay;
  const buttons: OverlayButton[] = [];
  if (position > 1) buttons.push({ action: "back", label: "Back" });
  buttons.push({ action: "next", label: position === total ? "Done" : "Next", primary: !found });
  buttons.push(...thumbs(), { action: "end", label: "✕", title: "End guide (Esc)" });
  return {
    title: `Step ${position}/${total}`,
    text: (step.hint?.trim() || (found ? step.label : `Next step: “${step.label}”`)).slice(0, 300),
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
  overlay.show({ title: "Done", text: "All steps completed.", detail: feedbackOpen ? "Was this guide helpful?" : undefined, buttons: [...thumbs(), { action: "close", label: "✕", title: "Close" }] }, null);
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
        overlay.update({ title: "Valo", text: "Thanks for your feedback!", buttons: [{ action: "close", label: "✕", title: "Close" }] });
        autoHide(1_500);
      }
      break;
    }
    case "close": if (mode === "plan") endPlan(); else resetGuidance(); break;
  }
}
