import Link from "next/link";
import { Shell } from "@/components/Shell";
import { ButtonLink, Card, Footnote, PRODUCT_NAME, StatTile } from "@/components/ui";
import { bewerte, type InsightRow } from "@/lib/insights";
import { getOrgContext } from "@/lib/org";

export default function DashboardHome() {
  return (
    <Shell href="/" title="Overview" intro="We find weak spots in the interface, not in people.">
      <Inhalt />
    </Shell>
  );
}

async function Inhalt() {
  const { supabase, isAdmin } = await getOrgContext();
  const zaehle = async (table: string) => (await supabase.from(table).select("*", { count: "exact", head: true })).count ?? 0;
  const [apps, features, members, trainings, { data: rows }] = await Promise.all([
    zaehle("apps"),
    zaehle("app_features"),
    zaehle("org_members"),
    zaehle("training_catalog"),
    supabase.from("insights").select("app_id, feature, role, metric, value, persons"),
  ]);
  const bewertet = bewerte((rows ?? []) as InsightRow[]);
  const anzahl = (v: "improve" | "train") => (isAdmin ? String(bewertet.filter((f) => f.verdict === v).length) : "–");

  return (
    <>
      <Card className="flex flex-wrap items-center gap-4 border-primary-line bg-primary-soft">
        <div className="min-w-64 flex-1">
          <h2 className="m-0 text-lg font-semibold">Install the {PRODUCT_NAME} extension</h2>
          <p className="mt-1 mb-0 text-muted">{PRODUCT_NAME} runs in Chrome next to your apps. Download it and load it in four short steps.</p>
        </div>
        <ButtonLink href="/install">Install {PRODUCT_NAME}</ButtonLink>
      </Card>
      <div className="grid grid-cols-6 gap-4">
        <StatTile tone="ink" className="col-span-3" href="/insights?filter=improve" value={anzahl("improve")} text="Spots where the app should change" cta="Go to insights" />
        <StatTile className="col-span-3" href="/insights?filter=train" value={anzahl("train")} text="Spots that need training" cta="Go to insights" />
        <StatTile className="col-span-2" href="/apps" value={`${apps} / ${features}`} text="Apps / features in app knowledge" cta="Go to apps & features" />
        <StatTile className="col-span-2" href="/team" value={String(members)} text="People in the organization" cta="Go to team" />
        <StatTile className="col-span-2" href="/trainings" value={String(trainings)} text="Trainings in the catalog" cta="Go to trainings" />
      </div>
      {bewertet.length === 0 && (
        <Card className="grid gap-4">
          <div>
            <h2 className="m-0 text-xl font-semibold">No data yet</h2>
            <p className="mt-1 mb-0 text-muted">Insights appear once at least 5 people have used a feature. Here’s how to get started:</p>
          </div>
          <ol className="m-0 grid list-none grid-cols-3 gap-4 p-0">
            {[["Add an app", "/apps", "Go to apps & features"], ["Add knowledge", "/knowledge", "Go to knowledge"], ["Invite your team", "/team", "Go to team"]].map(([t, h, l], i) => (
              <li key={h} className="grid justify-items-start gap-2 rounded-[10px] border border-line p-[18px]">
                <span className="text-xs font-semibold text-muted">Step {i + 1}</span>
                <span className="font-semibold">{t}</span>
                <Link href={h} className="font-semibold">{l}</Link>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <Footnote>Groups of fewer than 5 people stay hidden.</Footnote>
    </>
  );
}
