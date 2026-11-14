import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

/** Placeholder sections — each becomes a page under src/app/ (see docs/requirements.md R-ORG / R-INS). */
const SECTIONS = [
  { title: "Organisation & Nutzer", text: "Nutzer einladen, Rollen vergeben (R-ORG-1)" },
  { title: "Apps & Funktionslisten", text: "Domains und Funktionsliste pro App pflegen (R-ORG-2)" },
  { title: "Schulungskatalog", text: "Schulungen der Organisation (R-ORG-5)" },
  { title: "Insights", text: "Painpoints, Schulungsvorschläge, UX-Potenzial (R-INS-1..3)" },
];

export default function DashboardHome() {
  return (
    <main className="mx-auto flex w-full max-w-4xl flex-1 flex-col gap-8 px-6 py-16 font-sans">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Lotse Dashboard</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Zentrale Verwaltung für Organisationen — Kontext, Nutzer, Schulungen, Insights.</p>
      </header>

      <section className="grid gap-4 sm:grid-cols-2">
        {SECTIONS.map((s) => (
          <div key={s.title} className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
            <h2 className="font-medium">{s.title}</h2>
            <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{s.text}</p>
            <p className="mt-3 text-xs uppercase tracking-wide text-zinc-400">kommt</p>
          </div>
        ))}
      </section>

      <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <Suspense fallback={<p className="text-sm text-zinc-500">Checking Supabase…</p>}>
          <SupabaseStatus />
        </Suspense>
      </section>
    </main>
  );
}

/** Request-time DB check (reads cookies → must stay inside Suspense because cacheComponents is on). */
async function SupabaseStatus() {
  const supabase = await createClient();
  const { error } = await supabase.from("notes").select("id").limit(1);
  return (
    <div className="flex items-center gap-2 text-sm font-medium">
      <span className={`size-2.5 rounded-full ${error ? "bg-red-500" : "bg-emerald-500"}`} />
      {error ? `Supabase not reachable — ${error.message}` : "Connected to Supabase"}
    </div>
  );
}
