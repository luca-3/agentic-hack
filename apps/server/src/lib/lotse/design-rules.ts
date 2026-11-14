import type { DesignFinding, ExploredPage } from "@lotse/shared";

/** One design finding plus the German texts for the suggestion card (D-25). Pure, no LLM. */
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

const de = (n: number, digits = 1) => n.toLocaleString("de-DE", { maximumFractionDigits: digits });
const quote = (label: string) => (label ? `„${label}“` : "ohne Namen");

export function designFindings(pages: ExploredPage[]): DesignResult[] {
  const out: DesignResult[] = [];
  const add = (finding: DesignFinding, title: string, detail: string) => out.push({ finding, title, detail });

  for (const page of pages) {
    const { route } = page;
    const where = `auf ${route}`;
    const active = page.elements.filter((e) => !e.disabled);
    const labelCount = new Map<string, number>();

    for (const e of active) {
      const label = e.label.trim();
      const s = e.style ?? {};

      if (s.contrast !== undefined && s.contrast < 4.5 && label) {
        add(
          { rule: "contrast", route, elementLabel: label, severity: s.contrast < 3 ? "high" : "medium", measured: `${de(s.contrast)}:1` },
          `Schwacher Kontrast bei ${quote(label)}`,
          `Kontrast ${de(s.contrast)}:1 ${where}, nötig sind mindestens 4,5:1.`,
        );
      }

      const sizes = [s.width, s.height].filter((v): v is number => v !== undefined);
      const min = sizes.length ? Math.min(...sizes) : undefined;
      if (min !== undefined && min < 40) {
        const measured = `${de(s.width ?? min, 0)} × ${de(s.height ?? min, 0)} px`;
        add(
          { rule: "target_size", route, elementLabel: label, severity: min < 24 ? "medium" : "low", measured },
          `Kleine Klickfläche bei ${quote(label)}`,
          `${measured} ${where}; empfohlen sind mindestens 40 × 40 px (24 px absolute Untergrenze).`,
        );
      }

      if (s.iconOnly && GENERIC_LABELS.has(label.toLowerCase())) {
        add(
          { rule: "unlabeled_icon", route, elementLabel: label, severity: "high" },
          `Symbol-Knopf ohne verständlichen Namen ${where}`,
          `Ein Knopf zeigt nur ein Symbol und heißt ${quote(label)} — Screenreader und Valo wissen nicht, was er tut.`,
        );
      }

      if (label) labelCount.set(label.toLowerCase(), (labelCount.get(label.toLowerCase()) ?? 0) + 1);
    }

    for (const [key, n] of labelCount) {
      if (n < 2) continue;
      const label = active.find((e) => e.label.trim().toLowerCase() === key)!.label.trim();
      add(
        { rule: "duplicate_label", route, elementLabel: label, severity: "low", measured: `${n}×` },
        `${quote(label)} kommt ${n}-mal vor`,
        `${n} verschiedene Bedienelemente ${where} heißen gleich — Nutzer können sie nicht unterscheiden.`,
      );
    }

    const clicks = page.reachedVia.length;
    if (clicks > 4) {
      add(
        { rule: "deep_path", route, elementLabel: page.title, severity: "medium", measured: `${clicks} Klicks` },
        `${page.title || route} liegt ${clicks} Klicks tief`,
        `Weg: ${page.reachedVia.join(" → ")}. Mehr als 4 Klicks bis zum Ziel sind schwer zu finden.`,
      );
    }

    if (page.elements.length > 60) {
      add(
        { rule: "overloaded", route, elementLabel: page.title, severity: "medium", measured: `${page.elements.length} Bedienelemente` },
        `${page.title || route} ist überladen`,
        `${page.elements.length} Bedienelemente ${where} — mehr als 60 überfordern neue Nutzer.`,
      );
    }

    // ponytail: "leads elsewhere" = any enabled link/button-like element that isn't a close action; no real navigation check.
    if ((page.kind === "page" || page.kind === "dialog") && !active.some((e) => NAV_ROLES.has(e.role) && !CLOSE_LABELS.test(e.label.trim()))) {
      add(
        { rule: "dead_end", route, elementLabel: page.title, severity: "low" },
        `Sackgasse: ${page.title || route}`,
        `${page.kind === "dialog" ? "Der Dialog" : "Die Seite"} ${where} bietet keinen Weg weiter außer Schließen.`,
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
