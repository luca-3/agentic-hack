import { redirect } from "next/navigation";
import { Suspense } from "react";
import { abmelden, organisationAnlegen } from "@/app/actions";
import { Logo } from "@/components/Shell";
import { Button, ButtonLink, Field, FormActions, IconCheck, Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

const FEHLER: Record<string, string> = {
  name: "Bitte gib den Namen der Organisation ein.",
  email: "Bitte gib eine gültige E-Mail ein.",
  konto: "Das Konto konnte nicht angelegt werden. Gibt es die E-Mail schon? Dann melde dich an.",
};

export default function RegistrierenPage({ searchParams }: PageProps<"/registrieren">) {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="grid w-full max-w-[480px] gap-6">
        <Logo />
        <Suspense fallback={<p role="status" className="m-0 text-muted">Wird geladen …</p>}>
          <Inhalt searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Inhalt({ searchParams }: { searchParams: PageProps<"/registrieren">["searchParams"] }) {
  const [supabase, { fehler, ok }] = await Promise.all([createClient(), searchParams]);
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (ok && userId) {
    return (
      <div role="status" className="grid gap-4 rounded-lg border border-line bg-surface p-8">
        <span className="grid size-11 place-items-center rounded-full bg-ok-soft text-ok-text"><IconCheck /></span>
        <h1 className="m-0 text-[26px] font-semibold">Organisation ist eingerichtet</h1>
        <p className="m-0 text-muted">Als Nächstes die erste App eintragen.</p>
        <ButtonLink href="/apps" className="justify-self-start">Weiter zu Apps &amp; Funktionen</ButtonLink>
      </div>
    );
  }
  if (userId) {
    const { count } = await supabase.from("org_members").select("org_id", { count: "exact", head: true }).eq("user_id", userId);
    if (count) redirect("/");
  }
  const meldung = typeof fehler === "string" ? FEHLER[fehler] : undefined;

  return (
    <>
      <form action={organisationAnlegen} className="grid gap-5 rounded-lg border border-line bg-surface p-8">
        <div>
          <h1 className="m-0 text-[26px] font-semibold">Neue Organisation einrichten</h1>
          <p className="mt-1 mb-0 text-muted">
            {userId ? `Angemeldet als ${String(data?.claims?.email ?? "")}. ` : ""}Sie werden automatisch Admin dieser Organisation.
          </p>
        </div>
        {meldung && <Notice tone="error" title={meldung} />}
        {!userId && (
          <>
            <Field label="E-Mail" name="email" type="email" autoComplete="username" required aria-invalid={fehler === "email" ? true : undefined} />
            <Field label="Passwort" name="password" type="password" autoComplete="new-password" minLength={8} required
              hint="Mindestens 8 Zeichen." error={fehler === "passwort" ? "Das Passwort ist zu kurz. Bitte mindestens 8 Zeichen." : undefined} />
          </>
        )}
        <Field label="Name der Organisation" name="orgName" required placeholder="z. B. Müller Haustechnik GmbH" />
        <Field label="Rolle" name="role" required defaultValue="Büro" hint="Ihre Rolle im Betrieb, zum Beispiel „Büro“ oder „Meister“." />
        <FormActions submitLabel="Organisation einrichten" cancelHref="/anmelden" />
      </form>
      {userId && (
        <form action={abmelden} className="justify-self-center">
          <Button type="submit" variant="secondary" size="sm">Abmelden</Button>
        </form>
      )}
    </>
  );
}
