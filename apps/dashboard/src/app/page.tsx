import Link from "next/link";
import { Shell } from "@/components/Shell";
import { Card, Footnote, StatTile } from "@/components/ui";
import { bewerte, type InsightRow } from "@/lib/insights";
import { getOrgContext } from "@/lib/org";

export default function DashboardHome() {
  return (
    <Shell href="/" title="Übersicht" intro="Wir finden Schwachstellen in der Oberfläche, nicht in Menschen.">
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
      <div className="grid grid-cols-6 gap-4">
        <StatTile tone="ink" className="col-span-3" href="/erkenntnisse?filter=improve" value={anzahl("improve")} text="Stellen, an denen die App sich ändern sollte" cta="Zu den Erkenntnissen" />
        <StatTile className="col-span-3" href="/erkenntnisse?filter=train" value={anzahl("train")} text="Stellen mit Schulungsbedarf" cta="Zu den Erkenntnissen" />
        <StatTile className="col-span-2" href="/apps" value={`${apps} / ${features}`} text="Apps / Funktionen im App-Wissen" cta="Zu Apps & Funktionen" />
        <StatTile className="col-span-2" href="/team" value={String(members)} text="Personen in der Organisation" cta="Zum Team" />
        <StatTile className="col-span-2" href="/schulungen" value={String(trainings)} text="Schulungen im Katalog" cta="Zu den Schulungen" />
      </div>
      {bewertet.length === 0 && (
        <Card className="grid gap-4">
          <div>
            <h2 className="m-0 text-xl font-semibold">Noch keine Daten</h2>
            <p className="mt-1 mb-0 text-muted">Erkenntnisse erscheinen, sobald mindestens 5 Personen eine Funktion genutzt haben. So geht es los:</p>
          </div>
          <ol className="m-0 grid list-none grid-cols-3 gap-4 p-0">
            {[["App eintragen", "/apps", "Zu Apps & Funktionen"], ["Wissen hinzufügen", "/wissen", "Zum Wissen"], ["Team einladen", "/team", "Zum Team"]].map(([t, h, l], i) => (
              <li key={h} className="grid justify-items-start gap-2 rounded-[10px] border border-line p-[18px]">
                <span className="text-xs font-semibold text-muted">Schritt {i + 1}</span>
                <span className="font-semibold">{t}</span>
                <Link href={h} className="font-semibold">{l}</Link>
              </li>
            ))}
          </ol>
        </Card>
      )}
      <Footnote>Gruppen unter 5 Personen bleiben unsichtbar.</Footnote>
    </>
  );
}
