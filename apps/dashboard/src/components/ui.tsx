// Valo UI building blocks (design_handoff_valo_admin) – server components, no client JS needed.
import type { ReactNode, ComponentProps } from "react";
import { VERDICT, type Verdict } from "@/lib/insights";

/** Product name shown in the dashboard – change it here only. */
export const PRODUCT_NAME = "Valo";

export const cx = (...c: (string | false | undefined)[]) => c.filter(Boolean).join(" ");

/* ---------- Icons (inline SVG) ---------- */
type IconProps = { className?: string };
export const IconInfo = ({ className = "size-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="M10 9v5M10 6v.4" strokeLinecap="round" /></svg>
);
export const IconAlert = ({ className = "size-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="M10 5.5v5.5M10 13.8v.4" strokeLinecap="round" /></svg>
);
export const IconWarn = ({ className = "size-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 2.5l8 14.5H2z" strokeLinejoin="round" /><path d="M10 8v4M10 14.4v.3" strokeLinecap="round" /></svg>
);
export const IconCheck = ({ className = "size-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="10" cy="10" r="8" /><path d="M6.5 10.3l2.4 2.4 4.6-4.9" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconChevron = ({ className = "size-4" }: IconProps) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 5l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconExternal = ({ className = "size-3.5" }: IconProps) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M8 4h8v8M16 4l-9 9" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconShield = ({ className = "size-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><path d="M10 2.5l6 2.5v4.5c0 4-2.6 6.6-6 8-3.4-1.4-6-4-6-8V5z" strokeLinejoin="round" /><path d="M7.5 10l1.8 1.8 3.2-3.4" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
export const IconLock = ({ className = "size-5" }: IconProps) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden="true"><rect x="4" y="9" width="12" height="8" rx="1.5" /><path d="M7 9V6.5a3 3 0 016 0V9" /></svg>
);

/* ---------- Buttons ---------- */
const btnBase = "inline-flex items-center justify-center gap-2 rounded-full border font-semibold cursor-pointer disabled:cursor-not-allowed";
const btnSize = { md: "h-11 px-[18px] text-base", sm: "h-10 px-3.5 text-sm" };
const btnVariant = {
  primary: "bg-primary border-primary text-on-primary hover:bg-primary-hover hover:border-primary-hover disabled:bg-input-disabled disabled:border-line disabled:text-muted",
  secondary: "bg-surface border-line-strong text-text hover:bg-surface-2 disabled:bg-input-disabled disabled:border-line disabled:text-muted",
  danger: "bg-danger border-danger text-on-danger hover:bg-danger-hover hover:border-danger-hover disabled:bg-input-disabled disabled:border-line disabled:text-muted",
};
type BtnProps = ComponentProps<"button"> & { variant?: keyof typeof btnVariant; size?: keyof typeof btnSize };
export function Button({ variant = "primary", size = "md", className, ...p }: BtnProps) {
  return <button {...p} className={cx(btnBase, btnSize[size], btnVariant[variant], className)} />;
}
/** Lösch-Button: immer rot gefüllt. */
export const DangerButton = (p: Omit<BtnProps, "variant">) => <Button variant="danger" size="sm" {...p} />;

/** Link that looks like a button. */
export function ButtonLink({ variant = "primary", size = "md", className, ...p }: ComponentProps<"a"> & { variant?: keyof typeof btnVariant; size?: keyof typeof btnSize }) {
  return <a {...p} className={cx(btnBase, btnSize[size], btnVariant[variant], "no-underline", className)} />;
}

/** Abbrechen links, Speichern rechts. */
export function FormActions({ submitLabel, cancelHref }: { submitLabel: string; cancelHref?: string }) {
  return (
    <div className="flex justify-end gap-3">
      {cancelHref
        ? <a href={cancelHref} className={cx(btnBase, btnSize.md, btnVariant.secondary, "no-underline")}>Abbrechen</a>
        : <Button type="reset" variant="secondary">Abbrechen</Button>}
      <Button type="submit">{submitLabel}</Button>
    </div>
  );
}

/* ---------- Formularfeld ---------- */
const inputCls = "h-11 w-full rounded-xl border border-line-strong bg-input px-3 text-base text-text disabled:bg-input-disabled disabled:border-line disabled:text-muted aria-[invalid=true]:border-2 aria-[invalid=true]:border-danger";
type FieldProps = ComponentProps<"input"> & { label: ReactNode; hint?: string; error?: string; mono?: boolean };
export function Field({ label, hint, error, mono, id, name, className, ...p }: FieldProps) {
  const fid = id ?? name;
  const desc = error || hint ? `${fid}-hint` : undefined;
  return (
    <label className={cx("grid gap-1.5", className)} htmlFor={fid}>
      <span className="text-sm font-semibold">{label}</span>
      <input id={fid} name={name} aria-invalid={error ? true : undefined} aria-describedby={desc} className={cx(inputCls, mono && "font-mono")} {...p} />
      {error
        ? <span id={desc} className="flex items-center gap-1.5 text-sm font-semibold text-danger-text"><IconAlert className="size-4" />{error}</span>
        : hint && <span id={desc} className="text-sm text-muted">{hint}</span>}
    </label>
  );
}
export function SelectField({ label, children, ...p }: ComponentProps<"select"> & { label: string }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <select className="h-11 rounded-xl border border-line-strong bg-input px-2.5 text-base text-text" {...p}>{children}</select>
    </label>
  );
}
export function TextareaField({ label, mono, ...p }: ComponentProps<"textarea"> & { label: string; mono?: boolean }) {
  return (
    <label className="grid gap-1.5">
      <span className="text-sm font-semibold">{label}</span>
      <textarea className={cx("min-h-36 rounded-xl border border-line-strong bg-input p-3 text-base text-text resize-y", mono && "font-mono text-xs leading-relaxed")} {...p} />
    </label>
  );
}
export const Checkbox = (p: ComponentProps<"input">) => (
  <input type="checkbox" className="size-5 accent-primary m-0" {...p} />
);

/* ---------- Hinweis (Notice) ---------- */
const noticeTone = {
  info: { box: "bg-surface border-line-strong", icon: <IconInfo className="size-5 text-muted shrink-0" /> },
  warning: { box: "bg-warn-soft border-warn-line", icon: <IconWarn className="size-6 text-warn-text shrink-0" /> },
  error: { box: "bg-danger-soft border-danger-line", icon: <IconAlert className="size-5 text-danger-text shrink-0" /> },
  success: { box: "bg-ok-soft border-ok-line", icon: <IconCheck className="size-5 text-ok-text shrink-0" /> },
  privacy: { box: "bg-priv-soft border-priv-line text-priv-strong", icon: <IconShield className="size-6 text-priv-accent shrink-0" /> },
};
export function Notice({ tone = "info", title, children, role }: { tone?: keyof typeof noticeTone; title?: ReactNode; children?: ReactNode; role?: string }) {
  const t = noticeTone[tone];
  return (
    <div role={role ?? (tone === "error" ? "alert" : tone === "success" ? "status" : "note")} className={cx("flex items-start gap-3 rounded-lg border px-4 py-3.5", tone === "privacy" ? "" : "text-text", t.box)}>
      {t.icon}
      <div className="grid gap-1">{title && <p className="m-0 font-semibold">{title}</p>}{children}</div>
    </div>
  );
}

/* ---------- Karte, Seitenkopf ---------- */
export const Card = ({ className, ...p }: ComponentProps<"section">) => (
  <section className={cx("rounded-lg border border-line bg-surface p-6", className)} {...p} />
);
/** Datenschutz-Hinweis als Pill (Violett). */
export const Footnote = ({ children }: { children: ReactNode }) => (
  <p className="m-0 inline-flex items-center gap-2 justify-self-start rounded-full border border-priv-line bg-priv-soft py-2 pr-4 pl-3 text-sm font-medium text-priv-text"><IconShield className="size-[18px] text-priv-accent" />{children}</p>
);

/* ---------- Kachel ---------- */
export const IconArrowUpRight = ({ className = "size-[18px]" }: IconProps) => (
  <svg className={className} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><path d="M7 13l6-6M8 7h5v5" strokeLinecap="round" strokeLinejoin="round" /></svg>
);
/** tone="ink": dunkle, invertierte Hervorhebungskachel (höchstens eine pro Seite). */
export function StatTile({ href, value, text, cta, tone = "default", className }: { href: string; value: string; text: string; cta: string; tone?: "default" | "ink"; className?: string }) {
  const ink = tone === "ink";
  return (
    <a href={href} className={cx("flex min-h-50 flex-col gap-4.5 rounded-lg border p-6 no-underline hover:shadow-[0_0_0_1px_var(--color-line-strong)]",
      ink ? "border-ink-bg bg-ink-bg text-ink-fg hover:text-ink-fg" : "border-line bg-surface text-text hover:text-text", className)}>
      <span className="flex items-start justify-between gap-4">
        <span className="max-w-[28ch] text-lg leading-snug font-semibold text-pretty">{text}</span>
        <span className={cx("grid size-11 shrink-0 place-items-center rounded-full border", ink ? "border-ink-fg bg-ink-fg text-ink-bg" : "border-line-strong bg-surface text-text")}><IconArrowUpRight /></span>
      </span>
      <span className="mt-auto text-5xl leading-none font-semibold tracking-tight tabular-nums">{value}</span>
      <span className={cx("text-sm", ink ? "text-ink-muted" : "text-muted")}>{cta}</span>
    </a>
  );
}

/* ---------- Urteil-Badge ---------- */
const verdictCls: Record<Verdict, string> = { improve: "bg-warn-soft text-warn-text", train: "bg-info-soft text-info-text", ok: "bg-ok-soft text-ok-text" };
export function VerdictBadge({ verdict, size = "md" }: { verdict: Verdict; size?: "sm" | "md" }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 font-semibold whitespace-nowrap", size === "md" ? "h-7 text-sm" : "h-6.5 text-xs", verdictCls[verdict])}>
      <span className="size-2 rounded-[2px] bg-current" />{VERDICT[verdict].label}
    </span>
  );
}

/* ---------- Kennzahl ---------- */
/** Values are percent (0–100) or null/undefined = no statement possible. */
export const pct = (v?: number | null) => (v == null ? "–" : `${v} %`);
export const num = (v?: number | null) => (v == null ? "–" : String(v));
/** DB rate 0..1 → whole percent. */
export const toPct = (v?: number) => (v === undefined ? null : Math.round(v * 100));


/** Ehrlicher Vergleich: gleiche Skala 0–100 %, gleiche Balkenstärke, Bezugsgröße benannt. */
export function CompareBars({ stuck, stuckAgain }: { stuck: number | null; stuckAgain: number | null }) {
  return (
    <div className="grid gap-2.5">
      <div className="px-0.5">
        <div className="flex items-baseline justify-between gap-3">
          <span>Feststecken <span className="text-xs text-muted">von allen Personen</span></span>
          <span className="text-xl font-semibold tabular-nums">{pct(stuck)}</span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-bar" style={{ width: `${stuck ?? 0}%` }} /></div>
      </div>
      <div className="-mx-3 rounded-[10px] border border-primary-line bg-primary-soft px-3.5 py-3">
        <div className="flex items-baseline justify-between gap-3">
          <span className="font-semibold text-primary-text">Trotz Hinweis wieder fest <span className="text-xs font-normal text-text">von denen mit Hinweis</span></span>
          <span className="text-[28px] leading-tight font-bold text-primary-text tabular-nums">{pct(stuckAgain)}</span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-track"><div className="h-full rounded-full bg-primary" style={{ width: `${stuckAgain ?? 0}%` }} /></div>
        {stuckAgain == null && <span className="mt-1.5 block text-xs">Noch zu wenige Hinweise für eine Aussage.</span>}
      </div>
    </div>
  );
}

/* ---------- Tabelle ---------- */
export const Table = ({ children }: { children: ReactNode }) => (
  <div className="overflow-hidden rounded-lg border border-line bg-surface"><table className="w-full border-collapse">{children}</table></div>
);
export const Th = ({ className, ...p }: ComponentProps<"th">) => (
  <th scope="col" className={cx("border-b border-line-strong px-4 py-2.5 text-left text-xs font-semibold text-muted", className)} {...p} />
);
export const Td = ({ className, ...p }: ComponentProps<"td">) => (
  <td className={cx("border-b border-line px-4 py-3 align-top", className)} {...p} />
);

/* ---------- Leer-Zustand ---------- */
export const EmptyState = ({ title, text }: { title: string; text?: string }) => (
  <div className="rounded-lg border border-dashed border-line-strong bg-surface p-6"><p className="m-0 font-semibold">{title}</p>{text && <p className="mt-0.5 mb-0 text-muted">{text}</p>}</div>
);
