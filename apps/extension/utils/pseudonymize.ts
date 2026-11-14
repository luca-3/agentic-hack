/**
 * Browser-side pseudonymization (D-26) — "nicht mehr Herr Müller sondern Herr [Person-1]".
 *
 * Page side (content script, DOM only): `collectPagePrivacy()` finds the page's CONTENT strings — record links, table
 * cells, detail values (<dd>), record headings, the signed-in user's name — plus the screen rects to paint over in
 * screenshots. UI labels (buttons, tabs, menus, field labels, column headers) stay readable: the agent needs them.
 *
 * Worker side (service worker): one mapping per browser session in chrome.storage.session — the same real value always
 * becomes the same token (`[Kunde-1]`, `[Person-2]`, `[IBAN-1]` …, see PSEUDONYM_TOKEN in @lotse/shared).
 * `pseudonymize()` runs on every request body right before `fetch`, `reidentify()` on every response, so the overlay,
 * the side panel and plan steps show the real names again. Patterns (e-mail, IBAN, "Herr/Frau <Name>", company forms,
 * street + number, postcode + city, phone, long numbers) also catch values that are not on the page, e.g. in a typed
 * question. Frames: `maskFrame()` paints the content rects over before a screenshot is buffered.
 *
 * Zod-free and without runtime imports from @lotse/shared, so the content script can import it cheaply.
 * Pseudonymized, not anonymous — limits in apps/extension/README.md.
 */
import type { ExploredPage, PseudonymKind } from "@lotse/shared";

// ---------------------------------------------------------------------------
// Shared types (content script ⇄ service worker; extension-internal, never sent to the server)
// ---------------------------------------------------------------------------

/** A content string of the page. `of` = the full value this text is a short form of (surname, name without legal form). */
export type PrivacyTerm = { text: string; kind: PseudonymKind; of?: string };
/** Viewport rect (CSS px) to paint over; `text` = the content shown there (drawn as its token on the mask). */
export type PrivacyRect = { x: number; y: number; width: number; height: number; text?: string };
export type PagePrivacy = { terms: PrivacyTerm[]; rects: PrivacyRect[]; viewport: { width: number; height: number } };
/** A snapshot as the content script sends it inside the extension. The schemas strip `privacy` before buffering. */
export type WithPrivacy<T> = T & { privacy?: PagePrivacy };

const KINDS: readonly PseudonymKind[] = ["Kunde", "Person", "Firma", "Adresse", "IBAN", "E-Mail", "Telefon", "Wert"];
/** Same shape as PSEUDONYM_TOKEN in @lotse/shared (kept local: that module pulls in zod). */
const TOKEN = /\[(Kunde|Person|Firma|Adresse|IBAN|E-Mail|Telefon|Wert)-(\d{1,4})\]/g;
const TOKEN_SPLIT = /(\[(?:Kunde|Person|Firma|Adresse|IBAN|E-Mail|Telefon|Wert)-\d{1,4}\])/g;
const TOKEN_EXACT = /^\[(?:Kunde|Person|Firma|Adresse|IBAN|E-Mail|Telefon|Wert)-\d{1,4}\]$/;
const MAX_TERMS = 3_000;
const MAX_TOKENS = 5_000;
const MAX_RECTS = 400;

/** Core UI terms and token kind names that must never enter the content dictionary. */
const PROTECTED_UI_TERMS = new Set([
  "kunde", "kunden", "person", "firma", "adresse", "iban", "e-mail", "email", "mail", "telefon", "wert",
  "lotse", "valo", "kundenwerk", "kundenwerk crm", "crm", "corpus", "dashboard", "startseite", "übersicht", "uebersicht",
  "aufgaben", "aufgabe", "angebote", "angebot", "verträge", "vertraege", "vertrag", "dokumente", "dokument",
  "einstellungen", "verwaltung", "benutzer", "benutzer & rollen", "import/export", "import", "export",
  "mein konto", "konto", "profil", "sicherheit", "benachrichtigungen", "abwesenheit", "vertretung", "signatur",
  "api-zugang", "allgemein", "abrechnung", "integrationen", "ansprechpartner", "zahlungsdaten", "verlauf",
  "stammdaten", "auf einen blick", "kennzahlen", "positionen", "details", "statusverlauf", "zusammenfassung",
  "speichern", "abbrechen", "weiter", "zurück", "fertig", "schließen", "löschen", "entfernen", "kündigen",
  "bearbeiten", "hinzufügen", "anlegen", "erstellen", "suchen", "filtern", "übernehmen", "verwerfen", "freigeben",
]);
const NON_STREET_WORDS = new Set([
  "klickweg", "lernpfad", "datenpfad", "dateipfad", "suchpfad", "arbeitsplatz", "speicherplatz", "steckplatz",
  "parkplatz", "spielplatz", "warenkorb", "zeitraum", "spielraum", "hintergrund",
]);
const NON_STREET_PREP_NOUNS = new Set([
  "jahr", "monat", "quartal", "tag", "woche", "schritt", "stufe", "teil", "abschnitt", "kapitel", "zeile", "spalte",
  "seite", "platz", "rang", "versuch", "punkt", "fall", "dialog", "tab", "reiter", "feld", "bereich", "menü",
  "status", "angebot", "auftrag", "vertrag", "konto", "profil", "dashboard", "ende", "anfang", "rahmen",
]);

// ---------------------------------------------------------------------------
// Pattern detectors (both sides). Order matters: wide spans first, numbers last.
// ---------------------------------------------------------------------------

type Detector = { kind: PseudonymKind; re: RegExp; group?: number; late?: boolean; guard?: (match: string, groups: unknown[]) => boolean };
const NAME = "\\p{Lu}[\\p{L}'’-]+";
const DETECTORS: Detector[] = [
  { kind: "E-Mail", re: /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)*\.\p{L}{2,}/gu },
  { kind: "IBAN", re: /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}(?: ?[A-Z0-9]{4}){2,7}(?: ?[A-Z0-9]{1,3})?(?![\p{L}\p{N}])/gu },
  { kind: "IBAN", re: /(?<![\p{L}\p{N}])[A-Z]{2}\d{2}[\s\u00A0]*(?:[•*xX]{2,4}[\s\u00A0]+){1,6}\d{2,4}(?![\p{L}\p{N}])/gu },
  // "Herr Müller", "Frau Dr. Anna Schmidt" — the salutation stays, the name becomes [Person-n].
  { kind: "Person", group: 2, re: new RegExp(`(?<![\\p{L}])(Herrn?|Frau|Hr\\.|Fr\\.|Dr\\.|Prof\\.)\\s+((?:(?:Dr|Prof)\\.\\s+)*${NAME}(?:\\s+${NAME})?)`, "gu") },
  { kind: "Firma", re: /(?:\p{Lu}[\p{L}\p{N}&.'’-]*\s+){1,4}(?:GmbH(?:\s*&\s*Co\.?\s*KG)?|gGmbH|AG|KGaA|KG|eG|e\.\s?V\.|SE|OHG|GbR|UG(?:\s*\(haftungsbeschränkt\))?|mbB|mbH|Ltd\.?|Inc\.?|LLC)(?![\p{L}])/gu },
  {
    kind: "Adresse",
    re: /\p{Lu}[\p{L}.-]*(?:straße|strasse|str\.|weg|allee|platz|gasse|ring|damm|ufer|chaussee|pfad|steig|markt|hof|wall)\s+\d{1,4}\s?[a-z]?(?![\p{L}\p{N}])/gu,
    guard: (match) => !NON_STREET_WORDS.has(match.split(/\s+/)[0]!.toLocaleLowerCase("de-DE")),
  },
  // Prepositional German street names like "Am Hafenrand 12", "Unter den Linden 77"
  {
    kind: "Adresse",
    re: /(?<![\p{L}])(?:Am|An\s+der|An\s+den|Auf\s+dem|Auf\s+der|Im|In\s+der|In\s+den|Unter\s+den|Unter\s+der|Zum|Zur)\s+(\p{Lu}[\p{L}-]{2,30})(?:\s+\p{Lu}[\p{L}-]{2,30})?\s+[1-9]\d{0,2}\s?[a-z]?(?![\p{L}\p{N}.])/gu,
    guard: (_match, groups) => typeof groups[0] === "string" && !NON_STREET_PREP_NOUNS.has(groups[0].toLocaleLowerCase("de-DE")),
  },
  { kind: "Adresse", re: /(?<![\p{N}])\d{5}\s+(?!Euro|EUR|Stück|Ergebnisse|Treffer|Zeichen|Kunden|Einträge)\p{Lu}[\p{L}-]+(?:\s+(?:am|an der|im|in der|bei)\s+\p{Lu}[\p{L}-]+)?/gu },
  { kind: "Telefon", late: true, re: /(?<![\p{L}\p{N}])(?:(?:\+|00)\d{1,3}[ \-/()]*(?:\(0\)\s?)?|0)\d{2,5}(?:[ \-/]?\d{2,8}){1,3}(?![\p{L}\p{N}])/gu },
  { kind: "Wert", late: true, re: /(?<![\p{L}\p{N}])\d{6,}(?![\p{N}])/gu },
];
const whole = (detector: Detector) => new RegExp(`^(?:${detector.re.source})$`, "u");
/** Format kinds win over the column's kind (an e-mail in a "Kontakt" column is an [E-Mail-n]). */
const FORMATS = DETECTORS.filter((d) => d.kind === "E-Mail" || d.kind === "IBAN" || d.kind === "Telefon").map((d) => ({ kind: d.kind, re: whole(d) }));
const COMPANY = whole(DETECTORS.find((d) => d.kind === "Firma")!);
const ANY = DETECTORS.map((d) => new RegExp(d.re.source, "u"));

/** Kind of a value that is entirely an e-mail, IBAN or phone number, else undefined. */
function patternKind(text: string): PseudonymKind | undefined {
  return FORMATS.find(({ re }) => re.test(text))?.kind;
}

function hasPattern(text: string): boolean {
  return ANY.some((re) => re.test(text));
}

const clean = (text: string | null | undefined) => (text ?? "").replace(/\s+/g, " ").trim();
const keyOf = (text: string) => clean(text).normalize("NFC").toLocaleLowerCase("de-DE");

// ---------------------------------------------------------------------------
// Page side: content strings and mask rects (content script only)
// ---------------------------------------------------------------------------

const UI_CONTAINER = 'nav, [role="navigation"], [role="menu"], [role="menubar"], [role="tablist"], [role="toolbar"], #lotse-overlay-host';
/** A link to a single record: id in the query, a numeric path segment, or a hash route with an id. */
const RECORD = /[?&](?:id|kunde|customer|client|person|kontakt|contact|nr|no|vorgang|fall|case)=|\/\d{3,}(?:[/?#]|$)|#\/[^?]*\/[\w-]*\d[\w-]*/i;
const SKIP_IN_CELL = 'button, [role="button"], select, input, textarea, svg, .sr-only, [aria-hidden="true"], [class*="badge"], [role="menu"], [class*="menu-wrap"]';
/** Column/detail headers whose values are categories, dates or amounts — useful for the agent, not personal. */
const KEEP_HEADER = /^(?:status|branche|kategorie|priorit(?:ä|ae)t|position|typ|art|rolle|phase|stufe|sparte|tarif|produkt|kundenportal|portal|erledigt|menge|gr(?:ö|oe)(?:ß|ss)e|aktion(?:en)?|zahlungsziel|land|sprache|w(?:ä|ae)hrung|einheit|f(?:ä|ae)llig(?: am)?|g(?:ü|ue)ltig bis|beginn|ende|erstellt(?: am)?|hochgeladen|k(?:ü|ue)ndigungsfrist|monatlich|umsatz.*|betrag.*|einzelpreis|preis|summe|netto|brutto|rabatt|zwischensumme|anzahl|offen|kunde seit|seit|datum|letzte .*)$/i;
const DATE_VALUE = /^(?:\d{1,2}\.\d{1,2}\.(?:\d{2}|\d{4})|\d{4}-\d{2}-\d{2})(?:,?\s+\d{1,2}:\d{2}(?:\s*Uhr)?)?$/;
const AMOUNT_VALUE = /^[−–+-]?\s?(?:\d{1,3}(?:[.\s]\d{3})*|\d+)(?:,\d+)?\s?(?:€|EUR|%|Tage(?: netto)?|Stk\.?|h)?$/i;

function kindFromHint(hint: string): PseudonymKind | undefined {
  const h = hint.toLocaleLowerCase("de-DE");
  if (/nummer|nr\b|number|\bno\b|\bid\b|kennung|aktenzeichen/.test(h) && !/[?&]id=/.test(h)) return "Wert";
  if (/iban/.test(h)) return "IBAN";
  if (/mail/.test(h)) return "E-Mail";
  if (/telefon|phone|mobil|handy|fax/.test(h)) return "Telefon";
  if (/kunde|customer|client|mandant/.test(h)) return "Kunde";
  if (/firma|unternehmen|company|organisation|arbeitgeber|lieferant/.test(h)) return "Firma";
  if (/name|person|kontakt|contact|ansprech|betreuer|zust(?:ä|ae)ndig|bearbeiter|mitarbeiter|employee|verantwortlich|inhaber|autor|teilnehmer|patient|bewerber|^von$|user|benutzer/.test(h)) return "Person";
  if (/adresse|anschrift|stra(?:ß|ss)e|^ort$|stadt|plz|postleitzahl|wohnort|address/.test(h)) return "Adresse";
  return undefined;
}

/** Visible text of a cell/value without buttons, badges, icons and screen-reader-only helpers. */
function contentText(element: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const skipped = node.parentElement?.closest(SKIP_IN_CELL);
    if (skipped && element.contains(skipped)) continue;
    parts.push(node.textContent ?? "");
  }
  return clean(parts.join(" ")).slice(0, 160);
}

function inViewport(rect: DOMRect, viewport: { width: number; height: number }) {
  return rect.width > 0 && rect.height > 0 && rect.bottom > 0 && rect.right > 0 && rect.top < viewport.height && rect.left < viewport.width;
}

type RawBox = { left: number; top: number; right: number; bottom: number };

/** Clip background box `box` around an occluding top-layer surface `occ` (modal dialog, open menu, overlay bubble). */
function subtractBox(box: RawBox, occ: RawBox): RawBox[] {
  if (box.right <= occ.left || box.left >= occ.right || box.bottom <= occ.top || box.top >= occ.bottom) return [box];
  const pieces: RawBox[] = [];
  if (box.top < occ.top) pieces.push({ left: box.left, top: box.top, right: box.right, bottom: occ.top });
  if (box.bottom > occ.bottom) pieces.push({ left: box.left, top: occ.bottom, right: box.right, bottom: box.bottom });
  const midTop = Math.max(box.top, occ.top);
  const midBottom = Math.min(box.bottom, occ.bottom);
  if (midBottom > midTop) {
    if (box.left < occ.left) pieces.push({ left: box.left, top: midTop, right: occ.left, bottom: midBottom });
    if (box.right > occ.right) pieces.push({ left: occ.right, top: midTop, right: box.right, bottom: midBottom });
  }
  return pieces.filter((p) => p.right - p.left > 2 && p.bottom - p.top > 2);
}

/**
 * Content strings and mask rects of the current page. `numbered` = the snapshot's interactive elements; their labels
 * count as UI (never pseudonymized as a whole) unless the element is a record link.
 */
export function collectPagePrivacy(numbered: HTMLElement[], labelOf: (element: HTMLElement) => string, isVisible: (element: HTMLElement) => boolean): PagePrivacy {
  const viewport = { width: innerWidth, height: innerHeight };
  const found = new Map<string, PrivacyTerm>();
  const rects: PrivacyRect[] = [];
  const masked = new Set<Element>();
  const isRecordLink = (element: Element) => {
    const anchor = element.closest("a[href]");
    return Boolean(anchor && !anchor.closest(UI_CONTAINER) && RECORD.test(anchor.getAttribute("href") ?? ""));
  };
  const uiLabels = new Set([
    ...PROTECTED_UI_TERMS,
    ...numbered.filter((element) => !isRecordLink(element)).map((element) => keyOf(labelOf(element))),
  ]);

  // Top-layer modal dialogs, open menus/dropdowns and Lotse's own bubble must never be painted over by background rects.
  const occluders: Array<{ el: Element; box: RawBox }> = [];
  const addOccluder = (el: Element | null | undefined) => {
    if (!el || !(el instanceof HTMLElement)) return;
    const style = getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return;
    const r = el.getBoundingClientRect();
    if (inViewport(r, viewport)) occluders.push({ el, box: { left: r.left, top: r.top, right: r.right, bottom: r.bottom } });
  };
  for (const dlg of document.querySelectorAll("dialog[open]")) addOccluder(dlg);
  for (const popup of document.querySelectorAll('.menu-popup:not([hidden]), .dropdown-panel:not([hidden]), [role="menu"]:not([hidden])')) addOccluder(popup);
  addOccluder(document.getElementById("lotse-overlay-host")?.shadowRoot?.querySelector(".bubble"));

  const pushRect = (sourceEl: Element, rect: DOMRect, text?: string) => {
    if (rects.length >= MAX_RECTS || !inViewport(rect, viewport)) return;
    let pieces: RawBox[] = [{
      left: Math.max(0, rect.left),
      top: Math.max(0, rect.top),
      right: Math.min(viewport.width, rect.right),
      bottom: Math.min(viewport.height, rect.bottom),
    }];
    for (const occ of occluders) {
      if (occ.el.contains(sourceEl)) continue;
      pieces = pieces.flatMap((piece) => subtractBox(piece, occ.box));
      if (!pieces.length) return;
    }
    for (const p of pieces) {
      if (rects.length >= MAX_RECTS) break;
      rects.push({ x: p.left, y: p.top, width: p.right - p.left, height: p.bottom - p.top, text: text?.slice(0, 80) });
    }
  };

  const mask = (element: Element, text?: string) => {
    if (masked.has(element) || rects.length >= MAX_RECTS || (element instanceof HTMLElement && !isVisible(element))) return;
    const rect = element.getBoundingClientRect();
    if (!inViewport(rect, viewport)) return;
    masked.add(element);
    pushRect(element, rect, text);
  };
  /** `weak` = only a guess (unknown column, short form): skipped when the same text is a UI label on this page. */
  const add = (text: string, kind: PseudonymKind, element?: Element, of?: string, weak = false) => {
    const value = clean(text);
    const key = keyOf(value);
    if (value.length < 3 || PROTECTED_UI_TERMS.has(key) || /^[\p{P}\p{S}\s]+$/u.test(value) || ((weak || of) && uiLabels.has(key)) || found.size >= 600) return;
    if (!found.has(key)) found.set(key, { text: value, kind: patternKind(value) ?? kind, of });
    if (element) mask(element, value);
  };
  const addValue = (text: string, header: string, element: Element) => {
    const value = clean(text);
    if (value.length < 3) return;
    const personal = /geburt|birth/i.test(header);
    if (!personal && (KEEP_HEADER.test(clean(header)) || DATE_VALUE.test(value) || AMOUNT_VALUE.test(value))) return;
    const href = element.querySelector("a[href]")?.getAttribute("href") ?? "";
    const kind = (RECORD.test(href) ? kindFromHint(href) ?? "Wert" : undefined) ?? kindFromHint(header) ?? (COMPANY.test(value) ? "Firma" : undefined);
    add(value, kind ?? "Wert", element, undefined, !kind && !patternKind(value));
  };

  // 1. Record links anywhere outside navigation (customer in a table, offer in a card list …).
  for (const anchor of document.querySelectorAll<HTMLAnchorElement>("a[href]")) {
    if (!isRecordLink(anchor) || !isVisible(anchor)) continue;
    add(labelOf(anchor), kindFromHint(anchor.getAttribute("href") ?? "") ?? "Wert", anchor);
  }
  // 2. Table bodies: every cell except categories, dates and amounts; the column header decides the kind.
  for (const table of document.querySelectorAll('table, [role="grid"], [role="table"]')) {
    if (table.closest(UI_CONTAINER)) continue;
    const headers = [...table.querySelectorAll('thead th, [role="columnheader"]')].map((cell) => clean(cell.textContent));
    for (const row of [...table.querySelectorAll('tbody tr, [role="row"]')].slice(0, 200)) {
      if (row.closest("thead")) continue;
      [...row.children].forEach((cell, index) => {
        if (!cell.matches('td, [role="cell"], [role="gridcell"]') || cell.getAttribute("colspan")) return;
        addValue(contentText(cell), headers[index] ?? "", cell);
      });
    }
  }
  // 3. Detail lists: <dt>Label</dt><dd>Wert</dd>.
  for (const value of document.querySelectorAll("dd")) {
    let term = value.previousElementSibling;
    while (term && term.tagName !== "DT") term = term.previousElementSibling;
    addValue(contentText(value), clean(term?.textContent), value);
  }
  // 4. Record headings, card titles & breadcrumb record spans.
  const where = location.pathname + location.search + location.hash;
  for (const heading of document.querySelectorAll<HTMLElement>("h1, h2, h3, [data-record-title], [class*='record-title'], [class*='card-title']")) {
    if (heading.closest(UI_CONTAINER) || !isVisible(heading)) continue;
    const greet = /^(?:Guten\s+(?:Morgen|Tag|Abend)|Hallo|Willkommen),?\s+(\p{Lu}[\p{L}'’-]{2,40})!?$/u.exec(clean(heading.textContent));
    if (greet?.[1]) { add(greet[1], "Person", heading); continue; }
    const named = /(?:customer|kunde|client|contact|kontakt|person|record|patient|offer|angebot|case|vorgang|card)[-_]?(?:name|title|heading)/i.test(heading.id + " " + heading.className) || heading.hasAttribute("data-record-title");
    const cardItem = Boolean(heading.matches("article h2, article h3, .card h3") && !heading.closest("form, dialog") && !heading.closest("article, .card")?.querySelector("table, form, dl"));
    if (!named && !cardItem && !(heading.tagName === "H1" && RECORD.test(where))) continue;
    add(contentText(heading), kindFromHint(heading.id + " " + location.pathname + location.hash) ?? "Wert", heading, undefined, cardItem);
  }
  for (const crumb of document.querySelectorAll<HTMLElement>('.breadcrumb span, [aria-label*="Brotkrumen"] span, [aria-label*="Breadcrumb"] span')) {
    if (!isVisible(crumb)) continue;
    const text = contentText(crumb);
    if (text && text !== "…" && !uiLabels.has(keyOf(text))) {
      add(text, kindFromHint(crumb.id + " " + location.pathname) ?? "Wert", crumb, undefined, true);
    }
  }
  // 5. The signed-in employee (top bar / account page) — also by first and last name, e.g. in "Guten Tag, Jana".
  for (const element of document.querySelectorAll('.user-name, .username, #account-name, .menu-info strong, [class*="user-name"], [class*="account-name"], [data-user-name]')) {
    const name = contentText(element);
    add(name, "Person", element);
    for (const part of name.split(" ")) if (part.length >= 3 && part !== name && /^\p{Lu}/u.test(part)) add(part, "Person", undefined, name);
  }
  for (const element of document.querySelectorAll('.avatar, [class*="avatar"]')) mask(element);
  // 6. Explicitly marked content: data-lotse-pii="Kunde" (any other value → Wert).
  for (const element of document.querySelectorAll<HTMLElement>("[data-lotse-pii]")) {
    add(contentText(element), KINDS.find((kind) => kind === element.dataset.lotsePii) ?? "Wert", element);
  }
  // 7. Entity <select> options (customer / person dropdowns) so typed names match even when filtered out.
  for (const select of [...document.querySelectorAll<HTMLSelectElement>("select")].slice(0, 30)) {
    if (select.closest("#lotse-overlay-host")) continue;
    const selectHint = clean(select.labels?.[0]?.textContent ?? select.getAttribute("aria-label"));
    const selectKind = kindFromHint(selectHint);
    if (selectKind !== "Kunde" && selectKind !== "Person" && selectKind !== "Firma") continue;
    for (const opt of [...select.options].slice(0, 80)) {
      const raw = clean(opt.textContent);
      if (!raw || !opt.value || /^(?:alle|bitte\s+wählen|–|--|keine\b)/i.test(raw)) continue;
      const stripped = clean(raw.replace(/\s*\([^)]*\)\s*$/, ""));
      add(stripped, selectKind, undefined, undefined, true);
    }
  }
  // Short forms: surname of a person, company name without its legal form — same token as the full value.
  for (const term of [...found.values()]) {
    if (term.of) continue;
    const words = term.text.split(" ");
    if (term.kind === "Person" && words.length >= 2 && words.length <= 3 && words.every((word) => /^\p{Lu}[\p{L}'’-]+$/u.test(word))) {
      const surname = words.at(-1)!;
      if (surname.length >= 4) add(surname, "Person", undefined, term.text);
    }
    const base = term.text.replace(/\s+(?:GmbH(?:\s*&\s*Co\.?\s*KG)?|gGmbH|AG|KGaA|KG|eG|e\.\s?V\.|SE|OHG|GbR|UG|mbB|mbH|Ltd\.?|Inc\.?|LLC)$/u, "");
    if (base !== term.text && base.length >= 5) add(base, term.kind, undefined, term.text);
  }

  // Masks without terms: entered values, private regions, free text holding a pattern or a known term.
  const fields = 'input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]):not([type="button"]):not([type="submit"]):not([type="reset"]), textarea, select, [contenteditable="true"], [data-lotse-private]';
  for (const element of document.querySelectorAll<HTMLElement>(fields)) {
    if (element.closest("#lotse-overlay-host")) continue;
    const empty = (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) && !element.value;
    if (!empty) mask(element);
  }
  const known = [...found.values()].map((term) => term.text.toLocaleLowerCase("de-DE"));
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  let visited = 0;
  for (let node = walker.nextNode(); node && visited < 3_000 && rects.length < MAX_RECTS; node = walker.nextNode()) {
    const text = clean(node.textContent);
    const parent = node.parentElement;
    if (text.length < 3 || !parent || masked.has(parent) || parent.closest("script, style, noscript, #lotse-overlay-host")) continue;
    visited++;
    const lower = text.toLocaleLowerCase("de-DE");
    if ((!hasPattern(text) && !known.some((term) => lower.includes(term))) || !isVisible(parent)) continue;
    const range = document.createRange();
    range.selectNodeContents(node);
    const rect = range.getBoundingClientRect();
    pushRect(parent, rect, text);
  }
  return { terms: [...found.values()], rects, viewport };
}

// ---------------------------------------------------------------------------
// Worker side: session mapping (chrome.storage.session — trusted extension contexts only)
// ---------------------------------------------------------------------------

type Stored = { v: 1; tokens: [string, string][]; values: [string, string][]; counters: Partial<Record<PseudonymKind, number>>; terms: PrivacyTerm[] };
const STORE_KEY = "lotse-pseudonyms";
const byKey = new Map<string, string>(); // normalized real value → token
const byToken = new Map<string, string>(); // token → real value (as first seen)
const counters: Partial<Record<PseudonymKind, number>> = {};
const terms = new Map<string, PrivacyTerm>(); // normalized term → term (insertion order = age)
const pagePrivacy = new Map<string, PagePrivacy[]>(); // snapshot id → its last privacy reports (for masks)
let termPattern: RegExp | null = null;
let loaded: Promise<void> | null = null;
let saveTimer: ReturnType<typeof setTimeout> | undefined;

function load() {
  loaded ??= browser.storage.session.get(STORE_KEY).then((result) => {
    const saved = result[STORE_KEY] as Partial<Stored> | undefined;
    if (!saved || saved.v !== 1) return;
    for (const [key, token] of saved.tokens ?? []) if (!byKey.has(key)) byKey.set(key, token);
    for (const [token, value] of saved.values ?? []) if (!byToken.has(token)) byToken.set(token, value);
    for (const kind of KINDS) counters[kind] = Math.max(counters[kind] ?? 0, saved.counters?.[kind] ?? 0);
    for (const term of saved.terms ?? []) if (!terms.has(keyOf(term.text))) terms.set(keyOf(term.text), term);
    termPattern = null;
  }, () => undefined);
  return loaded;
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    const stored: Stored = { v: 1, tokens: [...byKey], values: [...byToken], counters, terms: [...terms.values()] };
    void browser.storage.session.set({ [STORE_KEY]: stored }).catch(() => undefined);
  }, 500);
}

function canonicalKey(value: string, kind: PseudonymKind): string {
  if (kind === "IBAN") return value.replace(/[\s\u00A0]+/g, "").toUpperCase();
  if (kind === "Telefon") {
    const digits = value.replace(/[^\d+]/g, "");
    return digits.length >= 7 ? `tel:${digits}` : keyOf(value);
  }
  return keyOf(value);
}

/** Stable token for a real value; a value known from the page keeps the page's kind ("Kunde" beats a detected "Firma"). */
function tokenFor(value: string, kind: PseudonymKind): string {
  const term = terms.get(keyOf(value));
  const canonical = term?.of ?? term?.text ?? value; // display the value as the page shows it
  const key = keyOf(canonical);
  const finalKind = terms.get(key)?.kind ?? term?.kind ?? kind;
  const normLookup = canonicalKey(canonical, finalKind);
  const known = byKey.get(normLookup) ?? byKey.get(key);
  if (known) return known;
  if (byKey.size >= MAX_TOKENS) return `[${finalKind}-0]`; // mapping full: still never the real value
  const n = (counters[finalKind] = (counters[finalKind] ?? 0) + 1);
  const token = `[${finalKind}-${n}]`;
  byKey.set(key, token);
  if (normLookup !== key) byKey.set(normLookup, token);
  byToken.set(token, clean(canonical));
  scheduleSave();
  return token;
}

function registerTerm(term: PrivacyTerm) {
  if (!term || typeof term.text !== "string" || !KINDS.includes(term.kind)) return;
  const text = clean(term.text).slice(0, 160);
  if (text.length < 3 || TOKEN_SPLIT.test(text)) {
    TOKEN_SPLIT.lastIndex = 0;
    return;
  }
  const key = keyOf(text);
  if (PROTECTED_UI_TERMS.has(key)) return;
  const of = typeof term.of === "string" ? clean(term.of).slice(0, 160) : undefined;
  const existing = terms.get(key);
  if (existing && existing.kind === term.kind && existing.of === of) return;
  if (existing && !existing.of && of) return; // a full value never becomes someone else's short form
  terms.delete(key);
  terms.set(key, { text, kind: term.kind, of });
  while (terms.size > MAX_TERMS) terms.delete(terms.keys().next().value!);
  termPattern = null;
  scheduleSave();
}

/** One alternation over all known terms, longest first, matched on word boundaries (case-insensitive). */
function pattern(): RegExp | null {
  if (termPattern || !terms.size) return termPattern;
  const sources = [...terms.keys()].sort((a, b) => b.length - a.length)
    .map((key) => key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/ /g, "\\s+"));
  termPattern = new RegExp(`(?<![\\p{L}\\p{N}])(?:${sources.join("|")})(?![\\p{L}\\p{N}])`, "giu");
  return termPattern;
}

function mapUntokenized(input: string, fn: (segment: string) => string): string {
  const parts = input.split(TOKEN_SPLIT);
  if (parts.length === 1) return fn(input);
  return parts.map((part) => (TOKEN_EXACT.test(part) ? part : fn(part))).join("");
}

function applyDetectors(text: string, late: boolean): string {
  let out = text;
  for (const detector of DETECTORS) {
    if (Boolean(detector.late) !== late) continue;
    out = mapUntokenized(out, (segment) =>
      segment.replace(detector.re, (match: string, ...groups: unknown[]) => {
        if (detector.guard && !detector.guard(match, groups)) return match;
        if (!detector.group) return tokenFor(match, detector.kind);
        const name = groups[detector.group - 1];
        return typeof name === "string" ? match.replace(name, tokenFor(name, detector.kind)) : match;
      }),
    );
  }
  return out;
}

/**
 * Real text → text with tokens (idempotent: existing `[Kind-n]` placeholders are never altered).
 * A string at a server field limit (snapshot messages: 160, question: 500) stays within it: the result is at most
 * max(input length, 160) characters; a cut token is dropped, never sent half.
 */
export function pseudonymizeText(text: string): string {
  if (!text) return text;
  const known = pattern();
  let out = mapUntokenized(text, (segment) => applyDetectors(segment, false));
  if (known) out = mapUntokenized(out, (segment) => segment.replace(known, (match) => tokenFor(match, "Wert")));
  out = mapUntokenized(out, (segment) => applyDetectors(segment, true));
  const limit = Math.max(text.length, 160);
  if (out.length > limit) out = out.slice(0, limit).replace(/\[[^\]]*$/, "").trimEnd();
  return out;
}

/** Keys whose string values are ids, routes, enums or image data — never rewritten (a digit run in base64 is not a number). */
const RAW_KEY = /^(?:id|.*Id|appHost|route|dataUrl|type|role|elementRole|source|model|trigger|feedback|kind|rule|severity|code|tier)$/;

function mapStrings(value: unknown, fn: (text: string) => string, key = ""): unknown {
  if (typeof value === "string") return RAW_KEY.test(key) ? value : fn(value);
  if (Array.isArray(value)) return value.map((item) => mapStrings(item, fn, key));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, mapStrings(v, fn, k)]));
  return value;
}

/** Learn the content strings a content script sent with a snapshot (`privacy`); keeps its rects for `maskFrame`. */
export async function learn(snapshot: unknown): Promise<void> {
  if (!snapshot || typeof snapshot !== "object") return;
  const { id, privacy } = snapshot as { id?: unknown; privacy?: Partial<PagePrivacy> };
  if (!privacy || typeof privacy !== "object") return;
  const viewport = privacy.viewport;
  if (typeof id === "string" && Array.isArray(privacy.rects) && viewport && viewport.width > 0 && viewport.height > 0) {
    const rects = privacy.rects.filter((r) => r && [r.x, r.y, r.width, r.height].every(Number.isFinite)).slice(0, MAX_RECTS);
    const reports = [...(pagePrivacy.get(id) ?? []), { terms: [], rects, viewport }].slice(-2);
    pagePrivacy.delete(id);
    pagePrivacy.set(id, reports);
    while (pagePrivacy.size > 8) pagePrivacy.delete(pagePrivacy.keys().next().value!);
  }
  await load();
  for (const term of Array.isArray(privacy.terms) ? privacy.terms.slice(0, 600) : []) registerTerm(term);
}

/** Content strings from another capture path (e.g. the exploration crawler's `collectPagePrivacy()`). */
export async function learnPrivacy(privacy: PagePrivacy): Promise<void> {
  await load();
  for (const term of privacy.terms.slice(0, 600)) registerTerm(term);
}

/** Deep copy of a request body with every user-facing string pseudonymized. Call right before it leaves the browser. */
export async function pseudonymize<T>(body: T): Promise<T> {
  await load();
  return mapStrings(body, pseudonymizeText) as T;
}

/** Exploration page maps (D-25): labels, headings and click paths with tokens. Learn the pages' terms first. */
export async function pseudonymizeExploredPages(pages: ExploredPage[]): Promise<ExploredPage[]> {
  return pseudonymize(pages);
}

/** Tokens back to the real values for display (overlay, side panel, plan steps). Unknown tokens stay as they are. */
export function reidentifyText(text: string): string {
  return text.replace(TOKEN, (token) => byToken.get(token) ?? token);
}

export function reidentify<T>(value: T): T {
  return mapStrings(value, reidentifyText) as T;
}

/** For text-to-speech on the server: tokens are read as "Kunde 1" — the real name never goes to /api/lotse/tts. */
export async function spokenText(text: string): Promise<string> {
  await load();
  return pseudonymizeText(text).replace(TOKEN, (_token, kind: string, n: string) => `${kind} ${n}`);
}

// ---------------------------------------------------------------------------
// Worker side: paint content regions over before a frame is buffered (OffscreenCanvas)
// ---------------------------------------------------------------------------

function dataUrlToBlob(dataUrl: string): Blob {
  const comma = dataUrl.indexOf(",");
  const type = /^data:([^;,]+)/.exec(dataUrl)?.[1] ?? "image/jpeg";
  const binary = atob(dataUrl.slice(comma + 1));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

/**
 * Paints the content rects of `snapshotId` (union of its last two reports, in case the page scrolled) over the frame
 * and labels each box with its token. Throws without a privacy report — the caller then drops the frame (fail closed).
 */
export async function maskFrame(dataUrl: string, snapshotId: string): Promise<string> {
  const reports = pagePrivacy.get(snapshotId);
  if (!reports?.length) throw new Error("Kein Datenschutz-Bericht für dieses Bild.");
  await load();
  const bitmap = await createImageBitmap(dataUrlToBlob(dataUrl));
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Bildmaske nicht verfügbar.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  for (const { rects, viewport } of reports) {
    const sx = canvas.width / viewport.width;
    const sy = canvas.height / viewport.height;
    for (const rect of rects) {
      const x = Math.floor(rect.x * sx) - 2, y = Math.floor(rect.y * sy) - 2;
      const w = Math.ceil(rect.width * sx) + 4, h = Math.ceil(rect.height * sy) + 4;
      context.fillStyle = "#c9ced6";
      context.fillRect(x, y, w, h);
      const tokens = rect.text ? pseudonymizeText(rect.text).match(TOKEN) : null;
      if (!tokens || h < 12 * sy) continue;
      context.fillStyle = "#3c4450";
      context.font = `${Math.round(Math.min(h * 0.6, 13 * sy))}px sans-serif`;
      context.textBaseline = "middle";
      context.fillText(tokens.join(" "), x + 4 * sx, y + h / 2, Math.max(w - 8 * sx, 1));
    }
  }
  return blobToDataUrl(await canvas.convertToBlob({ type: "image/jpeg", quality: 0.5 }));
}
