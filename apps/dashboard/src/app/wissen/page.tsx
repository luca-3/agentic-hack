import { KNOWLEDGE_LIMITS, KnowledgeSearchResponseSchema, LOTSE_DEFAULTS } from "@lotse/shared";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { Button, Card, DangerButton, EmptyState, Field, FormActions, Notice, PRODUCT_NAME, SelectField, Table, Td, TextareaField, Th } from "@/components/ui";
import { getOrgContext, type OrgContext } from "@/lib/org";
import { wissenHinzufuegen, wissenLoeschen } from "./actions";

export default function WissenPage({ searchParams }: PageProps<"/wissen">) {
  return (
    <Shell href="/wissen" title="Wissen" intro={`Anleitungen und Begriffe, aus denen ${PRODUCT_NAME} Antworten findet – für alle Apps oder nur für eine.`}>
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

const FEHLER: Record<string, string> = {
  gross: "Der Text ist zu groß (höchstens 200 KB).",
  leer: "Bitte einen Text einfügen oder eine Datei wählen.",
  titel: "Bitte einen Titel angeben.",
  speichern: "Speichern hat nicht geklappt.",
  server: "Server nicht erreichbar oder Fehler beim Indexieren. Es wurde nichts gespeichert.",
};
const UUID = /^[0-9a-f-]{36}$/i;

type Quelle = { id: string; title: string; kind: string; chunks: number; created_at: string; app_id: string | null };

async function Inhalt({ searchParams }: { searchParams: PageProps<"/wissen">["searchParams"] }) {
  const [ctx, sp] = await Promise.all([getOrgContext(), searchParams]);
  const { supabase, isAdmin } = ctx;
  const [{ data: apps }, { data: quellen }] = await Promise.all([
    supabase.from("apps").select("id, name").order("name"),
    supabase.from("knowledge_sources").select("id, title, kind, chunks, created_at, app_id").order("created_at", { ascending: false }),
  ]);
  const appName = new Map((apps ?? []).map((a) => [a.id as string, a.name as string]));
  const liste = (quellen ?? []) as Quelle[];
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, KNOWLEDGE_LIMITS.maxQueryChars) : "";
  const app = typeof sp.app === "string" && UUID.test(sp.app) ? sp.app : "";
  const optionen = (
    <>
      <option value="">Alle Apps</option>
      {(apps ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </>
  );
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;

  return (
    <>
      <div role="note" className="flex items-start gap-3 rounded-lg border border-priv-line bg-priv-soft px-4 py-3.5 text-priv-strong">
        <svg className="size-[26px] shrink-0 text-priv-accent" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 2.5l6 2.5v4.5c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V5z" strokeLinejoin="round" /><path d="M7.5 10l1.8 1.8 3.2-3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <p className="m-0 text-md font-semibold">Texte hier werden zum Indexieren an Google Gemini geschickt – nur Test-/Demotexte, keine Personen- oder Kundendaten.</p>
      </div>
      {typeof sp.fehler === "string" && <Notice tone="error" title={FEHLER[sp.fehler] ?? "Etwas ist schiefgelaufen."} />}
      {ok === "geloescht" && <Notice tone="success" title="Quelle gelöscht." />}
      {ok && ok !== "geloescht" && (
        <Notice tone="success" title={`Wissen hinzugefügt: ${ok} Abschnitte gespeichert.`}>
          {typeof sp.gekuerzt === "string" && <p className="m-0">Der Text hatte {sp.gekuerzt} Abschnitte, nur die ersten {KNOWLEDGE_LIMITS.maxChunks} wurden übernommen.</p>}
        </Notice>
      )}

      {isAdmin && (
        <form id="hinzufuegen" action={wissenHinzufuegen} className="grid gap-4 rounded-lg border border-line bg-surface p-6">
          <h2 className="m-0 text-xl font-semibold">Wissen hinzufügen</h2>
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <Field label="Titel" name="title" placeholder="z. B. Schlüsselausgabe – Ablauf" hint="Leer lassen = Dateiname." />
            <SelectField label="App" name="appId" defaultValue="">{optionen}</SelectField>
          </div>
          <TextareaField label="Text einfügen" name="text" placeholder="Text oder Markdown hier einfügen …" />
          <div className="flex items-center gap-3 text-sm text-muted"><span className="h-px flex-1 bg-line" />oder<span className="h-px flex-1 bg-line" /></div>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">Datei hochladen</span>
            <input type="file" name="datei" accept=".md,.txt,text/markdown,text/plain" className="min-h-11 rounded-md border border-dashed border-line-strong bg-input px-3 py-2 text-base text-text" />
            <span className="text-sm text-muted">Nur .md oder .txt, höchstens 200 KB. Entweder Text einfügen oder eine Datei wählen – die Datei hat Vorrang.</span>
          </label>
          <FormActions submitLabel="Hinzufügen" />
        </form>
      )}

      <section className="grid gap-3">
        <h2 className="m-0 text-xl font-semibold">Quellen</h2>
        {liste.length === 0 ? (
          <EmptyState title="Noch kein Wissen hinterlegt." text={isAdmin ? "Oben den ersten Text oder eine Datei hinzufügen." : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>Titel</Th><Th>App</Th><Th>Typ</Th><Th className="text-right">Abschnitte</Th><Th>Datum</Th>{isAdmin && <Th><span className="sr-only">Aktion</span></Th>}</tr></thead>
            <tbody>
              {liste.map((s) => (
                <tr key={s.id} className="hover:bg-surface-hover">
                  <Td className="font-semibold">{s.title}</Td>
                  <Td>{s.app_id ? (appName.get(s.app_id) ?? "–") : "Alle Apps"}</Td>
                  <Td>{s.kind === "markdown" ? "Markdown" : "Text"}</Td>
                  <Td className="text-right tabular-nums">{s.chunks}</Td>
                  <Td className="tabular-nums">{new Date(s.created_at).toLocaleDateString("de-DE")}</Td>
                  {isAdmin && (
                    <Td className="py-2 text-right">
                      <form action={wissenLoeschen}><input type="hidden" name="id" value={s.id} /><DangerButton type="submit" aria-label={`„${s.title}“ löschen`}>Löschen</DangerButton></form>
                    </Td>
                  )}
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </section>

      <Card className="grid gap-4">
        <div>
          <h2 className="m-0 text-xl font-semibold">Ausprobieren: Was findet {PRODUCT_NAME}?</h2>
          <p className="mt-1 mb-0 text-muted">Eine Frage stellen, wie sie eine Person im Betrieb stellen würde.</p>
        </div>
        <form role="search" action="/wissen" className="flex flex-wrap items-end gap-3">
          <Field className="min-w-80 flex-1" label="Frage" name="q" type="search" defaultValue={q} required maxLength={KNOWLEDGE_LIMITS.maxQueryChars} placeholder="z. B. Wie beantrage ich Urlaub?" />
          <div className="min-w-[220px]"><SelectField label="App" name="app" defaultValue={app}>{optionen}</SelectField></div>
          <Button type="submit">Suchen</Button>
        </form>
        {q && (
          <Suspense key={`${q}|${app}`} fallback={<p role="status" className="m-0 text-muted">Sucht …</p>}>
            <Treffer ctx={ctx} q={q} app={app} titel={new Map(liste.map((s) => [s.id, s.title]))} />
          </Suspense>
        )}
      </Card>
    </>
  );
}

async function Treffer({ ctx, q, app, titel }: { ctx: OrgContext; q: string; app: string; titel: Map<string, string> }) {
  const token = (await ctx.supabase.auth.getSession()).data.session?.access_token;
  let hits;
  try {
    const res = await fetch(`${process.env.LOTSE_SERVER_URL ?? LOTSE_DEFAULTS.serverUrl}/api/knowledge/search`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({ query: q, ...(app && { appId: app }), limit: 5 }),
      cache: "no-store",
    });
    if (res.ok) hits = KnowledgeSearchResponseSchema.parse(await res.json()).hits;
  } catch {
    hits = undefined;
  }
  if (!hits) return <Notice tone="error" title="Server nicht erreichbar oder Fehler bei der Suche." />;
  if (!hits.length) return <p className="m-0 text-muted">{PRODUCT_NAME} findet dazu nichts.</p>;
  return (
    <>
      <p className="m-0 text-sm text-muted">{hits.length} Treffer</p>
      <div className="grid grid-cols-3 gap-3">
        {hits.map((h) => (
          <article key={h.id} className="flex flex-col gap-2.5 rounded-[10px] border border-line p-4">
            <span className="self-start rounded-full bg-primary-soft px-2.5 py-0.5 text-sm font-semibold text-primary-text tabular-nums">{Math.round(h.similarity * 100)} % ähnlich</span>
            <p className="m-0 whitespace-pre-wrap">{h.content}</p>
            <span className="mt-auto text-sm text-muted">Quelle: <strong className="font-semibold text-text">{(h.sourceId && titel.get(h.sourceId)) ?? "Unbekannt"}</strong></span>
          </article>
        ))}
      </div>
    </>
  );
}
