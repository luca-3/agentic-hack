import type { DesignFinding, ExploredPage } from "@lotse/shared";

/** One design finding plus the English texts for the suggestion card (D-25). Pure, no LLM. */
export interface DesignResult {
  finding: DesignFinding;
  title: string;
  detail: string;
}

const MAX_FINDINGS = 40;
const GENERIC_LABELS = new Set(["", "button", "icon", "link", "img", "image", "bild", "symbol", "schaltfläche", "menu", "menü", "…", "..."]);
const CLOSE_LABELS = /^(schließen|abbrechen|close|cancel|×|x|✕)$/i;
const NAV_ROLES = new Set(["link", "button", "tab", "menuitem", "option", "treeitem"]);
const RANK = { high: 0, medium: 1, low: 2 } as const;

const fmt = (n: number, digits = 1) => n.toLocaleString("en-US", { maximumFractionDigits: digits });
const quote = (label: string) => (label ? `“${label}”` : "an unnamed element");

export function designFindings(pages: ExploredPage[]): DesignResult[] {
  const out: DesignResult[] = [];
  const add = (finding: DesignFinding, title: string, detail: string) => out.push({ finding, title, detail });

  for (const page of pages) {
    const { route } = page;
    const where = `on ${route}`;
    const active = page.elements.filter((e) => !e.disabled);
    const labelCount = new Map<string, number>();

    for (const e of active) {
      const label = e.label.trim();
      const s = e.style ?? {};

      if (s.contrast !== undefined && s.contrast < 4.5 && label) {
        add(
          { rule: "contrast", route, elementLabel: label, severity: s.contrast < 3 ? "high" : "medium", measured: `${fmt(s.contrast)}:1` },
          `Low contrast on ${quote(label)}`,
          `Contrast ${fmt(s.contrast)}:1 ${where}; at least 4.5:1 is required.`,
        );
      }

      const sizes = [s.width, s.height].filter((v): v is number => v !== undefined);
      const min = sizes.length ? Math.min(...sizes) : undefined;
      if (min !== undefined && min < 40) {
        const measured = `${fmt(s.width ?? min, 0)} × ${fmt(s.height ?? min, 0)} px`;
        add(
          { rule: "target_size", route, elementLabel: label, severity: min < 24 ? "medium" : "low", measured },
          `Small click target on ${quote(label)}`,
          `${measured} ${where}; at least 40 × 40 px is recommended (24 px absolute minimum).`,
        );
      }

      if (s.iconOnly && GENERIC_LABELS.has(label.toLowerCase())) {
        add(
          { rule: "unlabeled_icon", route, elementLabel: label, severity: "high" },
          `Icon button without a meaningful name ${where}`,
          `A button shows only an icon ${label ? `and is labeled ${quote(label)}` : "and has no label"} — screen readers and Valo can't tell what it does.`,
        );
      }

      if (label) labelCount.set(label.toLowerCase(), (labelCount.get(label.toLowerCase()) ?? 0) + 1);
    }

    for (const [key, n] of labelCount) {
      if (n < 2) continue;
      const label = active.find((e) => e.label.trim().toLowerCase() === key)!.label.trim();
      add(
        { rule: "duplicate_label", route, elementLabel: label, severity: "low", measured: `${n}×` },
        `${quote(label)} appears ${n} times`,
        `${n} different controls ${where} have the same name — users can't tell them apart.`,
      );
    }

    const clicks = page.reachedVia.length;
    if (clicks > 4) {
      add(
        { rule: "deep_path", route, elementLabel: page.title, severity: "medium", measured: `${clicks} clicks` },
        `${page.title || route} is ${clicks} clicks deep`,
        `Path: ${page.reachedVia.join(" → ")}. Targets more than 4 clicks away are hard to find.`,
      );
    }

    if (page.elements.length > 60) {
      add(
        { rule: "overloaded", route, elementLabel: page.title, severity: "medium", measured: `${page.elements.length} controls` },
        `${page.title || route} is overloaded`,
        `${page.elements.length} controls ${where} — more than 60 overwhelm new users.`,
      );
    }

    // ponytail: "leads elsewhere" = any enabled link/button-like element that isn't a close action; no real navigation check.
    if ((page.kind === "page" || page.kind === "dialog") && !active.some((e) => NAV_ROLES.has(e.role) && !CLOSE_LABELS.test(e.label.trim()))) {
      add(
        { rule: "dead_end", route, elementLabel: page.title, severity: "low" },
        `Dead end: ${page.title || route}`,
        `${page.kind === "dialog" ? "The dialog" : "The page"} ${where} offers no way forward except closing.`,
      );
    }
  }

  const seen = new Set<string>();
  return out
    .filter(({ finding: f }) => {
      const key = `${f.rule}|${f.route}|${(f.elementLabel ?? "").toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort((a, b) => RANK[a.finding.severity] - RANK[b.finding.severity])
    .slice(0, MAX_FINDINGS);
}
