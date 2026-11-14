/**
 * Side panel switches for D-29: "Automatisch aktiv" and "Status-Kreis anzeigen" (chrome.storage.sync `lotse:presence`,
 * both default on), the hosts where the orb was hidden, and where Valo starts by itself (`lotse:activation`).
 */
import {
  ORB_PLACES_KEY, PRESENCE_KEY, parsePlaces, parsePresence,
  type ActivationInfo, type Presence,
} from "../../utils/orb/state";

const auto = document.querySelector<HTMLInputElement>("#auto-activate")!;
const orb = document.querySelector<HTMLInputElement>("#show-orb")!;
const autoLine = document.querySelector<HTMLParagraphElement>("#auto-line")!;
const hiddenLine = document.querySelector<HTMLParagraphElement>("#orb-hidden-line")!;
const hiddenText = document.querySelector<HTMLSpanElement>("#orb-hidden-text")!;
const unhide = document.querySelector<HTMLButtonElement>("#orb-unhide")!;
let presence: Presence = parsePresence(undefined);

async function save(patch: Partial<Presence>) {
  presence = { ...presence, ...patch };
  await browser.storage.sync.set({ [PRESENCE_KEY]: presence }).catch(() => undefined);
}

async function renderHidden() {
  const stored = await browser.storage.local.get(ORB_PLACES_KEY).catch(() => ({} as Record<string, unknown>));
  const hidden = parsePlaces(stored[ORB_PLACES_KEY]).hidden;
  hiddenText.textContent = hidden.length ? `Status-Kreis ausgeblendet auf: ${hidden.join(", ")}` : "";
  hiddenLine.hidden = hidden.length === 0;
}

async function renderActivation() {
  const info = await browser.runtime.sendMessage({ type: "lotse:activation" }).catch(() => null) as ActivationInfo | null;
  if (!info) { autoLine.textContent = ""; return; }
  const hosts = info.appHosts.length ? `: ${info.appHosts.join(", ")}` : "";
  autoLine.textContent = info.manualPause
    ? "Von dir pausiert – „Beobachtung starten“ oder „Fortsetzen“ im Status-Kreis setzt fort."
    : info.autoActivate
      ? `Valo startet auf den Apps deiner Organisation von selbst${hosts}.`
      : "„Automatisch aktiv“ ist aus – starte Valo mit „Beobachtung starten“.";
}

auto.addEventListener("change", () => { void save({ autoActivate: auto.checked }).then(renderActivation); });
orb.addEventListener("change", () => { void save({ orb: orb.checked }); });
unhide.addEventListener("click", () => {
  void browser.storage.local.get(ORB_PLACES_KEY)
    .then((stored) => browser.storage.local.set({ [ORB_PLACES_KEY]: { ...parsePlaces(stored[ORB_PLACES_KEY]), hidden: [] } }))
    .catch(() => undefined)
    .then(renderHidden);
});
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "sync" && changes[PRESENCE_KEY]) {
    presence = parsePresence(changes[PRESENCE_KEY].newValue);
    auto.checked = presence.autoActivate;
    orb.checked = presence.orb;
  }
  if (area === "local" && changes[ORB_PLACES_KEY]) void renderHidden();
});

void browser.storage.sync.get(PRESENCE_KEY).then((stored) => {
  presence = parsePresence(stored[PRESENCE_KEY]);
  auto.checked = presence.autoActivate;
  orb.checked = presence.orb;
}).catch(() => undefined);
void renderHidden();
void renderActivation();
setInterval(() => { void renderActivation(); }, 2_000);
