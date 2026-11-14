/**
 * Turns aggregated insight rows into one verdict per feature: app problem, training need or fine.
 * Pure function (no DB) — rule: if people are still stuck after the hint, the hint can't fix it → the app has to change.
 */
export type InsightRow = {
  app_id: string;
  feature: string;
  role: string | null;
  metric: "stuck_rate" | "still_stuck_after_hint" | "abandoned_flow" | "question_count";
  value: number;
  persons: number;
};

export type Verdict = "improve" | "train" | "ok";

export const VERDICT: Record<Verdict, { label: string; desc: string }> = {
  improve: { label: "App verbessern", desc: "Der Hinweis hilft nicht – die Oberfläche ist das Problem." },
  train: { label: "Schulung", desc: "Der Hinweis hilft, aber viele brauchen ihn." },
  ok: { label: "Läuft", desc: "Kaum jemand bleibt hier hängen." },
};
export const VERDICTS = Object.keys(VERDICT) as Verdict[];

export type FeatureInsight = {
  appId: string;
  feature: string;
  role: string | null;
  persons: number; // largest group behind any metric of this feature
  stuckRate?: number;
  stillStuckAfterHint?: number;
  abandonedFlow?: number;
  questions?: number;
  verdict: Verdict;
};

/** Thresholds — tune here. */
export const APP_PROBLEM_AB = 0.5; // ≥ 50 % still stuck after the hint
export const SCHULUNG_AB = 0.3; // ≥ 30 % stuck or abandoned

export function bewerte(rows: InsightRow[]): FeatureInsight[] {
  const byKey = new Map<string, FeatureInsight>();
  for (const r of rows) {
    const key = `${r.app_id}|${r.feature}|${r.role ?? ""}`;
    const f = byKey.get(key) ?? { appId: r.app_id, feature: r.feature, role: r.role, persons: 0, verdict: "ok" as Verdict };
    f.persons = Math.max(f.persons, r.persons);
    const v = Number(r.value);
    if (r.metric === "stuck_rate") f.stuckRate = v;
    if (r.metric === "still_stuck_after_hint") f.stillStuckAfterHint = v;
    if (r.metric === "abandoned_flow") f.abandonedFlow = v;
    if (r.metric === "question_count") f.questions = v;
    byKey.set(key, f);
  }
  const list = [...byKey.values()];
  for (const f of list) {
    if ((f.stillStuckAfterHint ?? 0) >= APP_PROBLEM_AB) f.verdict = "improve";
    else if (Math.max(f.stuckRate ?? 0, f.abandonedFlow ?? 0) >= SCHULUNG_AB) f.verdict = "train";
  }
  const order: Record<Verdict, number> = { improve: 0, train: 1, ok: 2 };
  return list.sort((a, b) => order[a.verdict] - order[b.verdict] || b.persons - a.persons);
}

export const prozent = (v?: number) => (v === undefined ? "–" : `${Math.round(v * 100)} %`);
