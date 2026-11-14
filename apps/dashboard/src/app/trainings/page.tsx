import { schulungAnlegen } from "@/app/actions";
import { Shell } from "@/components/Shell";
import { EmptyState, Field, FormActions, IconExternal, Notice, PRODUCT_NAME } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

export default function SchulungenPage({ searchParams }: PageProps<"/trainings">) {
  return (
    <Shell href="/trainings" title="Trainings" intro={`${PRODUCT_NAME} suggests matching trainings when many people need help at the same spot.`}>
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

async function Inhalt({ searchParams }: { searchParams: PageProps<"/trainings">["searchParams"] }) {
  const [{ supabase, isAdmin }, sp] = await Promise.all([getOrgContext(), searchParams]);
  const { data: trainings } = await supabase.from("training_catalog").select("id, title, topics, url").order("title");

  return (
    <>
      {typeof sp.ok === "string" && <Notice tone="success" title="Training created." />}
      <div className={isAdmin ? "grid grid-cols-[1.6fr_1fr] items-start gap-6" : "grid"}>
        <section className="grid gap-3">
          <h2 className="m-0 text-xl font-semibold">Catalog</h2>
          {!trainings?.length && <EmptyState title="No trainings in the catalog yet." text={isAdmin ? "Create the first training on the right." : undefined} />}
          {(trainings ?? []).map((t) => (
            <article key={t.id} className="grid gap-1.5 rounded-lg border border-line bg-surface px-5 py-[18px]">
              <h3 className="m-0 text-lg font-semibold">{t.title}</h3>
              {t.url && <a href={t.url} className="inline-flex items-center gap-1.5 justify-self-start font-mono">{t.url.replace(/^https?:\/\//, "")}<IconExternal /></a>}
              <p className="m-0 text-muted">Topics: {t.topics.join(", ") || "–"}</p>
            </article>
          ))}
        </section>
        {isAdmin && (
          <form action={schulungAnlegen} className="grid gap-4 rounded-lg border border-line bg-surface p-6">
            <h2 className="m-0 text-xl font-semibold">New training</h2>
            <Field label="Title" name="title" required />
            <Field label="Topics" name="topics" hint="Comma-separated feature names – this is how the training is matched to the spots where people get stuck." placeholder="Find a key, Complete an order" />
            <Field label={<>Link <span className="font-normal text-muted">(optional)</span></>} name="url" type="url" placeholder="https://" />
            <FormActions submitLabel="Create training" />
          </form>
        )}
      </div>
    </>
  );
}
