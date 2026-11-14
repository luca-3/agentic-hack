import Link from "next/link";
import { Suspense } from "react";
import { abmelden } from "@/app/actions";
import { getOrgContext } from "@/lib/org";

const NAV = [
  { href: "/", label: "Übersicht" },
  { href: "/insights", label: "Erkenntnisse" },
  { href: "/apps", label: "Apps & Funktionen" },
  { href: "/trainings", label: "Schulungen" },
  { href: "/team", label: "Team" },
] as const;

/** Page frame: navigation, signed-in user, title. Content streams in via Suspense (cacheComponents). */
export function Shell({ title, intro, children }: { title: string; intro?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-full flex-1 flex-col font-sans">
      <header className="border-b border-zinc-200 dark:border-zinc-800">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3">
          <span className="font-semibold">Lotse</span>
          <nav className="flex flex-wrap gap-4 text-sm">
            {NAV.map((n) => (
              <Link key={n.href} href={n.href} className="text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-zinc-100">
                {n.label}
              </Link>
            ))}
          </nav>
          <div className="ml-auto text-sm">
            <Suspense fallback={null}>
              <Benutzer />
            </Suspense>
          </div>
        </div>
      </header>
      <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 px-6 py-10">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {intro && <p className="mt-1 text-zinc-600 dark:text-zinc-400">{intro}</p>}
        </div>
        <Suspense fallback={<p className="text-sm text-zinc-500">Lädt …</p>}>{children}</Suspense>
      </main>
    </div>
  );
}

async function Benutzer() {
  const { email, orgName, role, isAdmin } = await getOrgContext();
  return (
    <form action={abmelden} className="flex items-center gap-3">
      <span className="text-zinc-600 dark:text-zinc-400">
        {orgName} · {email} · {role}
        {isAdmin ? " (Admin)" : ""}
      </span>
      <button className="rounded-md border border-zinc-300 px-2 py-1 hover:bg-zinc-100 dark:border-zinc-700 dark:hover:bg-zinc-900">Abmelden</button>
    </form>
  );
}

export const karte = "rounded-xl border border-zinc-200 p-5 dark:border-zinc-800";
export const feld =
  "w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-950";
export const knopf =
  "rounded-md bg-zinc-900 px-3 py-2 text-sm font-medium text-white hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300";
