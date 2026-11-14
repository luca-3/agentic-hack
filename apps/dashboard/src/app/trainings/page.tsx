import { schulungAnlegen } from "@/app/actions";
import { Shell } from "@/components/Shell";
import { EmptyState, Field, Footnote, FormActions, IconExternal, Notice, PRODUCT_NAME, cx } from "@/components/ui";
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

const chip = "rounded-sm border border-line-strong px-2 py-0.5 text-xs font-medium text-text";
const byBacking = (a: Training, b: Training) => (b.asked_by ?? 0) - (a.asked_by ?? 0) || (b.asked_count ?? 0) - (a.asked_count ?? 0);

export default function SchulungenPage({ searchParams }: PageProps<"/trainings">) {
  return (
    <Shell
      href="/trainings"
      title="Trainings"
      intro={`Trainings come from your employees' questions: when many people ask ${PRODUCT_NAME} about the same spot, it becomes a training – backed by how many asked.`}
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
  const singles = new Map(fromQuestions.filter((t) => !t.bundle_of.length).map((t) => [t.title, t]));
  const appNames = new Map((apps ?? []).map((a) => [a.id as string, a.name as string]));

  return (
    <>
      {typeof sp.ok === "string" && <Notice tone="success" title="Training created." />}
      <div className={isAdmin ? "grid grid-cols-[1.6fr_1fr] items-start gap-6" : "grid"}>
        <div className="grid gap-8">
          <section className="grid gap-3">
            <div className="grid gap-1">
              <h2 className="m-0 text-xl font-semibold">From employee questions</h2>
              <p className="m-0 text-muted">
                Sorted by how many people asked. Bundles combine related topics into one session, e.g. a whole workflow.
              </p>
            </div>
            <Footnote>Aggregates only – questions and distinct people, never who asked. Fewer than {MIN_PEOPLE} people: hidden.</Footnote>
            {fromQuestions.length ? (
              fromQuestions.map((t) => <QuestionTraining key={t.id} t={t} singles={singles} appName={t.app_id ? appNames.get(t.app_id) : undefined} />)
            ) : (
              <EmptyState title="No trainings from questions yet." text={`They appear once at least ${MIN_PEOPLE} people asked ${PRODUCT_NAME} about the same topic.`} />
            )}
          </section>

          <section className="grid gap-3">
            <h2 className="m-0 text-xl font-semibold">Catalog</h2>
            {!manual.length && <EmptyState title="No trainings added manually yet." text={isAdmin ? "Create one on the right." : undefined} />}
            {manual.map((t) => (
              <article key={t.id} className="grid gap-1.5 rounded-lg border border-line bg-surface px-5 py-[18px]">
                <h3 className="m-0 text-lg font-semibold">{t.title}</h3>
                {t.url && <a href={t.url} className="inline-flex items-center gap-1.5 justify-self-start font-mono">{t.url.replace(/^https?:\/\//, "")}<IconExternal /></a>}
                <p className="m-0 text-muted">Topics: {t.topics.join(", ") || "–"}</p>
              </article>
            ))}
          </section>
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

function QuestionTraining({ t, singles, appName }: { t: Training; singles: Map<string, Training>; appName?: string }) {
  const bundle = t.bundle_of.length > 0;
  return (
    <article id={`training-${t.id}`} className={cx("grid scroll-mt-6 gap-3 rounded-lg border bg-surface px-6 py-5", bundle ? "border-primary-line" : "border-line")}>
      <div className="flex flex-wrap items-center gap-2">
        {bundle && (
          <span className="inline-flex h-7 items-center gap-1.5 rounded-full bg-info-soft px-2.5 text-sm font-semibold text-info-text">
            <span className="size-2 rounded-[2px] bg-current" />Bundle · {t.bundle_of.length} parts
          </span>
        )}
        <span className="inline-flex h-7 items-center rounded-full bg-primary-soft px-2.5 text-sm font-semibold whitespace-nowrap text-primary-text tabular-nums">
          Asked by {t.asked_by} people · {t.asked_count} questions
        </span>
      </div>
      <h3 className="m-0 text-lg leading-snug font-semibold">{t.title}</h3>
      {t.description && <p className="m-0 text-pretty">{t.description}</p>}
      {bundle && (
        <div className="grid gap-1.5 rounded-md bg-surface-2 px-4 py-3">
          <p className="m-0 text-sm font-semibold">Included trainings</p>
          <ol className="m-0 grid gap-1 pl-5">
            {t.bundle_of.map((part) => {
              const single = singles.get(part);
              return (
                <li key={part}>
                  {single ? <a href={`#training-${single.id}`}>{part}</a> : part}
                  {single && <span className="text-sm text-muted tabular-nums"> · {single.asked_by} people</span>}
                </li>
              );
            })}
          </ol>
        </div>
      )}
      <dl className="m-0 grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1.5 text-sm">
        <dt className="text-muted">Roles</dt>
        <dd className="m-0 flex flex-wrap gap-1.5">
          {t.roles.length ? t.roles.map((r) => <span key={r} className={chip}>{r}</span>) : <span>Everyone</span>}
        </dd>
        <dt className="text-muted">Features</dt>
        <dd className="m-0 flex flex-wrap gap-1.5">
          {t.topics.map((f) => <span key={f} className={chip}>{f}</span>)}
        </dd>
      </dl>
      <p className="m-0 text-sm text-muted">
        From employee questions{appName ? ` in ${appName}` : ""}{t.period_days ? `, last ${t.period_days} days` : ""}
      </p>
    </article>
  );
}
