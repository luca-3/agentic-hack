/**
 * Exploration scanner (content script, D-25). On request of the service worker it records the loaded page, then probes
 * it: switches tabs, opens menus/disclosures and dialogs, records each as its own entry and closes it again
 * (Abbrechen/Schließen → Escape → dialog.close()). Links are never clicked — they go back to the worker as URLs.
 * Every record is sent to the worker right away, so an unexpected navigation loses nothing.
 *
 * Safety: see ./safety.ts. Only `.click()` on tabs, menu/disclosure toggles and dialog openers that pass every check;
 * no typing, no selects/checkboxes, no submit buttons, nothing on a blocked route.
 */
import type { ElementStyle, ExploredElement, ExploredPage } from "@lotse/shared";
import { routeBlocked } from "@lotse/shared/route"; // zod-free
import { collectPagePrivacy } from "../pseudonymize"; // zod-free (D-26)
import { BANNER_HOST_ID, hideBanner, showBanner } from "./banner";
import type { ExploreMessage, FoundLink, ScanRequest, ScanResult } from "./messages";
import { isCloseLabel, labelForbidden, linkForbidden, looksDangerous, looksLikeOpener, navigableUrl, routeOf } from "./safety";

const INTERACTIVE = 'a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="button"], [role="link"], [role="tab"], [role="menuitem"], [role="menuitemcheckbox"], [role="menuitemradio"], [role="option"], [role="checkbox"], [role="switch"], [role="treeitem"], [contenteditable="true"]';
const DIALOGS = 'dialog, [role="dialog"], [role="alertdialog"]';
/** Lotse's own in-page hosts (guidance overlay, status orb, this banner) — never scanned, never clicked. */
const LOTSE_HOSTS = `#lotse-overlay-host, #lotse-orb-host, #${BANNER_HOST_ID}`;
const NO_PROBE_ROLES = new Set(["textbox", "searchbox", "combobox", "checkbox", "radio", "switch", "slider", "spinbutton", "option", "menuitemcheckbox", "menuitemradio", "listbox"]);
const ICON_ROLES = new Set(["button", "link", "tab", "menuitem"]);
const UI_WORD = /^(details|bearbeiten|öffnen|anzeigen|ansehen|mehr|edit|view|open|show)\b/i;
const CAPS = { tab: 8, menu: 6, dialog: 6, disclosure: 4 } as const;
const SETTLE_MS = 350;

type ProbeKind = keyof typeof CAPS;
type Probe = { el: HTMLElement; kind: ProbeKind; label: string; key: string };
type Ctx = { req: ScanRequest; via: string[]; budget: number; probed: Set<string>; dirty: boolean; route: string; pageTitle: string };

let activeRun: string | null = null;
let stopRequested = false;

export function setupExploreScanner() {
  browser.runtime.onMessage.addListener((message: ExploreMessage, _sender: unknown, respond: (response: unknown) => void) => {
    if (!message || typeof message !== "object") return false;
    if (message.type === "lotse:explore-scan") {
      scan(message).then(respond, (error: unknown) => respond({ ok: false, error: error instanceof Error ? error.message : "Scan fehlgeschlagen." } satisfies ScanResult));
      return true;
    }
    if (message.type === "lotse:explore-end") {
      activeRun = null;
      hideBanner();
      respond({ ok: true });
    }
    return false;
  });
}

async function scan(req: ScanRequest): Promise<ScanResult> {
  if (blockedHere(req)) return { ok: false, paused: true, error: "Geschützte Seite – nichts erfasst." };
  activeRun = req.runId;
  stopRequested = false;
  showBanner(`· ${req.pagesSoFar} Einträge · ${routeOf(location.href)}`, requestStop);
  await settle(600); // late-rendering apps
  if (blockedHere(req)) return { ok: false, paused: true, error: "Geschützte Seite – nichts erfasst." };
  await closeOpenDialogs();

  const ctx: Ctx = {
    req, via: req.reachedVia, budget: req.budget, probed: new Set(req.probed), dirty: false,
    route: routeOf(location.href), pageTitle: text(document.title, 120),
  };
  if (ctx.budget <= 0) return { ok: true, probed: [...ctx.probed], finalUrl: location.href };

  const base: ExploredPage = {
    route: ctx.route, title: ctx.pageTitle, reachedVia: ctx.via, kind: "page",
    elements: elementsIn([...document.querySelectorAll<HTMLElement>(INTERACTIVE)], ctx), headings: headingsIn(document),
  };
  ctx.budget--;
  await report(ctx, [base], linksIn(document, ctx.via, req));

  const selectedTabs = [...document.querySelectorAll<HTMLElement>('[role="tab"][aria-selected="true"]')];
  for (const probe of probesOf(ctx)) {
    if (!alive(ctx)) break;
    if (probe.kind !== "disclosure" && ctx.budget <= 0) continue;
    ctx.probed.add(probe.key);
    await runProbe(probe, ctx);
  }
  // Put the tabs back the way the page opened.
  for (const tab of selectedTabs) if (tab.isConnected && tab.getAttribute("aria-selected") !== "true" && !blockedHere(req)) { tab.click(); await settle(150); }
  await closeOpenDialogs();
  return { ok: true, probed: [...ctx.probed], finalUrl: location.href };
}

function requestStop() {
  stopRequested = true;
  void browser.runtime.sendMessage({ type: "lotse:explore-stop" } satisfies ExploreMessage).catch(() => undefined);
}

function alive(ctx: Ctx) {
  return activeRun === ctx.req.runId && !stopRequested && !ctx.dirty && Date.now() < ctx.req.deadline - 1_500 && !blockedHere(ctx.req);
}

function blockedHere(req: ScanRequest) {
  return routeBlocked(location.pathname + location.search + location.hash, req.blockedRoutes);
}

/** Pages go out with the content strings of what is on screen now (record links, table cells, record headings …). */
async function report(ctx: Ctx, pages: ExploredPage[], links: FoundLink[]) {
  if (!pages.length && !links.length) return;
  const terms = pages.length ? collectPagePrivacy(visibleInteractive(), nameOf, visible).terms : [];
  await browser.runtime.sendMessage({ type: "lotse:explore-found", runId: ctx.req.runId, pages, links, terms } satisfies ExploreMessage).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Probes: tabs, menus, disclosures, dialog openers
// ---------------------------------------------------------------------------

function probesOf(ctx: Ctx): Probe[] {
  const byKind: Record<ProbeKind, Probe[]> = { tab: [], menu: [], dialog: [], disclosure: [] };
  const seen = new Set<HTMLElement>();
  for (const el of document.querySelectorAll<HTMLElement>(`${INTERACTIVE}, [aria-haspopup], [aria-expanded]`)) {
    if (seen.has(el) || !visible(el) || isDisabled(el) || el.closest(DIALOGS)) continue;
    seen.add(el);
    const label = nameOf(el);
    const kind = classify(el, label);
    if (!kind || !clickSafe(el, label, ctx.req.neverClick)) continue;
    const scope = el.closest('header, nav, aside, [role="banner"], [role="navigation"]') ? "*" : ctx.route;
    const key = `${kind}|${scope}|${label.toLowerCase()}|${el.getAttribute("aria-controls") ?? ""}`;
    if (ctx.probed.has(key) || byKind[kind].length >= CAPS[kind]) continue;
    byKind[kind].push({ el, kind, label, key });
  }
  return [...byKind.tab, ...byKind.menu, ...byKind.dialog, ...byKind.disclosure];
}

function classify(el: HTMLElement, label: string): ProbeKind | null {
  const role = roleOf(el);
  if (NO_PROBE_ROLES.has(role) || el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement || el.isContentEditable) return null;
  if (role === "tab") return el.getAttribute("aria-selected") === "true" ? null : "tab";
  // Real links are opened by URL from the worker; only in-page anchors (href="#…") count as toggles.
  if (el instanceof HTMLAnchorElement && !(el.getAttribute("href") ?? "").startsWith("#")) return null;
  const popup = el.getAttribute("aria-haspopup");
  if (popup && popup !== "false") return popup === "dialog" ? "dialog" : "menu";
  if (el.tagName === "SUMMARY") return (el.parentElement as HTMLDetailsElement | null)?.open ? null : "disclosure";
  if (el.getAttribute("aria-expanded") === "false" && el.getAttribute("aria-controls")) return "disclosure";
  if (role === "button" && looksLikeOpener(label)) return "dialog";
  return null;
}

/** The click gate. Everything that could change data is refused. */
function clickSafe(el: HTMLElement, label: string, neverClick: readonly string[]): boolean {
  if (labelForbidden(label, neverClick) || labelForbidden(el.getAttribute("title") ?? label, neverClick)) return false;
  if (looksDangerous(el)) return false;
  if (el instanceof HTMLButtonElement && el.type !== "button") return false; // submit/reset (default type inside forms is submit)
  if (el instanceof HTMLInputElement) return false;
  if (el.closest("[data-lotse-private], [data-lotse-noexplore]")) return false;
  if (/submit|delete|remove|logout/i.test(el.getAttribute("onclick") ?? "")) return false;
  return true;
}

async function runProbe(probe: Probe, ctx: Ctx) {
  const { el, kind, label } = probe;
  if (!el.isConnected || !visible(el)) return;
  const beforeUrl = location.pathname + location.search;
  const dialogsBefore = new Set(openDialogs());
  const visibleBefore = new Set(visibleInteractive());
  const controls = el.getAttribute("aria-controls");
  el.click();
  await settle(SETTLE_MS);

  if (blockedHere(ctx.req)) {
    // Never record a blocked route; get out of it and stop working on this page.
    ctx.dirty = true;
    history.back();
    return;
  }
  if (location.pathname + location.search !== beforeUrl) {
    // SPA navigation from a button: keep it as a link for the worker, go back.
    const url = navigableUrl(location.href, location.href, location.origin, ctx.req.blockedRoutes);
    if (url) await report(ctx, [], [{ url, reachedVia: [...ctx.via, label] }]);
    history.back();
    await settle(SETTLE_MS);
    if (location.pathname + location.search !== beforeUrl) ctx.dirty = true;
    return;
  }

  const via = [...ctx.via, label];
  const dialog = openDialogs().find((d) => !dialogsBefore.has(d));
  const panel = controls ? document.getElementById(controls) : null;
  const panelScope = panel && visible(panel) ? panel : null;
  const fresh = visibleInteractive().filter((e) => !visibleBefore.has(e));
  const pages: ExploredPage[] = [];
  let links: FoundLink[] = [];

  if (dialog) {
    pages.push({
      route: ctx.route, kind: "dialog", reachedVia: via,
      title: nameOf(dialog) || text(dialog.querySelector("h1, h2, h3")?.textContent, 120) || label,
      elements: elementsIn([...dialog.querySelectorAll<HTMLElement>(INTERACTIVE)], ctx), headings: headingsIn(dialog),
    });
    links = linksIn(dialog, via, ctx.req);
  } else if (kind === "tab") {
    const scope: ParentNode = panelScope ?? document;
    pages.push({
      route: ctx.route, kind: "tab", reachedVia: via, title: `${ctx.pageTitle} · ${label}`,
      elements: elementsIn([...scope.querySelectorAll<HTMLElement>(INTERACTIVE)], ctx), headings: headingsIn(scope),
    });
    links = linksIn(scope, via, ctx.req);
  } else {
    const items = panelScope ? [...panelScope.querySelectorAll<HTMLElement>(INTERACTIVE)] : fresh;
    if (kind === "menu" && items.length) {
      pages.push({ route: ctx.route, kind: "menu", reachedVia: via, title: label, elements: elementsIn(items, ctx), headings: [] });
    }
    links = panelScope ? linksIn(panelScope, via, ctx.req) : linksOf(fresh.filter((e): e is HTMLAnchorElement => e instanceof HTMLAnchorElement), via, ctx.req);
  }
  ctx.budget -= pages.length;
  await report(ctx, pages, links);

  // Restore: close the dialog, close the menu, collapse the disclosure (tabs are restored after all probes).
  if (dialog) {
    if (!(await closeDialog(dialog))) ctx.dirty = true;
  } else if (kind === "menu" || kind === "disclosure") {
    if (kind === "menu") { pressEscape(document.activeElement ?? document.body); await settle(150); }
    const stillOpen = el.getAttribute("aria-expanded") === "true" || (el.tagName === "SUMMARY" && (el.parentElement as HTMLDetailsElement | null)?.open) || Boolean(panel && visible(panel));
    if (stillOpen && el.isConnected) { el.click(); await settle(150); }
  } else if (kind === "dialog") {
    // An opener without a dialog (e.g. inline edit mode): leave it again via its fresh "Abbrechen"/"Schließen".
    const cancel = fresh.find((e) => isCloseLabel(nameOf(e)) && !(e instanceof HTMLButtonElement && e.type === "submit") && !looksDangerous(e));
    if (cancel) { cancel.click(); await settle(200); }
  }
  if (openDialogs().some((d) => !dialogsBefore.has(d))) { await closeOpenDialogs(); if (openDialogs().some((d) => !dialogsBefore.has(d))) ctx.dirty = true; }
}

function openDialogs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(DIALOGS)].filter((d) => (d instanceof HTMLDialogElement ? d.open : visible(d)) && !d.closest(LOTSE_HOSTS));
}

async function closeOpenDialogs() {
  for (const dialog of openDialogs().reverse()) await closeDialog(dialog);
}

/** Abbrechen/Schließen (never a submit button) → Escape → dialog.close(). */
async function closeDialog(dialog: HTMLElement): Promise<boolean> {
  const isOpen = () => (dialog instanceof HTMLDialogElement ? dialog.open : dialog.isConnected && visible(dialog));
  const closer = [...dialog.querySelectorAll<HTMLElement>('button, [role="button"], a[href^="#"]')].find((b) =>
    visible(b) && isCloseLabel(nameOf(b)) && !(b instanceof HTMLButtonElement && b.type === "submit") && !looksDangerous(b));
  if (closer) { closer.click(); await settle(200); if (!isOpen()) return true; }
  pressEscape(dialog);
  await settle(200);
  if (!isOpen()) return true;
  if (dialog instanceof HTMLDialogElement) { dialog.close(); await settle(100); }
  return !isOpen();
}

function pressEscape(target: Element | Document) {
  for (const type of ["keydown", "keyup"] as const) {
    const init = { key: "Escape", code: "Escape", keyCode: 27, which: 27, bubbles: true, cancelable: true, composed: true };
    target.dispatchEvent(new KeyboardEvent(type, init));
    if (target !== document) document.dispatchEvent(new KeyboardEvent(type, init));
  }
}

/** Resolves once the DOM has been quiet for `ms` (at most 3 × ms). */
function settle(ms: number) {
  return new Promise<void>((resolve) => {
    let finished = false;
    let quiet = setTimeout(done, ms);
    const cap = setTimeout(done, ms * 3);
    const observer = new MutationObserver(() => { clearTimeout(quiet); quiet = setTimeout(done, ms); });
    observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true });
    function done() {
      if (finished) return;
      finished = true;
      clearTimeout(quiet); clearTimeout(cap); observer.disconnect(); resolve();
    }
  });
}

// ---------------------------------------------------------------------------
// Recording: elements with style metrics, headings, links
// ---------------------------------------------------------------------------

function elementsIn(candidates: HTMLElement[], ctx: Ctx): ExploredElement[] {
  const unique = [...new Set(candidates)].filter((el) => visible(el) && !el.closest(LOTSE_HOSTS));
  return unique.slice(0, ctx.req.maxElements).map((el, number) => {
    const rect = el.getBoundingClientRect();
    let label = nameOf(el);
    if (UI_WORD.test(label) && label.includes(":")) label = label.slice(0, label.indexOf(":")).trim(); // "Details: <Datensatz>" → "Details"
    return {
      number, role: roleOf(el), label, route: ctx.route,
      rect: { x: Math.round(rect.x), y: Math.round(rect.y), width: Math.round(rect.width), height: Math.round(rect.height) },
      disabled: isDisabled(el) || undefined,
      style: styleOf(el, rect),
    };
  });
}

function headingsIn(scope: ParentNode): string[] {
  const out: string[] = [];
  for (const h of scope.querySelectorAll<HTMLElement>("h1, h2, h3")) {
    if (!visible(h) || h.closest(LOTSE_HOSTS)) continue;
    const value = text(h.textContent, 120);
    if (value) out.push(value);
    if (out.length >= 30) break;
  }
  return out;
}

function linksIn(scope: ParentNode, via: string[], req: ScanRequest): FoundLink[] {
  return linksOf([...scope.querySelectorAll<HTMLAnchorElement>("a[href]")].filter(visible), via, req);
}

function linksOf(anchors: HTMLAnchorElement[], via: string[], req: ScanRequest): FoundLink[] {
  const out: FoundLink[] = [];
  for (const a of anchors) {
    if (a.closest(LOTSE_HOSTS) || a.hasAttribute("download") || a.closest("[data-lotse-private], [data-lotse-noexplore]")) continue;
    const label = nameOf(a) || "Link";
    if (linkForbidden(label)) continue;
    const url = navigableUrl(a.getAttribute("href") ?? "", location.href, location.origin, req.blockedRoutes);
    if (url) out.push({ url, reachedVia: [...via, label] });
  }
  return out;
}

/** Style metrics per ElementStyleSchema: WCAG contrast, font size, hit area, icon-only. */
function styleOf(el: HTMLElement, rect: DOMRect): ElementStyle {
  const cs = getComputedStyle(el);
  const visibleText = (el.innerText ?? "").replace(/[^\p{L}\p{N}]+/gu, "");
  const style: ElementStyle = { fontSize: Math.round(parseFloat(cs.fontSize) * 10) / 10 || undefined };
  // Inline text links are exempt from the target-size rule (WCAG 2.5.8) — no hit area for them.
  if (!(el instanceof HTMLAnchorElement && cs.display === "inline")) {
    style.width = Math.round(rect.width);
    style.height = Math.round(rect.height);
  }
  if (ICON_ROLES.has(roleOf(el))) style.iconOnly = !visibleText;
  if (visibleText) {
    const bg = backgroundOf(el);
    const fg = parseColor(cs.color);
    if (bg && fg) style.contrast = Math.round(contrast(blend(fg, bg), bg) * 100) / 100;
  }
  return style;
}

type Rgba = [number, number, number, number];

function parseColor(value: string): Rgba | null {
  const m = /rgba?\(([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\)/.exec(value);
  if (!m) return null;
  const alpha = m[4] === undefined ? 1 : m[4].endsWith("%") ? Number(m[4].slice(0, -1)) / 100 : Number(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), alpha];
}

const blend = (top: Rgba, bottom: Rgba): Rgba => {
  const a = top[3];
  return [top[0] * a + bottom[0] * (1 - a), top[1] * a + bottom[1] * (1 - a), top[2] * a + bottom[2] * (1 - a), 1];
};

/** Effective opaque background behind the element; null when a background image makes it unknowable. */
function backgroundOf(el: HTMLElement): Rgba | null {
  const layers: Rgba[] = [];
  for (let node: HTMLElement | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.backgroundImage && cs.backgroundImage !== "none") return null;
    const color = parseColor(cs.backgroundColor);
    if (color && color[3] > 0) {
      layers.push(color);
      if (color[3] >= 0.99) break;
    }
  }
  let result: Rgba = [255, 255, 255, 1];
  for (const layer of layers.reverse()) result = blend(layer, result);
  return result;
}

function luminance([r, g, b]: Rgba) {
  const channel = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
}

function contrast(a: Rgba, b: Rgba) {
  const la = luminance(a);
  const lb = luminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

// ---------------------------------------------------------------------------
// DOM helpers (same rules as the observation snapshot in content.ts)
// ---------------------------------------------------------------------------

function visibleInteractive() {
  return [...document.querySelectorAll<HTMLElement>(INTERACTIVE)].filter(visible);
}

function visible(el: HTMLElement) {
  if (el.closest(`${LOTSE_HOSTS}, [hidden], [inert], [aria-hidden="true"], [data-lotse-private]`)) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  const cs = getComputedStyle(el);
  return cs.visibility !== "hidden" && cs.display !== "none";
}

function isDisabled(el: HTMLElement) {
  return el.matches(":disabled") || el.getAttribute("aria-disabled") === "true";
}

function text(value: string | null | undefined, max = 120) {
  return (value ?? "").replace(/„[^“]*“|"[^"]*"/g, "…").replace(/\s+/g, " ").trim().slice(0, max);
}

function roleOf(el: HTMLElement) {
  const explicit = el.getAttribute("role");
  if (explicit) return explicit;
  const tag = el.tagName.toLowerCase();
  if (tag === "a") return "link";
  if (tag === "button" || tag === "summary") return "button";
  if (tag === "select") return "combobox";
  if (tag === "textarea" || el.isContentEditable) return "textbox";
  if (el instanceof HTMLInputElement) {
    const roles: Record<string, string> = { checkbox: "checkbox", radio: "radio", submit: "button", button: "button", search: "searchbox", range: "slider" };
    return roles[el.type] ?? "textbox";
  }
  return tag;
}

/** Accessible name — UI labels only; values of inputs are never read. */
function nameOf(el: HTMLElement) {
  const aria = el.getAttribute("aria-label");
  if (aria) return text(aria);
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const value = labelledBy.split(/\s+/).map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
    if (value.trim()) return text(value);
  }
  if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement) {
    const label = el.labels?.[0]?.textContent;
    if (label?.trim()) return text(label);
    const placeholder = el.getAttribute("placeholder");
    if (placeholder) return text(placeholder);
    if (el instanceof HTMLInputElement && (el.type === "submit" || el.type === "button")) return text(el.getAttribute("value"));
    return text(el.getAttribute("title") ?? el.getAttribute("name"));
  }
  if (el.isContentEditable) return text(el.getAttribute("title") ?? el.getAttribute("name"));
  return text(el.innerText || el.getAttribute("title") || el.getAttribute("name"));
}
