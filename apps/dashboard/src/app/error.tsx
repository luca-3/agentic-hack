"use client"; // Next.js requires a client component for error.tsx.
import { Notice } from "@/components/ui";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="grid min-h-screen place-items-center px-6 py-12">
      <div className="grid w-full max-w-[720px] gap-5">
        <h1 className="m-0 text-2xl font-semibold tracking-tight">Something went wrong</h1>
        <Notice tone="error" title="The page could not be loaded.">
          <p className="m-0 mb-3">Please try again. If it happens again, reloading the page usually helps.</p>
          <button type="button" onClick={reset} className="inline-flex h-11 cursor-pointer items-center justify-self-start rounded-full bg-primary px-[18px] font-semibold text-on-primary hover:bg-primary-hover">
            Try again
          </button>
        </Notice>
      </div>
    </main>
  );
}
