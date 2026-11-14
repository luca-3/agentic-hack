import { schulungAnlegen } from "@/app/actions";
import { Shell, feld, karte, knopf } from "@/components/Shell";
import { getOrgContext } from "@/lib/org";

export default function TrainingsPage() {
  return (
    <Shell
      title="Schulungen"
      intro="Der Schulungskatalog der Organisation. Die Themen sind Funktionsnamen — so ordnet Lotse eine Schulung den Stolperstellen zu."
    >
      <Inhalt />
    </Shell>
  );
}

async function Inhalt() {
  const { supabase, isAdmin } = await getOrgContext();
  const { data: trainings } = await supabase.from("training_catalog").select("id, title, topics, url").order("title");

  return (
    <div className="flex flex-col gap-4">
      {(trainings ?? []).map((t) => (
        <div key={t.id} className={karte}>
          <h2 className="font-medium">{t.url ? <a href={t.url} className="underline">{t.title}</a> : t.title}</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">Themen: {t.topics.join(", ") || "–"}</p>
        </div>
      ))}
      {isAdmin && (
        <form action={schulungAnlegen} className={`${karte} flex flex-col gap-2`}>
          <label className="flex flex-col gap-1 text-sm">
            Titel
            <input name="title" required className={feld} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Themen (Funktionsnamen, mit Komma getrennt)
            <input name="topics" placeholder="Schlüssel finden, CORPUS-Chat fragen" className={feld} />
          </label>
          <label className="flex flex-col gap-1 text-sm">
            Link (optional)
            <input name="url" type="url" className={feld} />
          </label>
          <button className={`${knopf} self-start`}>Schulung anlegen</button>
        </form>
      )}
    </div>
  );
}
