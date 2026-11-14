import Link from "next/link";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { abmelden, organisationAnlegen } from "@/app/actions";
import { feld, knopf } from "@/components/Shell";
import { createClient } from "@/lib/supabase/server";

const FEHLER: Record<string, string> = {
  name: "Bitte gib den Namen der Organisation ein.",
  email: "Bitte gib eine gültige E-Mail ein.",
  passwort: "Das Passwort braucht mindestens 8 Zeichen.",
  konto: "Das Konto konnte nicht angelegt werden. Gibt es die E-Mail schon? Dann melde dich an.",
};

export default function OnboardingPage({ searchParams }: PageProps<"/onboarding">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-20 font-sans">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Organisation einrichten</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">Lege deine Organisation an. Du wirst ihr erster Admin.</p>
      </div>
      <Suspense fallback={<p className="text-sm text-zinc-500">Lädt …</p>}>
        <Formular searchParams={searchParams} />
      </Suspense>
    </main>
  );
}

async function Formular({ searchParams }: { searchParams: PageProps<"/onboarding">["searchParams"] }) {
  const supabase = await createClient();
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;
  if (userId) {
    const { count } = await supabase.from("org_members").select("org_id", { count: "exact", head: true }).eq("user_id", userId);
    if (count) redirect("/");
  }
  const { fehler } = await searchParams;
  const meldung = typeof fehler === "string" ? FEHLER[fehler] : undefined;

  return (
    <>
      {meldung && <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{meldung}</p>}
      <form action={organisationAnlegen} className="flex flex-col gap-3">
        {userId ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">Angemeldet als {String(data?.claims?.email ?? "")}.</p>
        ) : (
          <>
            <label className="flex flex-col gap-1 text-sm">
              E-Mail
              <input name="email" type="email" required autoComplete="username" className={feld} />
            </label>
            <label className="flex flex-col gap-1 text-sm">
              Passwort (mindestens 8 Zeichen)
              <input name="password" type="password" required minLength={8} autoComplete="new-password" className={feld} />
            </label>
          </>
        )}
        <label className="flex flex-col gap-1 text-sm">
          Name der Organisation
          <input name="orgName" required className={feld} placeholder="z. B. Müller Haustechnik GmbH" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Deine Rolle
          <input name="role" required defaultValue="Büro" className={feld} />
        </label>
        <button className={knopf}>{userId ? "Organisation anlegen" : "Konto und Organisation anlegen"}</button>
      </form>
      {userId ? (
        <form action={abmelden}>
          <button className="text-sm text-zinc-500 underline">Abmelden</button>
        </form>
      ) : (
        <p className="text-sm text-zinc-500">
          Schon ein Konto? <Link href="/login" className="underline">Anmelden</Link>
        </p>
      )}
    </>
  );
}
