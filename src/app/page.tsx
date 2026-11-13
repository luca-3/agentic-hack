import { Suspense } from "react";
import { createClient } from "@/lib/supabase/server";

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-8 px-6 py-20 font-sans">
      <header className="flex flex-col gap-2">
        <h1 className="text-3xl font-semibold tracking-tight">Agentic Hack</h1>
        <p className="text-zinc-600 dark:text-zinc-400">Next.js + local Supabase — ready for the hackathon.</p>
      </header>

      <section className="rounded-xl border border-zinc-200 p-5 dark:border-zinc-800">
        <Suspense fallback={<p className="text-sm text-zinc-500">Checking Supabase…</p>}>
          <SupabaseStatus />
        </Suspense>
      </section>
    </main>
  );
}

/** Queries the example `notes` table at request time and shows the connection status. */
async function SupabaseStatus() {
  const supabase = await createClient(); // reads cookies → request-time rendering
  const { data: notes, error } = await supabase.from("notes").select("id, title").order("id");

  return (
    <>
      <div className="mb-3 flex items-center gap-2 text-sm font-medium">
        <span className={`size-2.5 rounded-full ${error ? "bg-red-500" : "bg-emerald-500"}`} />
        {error ? "Supabase not reachable" : "Connected to Supabase"}
      </div>
      {error ? (
        <p className="font-mono text-sm text-red-600 dark:text-red-400">
          {error.message || "Unknown error"} — is `npm run db:start` running and `.env.local` generated (`npm run db:env`)?
        </p>
      ) : (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {notes.map((note) => (
            <li key={note.id}>{note.title}</li>
          ))}
        </ul>
      )}
    </>
  );
}
