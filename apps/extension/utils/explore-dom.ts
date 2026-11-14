/**
 * Safe, bounded DOM exploration for one document (D-25).
 * Only org admins can start exploration (enforced in background + server).
 * Non-negotiable guardrails:
 *  - Only inspects links, tabs, menus/disclosures and dialog openers
 *  - Blocks every form `submit` event in capture phase
 *  - Never clicks anything matching `EXPLORE_NEVER_CLICK` or mutating/reset labels
 *  - Never clicks red or danger-styled controls
 *  - Same origin only; respects `blockedRoutes` (D-27) and `EXPLORE_LIMITS` (60 pages, 150 elements/page, 3 min)
 */
import {
  EXPLORE_LIMITS,
  EXPLORE_NEVER_CLICK,
  ExploredPageSchema,
  type ElementStyle,
  type ExploredElement,
  type ExploredPage,
} from "@lotse/shared";
import { routeBlocked } from "@lotse/shared/route";
import { ORB_HOST_ID } from "./orb";
import { collectPagePrivacy, type PrivacyTerm } from "./pseudonymize";

export type DiscoveredLink = {
  url: string;
  label: string;
  reachedVia: string[];
};

export type ExploreStepOptions = {
  reachedVia: string[];
  maxRemaining: number;
  deadlineAt: number;
  seenGlobalKeys: string[];
  startOrigin: string;
  blockedRoutes: string[];
  hostId: string;
};

export type ExploreStepResult = {
  pages: ExploredPage[];
  links: DiscoveredLink[];
  seenGlobalKeys: string[];
  privacyTerms: PrivacyTerm[];
};

const INTERACTIVE =
  'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="checkbox"], [contenteditable="true"]';

/** Extra mutating, collapsing or reset words never clicked to open views (beyond `EXPLORE_NEVER_CLICK`). */
const EXTRA_NEVER_OPEN = [
  "zurücksetzen", "reset", "kündigen", "endgültig", "widerrufen", "ablehnen", "zurückweisen",
  "duplizieren", "markieren", "zuweisen", "stornieren", "deaktivieren", "abbrechen", "schließen",
  "close", "cancel", "navigation einklappen", "alle auswählen", "entfernen",
];

const DANGER_ATTR = /\b(danger|destructive|delete|remove|error|warn|warning|critical)\b/i;
const DIALOG_LABEL = /^(?:neue[rs]?\s+\S+|.*\b(?:anlegen|erstellen|öffnen|hochladen|bearbeiten|ändern|einrichten|aktivieren)\b)/i;
const CLOSE_BUTTON_LABEL = /^(?:abbrechen|schließen|dialog schließen|cancel|close|×|✕|x)$/i;
const SINGLE_GLYPH = /^[\s▾▴◂▸▼▲×✕…⋮•·+|\-–—]+$/;

type Rgba = { r: number; g: number; b: number; a: number };

let aborted = false;

export function abortPageExplore() {
  aborted = true;
}

export async function exploreCurrentPage(options: ExploreStepOptions): Promise<ExploreStepResult> {
  aborted = false;
  const pages: ExploredPage[] = [];
  const links: DiscoveredLink[] = [];
  const seenLinks = new Set<string>();
  const seenGlobal = new Set<string>(options.seenGlobalKeys);
  const termsMap = new Map<string, PrivacyTerm>();
  const clickedElements = new WeakSet<HTMLElement>();

  const stopped = () => aborted || pages.length >= options.maxRemaining || Date.now() >= options.deadlineAt;

  // Hard physical block: no form can ever submit while the explorer inspects a page.
  const blockSubmit = (event: Event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  const originalOpen = window.open;
  window.addEventListener("submit", blockSubmit, true);
  try {
    window.open = () => null;
  } catch { /* ignore read-only window.open */ }

  const addPage = (kind: ExploredPage["kind"], scope: ParentNode, via: string[], subTitle?: string) => {
    if (stopped()) return;
    const captured = captureExploredPage(kind, scope, via, options.hostId, subTitle);
    if (!captured) return;
    pages.push(captured.page);
    for (const term of captured.terms) {
      if (termsMap.size < 1_200) termsMap.set(term.text.toLocaleLowerCase("de-DE"), term);
    }
  };

  const harvestLinks = (scope: ParentNode, via: string[]) => {
    for (const anchor of scope.querySelectorAll<HTMLAnchorElement>("a[href]")) {
      if (!isVisible(anchor, options.hostId) || !isSafeToClick(anchor, options.hostId)) continue;
      const rawHref = anchor.getAttribute("href")?.trim() ?? "";
      if (!rawHref || rawHref === "#" || /^(?:javascript|mailto|tel|blob|data):/i.test(rawHref)) continue;
      if (anchor.hasAttribute("download")) continue;
      let resolved: URL;
      try {
        resolved = new URL(rawHref, location.href);
      } catch {
        continue;
      }
      if (resolved.origin !== options.startOrigin) continue;
      if (!["http:", "https:"].includes(resolved.protocol)) continue;
      if (routeBlocked(resolved.pathname + resolved.search + resolved.hash, options.blockedRoutes)) continue;
      // Same-document non-router hash links (#section) are handled locally via tabs, not full navigations.
      const sameDoc = resolved.pathname === location.pathname && resolved.search === location.search;
      if (sameDoc && (!resolved.hash || !resolved.hash.startsWith("#/"))) continue;

      const cleanUrl = resolved.origin + resolved.pathname + resolved.search + (resolved.hash.startsWith("#/") ? resolved.hash : "");
      if (seenLinks.has(cleanUrl)) continue;
      seenLinks.add(cleanUrl);
      const label = cleanLabel(accessibleName(anchor)) || resolved.pathname;
      links.push({ url: cleanUrl, label, reachedVia: [...via, label].slice(0, 12) });
    }
  };

  try {
    // 1. Base page
    addPage("page", document, options.reachedVia);
    harvestLinks(document, options.reachedVia);
    if (stopped()) return { pages, links, seenGlobalKeys: [...seenGlobal], privacyTerms: [...termsMap.values()] };

    // 2. Menus, disclosures and dialogs in the initial view
    await exploreMenusAndDialogs(document, options.reachedVia);
    if (stopped()) return { pages, links, seenGlobalKeys: [...seenGlobal], privacyTerms: [...termsMap.values()] };

    // 3. Tabs (role="tab") — inspect each unselected tab + any menus/disclosures/dialogs inside its panel
    const tabs = [...document.querySelectorAll<HTMLElement>('[role="tab"]')].filter(
      (tab) => isVisible(tab, options.hostId) && isSafeToClick(tab, options.hostId),
    );
    const initialTabs = tabs.filter((tab) => tab.getAttribute("aria-selected") === "true");

    for (const tab of tabs) {
      if (stopped()) break;
      if (!tab.isConnected || !isVisible(tab, options.hostId) || tab.getAttribute("aria-selected") === "true") continue;
      if (clickedElements.has(tab)) continue;
      const tabLabel = cleanLabel(accessibleName(tab));
      if (!tabLabel) continue;
      clickedElements.add(tab);

      safeClick(tab);
      await wait(120);
      if (stopped()) break;

      if (routeBlocked(location.pathname + location.search + location.hash, options.blockedRoutes)) continue;
      const panelId = tab.getAttribute("aria-controls");
      const panel = (panelId ? document.getElementById(panelId) : null) ?? document;
      const tabVia = [...options.reachedVia, tabLabel].slice(0, 12);
      addPage("tab", document, tabVia, tabLabel);
      harvestLinks(panel, tabVia);
      if (!stopped() && panel !== document) {
        await exploreMenusAndDialogs(panel, tabVia);
      }
    }

    // Restore initial tab selection if still connected so the page looks untouched.
    for (const initial of initialTabs) {
      if (initial.isConnected && isVisible(initial, options.hostId) && initial.getAttribute("aria-selected") !== "true") {
        safeClick(initial);
        await wait(40);
      }
    }
  } finally {
    await closeAnyOpenOverlays(options.hostId);
    window.removeEventListener("submit", blockSubmit, true);
    try {
      window.open = originalOpen;
    } catch { /* ignore */ }
  }

  return { pages, links, seenGlobalKeys: [...seenGlobal], privacyTerms: [...termsMap.values()] };

  async function exploreMenusAndDialogs(scope: ParentNode, via: string[]) {
    // 2a. Menus & collapsible disclosures (<summary>, aria-haspopup, aria-expanded="false")
    const menuCandidates = findMenuTriggers(scope, options.hostId);
    for (const trigger of menuCandidates) {
      if (stopped()) return;
      if (!trigger.isConnected || !isVisible(trigger, options.hostId) || clickedElements.has(trigger)) continue;
      if (!isSafeToClick(trigger, options.hostId)) continue;
      const label = cleanLabel(accessibleName(trigger));
      if (!label) continue;
      const globalKey = globalTriggerKey(trigger, label);
      if (globalKey && seenGlobal.has(globalKey)) continue;
      if (globalKey) seenGlobal.add(globalKey);
      clickedElements.add(trigger);

      const wasDetails = trigger.tagName.toLowerCase() === "summary" ? trigger.closest("details") : null;
      if (wasDetails?.open) continue;
      if (trigger.getAttribute("aria-expanded") === "true") continue;

      safeClick(trigger);
      await wait(100);
      if (stopped()) return;

      const menuVia = [...via, label].slice(0, 12);
      const controlledId = trigger.getAttribute("aria-controls");
      const menuScope = (controlledId ? document.getElementById(controlledId) : null) ?? wasDetails ?? document;
      harvestLinks(menuScope, menuVia);
      addPage("menu", document, menuVia, label);

      // One level of nested submenu (e.g. Aktionen -> Exportieren)
      if (!stopped() && menuScope !== document && isVisible(menuScope as HTMLElement, options.hostId)) {
        const subTriggers = findMenuTriggers(menuScope, options.hostId);
        for (const sub of subTriggers) {
          if (stopped()) break;
          if (sub === trigger || clickedElements.has(sub) || !isVisible(sub, options.hostId) || !isSafeToClick(sub, options.hostId)) continue;
          if (sub.getAttribute("aria-expanded") === "true") continue;
          const subLabel = cleanLabel(accessibleName(sub));
          if (!subLabel) continue;
          clickedElements.add(sub);
          safeClick(sub);
          await wait(90);
          const subVia = [...menuVia, subLabel].slice(0, 12);
          harvestLinks(document, subVia);
          addPage("menu", document, subVia, subLabel);
        }
      }

      // Close popup menus with Escape; inspect safe dialog openers inside <details> before closing <details>.
      if (wasDetails) {
        await exploreDialogTriggers(wasDetails, menuVia);
        wasDetails.open = false;
      } else {
        pressEscape();
        await wait(50);
        if (trigger.isConnected && trigger.getAttribute("aria-expanded") === "true") {
          if (!trigger.closest("nav, .sidebar")) safeClick(trigger);
          await wait(40);
        }
      }
    }

    // 2b. Safe dialog openers
    if (!stopped()) await exploreDialogTriggers(scope, via);
  }

  async function exploreDialogTriggers(scope: ParentNode, via: string[]) {
    const triggers = findDialogTriggers(scope, options.hostId);
    for (const trigger of triggers) {
      if (stopped()) return;
      if (!trigger.isConnected || !isVisible(trigger, options.hostId) || clickedElements.has(trigger)) continue;
      if (!isSafeToClick(trigger, options.hostId)) continue;
      const label = cleanLabel(accessibleName(trigger));
      if (!label) continue;
      const globalKey = globalTriggerKey(trigger, label);
      if (globalKey && seenGlobal.has(globalKey)) continue;
      if (globalKey) seenGlobal.add(globalKey);
      clickedElements.add(trigger);

      const openBefore = new Set(visibleDialogs(options.hostId));
      const beforeSig = scopeSignature(document, options.hostId);

      safeClick(trigger);
      await wait(130);
      if (stopped()) {
        await closeAnyOpenOverlays(options.hostId);
        return;
      }

      const dialogsAfter = visibleDialogs(options.hostId);
      const openedDialog = dialogsAfter.find((dlg) => !openBefore.has(dlg));
      const afterSig = scopeSignature(document, options.hostId);

      if (openedDialog || afterSig !== beforeSig) {
        const dialogVia = [...via, label].slice(0, 12);
        const targetScope = openedDialog ?? document;
        const dialogHeading = openedDialog ? cleanLabel(openedDialog.querySelector("h1, h2, h3")?.textContent) : "";
        harvestLinks(targetScope, dialogVia);
        addPage("dialog", targetScope, dialogVia, dialogHeading || label);
        await closeOpenedView(openedDialog, openBefore, options.hostId);
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Candidate discovery & strict safety checks
// ---------------------------------------------------------------------------

function findMenuTriggers(scope: ParentNode, hostId: string): HTMLElement[] {
  const selector = 'details:not([open]) > summary, [aria-haspopup="true"], [aria-haspopup="menu"], [aria-haspopup="listbox"], button[aria-expanded="false"], [role="button"][aria-expanded="false"], [role="menuitem"][aria-haspopup]';
  return [...scope.querySelectorAll<HTMLElement>(selector)].filter(
    (el) => isVisible(el, hostId) && el.getAttribute("aria-haspopup") !== "dialog",
  );
}

function findDialogTriggers(scope: ParentNode, hostId: string): HTMLElement[] {
  const candidates = [...scope.querySelectorAll<HTMLElement>('button, [role="button"]')];
  return candidates.filter((el) => {
    if (!isVisible(el, hostId)) return false;
    if (el.closest("form")) return false;
    if (el.getAttribute("aria-haspopup") === "dialog") return true;
    if (el.hasAttribute("data-dialog") || el.hasAttribute("data-modal") || el.getAttribute("data-bs-toggle") === "modal") return true;
    const controls = el.getAttribute("aria-controls");
    if (controls) {
      const controlled = document.getElementById(controls);
      if (controlled && (controlled.tagName.toLowerCase() === "dialog" || controlled.getAttribute("role") === "dialog" || controlled.hidden)) {
        return true;
      }
    }
    const label = cleanLabel(accessibleName(el));
    return Boolean(label && DIALOG_LABEL.test(label));
  });
}

function isSafeToClick(element: HTMLElement, hostId: string): boolean {
  if (isLotseNode(element, hostId) || element.closest("[hidden], [inert], [data-lotse-private]")) return false;
  if (element.matches(":disabled") || element.getAttribute("aria-disabled") === "true") return false;

  const tag = element.tagName.toLowerCase();
  if (tag === "input" || tag === "select" || tag === "textarea" || element.isContentEditable) return false;
  const role = (element.getAttribute("role") ?? "").toLowerCase();
  if (["checkbox", "radio", "switch", "textbox", "searchbox", "combobox", "slider", "spinbutton"].includes(role)) return false;

  // Never click submit/reset buttons (<button> inside <form> without `type` defaults to `type === "submit"`!).
  if (element instanceof HTMLButtonElement && (element.type === "submit" || element.type === "reset")) return false;

  const texts = [
    accessibleName(element),
    element.innerText,
    element.getAttribute("aria-label"),
    element.getAttribute("title"),
    element.getAttribute("value"),
  ]
    .filter((value): value is string => Boolean(value))
    .map((value) => value.toLocaleLowerCase("de-DE"));

  for (const text of texts) {
    for (const forbidden of EXPLORE_NEVER_CLICK) {
      if (text.includes(forbidden)) return false;
    }
    for (const extra of EXTRA_NEVER_OPEN) {
      if (text.includes(extra)) return false;
    }
  }

  if (isDangerStyled(element)) return false;
  return true;
}

function isDangerStyled(element: HTMLElement): boolean {
  let cursor: HTMLElement | null = element;
  for (let depth = 0; cursor && depth < 3; depth++, cursor = cursor.parentElement) {
    const attrs = [
      typeof cursor.className === "string" ? cursor.className : "",
      cursor.id,
      cursor.getAttribute("data-variant") ?? "",
      cursor.getAttribute("data-action") ?? "",
      cursor.getAttribute("data-color") ?? "",
    ].join(" ");
    if (DANGER_ATTR.test(attrs)) return true;
  }
  const style = getComputedStyle(element);
  for (const raw of [style.backgroundColor, style.color, style.borderTopColor]) {
    const c = parseCssColor(raw);
    if (c && c.a >= 0.15 && c.r >= 150 && c.r > c.g * 1.55 && c.r > c.b * 1.55) return true;
  }
  return false;
}

function globalTriggerKey(element: HTMLElement, label: string): string | null {
  const region = element.closest('header, nav, .topbar, .sidebar, [role="banner"], [role="navigation"]');
  if (!region) return null;
  return `${roleOf(element)}:${label.toLocaleLowerCase("de-DE")}`;
}

// ---------------------------------------------------------------------------
// Closing dialogs / overlays safely
// ---------------------------------------------------------------------------

function visibleDialogs(hostId: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('dialog[open], [role="dialog"], [aria-modal="true"]')].filter((el) =>
    isVisible(el, hostId),
  );
}

async function closeOpenedView(openedDialog: HTMLElement | undefined, beforeDialogs: Set<HTMLElement>, hostId: string) {
  pressEscape(openedDialog);
  await wait(60);

  for (const dlg of visibleDialogs(hostId)) {
    if (beforeDialogs.has(dlg)) continue;
    clickCloseButtonInside(dlg, hostId);
    await wait(50);
    if (dlg instanceof HTMLDialogElement && dlg.open) {
      try { dlg.close(); } catch { /* ignore */ }
    }
  }

  if (!openedDialog) {
    clickCloseButtonInside(document, hostId, true);
    await wait(50);
  }
}

async function closeAnyOpenOverlays(hostId: string) {
  pressEscape();
  await wait(30);
  for (const dlg of visibleDialogs(hostId)) {
    clickCloseButtonInside(dlg, hostId);
    if (dlg instanceof HTMLDialogElement && dlg.open) {
      try { dlg.close(); } catch { /* ignore */ }
    }
  }
}

function clickCloseButtonInside(scope: ParentNode, hostId: string, requireCancel = false) {
  const buttons = [...scope.querySelectorAll<HTMLElement>('button, [role="button"]')].filter((btn) => isVisible(btn, hostId));
  for (const btn of buttons) {
    if (btn instanceof HTMLButtonElement && btn.type === "submit") continue;
    if (isDangerStyled(btn)) continue;
    const label = cleanLabel(accessibleName(btn));
    if (requireCancel ? /^(?:abbrechen|cancel)$/i.test(label) : CLOSE_BUTTON_LABEL.test(label)) {
      safeClick(btn);
      return;
    }
  }
}

function pressEscape(target?: HTMLElement) {
  const init: KeyboardEventInit = { key: "Escape", code: "Escape", keyCode: 27, bubbles: true, cancelable: true };
  (target ?? document.activeElement ?? document).dispatchEvent(new KeyboardEvent("keydown", init));
  (target ?? document.activeElement ?? document).dispatchEvent(new KeyboardEvent("keyup", init));
  document.dispatchEvent(new KeyboardEvent("keydown", init));
}

function safeClick(element: HTMLElement) {
  try {
    element.click();
  } catch { /* ignore */ }
}

// ---------------------------------------------------------------------------
// ExploredPage + ElementStyle measurement (WCAG contrast, hit area, iconOnly)
// ---------------------------------------------------------------------------

function captureExploredPage(
  kind: ExploredPage["kind"],
  scope: ParentNode,
  reachedVia: string[],
  hostId: string,
  subTitle?: string,
): { page: ExploredPage; terms: PrivacyTerm[] } | null {
  const dialogs = visibleDialogs(hostId);
  const activeScope: ParentNode = kind === "dialog" && dialogs.length ? dialogs.at(-1)! : scope;
  const rawElements = [...activeScope.querySelectorAll<HTMLElement>(INTERACTIVE)]
    .filter((el) => isVisible(el, hostId))
    .slice(0, EXPLORE_LIMITS.maxElementsPerPage);

  // D-26: collect personal content strings so the service worker pseudonymizes the page map before upload.
  const privacy = collectPagePrivacy(rawElements, accessibleName, (el) => isVisible(el, hostId));

  const currentRoute = pageRoute();
  const elements: ExploredElement[] = rawElements.map((element, number) => {
    const rect = element.getBoundingClientRect();
    return {
      number,
      role: roleOf(element),
      label: cleanLabel(accessibleName(element), 120),
      route: currentRoute,
      disabled: element.matches(":disabled") || element.getAttribute("aria-disabled") === "true",
      rect: {
        x: Math.round(rect.x),
        y: Math.round(rect.y),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      },
      style: measureElementStyle(element, rect),
    };
  });

  const headings: string[] = [];
  const seenHeadings = new Set<string>();
  for (const h of activeScope.querySelectorAll<HTMLElement>("h1, h2, h3")) {
    if (!isVisible(h, hostId)) continue;
    const text = cleanLabel(h.innerText || h.textContent, 120);
    if (!text || seenHeadings.has(text)) continue;
    seenHeadings.add(text);
    headings.push(text);
    if (headings.length >= 30) break;
  }

  const baseTitle = cleanLabel(document.title, 100) || currentRoute;
  const title = subTitle && !baseTitle.toLocaleLowerCase("de-DE").includes(subTitle.toLocaleLowerCase("de-DE"))
    ? `${baseTitle} · ${subTitle}`.slice(0, 140)
    : baseTitle;

  const parsed = ExploredPageSchema.safeParse({
    route: currentRoute,
    title,
    reachedVia: reachedVia.map((item) => cleanLabel(item, 80)).filter(Boolean),
    kind,
    elements,
    headings,
  });
  return parsed.success ? { page: parsed.data, terms: privacy.terms } : null;
}

function measureElementStyle(element: HTMLElement, rect: DOMRect): ElementStyle {
  const cs = getComputedStyle(element);
  const fontSize = Number.parseFloat(cs.fontSize);
  const width = Math.round(rect.width);
  const height = Math.round(rect.height);
  const iconOnly = isIconOnlyElement(element);
  const contrast = computeContrastRatio(element, cs);

  const style: ElementStyle = {};
  if (contrast !== undefined && Number.isFinite(contrast)) style.contrast = contrast;
  if (Number.isFinite(fontSize) && fontSize > 0) style.fontSize = Math.round(fontSize * 10) / 10;
  if (Number.isFinite(width) && width > 0) style.width = width;
  if (Number.isFinite(height) && height > 0) style.height = height;
  if (iconOnly) style.iconOnly = true;
  return style;
}

function isIconOnlyElement(element: HTMLElement): boolean {
  if (
    element instanceof HTMLInputElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement ||
    element.isContentEditable
  ) {
    return false;
  }
  const visible = visibleNonSrText(element);
  if (visible && !SINGLE_GLYPH.test(visible)) return false;
  return Boolean(element.querySelector('svg, img, i, [class*="icon"]') || SINGLE_GLYPH.test(visible) || !visible);
}

function visibleNonSrText(root: HTMLElement): string {
  const parts: string[] = [];
  const walk = (node: Node) => {
    if (node.nodeType === Node.TEXT_NODE) {
      const value = node.textContent?.trim();
      if (value) parts.push(value);
      return;
    }
    if (!(node instanceof HTMLElement)) return;
    if (node.hidden || node.getAttribute("aria-hidden") === "true" || node.classList.contains("sr-only") || node.classList.contains("visually-hidden")) {
      return;
    }
    const cs = getComputedStyle(node);
    if (cs.display === "none" || cs.visibility === "hidden") return;
    const r = node.getBoundingClientRect();
    if (r.width <= 1 && r.height <= 1 && cs.overflow === "hidden") return;
    for (const child of node.childNodes) walk(child);
  };
  walk(root);
  return parts.join(" ").replace(/\s+/g, " ").trim();
}

function computeContrastRatio(element: HTMLElement, cs: CSSStyleDeclaration): number | undefined {
  const fgRaw = parseCssColor(cs.color);
  if (!fgRaw || fgRaw.a <= 0.05) return undefined;
  const bg = effectiveBackground(element);
  if (!bg) return undefined;
  const fg = composite(fgRaw, bg);
  const l1 = relativeLuminance(fg.r, fg.g, fg.b);
  const l2 = relativeLuminance(bg.r, bg.g, bg.b);
  const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
  return Math.round(ratio * 100) / 100;
}

function effectiveBackground(element: HTMLElement): Rgba | undefined {
  const layers: Rgba[] = [];
  let current: HTMLElement | null = element;
  while (current) {
    const cs = getComputedStyle(current);
    const bg = parseCssColor(cs.backgroundColor);
    if ((!bg || bg.a < 0.95) && cs.backgroundImage && cs.backgroundImage !== "none") {
      return undefined;
    }
    if (bg && bg.a > 0) {
      layers.push(bg);
      if (bg.a >= 0.999) break;
    }
    current = current.parentElement;
  }
  let acc: Rgba = { r: 255, g: 255, b: 255, a: 1 };
  for (let i = layers.length - 1; i >= 0; i--) {
    acc = composite(layers[i]!, acc);
  }
  return acc;
}

function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return {
    r: fg.r * a + bg.r * (1 - a),
    g: fg.g * a + bg.g * (1 - a),
    b: fg.b * a + bg.b * (1 - a),
    a: 1,
  };
}

function relativeLuminance(r: number, g: number, b: number): number {
  const chan = (v: number) => {
    const s = Math.min(255, Math.max(0, v)) / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * chan(r) + 0.7152 * chan(g) + 0.0722 * chan(b);
}

function parseCssColor(value: string): Rgba | null {
  const v = value.trim();
  if (!v || v === "transparent") return { r: 0, g: 0, b: 0, a: 0 };
  const rgb = v.match(/^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i);
  if (rgb) {
    const r = Number.parseFloat(rgb[1]!);
    const g = Number.parseFloat(rgb[2]!);
    const b = Number.parseFloat(rgb[3]!);
    const rawA = rgb[4];
    const a = rawA === undefined ? 1 : rawA.endsWith("%") ? Number.parseFloat(rawA) / 100 : Number.parseFloat(rawA);
    if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a: Math.min(1, Math.max(0, a)) };
  }
  const srgb = v.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+%?))?\s*\)$/i);
  if (srgb) {
    const r = Number.parseFloat(srgb[1]!) * 255;
    const g = Number.parseFloat(srgb[2]!) * 255;
    const b = Number.parseFloat(srgb[3]!) * 255;
    const rawA = srgb[4];
    const a = rawA === undefined ? 1 : rawA.endsWith("%") ? Number.parseFloat(rawA) / 100 : Number.parseFloat(rawA);
    if ([r, g, b, a].every(Number.isFinite)) return { r, g, b, a: Math.min(1, Math.max(0, a)) };
  }
  return null;
}

// ---------------------------------------------------------------------------
// DOM helpers (matching content.ts conventions)
// ---------------------------------------------------------------------------

function pageRoute(): string {
  return location.pathname + (location.hash.startsWith("#/") ? location.hash.split("?")[0] : "");
}

function cleanLabel(text: string | null | undefined, max = 120): string {
  return (text ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function isLotseNode(node: Node, hostId: string): boolean {
  const element = node instanceof Element ? node : node.parentElement;
  return Boolean(element?.closest(`#${hostId}, #${ORB_HOST_ID}`));
}

function isVisible(element: HTMLElement, hostId: string): boolean {
  if (isLotseNode(element, hostId) || element.closest("[hidden], [inert], [data-lotse-private]")) return false;
  const rect = element.getBoundingClientRect();
  const style = getComputedStyle(element);
  return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
}

function roleOf(element: HTMLElement): string {
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

function accessibleName(element: HTMLElement): string {
  const aria = element.getAttribute("aria-label");
  if (aria) return cleanLabel(aria, 120);
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    if (text.trim()) return cleanLabel(text, 120);
  }
  if (element instanceof HTMLInputElement || element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
    const label = element.labels?.[0]?.textContent;
    if (label?.trim()) return cleanLabel(label, 120);
    const placeholder = element.getAttribute("placeholder");
    if (placeholder) return cleanLabel(placeholder, 120);
    if (element instanceof HTMLInputElement && (element.type === "submit" || element.type === "button")) return cleanLabel(element.getAttribute("value"), 120);
    return cleanLabel(element.getAttribute("title") ?? element.getAttribute("name"), 120);
  }
  if (element.isContentEditable) return cleanLabel(element.getAttribute("title") ?? element.getAttribute("name"), 120);
  return cleanLabel(element.innerText || element.getAttribute("title") || element.getAttribute("name"), 120);
}

function scopeSignature(scope: ParentNode, hostId: string): string {
  const els = [...scope.querySelectorAll<HTMLElement>(INTERACTIVE)].filter((el) => isVisible(el, hostId)).slice(0, 60);
  return els.map((el) => `${roleOf(el)}:${cleanLabel(accessibleName(el), 40)}`).join("|");
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
