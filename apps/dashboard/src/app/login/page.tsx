import Link from "next/link";
import { Suspense } from "react";
import { anmelden } from "@/app/actions";
import { feld, knopf } from "@/components/Shell";

const FEHLER: Record<string, string> = {
  anmeldung: "E-Mail oder Passwort stimmt nicht.",
  "keine-organisation": "Dieses Konto gehört zu keiner Organisation.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center gap-6 px-6 py-20 font-sans">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Lotse Dashboard</h1>
        <p className="mt-1 text-zinc-600 dark:text-zinc-400">Anmelden mit dem Konto deiner Organisation.</p>
      </div>
      <Suspense fallback={null}>
        <Fehler searchParams={searchParams} />
      </Suspense>
      <form action={anmelden} className="flex flex-col gap-3">
        <label className="flex flex-col gap-1 text-sm">
          E-Mail
          <input name="email" type="email" required autoComplete="username" className={feld} defaultValue="admin@demo.test" />
        </label>
        <label className="flex flex-col gap-1 text-sm">
          Passwort
          <input name="password" type="password" required autoComplete="current-password" className={feld} />
        </label>
        <button className={knopf}>Anmelden</button>
      </form>
      <p className="text-xs text-zinc-500">Demo: admin@demo.test · Passwort demo1234 (nur Testdaten)</p>
      <p className="text-sm text-zinc-500">
        Noch kein Konto? <Link href="/onboarding" className="underline">Neue Organisation einrichten</Link>
      </p>
    </main>
  );
}

async function Fehler({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { fehler } = await searchParams;
  const text = typeof fehler === "string" ? FEHLER[fehler] : undefined;
  return text ? <p className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{text}</p> : null;
}
