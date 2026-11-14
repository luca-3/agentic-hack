import Link from "next/link";
import { Suspense } from "react";
import { anmelden } from "@/app/actions";
import { Logo } from "@/components/Shell";
import { Button, Field, Notice } from "@/components/ui";

const FEHLER: Record<string, string> = {
  credentials: "Email or password is incorrect.",
  "no-organization": "This account doesn't belong to any organization.",
};

export default function LoginPage({ searchParams }: PageProps<"/login">) {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="grid w-full max-w-[420px] gap-6">
        <Logo />
        <Suspense fallback={<Formular />}>
          <MitFehler searchParams={searchParams} />
        </Suspense>
        <p className="m-0 text-center text-sm text-muted">We find weak spots in the interface, not in people.</p>
      </div>
    </main>
  );
}

async function MitFehler({ searchParams }: { searchParams: PageProps<"/login">["searchParams"] }) {
  const { error } = await searchParams;
  return <Formular fehler={typeof error === "string" ? (FEHLER[error] ?? FEHLER.credentials) : undefined} />;
}

function Formular({ fehler }: { fehler?: string }) {
  return (
    <form action={anmelden} className="grid gap-5 rounded-lg border border-line bg-surface p-8">
      <div>
        <h1 className="m-0 text-[26px] font-semibold">Sign in</h1>
        <p className="mt-1 mb-0 text-muted">For organization admins.</p>
      </div>
      {fehler && <Notice tone="error" title={fehler} />}
      <Field label="Email" name="email" type="email" autoComplete="username" required defaultValue="admin@demo.test" aria-invalid={fehler ? true : undefined} />
      <Field label="Password" name="password" type="password" autoComplete="current-password" required aria-invalid={fehler ? true : undefined} hint="Demo: admin@demo.test · demo1234 (test data only)" />
      <Button type="submit">Sign in</Button>
      <Link href="/signup" className="justify-self-center px-1 py-2 font-semibold">Set up a new organization</Link>
    </form>
  );
}
