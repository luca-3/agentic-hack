import Link from "next/link";
import { Shell, karte } from "@/components/Shell";
import { bewerte, type InsightRow } from "@/lib/insights";
import { getOrgContext } from "@/lib/org";

export default function DashboardHome() {
  return (
    <Shell title="Übersicht" intro="Lotse arbeitet die Leute ein — das Dashboard zeigt, wo die Apps sie verlieren.">
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

  const kacheln = [
    { href: "/insights", wert: isAdmin ? bewertet.filter((f) => f.verdict === "app").length : "–", text: "Stellen, an denen die App sich ändern sollte" },
    { href: "/insights", wert: isAdmin ? bewertet.filter((f) => f.verdict === "schulung").length : "–", text: "Stellen mit Schulungsbedarf" },
    { href: "/apps", wert: `${apps} / ${features}`, text: "Apps / Funktionen im App-Wissen" },
    { href: "/team", wert: members, text: "Personen in der Organisation" },
    { href: "/trainings", wert: trainings, text: "Schulungen im Katalog" },
  ];

  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      {kacheln.map((k) => (
        <Link key={k.text} href={k.href} className={`${karte} hover:bg-zinc-50 dark:hover:bg-zinc-900`}>
          <p className="text-3xl font-semibold">{k.wert}</p>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{k.text}</p>
        </Link>
      ))}
    </div>
  );
}
