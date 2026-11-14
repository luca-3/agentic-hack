/**
 * "Debug-Kontext kopieren" (side panel): small in-memory ring buffers in the service worker and the Markdown dump the
 * user pastes to the developer. Never holds the Supabase token, keys or screenshots; page content arrives pseudonymized
 * (D-26) except the user's own questions.
 */

export const DEBUG_MAX_CHARS = 40_000;

/** Fixed-size buffer; oldest entries drop out. */
export class Ring<T> {
  private items: T[] = [];
  constructor(private readonly max: number) {}
  push(item: T): void {
    this.items.push(item);
    if (this.items.length > this.max) this.items.splice(0, this.items.length - this.max);
  }
  newestFirst(): T[] {
    return [...this.items].reverse();
  }
}

export type RuntimeCallLog = {
  at: number; endpoint: string; method: string; status: number | null; ms: number;
  error?: string; code?: string; tier?: string;
};
export type TimedLine = { at: number; text: string };
export type QuestionLog = { at: number; source: string; text: string };
export type EventLog = { ts: number; type: string; route: string; label?: string; detail?: string };
type Fields = Record<string, string | number | boolean | null | undefined>;

export type DebugData = {
  header: Fields;
  settings: Fields;
  policy: Fields;
  observation: Fields;
  calls: RuntimeCallLog[];
  guidance: TimedLine[];
  questions: QuestionLog[];
  voice: Fields;
  voiceLog: string[];
  voiceWorkerLog: string[];
  events: EventLog[];
  messages: TimedLine[];
};

/** "anna.schmidt@demo.test" → "a***@demo.test". */
export function maskEmail(email: string | null | undefined): string | null {
  if (!email) return null;
  const at = email.indexOf("@");
  return at > 0 ? `${email[0]}***${email.slice(at)}` : "***";
}

const time = (at: number) => new Date(at).toISOString().slice(11, 23);
const oneLine = (text: string, max = 300) => text.replace(/\s+/g, " ").trim().slice(0, max);

function fields(values: Fields): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined)
    .map(([key, value]) => `- ${key}: ${value === null || value === "" ? "–" : typeof value === "string" ? oneLine(value, 500) : String(value)}`)
    .join("\n");
}

function list(lines: string[], empty = "(nichts)"): string {
  return lines.length ? lines.map((line) => `- ${line}`).join("\n") : `- ${empty}`;
}

function call(log: RuntimeCallLog): string {
  const parts = [`${time(log.at)} ${log.method} ${log.endpoint}`, `→ ${log.status ?? "kein HTTP"}`, `${log.ms} ms`];
  if (log.tier) parts.push(`tier ${log.tier}`);
  if (log.code) parts.push(`code ${log.code}`);
  if (log.error) parts.push(`Fehler: ${oneLine(log.error, 200)}`);
  return parts.join(" · ");
}

function event(entry: EventLog): string {
  const parts = [`${time(entry.ts)} ${entry.type}`, entry.route];
  if (entry.label) parts.push(`„${oneLine(entry.label, 80)}“`);
  if (entry.detail) parts.push(oneLine(entry.detail, 120));
  return parts.join(" · ");
}

/** Markdown for the clipboard, newest first in every list, capped at DEBUG_MAX_CHARS. */
export function formatDebugDump(data: DebugData): string {
  const text = [
    "# Valo Debug-Kontext",
    "## 1. Kopf", fields(data.header),
    "## 2. Einstellungen", fields(data.settings),
    "### Policy für diese Seite", fields(data.policy),
    "## 3. Beobachtung", fields(data.observation),
    `## 4. Runtime-Aufrufe (letzte ${data.calls.length})`, list(data.calls.map(call)),
    `## 5. Guidance (letzte ${data.guidance.length}, pseudonymisiert)`, list(data.guidance.map((g) => `${time(g.at)} ${oneLine(g.text)}`)),
    "### Fragen", list(data.questions.map((q) => `${time(q.at)} [${q.source}] ${oneLine(q.text, 500)}`)),
    "## 6. Sprache", fields(data.voice),
    `### Offscreen-Log (letzte ${data.voiceLog.length})`, list(data.voiceLog.slice().reverse()),
    `### Worker-Log Sprache (letzte ${data.voiceWorkerLog.length})`, list(data.voiceWorkerLog.slice().reverse()),
    `## 7. Beobachtete Events (letzte ${data.events.length}, pseudonymisiert)`, list(data.events.map(event)),
    `### Meldungen an den Nutzer (letzte ${data.messages.length})`, list(data.messages.map((m) => `${time(m.at)} ${oneLine(m.text)}`)),
  ].join("\n\n") + "\n";
  if (text.length <= DEBUG_MAX_CHARS) return text;
  return text.slice(0, DEBUG_MAX_CHARS) + "\n\n… gekürzt (Limit 40 KB)\n";
}
