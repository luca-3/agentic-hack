import Link from "next/link";
import { Shell } from "@/components/Shell";
import { CompareBars, Footnote, IconLock, Notice, PRODUCT_NAME, Table, Td, Th, VerdictBadge, cx, num, pct, toPct } from "@/components/ui";
import { VERDICT, VERDICTS, bewerte, prozent, type FeatureInsight, type InsightRow, type Verdict } from "@/lib/insights";
import { getOrgContext } from "@/lib/org";

const UUID = /^[0-9a-f-]{36}$/i;

export default function ErkenntnissePage({ searchParams }: PageProps<"/insights">) {
  const appParam = searchParams.then((sp) => (typeof sp.app === "string" && UUID.test(sp.app) ? sp.app : undefined));
  return (
    <Shell
      href="/insights"
      title="Insights"
      intro="Where do people get stuck – and is it the app or missing know-how? We find weak spots in the interface, not in people."
      meta="Last 30 days"
      appParam={appParam}
    >
      <Inhalt searchParams={searchParams} appParam={appParam} />
    </Shell>
  );
}

async function Inhalt({ searchParams, appParam }: { searchParams: PageProps<"/insights">["searchParams"]; appParam: Promise<string | undefined> }) {
  const [{ supabase, isAdmin, orgId }, sp, app] = await Promise.all([getOrgContext(), searchParams, appParam]);
  if (!isAdmin) {
    return (
      <div role="status" className="flex max-w-[640px] items-start gap-3.5 rounded-lg border border-priv-line bg-priv-soft px-6 py-[22px] text-priv-strong">
        <IconLock className="mt-0.5 size-[22px] shrink-0 text-priv-accent" />
        <div>
          <p className="m-0 text-[17px] font-semibold">Only organization admins can see insights.</p>
          <p className="mt-1 mb-0 text-priv-text">If you have questions, ask an admin at the office.</p>
        </div>
      </div>
    );
  }

  const [{ data: rows }, { data: apps }, { data: trainings }, { data: angebote }] = await Promise.all([
    supabase.from("insights").select("app_id, feature, role, metric, value, persons"),
    supabase.from("apps").select("id, name").order("name"),
    supabase.from("training_catalog").select("title, topics"),
    supabase.rpc("offer_helpfulness", { org: orgId }),
  ]);
  const alle = bewerte((rows ?? []) as InsightRow[]);
  const scoped = app ? alle.filter((f) => f.appId === app) : alle;
  const filter = VERDICTS.find((v) => v === sp.filter);
  const shown = filter ? scoped.filter((f) => f.verdict === filter) : scoped;
  const link = (f?: Verdict) => {
    const q = new URLSearchParams();
    if (app) q.set("app", app);
    if (f) q.set("filter", f);
    return `/insights${q.size ? `?${q}` : ""}`;
  };

  return (
    <>
      <nav aria-label="Filter by verdict" className="grid grid-cols-3 gap-4">
        {VERDICTS.map((v) => {
          const on = filter === v;
          return (
            <Link key={v} href={link(on ? undefined : v)} aria-current={on ? "true" : undefined}
              className={cx("grid gap-2 rounded-lg border border-line bg-surface px-[22px] py-5 text-text no-underline hover:border-line-strong", on && "shadow-[inset_0_0_0_2px_var(--color-primary)]")}>
              <span className="flex items-center justify-between gap-3">
                <VerdictBadge verdict={v} />
                <span className="text-4xl leading-none font-semibold tabular-nums">{scoped.filter((f) => f.verdict === v).length}</span>
              </span>
              <span className="text-sm text-muted">{VERDICT[v].desc}</span>
            </Link>
          );
        })}
      </nav>
      {filter && (
        <div className="flex items-center gap-3">
          <span>Filtered: <strong>{VERDICT[filter].label}</strong></span>
          <Link href={link()} className="inline-flex h-10 items-center rounded-full border border-line-strong bg-surface px-3.5 text-sm font-semibold text-text no-underline hover:bg-surface-2">Show all</Link>
        </div>
      )}

      {alle.length === 0 ? (
        <Notice title="No insights yet">
          <p className="m-0 text-muted">Insights appear once at least 5 people have used a feature. That usually takes one to two weeks.</p>
        </Notice>
      ) : (
        (apps ?? []).map((a) => {
          const eigene = shown.filter((f) => f.appId === a.id);
          if (!eigene.length) return null;
          return (
            <section key={a.id} className="grid gap-3.5">
              <div className="flex items-baseline gap-3 border-b border-line pb-2.5">
                <h2 className="m-0 text-[21px] font-semibold">{a.name}</h2>
                <span className="text-sm text-muted">{eigene.length} {eigene.length === 1 ? "feature" : "features"} with insights</span>
              </div>
              <div className="grid grid-cols-2 gap-4">
                {eigene.map((f) => <Karte key={`${f.feature}|${f.role}`} f={f} trainings={trainings ?? []} />)}
              </div>
            </section>
          );
        })
      )}

      <Angebote rows={((angebote ?? []) as Angebot[]).filter((r) => !app || r.app_id === app)} appName={new Map((apps ?? []).map((a) => [a.id as string, a.name as string]))} />

      <Footnote>Groups of fewer than 5 people stay hidden.</Footnote>
    </>
  );
}

/** offer_helpfulness(): per app + intent, only groups of ≥ 5 people (enforced in SQL). Counts are offers. */
type Angebot = { app_id: string; intent: string; persons: number; offers: number; up: number; down: number; declined: number };

function Angebote({ rows, appName }: { rows: Angebot[]; appName: Map<string, string> }) {
  const anteil = (n: number, of: number) => (of ? `${Math.round((n / of) * 100)} %` : "–");
  const sorted = [...rows].sort((a, b) => b.down + b.declined - (a.down + a.declined) || b.offers - a.offers);
  return (
    <section className="grid gap-3">
      <div>
        <h2 className="m-0 text-xl font-semibold">Helpful offers per feature</h2>
        <p className="mt-1 mb-0 text-muted">
          When {PRODUCT_NAME} offers help on its own: how often people found it helpful, not helpful or declined it. Last 30 days, groups of at least 5 people only.
        </p>
      </div>
      <Table>
        <thead>
          <tr>
            <Th>Feature</Th>
            <Th>App</Th>
            <Th className="text-right">People</Th>
            <Th className="text-right">Offers</Th>
            <Th className="text-right">👍 Helpful</Th>
            <Th className="text-right">👎 Not helpful</Th>
            <Th className="text-right">Declined</Th>
            <Th className="text-right">No rating</Th>
          </tr>
        </thead>
        <tbody>
          {sorted.length === 0 && (
            <tr><Td colSpan={8} className="text-center text-muted">No feature has offers from at least 5 people yet.</Td></tr>
          )}
          {sorted.map((r) => (
            <tr key={`${r.app_id}|${r.intent}`} className="hover:bg-surface-hover">
              <Td className="font-semibold">{r.intent}</Td>
              <Td>{appName.get(r.app_id) ?? "–"}</Td>
              <Td className="text-right tabular-nums">{r.persons}</Td>
              <Td className="text-right tabular-nums">{r.offers}</Td>
              <Td className="text-right font-semibold text-primary-text tabular-nums">{anteil(r.up, r.offers)}</Td>
              <Td className="text-right tabular-nums">{anteil(r.down, r.offers)}</Td>
              <Td className="text-right tabular-nums">{anteil(r.declined, r.offers)}</Td>
              <Td className="text-right text-muted tabular-nums">{anteil(r.offers - r.up - r.down - r.declined, r.offers)}</Td>
            </tr>
          ))}
        </tbody>
      </Table>
    </section>
  );
}

function Karte({ f, trainings }: { f: FeatureInsight; trainings: { title: string; topics: string[] }[] }) {
  return (
    <article className="flex flex-col gap-4 rounded-lg border border-line bg-surface px-6 py-[22px]">
      <div className="flex flex-wrap items-center gap-2.5">
        <VerdictBadge verdict={f.verdict} />
        <span className="ml-auto flex items-center gap-2 text-sm text-muted">
          {f.role && <span className="rounded-sm border border-line-strong px-2 py-0.5 text-xs font-medium text-text">Role {f.role}</span>}
          {f.persons} people
        </span>
      </div>
      <h3 className="m-0 text-lg leading-snug font-semibold">{f.feature}</h3>
      <CompareBars stuck={toPct(f.stuckRate)} stuckAgain={toPct(f.stillStuckAfterHint)} />
      <dl className="m-0 grid grid-cols-2 gap-3">
        <div className="flex justify-between gap-2 rounded-md border border-line px-3 py-2.5"><dt className="text-sm text-muted">Abandoned</dt><dd className="m-0 font-semibold tabular-nums">{pct(toPct(f.abandonedFlow))}</dd></div>
        <div className="flex justify-between gap-2 rounded-md border border-line px-3 py-2.5"><dt className="text-sm text-muted">Questions to {PRODUCT_NAME}</dt><dd className="m-0 font-semibold tabular-nums">{num(f.questions)}</dd></div>
      </dl>
      <p className="m-0 rounded-md bg-surface-2 px-3.5 py-3 text-pretty">{empfehlung(f, trainings)}</p>
    </article>
  );
}

function empfehlung(f: FeatureInsight, trainings: { title: string; topics: string[] }[]) {
  if (f.verdict === "improve")
    return `The hint doesn't help here: ${prozent(f.stillStuckAfterHint)} get stuck again afterwards. That's an interface problem, not a knowledge gap – “${f.feature}” should be simpler.`;
  if (f.verdict === "train") {
    const passend = trainings.filter((t) => t.topics.includes(f.feature)).map((t) => `“${t.title}”`);
    return passend.length ? `Matching training${passend.length > 1 ? "s" : ""}: ${passend.join(", ")}.` : `No training on “${f.feature}” in the catalog yet.`;
  }
  return `Going well. ${PRODUCT_NAME} rarely needs to show hints here.`;
}
