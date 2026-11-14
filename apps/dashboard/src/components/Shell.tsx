import Link from "next/link";
import { Suspense } from "react";
import { abmelden } from "@/app/actions";
import { IconShield, PRODUCT_NAME, cx } from "@/components/ui";
import { bewerte, type InsightRow } from "@/lib/insights";
import { getOrgContext } from "@/lib/org";

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/insights", label: "Insights" },
  { href: "/learning", label: "Learning" },
  { href: "/apps", label: "Apps & features" },
  { href: "/knowledge", label: "Knowledge" },
  { href: "/trainings", label: "Trainings" },
  { href: "/team", label: "Team" },
] as const;
export type NavHref = (typeof NAV)[number]["href"];

/** Lighthouse mark. Tower = currentColor (follows light/dark), light = orange. */
export function ValoMark({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 40 40" aria-hidden="true">
      <g fill="#FF8A3D">
        <polygon points="14.5,10.6 2,7 2,8.9" /><polygon points="14.5,12.4 2,16.2 2,14.3" />
        <polygon points="25.5,10.6 38,7 38,8.9" /><polygon points="25.5,12.4 38,16.2 38,14.3" />
        <rect x="16.4" y="9" width="7.2" height="5" rx="0.6" />
      </g>
      <g fill="currentColor">
        <circle cx="20" cy="4.4" r="1.1" /><path d="M15 9.2 Q20 3.6 25 9.2 Z" />
        <path d="M15.4 9 h1.4 v5 h-1.4 Z M23.2 9 h1.4 v5 h-1.4 Z" />
        <rect x="13.8" y="14" width="12.4" height="2.3" rx="0.6" />
        <path fillRule="evenodd" d="M15.6 16.3 H24.4 L26.9 32 H13.1 Z M19.1 19.6 h1.8 v3.4 h-1.8 Z M19.1 25.4 h1.8 v3.2 h-1.8 Z" />
        <path d="M8.5 34 Q11 30 13.6 31.4 L16.4 29.6 L20 31.2 L23.6 29.4 L26.4 31.2 Q29.5 30 31.5 34 Z" />
      </g>
      <path d="M5 37.2 q2.5 -1.4 5 0 t5 0 t5 0 t5 0 t5 0 t5 0" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

export function Logo() {
  return (
    <span className="flex items-center gap-2.5 text-[22px] font-bold tracking-tight text-text">
      <ValoMark className="size-[38px]" />
      {PRODUCT_NAME}
    </span>
  );
}

/**
 * App frame of the Valo design: shell header with pill navigation, sidebar, sand-white panel.
 * The active entry comes from `href` (no client JS). Request data streams in via Suspense (cacheComponents).
 * `appParam` (only /insights) highlights the app filter in the sidebar.
 */
export function Shell({
  href,
  title,
  intro,
  meta,
  appParam,
  children,
}: {
  href: NavHref;
  title: string;
  intro?: string;
  meta?: string;
  appParam?: Promise<string | undefined>;
  children: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-shell">
      <header data-shell-area className="flex items-center gap-5 bg-shell px-6 py-3.5">
        <Link href="/" className="min-w-max shrink basis-[220px] no-underline"><Logo /></Link>
        <nav aria-label="Main navigation" className="flex min-w-0 flex-1 flex-nowrap gap-2 overflow-x-auto py-0.5">
          {NAV.map((n) => {
            const active = n.href === href;
            return (
              <Link key={n.href} href={n.href} aria-current={active ? "page" : undefined}
                className={cx("flex h-11 items-center rounded-full px-[18px] text-base whitespace-nowrap no-underline hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]",
                  active ? "bg-primary font-semibold text-on-primary" : "bg-surface font-medium text-text")}>
                {n.label}
              </Link>
            );
          })}
        </nav>
        <Suspense fallback={<span className="ml-auto h-11 w-40" />}>
          <Benutzer />
        </Suspense>
      </header>
      <div className="grid grid-cols-[220px_minmax(0,1fr)] items-start gap-5 px-6 pt-1.5 pb-6">
        <aside data-shell-area aria-label="Sidebar" className="grid gap-7 pt-3.5">
          <Suspense fallback={null}>
            <Seitenleiste href={href} appParam={appParam} />
          </Suspense>
        </aside>
        <main className="grid min-w-0 content-start gap-6 rounded-[var(--radius-panel)] bg-panel px-7 pt-7 pb-12">
          {href !== "/" && (
            <nav aria-label="Breadcrumb" className="text-sm text-muted">
              <Link href="/" className="text-muted no-underline hover:underline">Overview</Link>
              <span aria-hidden="true" className="px-2">›</span>
              <span aria-current="page">{title}</span>
            </nav>
          )}
          <div className="flex flex-wrap items-end gap-6">
            <div className="min-w-80 flex-1">
              <h1 className="m-0 text-2xl font-semibold tracking-tight">{title}</h1>
              {intro && <p className="mt-1.5 mb-0 text-md text-pretty text-muted">{intro}</p>}
            </div>
            {meta && <span className="text-sm text-muted">{meta}</span>}
          </div>
          <Suspense fallback={<Laedt />}>{children}</Suspense>
        </main>
      </div>
    </div>
  );
}

const kuerzel = (name: string) =>
  name.replace(/\(.*?\)/g, "").split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join("").toUpperCase() || "?";

async function Benutzer() {
  const { email, orgName, role, isAdmin } = await getOrgContext();
  return (
    <div className="ml-auto flex min-w-0 items-center gap-3">
      <span aria-hidden="true" className="grid size-11 shrink-0 place-items-center rounded-full bg-primary-soft font-bold text-primary-text">{kuerzel(orgName)}</span>
      <span className="grid min-w-0 leading-tight max-xl:hidden">
        <span className="truncate font-semibold">{orgName}</span>
        <span className="truncate text-xs text-muted">{email} · {role}{isAdmin && " (Admin)"}</span>
      </span>
      <form action={abmelden}>
        <button type="submit" className="h-11 cursor-pointer rounded-full border border-line-strong bg-surface px-[18px] text-sm font-semibold text-text hover:bg-surface-2">Sign out</button>
      </form>
    </div>
  );
}

const label = "px-1 pb-1.5 text-xs font-semibold tracking-[.06em] text-muted uppercase";

async function Seitenleiste({ href, appParam }: { href: NavHref; appParam?: Promise<string | undefined> }) {
  const { supabase, orgName, isAdmin } = await getOrgContext();
  const [{ data: apps }, { data: rows }, currentApp] = await Promise.all([
    supabase.from("apps").select("id, name").order("name"),
    isAdmin ? supabase.from("insights").select("app_id, feature, role, metric, value, persons") : Promise.resolve({ data: [] }),
    href === "/insights" ? appParam : undefined,
  ]);
  const features = bewerte((rows ?? []) as InsightRow[]);
  const eintraege = [
    { id: "", name: "All apps", count: features.length },
    ...(apps ?? []).map((a) => ({ id: a.id as string, name: a.name as string, count: features.filter((f) => f.appId === a.id).length })),
  ];

  return (
    <>
      <div className="grid gap-1.5">
        <p className="m-0 text-2xl leading-tight font-semibold tracking-tight text-balance">Hello, {orgName.replace(/\s*\(Demo\)/, "")}!</p>
        <p className="m-0 text-sm text-pretty text-muted">We find weak spots in the interface, not in people.</p>
      </div>
      {isAdmin && (
        <div className="grid gap-1">
          <span className={label}>Insights by app</span>
          {eintraege.map((a) => {
            const on = href === "/insights" && (currentApp ?? "") === a.id;
            return (
              <Link key={a.id || "alle"} href={a.id ? `/insights?app=${a.id}` : "/insights"} aria-current={on ? "true" : undefined}
                className={cx("flex h-11 items-center gap-2.5 rounded-[10px] px-3.5 no-underline",
                  on ? "bg-[var(--sh-active,var(--color-ink-bg))] text-[var(--sh-active-fg,var(--color-ink-fg))] shadow-[inset_4px_0_0_var(--color-petrol)]" : "text-text hover:shadow-[inset_0_0_0_1px_var(--color-line-strong)]")}>
                <span className="size-2 shrink-0 rounded-full bg-current" />
                <span className="min-w-0 flex-1 truncate font-medium">{a.name}</span>
                <span className="text-xs font-semibold tabular-nums">{a.count}</span>
              </Link>
            );
          })}
        </div>
      )}
      {isAdmin && (
        <div className="grid gap-1">
          <span className={label}>Quick actions</span>
          {[["Create a new app", "/apps#new-app"], ["Add knowledge", "/knowledge#add"], ["Invite someone", "/team#invite"]].map(([t, h]) => (
            <Link key={h} href={h} className="flex h-11 items-center gap-2.5 rounded-full pr-2 pl-3.5 font-medium text-text no-underline hover:bg-surface">
              <span className="flex-1">{t}</span>
              <span className="grid size-7 place-items-center rounded-full bg-primary text-on-primary" aria-hidden="true">
                <svg className="size-3.5" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2.4"><path d="M10 4v12M4 10h12" strokeLinecap="round" /></svg>
              </span>
            </Link>
          ))}
        </div>
      )}
      <p className="m-0 flex items-start gap-2.5 rounded-2xl border border-priv-line bg-priv-soft px-3.5 py-3 text-xs leading-snug text-priv-text">
        <IconShield className="size-[18px] shrink-0 text-priv-accent" />
        <span><strong className="block font-semibold">Privacy</strong>Groups of fewer than 5 people stay hidden.</span>
      </p>
    </>
  );
}

/** Static loading skeleton, no shimmer. */
export function Laedt() {
  const tile = (
    <div className="grid h-[150px] content-start gap-3 rounded-lg border border-line bg-surface p-[22px]">
      <div className="h-9 w-20 rounded-sm bg-surface-2" />
      <div className="h-3.5 w-4/5 rounded bg-surface-2" />
      <div className="h-3.5 w-1/2 rounded bg-surface-2" />
    </div>
  );
  return (
    <div role="status" aria-live="polite" className="grid gap-6">
      <span className="text-muted">Loading …</span>
      <div className="grid grid-cols-3 gap-4">{tile}{tile}{tile}</div>
      <div className="h-[260px] rounded-lg border border-line bg-surface" />
    </div>
  );
}
