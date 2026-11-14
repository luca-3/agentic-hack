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

const SIZE = 52;
const MARGIN = 8;
const LONG_PRESS_MS = 550;
/** Ring / accent colour per state — Valo palette (navy, petrol, beacon orange). */
const COLORS: Record<OrbMode, string> = {
  active: "#127A86", idle: "#6B8FAA", paused: "#6B8FAA", blocked: "#D97706", offline: "#9AB5C9", "signed-out": "#9AB5C9",
  listening: "#FF8A3D", thinking: "#5FC4CE", speaking: "#FF8A3D", offer: "#FF8A3D", error: "#EF4444",
};
/**
 * The Valo lighthouse (same drawing as the dashboard's icon.svg), split into parts the states animate:
 * sweep (rotating light cone), beams (left/right), lamp, tower, waves. Light tower on a navy disc.
 */
const LIGHTHOUSE = `<svg class="lh" viewBox="0 0 40 40" aria-hidden="true">
<polygon class="sweep" points="20,11.5 44,2 44,21"/>
<g class="beam beam-l"><polygon points="14.5,10.6 2,7 2,8.9"/><polygon points="14.5,12.4 2,16.2 2,14.3"/></g>
<g class="beam beam-r"><polygon points="25.5,10.6 38,7 38,8.9"/><polygon points="25.5,12.4 38,16.2 38,14.3"/></g>
<rect class="lamp" x="16.4" y="9" width="7.2" height="5" rx="0.6"/>
<g class="tower"><circle cx="20" cy="4.4" r="1.1"/><path d="M15 9.2 Q20 3.6 25 9.2 Z"/><path d="M15.4 9 h1.4 v5 h-1.4 Z M23.2 9 h1.4 v5 h-1.4 Z"/><rect x="13.8" y="14" width="12.4" height="2.3" rx="0.6"/><path fill-rule="evenodd" d="M15.6 16.3 H24.4 L26.9 32 H13.1 Z M19.1 19.6 h1.8 v3.4 h-1.8 Z M19.1 25.4 h1.8 v3.2 h-1.8 Z"/><path d="M8.5 34 Q11 30 13.6 31.4 L16.4 29.6 L20 31.2 L23.6 29.4 L26.4 31.2 Q29.5 30 31.5 34 Z"/></g>
<path class="waves" d="M-5 37.2 q2.5 -1.4 5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0 t5 0"/>
</svg>`;
const STYLE = `
:host { all: initial; }
* { box-sizing: border-box; }
[hidden] { display: none !important; }
.wrap { position: relative; width: ${SIZE}px; height: ${SIZE}px; font: 13px/1.35 "IBM Plex Sans", system-ui, -apple-system, "Segoe UI", sans-serif; color: #0F2A3D;
  --c: #127A86; --light: #FF8A3D; --tower: #F2F6F9; --sea: #5FC4CE; }
.ring { position: absolute; inset: 0; border-radius: 50%; border: 3px solid var(--c); opacity: 0; pointer-events: none; }
.orb { all: unset; position: relative; z-index: 1; display: grid; place-items: center; width: ${SIZE}px; height: ${SIZE}px; border-radius: 50%; cursor: pointer; overflow: hidden;
  background: radial-gradient(circle at 50% 30%, #2E5572 0%, #0F2A3D 62%, #0A1D2B 100%);
  box-shadow: 0 6px 18px rgb(6 18 25 / .4), 0 0 0 2px #F2F6F9, 0 0 0 4px var(--c); transition: box-shadow .3s, transform .15s, filter .3s;
  touch-action: none; user-select: none; -webkit-user-select: none; }
.orb:hover { transform: scale(1.06); }
.orb:active { transform: scale(.95); }
.orb:focus-visible, .more:focus-visible, .menu button:focus-visible { outline: 3px solid #5FC4CE; outline-offset: 4px; }
.lh { width: 40px; height: 40px; margin-top: 2px; pointer-events: none; overflow: visible; }
.lh .tower { fill: var(--tower); transition: fill .3s; }
.lh .lamp { fill: var(--light); transition: fill .3s, opacity .3s; }
.lh .beam { fill: var(--light); opacity: .85; transition: opacity .3s; }
.lh .sweep { fill: var(--light); opacity: 0; transform-box: view-box; transform-origin: 20px 11.5px; }
.lh .waves { fill: none; stroke: var(--sea); stroke-width: 1.4; stroke-linecap: round; }
.badge { position: absolute; z-index: 2; pointer-events: none; top: -1px; right: -1px; width: 13px; height: 13px; border-radius: 50%; background: #FF8A3D; box-shadow: 0 0 0 2px #F2F6F9; }
.more { all: unset; position: absolute; z-index: 2; left: -7px; top: -7px; width: 22px; height: 22px; border-radius: 50%; display: grid; place-items: center; cursor: pointer;
  background: #fff; color: #334155; font: 700 14px/1 system-ui, sans-serif; box-shadow: 0 2px 6px rgb(15 23 42 / .3); opacity: 0; transform: scale(.7); transition: opacity .15s, transform .15s; }
.wrap:hover .more, .wrap:focus-within .more, .wrap.open .more { opacity: 1; transform: scale(1); }
.tip, .menu { position: absolute; z-index: 3; width: max-content; max-width: 270px; border-radius: 12px; box-shadow: 0 10px 28px rgb(15 23 42 / .28); }
.tip { padding: 8px 11px; background: #0F2A3D; color: #F2F6F9; pointer-events: none; }
.tip strong { display: block; font-size: 13px; }
.tip span { display: block; margin-top: 2px; font-size: 12px; opacity: .85; }
.tip .hint { margin-top: 5px; opacity: .6; font-size: 11px; }
.menu { min-width: 210px; padding: 6px; background: #F2F6F9; border: 1px solid #C3D4E0; }
.menu button { all: unset; display: block; width: 100%; box-sizing: border-box; padding: 8px 10px; border-radius: 8px; cursor: pointer; font: 500 13px/1.3 system-ui, sans-serif; color: #0f172a; }
.menu button:hover, .menu button:focus { background: #E1EAF0; }
.wrap[data-side="left"] .tip { right: ${SIZE + 10}px; } .wrap[data-side="right"] .tip { left: ${SIZE + 10}px; }
.wrap[data-v="up"] .tip { bottom: 2px; } .wrap[data-v="down"] .tip { top: 2px; }
.wrap[data-side="left"] .menu { right: 0; } .wrap[data-side="right"] .menu { left: 0; }
.wrap[data-v="up"] .menu { bottom: ${SIZE + 10}px; } .wrap[data-v="down"] .menu { top: ${SIZE + 10}px; }
.sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }
${Object.entries(COLORS).map(([mode, color]) => `.wrap[data-mode="${mode}"] { --c: ${color}; }`).join("\n")}
@keyframes valo-pulse { 0% { transform: scale(.95); opacity: .85; } 100% { transform: scale(1.6); opacity: 0; } }
@keyframes valo-glow { 0%, 100% { opacity: .75; } 50% { opacity: 1; } }
@keyframes valo-beams { 0%, 100% { opacity: .35; } 50% { opacity: .9; } }
@keyframes valo-sweep { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
@keyframes valo-blink { 0%, 49% { opacity: 1; } 50%, 100% { opacity: .1; } }
@keyframes valo-flash { 0%, 30%, 60%, 100% { opacity: .5; } 15%, 45% { opacity: 1; } }
@keyframes valo-sea { from { transform: translateX(0); } to { transform: translateX(5px); } }
@keyframes valo-bob { 0%, 100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
@keyframes valo-shake { 0%, 100% { transform: translateX(0); } 25% { transform: translateX(-4px); } 75% { transform: translateX(4px); } }
/* active: the beacon burns calmly */
.wrap[data-mode="active"] .lamp { animation: valo-glow 3s ease-in-out infinite; filter: drop-shadow(0 0 1.5px #FF8A3D); }
.wrap[data-mode="active"] .beam { animation: valo-beams 3s ease-in-out infinite; }
/* ready: lamp dimmed, beams off */
.wrap[data-mode="idle"] .lamp { opacity: .55; }
.wrap[data-mode="idle"] .beam { opacity: .12; }
/* listening: the light cone turns, orange pulse rings */
.wrap[data-mode="listening"] .beam { opacity: .15; }
.wrap[data-mode="listening"] .lamp { filter: drop-shadow(0 0 2.5px #FF8A3D); }
.wrap[data-mode="listening"] .sweep { opacity: .45; animation: valo-sweep 1.8s linear infinite; }
.wrap[data-mode="listening"] .ring { animation: valo-pulse 1.2s ease-out infinite; }
.wrap[data-mode="listening"] .ring.r2 { animation-delay: .6s; }
/* thinking: beams signal left/right in turn */
.wrap[data-mode="thinking"] .beam-l { animation: valo-blink .9s steps(1) infinite; }
.wrap[data-mode="thinking"] .beam-r { animation: valo-blink .9s steps(1) infinite .45s; }
.wrap[data-mode="thinking"] .lamp { animation: valo-glow .9s ease-in-out infinite; }
/* speaking: beams pulse, the sea moves */
.wrap[data-mode="speaking"] .beam, .wrap[data-mode="speaking"] .lamp { animation: valo-glow .6s ease-in-out infinite; }
.wrap[data-mode="speaking"] .waves { animation: valo-sea .8s linear infinite; }
.wrap[data-mode="speaking"] .ring { animation: valo-pulse 1.7s ease-out infinite; }
.wrap[data-mode="speaking"] .ring.r2 { animation-delay: .85s; }
/* offer: the beacon flashes twice, the orb bobs */
.wrap[data-mode="offer"] .beam, .wrap[data-mode="offer"] .lamp { animation: valo-flash 2s ease-in-out infinite; }
.wrap[data-mode="offer"] .lamp { filter: drop-shadow(0 0 2.5px #FF8A3D); }
.wrap[data-mode="offer"] .orb { animation: valo-bob 1.4s ease-in-out infinite; }
/* paused / blocked / offline / signed out: light off, tower muted */
.wrap[data-mode="paused"] .orb, .wrap[data-mode="blocked"] .orb, .wrap[data-mode="offline"] .orb, .wrap[data-mode="signed-out"] .orb { filter: saturate(.25); }
.wrap[data-mode="paused"] .beam, .wrap[data-mode="blocked"] .beam, .wrap[data-mode="offline"] .beam, .wrap[data-mode="signed-out"] .beam { opacity: 0; }
.wrap[data-mode="paused"] .lamp, .wrap[data-mode="blocked"] .lamp, .wrap[data-mode="offline"] .lamp, .wrap[data-mode="signed-out"] .lamp { fill: #456E8C; }
.wrap[data-mode="paused"] .tower, .wrap[data-mode="offline"] .tower, .wrap[data-mode="signed-out"] .tower { fill: #9AB5C9; }
.wrap[data-mode="blocked"] .ring:not(.r2), .wrap[data-mode="offline"] .ring:not(.r2) { opacity: 1; inset: -6px; border: 2px dashed var(--c); }
/* error: red lamp, short shake */
.wrap[data-mode="error"] { --light: #EF4444; }
.wrap[data-mode="error"] .lamp { filter: drop-shadow(0 0 2px #EF4444); }
.wrap[data-mode="error"] .orb { animation: valo-shake .35s ease-in-out 2; }
@media (prefers-reduced-motion: reduce) {
  .orb, .ring, .lh * { animation: none !important; }
  .wrap[data-mode="listening"] .sweep { opacity: .45; transform: rotate(-20deg); }
  .wrap[data-mode="listening"] .ring:not(.r2), .wrap[data-mode="speaking"] .ring:not(.r2), .wrap[data-mode="thinking"] .ring:not(.r2) { opacity: 1; inset: -6px; border: 3px solid var(--c); }
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
      + `<button class="orb" type="button" aria-haspopup="menu" aria-describedby="lotse-orb-tip">${LIGHTHOUSE}</button>`
      + '<span class="badge" hidden></span>'
      + '<button class="more" type="button" aria-label="Valo menu" aria-haspopup="menu" aria-expanded="false">⋯</button>'
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
    this.model = model;
    this.wrap.dataset.mode = model.mode; // the lighthouse SVG stays; CSS animates it per state
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
