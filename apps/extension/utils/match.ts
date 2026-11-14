/**
 * Local, read-only label matching for multi-step guidance (D-19): after a click or navigation the next plan step is
 * found in a fresh snapshot by its label — no server call. Normalizes case, umlauts, diacritics, quotes and whitespace.
 */
import type { InteractiveElement } from "@lotse/shared";

const PLACEHOLDER = /[‹<«][^›>»]{1,60}[›>»]/g;
const ROLE_PREFIX = /^(?:tab|reiter|button|schaltflaeche|knopf|link|menue|menu|menuepunkt|feld|eingabefeld|dropdown|auswahl|checkbox|zeile|eintrag|seitenleiste|navigation)\s+/;

export function normalizeLabel(text: string): string {
  return text.toLocaleLowerCase("de-DE")
    .replace(/ä/g, "ae").replace(/ö/g, "oe").replace(/ü/g, "ue").replace(/ß/g, "ss")
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(PLACEHOLDER, " ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Labels such as "Zeile ‹Kundenname›" name a choice the user has to make; they cannot be resolved reliably. */
export function hasPlaceholder(label: string): boolean {
  return new RegExp(PLACEHOLDER.source).test(label);
}

function containsRun(haystack: string[], needle: string[]): boolean {
  if (!needle.length || needle.length > haystack.length) return false;
  for (let start = 0; start + needle.length <= haystack.length; start++) {
    if (needle.every((token, offset) => haystack[start + offset] === token)) return true;
  }
  return false;
}

function bigrams(text: string): Map<string, number> {
  const grams = new Map<string, number>();
  const compact = text.replace(/ /g, "");
  for (let i = 0; i < compact.length - 1; i++) {
    const gram = compact.slice(i, i + 2);
    grams.set(gram, (grams.get(gram) ?? 0) + 1);
  }
  return grams;
}

function dice(a: string, b: string): number {
  const left = bigrams(a);
  const right = bigrams(b);
  let total = 0;
  let shared = 0;
  for (const count of left.values()) total += count;
  for (const count of right.values()) total += count;
  for (const [gram, count] of left) shared += Math.min(count, right.get(gram) ?? 0);
  return total ? (2 * shared) / total : 0;
}

/** 0–100; ≥ 55 counts as a match. */
export function labelScore(wanted: string, candidate: string): number {
  const needle = normalizeLabel(wanted);
  const hay = normalizeLabel(candidate);
  if (!needle || !hay) return 0;
  const stripped = needle.replace(ROLE_PREFIX, "");
  let best = 0;
  for (const want of new Set([needle, stripped])) {
    if (!want) continue;
    if (want === hay) return 100;
    const wantTokens = want.split(" ");
    const hayTokens = hay.split(" ");
    if (want.length >= 3 && (hay.startsWith(want + " ") || want.startsWith(hay + " "))) best = Math.max(best, 85);
    if (want.length >= 3 && containsRun(hayTokens, wantTokens)) best = Math.max(best, 75);
    if (hay.length >= 4 && containsRun(wantTokens, hayTokens)) best = Math.max(best, 65);
    const union = new Set([...wantTokens, ...hayTokens]);
    const common = wantTokens.filter((token) => hayTokens.includes(token)).length;
    const overlap = union.size ? common / union.size : 0;
    if (overlap >= 0.5) best = Math.max(best, 40 + 30 * overlap);
    const similarity = dice(want, hay);
    if (similarity >= 0.8) best = Math.max(best, 55 + 100 * (similarity - 0.8));
  }
  return Math.min(best, 99);
}

/** Best enabled element for a step label, preferring exact matches, then elements in the viewport, then DOM order. */
export function findElementByLabel(label: string, elements: InteractiveElement[], viewport?: { width: number; height: number }): InteractiveElement | undefined {
  if (!label.trim() || !normalizeLabel(label)) return undefined;
  let winner: { element: InteractiveElement; score: number } | undefined;
  for (const element of elements) {
    if (element.disabled) continue;
    let score = labelScore(label, element.label);
    if (score < 55) continue;
    const rect = element.rect;
    if (viewport && rect && rect.y + rect.height > 0 && rect.y < viewport.height && rect.x < viewport.width) score += 0.5;
    if (!winner || score > winner.score) winner = { element, score };
  }
  return winner?.element;
}

/** Compares page paths only (query strings are never recorded); hash-router paths count when the step names one. */
export function routeMatches(stepRoute: string | undefined, currentRoute: string): boolean {
  if (!stepRoute) return true;
  const clean = (value: string) => {
    const hashRoute = value.includes("#/") ? "#/" + (value.split("#/")[1] ?? "").split(/[?#]/)[0] : "";
    const path = (value.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0] ?? "").replace(/\/index\.html$/, "/").replace(/\/+$/, "") || "/";
    return { path: path.startsWith("/") ? path : "/" + path, hashRoute };
  };
  const want = clean(stepRoute);
  const have = clean(currentRoute);
  if (want.path !== "/" && want.path !== have.path) return false;
  if (want.path === "/" && have.path !== "/" && !want.hashRoute) return false;
  return !want.hashRoute || want.hashRoute === have.hashRoute;
}

/** Human-readable page name for "expected page" hints. */
export function prettyRoute(route: string): string {
  const path = route.replace(/^https?:\/\/[^/]+/, "").split(/[?#]/)[0] ?? "";
  const file = path.split("/").filter(Boolean).at(-1) ?? "Startseite";
  const name = file.replace(/\.html?$/, "").replace(/[-_]/g, " ");
  return name === "index" || !name ? "Startseite" : name.charAt(0).toLocaleUpperCase("de-DE") + name.slice(1);
}
