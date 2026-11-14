/**
 * Live DOM content & bounding-box scanner (content script only, D-26):
 * 1. Collects page content strings (table cells, `<dd>` values, record headings, card titles, user badges — never UI
 *    control labels) for the session-wide browser pseudonym dictionary.
 * 2. Collects viewport rectangles of content elements so `redactScreenshot` paints over content areas before upload
 *    while preserving interactive UI controls, table headers, field labels and open dialogs/menus.
 */
import type { PseudonymKind } from "@lotse/shared";
import { STATIC_UI_TERMS, type PagePrivacyPayload, type PseudonymEntry, type RectBox } from "./pseudonymize";

const HOST_ID = "lotse-overlay-host";
const GENERIC_LINK_LABELS = new Set([
  "öffnen", "oeffnen", "details", "anzeigen", "bearbeiten", "löschen", "loeschen", "entfernen", "zum kunden",
  "zurück", "zurueck", "weiter", "alle anzeigen", "mehr", "download", "herunterladen", "ansehen",
]);
const PLACEHOLDER_OPTION_RE = /^(?:alle|bitte\s+wählen|–|--|keine\b|auswählen)/i;
const TEXTUAL_INPUT_TYPES = new Set(["text", "search", "email", "tel", "url", "number", "password", "date", "datetime-local", "month", "week", "time"]);

type ColumnClass = PseudonymKind | "skip" | "unknown";

function clean(text: string | null | undefined): string {
  return (text ?? "").replace(/[\s\u00A0]+/g, " ").trim();
}

function norm(text: string): string {
  return clean(text).toLocaleLowerCase("de-DE");
}

function isLotse(node: Element): boolean {
  return Boolean(node.closest("#" + HOST_ID));
}

function isRendered(el: Element): el is HTMLElement {
  if (!(el instanceof HTMLElement) || isLotse(el) || el.closest("[hidden], [inert]")) return false;
  const rect = el.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return getComputedStyle(el).visibility !== "hidden";
}

/** Classify a table `<th>` or `<dt>` / `<label>` field name into a `PseudonymKind` (or `"skip"` for UI enums/metrics). */
function classifyHeader(rawHeader: string, context: { customerPage: boolean; nonPersonTable: boolean }): ColumnClass {
  const h = norm(rawHeader).replace(/[:*]/g, "").trim();
  if (!h) return "unknown";

  if (/^(?:status|priorität|prioritaet|branche|kategorie|rolle|rollen|berechtigungen|größe|groesse|betrag(?:\b|$)|umsatz(?:\b|$)|menge|einzelpreis|preis|rabatt|summe|monatlich|erstellt|fällig|faellig|gültig|gueltig|beginn|kündigungsfrist|kuendigungsfrist|aktionen|aktion|erledigt|kundenportal|sprache|zeitzone|datumsformat|kanal|wiederholung|zahlungsart|zahlungsziel|zuletzt\s+verwendet|läuft\s+ab)$/.test(h)) {
    return "skip";
  }
  if (/\b(?:iban|bankverbindung|kontonummer)\b/.test(h)) return "IBAN";
  if (/\b(?:e-mail|email|mail)\b/.test(h)) return "E-Mail";
  if (/\b(?:telefon|tel\.?|mobil|handy|rufnummer|fax|phone|mobile)\b/.test(h)) return "Telefon";
  if (/\b(?:adresse|anschrift|straße|strasse|wohnort|address|street)\b/.test(h)) return "Adresse";
  if (/\b(?:kunde|kunden|kundenname|mandant|auftraggeber|kontoinhaber|customer|client|account)\b/.test(h)) return "Kunde";
  if (/\b(?:firma|firmenname|unternehmen|organisation|gesellschaft|bank|kreditinstitut|lieferant|partner|einrichtung|company|organization)\b/.test(h)) {
    return context.customerPage && h === "firma" ? "Kunde" : "Firma";
  }
  if (h === "name") {
    return context.nonPersonTable ? "Wert" : "Person";
  }
  if (/\b(?:person|vorname|nachname|familienname|ansprechpartner|kontakt|hauptkontakt|betreuer|zuständig|zustaendig|bearbeiter|mitarbeiter|benutzer|nutzer|autor|ersteller|von|inhaber|empfänger|empfaenger|vertretung(?:\s+durch)?|bewerber|teilnehmer|studierende|student|patient|antragsteller|owner|assignee|contact|author)\b/.test(h)) {
    return "Person";
  }
  if (/\b(?:aufgabe|titel|betreff|vorgang|projekt|vertrag|datei|dateiname|dokument|nr\.?|nummer|aktenzeichen|referenz|token|bezeichnung|bic)\b/.test(h)) {
    return "Wert";
  }
  return "unknown";
}

/** Collect all genuine UI control labels on the page so UI labels never enter the content dictionary. */
function collectUiLabels(doc: Document): Set<string> {
  const labels = new Set<string>(STATIC_UI_TERMS);
  const add = (value: string | null | undefined) => {
    const c = norm(value ?? "");
    if (c && c.length <= 120) labels.add(c);
  };

  for (const el of [...doc.querySelectorAll<HTMLElement>("nav a, nav button, header a, [role='navigation'] a, .breadcrumb a, th, dt, legend, summary")].slice(0, 250)) {
    if (isLotse(el)) continue;
    add(el.getAttribute("aria-label") || el.textContent);
  }
  for (const el of [...doc.querySelectorAll<HTMLElement>("button, [role='button'], [role='tab'], [role='menuitem'], input[type='submit'], input[type='button'], input[type='reset']")].slice(0, 300)) {
    if (isLotse(el)) continue;
    // Prefer explicit aria-label (e.g. "Benutzermenü") so embedded user names inside a profile button don't count as UI labels.
    const aria = el.getAttribute("aria-label");
    if (aria) add(aria);
    else add(el.textContent);
  }
  for (const label of [...doc.querySelectorAll<HTMLLabelElement>("label")].slice(0, 200)) {
    if (isLotse(label) || label.closest("td, ul.list li")) continue;
    add(label.textContent);
  }
  return labels;
}

/** Extract visible text of an element while ignoring child buttons, menus and status badges. */
function cleanCellText(el: HTMLElement): string {
  if (!el.querySelector("button, [role='button'], [role='menu'], .badge, .sr-only, .overdue")) {
    return clean(el.innerText || el.textContent);
  }
  const clone = el.cloneNode(true) as HTMLElement;
  for (const junk of clone.querySelectorAll("button, [role='button'], [role='menu'], .badge, .sr-only, .overdue, svg")) {
    junk.remove();
  }
  return clean(clone.textContent);
}

function classifyRecordHref(href: string): PseudonymKind | null {
  const low = href.toLowerCase();
  if (/(?:kunde|customer|client|mandant|account)(?:\.html)?[?#/=]/.test(low)) return "Kunde";
  if (/(?:person|contact|user|mitarbeiter|bewerber|patient|student)(?:\.html)?[?#/=]/.test(low)) return "Person";
  if (/(?:firma|company|org)(?:\.html)?[?#/=]/.test(low)) return "Firma";
  if (/(?:angebot|offer|aufgabe|task|vertrag|contract|projekt)(?:\.html)?[?#/=]/.test(low)) return "Wert";
  return null;
}

type RawBox = { left: number; top: number; right: number; bottom: number };

function toViewportBox(rect: DOMRect, vw: number, vh: number, inset = 0): RawBox | null {
  const left = Math.max(0, rect.left + inset);
  const top = Math.max(0, rect.top + inset);
  const right = Math.min(vw, rect.right - inset);
  const bottom = Math.min(vh, rect.bottom - inset);
  if (right - left <= 2 || bottom - top <= 2) return null;
  return { left, top, right, bottom };
}

/** Subtract an occluding floating layer `occ` (modal dialog, open menu, Lotse bubble) from background box `box`. */
function subtractBox(box: RawBox, occ: RawBox): RawBox[] {
  if (box.right <= occ.left || box.left >= occ.right || box.bottom <= occ.top || box.top >= occ.bottom) {
    return [box];
  }
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

export function collectPagePrivacy(doc: Document = document): PagePrivacyPayload {
  const vw = window.innerWidth || doc.documentElement.clientWidth || 1280;
  const vh = window.innerHeight || doc.documentElement.clientHeight || 800;
  const uiLabels = collectUiLabels(doc);
  const entries: PseudonymEntry[] = [];
  const seenEntries = new Set<string>();
  const customerPage = doc.body?.getAttribute("data-page") === "kunden" || /\/kunden?(?:\.html|\/|$)/i.test(location.pathname);

  const pushEntry = (rawValue: string | null | undefined, kind: PseudonymKind, aliases?: string[]) => {
    const value = clean(rawValue);
    if (!value || value.length < 3 || value.length > 160 || value === "…" || value === "–") return;
    const key = norm(value);
    if (uiLabels.has(key) || STATIC_UI_TERMS.has(key)) return;
    const dedupe = `${kind}:${key}`;
    if (seenEntries.has(dedupe)) return;
    seenEntries.add(dedupe);
    entries.push(aliases?.length ? { value, kind, aliases } : { value, kind });
  };

  // 1. Logged-in user & profile displays
  for (const el of doc.querySelectorAll<HTMLElement>(".user-name, [data-user-name], #account-name, .menu-info strong")) {
    if (isLotse(el)) continue;
    pushEntry(el.textContent, "Person");
  }

  // 2. Greeting headings (e.g. "Guten Tag, Jana")
  for (const h of doc.querySelectorAll<HTMLElement>("h1, h2")) {
    if (isLotse(h)) continue;
    const text = clean(h.textContent);
    const greet = /^(?:Guten\s+(?:Morgen|Tag|Abend)|Hallo|Willkommen),?\s+([A-ZÄÖÜ][\p{L}' -]{2,40})!?$/u.exec(text);
    if (greet?.[1]) pushEntry(greet[1], "Person");
  }

  // 3. Tables: header-guided cell extraction
  for (const table of [...doc.querySelectorAll<HTMLTableElement>("table")].slice(0, 25)) {
    if (isLotse(table)) continue;
    const sectionTitle = norm(table.closest("section, dialog")?.querySelector("h2, h3")?.textContent ?? "");
    const nonPersonTable = /\b(?:token|api|datei|dokument|ansicht)\b/.test(sectionTitle);
    const headers = [...table.querySelectorAll<HTMLTableCellElement>("thead th, tr:first-child th")].map((th) =>
      classifyHeader(th.textContent ?? "", { customerPage, nonPersonTable }),
    );
    const rows = [...table.querySelectorAll<HTMLTableRowElement>("tbody tr")].slice(0, 120);
    for (const row of rows) {
      if (row.classList.contains("empty-row") || row.hidden) continue;
      const cells = [...row.cells];
      for (let idx = 0; idx < cells.length; idx++) {
        const cell = cells[idx]!;
        if (cell.tagName.toLowerCase() === "th") continue;
        const colKind = headers[idx] ?? "unknown";

        // Check links inside the cell first (e.g. <a href="kunde.html?id=...">Müller Logistik GmbH</a>)
        for (const link of cell.querySelectorAll<HTMLAnchorElement>("a[href]")) {
          const linkText = clean(link.textContent);
          if (!linkText || GENERIC_LINK_LABELS.has(norm(linkText))) continue;
          const hrefKind = classifyRecordHref(link.getAttribute("href") ?? "");
          if (hrefKind) pushEntry(linkText, hrefKind);
          else if (colKind !== "skip" && colKind !== "unknown") pushEntry(linkText, colKind);
        }

        if (colKind === "skip" || colKind === "unknown") continue;
        const text = cleanCellText(cell);
        if (text) pushEntry(text, colKind);
      }
    }
  }

  // 4. Definition lists (<dl><dt>Label</dt><dd>Value</dd></dl>)
  for (const dl of [...doc.querySelectorAll<HTMLDListElement>("dl")].slice(0, 30)) {
    if (isLotse(dl)) continue;
    let currentKind: ColumnClass = "unknown";
    for (const child of [...dl.children]) {
      const tag = child.tagName.toLowerCase();
      if (tag === "dt") {
        currentKind = classifyHeader(child.textContent ?? "", { customerPage, nonPersonTable: false });
      } else if (tag === "dd" && child instanceof HTMLElement && currentKind !== "skip" && currentKind !== "unknown") {
        const rawLines = (child.innerText || child.textContent || "")
          .split(/\n+/)
          .map((line) => clean(line))
          .filter(Boolean);
        const full = rawLines.join(" ");
        if (currentKind === "Adresse" && rawLines.length > 1) {
          pushEntry(full, "Adresse", rawLines);
          for (const line of rawLines) pushEntry(line, "Adresse");
        } else {
          pushEntry(full, currentKind);
        }
      }
    }
  }

  // 5. Record links outside tables (e.g. dashboard tasks/activities linking to `kunde.html?id=...`)
  for (const link of [...doc.querySelectorAll<HTMLAnchorElement>("main a[href], dialog a[href]")].slice(0, 200)) {
    if (isLotse(link) || link.closest("nav, .breadcrumb")) continue;
    const text = clean(link.textContent);
    if (!text || GENERIC_LINK_LABELS.has(norm(text))) continue;
    const hrefKind = classifyRecordHref(link.getAttribute("href") ?? "");
    if (hrefKind) pushEntry(text, hrefKind);
  }

  // 6. Task & timeline list items (e.g. dashboard tasks, activity authors)
  for (const item of [...doc.querySelectorAll<HTMLElement>("ul.list li")].slice(0, 120)) {
    if (isLotse(item)) continue;
    const checkboxLabel = item.querySelector<HTMLLabelElement>("label[for]");
    if (checkboxLabel) pushEntry(checkboxLabel.textContent, "Wert");
    for (const meta of item.querySelectorAll<HTMLElement>(".meta")) {
      const parts = (meta.textContent ?? "").split("·").map((p) => clean(p));
      for (const part of parts) {
        if (/^[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?\s+[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)?$/u.test(part)) {
          pushEntry(part, "Person");
        }
      }
    }
  }

  // 7. Breadcrumb leaf, document title prefix & record/card headings
  const crumbContext = norm(doc.querySelector(".breadcrumb, [aria-label*='Brotkrumen'], [aria-label*='Breadcrumb']")?.textContent ?? "");
  const crumbKind: PseudonymKind = /\bkunden?\b/.test(crumbContext) || customerPage ? "Kunde" : "Wert";
  for (const span of doc.querySelectorAll<HTMLElement>(".breadcrumb span, [aria-label*='Brotkrumen'] span, [aria-label*='Breadcrumb'] span")) {
    if (isLotse(span)) continue;
    pushEntry(span.textContent, crumbKind);
  }

  const titlePrefix = clean(doc.title.split(/\s+[–—|-]\s+/)[0]);
  if (titlePrefix && titlePrefix !== clean(doc.title)) {
    pushEntry(titlePrefix, customerPage ? "Kunde" : "Wert");
  }

  for (const recordHeading of doc.querySelectorAll<HTMLElement>("#customer-name, #offer-heading, [data-record-title], [class*='record-title'], [class*='card-title']")) {
    if (isLotse(recordHeading)) continue;
    const text = clean(recordHeading.textContent);
    const parts = text.split(/\s+·\s+/).map((p) => clean(p)).filter(Boolean);
    const kind: PseudonymKind = recordHeading.id === "customer-name" || customerPage ? "Kunde" : "Wert";
    pushEntry(text, kind, parts.length > 1 ? parts : undefined);
    for (const part of parts) pushEntry(part, kind);
  }

  // Repeating record cards (e.g. card grids of customers/cases/people without tables or forms inside)
  for (const cardHeading of [...doc.querySelectorAll<HTMLElement>("article h2, article h3, .card h3")].slice(0, 80)) {
    if (isLotse(cardHeading) || cardHeading.closest("form, dialog")) continue;
    const card = cardHeading.closest("article, .card");
    if (!card || card.querySelector("table, form, dl")) continue;
    pushEntry(cardHeading.textContent, customerPage ? "Kunde" : "Wert");
  }

  // 8. Entity <select> dropdown options (customers, assignees, deputies) so typed names match even when filtered out
  for (const select of [...doc.querySelectorAll<HTMLSelectElement>("select")].slice(0, 40)) {
    if (isLotse(select)) continue;
    const labelText = select.labels?.[0]?.textContent ?? select.getAttribute("aria-label") ?? "";
    const kind = classifyHeader(labelText, { customerPage, nonPersonTable: false });
    if (kind !== "Kunde" && kind !== "Person" && kind !== "Firma") continue;
    for (const opt of [...select.options].slice(0, 100)) {
      const raw = clean(opt.textContent);
      if (!raw || !opt.value || PLACEHOLDER_OPTION_RE.test(raw)) continue;
      // Strip role annotations like "Tobias Krüger (Vertrieb)" → "Tobias Krüger"
      const stripped = clean(raw.replace(/\s*\([^)]*\)\s*$/, ""));
      pushEntry(stripped, kind, stripped !== raw ? [raw] : undefined);
    }
  }

  // -------------------------------------------------------------------------
  // Content bounding boxes for screenshot painting
  // -------------------------------------------------------------------------
  const topModal = [...doc.querySelectorAll<HTMLDialogElement>("dialog[open]")].filter(isRendered).at(-1) ?? null;
  const openPopups = [...doc.querySelectorAll<HTMLElement>(".menu-popup:not([hidden]), .dropdown-panel:not([hidden]), [role='menu']:not([hidden])")].filter(isRendered);

  const occluders: Array<{ el: HTMLElement; box: RawBox }> = [];
  if (topModal) {
    const b = toViewportBox(topModal.getBoundingClientRect(), vw, vh, 0);
    if (b) occluders.push({ el: topModal, box: b });
  }
  for (const popup of openPopups) {
    const b = toViewportBox(popup.getBoundingClientRect(), vw, vh, 0);
    if (b) occluders.push({ el: popup, box: b });
  }
  const lotseHost = doc.getElementById(HOST_ID);
  const lotseBubble = lotseHost?.shadowRoot?.querySelector<HTMLElement>(".bubble");
  if (lotseBubble) {
    const style = getComputedStyle(lotseBubble);
    if (style.display !== "none" && style.visibility !== "hidden") {
      const b = toViewportBox(lotseBubble.getBoundingClientRect(), vw, vh, -2);
      if (b) occluders.push({ el: lotseBubble, box: b });
    }
  }

  const rawBoxes: RawBox[] = [];
  const addMaskElement = (el: Element | null, inset = 1) => {
    if (!el || !isRendered(el)) return;
    const initial = toViewportBox(el.getBoundingClientRect(), vw, vh, inset);
    if (!initial) return;
    let pieces = [initial];
    for (const occ of occluders) {
      if (occ.el.contains(el)) continue;
      pieces = pieces.flatMap((piece) => subtractBox(piece, occ.box));
      if (!pieces.length) return;
    }
    rawBoxes.push(...pieces);
  };

  // Table body cells: preserve action buttons/checkboxes/inputs, paint over data content
  for (const cell of [...doc.querySelectorAll<HTMLElement>("tbody td, [role='rowgroup'] [role='cell'], [role='gridcell']")].slice(0, 250)) {
    if (!isRendered(cell)) continue;
    const parentRow = cell.closest("tr");
    if (parentRow?.classList.contains("empty-row")) continue;
    const hasControl = Boolean(cell.querySelector("button, [role='button'], input, select, textarea"));
    if (!hasControl) {
      if (clean(cell.textContent)) addMaskElement(cell, 2);
    } else {
      for (const child of cell.querySelectorAll<HTMLElement>("a[href], span:not(.sr-only), strong")) {
        if (child.closest("button, [role='button']")) continue;
        if (clean(child.textContent)) addMaskElement(child, 0);
      }
    }
  }

  // Definition values (<dd>)
  for (const dd of [...doc.querySelectorAll<HTMLElement>("dd")].slice(0, 120)) {
    if (clean(dd.textContent)) addMaskElement(dd, 1);
  }

  // Record headings, breadcrumbs, user identity, greetings, lists/timelines, private blocks
  const contentSelectors = [
    "#customer-name", "#customer-sub", "#crumb-name", "#offer-heading", "#offer-sub", "#crumb-number",
    ".user-name", ".avatar", "#account-name", ".menu-info", ".signature-preview", ".token-box", "#tfa-codes",
    "[data-lotse-private]", "[data-record-title]", "[class*='record-title']", "[class*='card-title']",
    ".timeline li", ".notification-list li", "#today-tasks label", "#today-tasks .meta",
    "#greeting", "#deputy-summary", "#cancel-contract-info", "#cancel-confirm-text", "#delete-text", "#token-confirm-text",
  ].join(", ");
  for (const el of [...doc.querySelectorAll<HTMLElement>(contentSelectors)].slice(0, 160)) {
    if (clean(el.textContent)) addMaskElement(el, 1);
  }

  // Non-UI breadcrumb spans
  for (const span of doc.querySelectorAll<HTMLElement>(".breadcrumb span, [aria-label*='Brotkrumen'] span, [aria-label*='Breadcrumb'] span")) {
    const t = norm(span.textContent ?? "");
    if (t && !uiLabels.has(t)) addMaskElement(span, 0);
  }

  // Filled text inputs, textareas and entity selects (inset by 4px so borders, focus rings & validation states remain visible)
  const knownEntityValues = new Set(entries.map((e) => norm(e.value)));
  for (const control of [...doc.querySelectorAll<HTMLElement>("input, textarea, select")].slice(0, 120)) {
    if (!isRendered(control)) continue;
    if (control instanceof HTMLInputElement) {
      const type = (control.type || "text").toLowerCase();
      if (TEXTUAL_INPUT_TYPES.has(type) && control.value.trim().length > 0) addMaskElement(control, 4);
    } else if (control instanceof HTMLTextAreaElement) {
      if (control.value.trim().length > 0) addMaskElement(control, 4);
    } else if (control instanceof HTMLSelectElement) {
      const selected = clean(control.selectedOptions[0]?.textContent);
      const stripped = clean(selected.replace(/\s*\([^)]*\)\s*$/, ""));
      if (selected && (knownEntityValues.has(norm(selected)) || knownEntityValues.has(norm(stripped)))) {
        addMaskElement(control, 4);
      }
    }
  }

  const rects: RectBox[] = rawBoxes.slice(0, 300).map((b) => ({
    x: Math.round(b.left),
    y: Math.round(b.top),
    width: Math.round(b.right - b.left),
    height: Math.round(b.bottom - b.top),
  }));

  return { entries, rects, viewport: { width: vw, height: vh } };
}
