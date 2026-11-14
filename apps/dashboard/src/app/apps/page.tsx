import { appAnlegen, domainsSpeichern, funktionenImportieren } from "@/app/actions";
import { Shell, feld, karte, knopf } from "@/components/Shell";
import { getOrgContext } from "@/lib/org";

export default function AppsPage({ searchParams }: PageProps<"/apps">) {
  return (
    <Shell
      title="Apps & Funktionen"
      intro="Auf welchen Seiten Lotse läuft und welche Funktionen es dort gibt. Die Funktionsliste ist das App-Wissen, mit dem Lotse zeigt, wo man klicken muss."
    >
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

const MELDUNG: Record<string, string> = {
  json: "Das ist kein gültiges JSON.",
  format: "Das JSON passt nicht zum Format: Liste mit name, description, route, clickPath (Liste), requiredRole (Liste, optional).",
};

type Feature = { id: number; name: string; route: string; click_path: string[]; description: string | null; required_roles: string[] | null };

async function Inhalt({ searchParams }: { searchParams: PageProps<"/apps">["searchParams"] }) {
  const [{ supabase, isAdmin }, sp] = await Promise.all([getOrgContext(), searchParams]);
  const { data: apps } = await supabase
    .from("apps")
    .select("id, name, domains, app_features(id, name, route, click_path, description, required_roles)")
    .order("name");

  return (
    <div className="flex flex-col gap-6">
      {typeof sp.fehler === "string" && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{MELDUNG[sp.fehler]}</p>}
      {typeof sp.ok === "string" && <p className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">{sp.ok} Funktionen übernommen.</p>}

      {(apps ?? []).map((app) => {
        const features = ((app.app_features ?? []) as Feature[]).sort((a, b) => a.id - b.id);
        return (
          <section key={app.id} className={karte}>
            <div className="flex flex-wrap items-baseline gap-3">
              <h2 className="text-lg font-semibold">{app.name}</h2>
              <span className="text-sm text-zinc-500">{features.length} Funktionen</span>
            </div>

            {isAdmin ? (
              <form action={domainsSpeichern} className="mt-3 flex flex-wrap items-end gap-2">
                <input type="hidden" name="appId" value={app.id} />
                <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
                  Domains (mit Komma getrennt)
                  <input name="domains" defaultValue={app.domains.join(", ")} className={feld} />
                </label>
                <button className={knopf}>Speichern</button>
              </form>
            ) : (
              <p className="mt-2 text-sm text-zinc-500">Domains: {app.domains.join(", ") || "–"}</p>
            )}

            <table className="mt-4 w-full text-left text-sm">
              <thead className="text-zinc-500">
                <tr>
                  <th className="py-1 pr-3 font-normal">Funktion</th>
                  <th className="py-1 pr-3 font-normal">Klickpfad</th>
                  <th className="py-1 pr-3 font-normal">Rollen</th>
                </tr>
              </thead>
              <tbody>
                {features.map((f) => (
                  <tr key={f.id} className="border-t border-zinc-100 align-top dark:border-zinc-900">
                    <td className="py-2 pr-3">
                      <div className="font-medium">{f.name}</div>
                      {f.description && <div className="text-zinc-500">{f.description}</div>}
                      <div className="font-mono text-xs text-zinc-400">{f.route}</div>
                    </td>
                    <td className="py-2 pr-3">{f.click_path.join(" → ")}</td>
                    <td className="py-2 pr-3">{f.required_roles?.join(", ") ?? "alle"}</td>
                  </tr>
                ))}
              </tbody>
            </table>

            {isAdmin && (
              <details className="mt-4" open={sp.app === app.id && typeof sp.fehler === "string"}>
                <summary className="cursor-pointer text-sm font-medium">Funktionsliste als JSON ersetzen</summary>
                <form action={funktionenImportieren} className="mt-2 flex flex-col gap-2">
                  <input type="hidden" name="appId" value={app.id} />
                  <textarea name="json" rows={8} required className={`${feld} font-mono`} defaultValue={JSON.stringify(features.map(alsJson), null, 2)} />
                  <button className={`${knopf} self-start`}>Übernehmen</button>
                </form>
              </details>
            )}
          </section>
        );
      })}

      {isAdmin && (
        <form action={appAnlegen} className={`${karte} flex flex-wrap items-end gap-2`}>
          <label className="flex flex-col gap-1 text-sm">
            Neue App
            <input name="name" required placeholder="z. B. EBV-Portal" className={feld} />
          </label>
          <label className="flex min-w-64 flex-1 flex-col gap-1 text-sm">
            Domains
            <input name="domains" placeholder="localhost:3200" className={feld} />
          </label>
          <button className={knopf}>Anlegen</button>
        </form>
      )}
    </div>
  );
}

const alsJson = (f: Feature) => ({
  name: f.name,
  description: f.description ?? "",
  route: f.route,
  clickPath: f.click_path,
  requiredRole: f.required_roles,
});
