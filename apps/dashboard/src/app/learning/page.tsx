import { LOTSE_DEFAULTS } from "@lotse/shared";
import Link from "next/link";
import { Suspense } from "react";
import { Shell } from "@/components/Shell";
import { PRODUCT_NAME } from "@/components/ui";
import { getOrgContext, type OrgContext } from "@/lib/org";
import { auswerten, erledigen, funktionUebernehmen, gedaechtnisSetzen, verwerfen, wissenUebernehmen } from "./actions";

export default function LearningPage({ searchParams }: PageProps<"/learning">) {
  return (
    <Shell
      href="/learning"
      title="Learning"
      intro={`The first time, ${PRODUCT_NAME} explores the app (an admin starts the exploration in the extension). After that, ${PRODUCT_NAME} learns from usage. Suggestions only take effect once an admin accepts them.`}
    >
      <Inhalt searchParams={searchParams} />
    </Shell>
  );
}

const FEHLER: Record<string, string> = {
  server: "Server not reachable.",
  "server-knowledge": "Server not reachable or indexing failed. Nothing was saved.",
  save: "Saving didn't work.",
  format: "The suggestion has an invalid format.",
  empty: "Please enter some text.",
  "too-large": "The text is too large (200 KB max).",
};
const OK: Record<string, string> = {
  "memory-approved": "Memory approved – Valo uses it from now on.",
  "memory-rejected": "Memory rejected – Valo no longer uses it.",
  done: "Marked as done.",
  dismissed: "Suggestion dismissed.",
  feature: "Feature added.",
  "feature-exists": "The feature already existed. Suggestion marked as accepted.",
  knowledge: "Added as knowledge.",
};
const REGEL: Record<string, string> = {
  contrast: "Contrast too low",
  target_size: "Click target too small",
  unlabeled_icon: "Icon without a label",
  duplicate_label: "Duplicate label",
  deep_path: "Too many clicks",
  overloaded: "Page overloaded",
  dead_end: "Dead end",
  other: "Other",
};
const SCHWERE: Record<string, { text: string; klasse: string }> = {
  high: { text: "high", klasse: "bg-danger-soft text-danger-text" },
  medium: { text: "medium", klasse: "bg-warn-soft text-warn-text" },
  low: { text: "low", klasse: "bg-info-soft text-info-text" },
};
const TABS = [
  { status: "open", label: "Open" },
  { status: "accepted", label: "Accepted" },
  { status: "dismissed", label: "Dismissed" },
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
  { titel: "First analysis: features found", passt: (z) => z.kind === "feature" && z.source === "explore" },
  { titel: "First analysis: design findings", passt: (z) => z.kind === "design" },
  { titel: "New features from usage", passt: (z) => z.kind === "feature" && z.source === "learn" },
  { titel: "Outdated click paths", passt: (z) => z.kind === "stale_feature" },
  { titel: `Where ${PRODUCT_NAME} gets it wrong`, passt: (z) => z.kind === "agent_error" },
  { titel: "Knowledge gaps", passt: (z) => z.kind === "knowledge_gap" },
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

async function Inhalt({ searchParams }: { searchParams: PageProps<"/learning">["searchParams"] }) {
  const [ctx, sp] = await Promise.all([getOrgContext(), searchParams]);
  const { supabase, isAdmin } = ctx;
  if (!isAdmin) return <p className="text-sm text-muted">Only admins can see learning suggestions.</p>;

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
    return `/learning${q.size ? `?${q}` : ""}`;
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
      {typeof sp.error === "string" && <p className={rot}>{FEHLER[sp.error] ?? "Something went wrong."}</p>}
      {typeof sp.suggestions === "string" && (
        <p className={gruen}>
          {Number(sp.suggestions)} suggestions, {Number(sp.insights ?? 0)} insights updated
        </p>
      )}
      {typeof sp.ok === "string" && OK[sp.ok] && <p className={gruen}>{OK[sp.ok]}</p>}

      <form action={auswerten} className="flex flex-wrap items-center gap-3">
        {filter}
        <button className={knopf}>Analyze now</button>
        <span className="text-sm text-muted">
          Analyzes usage{app ? ` for ${appName.get(app) ?? "this app"}` : " for all apps"}.
        </span>
      </form>

      <div className="flex flex-col gap-3">
        <div className="flex flex-wrap gap-2">
          <Link href={link({ app: "" })} className={chip(!app)}>
            All apps
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
        <p className="m-0 rounded-lg border border-dashed border-line-strong bg-surface p-6 text-muted">Start the exploration in the {PRODUCT_NAME} extension or click “Analyze now”.</p>
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
              <p className="mt-2 text-sm text-muted">Nothing found yet.</p>
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

      <Suspense key={app} fallback={<section className={karte}><p className="m-0 text-muted">Loading agent memory …</p></section>}>
        <Gedaechtnis ctx={ctx} app={app} appName={appName} filter={filter} />
      </Suspense>
    </div>
  );
}

type Memory = {
  id: number;
  appId: string | null;
  kind: string;
  topic: string;
  feature: string | null;
  content: string;
  source: "agent" | "learn_loop" | "admin";
  persons: number;
  negatives: number;
  status: "proposed" | "active" | "rejected" | "expired";
};
const MEMORY_KIND: Record<string, string> = {
  faq: "Common question",
  role_hint: "Role hint",
  pitfall: "Pitfall",
  path_hint: "Path hint",
  gap_resolution: "Answered gap",
};

/**
 * Agent memory (D-28, R-LRN-5): what Valo learned from usage, labeled and separate from the knowledge base.
 * Only entries backed by ≥ 5 people or written/approved by an admin are shown – never single persons.
 */
async function Gedaechtnis({ ctx, app, appName, filter }: { ctx: OrgContext; app: string; appName: Map<string, string>; filter: React.ReactNode }) {
  const token = (await ctx.supabase.auth.getSession()).data.session?.access_token;
  let memories: Memory[] | undefined;
  let minPersons = 5;
  try {
    const res = await fetch(`${process.env.LOTSE_SERVER_URL ?? LOTSE_DEFAULTS.serverUrl}/api/lotse/memory${app ? `?app=${app}` : ""}`, {
      headers: { Authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (res.ok) {
      const body = (await res.json()) as { memories?: Memory[]; minPersons?: number };
      minPersons = Math.max(5, body.minPersons ?? 5);
      memories = body.memories;
    }
  } catch {
    memories = undefined;
  }
  const sichtbar = (memories ?? []).filter(
    (m) => (m.status === "proposed" || m.status === "active") && (m.persons >= minPersons || m.source === "admin"),
  );
  const gruppen = [
    { titel: "Waiting for approval", liste: sichtbar.filter((m) => m.status === "proposed") },
    { titel: "Active – Valo uses these", liste: sichtbar.filter((m) => m.status === "active") },
  ];

  return (
    <section className={karte}>
      <div className="flex items-baseline gap-3">
        <h2 className="m-0 text-xl font-semibold">Agent memory</h2>
        <span className="text-sm text-muted">{sichtbar.length}</span>
      </div>
      <p className="mt-1 mb-0 text-sm text-muted">
        Learned from usage, separate from the knowledge base and lower priority. Shown only when at least {minPersons} people back it or an admin wrote or approved it.
      </p>
      {!memories ? (
        <p className={`mt-3 ${rot}`}>Server not reachable – agent memory can&apos;t be loaded.</p>
      ) : (
        gruppen.map((g) => (
          <div key={g.titel} className="mt-4">
            <h3 className="m-0 text-md font-semibold">{g.titel} <span className="text-sm font-normal text-muted">{g.liste.length}</span></h3>
            {g.liste.length === 0 ? (
              <p className="mt-1 mb-0 text-sm text-muted">Nothing here yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-3">
                {g.liste.map((m) => (
                  <li key={m.id} className="rounded-[10px] border border-line p-4">
                    <form className="flex flex-col gap-1">
                      <input type="hidden" name="id" value={m.id} />
                      {filter}
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="rounded-full bg-info-soft px-2.5 py-0.5 text-xs font-semibold text-info-text">{MEMORY_KIND[m.kind] ?? m.kind}</span>
                        <span className="font-semibold">{m.topic}</span>
                      </div>
                      <p className="m-0">{m.content}</p>
                      <p className="m-0 text-xs text-muted">
                        {[
                          m.appId ? appName.get(m.appId) : "All apps",
                          m.feature && `Feature: ${m.feature}`,
                          m.source === "admin" ? "written by an admin" : `${m.persons} people`,
                          m.negatives > 0 && `${m.negatives}× 👎`,
                        ].filter(Boolean).join(" · ")}
                      </p>
                      <div className="mt-2 flex gap-2">
                        {m.status === "proposed" && (
                          <button formAction={gedaechtnisSetzen} name="action" value="approve" className={knopf}>Approve</button>
                        )}
                        <button formAction={gedaechtnisSetzen} name="action" value="reject" className={zweit}>{m.status === "active" ? "Stop using" : "Reject"}</button>
                      </div>
                    </form>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ))
      )}
    </section>
  );
}

function Karte({ z, appName, offen, filter }: { z: Zeile; appName?: string; offen: boolean; filter: React.ReactNode }) {
  const p = z.payload ?? {};
  const meta = [
    appName,
    z.occurrences > 0 && `seen ${z.occurrences}×`,
    z.persons > 0 && `${z.persons} people`,
  ].filter(Boolean);

  let inhalt: React.ReactNode = null;
  let annehmen: { action: (fd: FormData) => Promise<void>; label: string } = { action: erledigen, label: "Done" };
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
    annehmen = { action: funktionUebernehmen, label: "Accept" };
  } else if (z.kind === "design") {
    const s = SCHWERE[str(p.severity)];
    inhalt = (
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
        {s && <span className={`rounded px-2 py-0.5 text-xs font-medium ${s.klasse}`}>{s.text}</span>}
        <span className="font-medium">{REGEL[str(p.rule)] ?? "Other"}</span>
        {str(p.route) && <span className="font-mono text-xs text-muted">{str(p.route)}</span>}
        {str(p.elementLabel) && <span>“{str(p.elementLabel)}”</span>}
        {str(p.measured) && <span className="text-muted">Measured: {str(p.measured)}</span>}
      </div>
    );
  } else if (z.kind === "stale_feature") {
    inhalt = (
      <p className="mt-2">
        “{str(p.missingLabel)}” hasn’t been seen for a while — check the click path of “{str(p.feature)}”.{" "}
        <Link href="/apps" className="font-semibold">
          Go to apps &amp; features
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
        {str(p.lastError) && <div className="text-muted">Last error: {kurz(str(p.lastError))}</div>}
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
          Topic: <span className="font-medium">{str(p.topic) || z.title}</span>
          {offen ? (
            <textarea name="text" rows={6} defaultValue={str(p.draft)} className={feld} placeholder="Write an answer for this topic …" />
          ) : (
            str(p.draft) && <p className="whitespace-pre-wrap text-muted">{str(p.draft)}</p>
          )}
        </label>
      )}
      {offen && (
        <div className="mt-2 flex gap-2">
          {knowledge ? (
            <button formAction={wissenUebernehmen} className={knopf}>
              Add as knowledge
            </button>
          ) : (
            <button formAction={annehmen.action} className={knopf}>
              {annehmen.label}
            </button>
          )}
          <button formAction={verwerfen} className={zweit}>
            Dismiss
          </button>
        </div>
      )}
    </form>
  );
}
