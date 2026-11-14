import { redirect } from "next/navigation";
import { Suspense } from "react";
import { abmelden, organisationAnlegen } from "@/app/actions";
import { Logo } from "@/components/Shell";
import { Button, ButtonLink, Field, FormActions, IconCheck, Notice } from "@/components/ui";
import { createClient } from "@/lib/supabase/server";

const FEHLER: Record<string, string> = {
  name: "Please enter the organization's name.",
  email: "Please enter a valid email address.",
  closed: "Sign-up is closed. Please ask an admin of your organization to invite you.",
  account: "The account could not be created. Does this email already exist? Then sign in instead.",
};

export default function SignupPage({ searchParams }: PageProps<"/signup">) {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="grid w-full max-w-[480px] gap-6">
        <Logo />
        <Suspense fallback={<p role="status" className="m-0 text-muted">Loading …</p>}>
          <Inhalt searchParams={searchParams} />
        </Suspense>
      </div>
    </main>
  );
}

async function Inhalt({ searchParams }: { searchParams: PageProps<"/signup">["searchParams"] }) {
  const [supabase, { error, ok }] = await Promise.all([createClient(), searchParams]);
  const { data } = await supabase.auth.getClaims();
  const userId = data?.claims?.sub;

  if (ok && userId) {
    return (
      <div role="status" className="grid gap-4 rounded-lg border border-line bg-surface p-8">
        <span className="grid size-11 place-items-center rounded-full bg-ok-soft text-ok-text"><IconCheck /></span>
        <h1 className="m-0 text-[26px] font-semibold">Your organization is set up</h1>
        <p className="m-0 text-muted">Next, add your first app.</p>
        <ButtonLink href="/apps" className="justify-self-start">Continue to Apps &amp; features</ButtonLink>
      </div>
    );
  }
  if (userId) {
    const { count } = await supabase.from("org_members").select("org_id", { count: "exact", head: true }).eq("user_id", userId);
    if (count) redirect("/");
  }
  const meldung = typeof error === "string" ? FEHLER[error] : undefined;

  return (
    <>
      <form action={organisationAnlegen} className="grid gap-5 rounded-lg border border-line bg-surface p-8">
        <div>
          <h1 className="m-0 text-[26px] font-semibold">Set up a new organization</h1>
          <p className="mt-1 mb-0 text-muted">
            {userId ? `Signed in as ${String(data?.claims?.email ?? "")}. ` : ""}You will automatically become an admin of this organization.
          </p>
        </div>
        {meldung && <Notice tone="error" title={meldung} />}
        {!userId && (
          <>
            <Field label="Email" name="email" type="email" autoComplete="username" required aria-invalid={error === "email" ? true : undefined} />
            <Field label="Password" name="password" type="password" autoComplete="new-password" minLength={8} required
              hint="At least 8 characters." error={error === "password" ? "The password is too short. Please use at least 8 characters." : undefined} />
          </>
        )}
        <Field label="Organization name" name="orgName" required placeholder="e.g. Miller Building Services Ltd" />
        <Field label="Role" name="role" required defaultValue="Office" hint="Your role in the company, for example “Office” or “Foreman”." />
        <FormActions submitLabel="Set up organization" cancelHref="/login" />
      </form>
      {userId && (
        <form action={abmelden} className="justify-self-center">
          <Button type="submit" variant="secondary" size="sm">Sign out</Button>
        </form>
      )}
    </>
  );
}
