import { schulungAnlegen } from "@/app/actions";
import { Shell } from "@/components/Shell";
import { EmptyState, Field, FormActions, IconExternal, Notice, PRODUCT_NAME } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

export default function SchulungenPage({ searchParams }: PageProps<"/schulungen">) {
  return (
    <Shell href="/schulungen" title="Schulungen" intro={`${PRODUCT_NAME} schlägt passende Schulungen vor, wenn viele an derselben Stelle Hilfe brauchen.`}>
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

async function Inhalt({ searchParams }: { searchParams: PageProps<"/schulungen">["searchParams"] }) {
  const [{ supabase, isAdmin }, sp] = await Promise.all([getOrgContext(), searchParams]);
  const { data: trainings } = await supabase.from("training_catalog").select("id, title, topics, url").order("title");

  return (
    <>
      {typeof sp.ok === "string" && <Notice tone="success" title="Schulung angelegt." />}
      <div className={isAdmin ? "grid grid-cols-[1.6fr_1fr] items-start gap-6" : "grid"}>
        <section className="grid gap-3">
          <h2 className="m-0 text-xl font-semibold">Katalog</h2>
          {!trainings?.length && <EmptyState title="Noch keine Schulungen im Katalog." text={isAdmin ? "Rechts die erste Schulung anlegen." : undefined} />}
          {(trainings ?? []).map((t) => (
            <article key={t.id} className="grid gap-1.5 rounded-lg border border-line bg-surface px-5 py-[18px]">
              <h3 className="m-0 text-lg font-semibold">{t.title}</h3>
              {t.url && <a href={t.url} className="inline-flex items-center gap-1.5 justify-self-start font-mono">{t.url.replace(/^https?:\/\//, "")}<IconExternal /></a>}
              <p className="m-0 text-muted">Themen: {t.topics.join(", ") || "–"}</p>
            </article>
          ))}
        </section>
        {isAdmin && (
          <form action={schulungAnlegen} className="grid gap-4 rounded-lg border border-line bg-surface p-6">
            <h2 className="m-0 text-xl font-semibold">Neue Schulung</h2>
            <Field label="Titel" name="title" required />
            <Field label="Themen" name="topics" hint="Mit Komma getrennt. Funktionsnamen – so ordnet sich die Schulung den Stolperstellen zu." placeholder="Schlüssel finden, Auftrag abschließen" />
            <Field label={<>Link <span className="font-normal text-muted">(optional)</span></>} name="url" type="url" placeholder="https://" />
            <FormActions submitLabel="Schulung anlegen" />
          </form>
        )}
      </div>
    </>
  );
}
