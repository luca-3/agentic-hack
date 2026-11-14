import Link from "next/link";
import { Shell } from "@/components/Shell";
import { PRODUCT_NAME } from "@/components/ui";
import { getOrgContext } from "@/lib/org";
import { auswerten, erledigen, funktionUebernehmen, verwerfen, wissenUebernehmen } from "./actions";

export default function LernenPage({ searchParams }: PageProps<"/lernen">) {
  return (
    <Shell
      href="/lernen"
      title="Lernen"
      intro={`Beim ersten Mal erkundet ${PRODUCT_NAME} die App (ein Admin startet die Erkundung in der Erweiterung). Danach lernt ${PRODUCT_NAME} aus der Nutzung. Vorschläge gelten erst, wenn ein Admin sie übernimmt.`}
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
  high: { text: "hoch", klasse: "bg-danger-soft text-danger-text" },
  medium: { text: "mittel", klasse: "bg-warn-soft text-warn-text" },
  low: { text: "niedrig", klasse: "bg-info-soft text-info-text" },
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
  { titel: `Hier irrt ${PRODUCT_NAME}`, passt: (z) => z.kind === "agent_error" },
  { titel: "Wissenslücken", passt: (z) => z.kind === "knowledge_gap" },
];

const karte = "rounded-lg border border-line bg-surface p-6";
const feld = "w-full rounded-xl border border-line-strong bg-input p-3 text-base text-text";
const knopf = "inline-flex h-11 cursor-pointer items-center rounded-full border border-primary bg-primary px-[18px] text-base font-semibold text-on-primary hover:bg-primary-hover";
const rot = "m-0 rounded-[10px] border border-danger-line bg-danger-soft px-4 py-3.5 font-semibold text-text";
const gruen = "m-0 rounded-[10px] border border-ok-line bg-ok-soft px-4 py-3.5 font-semibold text-text";
const zweit = "inline-flex h-11 cursor-pointer items-center rounded-full border border-line-strong bg-surface px-[18px] text-base font-semibold text-text hover:bg-surface-2";
const UUID = /^[0-9a-f-]{36}$/i;
const str = (v: unknown) => (typeof v === "string" ? v : "");
const kurz = (s: string, n = 300) => (s.length > n ? `${s.slice(0, n)} …` : s);

async function Inhalt({ searchParams }: { searchParams: PageProps<"/lernen">["searchParams"] }) {
  const [{ supabase, isAdmin }, sp] = await Promise.all([getOrgContext(), searchParams]);
  if (!isAdmin) return <p className="text-sm text-muted">Nur Admins sehen Lernvorschläge.</p>;

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
    `inline-flex h-10 items-center rounded-full border px-3.5 text-sm font-semibold no-underline ${aktiv ? "border-primary bg-primary text-on-primary" : "border-line-strong bg-surface text-text hover:bg-surface-2"}`;
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
        <span className="text-sm text-muted">
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
        <div className="flex gap-4 border-b border-line">
          {TABS.map((t) => (
            <Link
              key={t.status}
              href={link({ status: t.status })}
              className={`-mb-px border-b-2 px-1 pb-2 no-underline ${t.status === status ? "border-primary font-semibold text-text" : "border-transparent text-muted hover:text-text"}`}
            >
              {t.label}
            </Link>
          ))}
        </div>
      </div>

      {zeilen.length === 0 && (
        <p className="m-0 rounded-lg border border-dashed border-line-strong bg-surface p-6 text-muted">Starte die Erkundung in der {PRODUCT_NAME}-Erweiterung oder klicke ‚Jetzt auswerten‘.</p>
      )}

      {ABSCHNITTE.map((ab) => {
        const liste = zeilen.filter(ab.passt);
        return (
          <section key={ab.titel} className={karte}>
            <div className="flex items-baseline gap-3">
              <h2 className="m-0 text-xl font-semibold">{ab.titel}</h2>
              <span className="text-sm text-muted">{liste.length}</span>
            </div>
            {liste.length === 0 ? (
              <p className="mt-2 text-sm text-muted">Noch nichts gefunden.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {liste.map((z) => (
                  <li key={z.id} className="rounded-[10px] border border-line p-4">
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
        {str(p.route) && <div className="font-mono text-xs text-muted">{str(p.route)}</div>}
        {pfad.length > 0 && <div>{pfad.join(" → ")}</div>}
        {str(p.description) && <div className="text-muted">{str(p.description)}</div>}
      </div>
    );
    annehmen = { action: funktionUebernehmen, label: "Übernehmen" };
  } else if (z.kind === "design") {
    const s = SCHWERE[str(p.severity)];
    inhalt = (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {s && <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.klasse}`}>{s.text}</span>}
        <span className="font-medium">{REGEL[str(p.rule)] ?? "Sonstiges"}</span>
        {str(p.route) && <span className="font-mono text-xs text-muted">{str(p.route)}</span>}
        {str(p.elementLabel) && <span>„{str(p.elementLabel)}“</span>}
        {str(p.measured) && <span className="text-muted">Gemessen: {str(p.measured)}</span>}
      </div>
    );
  } else if (z.kind === "stale_feature") {
    inhalt = (
      <p className="mt-2">
        ‚{str(p.missingLabel)}‘ wurde länger nicht gesehen — Klickpfad von ‚{str(p.feature)}‘ prüfen.{" "}
        <Link href="/apps" className="font-semibold">
          Zu Apps &amp; Funktionen
        </Link>
      </p>
    );
  } else if (z.kind === "agent_error") {
    inhalt = (
      <div className="mt-2 flex flex-col gap-1">
        <div>
          Status: <span className="font-medium">{str(p.status) || "–"}</span>
          {str(p.route) && <span className="ml-3 font-mono text-xs text-muted">{str(p.route)}</span>}
        </div>
        {str(p.lastError) && <div className="text-muted">Letzter Fehler: {kurz(str(p.lastError))}</div>}
      </div>
    );
  }

  const knowledge = z.kind === "knowledge_gap";
  return (
    <form className="flex flex-col gap-1">
      <input type="hidden" name="id" value={z.id} />
      {filter}
      <div className="font-medium">{z.title}</div>
      {z.detail && <p className="text-muted">{z.detail}</p>}
      {meta.length > 0 && <p className="text-xs text-muted">{meta.join(" · ")}</p>}
      {inhalt}
      {knowledge && (
        <label className="mt-2 flex flex-col gap-1">
          Thema: <span className="font-medium">{str(p.topic) || z.title}</span>
          {offen ? (
            <textarea name="text" rows={6} defaultValue={str(p.draft)} className={feld} placeholder="Antwort für dieses Thema schreiben …" />
          ) : (
            str(p.draft) && <p className="whitespace-pre-wrap text-muted">{str(p.draft)}</p>
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
