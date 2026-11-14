/**
 * Valo's in-page overlay (content script only): Shadow-DOM host with an animated agent cursor, a highlight frame,
 * a hint bubble with optional buttons, and status chips. Pointer events pass through everything except the bubble's
 * buttons; the overlay never clicks or fills app controls (D-17). Works inside native modal dialogs (top layer) by
 * moving the host into the topmost open modal dialog.
 */
import type { VoiceState } from "@lotse/shared";

export type OverlayAction = "next" | "back" | "end" | "yes" | "no" | "up" | "down" | "close";
export type OverlayButton = { action: OverlayAction; label: string; primary?: boolean; title?: string };
export type OverlayView = { title?: string; text: string; detail?: string; note?: string; buttons?: OverlayButton[]; tone?: "hint" | "offer" };

type OverlayOptions = {
  hostId: string;
  onAction(action: OverlayAction): void;
  onTargetLost(): void;
  isVisible(element: HTMLElement): boolean;
};
type Point = { x: number; y: number };

const GLIDE_MS = 600;
const VOICE_TEXT: Partial<Record<VoiceState, string>> = { listening: "🎙 Valo hört zu …", thinking: "… Valo denkt nach", speaking: "🔊 Valo spricht" };
const STYLE = `
:host { all: initial; }
[hidden] { display: none !important; }
.frame { position: fixed; display: none; border: 3px solid #FF8A3D; border-radius: 10px; pointer-events: none;
  /* Spotlight: the marked spot stays bright, everything around it is dimmed by 20 % (clicks still pass through). */
  box-shadow: 0 0 0 4px rgb(255 138 61 / .3), 0 0 0 200vmax rgb(6 18 25 / .2); transition: opacity .15s, box-shadow .25s; }
.bubble { position: fixed; display: none; box-sizing: border-box; width: max-content; min-width: 180px; max-width: 320px; padding: 10px 12px; border-radius: 12px; background: #1e3a8a; color: #fff; font: 500 14px/1.4 system-ui, sans-serif; box-shadow: 0 8px 24px rgb(0 0 0 / .22); pointer-events: none; }
.bubble.offer { background: #0f172a; }
.bubble.below::before, .bubble.above::after { content: ""; position: absolute; left: var(--arrow, 18px); border: 7px solid transparent; }
.bubble.below::before { top: -14px; border-bottom-color: #1e3a8a; }
.bubble.above::after { bottom: -14px; border-top-color: #1e3a8a; }
.title { font-size: 11px; font-weight: 700; letter-spacing: .05em; text-transform: uppercase; opacity: .75; margin-bottom: 2px; }
.detail { margin-top: 4px; font-weight: 400; font-size: 13px; opacity: .92; white-space: pre-line; }
.note { margin-top: 6px; font-size: 12px; color: #bbf7d0; }
.buttons { display: flex; flex-wrap: wrap; align-items: center; gap: 6px; margin-top: 9px; }
.buttons button { all: unset; box-sizing: border-box; pointer-events: auto; cursor: pointer; padding: 4px 10px; border-radius: 8px; background: rgb(255 255 255 / .16); color: #fff; font: 600 12px/1.5 system-ui, sans-serif; }
.buttons button:hover { background: rgb(255 255 255 / .26); }
.buttons button.primary { background: #fff; color: #1e3a8a; }
.buttons button:focus-visible { outline: 2px solid #93c5fd; outline-offset: 2px; }
.cursor { position: fixed; left: 0; top: 0; opacity: 0; pointer-events: none; will-change: transform; filter: drop-shadow(0 2px 3px rgb(0 0 0 / .3)); }
.cursor svg { display: block; }
.tag { position: absolute; left: 18px; top: 16px; padding: 1px 7px; border-radius: 999px; background: #2563eb; color: #fff; font: 700 11px/1.5 system-ui, sans-serif; white-space: nowrap; }
.chips { position: fixed; right: 12px; bottom: 12px; display: flex; gap: 6px; pointer-events: none; }
.chip { padding: 6px 10px; border-radius: 20px; background: #1e3a8a; color: #fff; font: 12px/1.3 system-ui, sans-serif; }
.chip.voice { background: #0f766e; }
.chip.explore { background: #4338ca; }
@media (prefers-reduced-motion: reduce) { .cursor, .frame { transition: none !important; } }
`;

export class LotseOverlay {
  private host: HTMLDivElement | null = null;
  private frame!: HTMLDivElement;
  private bubble!: HTMLDivElement;
  private titleEl!: HTMLDivElement;
  private textEl!: HTMLDivElement;
  private detailEl!: HTMLDivElement;
  private noteEl!: HTMLDivElement;
  private buttonsEl!: HTMLDivElement;
  private cursor!: HTMLDivElement;
  private recordingChip!: HTMLDivElement;
  private voiceChip!: HTMLDivElement;
  private exploreChip!: HTMLDivElement;
  private target: HTMLElement | null = null;
  private view: OverlayView | null = null;
  private cursorAt: Point | null = null;
  private glideToken = 0;
  private gliding = false;
  private revealed = false;
  private holdCursor = false;
  private recording = false;
  private paused = false;
  private pausedVisible = false;
  private voiceText = "";
  private chipsHidden = false;
  private exploreText = "";

  constructor(private readonly options: OverlayOptions) {}

  get currentTarget() { return this.target; }
  get visible() { return this.view !== null; }

  /** Glide the cursor from its last position to the target (or the floating card), then show frame + bubble. */
  show(view: OverlayView, target: HTMLElement | null) {
    this.ensure();
    this.view = view;
    this.target = target;
    this.revealed = false;
    this.holdCursor = false;
    this.fill(view);
    this.attach();
    this.syncHost();
    if (target) {
      const rect = target.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > innerHeight || rect.right < 0 || rect.left > innerWidth) target.scrollIntoView({ block: "center", inline: "nearest" });
    }
    this.layout();
    void this.glide(this.cursorDestination()).then((current) => {
      if (!current || this.view !== view) return;
      this.revealed = true;
      this.render();
    });
  }

  /** Replace the bubble content without moving the cursor (e.g. a `say` line or feedback acknowledgement). */
  update(view: OverlayView) {
    if (!this.view) return;
    this.view = view;
    this.fill(view);
    this.render();
  }

  /** Hide frame and bubble. `keepCursor` leaves the cursor in place for the next plan step. */
  clear(keepCursor = false) {
    this.view = null;
    this.target = null;
    this.revealed = false;
    this.glideToken++;
    this.gliding = false;
    this.holdCursor = keepCursor;
    if (!this.host) return;
    this.frame.style.display = "none";
    this.bubble.style.display = "none";
    if (!keepCursor) this.cursor.style.opacity = "0";
    this.syncHost();
  }

  setRecording(recording: boolean) {
    this.recording = recording;
    if (!this.host && !recording) return;
    this.ensure();
    this.syncChip();
    this.syncHost();
  }

  /** Blocked route / app not allowed (D-27): the status chip says so; `visible` = show it even when not recording. */
  setPaused(paused: boolean, visible: boolean) {
    this.paused = paused;
    this.pausedVisible = paused && visible;
    if (!this.host && !this.recording && !this.pausedVisible) return;
    this.ensure();
    this.syncChip();
    this.syncHost();
  }

  /** The status orb (utils/orb, D-29) shows recording/paused/voice itself — hide the chips while it is visible. */
  setChipsHidden(hidden: boolean) {
    this.chipsHidden = hidden;
    if (!this.host) return;
    this.syncChip();
    this.voiceChip.hidden = hidden || !this.voiceText;
    this.syncHost();
  }

  setVoiceState(state: VoiceState) {
    this.voiceText = VOICE_TEXT[state] ?? "";
    if (!this.host && !this.voiceText) return;
    this.ensure();
    this.voiceChip.textContent = this.voiceText;
    this.voiceChip.hidden = this.chipsHidden || !this.voiceText;
    this.syncHost();
  }

  setExploreText(text: string) {
    this.exploreText = text;
    if (!this.host && !this.exploreText) return;
    this.ensure();
    this.exploreChip.textContent = this.exploreText;
    this.exploreChip.hidden = !this.exploreText;
    this.syncHost();
  }

  /** Follow scrolling/resizing/DOM changes. Reports a vanished target through `onTargetLost`. */
  render() {
    if (!this.host) return;
    this.attach();
    this.syncHost();
    if (!this.view) return;
    if (this.target && (!this.target.isConnected || !this.options.isVisible(this.target))) {
      this.options.onTargetLost();
      return;
    }
    this.layout();
    if (!this.gliding && this.revealed) this.placeCursor(this.cursorDestination(), false);
  }

  destroy() {
    this.glideToken++;
    this.host?.remove();
    this.host = null;
    this.target = null;
    this.view = null;
  }

  private ensure() {
    if (this.host) return;
    const host = document.createElement("div");
    host.id = this.options.hostId;
    Object.assign(host.style, { position: "fixed", inset: "0", pointerEvents: "none", zIndex: "2147483647", display: "none", margin: "0", padding: "0", border: "0", background: "transparent" });
    const shadow = host.attachShadow({ mode: "open" });
    const style = document.createElement("style");
    style.textContent = STYLE;
    const div = (className: string) => { const element = document.createElement("div"); element.className = className; return element; };
    this.frame = div("frame");
    this.bubble = div("bubble");
    this.bubble.setAttribute("role", "status");
    this.bubble.setAttribute("aria-live", "polite");
    this.titleEl = div("title");
    this.textEl = div("text");
    this.detailEl = div("detail");
    this.noteEl = div("note");
    this.buttonsEl = div("buttons");
    this.bubble.append(this.titleEl, this.textEl, this.detailEl, this.noteEl, this.buttonsEl);
    this.cursor = div("cursor");
    this.cursor.setAttribute("aria-hidden", "true");
    this.cursor.innerHTML = '<svg width="24" height="26" viewBox="0 0 24 26"><path d="M3 2 L3 21 L8.2 16.2 L11.6 23.6 L15 22 L11.6 14.8 L18.6 14.8 Z" fill="#2563eb" stroke="#fff" stroke-width="1.8" stroke-linejoin="round"/></svg><span class="tag">Valo</span>';
    const chips = div("chips");
    this.exploreChip = div("chip explore");
    this.exploreChip.hidden = !this.exploreText;
    this.exploreChip.textContent = this.exploreText;
    this.voiceChip = div("chip voice");
    this.voiceChip.hidden = true;
    this.recordingChip = div("chip");
    chips.append(this.exploreChip, this.voiceChip, this.recordingChip);
    shadow.append(style, this.frame, this.bubble, this.cursor, chips);
    this.host = host;
    this.syncChip();
    document.documentElement.append(host);
  }

  private syncChip() {
    this.recordingChip.textContent = this.paused ? "⏸ Valo pausiert auf dieser Seite" : "● Valo zeichnet lokal auf";
    this.recordingChip.hidden = this.chipsHidden || !(this.recording || this.pausedVisible);
  }

  private fill(view: OverlayView) {
    this.titleEl.textContent = view.title ?? "";
    this.titleEl.hidden = !view.title;
    this.textEl.textContent = view.text.slice(0, 600);
    this.detailEl.textContent = view.detail?.slice(0, 400) ?? "";
    this.detailEl.hidden = !view.detail;
    this.noteEl.textContent = view.note ?? "";
    this.noteEl.hidden = !view.note;
    this.bubble.classList.toggle("offer", view.tone === "offer");
    this.buttonsEl.replaceChildren(...(view.buttons ?? []).map((button) => {
      const element = document.createElement("button");
      element.type = "button";
      element.textContent = button.label;
      if (button.title) { element.title = button.title; element.setAttribute("aria-label", button.title); }
      if (button.primary) element.classList.add("primary");
      element.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.options.onAction(button.action);
      });
      return element;
    }));
    this.buttonsEl.hidden = !view.buttons?.length;
  }

  /** A native modal dialog renders in the top layer and makes the rest inert, so the host has to live inside it. */
  private container(): Element {
    const own = this.target?.closest("dialog[open]");
    if (own) return own;
    const modal = [...document.querySelectorAll("dialog[open]")].filter((dialog) => {
      try { return dialog.matches(":modal"); } catch { return false; }
    }).at(-1);
    return modal ?? document.documentElement;
  }

  private attach() {
    if (!this.host) return;
    const container = this.container();
    if (this.host.parentNode !== container) container.append(this.host);
  }

  private syncHost() {
    if (this.host) this.host.style.display = this.recording || this.pausedVisible || this.view || this.voiceText || this.exploreText || this.holdCursor ? "block" : "none";
  }

  private layout() {
    if (!this.view) return;
    const visibility = this.revealed ? "visible" : "hidden";
    const bubble = this.bubble;
    bubble.style.display = "block";
    bubble.style.visibility = visibility;
    bubble.style.maxWidth = Math.max(160, Math.min(320, innerWidth - 16)) + "px";
    bubble.classList.remove("below", "above");
    const width = bubble.offsetWidth;
    const height = bubble.offsetHeight;
    if (this.target) {
      const rect = this.target.getBoundingClientRect();
      Object.assign(this.frame.style, {
        display: "block", visibility, left: rect.left - 6 + "px", top: rect.top - 6 + "px",
        width: rect.width + 12 + "px", height: rect.height + 12 + "px",
      });
      const left = clamp(rect.left, 8, innerWidth - width - 8);
      let top = rect.bottom + 24;
      let placement = "below";
      if (top + height > innerHeight - 8 && rect.top - 14 - height >= 8) { top = rect.top - 14 - height; placement = "above"; }
      top = clamp(top, 8, innerHeight - height - 8);
      bubble.classList.add(placement);
      bubble.style.setProperty("--arrow", clamp(rect.left + 12 - left, 10, width - 26) + "px");
      Object.assign(bubble.style, { left: left + "px", top: top + "px" });
    } else {
      this.frame.style.display = "none";
      Object.assign(bubble.style, { left: Math.max(8, innerWidth - width - 16) + "px", top: Math.max(8, innerHeight - height - 84) + "px" }); // clears the status orb
    }
  }

  private cursorDestination(): Point {
    if (this.target) {
      const rect = this.target.getBoundingClientRect();
      const x = rect.left + clamp(Math.min(rect.width - 10, 140), 4, Math.max(4, rect.width));
      const y = rect.height < 18 ? rect.top + rect.height / 2 : rect.bottom - 8;
      return { x: clamp(x, 4, innerWidth - 80), y: clamp(y, 4, innerHeight - 30) };
    }
    const bubble = this.bubble.getBoundingClientRect();
    return { x: clamp(bubble.left + 12, 4, innerWidth - 80), y: clamp(bubble.top - 34, 4, innerHeight - 30) };
  }

  private glide(to: Point): Promise<boolean> {
    const token = ++this.glideToken;
    const from = this.cursorAt ?? { x: innerWidth - 90, y: innerHeight - 70 };
    const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.placeCursor(from, false);
    this.cursor.style.opacity = "1";
    void this.cursor.offsetWidth; // commit the start position before animating
    if (reduced || Math.hypot(to.x - from.x, to.y - from.y) < 3) {
      this.placeCursor(to, false);
      this.gliding = false;
      return Promise.resolve(true);
    }
    this.gliding = true;
    this.placeCursor(to, true);
    return new Promise((resolve) => setTimeout(() => {
      const current = token === this.glideToken;
      if (current) this.gliding = false;
      resolve(current);
    }, GLIDE_MS + 20));
  }

  private placeCursor(point: Point, animate: boolean) {
    this.cursorAt = point;
    this.cursor.style.transition = animate ? `transform ${GLIDE_MS}ms cubic-bezier(.22,.61,.36,1), opacity .15s` : "opacity .15s";
    this.cursor.style.transform = `translate(${Math.round(point.x - 3)}px, ${Math.round(point.y - 2)}px)`;
  }
}

function clamp(value: number, min: number, max: number) {
  return Math.min(Math.max(value, min), Math.max(min, max));
}
