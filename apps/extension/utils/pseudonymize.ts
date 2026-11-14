/**
 * Browser-side pseudonymization (D-26): personal and record data on the page and in user input are replaced with
 * session-stable placeholders (`[Kunde-1]`, `[Person-2]`, `[IBAN-1]`, …) BEFORE anything leaves the browser.
 * The bidirectional mapping stays strictly in the browser session; server responses are translated back before display,
 * and content regions on screenshots are painted over before upload.
 *
 * Honest scope: pseudonymized, not anonymous — freely typed names that never appeared on the page are only caught
 * when they match patterns (e.g. "Herr/Frau <Name>", company legal suffix, IBAN, e-mail, phone, street + number).
 */
import {
  PSEUDONYM_KINDS,
  PSEUDONYM_TOKEN,
  pseudonym,
  type AskResponse,
  type DecideResponse,
  type GuidanceEvent,
  type InferredIntent,
  type LotseEvent,
  type ObservationSnapshot,
  type PageSnapshot,
  type PseudonymKind,
  type WorkflowIntent,
} from "@lotse/shared";

export type PseudonymEntry = {
  value: string;
  kind: PseudonymKind;
  aliases?: string[];
};

export type RectBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type ViewportSize = {
  width: number;
  height: number;
};

export type PagePrivacyPayload = {
  entries: PseudonymEntry[];
  rects: RectBox[];
  viewport: ViewportSize;
};

type StoredEntry = {
  token: string;
  kind: PseudonymKind;
  canonical: string;
  caseSensitive?: boolean;
};

export type SerializedPseudonymSession = {
  version: 1;
  counters: Partial<Record<PseudonymKind, number>>;
  forward: Array<[string, StoredEntry]>;
  reverse: Array<[string, string]>;
};

const MAX_DICTIONARY_ENTRIES = 2_000;
const MAX_COUNTER = 9_999;

/** Generic German/English UI terms, roles, statuses and categories that must never be turned into placeholders. */
export const STATIC_UI_TERMS = new Set([
  "lotse", "kundenwerk", "kundenwerk crm", "crm", "corpus", "dashboard", "startseite", "übersicht", "uebersicht",
  "kunden", "kunde", "aufgaben", "aufgabe", "angebote", "angebot", "verträge", "vertraege", "vertrag",
  "dokumente", "dokument", "einstellungen", "verwaltung", "benutzer", "benutzer & rollen", "import/export",
  "import", "export", "mein konto", "konto", "profil", "sicherheit", "benachrichtigungen", "abwesenheit",
  "vertretung", "signatur", "e-mail-signatur", "api-zugang", "allgemein", "abrechnung", "integrationen",
  "ansprechpartner", "zahlungsdaten", "verlauf", "stammdaten", "auf einen blick", "kennzahlen",
  "meine aufgaben heute", "letzte aktivitäten", "offene angebote", "positionen", "details", "statusverlauf",
  "zusammenfassung", "unternehmen", "rechnungsstellung", "steuern", "mahnwesen", "rollenrechte", "vorschau",
  "aktive sitzungen", "person", "kontakt", "regionales", "darstellung", "befehlspalette", "suchergebnisse",
  "aktiv", "inaktiv", "interessent", "interessenten", "entwurf", "zur freigabe", "freigegeben", "versendet",
  "angenommen", "abgelehnt", "gekündigt", "gekuendigt", "widerrufen", "offen", "erledigt", "alle", "keine",
  "hoch", "mittel", "niedrig", "täglich", "wöchentlich", "monatlich", "quartalsweise", "sichtbar", "nie",
  "ja", "nein", "unbekannt", "sonstiges", "standard", "kompakt", "mit logo", "lesen", "lesen und schreiben",
  "deutsch", "english", "français", "überweisung", "lastschrift", "e-mail", "in-app", "e-mail und in-app",
  "vertrieb", "vertriebsleitung", "buchhaltung", "admin", "sachbearbeitung", "geschäftsführer", "geschaeftsfuehrer",
  "inhaber", "partner", "partnerin", "vorstand", "projektleitung", "disposition", "instandhaltung",
  "speichern", "abbrechen", "weiter", "zurück", "fertig", "schließen", "löschen", "entfernen", "kündigen",
  "bearbeiten", "hinzufügen", "anlegen", "erstellen", "suchen", "filtern", "übernehmen", "verwerfen",
  "freigeben", "zurückweisen", "versenden", "duplizieren", "hochladen", "aktivieren", "deaktivieren", "abmelden",
  "keine ergebnisse", "fehler", "hinweis", "anruf", "termin", "notiz", "änderung", "korrespondenz", "rechnung",
]);

const NON_NAME_NOUNS = new Set([
  "konto", "iban", "bic", "bank", "bankverbindung", "zahlungsdaten", "vertrag", "verträge", "angebot", "angebote",
  "aufgabe", "aufgaben", "rechnung", "rechnungen", "adresse", "anschrift", "telefon", "telefonnummer", "mobil",
  "mail", "termin", "notiz", "status", "rolle", "dokument", "dokumente", "kunde", "kunden", "firma", "unternehmen",
  "ansprechpartner", "übersicht", "verlauf", "profil", "passwort", "signatur", "abwesenheit", "vertretung",
  "position", "positionen", "freigabe", "rabatt", "umsatz", "betrag", "datum", "frist", "kündigung",
]);

const NON_STREET_WORDS = new Set([
  "klickweg", "lernpfad", "datenpfad", "dateipfad", "suchpfad", "arbeitsplatz", "speicherplatz", "steckplatz",
  "parkplatz", "spielplatz", "marktplatz", "warenkorb", "zeitraum", "spielraum", "hintergrund",
]);

const NON_STREET_PREP_NOUNS = new Set([
  "jahr", "monat", "quartal", "tag", "woche", "schritt", "stufe", "teil", "abschnitt", "kapitel", "zeile", "spalte",
  "seite", "platz", "rang", "versuch", "punkt", "fall", "dialog", "tab", "reiter", "feld", "bereich", "menü",
  "status", "angebot", "auftrag", "vertrag", "konto", "profil", "dashboard", "ende", "anfang", "rahmen",
]);

const IBAN_COUNTRIES = new Set([
  "DE", "AT", "CH", "LI", "FR", "NL", "BE", "LU", "IT", "ES", "PT", "IE", "GB", "PL", "CZ", "SK",
  "DK", "SE", "NO", "FI", "GR", "HU", "RO", "BG", "HR", "SI", "LT", "LV", "EE", "CY", "MT",
]);

const LEGAL_SUFFIX_RE = /\s+(?:GmbH(?:\s*&\s*Co\.\s*KG)?|AG|KG|OHG|GbR|UG(?:\s*\(haftungsbeschränkt\))?|eG|mbB|e\.V\.|SE)$/i;
const TOKEN_SPLIT_RE = /(\[(?:Kunde|Person|Firma|Adresse|IBAN|E-Mail|Telefon|Wert)-\d{1,4}\])/g;
const TOKEN_EXACT_RE = /^\[(?:Kunde|Person|Firma|Adresse|IBAN|E-Mail|Telefon|Wert)-\d{1,4}\]$/;
const PURE_NON_PII_RE = /^[\d\s.,:%€$£¥+/–—\-()•*]+$/;
const DATE_LIKE_RE = /^\d{1,4}[./-]\d{1,2}[./-]\d{1,4}$/;

const IBAN_STD_RE = /\b([A-Z]{2}\d{2}(?:[\s\u00A0]?[A-Z0-9]{4}){2,7}(?:[\s\u00A0]?[A-Z0-9]{1,4})?)\b/g;
const IBAN_MASKED_RE = /\b([A-Z]{2}\d{2}[\s\u00A0]*(?:[•*xX]{2,4}[\s\u00A0]+){1,6}\d{2,4})\b/g;
const EMAIL_RE = /\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24})\b/g;
const PHONE_INTL_RE = /(?<![\p{L}\p{N}])((?:\+|00)[1-9]\d{0,2}[\s\u00A0/()-]*(?:\(0\)[\s\u00A0/()-]*)?\d(?:[\d\s\u00A0/()-]{4,18}\d))(?![\p{L}\p{N}])/gu;
const PHONE_DOMESTIC_RE = /(?<![\p{L}\p{N}.-])((?:\(0[1-9]\d{1,4}\)[\s\u00A0/-]*|0[1-9]\d{1,4}[\s\u00A0/-]+)\d(?:[\d\s\u00A0/-]{3,14}\d))(?![\p{L}\p{N}.-])/gu;
const SALUTATION_RE = /\b(Herrn?|Hr\.|Frau|Fr\.)[\s\u00A0]+((?:(?:Prof\.|Dr\.|Dipl\.-[A-Za-z]+\.)[\s\u00A0]+)*(?:(?:von|van|de|zu)[\s\u00A0]+)?[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)*(?:[\s\u00A0]+[A-ZÄÖÜ][a-zäöüß]+(?:-[A-ZÄÖÜ][a-zäöüß]+)*){0,2})\b/gu;
const STREET_SUFFIX_RE = /\b((?:[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{1,30}[\s\u00A0]+){0,2}[A-ZÄÖÜ][A-Za-zÄÖÜäöüß-]{1,35}(?:straße|strasse|str\.|weg|allee|platz|ring|gasse|damm|ufer|chaussee|pfad|steig|markt|hof|wall|promenade|kai|kamp|graben)[\s\u00A0]+[1-9]\d{0,3}\s?[a-zA-Z]?(?:\s*[-/]\s*[1-9]\d{0,3}\s?[a-zA-Z]?)?(?:,\s*\d{5}[\s\u00A0]+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß -]{2,30})?)\b/gu;
const STREET_PREP_RE = /\b((?:Am|An\s+der|An\s+den|Auf\s+dem|Auf\s+der|Im|In\s+der|In\s+den|Unter\s+den|Unter\s+der|Zum|Zur)[\s\u00A0]+([A-ZÄÖÜ][a-zäöüß-]{2,30})(?:[\s\u00A0]+[A-ZÄÖÜ][a-zäöüß-]{2,30})?[\s\u00A0]+[1-9]\d{0,2}[a-zA-Z]?)(?!\.)((?:,\s*\d{5}[\s\u00A0]+[A-ZÄÖÜ][A-Za-zÄÖÜäöüß -]{2,30})?)\b/gu;
const COMPANY_RE = /\b([A-ZÄÖÜ][A-Za-zÄÖÜäöüß0-9&.'-]{1,30}(?:[\s\u00A0]+[A-Za-zÄÖÜäöüß0-9&.'-]{1,30}){0,3}[\s\u00A0]+(?:GmbH(?:\s*&\s*Co\.\s*KG)?|AG|KG|OHG|GbR|eG|mbB|e\.V\.|UG))\b/gu;

const SPEECH_LABEL: Record<PseudonymKind, string> = {
  Kunde: "Kunde",
  Person: "Person",
  Firma: "Firma",
  Adresse: "Adresse",
  IBAN: "IBAN",
  "E-Mail": "E-Mail",
  Telefon: "Telefonnummer",
  Wert: "Eintrag",
};

function cleanSpaces(text: string): string {
  return text.replace(/[\s\u00A0]+/g, " ").trim();
}

function normKey(text: string): string {
  return cleanSpaces(text).toLocaleLowerCase("de-DE");
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isKind(value: string): value is PseudonymKind {
  return (PSEUDONYM_KINDS as readonly string[]).includes(value);
}

/** Skip object keys whose string values are protocol identifiers, enums, URLs or base64 data. */
const SKIP_OBJECT_KEYS = new Set([
  "id", "snapshotId", "offerId", "workflowId", "appId", "type", "source", "trigger", "feedback",
  "role", "elementRole", "dataUrl", "tier", "model", "code",
]);

export class PseudonymSession {
  private counters: Partial<Record<PseudonymKind, number>> = {};
  private forward = new Map<string, StoredEntry>();
  private reverse = new Map<string, string>();
  private surnameIndex = new Map<string, string | null>(); // null = ambiguous (multiple persons share surname)
  private firstNameIndex = new Map<string, string | null>();
  private dictRegex: RegExp | null = null;
  private dirty = false;

  get size(): number {
    return this.reverse.size;
  }

  clear() {
    this.counters = {};
    this.forward.clear();
    this.reverse.clear();
    this.surnameIndex.clear();
    this.firstNameIndex.clear();
    this.dictRegex = null;
    this.dirty = false;
  }

  /** Register page content strings in the session-wide dictionary (multi-word first so single-word greetings reuse full names, preserving page order otherwise). */
  ingest(entries: PseudonymEntry[] | undefined) {
    if (!entries?.length) return;
    const singleWord = (v: string) => (cleanSpaces(v).includes(" ") ? 0 : 1);
    const ordered = [...entries].sort((a, b) => singleWord(a.value) - singleWord(b.value));
    for (const item of ordered) {
      this.register(item.value, item.kind, item.aliases);
    }
  }

  register(rawValue: string, kind: PseudonymKind, extraAliases?: string[]): string | null {
    const canonical = cleanSpaces(rawValue);
    if (!this.acceptCandidate(canonical, kind)) return null;

    const primaryKey = this.lookupKey(canonical, kind);
    const existing = this.forward.get(primaryKey) ?? this.forward.get(normKey(canonical));
    if (existing) {
      if (extraAliases?.length) this.attachAliases(existing, extraAliases);
      return existing.token;
    }

    // Single-word person name (e.g. greeting "Guten Tag, Jana"): reuse unambiguous known person if present.
    if (kind === "Person" && !canonical.includes(" ")) {
      const match = this.firstNameIndex.get(normKey(canonical));
      if (match) {
        this.setForward(normKey(canonical), { token: match, kind: "Person", canonical: this.reverse.get(match) ?? canonical, caseSensitive: true });
        return match;
      }
    }

    if (this.forward.size >= MAX_DICTIONARY_ENTRIES) return null;

    const next = Math.min((this.counters[kind] ?? 0) + 1, MAX_COUNTER);
    this.counters[kind] = next;
    const token = pseudonym(kind, next);
    const singleAlphaWord = !canonical.includes(" ") && !/[\d@]/.test(canonical);
    const entry: StoredEntry = { token, kind, canonical, caseSensitive: singleAlphaWord };

    this.reverse.set(token, canonical);
    this.setForward(normKey(canonical), entry);
    if (primaryKey !== normKey(canonical)) this.setForward(primaryKey, entry);

    // Useful aliases so user questions match the exact same token as the page record.
    const autoAliases: string[] = [...(extraAliases ?? [])];
    if (kind === "Kunde" || kind === "Firma") {
      const stripped = cleanSpaces(canonical.replace(LEGAL_SUFFIX_RE, ""));
      if (stripped !== canonical && stripped.length >= 5 && (stripped.includes(" ") || stripped.length >= 7) && !STATIC_UI_TERMS.has(normKey(stripped))) {
        autoAliases.push(stripped);
      }
    } else if (kind === "Person") {
      this.indexPersonName(canonical, token);
    } else if (kind === "IBAN") {
      const compact = canonical.replace(/[\s\u00A0]+/g, "");
      if (compact !== canonical) autoAliases.push(compact);
    } else if (kind === "Telefon") {
      const digits = canonical.replace(/[^\d+]/g, "");
      if (digits.length >= 7 && digits !== canonical) autoAliases.push(digits);
    }
    if (autoAliases.length) this.attachAliases(entry, autoAliases);
    return token;
  }

  /** Replace personal data (dictionary + patterns) with `[Kind-n]` placeholders. Idempotent. */
  pseudonymizeText(input: string): string {
    if (!input || input.length < 3) return input;
    return this.mapUntokenized(input, (segment) => {
      let current = this.applyStructuredPatterns(segment);
      current = this.mapUntokenized(current, (part) => this.applySalutationPattern(part));
      current = this.mapUntokenized(current, (part) => this.applyDictionary(part));
      current = this.mapUntokenized(current, (part) => this.applyNaturalPatterns(part));
      return current;
    });
  }

  /** Translate `[Kind-n]` placeholders in server answers back to the session's real values for local display. */
  restoreText(input: string): string {
    if (!input || !input.includes("[")) return input;
    return input.replace(new RegExp(PSEUDONYM_TOKEN.source, "g"), (token) => this.reverse.get(token) ?? token);
  }

  /** Speech text goes to `/api/lotse/tts` on the server, so never restore real personal data into TTS requests. */
  toSpeechSafeText(input: string): string {
    const safe = this.pseudonymizeText(input);
    return safe.replace(/\[(Kunde|Person|Firma|Adresse|IBAN|E-Mail|Telefon|Wert)-(\d{1,4})\]/g, (_token, rawKind: string, num: string) => {
      const label = isKind(rawKind) ? SPEECH_LABEL[rawKind] : "Eintrag";
      return `${label} ${num}`;
    });
  }

  pseudonymizeEvent(event: LotseEvent): LotseEvent {
    return {
      ...event,
      elementLabel: event.elementLabel ? this.pseudonymizeText(event.elementLabel).slice(0, 160) : undefined,
      detail: event.detail ? this.pseudonymizeText(event.detail).slice(0, 200) : undefined,
    };
  }

  pseudonymizeSnapshot<T extends PageSnapshot | ObservationSnapshot>(snapshot: T): T {
    return {
      ...snapshot,
      title: this.pseudonymizeText(snapshot.title).slice(0, 160),
      elements: snapshot.elements.map((el) => ({
        ...el,
        label: this.pseudonymizeText(el.label).slice(0, 120),
      })),
      messages: snapshot.messages?.map((msg) => this.pseudonymizeText(msg).slice(0, 160)),
    };
  }

  /** Walk any outbound JSON request body right before `fetch` so no personal string can slip through. */
  pseudonymizePayload<T>(value: T, key?: string): T {
    if (value === null || value === undefined) return value;
    if (typeof value === "string") {
      if (key && SKIP_OBJECT_KEYS.has(key)) return value;
      if (key === "url" || key === "route") return this.pseudonymizeRouteOrUrl(value) as T;
      if (value.startsWith("data:image/")) return value;
      const out = this.pseudonymizeText(value);
      return (key === "question" ? out.slice(0, 500) : out) as T;
    }
    if (Array.isArray(value)) {
      return value.map((item) => this.pseudonymizePayload(item, key)) as T;
    }
    if (typeof value === "object") {
      const out: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        out[k] = this.pseudonymizePayload(v, k);
      }
      return out as T;
    }
    return value;
  }

  restoreGuidanceEvent<T extends GuidanceEvent>(event: T): T {
    if (event.type === "point") {
      return {
        ...event,
        label: this.restoreText(event.label),
        hint: event.hint ? this.restoreText(event.hint).slice(0, 120) : undefined,
      };
    }
    if (event.type === "plan") {
      return {
        ...event,
        steps: event.steps.map((step) => ({
          ...step,
          label: this.restoreText(step.label),
          hint: step.hint ? this.restoreText(step.hint).slice(0, 120) : undefined,
        })),
      };
    }
    if (event.type === "say") {
      return { ...event, text: this.restoreText(event.text).slice(0, 200) };
    }
    if (event.type === "error") {
      return { ...event, message: this.restoreText(event.message) };
    }
    return event;
  }

  restoreAskResponse(answer: AskResponse): AskResponse {
    return { ...answer, sentence: this.restoreText(answer.sentence) };
  }

  restoreDecision(decision: DecideResponse | null): DecideResponse | null {
    if (!decision) return null;
    return {
      ...decision,
      intent: decision.intent ? this.restoreText(decision.intent) : undefined,
      offer: decision.offer ? this.restoreText(decision.offer).slice(0, 140) : undefined,
    };
  }

  restoreInference(inference: WorkflowIntent | null): WorkflowIntent | null {
    if (!inference) return null;
    return {
      workflowName: this.restoreText(inference.workflowName).slice(0, 200),
      intent: this.restoreInferredIntent(inference.intent),
    };
  }

  restoreInferredIntent(intent: InferredIntent): InferredIntent {
    return {
      ...intent,
      goal: this.restoreText(intent.goal).slice(0, 500),
      evidence: intent.evidence.map((item) => this.restoreText(item).slice(0, 200)),
    };
  }

  serialize(): SerializedPseudonymSession {
    return {
      version: 1,
      counters: { ...this.counters },
      forward: [...this.forward.entries()],
      reverse: [...this.reverse.entries()],
    };
  }

  restore(raw: unknown) {
    this.clear();
    if (!raw || typeof raw !== "object" || !("version" in raw) || (raw as { version?: unknown }).version !== 1) return;
    const data = raw as Partial<SerializedPseudonymSession>;
    if (data.counters && typeof data.counters === "object") {
      for (const kind of PSEUDONYM_KINDS) {
        const val = data.counters[kind];
        if (typeof val === "number" && Number.isInteger(val) && val >= 0 && val <= MAX_COUNTER) {
          this.counters[kind] = val;
        }
      }
    }
    if (Array.isArray(data.reverse)) {
      for (const pair of data.reverse.slice(0, MAX_DICTIONARY_ENTRIES)) {
        if (Array.isArray(pair) && typeof pair[0] === "string" && typeof pair[1] === "string" && TOKEN_EXACT_RE.test(pair[0])) {
          this.reverse.set(pair[0], pair[1]);
        }
      }
    }
    if (Array.isArray(data.forward)) {
      for (const pair of data.forward.slice(0, MAX_DICTIONARY_ENTRIES)) {
        if (!Array.isArray(pair) || typeof pair[0] !== "string" || !pair[1] || typeof pair[1] !== "object") continue;
        const entry = pair[1] as Partial<StoredEntry>;
        if (typeof entry.token === "string" && typeof entry.kind === "string" && isKind(entry.kind) && typeof entry.canonical === "string") {
          this.forward.set(pair[0], {
            token: entry.token,
            kind: entry.kind,
            canonical: entry.canonical,
            caseSensitive: entry.caseSensitive === true,
          });
          if (entry.kind === "Person" && normKey(entry.canonical) === pair[0]) {
            this.indexPersonName(entry.canonical, entry.token);
          }
        }
      }
    }
    this.dirty = true;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private acceptCandidate(canonical: string, kind: PseudonymKind): boolean {
    if (!canonical || canonical.length < 3 || canonical.length > 160) return false;
    if (TOKEN_SPLIT_RE.test(canonical)) {
      TOKEN_SPLIT_RE.lastIndex = 0;
      return false;
    }
    const lower = normKey(canonical);
    if (STATIC_UI_TERMS.has(lower)) return false;
    if (DATE_LIKE_RE.test(canonical)) return false;
    if (kind !== "Telefon" && kind !== "IBAN" && PURE_NON_PII_RE.test(canonical)) return false;
    // Single alphabetical words must be at least 4 chars and start capitalized (e.g. a name) to avoid common words.
    if (!canonical.includes(" ") && !/[\d@._-]/.test(canonical)) {
      if (canonical.length < 4 || !/^[A-ZÄÖÜ]/.test(canonical)) return false;
    }
    return true;
  }

  private lookupKey(value: string, kind: PseudonymKind): string {
    if (kind === "IBAN") return value.replace(/[\s\u00A0]+/g, "").toUpperCase();
    if (kind === "E-Mail") return value.trim().toLowerCase();
    if (kind === "Telefon") {
      const digits = value.replace(/[^\d+]/g, "");
      return digits.length >= 7 ? `tel:${digits}` : normKey(value);
    }
    return normKey(value);
  }

  private setForward(key: string, entry: StoredEntry) {
    if (!key || key.length < 3 || STATIC_UI_TERMS.has(key)) return;
    if (!this.forward.has(key)) {
      this.forward.set(key, entry);
      this.dirty = true;
    }
  }

  private attachAliases(entry: StoredEntry, aliases: string[]) {
    for (const rawAlias of aliases) {
      const alias = cleanSpaces(rawAlias);
      if (alias.length < 3 || STATIC_UI_TERMS.has(normKey(alias))) continue;
      const singleAlpha = !alias.includes(" ") && !/[\d@._-]/.test(alias);
      if (singleAlpha && (alias.length < 4 || !/^[A-ZÄÖÜ]/.test(alias))) continue;
      this.setForward(normKey(alias), { ...entry, caseSensitive: singleAlpha });
    }
  }

  private indexPersonName(fullName: string, token: string) {
    const parts = fullName.split(" ").filter(Boolean);
    if (parts.length < 2) return;
    const first = normKey(parts[0]!);
    const last = normKey(parts.at(-1)!);
    if (first.length >= 3) {
      const prev = this.firstNameIndex.get(first);
      this.firstNameIndex.set(first, prev === undefined || prev === token ? token : null);
    }
    if (last.length >= 3) {
      const prev = this.surnameIndex.get(last);
      this.surnameIndex.set(last, prev === undefined || prev === token ? token : null);
    }
  }

  private mapUntokenized(input: string, fn: (segment: string) => string): string {
    const parts = input.split(TOKEN_SPLIT_RE);
    if (parts.length === 1) return fn(input);
    return parts.map((part) => (TOKEN_EXACT_RE.test(part) ? part : fn(part))).join("");
  }

  private applyStructuredPatterns(text: string): string {
    let out = text;

    // 1. Standard IBANs (e.g. "DE89 3704 0044 0532 0130 00" or "DE89370400440532013000")
    out = out.replace(IBAN_STD_RE, (match) => {
      const compact = match.replace(/[\s\u00A0]+/g, "");
      const country = compact.slice(0, 2);
      const digits = compact.replace(/\D/g, "").length;
      if (compact.length < 15 || compact.length > 34 || digits < 8 || !IBAN_COUNTRIES.has(country)) return match;
      return this.register(match, "IBAN") ?? match;
    });

    // 2. Masked IBANs (e.g. "DE89 •••• •••• 3000")
    out = out.replace(IBAN_MASKED_RE, (match) => {
      const country = match.slice(0, 2);
      if (!IBAN_COUNTRIES.has(country)) return match;
      return this.register(match, "IBAN") ?? match;
    });

    // 3. E-Mail addresses
    out = out.replace(EMAIL_RE, (match) => this.register(match, "E-Mail") ?? match);

    // 4. International & domestic phone numbers
    const replacePhone = (match: string) => {
      const digits = match.replace(/\D/g, "");
      if (digits.length < 7 || digits.length > 16) return match;
      return this.register(match, "Telefon") ?? match;
    };
    out = out.replace(PHONE_INTL_RE, replacePhone);
    out = out.replace(PHONE_DOMESTIC_RE, replacePhone);

    return out;
  }

  private applySalutationPattern(text: string): string {
    return text.replace(SALUTATION_RE, (full, salutation: string, rawName: string) => {
      const words = cleanSpaces(rawName).split(" ");
      const trailing: string[] = [];
      while (words.length > 1 && NON_NAME_NOUNS.has(normKey(words.at(-1)!))) {
        trailing.unshift(words.pop()!);
      }
      const name = words.join(" ");
      if (!name || NON_NAME_NOUNS.has(normKey(name))) return full;
      const suffix = trailing.length ? " " + trailing.join(" ") : "";

      // Check if full name or surname already refers to a known person on the page.
      const direct = this.forward.get(normKey(name));
      if (direct && direct.kind === "Person") return direct.token + suffix;
      const surname = normKey(words.at(-1)!);
      const bySurname = this.surnameIndex.get(surname);
      if (bySurname) return bySurname + suffix;

      const normSal = /^fr/i.test(salutation) ? "Frau" : "Herr";
      const canonical = `${normSal} ${name}`;
      const token = this.register(canonical, "Person", [`Herr ${name}`, `Herrn ${name}`, `Frau ${name}`]);
      return (token ?? full.slice(0, full.length - suffix.length)) + suffix;
    });
  }

  private applyDictionary(text: string): string {
    const regex = this.compiledDictRegex();
    if (!regex) return text;
    return text.replace(regex, (match) => {
      const entry = this.forward.get(normKey(match)) ?? this.forward.get(match.replace(/[\s\u00A0]+/g, "").toUpperCase());
      if (!entry) return match;
      if (entry.caseSensitive && match[0] !== entry.canonical[0]) return match;
      return entry.token;
    });
  }

  private applyNaturalPatterns(text: string): string {
    let out = text;

    // Company names with explicit legal form (e.g. "Müller Logistik GmbH", "Bauer Agrar eG")
    out = this.mapUntokenized(out, (segment) =>
      segment.replace(COMPANY_RE, (match) => {
        if (STATIC_UI_TERMS.has(normKey(match))) return match;
        const existing = this.forward.get(normKey(match));
        if (existing) return existing.token;
        return this.register(match, "Firma") ?? match;
      }),
    );

    // Streets with house numbers: suffix style ("Industriestraße 88", "Rheinuferweg 3")
    out = this.mapUntokenized(out, (segment) =>
      segment.replace(STREET_SUFFIX_RE, (match) => {
        const firstWord = normKey(match.split(/[\s\u00A0]+/)[0] ?? "");
        if (NON_STREET_WORDS.has(firstWord)) return match;
        return this.register(match, "Adresse") ?? match;
      }),
    );

    // Streets with house numbers: prepositional style ("Am Hafenrand 12", "Unter den Linden 77")
    out = this.mapUntokenized(out, (segment) =>
      segment.replace(STREET_PREP_RE, (full, streetPart: string, firstNoun: string, plzPart: string) => {
        if (NON_STREET_PREP_NOUNS.has(normKey(firstNoun))) return full;
        const combined = streetPart + (plzPart ?? "");
        return this.register(combined, "Adresse") ?? full;
      }),
    );

    return out;
  }

  private compiledDictRegex(): RegExp | null {
    if (!this.dirty && this.dictRegex) return this.dictRegex;
    this.dirty = false;
    const phrases: string[] = [];
    for (const key of this.forward.keys()) {
      if (key.startsWith("tel:")) continue;
      if (key.length >= 3) phrases.push(key);
    }
    if (!phrases.length) {
      this.dictRegex = null;
      return null;
    }
    // Longest-first ensures full phrases ("Müller Logistik GmbH", "Jana Lehmann") win over shorter aliases ("Müller Logistik", "Jana").
    phrases.sort((a, b) => b.length - a.length);
    const pattern = `(?<![\\p{L}\\p{N}@])(?:${phrases.map(escapeRegExp).join("|")})(?![\\p{L}\\p{N}@])`;
    this.dictRegex = new RegExp(pattern, "giu");
    return this.dictRegex;
  }

  private pseudonymizeRouteOrUrl(value: string): string {
    // Routes/URLs already omit query strings; only scrub accidental e-mails or IBANs embedded in path segments.
    return value.replace(EMAIL_RE, (m) => this.register(m, "E-Mail") ?? m)
      .replace(IBAN_STD_RE, (m) => {
        const compact = m.replace(/[\s\u00A0]+/g, "");
        return compact.length >= 15 && IBAN_COUNTRIES.has(compact.slice(0, 2)) ? (this.register(m, "IBAN") ?? m) : m;
      });
  }
}

// ---------------------------------------------------------------------------
// Screenshot content redaction (D-23 + D-26): paint rectangles over content areas
// ---------------------------------------------------------------------------

function dataUrlToBlob(dataUrl: string): Blob | null {
  const match = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/]+=*)$/.exec(dataUrl);
  if (!match) return null;
  const binary = atob(match[2]!);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return new Blob([bytes], { type: match[1]! });
}

async function blobToDataUrl(blob: Blob): Promise<string> {
  const buffer = await blob.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const chunk = 0x8000;
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += chunk) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunk));
  }
  return `data:${blob.type || "image/jpeg"};base64,${btoa(binary)}`;
}

/**
 * Paints opaque neutral rectangles over all detected content element positions on a captured tab screenshot.
 * Works inside Chrome's MV3 Service Worker using `createImageBitmap` + `OffscreenCanvas`.
 * Fails closed (returns `null`) if image decoding/canvas APIs are unavailable so unredacted frames never leave the browser.
 */
export async function redactScreenshot(
  dataUrl: string,
  rects: RectBox[],
  viewport?: ViewportSize,
): Promise<string | null> {
  if (typeof OffscreenCanvas === "undefined" || typeof createImageBitmap === "undefined") return null;
  const blob = dataUrlToBlob(dataUrl);
  if (!blob) return null;
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(blob);
    if (!rects.length || !viewport || viewport.width <= 0 || viewport.height <= 0) {
      return dataUrl;
    }
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    ctx.drawImage(bitmap, 0, 0);

    const scaleX = bitmap.width / viewport.width;
    const scaleY = bitmap.height / viewport.height;
    ctx.fillStyle = "#cbd5e1";
    ctx.strokeStyle = "#94a3b8";
    ctx.lineWidth = Math.max(1, Math.round(scaleX));

    for (const box of rects) {
      if (box.width <= 1 || box.height <= 1) continue;
      const x = Math.max(0, Math.floor(box.x * scaleX));
      const y = Math.max(0, Math.floor(box.y * scaleY));
      const right = Math.min(bitmap.width, Math.ceil((box.x + box.width) * scaleX));
      const bottom = Math.min(bitmap.height, Math.ceil((box.y + box.height) * scaleY));
      const w = right - x;
      const h = bottom - y;
      if (w <= 1 || h <= 1) continue;
      ctx.fillRect(x, y, w, h);
      if (w >= 8 && h >= 8) ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }

    const outBlob = await canvas.convertToBlob({ type: "image/jpeg", quality: 0.45 });
    return await blobToDataUrl(outBlob);
  } catch {
    return null;
  } finally {
    bitmap?.close();
  }
}
