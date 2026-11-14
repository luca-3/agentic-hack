# Antwort an Ismail — Learning Loop (`learn.ts`) + neues Agent-Gedächtnis

Kurz-Review deines `apps/server/src/lib/lotse/learn.ts` und was du jetzt einhängen kannst. Entscheidung: **D-28** (D-27 ist schon die App-Policy).

## Deine Wünsche — erledigt

- **D-26 im System-Prompt** (`prompt.ts`), wörtlich: „Platzhalter in eckigen Klammern (z. B. [Kunde-1], [IBAN-1]) sind undurchsichtige Ids. Übernimm sie unverändert und frage nie nach dem echten Wert."
- **`UsageRecord.route`** erlaubt jetzt `explore`, `learn`, `memory`, `insights` (`usage.ts`). In `explore/route.ts` (deine Datei, nicht angefasst) kannst du nach `draftFeatures` loggen:
  `void logUsage({ route: "explore", model: MODELS.fast, inputTokens, outputTokens, totalTokens, latencyMs, status, caller: { key: \`u:${userId}\`, sessionId: null, userId }, orgId })`.
  `learn` ruft aktuell kein Gemini auf (`drafts: 0`) → loggen, sobald die Drafts kommen.

## (a) Mapping `app_id` → `apps.id` über `apps.domains`

Passt. Die Runtime speichert in `lotse_events.app_id`, `lotse_offers.app_id` und `agent_usage.app_id` den Wert aus `x-lotse-app` bzw. `appId` im Body, sonst den Host der Snapshot-URL — also Host **inkl. Port** (`localhost:4000`), selten die `apps.id`-UUID. Deine `keys` (UUID + Domains + Domains ohne Schema/Slash, alles lowercase) decken das ab.
Zwei Randfälle: Domains mit Pfad (`https://crm.firma.de/app`) oder ohne Port (`localhost` statt `localhost:4000`) matchen nicht — am besten im Dashboard beim Speichern auf `host[:port]` lowercase normalisieren (der Runtime-Lookup in `knowledge.ts` matcht genauso exakt). `lotse_events.org_id` ist immer `null`; über Domains bleibt der richtige Weg.

## (b) `still_stuck_after_hint` — passt nicht zum echten Ablauf

Aktuell: „zweites Offer mit gleichem Intent ≤ 15 min nach dem ersten". Der echte Flow:
1. `/decide` legt die Zeile in `lotse_offers` an, **bevor** jemand das Angebot sieht — ein Offer ist noch kein Hinweis.
2. Die Extension zeigt erst die Angebots-Bubble; der Hinweis kommt **nur nach „Ja"** (`/ask`, `source: "proactive"`). „Ja" wird serverseitig nicht gespeichert. „Nein" → `/feedback declined` + 10 min Snooze; ignoriert → 2 min Cooldown; 👍/👎 → `/feedback up|down`.
3. Folge: „Nein" und nach 10–15 min erneut angeboten, oder Bubble ignoriert → zählt als „trotz Hinweis hängen geblieben", obwohl nie ein Hinweis kam.

Vorschlag:
- **Nenner:** Personen, deren erstes Offer zu Feature X **nicht abgelehnt** wurde (kein `declined`). Das ist die Definition der Insights-Pipeline (`lib/insights/aggregate.ts`: „first not-declined offer").
- **Zähler:** davon Personen mit erneutem Stuck-Signal zu X in den 15 min **danach**: neues Offer mit gleichem Intent **oder** `rage_click` / `error` / Suche mit `results=0` auf der Feature-Route.
- **Erst ab ≥ 5 Personen schreiben** (D-12). Aktuell `persons >= 1` — die RLS versteckt < 5 zwar, gespeichert wird es aber trotzdem.
- Sauber wird es mit einem echten „angenommen"-Signal: optional `AskRequest.offerId` → Server setzt `lotse_offers.accepted_at`. Braucht eine kleine Migration + eine Zeile in der Extension — sag Bescheid, dann baue ich die Server-Seite.

**Wichtig — zwei Writer für `insights`:** `refreshInsights` löscht/insertet `stuck_rate`, `still_stuck_after_hint`, `question_count` für (org, app, period, role null). Die Insights-Pipeline (`writeInsightRows`) schreibt dieselben Keys per Upsert und setzt nicht mehr qualifizierte Zeilen auf `persons = 0`. Laufen beide, überschreiben sie sich alle 10 min gegenseitig. Empfehlung: in `runLearn` statt `refreshInsights`
```ts
import { generateInsights } from "@/lib/insights/generate";
import { resolveApp } from "@/lib/insights/aggregate";
const ia = await resolveApp(app.id, orgId);
const report = ia ? await generateInsights(ia, { days: 30, write: true, llm: false, userId: null }) : null;
insights += (report?.written?.inserted ?? 0) + (report?.written?.updated ?? 0);
```
Damit bekommst du die bessere still-stuck-Definition, Rollen-Zeilen und die Mindestgruppe 5 gleich mit.

## (c) „Ein Offer zählt nur, wenn `intent` ein Feature-Name ist"

Was `/decide` als `intent` liefert (`decide.ts` → `offerFor`):
1. Die Choice der Decisions API trifft ein Feature (p ≥ 0.4) → `intent` = **exakter** `app_features.name` ✔
2. Kein Feature, aber `/intent` war sicher (≥ 0.5) → `intent` = freier Ziel-Text (≤ 200 Zeichen, kann `[Kunde-1]` enthalten) ✘
3. Sonst → „Wie komme ich auf dieser Seite weiter?" ✘

Dein Filter ist also richtig. Tipp: Fälle 2 und 3 nicht wegwerfen, sondern als „Sonstige / unklar" mitzählen — sonst wirkt die Gesamtzahl kleiner.

**Bugfix von mir in `decide.ts`:** Die Choice hat bisher jedes Feature ausgeschlossen, dessen *erster* Klickschritt schon geklickt wurde — praktisch alles („Kunden", „Aufgaben", „Angebote", „Benutzermenü"). Wer auf der Kundenseite an der IBAN hängt, konnte nie den Intent „Bankverbindung (IBAN) eines Kunden ändern" bekommen, landete in Fall 2 und wurde bei dir verworfen. Jetzt werden nur noch globale Werkzeuge (`route "*"`, z. B. „Globale Suche") ausgeschlossen → deutlich mehr Offers mit Feature-Namen.

## Neu: Wissenslücken + Agent-Gedächtnis (D-28)

Migration `supabase/migrations/20261114123416_agent_memory.sql` — lokal mit `npx supabase migration up --include-all` angewendet (hat deine `learning`-Migration gleich mit angewendet). Alle Tabellen: RLS an, nur Service-Role. Das Dashboard liest über `/api/lotse/memory`.

### `knowledge_gaps` — füllt deinen TODO `knowledge_gap`
- Nach jeder Text-/Sprachfrage (nicht proaktiv): kein `point`/`plan` (und keine Rollen-Sperre) **oder** Wissenssuche ohne Treffer ≥ 0.5 → Lücke.
- Gespeichert wird nur ein **neutrales Thema** (2–4 Wörter, z. B. „IBAN ändern") aus einem Lite-Model-Call, der bekannte Themen wiederverwendet (damit sich Formulierungen bündeln und die 5 Personen erreichen). **Die Frage selbst wird nie gespeichert**; Zahlen, Namen und Platzhalter werden zusätzlich gefiltert.
- Spalten: `org_id, app_id (apps.id), topic, count, persons` (distinct, gehashte Subjects), `status open|resolved|dismissed, memory_id, first_seen, last_seen`.
- Hook in `runLearn` (pro App):
```ts
import { listGaps } from "./gaps";
const gaps = await listGaps(orgId, { appId: app.id }); // nur persons ≥ 5, status open
items.push(...gaps.map((g) => ({
  appId: app.id, source: "learn" as const, kind: "knowledge_gap" as const, title: g.topic,
  detail: `${g.persons} Personen haben dazu keine Antwort bekommen (${g.count}×).`,
  payload: { topic: g.topic }, fingerprint: `knowledge_gap:${app.id}:${g.topic.toLowerCase()}`,
  occurrences: g.count, persons: g.persons,
})));
```
Das passt zu deinem Payload `{ topic, draft? }` und zur RLS-Policy `persons >= 5`.

### `agent_memory` — was Valo über Wochen lernt
- Getrennt von deiner Wissensbasis (`documents`), im Prompt immer als `<agent_memory>` markiert („gelernt, niedrigere Priorität als die Funktionsliste").
- `kind`: `faq` (Wort der Leute → Feature, z. B. „IBAN ändern" meint „Bankverbindung (IBAN) eines Kunden ändern"), `role_hint` (Rolle fragt oft nach einem gesperrten Feature), `pitfall`, `path_hint`, `gap_resolution`. `source`: `agent` (Runtime nach Antworten), `learn_loop` (du), `admin`.
- Lebenszyklus: `proposed` → `active` erst bei **≥ 5 verschiedenen Personen ohne 👎** (atomar in SQL) oder per Admin. 2× 👎 auf Offers zu dem Feature → zurück auf `proposed`. 60 Tage ohne neue Evidenz → `expired` (`LOTSE_MEMORY_TTL_DAYS`). Der Agent hat **kein Memory-Tool** — Seiteninhalte können höchstens einen Vorschlag beeinflussen, nie aktivieren.
- Wirkung: `/ask` bekommt ≤ 6 passende aktive Einträge, `/decide` ≤ 4 als `learned`-Hinweise (hilft der Choice, Nutzerwörter Features zuzuordnen), `searchKnowledge` durchsucht sie per Embedding mit.
- Hooks für `learn.ts` (werfen nie):
```ts
import { expireStaleMemories, proposeMemory } from "./memory";
// z. B. aus deinen Aggregaten: viele scheitern am IBAN-Format
await proposeMemory({
  orgId, appId: app.id, kind: "pitfall", topic: "IBAN ändern",
  feature: "Bankverbindung (IBAN) eines Kunden ändern",
  content: "Viele scheitern am IBAN-Format — auf Länderkennung und Leerzeichen hinweisen.",
  source: "learn_loop",
  subjects: [...subjectKeys], // "u:<id>" / "s:<id>" wie subjectOf(); werden gehasht, ≥ 5 → aktiv
});
await expireStaleMemories(orgId); // einmal pro Lauf
```
Ideen: viele 👎 auf ein Intent → `pitfall`; eine übernommene `stale_feature`-Suggestion → `path_hint` („Knopf heißt jetzt …").

### API fürs Dashboard: `/api/lotse/memory`
Auth wie bei learn: `Authorization: Bearer <access token>` eines Org-Admins (im Dev auch ohne Token, `app` = `localhost:4000`).
- `GET /api/lotse/memory?app=<apps.id|host>&status=proposed|active|rejected|expired` → `{ orgId, appId, minPersons, ttlDays, expired, memories: AgentMemory[], gaps: KnowledgeGap[] }` (gaps nur ≥ 5 Personen, offen)
- `POST /api/lotse/memory` mit `{ action, app?, … }`:
  - `approve` / `reject` / `expire` `{ id }` → `{ memory }`
  - `create` `{ kind, topic, content, feature? }` → `{ memory }` (sofort aktiv)
  - `resolve_gap` `{ gapId, content }` → `{ gap, memory }`: Admin beantwortet eine Lücke → aktive `gap_resolution`, Valo nutzt sie ab der nächsten Frage (≤ 60 s Cache)
  - `dismiss_gap` `{ gapId }` → `{ gap }`
- `AgentMemory` = `{ id, orgId, appId, kind, topic, feature, content, source, evidenceCount, persons, negatives, confidence, status, createdAt, updatedAt, lastSeenAt, activatedAt }`
- `KnowledgeGap` = `{ id, orgId, appId, topic, count, persons, status, memoryId, firstSeen, lastSeen }`
- Fehler: `{ error: { code, message } }`. Check: `curl -s "http://localhost:3001/api/lotse/memory?app=localhost:4000"` → 200.

Vorschlag für die Lernen-Seite: Abschnitt „Agent-Gedächtnis" (Vorgeschlagen / Aktiv mit Freigeben / Ablehnen) und „Offene Wissenslücken" mit Antwortfeld → `resolve_gap`. Wenn du Lücken lieber nur über `lotse_suggestions` zeigst: beim „Übernehmen" `resolve_gap` aufrufen.
