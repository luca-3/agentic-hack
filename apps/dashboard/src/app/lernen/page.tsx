import Link from "next/link";
import { Shell, feld, karte, knopf } from "@/components/Shell";
import { getOrgContext } from "@/lib/org";
import { auswerten, erledigen, funktionUebernehmen, verwerfen, wissenUebernehmen } from "./actions";

export default function LernenPage({ searchParams }: PageProps<"/lernen">) {
  return (
    <Shell
      title="Lernen"
      intro="Beim ersten Mal erkundet Lotse die App (ein Admin startet die Erkundung in der Erweiterung). Danach lernt Lotse aus der Nutzung. Vorschläge gelten erst, wenn ein Admin sie übernimmt."
    >
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

const FEHLER: Record<string, string> = {
  server: "Server nicht erreichbar.",
  server_wissen: "Server nicht erreichbar oder Fehler beim Indexieren. Es wurde nichts gespeichert.",
  speichern: "Speichern hat nicht geklappt.",
  format: "Der Vorschlag hat ein ungültiges Format.",
  leer: "Bitte einen Text eingeben.",
  gross: "Der Text ist zu groß (höchstens 200 KB).",
};
const OK: Record<string, string> = {
  erledigt: "Als erledigt markiert.",
  verworfen: "Vorschlag verworfen.",
  funktion: "Funktion übernommen.",
  funktion_da: "Die Funktion gab es schon. Vorschlag als übernommen markiert.",
  wissen: "Als Wissen übernommen.",
};
const REGEL: Record<string, string> = {
  contrast: "Kontrast zu schwach",
  target_size: "Klickfläche zu klein",
  unlabeled_icon: "Symbol ohne Beschriftung",
  duplicate_label: "Gleiche Beschriftung doppelt",
  deep_path: "Zu viele Klicks",
  overloaded: "Seite überladen",
  dead_end: "Sackgasse",
  other: "Sonstiges",
};
const SCHWERE: Record<string, { text: string; klasse: string }> = {
  high: { text: "hoch", klasse: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-300" },
  medium: { text: "mittel", klasse: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200" },
  low: { text: "niedrig", klasse: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300" },
};
const TABS = [
  { status: "open", label: "Offen" },
  { status: "accepted", label: "Übernommen" },
  { status: "dismissed", label: "Verworfen" },
] as const;

type Zeile = {
  id: number;
  app_id: string | null;
  source: "explore" | "learn";
  kind: string;
  title: string;
  detail: string;
  payload: Record<string, unknown>;
  occurrences: number;
  persons: number;
};
const ABSCHNITTE: { titel: string; passt: (z: Zeile) => boolean }[] = [
  { titel: "Erste Analyse: Funktionen gefunden", passt: (z) => z.kind === "feature" && z.source === "explore" },
  { titel: "Erste Analyse: Design-Befunde", passt: (z) => z.kind === "design" },
  { titel: "Neue Funktionen aus der Nutzung", passt: (z) => z.kind === "feature" && z.source === "learn" },
  { titel: "Veraltete Klickpfade", passt: (z) => z.kind === "stale_feature" },
  { titel: "Hier irrt Lotse", passt: (z) => z.kind === "agent_error" },
  { titel: "Wissenslücken", passt: (z) => z.kind === "knowledge_gap" },
];

const rot = "rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300";
const gruen = "rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300";
const zweit = "rounded-md border border-zinc-300 px-3 py-2 text-sm hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900";
const UUID = /^[0-9a-f-]{36}$/i;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const kurz = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)} …` : s);

async function Inhalt({ searchParams }: { searchParams: PageProps<"/lernen">["searchParams"] }) {
  const [{ supabase, isAdmin }, sp] = await Promise.all([getOrgContext(), searchParams]);
  if (!isAdmin) return <p className="text-sm text-zinc-500">Nur Admins sehen Lernvorschläge.</p>;

  const app = typeof sp.app === "string" && UUID.test(sp.app) ? sp.app : "";
  const status = TABS.find((t) => t.status === sp.status)?.status ?? "open";
  let abfrage = supabase
    .from("lotse_suggestions")
    .select("id, app_id, source, kind, title, detail, payload, occurrences, persons")
    .eq("status", status)
    .order("occurrences", { ascending: false })
    .order("id", { ascending: false });
  if (app) abfrage = abfrage.eq("app_id", app);
  const [{ data: apps }, { data }] = await Promise.all([supabase.from("apps").select("id, name").order("name"), abfrage]);
  const appName = new Map((apps ?? []).map((a) => [a.id as string, a.name as string]));
  const zeilen = (data ?? []) as Zeile[];

  const link = (p: { app?: string; status?: string }) => {
    const q = new URLSearchParams();
    const a = p.app ?? app;
    const s = p.status ?? status;
    if (a) q.set("app", a);
    if (s !== "open") q.set("status", s);
    return `/lernen${q.size ? `?${q}` : ""}`;
  };
  const chip = (aktiv: boolean) =>
    `rounded-full border px-3 py-1 text-sm ${aktiv ? "border-zinc-900 bg-zinc-900 text-white dark:border-zinc-100 dark:bg-zinc-100 dark:text-zinc-900" : "border-zinc-300 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900"}`;
  const filter = (
    <>
      <input type="hidden" name="app" value={app} />
      <input type="hidden" name="status" value={status} />
    </>
  );

  return (
    <div className="flex flex-col gap-6">
      {typeof sp.fehler === "string" && <p className={rot}>{FEHLER[sp.fehler] ?? "Etwas ist schiefgelaufen."}</p>}
      {typeof sp.vorschlaege === "string" && (
        <p className={gruen}>
          {Number(sp.vorschlaege)} Vorschläge, {Number(sp.erkenntnisse ?? 0)} Erkenntnisse aktualisiert
        </p>
      )}
      {typeof sp.ok === "string" && OK[sp.ok] && <p className={gruen}>{OK[sp.ok]}</p>}

      <form action={auswerten} className="flex flex-wrap items-center gap-3">
        {filter}
        <button className={knopf}>Jetzt auswerten</button>
        <span className="text-sm text-zinc-500">
          Wertet die Nutzung aus{app ? ` für ${appName.get(app) ?? "diese App"}` : " für alle Apps"}.
        </span>
      </form>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={link({ app: "" })} className={chip(!app)}>
            Alle Apps
          </Link>
          {(apps ?? []).map((a) => (
            <Link key={a.id} href={link({ app: a.id })} className={chip(app === a.id)}>
              {a.name}
            </Link>
          ))}
        </div>
        <div className="flex gap-4 border-b border-zinc-200 text-sm dark:border-zinc-800">
          {TABS.map((t) => (
            <Link
              key={t.status}
              href={link({ status: t.status })}
              className={`-mb-px border-b-2 px-1 pb-2 ${t.status === status ? "border-zinc-900 font-medium dark:border-zinc-100" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:hover:text-zinc-100"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {zeilen.length === 0 && (
        <p className="text-sm text-zinc-500">Starte die Erkundung in der Lotse-Erweiterung oder klicke ‚Jetzt auswerten‘.</p>
      )}

      {ABSCHNITTE.map((ab) => {
        const liste = zeilen.filter(ab.passt);
        return (
          <section key={ab.titel} className={karte}>
            <div className="flex items-baseline gap-3">
              <h2 className="text-lg font-semibold">{ab.titel}</h2>
              <span className="text-sm text-zinc-500">{liste.length}</span>
            </div>
            {liste.length === 0 ? (
              <p className="mt-2 text-sm text-zinc-500">Noch nichts gefunden.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {liste.map((z) => (
                  <li key={z.id} className="rounded-md border border-zinc-200 p-3 text-sm dark:border-zinc-800">
                    <Karte z={z} appName={z.app_id ? appName.get(z.app_id) : undefined} offen={status === "open"} filter={filter} />
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function Karte({ z, appName, offen, filter }: { z: Zeile; appName?: string; offen: boolean; filter: React.ReactNode }) {
  const p = z.payload ?? {};
  const meta = [
    appName,
    z.occurrences > 0 && `${z.occurrences}× gesehen`,
    z.persons > 0 && `${z.persons} Personen`,
  ].filter(Boolean);

  let inhalt: React.ReactNode = null;
  let annehmen: { action: (fd: FormData) => Promise<void>; label: string } = { action: erledigen, label: "Erledigt" };
  if (z.kind === "feature") {
    const pfad = Array.isArray(p.clickPath) ? p.clickPath.filter((s) => typeof s === "string") : [];
    inhalt = (
      <div className="mt-2 flex flex-col gap-1">
        <div className="font-medium">{str(p.name)}</div>
        {str(p.route) && <div className="font-mono text-xs text-zinc-500">{str(p.route)}</div>}
        {pfad.length > 0 && <div>{pfad.join(" → ")}</div>}
        {str(p.description) && <div className="text-zinc-500">{str(p.description)}</div>}
      </div>
    );
    annehmen = { action: funktionUebernehmen, label: "Übernehmen" };
  } else if (z.kind === "design") {
    const s = SCHWERE[str(p.severity)];
    inhalt = (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {s && <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.klasse}`}>{s.text}</span>}
        <span className="font-medium">{REGEL[str(p.rule)] ?? "Sonstiges"}</span>
        {str(p.route) && <span className="font-mono text-xs text-zinc-500">{str(p.route)}</span>}
        {str(p.elementLabel) && <span>„{str(p.elementLabel)}“</span>}
        {str(p.measured) && <span className="text-zinc-500">Gemessen: {str(p.measured)}</span>}
      </div>
    );
  } else if (z.kind === "stale_feature") {
    inhalt = (
      <p className="mt-2">
        ‚{str(p.missingLabel)}‘ wurde länger nicht gesehen — Klickpfad von ‚{str(p.feature)}‘ prüfen.{" "}
        <Link href="/apps" className="underline">
          Zu Apps &amp; Funktionen
        </Link>
      </p>
    );
  } else if (z.kind === "agent_error") {
    inhalt = (
      <div className="mt-2 flex flex-col gap-1">
        <div>
          Status: <span className="font-medium">{str(p.status) || "–"}</span>
          {str(p.route) && <span className="ml-3 font-mono text-xs text-zinc-500">{str(p.route)}</span>}
        </div>
        {str(p.lastError) && <div className="text-zinc-500">Letzter Fehler: {kurz(str(p.lastError))}</div>}
      </div>
    );
  }

  const knowledge = z.kind === "knowledge_gap";
  return (
    <form className="flex flex-col gap-1">
      <input type="hidden" name="id" value={z.id} />
      {filter}
      <div className="font-medium">{z.title}</div>
      {z.detail && <p className="text-zinc-600 dark:text-zinc-400">{z.detail}</p>}
      {meta.length > 0 && <p className="text-xs text-zinc-500">{meta.join(" · ")}</p>}
      {inhalt}
      {knowledge && (
        <label className="mt-2 flex flex-col gap-1">
          Thema: <span className="font-medium">{str(p.topic) || z.title}</span>
          {offen ? (
            <textarea name="text" rows={6} defaultValue={str(p.draft)} className={feld} placeholder="Antwort für dieses Thema schreiben …" />
          ) : (
            str(p.draft) && <p className="whitespace-pre-wrap text-zinc-600 dark:text-zinc-400">{str(p.draft)}</p>
          )}
        </label>
      )}
      {offen && (
        <div className="mt-2 flex gap-2">
          {knowledge ? (
            <button formAction={wissenUebernehmen} className={knopf}>
              Als Wissen übernehmen
            </button>
          ) : (
            <button formAction={annehmen.action} className={knopf}>
              {annehmen.label}
            </button>
          )}
          <button formAction={verwerfen} className={zweit}>
            Verwerfen
          </button>
        </div>
      )}
    </form>
  );
}
