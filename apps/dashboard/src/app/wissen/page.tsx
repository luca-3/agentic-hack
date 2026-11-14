import { KNOWLEDGE_LIMITS, KnowledgeSearchResponseSchema, LOTSE_DEFAULTS } from "@lotse/shared";
import { Suspense } from "react";
import { Shell, feld, karte, knopf } from "@/components/Shell";
import { getOrgContext, type OrgContext } from "@/lib/org";
import { wissenHinzufuegen, wissenLoeschen } from "./actions";

export default function WissenPage({ searchParams }: PageProps<"/wissen">) {
  return (
    <Shell
      title="Wissen"
      intro="Die Texte hier sind das Wissen, mit dem Lotse Fragen beantworten darf – für alle Apps oder nur für eine bestimmte App."
    >
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

const MELDUNG: Record<string, string> = {
  gross: "Der Text ist zu groß (höchstens 200 KB).",
  leer: "Bitte einen Text einfügen oder eine Datei wählen.",
  titel: "Bitte einen Titel angeben.",
  speichern: "Speichern hat nicht geklappt.",
  server: "Server nicht erreichbar oder Fehler beim Indexieren. Es wurde nichts gespeichert.",
};

const rot = "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300";
const gruen = "rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
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
  const appAuswahl = (name: string, wert: string, ohne: string) => (
    <select name={name} defaultValue={wert} className={feld}>
      <option value="">{ohne}</option>
      {(apps ?? []).map((a) => (
        <option key={a.id} value={a.id}>
          {a.name}
        </option>
      ))}
    </select>
  );

  return (
    <div className="flex flex-col gap-6">
      {typeof sp.fehler === "string" && <p className={rot}>{MELDUNG[sp.fehler] ?? "Etwas ist schiefgelaufen."}</p>}
      {typeof sp.ok === "string" && (
        <p className={gruen}>
          {sp.ok} Abschnitte gespeichert.
          {typeof sp.gekuerzt === "string" && ` Der Text hatte ${sp.gekuerzt} Abschnitte, nur die ersten ${KNOWLEDGE_LIMITS.maxChunks} wurden übernommen.`}
        </p>
      )}

      {isAdmin && (
        <form action={wissenHinzufuegen} className={`${karte} flex flex-col gap-3`}>
          <h2 className="text-lg font-semibold">Wissen hinzufügen</h2>
          <p className="rounded-md bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:bg-amber-950 dark:text-amber-200">
            Achtung: Der Text wird an Google Gemini geschickt, damit Lotse ihn durchsuchen kann. Bitte nur Test- oder
            Demo-Texte hochladen – keine persönlichen Daten und keine Kundendaten.
          </p>
          <div className="flex flex-wrap gap-3">
            <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
              Titel
              <input name="title" placeholder="z. B. Urlaubsregeln" className={feld} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Gilt für
              {appAuswahl("appId", "", "Alle Apps")}
            </label>
          </div>
          <label className="flex flex-col gap-1 text-sm">
            Text einfügen
            <textarea name="text" rows={8} className={feld} placeholder="Text oder Markdown hier einfügen …" />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            … oder Datei wählen (.md oder .txt, höchstens 200 KB – die Datei hat Vorrang)
            <input type="file" name="datei" accept=".md,.txt,text/markdown,text/plain" className="text-sm" />
          </label>
          <button className={`${knopf} self-start`}>Speichern</button>
        </form>
      )}

      <section className={karte}>
        <h2 className="text-lg font-semibold">Gespeichertes Wissen</h2>
        {liste.length === 0 ? (
          <p className="mt-2 text-sm text-zinc-500">Noch nichts gespeichert.</p>
        ) : (
          <table className="mt-3 w-full text-left text-sm">
            <thead className="text-zinc-500">
              <tr>
                <th className="py-1 pr-3 font-normal">Titel</th>
                <th className="py-1 pr-3 font-normal">Gilt für</th>
                <th className="py-1 pr-3 font-normal">Art</th>
                <th className="py-1 pr-3 font-normal">Abschnitte</th>
                <th className="py-1 pr-3 font-normal">Datum</th>
                {isAdmin && <th />}
              </tr>
            </thead>
            <tbody>
              {liste.map((s) => (
                <tr key={s.id} className="border-t border-zinc-100 align-top dark:border-zinc-900">
                  <td className="py-2 pr-3 font-medium">{s.title}</td>
                  <td className="py-2 pr-3">{s.app_id ? (appName.get(s.app_id) ?? "–") : "alle Apps"}</td>
                  <td className="py-2 pr-3">{s.kind === "markdown" ? "Markdown" : "Text"}</td>
                  <td className="py-2 pr-3">{s.chunks}</td>
                  <td className="py-2 pr-3">{new Date(s.created_at).toLocaleDateString("de-DE")}</td>
                  {isAdmin && (
                    <td className="py-2 text-right">
                      <form action={wissenLoeschen}>
                        <input type="hidden" name="id" value={s.id} />
                        <button className="rounded-md border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950">
                          Löschen
                        </button>
                      </form>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section className={karte}>
        <h2 className="text-lg font-semibold">Ausprobieren: Was findet Lotse?</h2>
        <form action="/wissen" className="mt-3 flex flex-wrap items-end gap-2">
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
            Frage
            <input name="q" defaultValue={q} required maxLength={KNOWLEDGE_LIMITS.maxQueryChars} placeholder="z. B. Wie beantrage ich Urlaub?" className={feld} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            App
            {appAuswahl("app", app, "Alle Apps")}
          </label>
          <button className={knopf}>Suchen</button>
        </form>
        {q && (
          <Suspense key={`${q}|${app}`} fallback={<p className="mt-3 text-sm text-zinc-500">Sucht …</p>}>
            <Treffer ctx={ctx} q={q} app={app} titel={new Map(liste.map((s) => [s.id, s.title]))} />
          </Suspense>
        )}
      </section>
    </div>
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
  if (!hits) return <p className={`mt-3 ${rot}`}>Server nicht erreichbar oder Fehler bei der Suche.</p>;
  if (!hits.length) return <p className="mt-3 text-sm text-zinc-500">Lotse findet dazu nichts.</p>;
  return (
    <ul className="mt-3 flex flex-col gap-3">
      {hits.map((h) => (
        <li key={h.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
          <div className="mb-1 flex gap-3 text-zinc-500">
            <span className="font-medium text-zinc-900 dark:text-zinc-100">{Math.round(h.similarity * 100)} %</span>
            <span>{(h.sourceId && titel.get(h.sourceId)) ?? "Unbekannte Quelle"}</span>
          </div>
          <p className="whitespace-pre-wrap">{h.content}</p>
        </li>
      ))}
    </ul>
  );
}
