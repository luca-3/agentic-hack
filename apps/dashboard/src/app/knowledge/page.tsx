import { KNOWLEDGE_LIMITS, KnowledgeSearchResponseSchema, LOTSE_DEFAULTS } from "@lotse/shared";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { Button, Card, DangerButton, EmptyState, Field, FormActions, Notice, PRODUCT_NAME, SelectField, Table, Td, TextareaField, Th } from "@/components/ui";
import { getOrgContext, type OrgContext } from "@/lib/org";
import { wissenHinzufuegen, wissenLoeschen } from "./actions";

export default function KnowledgePage({ searchParams }: PageProps<"/knowledge">) {
  return (
    <Shell href="/knowledge" title="Knowledge" intro={`Guides and terms ${PRODUCT_NAME} draws its answers from – for all apps or just one.`}>
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

const FEHLER: Record<string, string> = {
  "too-large": "The text is too large (200 KB max).",
  empty: "Please paste some text or choose a file.",
  title: "Please enter a title.",
  save: "Saving didn't work.",
  server: "Server not reachable or indexing failed. Nothing was saved.",
};
const UUID = /^[0-9a-f-]{36}$/i;

type Quelle = { id: string; title: string; kind: string; chunks: number; created_at: string; app_id: string | null };

async function Inhalt({ searchParams }: { searchParams: PageProps<"/knowledge">["searchParams"] }) {
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
      <option value="">All apps</option>
      {(apps ?? []).map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
    </>
  );
  const ok = typeof sp.ok === "string" ? sp.ok : undefined;

  return (
    <>
      <div role="note" className="flex items-start gap-3 rounded-lg border border-priv-line bg-priv-soft px-4 py-3.5 text-priv-strong">
        <svg className="size-[26px] shrink-0 text-priv-accent" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 2.5l6 2.5v4.5c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V5z" strokeLinejoin="round" /><path d="M7.5 10l1.8 1.8 3.2-3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <p className="m-0 text-md font-semibold">Texts added here are sent to Google Gemini for indexing – test/demo texts only, no personal or customer data.</p>
      </div>
      {typeof sp.error === "string" && <Notice tone="error" title={FEHLER[sp.error] ?? "Something went wrong."} />}
      {ok === "deleted" && <Notice tone="success" title="Source deleted." />}
      {ok && ok !== "deleted" && (
        <Notice tone="success" title={`Knowledge added: ${ok} sections saved.`}>
          {typeof sp.truncated === "string" && <p className="m-0">The text had {sp.truncated} sections; only the first {KNOWLEDGE_LIMITS.maxChunks} were kept.</p>}
        </Notice>
      )}

      {isAdmin && (
        <form id="add" action={wissenHinzufuegen} className="grid gap-4 rounded-lg border border-line bg-surface p-6">
          <h2 className="m-0 text-xl font-semibold">Add knowledge</h2>
          <div className="grid grid-cols-[2fr_1fr] gap-4">
            <Field label="Title" name="title" placeholder="e.g. Key handover – process" hint="Leave empty to use the file name." />
            <SelectField label="App" name="appId" defaultValue="">{optionen}</SelectField>
          </div>
          <TextareaField label="Paste text" name="text" placeholder="Paste text or Markdown here …" />
          <div className="flex items-center gap-3 text-sm text-muted"><span className="h-px flex-1 bg-line" />or<span className="h-px flex-1 bg-line" /></div>
          <label className="grid gap-1.5">
            <span className="text-sm font-semibold">Upload a file</span>
            <input type="file" name="datei" accept=".md,.txt,text/markdown,text/plain" className="min-h-11 rounded-md border border-dashed border-line-strong bg-input px-3 py-2 text-base text-text" />
            <span className="text-sm text-muted">Only .md or .txt, 200 KB max. Either paste text or choose a file – the file takes precedence.</span>
          </label>
          <FormActions submitLabel="Add" />
        </form>
      )}

      <section className="grid gap-3">
        <h2 className="m-0 text-xl font-semibold">Sources</h2>
        {liste.length === 0 ? (
          <EmptyState title="No knowledge added yet." text={isAdmin ? "Add the first text or file above." : undefined} />
        ) : (
          <Table>
            <thead><tr><Th>Title</Th><Th>App</Th><Th>Type</Th><Th className="text-right">Sections</Th><Th>Date</Th>{isAdmin && <Th><span className="sr-only">Action</span></Th>}</tr></thead>
            <tbody>
              {liste.map((s) => (
                <tr key={s.id} className="hover:bg-surface-hover">
                  <Td className="font-semibold">{s.title}</Td>
                  <Td>{s.app_id ? (appName.get(s.app_id) ?? "–") : "All apps"}</Td>
                  <Td>{s.kind === "markdown" ? "Markdown" : "Text"}</Td>
                  <Td className="text-right tabular-nums">{s.chunks}</Td>
                  <Td className="tabular-nums">{new Date(s.created_at).toLocaleDateString("en-GB")}</Td>
                  {isAdmin && (
                    <Td className="py-2 text-right">
                      <form action={wissenLoeschen}><input type="hidden" name="id" value={s.id} /><DangerButton type="submit" aria-label={`Delete “${s.title}”`}>Delete</DangerButton></form>
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
          <h2 className="m-0 text-xl font-semibold">Try it: what does {PRODUCT_NAME} find?</h2>
          <p className="mt-1 mb-0 text-muted">Ask a question the way someone at your company would.</p>
        </div>
        <form role="search" action="/knowledge" className="flex flex-wrap items-end gap-3">
          <Field className="min-w-80 flex-1" label="Question" name="q" type="search" defaultValue={q} required maxLength={KNOWLEDGE_LIMITS.maxQueryChars} placeholder="e.g. How do I request time off?" />
          <div className="min-w-[220px]"><SelectField label="App" name="app" defaultValue={app}>{optionen}</SelectField></div>
          <Button type="submit">Search</Button>
        </form>
        {q && (
          <Suspense key={`${q}|${app}`} fallback={<p role="status" className="m-0 text-muted">Searching …</p>}>
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
  if (!hits) return <Notice tone="error" title="Server not reachable or search failed." />;
  if (!hits.length) return <p className="m-0 text-muted">{PRODUCT_NAME} found nothing on this.</p>;
  return (
    <>
      <p className="m-0 text-sm text-muted">{hits.length} {hits.length === 1 ? "result" : "results"}</p>
      <div className="grid grid-cols-3 gap-3">
        {hits.map((h) => (
          <article key={h.id} className="flex flex-col gap-2.5 rounded-[10px] border border-line p-4">
            <span className="self-start rounded-full bg-primary-soft px-2.5 py-0.5 text-sm font-semibold text-primary-text tabular-nums">{Math.round(h.similarity * 100)}% similar</span>
            <p className="m-0 whitespace-pre-wrap">{h.content}</p>
            <span className="mt-auto text-sm text-muted">Source: <strong className="font-semibold text-text">{(h.sourceId && titel.get(h.sourceId)) ?? "Unknown"}</strong></span>
          </article>
        ))}
      </div>
    </>
  );
}
