import { schulungAnlegen } from "@/app/actions";
import { Shell } from "@/components/Shell";
import { EmptyState, Field, Footnote, FormActions, IconChevron, IconExternal, Notice, PRODUCT_NAME } from "@/components/ui";
import { getOrgContext } from "@/lib/org";

/** Question-based trainings need at least this many distinct people before they show up (D-12, D-28). */
const MIN_PEOPLE = 5;

type Training = {
  id: number;
  title: string;
  topics: string[];
  url: string | null;
  description: string | null;
  source: "manual" | "questions";
  app_id: string | null;
  roles: string[];
  asked_count: number | null;
  asked_by: number | null;
  period_days: number | null;
  bundle_of: string[];
};

const byBacking = (a: Training, b: Training) => (b.asked_by ?? 0) - (a.asked_by ?? 0) || (b.asked_count ?? 0) - (a.asked_count ?? 0);

export default function SchulungenPage({ searchParams }: PageProps<"/trainings">) {
  return (
    <Shell
      href="/trainings"
      title="Trainings"
      intro={`Built from what your employees ask ${PRODUCT_NAME}.`}
      meta="Last 30 days"
    >
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

async function Inhalt({ searchParams }: { searchParams: PageProps<"/trainings">["searchParams"] }) {
  const [{ supabase, isAdmin }, sp] = await Promise.all([getOrgContext(), searchParams]);
  const [{ data }, { data: apps }] = await Promise.all([
    supabase
      .from("training_catalog")
      .select("id, title, topics, url, description, source, app_id, roles, asked_count, asked_by, period_days, bundle_of")
      .order("title"),
    supabase.from("apps").select("id, name"),
  ]);
  const all = (data ?? []) as Training[];
  // Aggregates only; anything asked by fewer than MIN_PEOPLE stays hidden.
  const fromQuestions = all.filter((t) => t.source === "questions" && (t.asked_by ?? 0) >= MIN_PEOPLE).sort(byBacking);
  const manual = all.filter((t) => t.source !== "questions");
  const appNames = new Map((apps ?? []).map((a) => [a.id as string, a.name as string]));

  const [suggested, ...more] = fromQuestions;

  return (
    <>
      {typeof sp.ok === "string" && <Notice tone="success" title="Training created." />}
      <div className={isAdmin ? "grid grid-cols-[1.6fr_1fr] items-start gap-6" : "grid"}>
        <div className="grid gap-6">
          <section className="grid gap-3">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="m-0 text-xl font-semibold">Suggested training</h2>
              {suggested && (
                <span className="text-sm text-muted">
                  {suggested.app_id ? appNames.get(suggested.app_id) : "All apps"}
                  {suggested.period_days ? ` · last ${suggested.period_days} days` : ""}
                </span>
              )}
            </div>
            {suggested ? (
              <Suggested t={suggested} />
            ) : (
              <EmptyState title="No trainings from questions yet." text={`They appear once at least ${MIN_PEOPLE} people asked ${PRODUCT_NAME} about the same topic.`} />
            )}
            {more.length > 0 && (
              <details className="rounded-lg border border-line bg-surface">
                <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 font-semibold">
                  <span data-chev><IconChevron /></span>
                  {more.length} more from questions
                </summary>
                <ul className="m-0 grid list-none p-0">
                  {more.map((t) => <Row key={t.id} t={t} />)}
                </ul>
              </details>
            )}
            <Footnote>Counts only, never who asked · shown from {MIN_PEOPLE} people.</Footnote>
          </section>

          <details className="rounded-lg border border-line bg-surface" open={typeof sp.ok === "string"}>
            <summary className="flex min-h-11 cursor-pointer items-center gap-2 px-4 font-semibold">
              <span data-chev><IconChevron /></span>
              Catalog <span className="font-normal text-muted">· {manual.length} added manually</span>
            </summary>
            <ul className="m-0 grid list-none p-0">
              {!manual.length && <li className="border-t border-line px-4 py-3 text-muted">None yet.{isAdmin ? " Create one on the right." : ""}</li>}
              {manual.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-line px-4 py-3">
                  <span className="font-semibold">{t.title}</span>
                  {t.url && <a href={t.url} className="inline-flex items-center gap-1.5 text-sm">Open<IconExternal /></a>}
                </li>
              ))}
            </ul>
          </details>
        </div>
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

/** "Payment flow: bank details → …" → ["Payment flow", "bank details → …"]; the part after the colon is the short outline. */
const splitTitle = (title: string): [string, string] => {
  const i = title.indexOf(": ");
  return i > 0 ? [title.slice(0, i), title.slice(i + 2)] : [title, ""];
};

const BundleTag = ({ parts }: { parts: number }) => (
  <span className="inline-flex h-6 items-center rounded-full bg-info-soft px-2 text-xs font-semibold whitespace-nowrap text-info-text">Bundle · {parts} parts</span>
);

/** The one training worth doing next: the backing is the headline, everything else is one line. */
function Suggested({ t }: { t: Training }) {
  const [name, outline] = splitTitle(t.title);
  return (
    <article title={t.description ?? undefined} className="grid grid-cols-[auto_1fr] items-center gap-6 rounded-lg border border-primary-line bg-primary-soft px-6 py-5">
      <div className="grid justify-items-center text-primary-text tabular-nums">
        <span className="text-5xl leading-none font-bold">{t.asked_by}</span>
        <span className="mt-1 text-sm font-medium whitespace-nowrap">people asked</span>
      </div>
      <div className="grid gap-1.5">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="m-0 text-xl leading-snug font-semibold">{name}</h3>
          {t.bundle_of.length > 0 && <BundleTag parts={t.bundle_of.length} />}
        </div>
        {outline && <p className="m-0">{outline}</p>}
        <p className="m-0 text-sm text-muted tabular-nums">
          {t.asked_count} questions · {t.roles.length ? t.roles.join(", ") : "Everyone"}
        </p>
      </div>
    </article>
  );
}

function Row({ t }: { t: Training }) {
  const [name] = splitTitle(t.title);
  return (
    <li title={t.description ?? undefined} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-4 border-t border-line px-4 py-2.5">
      <span className="font-semibold tabular-nums">
        {t.asked_by} <span className="text-sm font-normal text-muted">people</span>
      </span>
      <span className="flex min-w-0 flex-wrap items-center gap-2">
        <span>{name}</span>
        {t.bundle_of.length > 0 && <BundleTag parts={t.bundle_of.length} />}
      </span>
      <span className="text-sm whitespace-nowrap text-muted tabular-nums">{t.asked_count} questions</span>
    </li>
  );
}
