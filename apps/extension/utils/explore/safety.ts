/**
 * Safety rules of the exploration (D-25) — the only place where Lotse clicks. Zod-free: used by the content script
 * (what may be clicked) and the service worker (which URLs may be visited). Blocked routes (D-27) use the shared matcher.
 *
 * Allowed: open links by URL (never by clicking), switch tabs, open menus/disclosures, open dialogs and close them again.
 * Never: submit forms, type, change selects/checkboxes, click delete/remove/send/save/submit/confirm/pay/logout or
 * danger-styled controls, leave the origin, enter a blocked route.
 */
import { routeBlocked } from "@lotse/shared/route";

/** Extra verbs beyond `EXPLORE_NEVER_CLICK` (shared) — everything that changes data or state in typical business apps. */
export const EXTRA_NEVER_CLICK = [
  "einreichen", "zurückweisen", "ablehnen", "abgelehnt", "angenommen", "annehmen", "genehmigen", "markieren", "erledigt", "abschließen",
  "verwerfen", "ausführen", "starten", "zuweisen", "importieren", "import ", "exportieren", "export ", "hochladen", "upload",
  "herunterladen", "download", "drucken", "print", "duplizieren", "kopieren", "copy", "stornieren", "kündigen", "sperren",
  "deaktivieren", "aktivieren", "zurücksetzen", "reset", "buchen", "bestellen", "kaufen", "buy", "order", "anrufen", "call",
  "approve", "reject", "accept", "decline", "archive", "publish", "veröffentlichen", "verschieben", "move", "sign out", "log out",
  "signout", "abmeld", "beenden", "leeren", "clear", "passwort", "password", "token", "schlüssel", "2fa", "zwei-faktor",
];

/** Words of labels that typically open a dialog/panel without changing data. */
const OPENER = /^(\+|neu|neue|neuer|neues|new)\b|erstellen|anlegen|öffnen|anzeigen|details|filter|hilfe|help|befehl|suche\b|mehr\b|more\b|bearbeiten|ändern|edit\b|einstellungen/i;
const CLOSE_LABEL = /^(abbrechen|schließen|schliessen|close|cancel|dialog schließen|×|✕|✖|x)$/i;
/** Links are opened by URL, never clicked — only session/destructive targets are skipped. */
const LINK_NEVER = /\b(abmelden|logout|log out|sign out|signout|löschen|delete|entfernen|remove|kündigen|unsubscribe|bezahlen)\b/i;
const DANGER_CLASS = /danger|destructive|delete|remove|critical|btn-red|button-red|warn/i;
const FILE_LINK = /\.(pdf|csv|xlsx?|docx?|zip|json|xml|txt|png|jpe?g|svg|ics|vcf)$/i;
const UNSAFE_PATH = /log-?out|sign-?out|abmelden|delete|loeschen|löschen|remove|destroy|unsubscribe/i;
const ID_LIKE = /^(\d+|[0-9a-f]{8}-[0-9a-f-]{27,}|[0-9a-f]{16,}|[A-Z]{1,4}-?\d{2,}[\w-]*)$/i;

export const isCloseLabel = (label: string) => CLOSE_LABEL.test(label.trim());
export const looksLikeOpener = (label: string) => OPENER.test(label.trim());
export const linkForbidden = (label: string) => LINK_NEVER.test(label);

/** Label check: shared never-click list + extra verbs (case-insensitive substring). Empty labels are never clicked. */
export function labelForbidden(label: string, neverClick: readonly string[]): boolean {
  const text = label.toLowerCase().replace(/\s+/g, " ").trim();
  if (!text) return true;
  return [...neverClick, ...EXTRA_NEVER_CLICK].some((word) => text.includes(word.toLowerCase()));
}

/** Red/danger styling: classes, or a clearly red background/text colour. */
export function looksDangerous(element: Element): boolean {
  const classes = [element.className, element.parentElement?.className].map((c) => (typeof c === "string" ? c : "")).join(" ");
  if (DANGER_CLASS.test(classes) || element.getAttribute("data-variant") === "danger" || element.getAttribute("data-danger") !== null) return true;
  const style = getComputedStyle(element);
  return isRed(style.backgroundColor) || isRed(style.color) || isRed(style.borderColor);
}

function isRed(value: string): boolean {
  const m = /rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?/.exec(value);
  if (!m) return false;
  const [r, g, b, a] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4] === undefined ? 1 : Number(m[4])];
  return a > 0.5 && r > 150 && r > g * 1.7 && r > b * 1.7;
}

/** Contract route: pathname + hash route ("#/…"), never the query string (may contain entered data). */
export function routeOf(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + (u.hash.startsWith("#/") ? u.hash.split("?")[0] : "");
  } catch { return "/"; }
}

/** Dedup key of a page: route + query with id-like values collapsed (`kunde.html?id=:id` = one page for all records). */
export function visitKey(url: string): string {
  try {
    const u = new URL(url);
    const query = [...u.searchParams.entries()]
      .map(([k, v]) => `${k}=${ID_LIKE.test(v) ? ":id" : v.slice(0, 40)}`)
      .sort()
      .join("&");
    return routeOf(url) + (query ? `?${query}` : "");
  } catch { return url; }
}

/** Location as blocked-route patterns see it (path + query + hash). Checked locally only. */
export function locationOf(url: string): string {
  try { const u = new URL(url); return u.pathname + u.search + u.hash; }
  catch { return url; }
}

/**
 * URL the explorer may navigate to, or null. Same origin, http(s), no file downloads, no logout/delete paths,
 * not blocked by the app policy. Plain anchors (`#section`, tab hashes) are dropped — only "#/" hash routes are kept.
 */
export function navigableUrl(href: string, base: string, origin: string, blockedRoutes: readonly string[]): string | null {
  let u: URL;
  try { u = new URL(href, base); } catch { return null; }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  if (u.origin !== origin) return null;
  if (FILE_LINK.test(u.pathname) || UNSAFE_PATH.test(u.pathname + u.search)) return null;
  if (!u.hash.startsWith("#/")) u.hash = "";
  if (routeBlocked(locationOf(u.href), blockedRoutes)) return null;
  return u.href;
}
