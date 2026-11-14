import { Shell, karte } from "@/components/Shell";
import { bewerte, prozent, type FeatureInsight, type InsightRow } from "@/lib/insights";
import { getOrgContext } from "@/lib/org";

export default function InsightsPage() {
  return (
    <Shell
      title="Erkenntnisse"
      intro="Wo die Apps Menschen verlieren — zusammengefasst, nie je Person. Gruppen unter 5 Personen bleiben unsichtbar."
    >
      <Inhalt />
    </Shell>
  );
}

const URTEIL = {
  app: { label: "App verbessern", farbe: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  schulung: { label: "Schulung", farbe: "bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300" },
  ok: { label: "Läuft", farbe: "bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300" },
} as const;

async function Inhalt() {
  const { supabase, isAdmin } = await getOrgContext();
  if (!isAdmin) return <p className={karte}>Erkenntnisse sehen nur Admins der Organisation.</p>;

  const [{ data: rows }, { data: apps }, { data: trainings }] = await Promise.all([
    supabase.from("insights").select("app_id, feature, role, metric, value, persons"),
    supabase.from("apps").select("id, name").order("name"),
    supabase.from("training_catalog").select("title, topics, url"),
  ]);
  const features = bewerte((rows ?? []) as InsightRow[]);
  if (!features.length) return <p className={karte}>Noch keine Erkenntnisse mit mindestens 5 Personen.</p>;

  const zahl = (v: FeatureInsight["verdict"]) => features.filter((f) => f.verdict === v).length;
  return (
    <div className="flex flex-col gap-8">
      <div className="grid gap-4 sm:grid-cols-3">
        {(["app", "schulung", "ok"] as const).map((v) => (
          <div key={v} className={karte}>
            <p className="text-3xl font-semibold">{zahl(v)}</p>
            <p className="text-sm text-zinc-600 dark:text-zinc-400">{URTEIL[v].label}</p>
          </div>
        ))}
      </div>

      {(apps ?? []).map((app) => {
        const eigene = features.filter((f) => f.appId === app.id);
        if (!eigene.length) return null;
        return (
          <section key={app.id} className="flex flex-col gap-3">
            <h2 className="text-lg font-semibold">{app.name}</h2>
            {eigene.map((f) => (
              <article key={`${f.feature}|${f.role}`} className={karte}>
                <div className="flex flex-wrap items-center gap-3">
                  <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${URTEIL[f.verdict].farbe}`}>{URTEIL[f.verdict].label}</span>
                  <h3 className="font-medium">{f.feature}</h3>
                  <span className="text-sm text-zinc-500">
                    {f.role ? `Rolle ${f.role} · ` : ""}
                    {f.persons} Personen
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
                  <Wert label="Feststecken" wert={prozent(f.stuckRate)} />
                  <Wert label="Trotz Hinweis wieder fest" wert={prozent(f.stillStuckAfterHint)} />
                  <Wert label="Abgebrochen" wert={prozent(f.abandonedFlow)} />
                  <Wert label="Fragen an Lotse" wert={f.questions === undefined ? "–" : String(f.questions)} />
                </dl>
                <p className="mt-3 text-sm">{empfehlung(f, trainings ?? [])}</p>
              </article>
            ))}
          </section>
        );
      })}
    </div>
  );
}

function Wert({ label, wert }: { label: string; wert: string }) {
  return (
    <div>
      <dt className="text-zinc-500">{label}</dt>
      <dd className="font-medium">{wert}</dd>
    </div>
  );
}

function empfehlung(f: FeatureInsight, trainings: { title: string; topics: string[] }[]) {
  if (f.verdict === "app")
    return `Der Hinweis hilft hier nicht: ${prozent(f.stillStuckAfterHint)} hängen danach wieder fest. Das ist ein Problem der Oberfläche, keine Wissenslücke — „${f.feature}“ sollte einfacher werden.`;
  if (f.verdict === "schulung") {
    const passend = trainings.filter((t) => t.topics.includes(f.feature)).map((t) => `„${t.title}“`);
    return passend.length
      ? `Der Hinweis hilft, aber viele brauchen ihn. Passende Schulung: ${passend.join(", ")}.`
      : `Der Hinweis hilft, aber viele brauchen ihn. Noch keine Schulung zu „${f.feature}“ im Katalog.`;
  }
  return "Keine Auffälligkeit.";
}
