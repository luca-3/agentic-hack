/**
 * Status orb controller (content script, D-29). Shows Lotse's state on org app pages: not connected, signed out, active,
 * paused (by the user or a blocked route), listening (wake word / hotkey / click), thinking, speaking, offer, error.
 * The service worker answers `lotse:orb-status` (utils/activation.ts) — polled every 1.5 s while the orb is visible —
 * and pushes `lotse:voice-state`, so the orb reacts to "Hey Jarvis" at once. Switches: `lotse:presence` (sync),
 * position + hidden hosts: `lotse:orb` (local).
 */
import type { VoiceState } from "@lotse/shared";
import { OrbView, type OrbMenuItem, type OrbViewModel } from "./view";
import {
  ORB_PLACES_KEY, ORB_TITLE, PRESENCE_KEY, orbMode, parsePlaces, parsePresence,
  type OrbPlaces, type OrbPosition, type OrbStatus, type Presence,
} from "./state";

export { ORB_HOST_ID } from "./state";

type Options = { onVisibleChange?(visible: boolean): void };
type Reply = { ok?: boolean; error?: string } | null | undefined;

const DEFAULT_POSITION: OrbPosition = { right: 20, bottom: 20 };
const VOICE_STATES = new Set<string>(["off", "idle", "listening", "thinking", "speaking"]);
const POLL_VISIBLE_MS = 1_500;
const POLL_HIDDEN_MS = 5_000;

export function setupOrb(options: Options = {}): { destroy(): void } {
  const host = location.host.toLowerCase();
  let presence: Presence = { autoActivate: true, orb: true };
  let places: OrbPlaces = { positions: {}, hidden: [] };
  let status: OrbStatus | null = null;
  let view: OrbView | null = null;
  let visible = false;
  let destroyed = false;
  let flash: { text: string; error: boolean; until: number } | null = null;
  let pollTimer: ReturnType<typeof setTimeout> | undefined;
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const send = (message: unknown): Promise<Reply> => browser.runtime.sendMessage(message).then((reply) => reply as Reply, () => null);

  function viewModel(current: OrbStatus): OrbViewModel {
    const live = flash && flash.until > Date.now() ? flash : null;
    const mode = orbMode(current, live?.error ? live.text : null);
    let detail = current.detail;
    if (mode === "error") detail = (live?.error ? live.text : current.error) ?? "";
    else if (mode === "offer") detail = current.offer ?? "";
    else if (mode === "listening") detail = "Stell deine Frage. Ein Klick beendet sie.";
    else if (mode === "thinking") detail = "Lotse sucht den nächsten Schritt.";
    else if (mode === "speaking") detail = "Klick: neue Frage stellen.";
    const hint = current.voiceOn ? "Klick: Frage sprechen („Hey Jarvis“, Alt+Shift+L) · Rechtsklick: Menü" : "Sprache ist aus · Rechtsklick: Menü";
    const menu: OrbMenuItem[] = [];
    if (current.base === "paused" || (current.base === "idle" && !current.autoActivate)) menu.push({ id: "resume", label: current.base === "paused" ? "Fortsetzen" : "Lotse hier starten" });
    else if (current.base === "active" || current.base === "blocked" || current.base === "idle") menu.push({ id: "pause", label: "Pausieren" });
    if (current.voiceOn && current.base !== "offline") menu.push({ id: "listen", label: mode === "listening" ? "Zuhören beenden" : "Frage sprechen" });
    menu.push({ id: "panel", label: current.signedIn ? "Seitenbereich öffnen" : "Anmelden · Seitenbereich öffnen" });
    menu.push({ id: "hide", label: "Auf dieser Seite ausblenden" });
    return { mode, title: ORB_TITLE[mode], detail, hint, note: live && !live.error ? live.text : null, badge: Boolean(current.offer), menu };
  }

  function render() {
    if (destroyed) return;
    const show = Boolean(status?.visible) && presence.orb && !places.hidden.includes(host);
    if (show !== visible) { visible = show; options.onVisibleChange?.(show); }
    if (!show || !status) { view?.hide(); return; }
    view ??= new OrbView({ position: places.positions[host] ?? DEFAULT_POSITION, onActivate, onMenu, onMoved });
    view.render(viewModel(status));
  }

  function showFlash(text: string, error: boolean, ms = 6_000) {
    flash = { text: text.slice(0, 200), error, until: Date.now() + ms };
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { flash = null; render(); }, ms + 50);
    render();
  }

  function schedulePoll(delay: number) {
    clearTimeout(pollTimer);
    if (!destroyed) pollTimer = setTimeout(() => { void poll(); }, delay);
  }

  async function poll() {
    if (destroyed) return;
    if (document.visibilityState === "visible") {
      const reply: unknown = await browser.runtime.sendMessage({ type: "lotse:orb-status" }).catch(() => null);
      if (isStatus(reply)) status = reply;
      render();
    }
    schedulePoll(visible ? POLL_VISIBLE_MS : POLL_HIDDEN_MS);
  }

  // --- actions (all start inside the user's click, so `lotse:open-panel` keeps the gesture) ---

  function onActivate() {
    if (!status) return;
    if (status.base === "offline") { showFlash("Der Lotse-Server ist nicht erreichbar.", true); void poll(); return; }
    if (status.base === "signed-out") { openPanel(); return; }
    void send({ type: "lotse:listen" }).then((reply) => {
      if (!reply) showFlash("Lotse ist nicht erreichbar. Lade die Erweiterung neu.", true);
      else if (reply.ok === false) showFlash(reply.error ?? "Lotse kann gerade nicht zuhören.", true);
      void poll();
    });
  }

  function openPanel() {
    void send({ type: "lotse:open-panel" }).then((reply) => {
      if (!reply?.ok) showFlash(reply?.error ?? "Öffne den Seitenbereich mit Alt+L.", false);
    });
  }

  function onMenu(id: string) {
    if (id === "panel") { openPanel(); return; }
    if (id === "listen") { onActivate(); return; }
    if (id === "pause" || id === "resume") {
      void send({ type: "lotse:orb-pause", paused: id === "pause" }).then((reply) => {
        if (reply?.ok === false) showFlash(reply.error ?? "Das hat nicht geklappt.", true);
        else showFlash(id === "pause" ? "Lotse pausiert, bis du fortsetzt." : "Lotse ist wieder aktiv.", false, 3_000);
        void poll();
      });
      return;
    }
    if (id === "hide") void updatePlaces((current) => ({ ...current, hidden: [...new Set([...current.hidden, host])] }));
  }

  function onMoved(position: OrbPosition) {
    void updatePlaces((current) => ({ ...current, positions: { ...current.positions, [host]: position } }));
  }

  async function updatePlaces(change: (current: OrbPlaces) => OrbPlaces) {
    const stored = await browser.storage.local.get(ORB_PLACES_KEY).catch(() => ({} as Record<string, unknown>));
    places = change(parsePlaces(stored[ORB_PLACES_KEY]));
    render();
    await browser.storage.local.set({ [ORB_PLACES_KEY]: places }).catch(() => undefined);
  }

  // --- wiring ---

  const onMessage = (message: unknown) => {
    // content.ts answers this message; the orb only listens so the wake word shows at once.
    if (!message || typeof message !== "object" || (message as { type?: unknown }).type !== "lotse:voice-state") return undefined;
    const state = (message as { state?: unknown }).state;
    if (status && typeof state === "string" && VOICE_STATES.has(state)) { status = { ...status, voice: state as VoiceState }; render(); }
    else void poll();
    return undefined;
  };
  const onStorage = (changes: Record<string, { newValue?: unknown }>, area: string) => {
    if (area === "sync" && changes[PRESENCE_KEY]) { presence = parsePresence(changes[PRESENCE_KEY].newValue); render(); }
    if (area === "local" && changes[ORB_PLACES_KEY]) { places = parsePlaces(changes[ORB_PLACES_KEY].newValue); render(); }
  };
  const onVisibility = () => { if (document.visibilityState === "visible") void poll(); };
  const onRoute = () => schedulePoll(80); // a blocked route shows right after the router changed the hash/history

  browser.runtime.onMessage.addListener(onMessage);
  browser.storage.onChanged.addListener(onStorage);
  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("hashchange", onRoute);
  window.addEventListener("popstate", onRoute);

  void Promise.all([
    browser.storage.sync.get(PRESENCE_KEY).catch(() => ({} as Record<string, unknown>)),
    browser.storage.local.get(ORB_PLACES_KEY).catch(() => ({} as Record<string, unknown>)),
  ]).then(([sync, local]) => {
    presence = parsePresence(sync[PRESENCE_KEY]);
    places = parsePlaces(local[ORB_PLACES_KEY]);
    void poll();
  });

  return {
    destroy() {
      destroyed = true;
      clearTimeout(pollTimer);
      clearTimeout(flashTimer);
      browser.runtime.onMessage.removeListener(onMessage);
      browser.storage.onChanged.removeListener(onStorage);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("hashchange", onRoute);
      window.removeEventListener("popstate", onRoute);
      view?.destroy();
      view = null;
      if (visible) { visible = false; options.onVisibleChange?.(false); }
    },
  };
}

function isStatus(value: unknown): value is OrbStatus {
  const v = value as Partial<OrbStatus> | null;
  return Boolean(v && typeof v === "object" && typeof v.visible === "boolean" && typeof v.base === "string" && typeof v.detail === "string");
}
