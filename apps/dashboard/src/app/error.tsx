"use client"; // Next.js requires a client component for error.tsx.
import { Notice } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="grid w-full max-w-[720px] gap-5">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Etwas ist schiefgelaufen</h1>
        <Notice tone="error" title="Die Seite konnte nicht geladen werden.">
          <p className="m-0 mb-3">Bitte gleich noch einmal versuchen. Wenn es wieder passiert, hilft es, die Seite neu zu laden.</p>
          <button type="button" onClick={reset} className="inline-flex h-11 cursor-pointer items-center justify-self-start rounded-full bg-primary px-[18px] font-semibold text-on-primary hover:bg-primary-hover">
            Erneut versuchen
          </button>
        </Notice>
      </div>
    </main>
  );
}
