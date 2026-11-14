/**
 * The status orb's DOM (content script): a 48 px circle in its own Shadow DOM host. The host is a `popover="manual"`
 * shown with showPopover(), so it sits in the top layer above page z-indexes; when a native modal <dialog> opens, the
 * host moves into that dialog and is shown again (the rest of the page is inert then, and the newest top-layer entry
 * paints on top). Draggable; click / Enter = primary action; long press, right click, "⋯" or Shift+F10 = menu.
 */
import { ORB_HOST_ID, type OrbMode, type OrbPosition } from "./state";

export type OrbMenuItem = { id: string; label: string };
export type OrbViewModel = { mode: OrbMode; title: string; detail: string; hint: string; note: string | null; badge: boolean; menu: OrbMenuItem[] };
type ViewOptions = {
  position: OrbPosition;
  onActivate(): void;
  onMenu(id: string): void;
  onMoved(position: OrbPosition): void;
};
type Press = { x: number; y: number; right: number; bottom: number; id: number; dragging: boolean; long: boolean; timer: ReturnType<typeof setTimeout> };

const SIZE = 48;
const MARGIN = 8;
const LONG_PRESS_MS = 550;
const COLORS: Record<OrbMode, string> = {
  active: "#2563eb", idle: "#475569", paused: "#64748b", blocked: "#b45309", offline: "#94a3b8", "signed-out": "#1e293b",
  listening: "#0d9488", thinking: "#7c3aed", speaking: "#0891b2", offer: "#f59e0b", error: "#dc2626",
};
const svg = (body: string) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
const COMPASS = svg('<circle cx="12" cy="12" r="9"/><path d="M15.6 8.4 13.3 13.3 8.4 15.6 10.7 10.7Z" fill="currentColor" stroke="none"/>');
const ICONS: Record<OrbMode, string> = {
  active: COMPASS,
  idle: COMPASS,
  paused: svg('<path d="M9 6v12M15 6v12" stroke-width="3"/>'),
  blocked: svg('<path d="M3 3l18 18"/><path d="M10.6 6.1A9.6 9.6 0 0 1 12 6c5 0 9 6 9 6a17 17 0 0 1-3.2 3.8M6.4 7.4C4.2 9 3 12 3 12s4 6 9 6a9 9 0 0 0 4-.9"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2"/>'),
  offline: svg('<path d="M3 3l18 18"/><path d="M8.1 7.3A5 5 0 0 1 16.6 10H17a4 4 0 0 1 2.7 6.9M17 18H7a4 4 0 0 1-1.7-7.6"/>'),
  "signed-out": svg('<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>'),
  listening: svg('<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v3"/>'),
  thinking: svg('<circle cx="6" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.7" fill="currentColor" stroke="none"/><circle cx="18" cy="12" r="1.7" fill="currentColor" stroke="none"/>'),
  speaking: svg('<path d="M4 9v6h4l5 4V5L8 9Z" fill="currentColor" stroke="none"/><path d="M16 9a4 4 0 0 1 0 6M18.5 6.5a8 8 0 0 1 0 11"/>'),
  offer: svg('<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2.1h5c0-.9.4-1.6 1-2.1A6 6 0 0 0 12 3Z"/>'),
  error: svg('<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5M12 16.5v.2"/>'),
};
const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.wrap { position: relative; width: ${SIZE}px; height: ${SIZE}px; font: 13px/1.35 system-ui, -apple-system, "Segoe UI", sans-serif; color: #0f172a; --c: #2563eb; }
.ring { position: absolute; inset: 0; border-radius: 50%; border: 3px solid var(--c); opacity: 0; pointer-events: none; }
.orb { all: unset; position: relative; z-index: 1; display: grid; place-items: center; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; cursor: pointer;
  color: #fff; background: radial-gradient(circle at 34% 28%, color-mix(in srgb, var(--c) 55%, #fff) 0%, var(--c) 58%, color-mix(in srgb, var(--c) 72%, #000) 100%);
  box-shadow: 0 6px 18px rgb(15 23 42 / .3), 0 0 0 2px #fff; transition: background .25s, transform .15s; touch-action: none; user-select: none; -webkit-user-select: none; }
.orb:hover { transform: scale(1.06); }
.orb:active { transform: scale(.95); }
.orb:focus-visible, .more:focus-visible, .menu button:focus-visible { outline: 3px solid #93c5fd; outline-offset: 3px; }
.orb svg { width: 24px; height: 24px; pointer-events: none; }
.badge { position: absolute; z-index: 2; pointer-events: none; top: -1px; right: -1px; width: 13px; height: 13px; border-radius: 50%; background: #f97316; box-shadow: 0 0 0 2px #fff; }
.more { all: unset; position: absolute; z-index: 2; left: -7px; top: -7px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
  background: #fff; color: #334155; font: 700 14px/1 system-ui, sans-serif; box-shadow: 0 2px 6px rgb(15 23 42 / .3); opacity: 0; transform: scale(.7); transition: opacity .15s, transform .15s; }
.wrap:hover .more, .wrap:focus-within .more, .wrap.open .more { opacity: 1; transform: scale(1); }
.tip, .menu { position: absolute; z-index: 3; width: max-content; max-width: 270px; border-radius: 12px; box-shadow: 0 10px 28px rgb(15 23 42 / .28); }
.tip { padding: 8px 11px; background: #0f172a; color: #fff; pointer-events: none; }
.tip strong { display: block; font-size: 13px; }
.tip span { display: block; margin-top: 2px; font-size: 12px; opacity: .85; }
.tip .hint { margin-top: 5px; opacity: .6; font-size: 11px; }
.menu { min-width: 210px; padding: 6px; background: #fff; border: 1px solid #e2e8f0; }
.menu button { all: unset; display: block; width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; cursor: pointer; font: 500 13px/1.3 system-ui, sans-serif; color: #0f172a; }
.menu button:hover, .menu button:focus { background: #eff6ff; }
.wrap[data-side="left"] .tip { right: ${SIZE + 10}px; } .wrap[data-side="right"] .tip { left: ${SIZE + 10}px; }
.wrap[data-v="up"] .tip { bottom: 2px; } .wrap[data-v="down"] .tip { top: 2px; }
.wrap[data-side="left"] .menu { right: 0; } .wrap[data-side="right"] .menu { left: 0; }
.wrap[data-v="up"] .menu { bottom: ${SIZE + 10}px; } .wrap[data-v="down"] .menu { top: ${SIZE + 10}px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
${Object.entries(COLORS).map(([mode, color]) => `.wrap[data-mode="${mode}"] { --c: ${color}; }`).join("\n")}
@keyframes lotse-pulse { 0% { transform: scale(.92); opacity: .8; } 100% { transform: scale(1.6); opacity: 0; } }
@keyframes lotse-spin { to { transform: rotate(360deg); } }
@keyframes lotse-breathe { 0%, 100% { box-shadow: 0 6px 18px rgb(15 23 42 / .3), 0 0 0 2px #fff, 0 0 0 0 rgb(37 99 235 / 0); } 50% { box-shadow: 0 6px 18px rgb(15 23 42 / .3), 0 0 0 2px #fff, 0 0 0 7px rgb(37 99 235 / .2); } }
@keyframes lotse-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes lotse-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
.wrap[data-mode="active"] .orb { animation: lotse-breathe 3.2s ease-in-out infinite; }
.wrap[data-mode="listening"] .ring { animation: lotse-pulse 1.1s ease-out infinite; }
.wrap[data-mode="listening"] .ring.r2 { animation-delay: .55s; }
.wrap[data-mode="speaking"] .ring { animation: lotse-pulse 1.7s ease-out infinite; }
.wrap[data-mode="speaking"] .ring.r2 { animation-delay: .85s; }
.wrap[data-mode="thinking"] .ring:not(.r2) { opacity: 1; inset: -5px; border-color: transparent; border-top-color: var(--c); border-right-color: var(--c); animation: lotse-spin .9s linear infinite; }
.wrap[data-mode="offline"] .ring:not(.r2) { opacity: 1; inset: -5px; border: 2px dashed #94a3b8; }
.wrap[data-mode="offer"] .orb { animation: lotse-bob 1.4s ease-in-out infinite; }
.wrap[data-mode="error"] .orb { animation: lotse-shake .35s ease-in-out 2; }
.wrap[data-mode="paused"] .orb, .wrap[data-mode="idle"] .orb { opacity: .92; }
@media (prefers-reduced-motion: reduce) {
  .orb, .ring { animation: none !important; }
  .wrap[data-mode="listening"] .ring:not(.r2), .wrap[data-mode="speaking"] .ring:not(.r2), .wrap[data-mode="thinking"] .ring:not(.r2) { opacity: 1; inset: -5px; border: 3px solid var(--c); }
}
`;

export class OrbView {
  readonly host: HTMLDivElement;
  private readonly shadow: ShadowRoot;
  private readonly wrap: HTMLDivElement;
  private readonly orb: HTMLButtonElement;
  private readonly more: HTMLButtonElement;
  private readonly badge: HTMLSpanElement;
  private readonly tip: HTMLDivElement;
  private readonly menu: HTMLDivElement;
  private readonly live: HTMLDivElement;
  private position: OrbPosition;
  private model: OrbViewModel | null = null;
  private shown = false;
  private hovered = false;
  private menuOpen = false;
  private suppressClick = false;
  private press: Press | null = null;
  private observer: MutationObserver | null = null;
  private frame = 0;
  private spoken = "";
  private readonly cleanup: Array<() => void> = [];

  constructor(private readonly options: ViewOptions) {
    this.position = options.position;
    const host = document.createElement("div");
    host.id = ORB_HOST_ID;
    if (typeof host.showPopover === "function") host.setAttribute("popover", "manual");
    this.host = host;
    this.shadow = host.attachShadow({ mode: "open" });
    this.shadow.innerHTML = `<style>${STYLE}</style><div class="wrap" data-mode="idle" data-side="left" data-v="up">`
      + '<span class="ring"></span><span class="ring r2"></span>'
      + '<button class="orb" type="button" aria-haspopup="menu" aria-describedby="lotse-orb-tip"></button>'
      + '<span class="badge" hidden></span>'
      + '<button class="more" type="button" aria-label="Valo-Menü" aria-haspopup="menu" aria-expanded="false">⋯</button>'
      + '<div class="tip" id="lotse-orb-tip" role="tooltip" hidden></div><div class="menu" role="menu" aria-label="Valo" hidden></div>'
      + '<div class="sr" role="status" aria-live="polite"></div></div>';
    const $ = <T extends Element>(selector: string) => this.shadow.querySelector<T>(selector)!;
    this.wrap = $(".wrap");
    this.orb = $(".orb");
    this.more = $(".more");
    this.badge = $(".badge");
    this.tip = $(".tip");
    this.menu = $(".menu");
    this.live = $(".sr");
    this.bind();
  }

  get visible() { return this.shown; }

  /** Show (or update) the orb. */
  render(model: OrbViewModel) {
    const modeChanged = this.model?.mode !== model.mode;
    this.model = model;
    this.wrap.dataset.mode = model.mode;
    if (modeChanged) this.orb.innerHTML = ICONS[model.mode];
    this.badge.hidden = !model.badge;
    this.orb.setAttribute("aria-label", `${model.title}. ${model.hint}`);
    const said = `${model.title}. ${model.detail}`;
    if (said !== this.spoken) { this.spoken = said; this.live.textContent = said; }
    if (!this.shown) { this.shown = true; this.attach(); this.watchDialogs(); }
    this.place();
    this.renderTip();
    if (this.menuOpen) this.renderMenu();
  }

  hide() {
    if (!this.shown) return;
    this.shown = false;
    this.closeMenu(false);
    this.observer?.disconnect();
    this.observer = null;
    this.host.remove();
  }

  destroy() {
    this.hide();
    for (const off of this.cleanup.splice(0)) off();
    cancelAnimationFrame(this.frame);
  }

  // --- top layer + modal dialogs -------------------------------------------------------

  private container(): Element {
    const modal = [...document.querySelectorAll("dialog[open]")].filter((dialog) => {
      try { return dialog.matches(":modal"); } catch { return false; }
    }).at(-1);
    return modal ?? document.documentElement;
  }

  private attach() {
    const container = this.container();
    if (this.host.parentNode !== container || !this.host.isConnected) container.append(this.host); // re-appending hides a popover …
    if (this.host.hasAttribute("popover")) {
      try { if (!this.host.matches(":popover-open")) this.host.showPopover(); } catch { /* not connected */ } // … so show it again
    }
  }

  private watchDialogs() {
    this.observer?.disconnect();
    this.observer = new MutationObserver(() => {
      if (this.frame) return;
      this.frame = requestAnimationFrame(() => {
        this.frame = 0;
        if (this.shown && (!this.host.isConnected || this.host.parentNode !== this.container())) this.attach();
      });
    });
    this.observer.observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ["open"] });
  }

  private place() {
    const right = clamp(this.position.right, MARGIN, innerWidth - SIZE - MARGIN);
    const bottom = clamp(this.position.bottom, MARGIN, innerHeight - SIZE - MARGIN);
    const styles: Array<[string, string]> = [
      ["position", "fixed"], ["inset", "auto"], ["right", right + "px"], ["bottom", bottom + "px"], ["width", SIZE + "px"], ["height", SIZE + "px"],
      ["margin", "0"], ["padding", "0"], ["border", "0"], ["background", "transparent"], ["overflow", "visible"], ["display", "block"],
      ["z-index", "2147483647"], ["pointer-events", "auto"], ["color-scheme", "light"],
    ];
    for (const [name, value] of styles) this.host.style.setProperty(name, value, "important");
    this.wrap.dataset.side = innerWidth - right - SIZE / 2 > innerWidth / 2 ? "left" : "right";
    this.wrap.dataset.v = innerHeight - bottom - SIZE / 2 > 160 ? "up" : "down";
  }

  // --- tooltip + menu -------------------------------------------------------------------

  private renderTip() {
    const model = this.model;
    if (!model) return;
    const transient = ["listening", "thinking", "speaking", "error"].includes(model.mode) || model.note !== null;
    const full = this.hovered && !this.press?.dragging;
    this.tip.hidden = this.menuOpen || !(full || transient);
    if (this.tip.hidden) return;
    const title = document.createElement("strong");
    title.textContent = model.note ?? model.title;
    const parts: HTMLElement[] = [title];
    const detailText = model.note ? "" : full || model.mode === "error" ? model.detail : "";
    if (detailText) { const detail = document.createElement("span"); detail.textContent = detailText; parts.push(detail); }
    if (full && !model.note) { const hint = document.createElement("span"); hint.className = "hint"; hint.textContent = model.hint; parts.push(hint); }
    this.tip.replaceChildren(...parts);
  }

  private renderMenu() {
    const items = this.model?.menu ?? [];
    this.menu.replaceChildren(...items.map((item) => {
      const button = document.createElement("button");
      button.type = "button";
      button.setAttribute("role", "menuitem");
      button.textContent = item.label;
      button.addEventListener("click", (event) => { event.stopPropagation(); this.closeMenu(true); this.options.onMenu(item.id); });
      return button;
    }));
  }

  private openMenu() {
    if (!this.model?.menu.length) return;
    this.menuOpen = true;
    this.wrap.classList.add("open");
    this.more.setAttribute("aria-expanded", "true");
    this.renderMenu();
    this.menu.hidden = false;
    this.renderTip();
    this.menu.querySelector("button")?.focus();
  }

  private closeMenu(focusOrb: boolean) {
    if (!this.menuOpen) return;
    this.menuOpen = false;
    this.wrap.classList.remove("open");
    this.more.setAttribute("aria-expanded", "false");
    this.menu.hidden = true;
    this.renderTip();
    if (focusOrb) this.orb.focus();
  }

  // --- input ---------------------------------------------------------------------------

  private bind() {
    // Keep the page's own bubbling handlers (e.g. "click outside closes the drawer") away from the orb.
    for (const type of ["pointerdown", "mousedown", "pointerup", "mouseup", "click", "dblclick", "contextmenu", "keydown", "keyup"]) {
      this.host.addEventListener(type, (event) => event.stopPropagation());
    }
    this.orb.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      this.orb.setPointerCapture(event.pointerId);
      const timer = setTimeout(() => {
        if (this.press && !this.press.dragging) { this.press.long = true; this.openMenu(); }
      }, LONG_PRESS_MS);
      this.press = { x: event.clientX, y: event.clientY, right: this.position.right, bottom: this.position.bottom, id: event.pointerId, dragging: false, long: false, timer };
    });
    this.orb.addEventListener("pointermove", (event) => {
      const press = this.press;
      if (!press || press.id !== event.pointerId) return;
      const dx = event.clientX - press.x;
      const dy = event.clientY - press.y;
      if (!press.dragging && Math.hypot(dx, dy) < 5) return;
      if (!press.dragging) { press.dragging = true; clearTimeout(press.timer); this.closeMenu(false); this.renderTip(); }
      this.position = {
        right: clamp(press.right - dx, MARGIN, innerWidth - SIZE - MARGIN),
        bottom: clamp(press.bottom - dy, MARGIN, innerHeight - SIZE - MARGIN),
      };
      this.place();
    });
    const release = (event: PointerEvent) => {
      const press = this.press;
      if (!press || press.id !== event.pointerId) return;
      clearTimeout(press.timer);
      this.press = null;
      this.suppressClick = press.dragging || press.long;
      if (press.dragging) this.options.onMoved({ ...this.position });
      this.renderTip();
    };
    this.orb.addEventListener("pointerup", release);
    this.orb.addEventListener("pointercancel", release);
    this.orb.addEventListener("click", (event) => {
      event.preventDefault();
      if (this.suppressClick) { this.suppressClick = false; return; }
      this.closeMenu(false);
      this.options.onActivate();
    });
    this.orb.addEventListener("contextmenu", (event) => { event.preventDefault(); this.openMenu(); });
    this.orb.addEventListener("keydown", (event) => {
      if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10") || event.key === "ArrowUp") { event.preventDefault(); this.openMenu(); }
    });
    this.more.addEventListener("click", (event) => { event.preventDefault(); if (this.menuOpen) this.closeMenu(true); else this.openMenu(); });
    this.menu.addEventListener("keydown", (event) => {
      const buttons = [...this.menu.querySelectorAll("button")];
      const index = buttons.indexOf(this.shadow.activeElement as HTMLButtonElement);
      if (event.key === "Escape") { event.preventDefault(); this.closeMenu(true); }
      else if (event.key === "ArrowDown") { event.preventDefault(); buttons[(index + 1) % buttons.length]?.focus(); }
      else if (event.key === "ArrowUp") { event.preventDefault(); buttons[(index - 1 + buttons.length) % buttons.length]?.focus(); }
      else if (event.key === "Tab") this.closeMenu(false);
    });
    this.wrap.addEventListener("pointerenter", () => { this.hovered = true; this.renderTip(); });
    this.wrap.addEventListener("pointerleave", () => { this.hovered = false; this.renderTip(); });
    this.orb.addEventListener("focus", () => { this.hovered = true; this.renderTip(); });
    this.orb.addEventListener("blur", () => { this.hovered = false; this.renderTip(); });
    const outside = (event: Event) => { if (this.menuOpen && !event.composedPath().includes(this.host)) this.closeMenu(false); };
    const resize = () => { if (this.shown) this.place(); };
    document.addEventListener("pointerdown", outside, true);
    window.addEventListener("resize", resize);
    this.cleanup.push(() => document.removeEventListener("pointerdown", outside, true), () => window.removeEventListener("resize", resize));
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
