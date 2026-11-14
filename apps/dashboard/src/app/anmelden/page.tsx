import Link from "next/link";
import { Suspense } from "react";
import { anmelden } from "@/app/actions";
import { Logo } from "@/components/Shell";
import { Button, Field, Notice } from "@/components/ui";

const FEHLER: Record<string, string> = {
  anmeldung: "E-Mail oder Passwort stimmt nicht.",
  "keine-organisation": "Dieses Konto gehört zu keiner Organisation.",
};

export default function AnmeldenPage({ searchParams }: PageProps<"/anmelden">) {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="grid w-full max-w-[420px] gap-6">
        <Logo />
        <Suspense fallback={<Formular />}>
          <MitFehler searchParams={searchParams} />
        </Suspense>
        <p className="m-0 text-center text-sm text-muted">Wir finden Schwachstellen in der Oberfläche, nicht in Menschen.</p>
      </div>
    </main>
  );
}

async function MitFehler({ searchParams }: { searchParams: PageProps<"/anmelden">["searchParams"] }) {
  const { fehler } = await searchParams;
  return <Formular fehler={typeof fehler === "string" ? (FEHLER[fehler] ?? FEHLER.anmeldung) : undefined} />;
}

function Formular({ fehler }: { fehler?: string }) {
  return (
    <form action={anmelden} className="grid gap-5 rounded-lg border border-line bg-surface p-8">
      <div>
        <h1 className="m-0 text-[26px] font-semibold">Anmelden</h1>
        <p className="mt-1 mb-0 text-muted">Für Admins der Organisation.</p>
      </div>
      {fehler && <Notice tone="error" title={fehler} />}
      <Field label="E-Mail" name="email" type="email" autoComplete="username" required defaultValue="admin@demo.test" aria-invalid={fehler ? true : undefined} />
      <Field label="Passwort" name="password" type="password" autoComplete="current-password" required aria-invalid={fehler ? true : undefined} hint="Demo: admin@demo.test · demo1234 (nur Testdaten)" />
      <Button type="submit">Anmelden</Button>
      <Link href="/registrieren" className="justify-self-center px-1 py-2 font-semibold">Neue Organisation einrichten</Link>
    </form>
  );
}
